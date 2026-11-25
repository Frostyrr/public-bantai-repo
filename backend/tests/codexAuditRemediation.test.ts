import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { createServiceClient } from "../src/config/supabase";
import { createRateLimiter } from "../src/middleware/rateLimit";
import { createRequestTiming } from "../src/middleware/requestTiming";

async function createMigratedDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);

  await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
  const dir = path.resolve(__dirname, "../../supabase/migrations");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(dir, file), "utf8"));
  }
  return db;
}

test("CODEX-01/02/03: migration 042 locks internal RPCs, restricts security writes to service_role, and preserves required app functions", async () => {
  const db = await createMigratedDb();
  try {
    const internalSigs = [
      "public.review_expense_internal(uuid,uuid,text,text)",
      "public.review_expense_with_private_result(uuid,uuid,text,text,integer)",
      "public.review_liquidation_with_private_result(uuid,uuid,text,text)",
      "public.delete_collection(uuid,uuid)",
      "public.create_organization_with_owner(text,text)",
      "public.lock_liquidation_accounting(uuid,uuid)",
      "public.cleanup_directory_import_reports()",
      "public.pending_expense_storage_copies(integer)",
      "public.confirm_expense_storage_copy(uuid,text,text)",
    ];

    for (const sig of internalSigs) {
      const res = await db.query<{ pub: boolean; anon: boolean; auth: boolean }>(
        `select
           has_function_privilege('public', $1::regprocedure, 'EXECUTE') as pub,
           has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
           has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as auth`,
        [sig],
      );
      assert.deepEqual(res.rows[0], { pub: false, anon: false, auth: false }, `Internal RPC ${sig} must not be client-callable`);
    }

    const securityWriteSigs = [
      "public.consume_rate_limit(text,integer,integer)",
      "public.record_edge_security_event(text,text,text,text,text,integer,text,text,jsonb)",
    ];
    for (const sig of securityWriteSigs) {
      const res = await db.query<{ pub: boolean; anon: boolean; auth: boolean; sr: boolean }>(
        `select
           has_function_privilege('public', $1::regprocedure, 'EXECUTE') as pub,
           has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
           has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as auth,
           has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as sr`,
        [sig],
      );
      assert.deepEqual(
        res.rows[0],
        { pub: false, anon: false, auth: false, sr: true },
        `Security write RPC ${sig} must be service_role-only`,
      );
    }

    const requiredAuthSigs = [
      "public.member_expense_transactions(uuid)",
      "public.member_advance_transactions(uuid)",
      "public.member_ledger_totals(uuid)",
      "public.expense_storage_location(uuid,uuid,uuid)",
      "public.revoke_workspace_history(uuid,uuid)",
      "public.leave_organization(uuid)",
      "public.delete_personal_account()",
      "public.publish_financial_snapshot(uuid)",
      "public.withdraw_financial_snapshot(uuid,uuid)",
      "public.mark_all_notifications_read(uuid)",
    ];
    for (const sig of requiredAuthSigs) {
      const res = await db.query<{ pub: boolean; anon: boolean; auth: boolean }>(
        `select
           has_function_privilege('public', $1::regprocedure, 'EXECUTE') as pub,
           has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
           has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as auth`,
        [sig],
      );
      assert.deepEqual(res.rows[0], { pub: false, anon: false, auth: true }, `Required auth RPC ${sig} grant mismatch`);
    }

    // Also verify reconcile_collection_assessment is not client-callable
    const reconcilePriv = await db.query<{ pub: boolean; anon: boolean; auth: boolean }>(
      `select
         has_function_privilege('public', 'public.reconcile_collection_assessment(uuid,uuid,uuid)'::regprocedure, 'EXECUTE') as pub,
         has_function_privilege('anon', 'public.reconcile_collection_assessment(uuid,uuid,uuid)'::regprocedure, 'EXECUTE') as anon,
         has_function_privilege('authenticated', 'public.reconcile_collection_assessment(uuid,uuid,uuid)'::regprocedure, 'EXECUTE') as auth`,
    );
    assert.deepEqual(reconcilePriv.rows[0], { pub: false, anon: false, auth: false });
  } finally {
    await db.close();
  }
});

test("CODEX-02: request timing uses only the service client for both event writers", async () => {
  const actorId = "10000000-0000-4000-8000-000000000001";
  let serviceConfigured = true;
  const userRpcCalls: string[] = [];
  const serviceRpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const app = express();
  app.use(
    createRequestTiming({
      shouldEnforce: () => false,
      shouldRecordEvents: () => true,
      createClient: (() => ({
        rpc: (fn: string) => {
          userRpcCalls.push(fn);
          return Promise.resolve({ data: null, error: null });
        },
      })) as unknown as typeof import("../src/config/supabase").createUserClient,
      createServiceClient: (() => serviceConfigured ? ({
        rpc: (fn: string, args: Record<string, unknown>) => {
          serviceRpcCalls.push({ fn, args });
          return Promise.resolve({ data: null, error: null });
        },
      }) : null) as unknown as typeof createServiceClient,
    }),
  );
  app.get("/api/protected", (_req, res) => {
    res.status(401).json({ message: "Unauthorized" });
  });
  app.get("/api/verified", (req, res) => {
    req.auth = { accessToken: "verified-fixture-token", user: { id: actorId, user_metadata: {} } };
    res.status(403).json({ message: "Forbidden" });
  });

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}`;
    assert.equal((await fetch(base + "/api/protected")).status, 401);
    assert.equal((await fetch(base + "/api/verified")).status, 403);
    serviceConfigured = false;
    assert.equal((await fetch(base + "/api/verified")).status, 403);
    assert.deepEqual(userRpcCalls, []);
    assert.equal(serviceRpcCalls.length, 2);
    assert.equal(serviceRpcCalls[0].fn, "record_edge_security_event");
    assert.equal(serviceRpcCalls[1].fn, "record_authenticated_security_event");
    assert.equal(serviceRpcCalls[1].args.p_actor_id, actorId);
  } finally {
    server.close();
  }
});

test("CODEX-043: Storage initialization succeeds without storage.policies and enforces restrictive policy", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema storage;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text not null references storage.buckets(id),
        name text not null
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      grant select on storage.objects to anon, authenticated;
      create policy permissive_all_objects on storage.objects for select to anon, authenticated using (true);
    `);

    const sql043 = await readFile(
      path.resolve(__dirname, "../../supabase/migrations/202611150043_reconcile_function_parity_storage_and_grants.sql"),
      "utf8",
    );
    const storageBlockMatch = sql043.match(/-- 4\. Fix Storage initialization[\s\S]*?(?=commit;)/);
    assert.ok(storageBlockMatch, "Storage block not found in 043");
    await db.exec(storageBlockMatch[0]);

    const bucket = await db.query<{ id: string; public: boolean; file_size_limit: string }>(
      "select id, public, file_size_limit::text from storage.buckets where id = 'expense-evidence'",
    );
    assert.deepEqual(bucket.rows, [{ id: "expense-evidence", public: false, file_size_limit: "1048576" }]);

    await db.exec(`
      insert into storage.buckets(id, name, public) values ('public-assets', 'public-assets', true);
      insert into storage.objects(bucket_id, name) values
        ('expense-evidence', 'org/exp/receipt.pdf'),
        ('public-assets', 'logo.png');
      set role authenticated;
    `);
    const visible = await db.query<{ bucket_id: string }>("select bucket_id from storage.objects");
    assert.deepEqual(visible.rows, [{ bucket_id: "public-assets" }]);
  } finally {
    await db.close();
  }
});

test("CODEX-043: Production rate limiter fails closed (503) when service_role client or RPC is unavailable", async () => {
  const missingKeyApp = express();
  missingKeyApp.use(
    createRateLimiter(
      { windowMs: 60_000, max: 5, keyPrefix: "prod_test" },
      {
        createServiceClient: () => null,
        isTestMode: () => false,
        isProductionMode: () => true,
      },
    ),
  );
  missingKeyApp.get("/protected", (_req, res) => res.json({ ok: true }));

  const rpcErrorApp = express();
  rpcErrorApp.use(
    createRateLimiter(
      { windowMs: 60_000, max: 5, keyPrefix: "prod_test" },
      {
        createServiceClient: (() => ({
          rpc: () => Promise.resolve({ data: null, error: { message: "db down" } }),
        })) as unknown as typeof createServiceClient,
        isTestMode: () => false,
        isProductionMode: () => true,
      },
    ),
  );
  rpcErrorApp.get("/protected", (_req, res) => res.json({ ok: true }));

  for (const app of [missingKeyApp, rpcErrorApp]) {
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      const res = await fetch(`http://127.0.0.1:${addr.port}/protected`);
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("retry-after"), "30");
    } finally {
      server.close();
    }
  }
});

test("CODEX-044: reconcile_collection_assessment blocks unauthorized direct callers even under SECURITY DEFINER while preserving trigger and officer flows", async () => {
  const db = await createMigratedDb();
  const ownerId = "d1000000-0000-4000-8000-000000000001";
  const memberId = "d1000000-0000-4000-8000-000000000002";
  const outsiderId = "d1000000-0000-4000-8000-000000000003";

  try {
    await db.exec(`
      insert into auth.users(id, email) values
        ('${ownerId}', 'owner44@test.local'),
        ('${memberId}', 'member44@test.local'),
        ('${outsiderId}', 'outsider44@test.local');
      set local role authenticated;
    `);
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false);`);
    const org = (
      await db.query<{ result: { id: string; invite_code: string } }>(
        "select public.create_typed_organization('Org 44', 'PHP', 'student', 'd2000000-0000-4000-8000-000000000001') as result",
      )
    ).rows[0].result;

    await db.exec(`select set_config('request.jwt.claim.sub', '${memberId}', false);`);
    await db.query("select public.join_organization_by_code($1)", [org.invite_code]);

    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false);`);
    const dirMember = (
      await db.query<{ id: string }>(
        "insert into public.organization_directory_members(organization_id, display_name, status) values ($1, 'Assessable Member', 'active') returning id",
        [org.id],
      )
    ).rows[0].id;

    // Create an auto-assessed collection via officer RPC (triggers / officer flow)
    const review = (
      await db.query<{ review: { token: string } }>(
        "select public.collection_creation_review($1, 'all', '{}', '{}', 25000) as review",
        [org.id],
      )
    ).rows[0].review;
    const created = (
      await db.query<{ result: { id: string } }>(
        "select public.create_assessed_collection($1, 'Annual Dues', 'Dues', null, null, 25000, '2026-12-01', 'all', '{}', '{}', 25000, true, $2, 'd3000000-0000-4000-8000-000000000001') as result",
        [org.id, review.token],
      )
    ).rows[0].result;

    // Trigger-driven auto-assessment when a new directory member is added still succeeds
    const dirMember2 = (
      await db.query<{ id: string }>(
        "insert into public.organization_directory_members(organization_id, display_name, status) values ($1, 'Triggered Member', 'active') returning id",
        [org.id],
      )
    ).rows[0].id;
    const obsAfterTrigger = await db.query<{ cnt: string }>(
      "select count(*)::text as cnt from public.obligations where collection_id = $1 and directory_member_id in ($2, $3)",
      [created.id, dirMember, dirMember2],
    );
    assert.equal(obsAfterTrigger.rows[0].cnt, "2");

    // Verify grants remain revoked from PUBLIC, anon, authenticated
    const priv = await db.query<{ pub: boolean; anon: boolean; auth: boolean }>(
      `select
         has_function_privilege('public', 'public.reconcile_collection_assessment(uuid,uuid,uuid)'::regprocedure, 'EXECUTE') as pub,
         has_function_privilege('anon', 'public.reconcile_collection_assessment(uuid,uuid,uuid)'::regprocedure, 'EXECUTE') as anon,
         has_function_privilege('authenticated', 'public.reconcile_collection_assessment(uuid,uuid,uuid)'::regprocedure, 'EXECUTE') as auth`,
    );
    assert.deepEqual(priv.rows[0], { pub: false, anon: false, auth: false });

    // Defense-in-depth test: even if authenticated/anon were hypothetically granted EXECUTE in a misconfigured DB,
    // direct invocation by anon, regular member, or cross-org outsider is rejected by the function guard.
    await db.exec("reset role; grant execute on function public.reconcile_collection_assessment(uuid,uuid,uuid) to anon, authenticated;");

    await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false);");
    await assert.rejects(
      db.query("select public.reconcile_collection_assessment($1, $2, null)", [org.id, created.id]),
      /Unauthorized to reconcile collection assessment/,
    );

    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${memberId}', false);`);
    await assert.rejects(
      db.query("select public.reconcile_collection_assessment($1, $2, null)", [org.id, created.id]),
      /Unauthorized to reconcile collection assessment/,
    );

    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${outsiderId}', false);`);
    await assert.rejects(
      db.query("select public.reconcile_collection_assessment($1, $2, null)", [org.id, created.id]),
      /Unauthorized to reconcile collection assessment/,
    );
  } finally {
    await db.close();
  }
});
