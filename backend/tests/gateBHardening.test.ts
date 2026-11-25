import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

async function createMigratedDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
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

test("PHASE4A-B3: Gate B RPCs enforce suspension/closure, NULL NOT IN role checks, search_path, and internal-only privileges", async () => {
  const db = await createMigratedDb();
  const ownerId = "11000000-0000-4000-8000-000000000001";
  const officerId = "11000000-0000-4000-8000-000000000002";
  const outsiderId = "11000000-0000-4000-8000-000000000003";
  const platformAdminId = "11000000-0000-4000-8000-000000000004";

  try {
    await db.exec(`
      insert into auth.users(id, email) values
        ('${ownerId}', 'owner@example.com'),
        ('${officerId}', 'officer@example.com'),
        ('${outsiderId}', 'outsider@example.com'),
        ('${platformAdminId}', 'padmin@example.com');
      set local app.allow_platform_role_change = 'true';
      update public.profiles set role = 'super_admin' where id = '${platformAdminId}';
      set local app.allow_platform_role_change = 'false';
      set role authenticated;
      set request.jwt.claim.sub = '${ownerId}';
    `);

    const org = (
      await db.query<{ result: { id: string; invite_code: string } }>(
        "select public.create_typed_organization('GateB Org', 'PHP', 'other', '22000000-0000-4000-8000-000000000001') as result",
      )
    ).rows[0].result;

    await db.exec(`set request.jwt.claim.sub = '${officerId}';`);
    await db.query("select public.join_organization_by_code($1)", [org.invite_code]);

    await db.exec("reset role;");
    await db.query(
      "update public.organization_members set role = 'organization_admin' where organization_id = $1 and profile_id = $2",
      [org.id, officerId],
    );

    // 1. Outsider (NULL v_role) must be denied on NULL-NOT-IN-vulnerable RPCs and cause zero mutation
    await db.exec(`set request.jwt.claim.sub = '${outsiderId}';`);
    for (const [sql, params] of [
      ["select public.regenerate_invite_code($1)", [org.id]],
      ["select public.update_organization($1, 'Hijacked', 'USD')", [org.id]],
      ["select public.update_organization_cover($1, 'https://evil.test/cover.png', 'red')", [org.id]],
      ["select public.update_organization_logo($1, 'https://evil.test/logo.png')", [org.id]],
    ] as const) {
      await assert.rejects(db.query(sql, [...params]));
    }
    const aiOut = (
      await db.query<{ id: string | null }>(
        "select public.record_ai_usage_log($1, null, 'gpt', 1, 1, 2, 10, 0, 'success', null, 'req-outsider') as id",
        [org.id],
      )
    ).rows[0].id;
    assert.equal(aiOut, null);

    await db.exec("reset role;");
    const orgRow = (
      await db.query<{ name: string; invite_code: string; logo_url: string | null }>(
        "select name, invite_code, logo_url from public.organizations where id = $1",
        [org.id],
      )
    ).rows[0];
    assert.equal(orgRow.name, "GateB Org");
    assert.equal(orgRow.invite_code, org.invite_code);
    assert.equal(orgRow.logo_url, null);

    // 2. Active owner succeeds on check_ai_workspace_quota and check_org_deletability
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ownerId}';`);
    const quota = (
      await db.query<{ result: { allowed: boolean } }>(
        "select public.check_ai_workspace_quota($1) as result",
        [org.id],
      )
    ).rows[0].result;
    assert.equal(quota.allowed, true);

    const deletable = (
      await db.query<{ result: { is_deletable: boolean } }>(
        "select public.check_org_deletability($1) as result",
        [org.id],
      )
    ).rows[0].result;
    assert.equal(deletable.is_deletable, true);

    // 3. Suspended officer is denied by helpers & all workspace/financial/directory RPCs
    await db.exec(`reset role; update public.profiles set suspended_at = now() where id = '${officerId}'; set role authenticated; set request.jwt.claim.sub = '${officerId}';`);
    const helperChecks = (
      await db.query<{ officer: boolean; admin: boolean; comember: boolean; dir: boolean }>(
        `select
           public.is_org_officer($1, $2) as officer,
           public.is_org_admin($1, $2) as admin,
           public.is_org_comember($3, $2) as comember,
           public.has_directory_capability($1, 'view') as dir`,
        [org.id, officerId, ownerId],
      )
    ).rows[0];
    assert.deepEqual(helperChecks, { officer: false, admin: false, comember: false, dir: false });

    for (const [sql, params] of [
      ["select public.create_budget($1, 'Suspended Budget', 10000)", [org.id]],
      ["select public.create_collection($1, 'Suspended Collection')", [org.id]],
      ["select public.submit_expense($1, 'Suspended Expense', 1000, 'events', '2026-11-15')", [org.id]],
      ["select public.update_organization_profile($1, 'Susp', 'PHP', 'desc')", [org.id]],
      ["select public.emit_notifications(array[$2]::uuid[], $1, 'general', 'Hi', 'Body')", [org.id, ownerId]],
    ] as const) {
      await assert.rejects(db.query(sql, [...params]));
    }

    // 4. Suspended platform admin is denied by is_platform_admin and admin_* RPCs
    await db.exec(`reset role; update public.profiles set suspended_at = now() where id = '${platformAdminId}'; set role authenticated; set request.jwt.claim.sub = '${platformAdminId}';`);
    const isPa = (
      await db.query<{ v: boolean }>("select public.is_platform_admin(false) as v")
    ).rows[0].v;
    assert.equal(isPa, false);
    await assert.rejects(db.query("select public.admin_set_session_timeout(60, 'audit')"));

    // 5. The 5 hardened financial SECURITY DEFINER RPCs have search_path configured
    await db.exec("reset role;");
    const missingSearchPath = (
      await db.query<{ proname: string }>(
        `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prosecdef
           and p.proname in ('create_budget', 'create_cash_advance', 'create_collection', 'reverse_payment', 'submit_expense')
           and not exists (
             select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
           )`,
      )
    ).rows;
    assert.deepEqual(missingSearchPath, []);

    // 6. Internal-only functions cannot be executed by anon or authenticated
    const internalPrivs = (
      await db.query<{ proname: string; anon_exec: boolean; auth_exec: boolean }>(
        `select p.proname,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('review_expense_internal', 'lock_liquidation_accounting')
         order by p.proname`,
      )
    ).rows;
    for (const row of internalPrivs) {
      assert.equal(row.anon_exec, false, `${row.proname} anon execute`);
      assert.equal(row.auth_exec, false, `${row.proname} authenticated execute`);
    }
  } finally {
    await db.close();
  }
});
