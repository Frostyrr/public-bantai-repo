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

test("PHASE4A-B4: suspended active-role owners denied on direct-query RPCs, helper search_path/grants hardened, and admin analytics RPCs fixed", async () => {
  const db = await createMigratedDb();
  const ownerId = "12000000-0000-4000-8000-000000000001";
  const suspOwnerId = "12000000-0000-4000-8000-000000000002";
  const memberId = "12000000-0000-4000-8000-000000000003";
  const adminId = "12000000-0000-4000-8000-000000000004";

  try {
    await db.exec(`
      insert into auth.users(id, email) values
        ('${ownerId}', 'owner@b4.test'),
        ('${suspOwnerId}', 'susp@b4.test'),
        ('${memberId}', 'member@b4.test'),
        ('${adminId}', 'padmin@b4.test');
      set local app.allow_platform_role_change = 'true';
      update public.profiles set role = 'super_admin' where id = '${adminId}';
      update public.profiles set suspended_at = now() where id = '${suspOwnerId}';
      set local app.allow_platform_role_change = 'false';
      set role authenticated;
      set request.jwt.claim.sub = '${ownerId}';
    `);

    const org = (
      await db.query<{ result: { id: string; invite_code: string } }>(
        "select public.create_typed_organization('Batch4 Org', 'PHP', 'other', '23000000-0000-4000-8000-000000000001') as result",
      )
    ).rows[0].result;

    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    await db.query("select public.join_organization_by_code($1)", [org.invite_code]);

    await db.exec("reset role;");
    await db.query(
      "insert into public.organization_members(organization_id, profile_id, role, status) values ($1, $2, 'owner', 'active')",
      [org.id, suspOwnerId],
    );

    const memberRowId = (
      await db.query<{ id: string }>(
        "select id from public.organization_members where organization_id = $1 and profile_id = $2",
        [org.id, memberId],
      )
    ).rows[0].id;

    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ownerId}';`);
    const budget = (
      await db.query<{ result: { id: string } }>(
        "select public.create_budget($1, 'Test Budget', 10000) as result",
        [org.id],
      )
    ).rows[0].result;
    const collection = (
      await db.query<{ result: { id: string } }>(
        "select public.create_collection($1, 'Test Collection') as result",
        [org.id],
      )
    ).rows[0].result;

    // 1. Suspended user WITH active 'owner' membership row is denied on direct-query RPCs
    await db.exec(`set request.jwt.claim.sub = '${suspOwnerId}';`);
    for (const [sql, params] of [
      ["select public.update_budget($1, $2, 'Hack', 1, null, null, null, 'active')", [org.id, budget.id]],
      ["select public.delete_budget($1, $2)", [org.id, budget.id]],
      ["select public.assign_member_obligation($1, $2, $3, 5000)", [org.id, collection.id, memberRowId]],
      ["select public.set_expense_approval_policy($1, 'owner_admin_self', true)", [org.id]],
      ["select public.transfer_organization_ownership($1, $2, 'member')", [org.id, memberRowId]],
      ["select public.delete_organization($1)", [org.id]],
    ] as const) {
      await assert.rejects(db.query(sql, [...params]));
    }

    // 2. All SECURITY DEFINER functions in public now have search_path configured
    await db.exec("reset role;");
    const missingSearchPath = (
      await db.query<{ proname: string }>(
        `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prosecdef
           and not exists (
             select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
           )`,
      )
    ).rows;
    assert.deepEqual(missingSearchPath, []);

    // 3. Internal-only helpers cannot be executed by anon or authenticated
    const privs = (
      await db.query<{ proname: string; anon_exec: boolean; auth_exec: boolean }>(
        `select p.proname,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('generate_receipt_number', 'recalculate_obligation_status')
         order by p.proname`,
      )
    ).rows;
    for (const row of privs) {
      assert.equal(row.anon_exec, false, `${row.proname} anon execute`);
      assert.equal(row.auth_exec, false, `${row.proname} authenticated execute`);
    }

    // 4. Fixed platform-admin analytics RPCs succeed for active super_admin
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${adminId}';`);
    const uDetails = (await db.query("select public.admin_get_user_details($1) as res", [memberId])).rows[0].res;
    assert.ok(uDetails && typeof uDetails === "object");
    const org360 = (await db.query("select public.admin_get_org_360_extended($1, 7) as res", [org.id])).rows[0].res;
    assert.ok(org360 && typeof org360 === "object");
    const heatmap = (await db.query("select public.admin_get_security_heatmap_filtered(7) as res")).rows[0].res;
    assert.ok(heatmap && typeof heatmap === "object");
  } finally {
    await db.close();
  }
});
