import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { PGlite } from "@electric-sql/pglite";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const project = "https://jwt-test.supabase.co";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(overrides: Record<string, unknown> = {}) {
  const header = encode({ alg: "ES256", kid: "test-key" });
  const payload = encode({
    iss: project + "/auth/v1", aud: "authenticated", role: "authenticated",
    sub: userId, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  });
  const input = header + "." + payload;
  return input + "." + sign("sha256", Buffer.from(input), {
    key: privateKey, dsaEncoding: "ieee-p1363",
  }).toString("base64url");
}

test("asymmetric middleware verifies JWTs and retains live account and session checks", async (t) => {
  process.env.NODE_ENV = "test";
  process.env.SUPABASE_URL = project;
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
  process.env.AUTH_JWKS_ENABLED = "true";

  const originalFetch = globalThis.fetch;
  let decision = "active";
  let rpcCalls = 0;
  let authCalls = 0;
  let jwksCalls = 0;
  let failRpc = false;
  let enrolled = false;
  let platformAdmin = false;
  let roleLookupUnavailable = false;
  const monitoringRpcs = new Set([
    "platform_admin_overview", "platform_admin_health_ping", "platform_admin_security_overview",
    "platform_admin_list_security_events", "platform_admin_threat_overview_with_flags",
    "platform_admin_list_incidents", "platform_admin_attention_summary", "admin_get_security_heatmap_filtered",
  ]);
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== project) return originalFetch(input, init);
    if (url.pathname.endsWith("/jwks.json")) {
      jwksCalls++;
      return json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "ES256" }] });
    }
    if (url.pathname === "/auth/v1/user") {
      authCalls++;
      return json({ id: userId, identities: [{ provider: "google" }], email_confirmed_at: "2026-01-01" });
    }
    if (url.pathname === "/rest/v1/profiles") {
      return json({ locked_until: new Date(Date.now() + 90_000).toISOString() });
    }
    const body = JSON.parse(init?.body as string);
    const rpc = url.pathname.split("/").at(-1)!;
    if (rpc === "bantai_email_mfa_enabled") {
      assert.equal(new Headers(init?.headers).get("apikey"), "sb_secret_test");
      return json(true);
    }
    if (rpc === "record_authenticated_security_event") {
      assert.equal(new Headers(init?.headers).get("apikey"), "sb_secret_test");
      assert.equal(body.p_actor_id, userId);
      assert.equal(body.p_action, "ADMIN_VIEWED_DASHBOARD");
      return json(1);
    }
    if (rpc === "is_platform_admin") {
      assert.equal(body.required_super, false);
      assert.notEqual(new Headers(init?.headers).get("apikey"), "sb_secret_test");
      return roleLookupUnavailable ? json({ code: "PGRST202", message: "missing function" }, 404) : json(platformAdmin);
    }
    if (monitoringRpcs.has(rpc)) {
      assert.notEqual(new Headers(init?.headers).get("apikey"), "sb_secret_test");
      return json({ code: "P0001", message: "Platform administrator access required" }, 400);
    }
    if (url.pathname.endsWith("/bantai_check_session")) return json(enrolled && body.p_aal !== "aal2" ? "mfa_required" : "active");
    assert.equal(url.pathname, "/rest/v1/rpc/bantai_check_verified_session");
    assert.equal(new Headers(init?.headers).get("apikey"), "sb_secret_test");
    assert.equal(body.p_user, userId);
    assert.equal(body.p_session, sessionId);
    rpcCalls++;
    return failRpc ? json({ code: "PGRST202", message: "missing function" }, 404) :
      json({ decision: enrolled && body.p_aal === "aal1" ? "mfa_required" : decision, user_metadata: { display_name: "Current name" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const { authenticate, authenticateForEmailChallenge } = await import("../src/middleware/authenticate");
  const { emailMfaChallenge } = await import("../src/modules/user/emailMfa.routes");
  const { default: adminRoutes } = await import("../src/modules/admin/admin.routes");
  const app = express();
  app.use(express.json());
  app.use("/user", authenticate, (req, res) => { res.json(req.auth?.user); });
  app.use("/admin", authenticate, adminRoutes);
  app.use("/auth/email-mfa", authenticateForEmailChallenge, emailMfaChallenge);
  app.use((error: { statusCode?: number; name?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.sendStatus(error.name === "ZodError" ? 400 : error.statusCode ?? 500);
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => { server.close(); });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/user";
  const request = (accessToken: string, path = "/preferences") =>
    originalFetch(base + path, { headers: { Authorization: "Bearer " + accessToken } });

  const active = await request(token());
  assert.equal(active.status, 200);
  assert.deepEqual(await active.json(), { id: userId, user_metadata: { display_name: "Current name" } });
  assert.match(active.headers.get("server-timing") ?? "", /auth;dur=.*session;dur=/);
  assert.equal(authCalls, 0);
  assert.equal(rpcCalls, 1);

  const [header, payload, signature] = token().split(".");
  const changedSignature = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  const invalid = [
    header + "." + payload + "." + changedSignature,
    token({ iss: "https://other.example/auth/v1" }),
    token({ aud: "anon" }),
    token({ exp: 1 }),
    token({ nbf: Math.floor(Date.now() / 1000) + 30 }),
    token({ session_id: null }),
  ];
  for (const accessToken of invalid) assert.equal((await request(accessToken)).status, 401);
  assert.equal(rpcCalls, 1);

  for (const [state, status, code] of [
    ["unverified", 403, undefined], ["locked", 403, "account_locked"], ["suspended", 403, "account_suspended"],
    ["idle", 401, "session_timed_out"], ["absolute", 401, "session_timed_out"],
    ["revoked", 401, "session_revoked"], ["logged_out", 401, "session_revoked"],
  ] as const) {
    decision = state;
    const response = await request(token());
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    if (state === "locked") {
      assert.equal(response.headers.get("retry-after"), "90");
      assert.equal(body.retryAfterSeconds, 90);
    }
  }
  assert.equal(authCalls, 0);
  assert.equal(jwksCalls, 1);

  failRpc = true;
  assert.equal((await request(token())).status, 503);
  const profile = await request(token(), "");
  assert.equal(profile.status, 200);
  assert.deepEqual((await profile.json()).identities, [{ provider: "google" }]);
  assert.equal(authCalls, 1);

  failRpc = false;
  decision = "active";
  enrolled = true;
  for (const path of ["", "/preferences"]) {
    const blocked = await request(token({ aal: "aal1" }), path);
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, "mfa_required");
    assert.equal((await request(token({ aal: "aal2" }), path)).status, 200);
  }

  await t.test("pending MFA sessions reach only the email challenge surface", async () => {
    const url = new URL("/auth/email-mfa", base);
    assert.equal((await originalFetch(url)).status, 401);
    const accessToken = token({ aal: "aal1" });
    const challenge = await originalFetch(url, { headers: { Authorization: "Bearer " + accessToken } });
    assert.equal(challenge.status, 200);
    assert.deepEqual(await challenge.json(), { enabled: true, sessionId });
    for (const [path, body] of [
      ["/send", { method: "totp" }],
      ["/verify", { method: "totp", code: "123456" }],
      ["/verify", { method: "email", code: "bad" }],
      ["/send", { method: "unknown" }],
    ] as const) {
      assert.equal((await originalFetch(new URL(url.pathname + path, url), {
        method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })).status, 400);
    }
    assert.equal((await request(accessToken)).status, 403);
    decision = "revoked";
    assert.equal((await originalFetch(url, { headers: { Authorization: "Bearer " + accessToken } })).status, 401);
    decision = "active";
  });

  await t.test("ordinary sessions cannot read platform monitoring over HTTP", async () => {
    const adminBase = new URL("/admin/", base);
    const get = (path: string, accessToken?: string) =>
      originalFetch(new URL(path, adminBase), {
        headers: accessToken ? { Authorization: "Bearer " + accessToken } : undefined,
      });
    assert.equal((await get("realtime-visitors")).status, 401);
    const accessToken = token({ aal: "aal2" });
    for (const route of [
      "realtime-visitors", "overview", "security/overview", "security/events",
      "security/threats", "security/incidents", "security/heatmap", "attention-summary",
    ]) {
      const response = await get(route, accessToken);
      assert.equal(response.status, 403, route);
      assert.equal(await response.text(), "Forbidden");
    }
    roleLookupUnavailable = true;
    assert.equal((await get("realtime-visitors", accessToken)).status, 503);
    roleLookupUnavailable = false;
    platformAdmin = true;
    const dashboardEntry = () => originalFetch(new URL("security/dashboard-entry", adminBase), {
      method: "POST", headers: { Authorization: "Bearer " + accessToken },
    });
    platformAdmin = false;
    assert.equal((await dashboardEntry()).status, 403);
    platformAdmin = true;
    assert.equal((await dashboardEntry()).status, 204);
    const response = await get("realtime-visitors", accessToken);
    assert.equal(response.status, 200);
    assert.ok((await response.json()).realtime);
  });
});

test("verified-session RPC checks fresh account state and delegates to the service-only session policy", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users (
        id uuid primary key, email_confirmed_at timestamptz, deleted_at timestamptz,
        banned_until timestamptz, raw_user_meta_data jsonb
      );
      create function public.bantai_check_session(uuid, uuid, boolean)
      returns text language sql as $$
        select case when $1 = '${sessionId}' and $2 = '${userId}' and $3 then 'active' else 'idle' end
      $$;
    `);
    await db.exec(await readFile("../supabase/migrations/202611170001_verified_session_identity.sql", "utf8"));
    const check = async (activity: boolean) => (await db.query<{ result: unknown }>(
      "select public.bantai_check_verified_session($1, $2, $3) as result", [sessionId, userId, activity],
    )).rows[0].result;
    await db.exec("set role service_role");
    assert.deepEqual(await check(true), { decision: "revoked" });
    await db.exec("reset role");
    await db.query("insert into auth.users (id) values ($1)", [userId]);
    assert.deepEqual(await check(true), { decision: "unverified" });
    await db.exec(`update auth.users set email_confirmed_at = now(), raw_user_meta_data = '{"display_name":"Fresh"}'`);
    assert.deepEqual(await check(false), { decision: "idle" });
    assert.deepEqual(await check(true), { decision: "active", user_metadata: { display_name: "Fresh" } });
    await db.exec("update auth.users set banned_until = now() + interval '1 hour'");
    assert.deepEqual(await check(true), { decision: "revoked" });
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set role " + role);
      await assert.rejects(check(true), /permission denied/);
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});

test("MFA migration protects Express RPCs, the REST hook, and Storage checks for enrolled users", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema bantai_private;
      create schema bantai_gateway;
      create table auth.mfa_factors (user_id uuid, status text);
      create function auth.role() returns text language sql as $$ select current_setting('test.role') $$;
      create function auth.jwt() returns jsonb language sql as $$ select current_setting('test.claims')::jsonb $$;
      create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
      create function public.bantai_check_session(uuid, uuid, boolean) returns text language sql as $$ select 'active' $$;
      create function public.bantai_check_verified_session(uuid, uuid, boolean) returns jsonb language sql as $$ select '{"decision":"active"}'::jsonb $$;
      create function bantai_private.session_decision(uuid, uuid) returns text language sql as $$ select 'active' $$;
    `);
    await db.exec(await readFile("../supabase/migrations/202611170003_enforce_opt_in_mfa.sql", "utf8"));
    await db.query("insert into auth.mfa_factors values ($1, 'unverified')", [userId]);
    const check = (aal: string) => db.query(
      "select public.bantai_check_session($1, $2, false, $3) as plain, public.bantai_check_verified_session($1, $2, false, $3)->>'decision' as jwks",
      [sessionId, userId, aal],
    );
    assert.deepEqual((await check("aal1")).rows, [{ plain: "active", jwks: "active" }]);

    await db.exec("update auth.mfa_factors set status = 'verified'");
    await db.exec("set role service_role");
    assert.deepEqual((await check("aal1")).rows, [{ plain: "mfa_required", jwks: "mfa_required" }]);
    assert.deepEqual((await check("aal2")).rows, [{ plain: "active", jwks: "active" }]);
    await db.exec("reset role");
    await db.exec("set role authenticated");
    await assert.rejects(check("aal2"), /permission denied/);
    await db.exec("reset role");

    await db.exec("set test.role = 'authenticated'");
    for (const aal of ["aal1", "aal2"]) {
      await db.query("select set_config('test.claims', $1, false)", [JSON.stringify({ aal, sub: userId, session_id: sessionId })]);
      assert.deepEqual((await db.query("select public.bantai_storage_session_allowed() as allowed")).rows, [{ allowed: aal === "aal2" }]);
      if (aal === "aal1") {
        await assert.rejects(db.query("select bantai_gateway.check_session()"), /mfa_required/);
      } else {
        await db.query("select bantai_gateway.check_session()");
      }
    }
    await db.exec("delete from auth.mfa_factors");
    assert.deepEqual((await check("aal1")).rows, [{ plain: "active", jwks: "active" }]);
  } finally {
    await db.close();
  }
});
