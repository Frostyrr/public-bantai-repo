import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://history-test.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
process.env.PASSWORD_HISTORY_ENABLED = "true";
process.env.PASSWORD_HISTORY_NATIVE_CURRENT_PASSWORD_REQUIRED = "true";
test("managed writer fails closed, uses native user checks, and reconciles uncertain outcomes", async (t) => {
  const { managedPasswordUpdate, newAuthorization } = await import("../src/modules/user/passwordHistory.service");
  const { hashPassword, verifyPassword } = await import("../src/modules/user/passwordVerifier");
  const originalFetch = globalThis.fetch, proof = newAuthorization();
  const req = { auth: { user: { id: "11111111-1111-4111-8111-111111111111" }, sessionId: "22222222-2222-4222-8222-222222222222", aal: "aal2", accessToken: "test-token" } } as Request;
  const input = { password: "New password 1!", currentPassword: "Old password 1!", authorization: proof.token };
  let failAction = "", purpose = "change", snapshot: any = { version: 0, tracked: 0, verifiers: [] }, outcome = "committed", nativeStatus = 200, nativeCode = "", lostResponse = false, cancelCommitted = false;
  let nativeWrites = 0, staged: any, actions: string[] = [], malformedStage=false, malformedCancel=false;
  globalThis.fetch = async (url, init) => {
    const target = new URL(url instanceof Request ? url.url : String(url));
    if(target.pathname.endsWith("/bantai_password_history_rollout"))return Response.json({protocol:2,mode:"managed",epoch:0});
    if (target.pathname === "/rest/v1/rpc/bantai_password_history") {
      const body = JSON.parse(String(init?.body));
      const action = body.p_action;
      actions.push(action);
      assert.equal(new Headers(init?.headers).get("apikey"), "sb_secret_test");
      if (action === failAction)
        return Response.json({ message: "internal database detail" }, { status: 500 });
      if (action === "proof")
        return Response.json({ purpose });
      if (action === "snapshot")
        return Response.json(snapshot);
      if (action === "stage") {
        staged = body.p_data;
        return Response.json(malformedStage?{}:{ ok: true });
      }
      if (action === "outcome")
        return Response.json({ status: outcome });
      if (action === "cancel")
        return Response.json(malformedCancel?{}:{ status: cancelCommitted ? "committed" : "cancelled" });
      throw new Error("Unexpected RPC action");
    }
    assert.equal(target.pathname, "/auth/v1/user");
    assert.equal(init?.method, "PUT");
    assert.equal(new Headers(init?.headers).get("apikey"), "sb_publishable_test");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.current_password, purpose === "change" ? input.currentPassword : undefined);
    assert.ok(body.data.bantai_password_operation);
    nativeWrites++;
    if (lostResponse)
      throw new Error("lost response");
    return Response.json({ code: nativeStatus, error_code: nativeCode }, { status: nativeStatus });
  };
  const reset = () => { failAction = ""; purpose = "change"; snapshot = { version: 0, tracked: 0, verifiers: [] }; outcome = "committed"; nativeStatus = 200; nativeCode = ""; lostResponse = false; cancelCommitted = false; nativeWrites = 0; staged = undefined; actions = [];malformedStage=false;malformedCancel=false; };
  try {
    await t.test("ordinary access token cannot replace purpose-bound verification", async () => {
      reset();
      await assert.rejects(managedPasswordUpdate(req, { ...input, authorization: undefined }, "change"));
      assert.equal(nativeWrites, 0);
      assert.deepEqual(actions, []);
      purpose = "reset";
      await assert.rejects(managedPasswordUpdate(req, input, "change"));
      assert.equal(nativeWrites, 0);
    });
    await t.test("lookup and malformed verifier failures prevent Auth submission", async () => {
      for (const action of ["proof", "snapshot"]) {
        reset();
        failAction = action;
        await assert.rejects(managedPasswordUpdate(req, input, "change"));
        assert.equal(nativeWrites, 0);
      }
      reset();
      snapshot = { version: 1, tracked: 1, verifiers: ["corrupt"] };
      await assert.rejects(managedPasswordUpdate(req, input, "change"), { publicCode: "password_history_unavailable" });
      assert.equal(nativeWrites, 0);
    });
    await t.test("stale history cannot authorize an ordinary managed change",async()=>{
      reset();snapshot={version:1,tracked:1,verifiers:[],stale:true};
      await assert.rejects(managedPasswordUpdate(req,input,"change"),{publicCode:"password_history_stale"});assert.equal(nativeWrites,0);
    });
    await t.test("current and retired password matches stop before staging", async () => {
      reset();
      snapshot = { version: 4, tracked: 4, verifiers: await Promise.all([input.password, "Previous pass 1!", "Previous pass 2!", "Previous pass 3!"].map(hashPassword)) };
      await assert.rejects(managedPasswordUpdate(req, input, "change"), { publicCode: "password_reused" });
      assert.equal(nativeWrites, 0);
      assert.ok(!actions.includes("stage"));
    });
    await t.test("first authenticated change stages independent current and candidate verifiers", async () => {
      reset();
      await managedPasswordUpdate(req, input, "change");
      assert.equal(nativeWrites, 1);
      assert.equal(await verifyPassword(input.password, staged.candidate), true);
      assert.equal(await verifyPassword(input.currentPassword, staged.seed), true);
      assert.notEqual(staged.candidate, staged.seed);
      assert.ok(!actions.includes("cancel"));
    });
    await t.test("approved recovery bootstrap tracks only the new password", async () => {
      reset();
      purpose = "reset";
      await managedPasswordUpdate(req, { password: input.password, authorization: proof.token }, "reset");
      assert.equal(staged.seed, undefined);
      assert.equal(nativeWrites, 1);
    });
    await t.test("stage persistence errors never submit a credential", async () => {
      reset();
      failAction = "stage";
      await assert.rejects(managedPasswordUpdate(req, input, "change"));
      assert.equal(nativeWrites, 0);
      assert.ok(actions.includes("cancel"));
      reset();malformedStage=true;
      await assert.rejects(managedPasswordUpdate(req,input,"change"),{publicCode:"password_history_unavailable"});assert.equal(nativeWrites,0);
    });
    await t.test("lost Auth response resolves committed history without replaying the password", async () => {
      reset();
      lostResponse = true;
      await managedPasswordUpdate(req, input, "change");
      assert.equal(nativeWrites, 1);
      assert.ok(!actions.includes("cancel"));
    });
    await t.test("native reauthentication errors fence operation before safe retry", async () => {
      reset();
      nativeStatus = 400;
      nativeCode = "reauthentication_needed";
      outcome = "pending";
      await assert.rejects(managedPasswordUpdate(req, input, "change"), { publicCode: "reauthentication_needed" });
      assert.equal(nativeWrites, 1);
      assert.equal(actions.at(-1), "cancel");
    });
    await t.test("commit racing cancellation is recognized as success", async () => {
      reset();
      outcome = "pending";
      cancelCommitted = true;
      await managedPasswordUpdate(req, input, "change");
      assert.equal(nativeWrites, 1);
    });
    await t.test("unknown outcome or failed cancellation requires verified reconciliation", async () => {
      for (const action of ["outcome", "cancel"]) {
        reset();
        outcome = "pending";
        failAction = action;
        await assert.rejects(managedPasswordUpdate(req, input, "change"), { publicCode: "password_change_uncertain" });
        assert.equal(nativeWrites, 1);
      }
      reset();outcome="pending";malformedCancel=true;
      await assert.rejects(managedPasswordUpdate(req,input,"change"),{publicCode:"password_change_uncertain"});assert.equal(nativeWrites,1);
    });
  }
  finally {
    globalThis.fetch = originalFetch;
  }
});
