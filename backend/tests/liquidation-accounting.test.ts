import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

test("liquidation-first pilot reserve, budget capacity, reconciliation, and discrepancy resolution", async () => {
  const db = new PGlite();
  const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [owner, admin, org] = [1, 2, 3].map(id);
  const query = (sql: string, args: unknown[] = []) => db.query(sql, args);
  const resultId = async (sql: string, args: unknown[]) =>
    (await db.query<{ result: { id: string } }>(sql, args)).rows[0].result.id;
  const actor = (user: string) => db.exec(`set role authenticated; set request.jwt.claim.sub='${user}'`);
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const file of (await readdir(dir)).filter(file => file.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(dir, file), "utf8"));
    }
    await db.exec(`
      drop function public.workspace_financial_summary(uuid,uuid,uuid);
      drop function public.workspace_budget_totals(uuid,uuid[]);
      drop function public.redacted_transaction_details(uuid,text,uuid,uuid,uuid,uuid,text);
    `);
    await db.exec(await readFile(path.join(dir, "../scripts/production_finance_compatibility_hotfix.sql"), "utf8"));
    await query("insert into auth.users(id) values ($1), ($2)", [owner, admin]);
    await query("insert into organizations(id,name) values ($1,'Pilot')", [org]);
    const membership = (await db.query<{id:string}>(`insert into organization_members(organization_id,profile_id,role)
      values ($1,$2,'organization_admin') returning id`, [org, admin])).rows[0].id;
    await query("insert into organization_members(organization_id,profile_id,role) values ($1,$2,'owner')", [org, owner]);
    await actor(owner);
    const budget = await resultId("select create_budget($1,'Pilot budget',300000) result", [org]);
    await actor(admin);
    const expenses = await Promise.all([150000, 20000].map(amount =>
      resultId("select submit_expense($1,'Pilot expense',$2,'events','2026-11-15',p_budget_id=>$3) result", [org, amount, budget])));
    await actor(owner);
    for (const expense of expenses) {
      await query("select review_expense($1,$2,'verified','Verified',1)", [org, expense]);
      await query("select review_expense($1,$2,'approved','Approved',1)", [org, expense]);
    }
    const launch = () => resultId("select create_cash_advance($1,$2,'Pilot advance','Logistics',100000,'cash',p_budget_id=>$3) result", [org, membership, budget]);
    const settlement = (advance: string, spent: number, returned: number) =>
      resultId("select submit_liquidation($1,$2,$3,$4,'Recorded') result", [org, advance, spent, returned]);
    const approve = (liquidation: string) => query("select review_liquidation($1,$2,'approved','Reviewed')", [org, liquidation]);
    const budgetTotals = async () => (await query("select spent::int, committed::int, provisional from workspace_budget_totals($1,array[$2::uuid])", [org,budget])).rows[0];
    const advanceTotals = async (advance: string) => {
      await db.exec("reset role");
      try { return (await db.query<{released:number;spent:number;returned:number;overlap:number;discrepancy:number;loss:number}>(`select released::int, spent::int, returned::int, overlap::int, discrepancy::int, loss::int
      from advance_accounting where id=$1`, [advance])).rows[0]; } finally { await actor(owner); }
    };
    const reserve = (a: Awaited<ReturnType<typeof advanceTotals>>) => 210000 - (170000 - a.overlap) - a.released + a.returned;

    const advance = await launch();
    assert.equal(reserve(await advanceTotals(advance)), -60000);
    assert.deepEqual(await budgetTotals(), { spent: 170000, committed: 100000, provisional: false });
    await actor(admin);
    const liquidation = await settlement(advance, 60000, 40000);
    await actor(owner);
    await approve(liquidation);
    const projection = async () => (await query(
      "select redacted_transaction_details($1,'advance',$2) as result", [org, advance]
    )).rows[0].result;
    assert.equal(await projection(), null);
    await actor(admin);
    const redacted = await projection() as Record<string, unknown>[];
    assert.equal(redacted.length, 1);
    assert.deepEqual(redacted[0].liquidations, [
      { status: "approved", total_spent_centavos: 60000, total_returned_centavos: 40000 }
    ]);
    await actor(owner);
    const posted = await advanceTotals(advance);
    assert.equal(reserve(posted), -20000);
    assert.equal(170000 + posted.spent - posted.overlap, 230000);
    assert.deepEqual(await budgetTotals(), { spent: 230000, committed: 0, provisional: true });

    const { rows: [{ summary }] } = await db.query<{ summary: Record<string, number> }>(
      "select workspace_financial_summary($1) as summary", [org]);
    assert.equal(summary.total_expenses_centavos, 230000);
    assert.equal(summary.reserve_balance_centavos, -230000);
    assert.equal(summary.approved_liquidation_spending_centavos, 60000);
    const { rows: budgetProjection } = await db.query(
      "select spent::int, committed::int, provisional from workspace_budget_totals($1,array[$2::uuid])",
      [org, budget]);
    assert.deepEqual(budgetProjection, [await budgetTotals()]);

    const confirm = (id: string, links: object[]) => query(
      "select confirm_liquidation_reconciliation($1,$2,$3::jsonb,'Reviewed historical expenses')", [org, id, JSON.stringify(links)]);
    await assert.rejects(confirm(liquidation, [{ expense_id: expenses[1], amount_centavos: 20001 }]), /exceeds/);
    const links = [{ expense_id: expenses[0], amount_centavos: 10000 }, { expense_id: expenses[1], amount_centavos: 15000 }];
    await confirm(liquidation, links);
    await confirm(liquidation, links);
    assert.deepEqual(await budgetTotals(), { spent: 205000, committed: 0, provisional: false });
    assert.equal((await advanceTotals(advance)).overlap, 25000);

    const advanceWithShortage = await launch();
    await actor(admin);
    const shortage = await settlement(advanceWithShortage, 60000, 20000);
    await actor(owner);
    await approve(shortage);
    await assert.rejects(confirm(shortage, [{ expense_id: expenses[1], amount_centavos: 5001 }]), /exceeds/);
    await confirm(shortage, []);
    const resolve = (entry: number, kind: string, amount: number, reversal?: number) => query(
      "select record_liquidation_resolution($1,$2,$3,$4,$5,'Documented resolution',$6)",
      [org, shortage, id(entry), kind, amount, reversal ? id(reversal) : null]);
    await resolve(20, "recovery", 5000);
    await resolve(20, "recovery", 5000);
    await resolve(21, "write_off", 15000);
    await assert.rejects(resolve(22, "recovery", 1), /exceeds/);
    const resolved = await advanceTotals(advanceWithShortage);
    assert.equal(resolved.returned, 25000);
    assert.equal(resolved.loss, 15000);
    assert.equal(resolved.discrepancy, 0);
    await resolve(23, "write_off", -15000, 21);
    assert.equal((await advanceTotals(advanceWithShortage)).discrepancy, 15000);
    assert.equal((await advanceTotals(advanceWithShortage)).returned, 25000);
  } finally {
    await db.close();
  }
});
