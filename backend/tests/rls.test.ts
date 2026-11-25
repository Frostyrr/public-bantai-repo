import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

test("identity migration enforces tenant isolation, denies client writes, and audits changes", async () => {
  const db = new PGlite();
  try {
    // Minimal equivalents of Supabase's pre-provisioned roles and Auth identity.
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611120001_identity_organizations.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611120002_profile_display_name.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611120003_self_service_organizations.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611120004_reporting_periods_and_spaces.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611120005_collections_and_payments.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611120006_budgets_expenses_approvals.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611120007_cash_advances_and_liquidation.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611120008_audit_logs_and_reports.sql"), "utf8"));
    for (const migration of [
      '202611120009_expenses_profiles_fkey.sql',
      '202611120010_edit_and_delete_operations.sql',
      '202611120011_member_names_and_org_logos.sql',
      '202611120012_independent_financial_review.sql',
      '202611120013_account_settings_and_preferences.sql',
      '202611120014_org_ownership_and_deletion.sql',
      '202611130001_ask_bantai_conversations.sql',
      '202611130004_member_directory.sql',
      '202611130005_directory_fields.sql',
      '202611130006_directory_groups.sql',
      '202611130015_directory_configuration_audit.sql',
      '202611130016_directory_field_replacement.sql',
      '202611130007_directory_import.sql',
    ]) await db.exec(await readFile(path.resolve(__dirname, '../../supabase/migrations', migration), 'utf8'));
    const user = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const ownOrg = "33333333-3333-4333-8333-333333333333";
    const foreignOrg = "44444444-4444-4444-8444-444444444444";
    await db.exec(`
      insert into auth.users (id, raw_user_meta_data) values
        ('${user}', '{"display_name": "Test User"}'::jsonb),
        ('${other}', '{"full_name": "Other User"}'::jsonb);
      insert into public.organizations(id, name) values ('${ownOrg}', 'Own'), ('${foreignOrg}', 'Other');
      insert into public.organization_members(organization_id, profile_id, role)
      values ('${ownOrg}', '${user}', 'member'), ('${foreignOrg}', '${other}', 'treasurer');
    `);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    assert.deepEqual((await db.query("select id, display_name from public.profiles")).rows, [{ id: user, display_name: "Test User" }]);
    assert.deepEqual((await db.query("select id from public.organizations")).rows, [{ id: ownOrg }]);
    assert.equal((await db.query("select * from public.organization_members")).rows.length, 1);
    await assert.rejects(db.exec("update public.organization_members set role = 'organization_admin'"), /permission denied/);
    await assert.rejects(db.exec("insert into public.organizations(name) values ('Unauthorized')"), /permission denied/);
    await assert.rejects(db.exec("delete from public.audit_logs"), /permission denied/);
    await assert.rejects(db.exec("select * from public.audit_logs"), /permission denied/);

    // Test atomic self-service organization creation with owner role
    const createResult = await db.query("select public.create_organization_with_owner('Self Service Org', 'PHP') as result");
    const createdOrg = (createResult.rows[0] as { result: { id: string; name: string; currency: string; invite_code: string; role: string } }).result;
    assert.equal(createdOrg.name, "Self Service Org");
    assert.equal(createdOrg.role, "owner");
    assert.equal(createdOrg.currency, "PHP");
    assert.ok(createdOrg.invite_code);

    await db.exec(`insert into public.organization_directory_members (organization_id, display_name, member_code)
      values ('${createdOrg.id}', 'Offline Member', '0012'), ('${createdOrg.id}', 'Offline Member', null)`);
    assert.equal((await db.query("select id from public.organization_directory_members")).rows.length, 2);
    assert.equal((await db.query(`select id from public.organization_members where organization_id = '${createdOrg.id}'`)).rows.length, 1);
    assert.equal((await db.query(`select id from public.obligations where organization_id = '${createdOrg.id}'`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into public.organization_directory_members (organization_id, display_name)
      values ('${foreignOrg}', 'Cross-tenant write')`), /row-level security/);
    await assert.rejects(db.exec(`insert into public.organization_directory_members (organization_id, display_name, member_code)
      values ('${createdOrg.id}', 'Duplicate code', ' 0012 ')`), /duplicate key/);
    await db.exec(`update public.organization_directory_members set status = 'archived' where member_code = '0012'`);
    assert.equal((await db.query("select member_code from public.organization_directory_members where status = 'archived'")).rows.length, 1);
    await db.exec(`insert into public.directory_field_definitions (organization_id, key, label, kind)
      values ('${createdOrg.id}', 'student_id', 'Student ID', 'text')`);
    await db.exec(`update public.organization_directory_members set attributes = '{"student_id":"0007"}' where member_code = '0012'`);
    await assert.rejects(db.exec(`update public.organization_directory_members set attributes = '{"student_id":7}' where member_code = '0012'`), /Invalid custom attribute/);
    await db.exec(`update public.directory_field_definitions set label = 'School ID' where key = 'student_id'`);
    await db.exec("reset role");
    const fieldAudit = await db.query(`select after_value->>'label' as label from public.audit_logs
      where organization_id = '${createdOrg.id}' and action = 'directory_field_definitions.update'`);
    assert.deepEqual(fieldAudit.rows, [{ label: "School ID" }]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`);
    assert.deepEqual((await db.query(`select attributes from public.organization_directory_members where member_code = '0012'`)).rows,
      [{ attributes: { student_id: "0007" } }]);

    await db.exec("begin");
    const expectedFields = '[{"key":"student_id","label":"School ID","kind":"text","options":[]}]';
    await db.query(`select public.change_directory_field_set('${createdOrg.id}', $1,
      '[{"key":"student_id","label":"Student ID","kind":"text","options":[]},
        {"key":"department","label":"Department","kind":"text","options":[]}]', null)`, [expectedFields]);
    assert.deepEqual((await db.query("select attributes from public.organization_directory_members where member_code = '0012'")).rows,
      [{ attributes: { student_id: "0007" } }]);
    await db.exec("savepoint stale_fields");
    await assert.rejects(db.query(`select public.change_directory_field_set('${createdOrg.id}', $1, null, 'student_id')`, [expectedFields]), /field list changed/);
    await db.exec("rollback to savepoint stale_fields");
    const currentFields = (await db.query<{ fields: unknown[] }>(`select jsonb_agg(to_jsonb(d) - 'organization_id') as fields
      from public.directory_field_definitions d where organization_id = '${createdOrg.id}'`)).rows[0].fields;
    await db.query(`select public.change_directory_field_set('${createdOrg.id}', $1, null, 'student_id')`, [JSON.stringify(currentFields)]);
    assert.deepEqual((await db.query("select attributes from public.organization_directory_members where member_code = '0012'")).rows,
      [{ attributes: {} }]);
    await db.exec("rollback");

    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130017_directory_field_drafts.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`);
    await db.exec("begin");
    const saveEmptyDraft = `select public.change_directory_field_set('${createdOrg.id}', $1, '[]', null, $2)`;
    await db.exec("savepoint unconfirmed_draft");
    await assert.rejects(db.query(saveEmptyDraft, [expectedFields, false]), /Confirm deletion/);
    await db.exec("rollback to savepoint unconfirmed_draft");
    assert.deepEqual((await db.query("select attributes from public.organization_directory_members where member_code = '0012'")).rows,
      [{ attributes: { student_id: "0007" } }]);
    await db.query(saveEmptyDraft, [expectedFields, true]);
    assert.deepEqual((await db.query("select attributes from public.organization_directory_members where member_code = '0012'")).rows,
      [{ attributes: {} }]);
    await db.exec("rollback");

    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130018_directory_active_fields.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`);
    await db.exec("begin");
    await db.query(saveEmptyDraft, [expectedFields, false]);
    assert.deepEqual((await db.query("select attributes from public.organization_directory_members where member_code = '0012'")).rows,
      [{ attributes: { student_id: "0007" } }]);
    assert.equal((await db.query("select key from public.directory_field_definitions where active")).rows.length, 0);
    await db.exec(`update public.organization_directory_members set display_name = 'Updated Offline Member', attributes = '{}'
      where member_code = '0012'`);
    assert.deepEqual((await db.query("select attributes from public.organization_directory_members where member_code = '0012'")).rows,
      [{ attributes: { student_id: "0007" } }]);
    await db.exec("savepoint inactive_write");
    await assert.rejects(db.query(`update public.organization_directory_members set attributes = '{"student_id":"changed"}'
      where member_code = '0012'`), /inactive/);
    await db.exec("rollback to savepoint inactive_write");
    await db.query(`select public.change_directory_field_set('${createdOrg.id}', '[]', $1, null, false)`, [expectedFields]);
    assert.equal((await db.query("select key from public.directory_field_definitions where active")).rows.length, 1);
    assert.deepEqual((await db.query("select attributes from public.organization_directory_members where member_code = '0012'")).rows,
      [{ attributes: { student_id: "0007" } }]);
    await db.exec("rollback");

    const importSql = `select public.commit_directory_import('${createdOrg.id}', '${user}',
      '[{"display_name":"Imported Member","member_code":"0091"}]') as result`;
    assert.deepEqual((await db.query(importSql)).rows, [{ result: { inserted: 1, skipped: 0 } }]);
    assert.deepEqual((await db.query(importSql)).rows, [{ result: { inserted: 1, skipped: 0 } }]);
    assert.equal((await db.query("select id from public.organization_directory_members where member_code = '0091'")).rows.length, 1);
    await assert.rejects(db.query(`select public.commit_directory_import('${foreignOrg}', '${user}',
      '[{"display_name":"Unauthorized"}]')`), /not permitted/);

    // Verify creator now sees both their organizations
    const orgsAfterCreate = await db.query("select id from public.organizations order by name");
    assert.equal(orgsAfterCreate.rows.length, 2);

    // Switch to second user and test joining by invite code
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${other}';`);
    const joinResult = await db.query(`select public.join_organization_by_code('${createdOrg.invite_code}') as result`);
    const joinedOrg = (joinResult.rows[0] as { result: { id: string; name: string; role: string } }).result;
    assert.equal(joinedOrg.id, createdOrg.id);
    assert.equal(joinedOrg.role, "member");
    assert.equal((await db.query("select id from public.organization_directory_members")).rows.length, 0);

    // Joining member can read roster of the organization they just joined
    const roster = await db.query(`select profile_id, role from public.organization_members where organization_id = '${createdOrg.id}' order by role`);
    assert.equal(roster.rows.length, 2);

    // Switch back to owner and test creating spaces and reporting periods
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    const spaceRes = await db.query(`select public.create_space('${createdOrg.id}', 'Annual Summit 2026', 'Fundraising and operations') as result`);
    const createdSpace = (spaceRes.rows[0] as { result: { id: string; name: string; status: string } }).result;
    assert.equal(createdSpace.name, "Annual Summit 2026");
    assert.equal(createdSpace.status, "active");

    const periodRes = await db.query(`select public.create_reporting_period('${createdOrg.id}', 'AY 2026-2027 Sem 1', '2026-08-01', '2026-12-15', true) as result`);
    const createdPeriod = (periodRes.rows[0] as { result: { id: string; name: string; is_default: boolean } }).result;
    assert.equal(createdPeriod.name, "AY 2026-2027 Sem 1");
    assert.equal(createdPeriod.is_default, true);

    // Verify both owner and member see the space and period
    assert.equal((await db.query(`select * from public.spaces where organization_id = '${createdOrg.id}'`)).rows.length, 1);
    assert.equal((await db.query(`select * from public.reporting_periods where organization_id = '${createdOrg.id}'`)).rows.length, 1);

    // Owner promotes member to Treasurer
    const memberRow = (await db.query(`select id from public.organization_members where organization_id = '${createdOrg.id}' and profile_id = '${other}'`)).rows[0] as { id: string };
    const roleUpdateRes = await db.query(`select public.update_member_role('${memberRow.id}', 'treasurer') as result`);
    assert.equal((roleUpdateRes.rows[0] as { result: { role: string } }).result.role, "treasurer");

    // Owner cannot demote self if sole owner
    const ownerRow = (await db.query(`select id from public.organization_members where organization_id = '${createdOrg.id}' and profile_id = '${user}'`)).rows[0] as { id: string };
    await assert.rejects(db.query(`select public.update_member_role('${ownerRow.id}', 'member')`), /Cannot demote the only owner/);

    // Phase 4: Create collection with batch obligation assignment (50000 centavos = 500.00 PHP)
    const collRes = await db.query(`select public.create_collection('${createdOrg.id}', 'Annual Dues 2026', 'Mandatory dues', '${createdSpace.id}', '${createdPeriod.id}', 100000, '2026-11-30', 50000, true) as result`);
    const createdColl = (collRes.rows[0] as { result: { id: string; title: string; assigned_obligations_count: number } }).result;
    assert.equal(createdColl.title, "Annual Dues 2026");
    assert.equal(createdColl.assigned_obligations_count, 2); // user and other

    // Verify obligations created with status 'pending'
    const obRows = (await db.query(`select id, member_id, amount_centavos, status from public.obligations where collection_id = '${createdColl.id}' order by amount_centavos`)).rows as Array<{ id: string; member_id: string; amount_centavos: number | string; status: string }>;
    assert.equal(obRows.length, 2);
    assert.equal(obRows[0].status, "pending");
    assert.equal(Number(obRows[0].amount_centavos), 50000);

    // Record partial payment of 20000 centavos for member other (treasurer)
    const otherOb = obRows.find(o => o.member_id === memberRow.id)!;
    const payRes1 = await db.query(`select public.record_payment('${createdOrg.id}', '${otherOb.id}', 20000, 'gcash', 'GC-12345', 'idemp-001') as result`);
    const pay1 = (payRes1.rows[0] as { result: { id: string; receipt_number: string; is_duplicate_replay: boolean } }).result;
    assert.match(pay1.receipt_number, /^RCP-\d{4}-0001$/);
    assert.equal(pay1.is_duplicate_replay, false);

    // Obligation status should now be 'partially_paid'
    const obAfterPay1 = (await db.query(`select status from public.obligations where id = '${otherOb.id}'`)).rows[0] as { status: string };
    assert.equal(obAfterPay1.status, "partially_paid");

    // Idempotent duplicate submission with same idempotency_key returns existing payment
    const replayRes = await db.query(`select public.record_payment('${createdOrg.id}', '${otherOb.id}', 20000, 'gcash', 'GC-12345', 'idemp-001') as result`);
    const replayPay = (replayRes.rows[0] as { result: { id: string; receipt_number: string; is_duplicate_replay: boolean } }).result;
    assert.equal(replayPay.id, pay1.id);
    assert.equal(replayPay.receipt_number, pay1.receipt_number);
    assert.equal(replayPay.is_duplicate_replay, true);

    // Record remaining payment of 30000 centavos with new idempotency key
    const payRes2 = await db.query(`select public.record_payment('${createdOrg.id}', '${otherOb.id}', 30000, 'cash', null, 'idemp-002') as result`);
    const pay2 = (payRes2.rows[0] as { result: { id: string; receipt_number: string } }).result;
    assert.match(pay2.receipt_number, /^RCP-\d{4}-0002$/);

    // Obligation status should now be 'paid'
    const obAfterPay2 = (await db.query(`select status from public.obligations where id = '${otherOb.id}'`)).rows[0] as { status: string };
    assert.equal(obAfterPay2.status, "paid");

    // Reverse pay2 with reason
    const revRes = await db.query(`select public.reverse_payment('${createdOrg.id}', '${pay2.id}', 'Cash was counterfeit') as result`);
    const revPay = (revRes.rows[0] as { result: { status: string; reversal_reason: string } }).result;
    assert.equal(revPay.status, "reversed");
    assert.equal(revPay.reversal_reason, "Cash was counterfeit");

    // Obligation status should automatically revert back to 'partially_paid'
    const obAfterRev = (await db.query(`select status from public.obligations where id = '${otherOb.id}'`)).rows[0] as { status: string };
    assert.equal(obAfterRev.status, "partially_paid");

    // Phase 5: Budgets, Expenses, and Approvals
    const budgetRes = await db.query(`select public.create_budget('${createdOrg.id}', 'Event Logistics', 100000, 'Sound, chairs, catering', '${createdSpace.id}', '${createdPeriod.id}') as result`);
    const createdBudget = (budgetRes.rows[0] as { result: { id: string; name: string; allocated_amount_centavos: number } }).result;
    assert.equal(createdBudget.name, "Event Logistics");
    assert.equal(createdBudget.allocated_amount_centavos, 100000);

    // Submit expense of 40000 centavos
    const expRes1 = await db.query(`select public.submit_expense('${createdOrg.id}', 'Chairs Rental', 40000, 'supplies', '2026-11-15', '50 plastic chairs', '${createdBudget.id}', '${createdSpace.id}', '${createdPeriod.id}', 'https://example.com/rcp1.png', 'ABC Rentals') as result`);
    const exp1 = (expRes1.rows[0] as { result: { id: string; status: string; amount_centavos: number } }).result;
    assert.equal(exp1.status, "pending");

    await assert.rejects(db.query(`select public.review_expense('${createdOrg.id}', '${exp1.id}', 'verified', 'Self review')`), /different officer/);
    await db.exec(`reset role; update public.organization_members set role = 'auditor' where organization_id = '${createdOrg.id}' and profile_id = '${other}'; set role authenticated; set request.jwt.claim.sub = '${other}';`);
    await assert.rejects(db.query(`select public.review_expense('${createdOrg.id}', '${exp1.id}', 'approved', 'Skip verification')`), /verify.*before approval/);
    // Independent officer verifies then approves the submission.
    const verRes = await db.query(`select public.review_expense('${createdOrg.id}', '${exp1.id}', 'verified', 'Receipt verified against vendor invoice') as result`);
    assert.equal((verRes.rows[0] as { result: { status: string } }).result.status, "verified");

    await db.exec(`reset role; update public.expenses set description = 'Updated evidence' where id = '${exp1.id}'; set role authenticated; set request.jwt.claim.sub = '${other}';`);
    const changed = (await db.query(`select status, verified_by from public.expenses where id = '${exp1.id}'`)).rows[0];
    assert.deepEqual(changed, { status: 'pending', verified_by: null });
    await assert.rejects(db.query(`select public.review_expense('${createdOrg.id}', '${exp1.id}', 'approved', 'Stale verification')`), /verify.*before approval/);
    await db.query(`select public.review_expense('${createdOrg.id}', '${exp1.id}', 'verified', 'Rechecked updated evidence')`);
    // Officer approves expense
    const appRes = await db.query(`select public.review_expense('${createdOrg.id}', '${exp1.id}', 'approved', 'Authorized for reimbursement') as result`);
    assert.equal((appRes.rows[0] as { result: { status: string } }).result.status, "approved");

    await assert.rejects(db.query(`select public.review_expense('${createdOrg.id}', '${exp1.id}', 'approved', 'Duplicate')`), /terminal/);
    await db.exec(`set request.jwt.claim.sub = '${user}';`);
    // Submit and attempt to approve another expense of 70000 centavos (would total 110,000 > 100,000 budget cap)
    const expRes2 = await db.query(`select public.submit_expense('${createdOrg.id}', 'Stage Lighting', 70000, 'equipment', '2026-11-16', 'Lights', '${createdBudget.id}') as result`);
    const exp2 = (expRes2.rows[0] as { result: { id: string } }).result;
    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    await db.query(`select public.review_expense('${createdOrg.id}', '${exp2.id}', 'verified', 'Check evidence')`);
    await assert.rejects(
      db.query(`select public.review_expense('${createdOrg.id}', '${exp2.id}', 'approved', 'Over limit test')`),
      /Approval rejected: Expense exceeds the remaining authorized budget allocation/
    );

    await assert.rejects(db.query(`select public.review_expense('${createdOrg.id}', '${exp2.id}', 'rejected', '')`), /reason for rejection/);
    await db.exec(`set request.jwt.claim.sub = '${user}';`);
    // Phase 6: Cash Advances and Liquidation
    const advRes = await db.query(`select public.create_cash_advance('${createdOrg.id}', '${memberRow.id}', 'Festival Cash Float', 'Purchases for food stall', 50000, 'cash', 'FLT-001') as result`);
    const createdAdv = (advRes.rows[0] as { result: { id: string; status: string; amount_released_centavos: number } }).result;
    assert.equal(createdAdv.status, "outstanding");
    assert.equal(createdAdv.amount_released_centavos, 50000);

    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    // Accountable person submits liquidation: Spent 40000, returned 10000, balance 0
    const liqRes = await db.query(`select public.submit_liquidation('${createdOrg.id}', '${createdAdv.id}', 40000, 10000, 'Purchased cooking gas and condiments') as result`);
    const createdLiq = (liqRes.rows[0] as { result: { id: string; status: string; outstanding_balance_centavos: number } }).result;
    assert.equal(createdLiq.status, "submitted");
    assert.equal(createdLiq.outstanding_balance_centavos, 0);

    await assert.rejects(db.query(`select public.review_liquidation('${createdOrg.id}', '${createdLiq.id}', 'approved', 'Self review')`), /different officer/);
    await db.exec(`set request.jwt.claim.sub = '${user}';`);
    // Review and approve liquidation
    const liqAppRes = await db.query(`select public.review_liquidation('${createdOrg.id}', '${createdLiq.id}', 'approved', 'All receipts match') as result`);
    assert.equal((liqAppRes.rows[0] as { result: { status: string } }).result.status, "approved");

    await assert.rejects(db.query(`select public.review_liquidation('${createdOrg.id}', '${createdLiq.id}', 'rejected', 'Repeat review')`), /Only submitted liquidations/);
    // Cash advance is now liquidated
    const advAfter = (await db.query(`select status from public.cash_advances where id = '${createdAdv.id}'`)).rows[0] as { status: string };
    assert.equal(advAfter.status, "liquidated");

    // Verify audit logs exist across all entities and are retrievable by officer
    const auditLogs = (await db.query(`select * from public.get_organization_audit_logs('${createdOrg.id}')`)).rows;
    assert.ok(auditLogs.length >= 8);
    assert.equal(auditLogs[0].organization_id, createdOrg.id);

    // Account Settings: Profile updates
    await db.exec(`set request.jwt.claim.sub = '${user}';`);
    await db.query(`update public.profiles set display_name = 'Updated Name', avatar_url = 'https://example.com/avatar.png' where id = '${user}'`);
    const updatedProfile = (await db.query(`select display_name, avatar_url from public.profiles where id = '${user}'`)).rows[0] as { display_name: string; avatar_url: string };
    assert.equal(updatedProfile.display_name, "Updated Name");
    assert.equal(updatedProfile.avatar_url, "https://example.com/avatar.png");

    // Cross-user profile update denied by RLS
    await db.query(`update public.profiles set display_name = 'Hacked' where id = '${other}'`);
    const otherProfileCheck = (await db.query(`select display_name from public.profiles where id = '${other}'`)).rows[0] as { display_name: string };
    assert.notEqual(otherProfileCheck.display_name, "Hacked");

    // Account Settings: User Preferences
    await db.query(`insert into public.user_preferences (user_id, theme, reduced_motion, default_organization_id) values ('${user}', 'system', true, '${createdOrg.id}')`);
    const userPrefs = (await db.query(`select theme, reduced_motion, default_organization_id from public.user_preferences where user_id = '${user}'`)).rows[0] as { theme: string; reduced_motion: boolean; default_organization_id: string };
    assert.equal(userPrefs.theme, "system");
    assert.equal(userPrefs.reduced_motion, true);
    assert.equal(userPrefs.default_organization_id, createdOrg.id);

    // Another user cannot see or modify user's preferences
    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    assert.equal((await db.query(`select * from public.user_preferences where user_id = '${user}'`)).rows.length, 0);

    // Account Settings: Leave organization sole-owner safeguard
    await db.exec(`set request.jwt.claim.sub = '${user}';`);
    await assert.rejects(
      db.query(`select public.leave_organization('${createdOrg.id}')`),
      /Cannot leave organization as the sole owner/
    );

    // Account Settings: Non-owner member can leave organization
    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    const leaveRes = await db.query(`select public.leave_organization('${createdOrg.id}') as result`);
    assert.equal((leaveRes.rows[0] as { result: { success: boolean } }).result.success, true);
    await db.exec(`reset role;`);
    const otherMemberStatus = (await db.query(`select status from public.organization_members where organization_id = '${createdOrg.id}' and profile_id = '${other}'`)).rows[0] as { status: string };
    assert.equal(otherMemberStatus.status, "left");
    await db.exec(`set role authenticated;`);

    // Account Settings: Delete personal account sole-owner safeguard
    await db.exec(`set request.jwt.claim.sub = '${user}';`);
    await assert.rejects(
      db.query(`select public.delete_personal_account()`),
      /Cannot delete account while you are the sole owner/
    );

    // Non-sole owner can delete personal account
    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    const deleteRes = await db.query(`select public.delete_personal_account() as result`);
    assert.equal((deleteRes.rows[0] as { result: { success: boolean } }).result.success, true);
    const anonymizedProfile = (await db.query(`select display_name, avatar_url from public.profiles where id = '${other}'`)).rows[0] as { display_name: string; avatar_url: string | null };
    assert.equal(anonymizedProfile.display_name, "Former Member");
    assert.equal(anonymizedProfile.avatar_url, null);

    // Organization Ownership & Deletion
    const thirdUser = "55555555-5555-4555-8555-555555555555";
    await db.exec(`
      reset role;
      insert into auth.users (id, raw_user_meta_data) values ('${thirdUser}', '{"display_name": "Successor"}'::jsonb);
      insert into public.organization_members (organization_id, profile_id, role, status)
      values ('${createdOrg.id}', '${thirdUser}', 'organization_admin', 'active');
      set role authenticated; set request.jwt.claim.sub = '${user}';
    `);

    // Check deletability
    const deletableCheck = await db.query(`select public.check_org_deletability('${createdOrg.id}') as result`);
    const deletableData = (deletableCheck.rows[0] as { result: { is_deletable: boolean; unliquidated_count: number } }).result;
    assert.equal(deletableData.is_deletable, true);
    assert.equal(deletableData.unliquidated_count, 0);

    // Get successor member ID
    const successorMember = (await db.query(`select id from public.organization_members where organization_id = '${createdOrg.id}' and profile_id = '${thirdUser}'`)).rows[0] as { id: string };

    // Transfer ownership from user to thirdUser
    const transferRes = await db.query(`select public.transfer_organization_ownership('${createdOrg.id}', '${successorMember.id}', 'organization_admin') as result`);
    assert.equal((transferRes.rows[0] as { result: { success: boolean } }).result.success, true);

    // Verify thirdUser is now owner, and user is now organization_admin
    const newOwnerRole = (await db.query(`select role from public.organization_members where organization_id = '${createdOrg.id}' and profile_id = '${thirdUser}'`)).rows[0] as { role: string };
    assert.equal(newOwnerRole.role, "owner");
    const oldOwnerRole = (await db.query(`select role from public.organization_members where organization_id = '${createdOrg.id}' and profile_id = '${user}'`)).rows[0] as { role: string };
    assert.equal(oldOwnerRole.role, "organization_admin");

    await db.exec("reset role");
    const beforeBackfillPayments=(await db.query(`select id,obligation_id,amount_centavos,status,receipt_number,recorded_by from public.payments order by id`)).rows;
    const beforeBackfillActive=(await db.query(`select id from public.organization_directory_members where status='active' order by id`)).rows;
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130008_directory_history.sql"), "utf8"));
    assert.deepEqual((await db.query(`select id,obligation_id,amount_centavos,status,receipt_number,recorded_by from public.payments order by id`)).rows,beforeBackfillPayments);
    assert.deepEqual((await db.query(`select id from public.organization_directory_members where status='active' order by id`)).rows,beforeBackfillActive);
    assert.equal((await db.query(`select distinct d.status from public.obligations o join public.organization_directory_members d on d.id=o.directory_member_id where o.collection_id='${createdColl.id}'`)).rows[0].status,'archived');

    const historicalRows = await db.query<{ directory_member_id: string }>(`select directory_member_id
      from public.obligations where collection_id = '${createdColl.id}'`);
    assert.equal(historicalRows.rows.length, 2);
    assert.equal(new Set(historicalRows.rows.map(row => row.directory_member_id)).size, 2);
    assert.ok(historicalRows.rows.every(row => row.directory_member_id));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    const history = await db.query(`select * from public.directory_member_obligations(
      '${createdOrg.id}', '${historicalRows.rows[0].directory_member_id}')`);
    assert.equal(history.rows.length, 1);
    await assert.rejects(db.query(`select * from public.directory_member_obligations(
      '${foreignOrg}', '${historicalRows.rows[0].directory_member_id}')`), /not accessible/);

    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130009_preserve_collection_history.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    const archive = await db.query(`select public.delete_collection('${createdOrg.id}', '${createdColl.id}')->>'action' as action`);
    assert.deepEqual(archive.rows, [{ action: "archived" }]);
    await assert.rejects(db.query(`select public.delete_collection('${createdOrg.id}', '${foreignOrg}')`), /Collection not found/);

    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130010_directory_payment_history.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    const paymentHistory = await db.query<{ receipt_number: string; status: string }>(`
      select receipt_number, status from public.directory_member_payments(
        '${createdOrg.id}', '${historicalRows.rows[0].directory_member_id}')
      union all
      select receipt_number, status from public.directory_member_payments(
        '${createdOrg.id}', '${historicalRows.rows[1].directory_member_id}')`);
    assert.ok(paymentHistory.rows.some(row => row.status === "reversed" && row.receipt_number));
    await assert.rejects(db.query(`select * from public.directory_member_payments(
      '${foreignOrg}', '${historicalRows.rows[0].directory_member_id}')`), /not accessible/);

    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130011_directory_overdue.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611140004_directory_financial_integration.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611140005_directory_member_lifecycle.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    const historicalMember = historicalRows.rows[0].directory_member_id;
    const protectedPayments=(await db.query(`select id,obligation_id,amount_centavos,status,receipt_number from public.payments order by id`)).rows;
    for (const row of historicalRows.rows) {
      const preview=(await db.query<{preview:{canDelete:boolean}}>(`select public.directory_member_delete_preview('${createdOrg.id}','${row.directory_member_id}') as preview`)).rows[0].preview;
      assert.equal(preview.canDelete,false);
      await assert.rejects(db.query(`select public.delete_directory_member('${createdOrg.id}','${row.directory_member_id}')`),/collection obligations/);
    }
    assert.deepEqual((await db.query(`select id,obligation_id,amount_centavos,status,receipt_number from public.payments order by id`)).rows,protectedPayments);
    await assert.rejects(db.query(`select public.delete_directory_member('${foreignOrg}','${historicalRows.rows[0].directory_member_id}')`),/cannot delete/);

    const financialRows = (await db.query<{assessed_centavos:string; paid_centavos:string; remaining_centavos:string}>(`select * from public.directory_member_obligations('${createdOrg.id}', '${historicalMember}')`)).rows;
    const overview = (await db.query<{assessed_centavos:string; paid_centavos:string; remaining_centavos:string}>(`select * from public.directory_member_financial_summary('${createdOrg.id}', '${historicalMember}')`)).rows[0];
    for (const key of ["assessed_centavos", "paid_centavos", "remaining_centavos"] as const) {
      assert.equal(overview[key], financialRows.reduce((sum,row) => sum + BigInt(row[key]), 0n).toString());
    }
    await assert.rejects(db.query(`select * from public.directory_member_financial_summary('${foreignOrg}', '${historicalMember}')`), /not accessible/);
    assert.equal((await db.query(`select * from public.directory_member_financial_summary('${createdOrg.id}', '${foreignOrg}')`)).rows.length, 0);
    await assert.rejects(db.query(`select * from public.directory_member_financial_rows('${createdOrg.id}', '${historicalMember}')`), /permission denied/);
    const overdueQuery = `select overdue from public.directory_member_obligations(
      '${createdOrg.id}', '${historicalRows.rows[0].directory_member_id}')`;
    assert.deepEqual((await db.query(overdueQuery)).rows, [{ overdue: false }]);
    await assert.rejects(db.query(`select public.set_organization_time_zone('${createdOrg.id}', 'Invalid/Zone')`), /valid IANA/);
    await db.query(`select public.set_organization_time_zone('${createdOrg.id}', 'Asia/Manila')`);
    assert.deepEqual((await db.query(`select time_zone from public.organizations where id = '${createdOrg.id}'`)).rows,
      [{ time_zone: "Asia/Manila" }]);

    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130012_directory_assignment_foundation.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    // Aggregates must cover every page, not only the 25 visible history rows.
    await db.exec(`reset role; begin;
      insert into public.collections(organization_id,title,created_by)
        select '${createdOrg.id}', 'Summary fixture ' || n, '${user}' from generate_series(1,30) n;
      insert into public.obligations(organization_id,collection_id,directory_member_id,amount_centavos)
        select '${createdOrg.id}',id,'${historicalMember}',100 from public.collections
        where organization_id='${createdOrg.id}' and title like 'Summary fixture %';
      set role authenticated;`);
    const completeSummary = (await db.query<{assessed_centavos:string}>(`select * from public.directory_member_financial_summary('${createdOrg.id}','${historicalMember}')`)).rows[0];
    assert.equal(BigInt(completeSummary.assessed_centavos), BigInt(overview.assessed_centavos)+3000n);
    assert.equal((await db.query(`select * from public.directory_member_obligations('${createdOrg.id}','${historicalMember}')`)).rows.length,26);
    await db.exec(`reset role;
      insert into public.organization_directory_members(organization_id,display_name)
        select '${createdOrg.id}', 'Roster fixture ' || n from generate_series(1,30) n;
      insert into public.obligations(organization_id,collection_id,directory_member_id,amount_centavos)
        select '${createdOrg.id}','${createdColl.id}',id,100 from public.organization_directory_members
        where organization_id='${createdOrg.id}' and display_name like 'Roster fixture %';
      set role authenticated;`);
    const firstPage=(await db.query<{id:string}>(`select * from public.collection_roster_page('${createdOrg.id}','${createdColl.id}',0,'Roster fixture')`)).rows;
    const secondPage=(await db.query<{id:string}>(`select * from public.collection_roster_page('${createdOrg.id}','${createdColl.id}',25,'Roster fixture')`)).rows;
    assert.equal(firstPage.length,26);
    assert.equal(secondPage.length,5);
    assert.equal(firstPage[25].id,secondPage[0].id);
    assert.equal(new Set([...firstPage.slice(0,25),...secondPage].map(row=>row.id)).size,30);
    await assert.rejects(db.query(`select * from public.collection_roster_page('${foreignOrg}','${createdColl.id}')`),/not accessible/);
    await db.exec(`rollback; set role authenticated;`);
    const target = (await db.query<{ id: string }>(`select id from public.organization_directory_members
      where organization_id = '${createdOrg.id}' and member_code = '0091'`)).rows[0].id;
    const assignment = `select public.assign_directory_obligations(
      '${createdOrg.id}', '${createdColl.id}', array['${target}'::uuid], 10000)`;
    await assert.rejects(db.query(assignment), /permission denied/);
    await db.exec(`reset role; begin;
      update public.collections set status = 'active' where id = '${createdColl.id}'`);
    assert.deepEqual((await db.query(assignment)).rows, [{ assign_directory_obligations: 1 }]);
    const assigned = await db.query(`select member_id, amount_centavos from public.obligations
      where directory_member_id = '${target}'`);
    assert.deepEqual(assigned.rows, [{ member_id: null, amount_centavos: 10000 }]);
    await db.exec("rollback; set role authenticated");

    await db.exec(`reset role; begin;
      update public.collections set status = 'active' where id = '${createdColl.id}';
      update public.organization_directory_members set status = 'archived' where id = '${target}'`);
    await assert.rejects(db.query(assignment), /selected members changed/);
    await db.exec("rollback; set role authenticated");

    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130013_directory_collection_reads.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611130014_collection_financial_privacy.sql"), "utf8"));
    await db.exec(`begin; update public.collections set status = 'active' where id = '${createdColl.id}';
      set role authenticated; set request.jwt.claim.sub = '${user}'`);
    assert.deepEqual((await db.query(assignment)).rows, [{ assign_directory_obligations: 1 }]);
    await db.exec("savepoint duplicate_batch");
    await assert.rejects(db.query(assignment), /duplicate key/);
    await db.exec("rollback to savepoint duplicate_batch");
    await db.exec(`savepoint invalid_batch`);
    await assert.rejects(db.query(`select public.assign_directory_obligations(
      '${createdOrg.id}', '${createdColl.id}', array['${target}'::uuid, '${foreignOrg}'::uuid], 10000)`),
      /selected members changed/);
    await db.exec("rollback to savepoint invalid_batch");
    const newObligation = (await db.query<{ id: string }>(`select id from public.obligations
      where directory_member_id = '${target}'`)).rows[0].id;
    await db.query(`select public.record_payment('${createdOrg.id}', '${newObligation}', 4000, 'cash', null, 'directory-4000')`);
    const memberSummary = (await db.query(`select assessed_centavos, paid_centavos, remaining_centavos from public.directory_member_financial_summary('${createdOrg.id}', '${target}')`)).rows;
    assert.deepEqual(memberSummary, [{assessed_centavos:"10000", paid_centavos:"4000", remaining_centavos:"6000"}]);
    const sharedRoster = (await db.query(`select paid_centavos, remaining_centavos from public.collection_obligation_financials('${createdOrg.id}', '${createdColl.id}') where obligation_id = '${newObligation}'`)).rows;
    assert.deepEqual(sharedRoster, [{paid_centavos:"4000",remaining_centavos:"6000"}]);
    const totals = `select total_collected_centavos, partially_paid_count from public.collection_financial_totals(
      '${createdOrg.id}', '${createdColl.id}')`;
    assert.deepEqual((await db.query(totals)).rows, [{ total_collected_centavos: "24000", partially_paid_count: 2 }]);
    await db.exec(`reset role; update public.organization_members set role = 'member', status = 'active'
      where organization_id = '${createdOrg.id}' and profile_id = '${other}';
      set role authenticated; set request.jwt.claim.sub = '${other}'`);
    await db.exec("savepoint financial_permission");
    await assert.rejects(db.query(`select * from public.directory_member_financial_summary('${createdOrg.id}','${target}')`), /not accessible/);
    await db.exec("rollback to savepoint financial_permission");
    await db.exec("savepoint roster_permission");
    await assert.rejects(db.query(`select * from public.collection_obligation_financials('${createdOrg.id}','${createdColl.id}')`), /not accessible/);
    await db.exec("rollback to savepoint roster_permission");
    assert.equal((await db.query(`select id from public.obligations where id = '${newObligation}'`)).rows.length, 0);
    const visibleLegacy = await db.query<{ member_id: string }>(`select member_id from public.obligations
      where collection_id = '${createdColl.id}'`);
    assert.deepEqual(visibleLegacy.rows, [{ member_id: memberRow.id }]);
    assert.equal((await db.query(`select id from public.payments where obligation_id = '${newObligation}'`)).rows.length, 0);
    assert.deepEqual((await db.query(totals)).rows, [{ total_collected_centavos: "24000", partially_paid_count: 2 }]);
    await db.exec(`rollback; set role authenticated; set request.jwt.claim.sub = '${user}'`);

    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611140001_organization_types.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`);
    await db.exec("begin");
    for (const [index, type, count] of [[1, "student", 5], [2, "workplace", 4], [3, "club", 3], [4, "nonprofit", 3], [5, "other", 0]] as const) {
      const request = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;
      const sql = `select public.create_typed_organization('Typed organization', 'PHP', '${type}', '${request}') as result`;
      const created = (await db.query<{ result: { id: string } }>(sql)).rows[0].result;
      assert.equal((await db.query<{ result: { id: string } }>(sql)).rows[0].result.id, created.id);
      assert.equal((await db.query(`select key from public.directory_field_definitions where organization_id = '${created.id}'`)).rows.length, count);
      assert.equal((await db.query(`select id from public.organization_directory_members where organization_id = '${created.id}'`)).rows.length, 0);
      if (index === 1) {
        const code=(await db.query<{invite_code:string}>(`select invite_code from public.organizations where id='${created.id}'`)).rows[0].invite_code;
        const invitees=['12121212-1212-4212-8212-121212121212','13131313-1313-4313-8313-131313131313','14141414-1414-4414-8414-141414141414'];
        for (const [n,invitee] of invitees.entries()) {
          await db.exec(`reset role; insert into auth.users(id) values('${invitee}'); set role authenticated; set request.jwt.claim.sub='${invitee}';`);
          await db.query(`select public.join_organization_by_code('${code}')`);
          await db.exec(`set request.jwt.claim.sub='${user}'`);
          assert.equal((await db.query(`select id from public.organization_members where organization_id='${created.id}'`)).rows.length,n+2);
          assert.equal((await db.query(`select id from public.organization_directory_members where organization_id='${created.id}' and status='active'`)).rows.length,0);
        }
        await db.query(`insert into public.organization_directory_members(organization_id,display_name) values('${created.id}','Explicit offline member')`);
        assert.equal((await db.query(`select id from public.organization_members where organization_id='${created.id}'`)).rows.length,4);
        assert.equal((await db.query(`select id from public.organization_directory_members where organization_id='${created.id}' and status='active'`)).rows.length,1);
        const offline=(await db.query<{id:string}>(`select id from public.organization_directory_members where organization_id='${created.id}'`)).rows[0].id;
        assert.equal((await db.query(`select id from public.obligations where directory_member_id='${offline}'`)).rows.length,0);
        await db.query(`update public.organization_directory_members set status='archived' where id='${offline}'`);
        await db.query(`update public.organization_directory_members set status='active' where id='${offline}'`);
        const lifecycleAudit=(await db.query<{action:string}>(`select action from public.get_organization_audit_logs('${created.id}') where entity_id='${offline}'`)).rows.map(row=>row.action);
        assert.ok(lifecycleAudit.includes('directory_member_archived'));
        assert.ok(lifecycleAudit.includes('directory_member_restored'));
        const groupId=(await db.query<{id:string}>(`insert into public.directory_groups(organization_id,name) values('${created.id}','Deletion fixture') returning id`)).rows[0].id;
        await db.query(`insert into public.directory_group_members values('${created.id}','${groupId}','${offline}')`);
        assert.deepEqual((await db.query(`select public.directory_member_delete_preview('${created.id}','${offline}') as preview`)).rows,[{preview:{canDelete:true,obligations:0,groupMemberships:1}}]);
        await db.exec(`set request.jwt.claim.sub='${invitees[0]}'`);
        await db.exec('savepoint forbidden_delete');
        await assert.rejects(db.query(`select public.delete_directory_member('${created.id}','${offline}')`),/cannot delete/);
        await db.exec(`rollback to savepoint forbidden_delete; set request.jwt.claim.sub='${user}'`);
        await db.query(`select public.delete_directory_member('${created.id}','${offline}')`);
        assert.equal((await db.query(`select id from public.organization_directory_members where id='${offline}'`)).rows.length,0);
        assert.equal((await db.query(`select member_id from public.directory_group_members where member_id='${offline}'`)).rows.length,0);
        assert.equal((await db.query(`select id from public.directory_groups where id='${groupId}'`)).rows.length,1);
        assert.equal((await db.query(`select id from public.organization_members where organization_id='${created.id}'`)).rows.length,4);
        assert.equal((await db.query(`select action from public.get_organization_audit_logs('${created.id}') where entity_id='${offline}' and action='directory_member_deleted'`)).rows.length,1);

      }
      await db.query(`select public.set_organization_type('${created.id}', 'other')`);
      assert.equal((await db.query(`select key from public.directory_field_definitions where organization_id = '${created.id}'`)).rows.length, count);
    }
    await db.exec("rollback");
    // Validate the operator audit script against the migrated database without mutating records.
    await db.exec("reset role");
    await db.exec((await readFile(path.resolve(__dirname,"../../supabase/scripts/directory_identity_audit.sql"),"utf8")).replaceAll("6df5babd-b3d8-4b6a-bd39-03adb779db47",createdOrg.id));
    await db.exec((await readFile(path.resolve(__dirname,"../../supabase/scripts/directory_cleanup_preflight.sql"),"utf8")).replaceAll("6df5babd-b3d8-4b6a-bd39-03adb779db47",createdOrg.id));
    await db.exec("set role authenticated");
    await db.exec("reset role");
    const inspectionSQL=(await readFile(path.resolve(__dirname,"../../supabase/scripts/development_cleanup_inspection.sql"),"utf8")).replaceAll("6df5babd-b3d8-4b6a-bd39-03adb779db47",createdOrg.id);
    const inspection=(await db.query<{inspection:{organization:{id:string};obligation_count:number;obligations:{id:string}[];incoming_foreign_keys:unknown[]}}>(inspectionSQL)).rows[0].inspection;
    assert.equal(inspection.organization.id,createdOrg.id);
    assert.equal(inspection.obligation_count,2);
    assert.equal(inspection.obligations.length,2);
    assert.ok(inspection.incoming_foreign_keys.length>0);
    await db.exec("set role authenticated");
    // Execute the approved one-use script only in the isolated local database fixture.
    await db.exec("reset role");
    await db.exec(await readFile(path.resolve(__dirname,"fixtures/approved-cleanup.sql"),"utf8"));
    const cleanupSQL=await readFile(path.resolve(__dirname,"../../supabase/scripts/approved_development_cleanup.sql"),"utf8");
    await db.exec(`update public.payments set receipt_number='DRIFT' where id='70c48bfe-7daf-4b27-b0b1-be4a7ef12dde'`);
    await assert.rejects(db.exec(cleanupSQL),/dependencies changed/);
    await db.exec("rollback");
    assert.equal((await db.query(`select id from public.obligations where collection_id='e87919ff-4d37-4aaf-a018-33c3f7a42fc7'`)).rows.length,2);
    await db.exec(`update public.payments set receipt_number='RCP-2026-0001' where id='70c48bfe-7daf-4b27-b0b1-be4a7ef12dde'`);
    await db.exec(cleanupSQL);
    assert.equal((await db.query(`select id from public.obligations where collection_id='e87919ff-4d37-4aaf-a018-33c3f7a42fc7'`)).rows.length,0);
    assert.equal((await db.query(`select id from public.payments where collection_id='e87919ff-4d37-4aaf-a018-33c3f7a42fc7'`)).rows.length,0);
    assert.equal((await db.query(`select id from public.organization_members where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'`)).rows.length,3);
    assert.deepEqual((await db.query(`select id from public.organization_directory_members where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'`)).rows,[{id:'300b3655-b3dd-4a5f-b99a-f3d46e0d49f8'}]);
    await db.exec("set role authenticated");
    // Former owner cannot delete organization anymore
    await assert.rejects(
      db.query(`select public.delete_organization('${createdOrg.id}')`),
      /Only an organization owner can delete/
    );

    // Directory records block the legacy purge, including its earlier financial deletes.
    await db.exec(`set request.jwt.claim.sub = '${thirdUser}';`);
    await assert.rejects(db.query(`select public.delete_organization('${createdOrg.id}')`), /organization_directory_members/);
    assert.equal((await db.query(`select id from public.collections where id = '${createdColl.id}'`)).rows.length, 1);
    assert.equal((await db.query(`select id from public.organization_directory_members where organization_id = '${createdOrg.id}'`)).rows.length, 5);
    // Remove only the synthetic directory fixture to exercise the legacy purge for an organization without a directory.
    await db.exec(`reset role; update public.obligations set directory_member_id = null where organization_id = '${createdOrg.id}'; delete from public.directory_import_batches where organization_id = '${createdOrg.id}'; delete from public.organization_directory_members where organization_id = '${createdOrg.id}'; delete from public.directory_field_definitions where organization_id = '${createdOrg.id}'; set role authenticated;`);
    const deleteOrgRes = await db.query(`select public.delete_organization('${createdOrg.id}') as result`);
    assert.equal((deleteOrgRes.rows[0] as { result: { success: boolean } }).result.success, true);
    assert.equal((await db.query(`select * from public.organizations where id = '${createdOrg.id}'`)).rows.length, 0);

    // Ask Bantai AI Conversations & Messages RLS Isolation
    await db.exec(`set request.jwt.claim.sub = '${user}';`);
    const convId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.exec(`
      insert into public.ai_conversations (id, organization_id, created_by, title)
      values ('${convId}', '${ownOrg}', '${user}', 'Budget Inquiry');
    `);
    assert.equal((await db.query(`select * from public.ai_conversations where id = '${convId}'`)).rows.length, 1);

    // Foreign user in same org cannot see user's conversation (private to owner)
    await db.exec(`
      reset role;
      insert into public.organization_members (organization_id, profile_id, role, status)
      values ('${ownOrg}', '${other}', 'member', 'active') on conflict do nothing;
      set role authenticated; set request.jwt.claim.sub = '${other}';
    `);
    assert.equal((await db.query(`select * from public.ai_conversations where id = '${convId}'`)).rows.length, 0);

    // User cannot create conversation in an organization they do not belong to
    await assert.rejects(
      db.query(`
        insert into public.ai_conversations (organization_id, created_by, title)
        values ('${foreignOrg}', '${other}', 'Hacked Org Conv');
      `),
      /new row violates row-level security policy/
    );

    // Add message by owner
    await db.exec(`set request.jwt.claim.sub = '${user}';`);
    const msgId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.exec(`
      insert into public.ai_messages (id, conversation_id, role, content)
      values ('${msgId}', '${convId}', 'user', 'What is our current balance?');
    `);
    assert.equal((await db.query(`select * from public.ai_messages where id = '${msgId}'`)).rows.length, 1);

    // Non-owner cannot see or inject messages into conversation
    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    assert.equal((await db.query(`select * from public.ai_messages where id = '${msgId}'`)).rows.length, 0);
    await assert.rejects(
      db.query(`
        insert into public.ai_messages (conversation_id, role, content)
        values ('${convId}', 'user', 'Injected message');
      `),
      /new row violates row-level security policy/
    );

    await db.exec("reset role; create role service_role");
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611140002_directory_import_reconciliation.sql"), "utf8"));
    await db.exec(await readFile(path.resolve(__dirname, "../../supabase/migrations/202611140003_organization_closure.sql"), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`);
    const closeOrg = (await db.query<{ result: { id: string } }>(`select public.create_typed_organization(
      'Retention Test', 'PHP', 'student', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') as result`)).rows[0].result.id;
    const importRoster = '[{"display_name":"First","member_code":"001"},{"display_name":"Second","member_code":"001"}]';
    const preview = await db.query(`select public.preview_directory_import('${closeOrg}', $1) as result`, [importRoster]);
    assert.deepEqual(preview.rows, [{ result: [{ row: 2, status: "new" }, { row: 3, status: "duplicate_in_file" }] }]);
    const importRequest = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const imported = await db.query(`select public.commit_directory_import('${closeOrg}', '${importRequest}', $1) as result`, [importRoster]);
    assert.deepEqual(imported.rows, [{ result: { inserted: 1, skipped: 1, rows: [{ row: 2, status: "inserted" }, { row: 3, status: "skipped_duplicate" }] } }]);
    assert.deepEqual((await db.query(`select public.commit_directory_import('${closeOrg}', '${importRequest}', $1) as result`, [importRoster])).rows, imported.rows);
    await assert.rejects(db.query(`select public.commit_directory_import('${closeOrg}', '${importRequest}', '[]')`), /roster/);
    const closeCollection = (await db.query<{ result: { id: string } }>(`select public.create_collection(
      '${closeOrg}','Retained Collection') as result`)).rows[0].result.id;
    const closeMember = (await db.query<{ id: string }>(`select id from public.organization_directory_members where organization_id = '${closeOrg}'`)).rows[0].id;
    await db.query(`select public.assign_directory_obligations('${closeOrg}','${closeCollection}',array['${closeMember}'::uuid],10000)`);
    const closeObligation = (await db.query<{ id: string }>(`select id from public.obligations where collection_id = '${closeCollection}'`)).rows[0].id;
    await db.query(`select public.record_payment('${closeOrg}','${closeObligation}',4000,'cash',null,'retained-payment')`);
    await db.query(`select public.delete_organization('${closeOrg}')`);
    assert.equal((await db.query(`select id from public.organizations where id = '${closeOrg}'`)).rows.length,0);
    await assert.rejects(db.query(`select public.create_collection('${closeOrg}','After closure')`), /Unauthorized/);
    await db.exec("reset role");
    assert.equal((await db.query(`select id from public.payments where organization_id = '${closeOrg}'`)).rows.length,1);
    assert.equal((await db.query(`select id from public.organization_directory_members where organization_id = '${closeOrg}'`)).rows.length,1);
    assert.deepEqual((await db.query(`select retention_status from public.organizations where id = '${closeOrg}'`)).rows,
      [{retention_status:"retained_pending_review"}]);
    await assert.rejects(db.query(`update public.organization_members set status = 'active' where organization_id = '${closeOrg}'`), /closed/);
    await db.exec(`update public.directory_import_batches set report_expires_at = now()-interval '1 day' where organization_id = '${closeOrg}'`);
    await db.query("select public.cleanup_directory_import_reports()");
    assert.deepEqual((await db.query(`select row_results from public.directory_import_batches where organization_id = '${closeOrg}'`)).rows,[{row_results:null}]);

    await db.exec(`reset role; set request.jwt.claim.sub = ''; update public.organization_members set status = 'suspended' where profile_id = '${user}' and status = 'active';`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    assert.equal((await db.query("select * from public.organizations")).rows.length, 0);
    assert.equal((await db.query("select * from public.organization_members")).rows.length, 0);
    await db.exec("reset role; set role anon;");
    await assert.rejects(db.exec("select * from public.organizations"), /permission denied/);
  } finally { await db.close(); }
});
