import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

test("archived space assignments and closed workspace writes are blocked at the database", async () => {
  const db = new PGlite();
  const owner = "91000000-0000-4000-8000-000000000001";
  const foreign = "91000000-0000-4000-8000-000000000002";
  const org = "91000000-0000-4000-8000-000000000003";
  const query = (sql: string, args: unknown[] = []) => db.query(sql, args);
  const login = (id: string) => db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'`);
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;`);
    await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(dir, file), "utf8"));
    }
    await query("insert into auth.users(id) values ($1),($2)", [owner, foreign]);
    await query("insert into organizations(id,name) values ($1,'Archive pilot')", [org]);
    await query("insert into organization_members(organization_id,profile_id,role) values ($1,$2,'owner')", [org, owner]);
    await login(owner);
    const { rows: [{ id: usageConversation }] } = await db.query<{id: string}>(
      "insert into ai_conversations(organization_id,created_by,title) values ($1,$2,'Usage fixture') returning id", [org, owner]);
    async function recordUsage(organizationId: string, conversationId: string, key: string) {
      return (await db.query<{ id: string | null }>(
        "select record_ai_usage_log($1,$2,'synthetic',11,7,18,10,1,'success',null,$3) as id",
        [organizationId, conversationId, key])).rows[0].id;
    }
    const usageId = await recordUsage(org, usageConversation, "usage-fixture-request");
    assert.ok(usageId);
    const anonymousUsage = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('anon','public.record_ai_usage_log(uuid,uuid,text,integer,integer,integer,integer,integer,text,text,text)','EXECUTE') as allowed");
    assert.equal(anonymousUsage.rows[0].allowed, false);
    assert.equal(await recordUsage(org, usageConversation, "usage-fixture-request"), usageId);
    assert.equal(await recordUsage(org, foreign, "invalid-conversation"), null);
    await login(foreign);
    assert.equal(await recordUsage(org, usageConversation, "usage-fixture-request"), null);
    await login(owner);
    const { rows: [{ id: space }] } = await db.query<{ id: string }>(
      "select create_space($1,'Pilot project',null)->>'id' as id", [org]);
    const { rows: [{ id: snapshot }] } = await db.query<{ id: string }>(
      "select publish_financial_snapshot($1) as id", [org]);
    await db.exec("set role anon");
    const published = await query("select * from read_published_financial_snapshot($1)", [snapshot]);
    assert.equal(published.rows.length, 1);
    assert.deepEqual(Object.keys(published.rows[0]).sort(), [
      "approved_at", "collected_centavos", "currency", "recognized_spending_centavos", "reserve_centavos",
    ]);
    await login(foreign);
    await assert.rejects(query("select withdraw_financial_snapshot($1,$2)", [org, snapshot]), /owner/i);
    await login(owner);
    assert.deepEqual((await query("select withdraw_financial_snapshot($1,$2) as withdrawn", [org, snapshot])).rows,
      [{ withdrawn: true }]);
    await db.exec("set role anon");
    assert.deepEqual((await query("select * from read_published_financial_snapshot($1)", [snapshot])).rows, []);
    await login(owner);
    const createCollection = () => query("select create_collection($1,'Dues',p_space_id=>$2)", [org, space]);
    await createCollection();
    await query("select update_space($1,$2,'Pilot project',null,'archived')", [org, space]);
    await assert.rejects(createCollection(), /active space/i);
    await assert.rejects(query("select submit_expense($1,'New expense',100,'events','2026-11-15',p_space_id=>$2)", [org, space]), /active space/i);
    await assert.rejects(query("select create_budget($1,'New budget',10000,p_space_id=>$2)", [org, space]), /active space/i);
    assert.equal((await query("select id from collections where space_id=$1", [space])).rows.length, 1);
    await login(foreign);
    assert.equal((await query("select id from collections where space_id=$1", [space])).rows.length, 0);
    await assert.rejects(query("select delete_organization($1)", [org]), /owner/i);
    await login(owner);
    const { rows: [{ id: active }] } = await db.query<{ id: string }>(
      "select create_space($1,'Release project',null)->>'id' as id", [org]);
    const { rows: [{ id: period }] } = await db.query<{ id: string }>(
      "select create_reporting_period($1,'Release period','2026-01-01','2026-12-31',false)->>'id' as id", [org]);
    await db.exec("reset role");
    await query("insert into organization_members(organization_id,profile_id,role) values ($1,$2,'member')", [org, foreign]);
    await login(foreign);
    const { rows: [{ id: request }] } = await db.query<{ id: string }>(
      "select (manage_cash_advance_request($1,null,'create',$2)).id",
      [org, { title: "Scoped request", purpose: "Pilot logistics", amountCentavos: 100 }]);
    await assert.rejects(query("select manage_cash_advance_request($1,$2,'release',$3)", [org, request, { revision: 1, method: "cash" }]), /unavailable/i);
    await login(owner);
    await query("select manage_cash_advance_request($1,$2,'approve',$3)", [org, request, { revision: 1 }]);
    const release = (spaceId: string, periodId: string) => query("select manage_cash_advance_request($1,$2,'release',$3)",
      [org, request, { revision: 2, method: "cash", spaceId, periodId }]);
    const otherOrg = "91000000-0000-4000-8000-000000000004";
    await db.exec("reset role");
    await query("insert into organizations(id,name) values ($1,'Foreign scope')", [otherOrg]);
    const { rows: [{ id: foreignSpace }] } = await db.query<{ id: string }>(
      "insert into spaces(organization_id,name) values ($1,'Foreign active space') returning id", [otherOrg]);
    await login(owner);
    await assert.rejects(release(space, period), /active space/i);
    await assert.rejects(release(foreignSpace, period), /active space/i);
    assert.equal((await query("select id from spaces where id=$1", [foreignSpace])).rows.length, 0);
    await assert.rejects(release(active, foreign), /reporting period/i);
    await release(active, period);
    await assert.rejects(release(active, period), /changed/i);
    const released = await db.query<{ id: string; space_id: string; reporting_period_id: string }>(
      "select id,space_id,reporting_period_id from cash_advances where organization_id=$1", [org]);
    assert.deepEqual(released.rows.map(({ space_id, reporting_period_id }) => [space_id, reporting_period_id]), [[active, period]]);
    const unrelated = "91000000-0000-4000-8000-000000000066";
    await db.exec("reset role");
    await query("insert into auth.users(id) values ($1)", [unrelated]);
    await query("insert into organization_members(organization_id,profile_id,role) values ($1,$2,'member')", [org, unrelated]);
    await login(unrelated);
    await assert.rejects(query("select submit_liquidation($1,$2,0,100,'Unrelated submission')",
      [org, released.rows[0].id]), /accountable member/i);
    await login(foreign);
    const { rows: [{ id: liquidation }] } = await db.query<{ id: string }>(
      "select submit_liquidation($1,$2,0,100,'Full return')->>'id' as id", [org, released.rows[0].id]);
    await login(owner);
    await query("select review_liquidation($1,$2,'approved','Full return')", [org, liquidation]);
    await db.exec("reset role");
    await query("update organization_members set role='treasurer' where organization_id=$1 and profile_id=$2", [org, foreign]);
    await login(foreign);
    const { rows: [{ id: thread }] } = await db.query<{ id: string }>(
      "insert into ai_conversations(organization_id,created_by,title) values ($1,$2,'Private treasury') returning id",
      [org, foreign]);
    await query("insert into ai_messages(conversation_id,role,content) values ($1,'assistant','Sensitive synthetic result')", [thread]);
    assert.equal((await query("select id from ai_messages where conversation_id=$1", [thread])).rows.length, 1);
    await login(owner);
    assert.equal((await query("select id from ai_messages where conversation_id=$1", [thread])).rows.length, 0);
    await db.exec("reset role");
    await query("update organization_members set role='member' where organization_id=$1 and profile_id=$2", [org, foreign]);
    await login(foreign);
    assert.equal((await query("select title from ai_conversations where id=$1", [thread])).rows.length, 0);
    assert.equal((await query("select content from ai_messages where conversation_id=$1", [thread])).rows.length, 0);
    await login(owner);
    const { rows: [{ id: pending }] } = await db.query<{ id: string }>(
      "select submit_expense($1,'Private pending expense',100,'events','2026-11-15')->>'id' as id", [org]);
    await login(foreign);
    assert.equal((await query("select id from expenses where id=$1", [pending])).rows.length, 0);
    assert.deepEqual((await query(
      "select redacted_transaction_details($1,'expense',$2) as rows", [org, pending])).rows,
      [{ rows: [] }]);
    const { rows: [{ details }] } = await db.query<{ details: Record<string, unknown>[] }>(
      "select redacted_transaction_details($1,'advance') as details", [org]);
    assert.equal(details.length, 1);
    assert.doesNotMatch(JSON.stringify(details), /reference_number|review_notes|reconciliation_notes|accountable_person_id|submitted_by/);
    await db.exec("reset role");
    await query("update organization_members set can_submit_expenses=true where organization_id=$1 and profile_id=$2", [org, foreign]);
    await login(foreign);
    const { rows: [{ id: ownPending }] } = await db.query<{ id: string }>(
      "select submit_expense($1,'My pending expense',100,'events','2026-11-15')->>'id' as id", [org]);
    for (const status of ["pending", "rejected"]) {
      if (status === "rejected") {
        await login(owner);
        await query("select review_expense($1,$2,'rejected','Synthetic private review',1)", [org, ownPending]);
        await login(foreign);
      }
      const { rows: [{ visible }] } = await db.query<{ visible: { id: string; status: string }[] }>(
        "select redacted_transaction_details($1,'expense',$2) as visible", [org, ownPending]);
      assert.equal(visible[0].status, status);
      assert.doesNotMatch(JSON.stringify(visible), /receipt_url|review_notes|example.invalid/);
    }
    await assert.rejects(query(
      "select review_expense_with_private_result($1,$2,'rejected',null,1)", [org, pending]), /permission denied/i);
    await db.exec("reset role");
    await query("update profiles set suspended_at=now() where id=$1", [foreign]);
    await login(foreign);
    await assert.rejects(query(
      "select review_expense($1,$2,'verified',null,1)", [org, pending]), /Active workspace access required/i);
    await assert.rejects(query(
      "select confirm_liquidation_reconciliation($1,$2,'[]','Suspended check')", [org, liquidation]),
      /authorization required/i);
    await assert.rejects(query(
      "select create_collection($1,'Suspended write')", [org]), /Unauthorized|Active workspace access required/i);
    assert.deepEqual((await query("select redacted_transaction_details($1,'expense') as records", [org])).rows, [{ records: [] }]);
    assert.deepEqual((await query("select workspace_financial_summary($1) as summary", [org])).rows, [{ summary: null }]);
    await db.exec("reset role");
    await query("update profiles set suspended_at=null where id=$1", [foreign]);
    await login(foreign);
    const personal = await db.query<{ rows: { status: string; id: string }[] }>(
      "select redacted_transaction_details($1,'expense') as rows", [org]);
    assert.ok(personal.rows[0].rows.every(row => row.id !== pending));
    await assert.rejects(query("select read_expense_evidence($1,$2)", [org, pending]), /unavailable/i);
    await db.exec("reset role");
    for (const role of ["organization_admin", "treasurer"]) {
      await query("update organization_members set role=$3 where organization_id=$1 and profile_id=$2", [org, foreign, role]);
      await login(foreign);
      if (role === "organization_admin") {
        await assert.rejects(query(
          "select update_member_role((select id from organization_members where organization_id=$1 and profile_id=$2),'owner')",
          [org, foreign]), /Only owners can grant or change ownership/);
      }
      if (role === "treasurer") await query("select read_expense_evidence($1,$2)", [org, pending]);
      else await assert.rejects(query("select read_expense_evidence($1,$2)", [org, pending]), /unavailable/i);
      await db.exec("reset role");
    }
    await login(owner);
    await query("select read_expense_evidence($1,$2)", [org, pending]);
    const departed = "91000000-0000-4000-8000-000000000055";
    await db.exec("reset role");
    await query("insert into auth.users(id) values ($1)", [departed]);
    await query("insert into organization_members(organization_id,profile_id,role,status) values ($1,$2,'member','left')", [org, departed]);
    await query("update organization_members set role='member' where organization_id=$1 and profile_id=$2", [org, foreign]);
    await login(owner);
    await query("select delete_organization($1)", [org]);
    assert.equal((await query("select id from collections where space_id=$1", [space])).rows.length, 0);
    await login(foreign);
    const history = () => query("select closed_transaction_history($1,'expense') as records", [org]);
    assert.match(JSON.stringify((await history()).rows), /My pending expense/);
    assert.doesNotMatch(JSON.stringify((await history()).rows), /receipt_url|review_notes|Private pending expense/);
    await assert.rejects(query("select revoke_workspace_history($1,$2)", [org, owner]), /unavailable/);
    await assert.rejects(query("select create_collection($1,'Forbidden')", [org]), /Unauthorized|closed/i);
    await login(departed);
    assert.deepEqual((await history()).rows, [{ records: [] }]);
    await login(owner);
    await query("select revoke_workspace_history($1,$2)", [org, foreign]);
    await login(foreign);
    assert.deepEqual((await history()).rows, [{ records: [] }]);
    await db.exec("reset role");
    assert.equal((await query("select id from collections where space_id=$1", [space])).rows.length, 1);
    await assert.rejects(query("update organizations set name='Changed' where id=$1", [org]), /closed/i);
    await assert.rejects(query("update organization_members set status='active' where organization_id=$1", [org]), /closed/i);
    await assert.rejects(query("update collections set title='Changed' where organization_id=$1", [org]), /closed/i);
    assert.equal((await query("select id from audit_logs where organization_id=$1 and action='organization_closed'", [org])).rows.length, 1);
  } finally {
    await db.close();
  }
});
