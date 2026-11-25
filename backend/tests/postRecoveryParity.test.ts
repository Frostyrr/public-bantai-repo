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

test("PHASE4A-B2: 026 raw-read RLS, accounting-view revocations, audit redaction, liquidation join, and anon grant restrictions", async () => {
  const db = await createMigratedDb();
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const treasurerId = "10000000-0000-4000-8000-000000000002";
  const adminId = "10000000-0000-4000-8000-000000000003";
  const memberId = "10000000-0000-4000-8000-000000000004";
  const outsiderId = "10000000-0000-4000-8000-000000000005";

  try {
    await db.exec(`
      insert into auth.users(id, email) values
        ('${ownerId}', 'owner@example.com'),
        ('${treasurerId}', 'treasurer@example.com'),
        ('${adminId}', 'admin@example.com'),
        ('${memberId}', 'member@example.com'),
        ('${outsiderId}', 'outsider@example.com');
      set role authenticated;
      set request.jwt.claim.sub = '${ownerId}';
    `);

    const org = (
      await db.query<{ result: { id: string; invite_code: string } }>(
        "select public.create_typed_organization('Batch2 Org', 'PHP', 'other', '20000000-0000-4000-8000-000000000001') as result",
      )
    ).rows[0].result;

    for (const uid of [treasurerId, adminId, memberId]) {
      await db.exec(`set request.jwt.claim.sub = '${uid}';`);
      await db.query("select public.join_organization_by_code($1)", [org.invite_code]);
    }

    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const members = (
      await db.query<{ id: string; profile_id: string }>(
        "select id, profile_id from public.organization_members where organization_id = $1",
        [org.id],
      )
    ).rows;
    const memberRow = (uid: string) => members.find((m) => m.profile_id === uid)!.id;

    await db.query("select public.update_member_role($1, 'treasurer')", [memberRow(treasurerId)]);
    await db.query("select public.update_member_role($1, 'organization_admin')", [memberRow(adminId)]);

    // Seed budget, expense, and liquidated cash advance
    const budgetId = (
      await db.query<{ result: { id: string } }>(
        "select public.create_budget($1, 'Ops Budget', 100000) as result",
        [org.id],
      )
    ).rows[0].result.id;

    const expenseId = (
      await db.query<{ result: { id: string } }>(
        "select public.submit_expense($1, 'Secret Vendor Receipt', 25000, 'supplies', '2026-11-15', 'Private description', $2, null, null) as result",
        [org.id, budgetId],
      )
    ).rows[0].result.id;
    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    await db.query("select public.review_expense($1, $2, 'verified', 'Admin verified', 1)", [org.id, expenseId]);
    await db.query("select public.review_expense($1, $2, 'approved', 'Admin approved', 1)", [org.id, expenseId]);
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);

    const advId = (
      await db.query<{ result: { id: string } }>(
        "select public.create_cash_advance($1, $2, 'Event Advance', 'Private purpose', 50000, 'cash', 'REF-01', $3, null, null) as result",
        [org.id, memberRow(memberId), budgetId],
      )
    ).rows[0].result.id;

    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    const liqId = (
      await db.query<{ result: { id: string } }>(
        "select public.submit_liquidation($1, $2, 30000, 20000, 'Member receipts') as result",
        [org.id, advId],
      )
    ).rows[0].result.id;

    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    await db.query("select public.review_liquidation($1, $2, 'approved', 'Settled')", [org.id, liqId]);

    // 1. Verify 7 private_financial_rows policies and raw-read isolation
    const policyCount = (
      await db.query<{ count: string }>(
        "select count(*)::text as count from pg_policies where schemaname = 'public' and policyname = 'private_financial_rows'",
      )
    ).rows[0].count;
    assert.equal(policyCount, "7");

    for (const [label, uid, expectedRows] of [
      ["owner", ownerId, 1],
      ["treasurer", treasurerId, 1],
      ["admin", adminId, 0],
      ["member", memberId, 0],
      ["outsider", outsiderId, 0],
    ] as const) {
      await db.exec(`set request.jwt.claim.sub = '${uid}';`);
      const expRows = (await db.query("select id from public.expenses where organization_id = $1", [org.id])).rows;
      assert.equal(expRows.length, expectedRows, `${label} raw expenses select`);
      const advRows = (await db.query("select id from public.cash_advances where organization_id = $1", [org.id])).rows;
      assert.equal(advRows.length, expectedRows, `${label} raw cash_advances select`);
    }

    // 2. Accounting views must deny direct SELECT to authenticated and anon
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    await assert.rejects(db.query("select * from public.advance_accounting"), /permission denied/);
    await assert.rejects(db.query("select * from public.budget_accounting"), /permission denied/);

    await db.exec("set role anon; reset request.jwt.claim.sub;");
    await assert.rejects(db.query("select * from public.advance_accounting"), /permission denied/);
    await assert.rejects(db.query("select * from public.budget_accounting"), /permission denied/);

    // 3. Audit log payload redaction for Admin vs Owner/Treasurer
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ownerId}';`);
    const ownerLogs = (
      await db.query<{ before_value: unknown; after_value: unknown }>(
        "select before_value, after_value from public.get_organization_audit_logs($1, 20, 0)",
        [org.id],
      )
    ).rows;
    assert.ok(ownerLogs.some((l) => l.after_value !== null));

    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    const adminLogs = (
      await db.query<{ before_value: unknown; after_value: unknown }>(
        "select before_value, after_value from public.get_organization_audit_logs($1, 20, 0)",
        [org.id],
      )
    ).rows;
    assert.ok(adminLogs.length > 0);
    assert.ok(adminLogs.every((l) => l.before_value === null && l.after_value === null));

    // 4. Recovered finance RPCs & liquidation join predicate
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const summary = (
      await db.query<{ s: { total_expenses_centavos: number; reserve_balance_centavos: number } }>(
        "select public.workspace_financial_summary($1) as s",
        [org.id],
      )
    ).rows[0].s;
    assert.equal(summary.total_expenses_centavos, 55000);
    assert.equal(summary.reserve_balance_centavos, -55000);

    const budgetTotals = (
      await db.query<{ id: string; spent: string }>(
        "select id, spent::text from public.workspace_budget_totals($1, $2::uuid[])",
        [org.id, [budgetId]],
      )
    ).rows;
    assert.equal(budgetTotals.length, 1);
    assert.equal(Number(budgetTotals[0].spent), 55000);

    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    const redactedAdvances = (
      await db.query<{ data: Array<{ id: string; title: string; liquidations: Array<{ total_spent_centavos: number; total_returned_centavos: number }> }> }>(
        "select public.redacted_transaction_details($1, 'advance') as data",
        [org.id],
      )
    ).rows[0].data;
    assert.equal(redactedAdvances.length, 1);
    assert.equal(redactedAdvances[0].title, "Settled advance");
    assert.equal(redactedAdvances[0].liquidations[0].total_spent_centavos, 30000);
    assert.equal(redactedAdvances[0].liquidations[0].total_returned_centavos, 20000);

    // 5. Close org and verify closed_transaction_history preserves liquidation join predicate
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    await db.query("select public.delete_organization($1)", [org.id]);
    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    const closedAdvances = (
      await db.query<{ data: Array<{ id: string; title: string; liquidations: Array<{ total_spent_centavos: number }> }> }>(
        "select public.closed_transaction_history($1, 'advance') as data",
        [org.id],
      )
    ).rows[0].data;
    assert.equal(closedAdvances.length, 1);
    assert.equal(closedAdvances[0].liquidations[0].total_spent_centavos, 30000);

    // 6. Verify anon cannot execute any non-allowlisted SECURITY DEFINER RPC
    const anonSecDef = (
      await db.query<{ sig: string }>(`
        select p.oid::regprocedure::text as sig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef = true
          and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by 1
      `)
    ).rows.map((r) => r.sig);
    assert.deepEqual(anonSecDef, [
      "check_source_restriction(text)",
      "read_published_financial_snapshot(uuid)",
    ]);
  } finally {
    await db.close();
  }
});
