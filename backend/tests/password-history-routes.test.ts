import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://history-routes.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
process.env.PASSWORD_HISTORY_ENABLED = "true";
process.env.PASSWORD_HISTORY_NATIVE_CURRENT_PASSWORD_REQUIRED = "true";
process.env.EMAIL_MFA_HMAC_KEY = "test-hmac-key-never-production-123456";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.BREVO_SENDER_EMAIL = "test@example.test";
test("HTTP password routes require purpose verification and preserve authenticated middleware", async (t) => {
  const session = "22222222-2222-4222-8222-222222222222", userId = "11111111-1111-4111-8111-111111111111";
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ session_id: session, aal: "aal1", exp: Math.floor(Date.now() / 1000) + 600, amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }] })).toString("base64url")}.signature`;
  const user = { id: userId, email: "user@example.test", email_confirmed_at: "2026-01-01", app_metadata: {}, user_metadata: {} };
  const originalFetch = globalThis.fetch;
  let rolloutMode="managed",controlFailure=false,allowLegacyAdmin=false;
  let decision = "active", otpValid = true, issued = 0, adminWrites = 0, deliveryCode = "", challengeDigest = "", proofs = new Map<string, {
    digest: string;
    purpose: string;
  }>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.brevo.com") {
      deliveryCode = JSON.parse(String(init?.body)).textContent.match(/code is ([0-9]{6})/)[1];
      return Response.json({ messageId: "test" });
    }
    if (url.hostname !== "history-routes.supabase.co")
      return originalFetch(input, init);
    if (url.pathname.startsWith("/auth/v1/admin")) {
      adminWrites++;
      if(allowLegacyAdmin)return Response.json(user);
      throw new Error("Admin password writer must not be used");
    }
    if (url.pathname === "/auth/v1/verify") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.type, "recovery");
      return otpValid ? Response.json({ user, access_token: token, refresh_token: "recovery-refresh", token_type: "bearer", expires_in: 600 }) : Response.json({ msg: "expired", code: "otp_expired" }, { status: 403 });
    }
    if (url.pathname === "/auth/v1/user")
      return Response.json(user);
    if(url.pathname.endsWith("/bantai_password_history_rollout"))return controlFailure?Response.json({message:"unavailable"},{status:500}):Response.json({protocol:2,mode:rolloutMode,...(rolloutMode==="managed"?{epoch:0}:{databaseGate:rolloutMode==="legacy"?"disabled":"frozen"})});
    const body = JSON.parse(String(init?.body));
    if (url.pathname.endsWith("/bantai_check_session"))
      return Response.json(decision);
    if (url.pathname.endsWith("/bantai_password_history")) {
      assert.equal(new Headers(init?.headers).get("apikey"), "sb_secret_test");
      const data = body.p_data;
      switch (body.p_action) {
        case "issue_reset":
          issued++;
          proofs.set(data.id, { digest: data.digest, purpose: "reset" });
          return Response.json({ ok: true });
        case "send":
          challengeDigest = data.digest;
          return Response.json({ ok: true });
        case "confirm":
          if (challengeDigest !== data.codeDigest)
            return Response.json({ ok: false });
          proofs.set(data.id, { digest: data.digest, purpose: "change" });
          return Response.json({ ok: true });
        case "proof": {
          const proof = proofs.get(data.authorizationId);
          return proof?.digest === data.authorizationDigest ? Response.json({ purpose: proof.purpose }) : Response.json({ message: "invalid proof" }, { status: 400 });
        }
        case "snapshot":return Response.json({version:0,tracked:0,verifiers:[],epoch:0});
        case "cancel":
        case "reconcile": return Response.json({ status: "none" });
      }
    }
    if (url.pathname.endsWith("/bantai_sq_action"))
      return Response.json({ enabled: false, questions: [] });
    throw new Error("Unexpected hosted request");
  };
  const { passwordHistoryPublic, passwordHistorySettings } = await import("../src/modules/user/passwordHistory.routes");
  const { recoveryQuestions } = await import("../src/modules/user/securityQuestions.routes");
  const { authenticate } = await import("../src/middleware/authenticate");
  const { default: errorHandler } = await import("../src/middleware/errorHandler");
  const {env}=await import("../src/constants/env");
  const app = express();
  app.use(express.json());
  app.use("/auth/password-history", passwordHistoryPublic);
  app.use("/user/password-history", authenticate, passwordHistorySettings);
  app.use("/auth/recovery-questions", recoveryQuestions);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: object = {}, headers: Record<string, string> = {}) => originalFetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    await t.test("ordinary access tokens cannot authorize a reset, even with a recent OTP AMR", async () => {
      const result = await post("/auth/recovery-questions/password", { password: "New password 1!" }, { Authorization: `Bearer ${token}` });
      assert.equal(result.status, 403);
      assert.equal((await result.json()).code, "password_proof_required");
      assert.equal(adminWrites, 0);
    });
    await t.test("verified recovery OTP is the only public reset grant issuer", async () => {
      otpValid = false;
      assert.equal((await post("/auth/password-history/verify", { email: user.email, token: "123456" })).status, 401);
      assert.equal(issued, 0);
      otpValid = true;
      const result = await post("/auth/password-history/verify", { email: user.email, token: "123456" });
      assert.equal(result.status, 200);
      const data = await result.json();
      assert.equal(issued, 1);
      assert.ok(data.authorization);
      assert.equal(data.access_token, token);
      assert.equal(result.headers.get("cache-control"), "no-store");
      const reconcile = await post("/auth/recovery-questions/reconcile", {}, { Authorization: `Bearer ${token}`, "X-Recovery-Authorization": data.authorization });
      assert.equal(reconcile.status, 200);
    });
    await t.test("fresh change email code cannot authorize reset reconciliation", async () => {
      const headers = { Authorization: `Bearer ${token}` };
      assert.equal((await post("/user/password-history/send", {}, headers)).status, 204);
      assert.match(deliveryCode, /^[0-9]{6}$/);
      const confirmed = await post("/user/password-history/confirm", { code: deliveryCode }, headers);
      assert.equal(confirmed.status, 200);
      const authorization = (await confirmed.json()).authorization;
      assert.equal((await post("/auth/recovery-questions/reconcile", {}, { ...headers, "X-Recovery-Authorization": authorization })).status, 403);
      const proof = [...proofs.entries()].find(([, p]) => p.purpose === "change");
      assert.ok(proof);
      // A malformed/missing grant and a normal token both remain insufficient.
      assert.equal((await post("/user/password-history/change", { password: "New password 1!", currentPassword: "Old password 1!", authorization: "invalid" }, headers)).status, 403);
    });
    await t.test("disabled status contract remains available and legacy recovery retains its contract",async()=>{
      env.PASSWORD_HISTORY_ENABLED="false";env.PASSWORD_HISTORY_NATIVE_CURRENT_PASSWORD_REQUIRED="false";rolloutMode="legacy";
      for(let i=0;i<25;i++){
        const response=await originalFetch(base+"/auth/password-history/status");assert.equal(response.status,200);
        const status=await response.json();assert.equal(status.backendVersion,"password-history-v2");assert.equal(status.protocol,2);assert.equal(status.enabled,false);assert.equal(status.acceptingChanges,true);
      }
      allowLegacyAdmin=true;
      assert.equal((await post("/auth/recovery-questions/password",{password:"Legacy fixture 1!"},{Authorization:`Bearer ${token}`})).status,204);
      assert.equal(adminWrites,1);allowLegacyAdmin=false;adminWrites=0;
    });
    await t.test("freeze preserves verified reconciliation despite both application flags being off",async()=>{
      rolloutMode="frozen";
      const status=await (await originalFetch(base+"/auth/password-history/status")).json();
      assert.equal(status.enabled,true);assert.equal(status.frozen,true);assert.equal(status.acceptingChanges,false);
      const verified=await post("/auth/password-history/verify",{email:user.email,token:"123456"});assert.equal(verified.status,200);
      const proof=(await verified.json()).authorization;
      const headers={Authorization:`Bearer ${token}`,"X-Recovery-Authorization":proof};
      assert.equal((await post("/auth/recovery-questions/reconcile",{},headers)).status,200);
      assert.equal((await post("/auth/recovery-questions/password",{password:"Frozen fixture 1!"},headers)).status,409);
      assert.equal((await post("/auth/recovery-questions/password",{password:"Frozen fixture 1!"},{Authorization:`Bearer ${token}`})).status,403);
      assert.equal(adminWrites,0);
    });
    await t.test("mixed flags and an unavailable managed RPC never silently select legacy recovery",async()=>{
      rolloutMode="managed";
      const status=await(await originalFetch(base+"/auth/password-history/status")).json();assert.equal(status.enabled,true);assert.equal(status.acceptingChanges,false);
      assert.equal((await post("/auth/recovery-questions/password",{password:"Mixed fixture 1!"},{Authorization:`Bearer ${token}`})).status,403);
      controlFailure=true;const before=issued;
      assert.equal((await originalFetch(base+"/auth/password-history/status")).status,503);
      assert.equal((await post("/auth/password-history/verify",{email:user.email,token:"123456"})).status,503);assert.equal(issued,before);
      assert.equal(adminWrites,0);controlFailure=false;
      env.PASSWORD_HISTORY_ENABLED="true";env.PASSWORD_HISTORY_NATIVE_CURRENT_PASSWORD_REQUIRED="true";
    });
    await t.test("existing session, MFA and account decisions still reject password routes", async () => {
      for (const value of ["locked", "suspended", "mfa_required", "idle", "revoked"]) {
        decision = value;
        const result = await post("/user/password-history/send", {}, { Authorization: `Bearer ${token}` });
        assert.equal(result.status, ["idle", "revoked"].includes(value) ? 401 : 403);
      }
      assert.equal(adminWrites, 0);
    });
  }
  finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
