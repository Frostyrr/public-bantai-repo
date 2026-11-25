import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createNotifications,
  notifyOrganizationInvitationCreated,
  resolveEligibleApprovers,
} from "../src/modules/notifications/notifications.service";

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

test("NOTIF-01..06: expense triggers, recipients, RLS isolation, deduplication, rollback, read status, pagination, and revoked membership", async () => {
  const db = await createMigratedDb();
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const adminId = "10000000-0000-4000-8000-000000000002";
  const treasurerId = "10000000-0000-4000-8000-000000000003";
  const memberId = "10000000-0000-4000-8000-000000000004";
  const outsiderId = "10000000-0000-4000-8000-000000000005";

  try {
    await db.exec(`
      insert into auth.users(id, email) values
        ('${ownerId}', 'owner@example.com'),
        ('${adminId}', 'admin@example.com'),
        ('${treasurerId}', 'treasurer@example.com'),
        ('${memberId}', 'member@example.com'),
        ('${outsiderId}', 'outsider@example.com');
      set role authenticated;
      set request.jwt.claim.sub = '${ownerId}';
    `);

    const orgA = (
      await db.query<{ result: { id: string; invite_code: string } }>(
        "select public.create_typed_organization('Org Alpha', 'PHP', 'other', '20000000-0000-4000-8000-000000000001') as result"
      )
    ).rows[0].result;

    // Create Org B as outsider
    await db.exec(`set request.jwt.claim.sub = '${outsiderId}';`);
    const orgB = (
      await db.query<{ result: { id: string } }>(
        "select public.create_typed_organization('Org Beta', 'PHP', 'other', '20000000-0000-4000-8000-000000000002') as result"
      )
    ).rows[0].result;

    // Join Org Alpha as admin, treasurer, and member
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const inviteA = (
      await db.query<{ invite_code: string }>("select invite_code from public.organizations where id = $1", [orgA.id])
    ).rows[0].invite_code;

    for (const uid of [adminId, treasurerId, memberId]) {
      await db.exec(`set request.jwt.claim.sub = '${uid}';`);
      await db.query("select public.join_organization_by_code($1)", [inviteA]);
    }

    // Assign roles & grant member expense submission permission
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const membersA = (
      await db.query<{ id: string; profile_id: string }>(
        "select id, profile_id from public.organization_members where organization_id = $1",
        [orgA.id]
      )
    ).rows;
    const findMemberRow = (uid: string) => membersA.find((m) => m.profile_id === uid)!.id;

    await db.query("select public.update_member_role($1, 'organization_admin')", [findMemberRow(adminId)]);
    await db.query("select public.update_member_role($1, 'treasurer')", [findMemberRow(treasurerId)]);
    await db.query("select public.set_member_expense_submission($1, $2, true)", [orgA.id, findMemberRow(memberId)]);

    // 1. Member submits expense while treasurer_expense_approval = false
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    const exp1 = (
      await db.query<{ result: { id: string } }>(
        "select public.submit_expense($1, 'Printer Ink', 1500, 'supplies', '2026-11-14') as result",
        [orgA.id]
      )
    ).rows[0].result;

    // Owner and Admin should be notified; Treasurer (policy=false), Member (self), Outsider should NOT
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const ownerNotifs1 = (await db.query<{ id: string; type: string; entity_id: string; read_at: string | null }>("select id, type, entity_id, read_at from public.notifications")).rows;
    assert.equal(ownerNotifs1.length, 1);
    assert.equal(ownerNotifs1[0].type, "expense.submitted");
    assert.equal(ownerNotifs1[0].entity_id, exp1.id);

    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    const adminNotifs1 = (await db.query<{ id: string }>("select id from public.notifications where type = 'expense.submitted'")).rows;
    assert.equal(adminNotifs1.length, 1);

    await db.exec(`set request.jwt.claim.sub = '${treasurerId}';`);
    assert.equal((await db.query("select id from public.notifications where type = 'expense.submitted'")).rows.length, 0);

    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    assert.equal((await db.query("select id from public.notifications where type = 'expense.submitted'")).rows.length, 0);

    await db.exec(`set request.jwt.claim.sub = '${outsiderId}';`);
    assert.equal((await db.query("select id from public.notifications")).rows.length, 0);

    // 2. Unauthorized direct insert/delete & cross-user update blocked by RLS/grants
    await db.exec(`set request.jwt.claim.sub = '${outsiderId}';`);
    await assert.rejects(
      db.query("insert into public.notifications(recipient_user_id, type, title, message) values ($1, 'fake', 'x', 'y')", [ownerId])
    );
    await db.query("update public.notifications set read_at = now() where id = $1", [ownerNotifs1[0].id]);
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const ownerStillUnread = (await db.query<{ read_at: string | null }>("select read_at from public.notifications where id = $1", [ownerNotifs1[0].id])).rows[0];
    assert.equal(ownerStillUnread.read_at, null);

    // Non-read_at column update is rejected
    await assert.rejects(
      db.query("update public.notifications set title = 'Tampered' where id = $1", [ownerNotifs1[0].id])
    );

    // 3. Expense verified by Admin -> approved by Owner -> Member receives expense.approved (no self-notification)
    // Preserve Admin RLS denial assertion on raw expenses table, then fetch revision as Owner
    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    assert.equal(
      (await db.query<{ review_revision: number }>("select review_revision from public.expenses where id = $1", [exp1.id])).rows.length,
      0
    );
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const exp1Rev = (await db.query<{ review_revision: number }>("select review_revision from public.expenses where id = $1", [exp1.id])).rows[0].review_revision;
    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    await db.query("select public.review_expense($1, $2, 'verified', 'Checked receipt', $3)", [orgA.id, exp1.id, exp1Rev]);
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const exp1Rev2 = (await db.query<{ review_revision: number }>("select review_revision from public.expenses where id = $1", [exp1.id])).rows[0].review_revision;
    await db.query("select public.review_expense($1, $2, 'approved', 'Approved', $3)", [orgA.id, exp1.id, exp1Rev2]);

    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    const memberNotifs = (await db.query<{ id: string; type: string; entity_id: string }>("select id, type, entity_id from public.notifications")).rows;
    assert.equal(memberNotifs.length, 1);
    assert.equal(memberNotifs[0].type, "expense.approved");
    assert.equal(memberNotifs[0].entity_id, exp1.id);

    // 4. Failed business operation rolls back and emits zero notifications
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    const exp2 = (
      await db.query<{ result: { id: string } }>(
        "select public.submit_expense($1, 'Snacks', 500, 'food', '2026-11-14') as result",
        [orgA.id]
      )
    ).rows[0].result;
    // Preserve Member RLS denial assertion on raw expenses table, then fetch revision as Owner
    assert.equal(
      (await db.query<{ review_revision: number }>("select review_revision from public.expenses where id = $1", [exp2.id])).rows.length,
      0
    );
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const exp2Rev = (await db.query<{ review_revision: number }>("select review_revision from public.expenses where id = $1", [exp2.id])).rows[0].review_revision;
    await db.exec(`set request.jwt.claim.sub = '${treasurerId}';`);
    // Treasurer is not authorized yet because treasurer_expense_approval = false
    await assert.rejects(
      db.query("select public.review_expense($1, $2, 'rejected', 'No budget', $3)", [orgA.id, exp2.id, exp2Rev])
    );
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    assert.equal(
      (await db.query("select id from public.notifications where type = 'expense.rejected'")).rows.length,
      0
    );

    // 5. Deduplication & Invitation notification RPC + Cross-org isolation
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const firstEmit = (
      await db.query<{ count: number }>(
        "select public.emit_notifications($1::uuid[], $2, 'organization.invitation_created', 'Organization invitation', 'Invited to Org Alpha', '{}'::jsonb, 'organization_invitation', $3, $4) as count",
        [[outsiderId], orgA.id, orgA.id, "org_invite:test-1"]
      )
    ).rows[0].count;
    const secondEmit = (
      await db.query<{ count: number }>(
        "select public.emit_notifications($1::uuid[], $2, 'organization.invitation_created', 'Organization invitation', 'Invited to Org Alpha', '{}'::jsonb, 'organization_invitation', $3, $4) as count",
        [[outsiderId], orgA.id, orgA.id, "org_invite:test-1"]
      )
    ).rows[0].count;
    assert.equal(firstEmit, 1);
    assert.equal(secondEmit, 0);

    // Cross-org isolation: outsider creates expense in Org B, Org A owner sees zero Org B notifications
    await db.exec(`set request.jwt.claim.sub = '${outsiderId}';`);
    await db.query("select public.submit_expense($1, 'Beta Supplies', 900, 'supplies', '2026-11-14')", [orgB.id]);
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    assert.equal(
      (await db.query("select id from public.notifications where organization_id = $1", [orgB.id])).rows.length,
      0
    );

    // 6. Read status persistence & bulk mark-all-read & pagination
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const ownerAll = (
      await db.query<{ id: string }>("select id from public.notifications order by created_at desc, id desc")
    ).rows;
    assert.equal(ownerAll.length, 2); // exp1 + exp2

    // Pagination slice check (limit 1, offset 1)
    const page2 = (
      await db.query<{ id: string }>("select id from public.notifications order by created_at desc, id desc limit 1 offset 1")
    ).rows;
    assert.equal(page2.length, 1);
    assert.equal(page2[0].id, ownerAll[1].id);

    const markedCount = (
      await db.query<{ count: number }>("select public.mark_all_notifications_read($1) as count", [orgA.id])
    ).rows[0].count;
    assert.equal(markedCount, 2);
    assert.equal(
      (await db.query("select id from public.notifications where read_at is null")).rows.length,
      0
    );

    // 7. Revoked membership immediately blocks access to org notifications
    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    assert.equal((await db.query("select id from public.notifications")).rows.length, 3);

    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    await db.query("select public.leave_organization($1)", [orgA.id]);
    // Admin left Org A -> RLS hides Org A notifications immediately
    assert.equal((await db.query("select id from public.notifications")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("NOTIF-07: notification service filters self-notifications, handles failures safely, and resolves invitations", async () => {
  const calls: Array<{ type: string; recipientIds: string[]; dedupePrefix?: string | null }> = [];
  const mockPort = {
    emitNotificationsRpc: async (_token: string, params: { type: string; recipientIds: string[]; dedupePrefix?: string | null }) => {
      calls.push(params);
      return params.recipientIds.length;
    },
    resolveActiveOrgApprovers: async (_token: string, _orgId: string, _inc: boolean, exclude?: string) =>
      ["u-owner", "u-admin", "u-actor"].filter((id) => id !== exclude),
  };

  // Filters out actorUserId and deduplicates recipient IDs
  const res = await createNotifications(
    "tok",
    {
      recipientIds: ["u-actor", "u-owner", "u-owner", "u-admin"],
      actorUserId: "u-actor",
      organizationId: "org-1",
      type: "expense.submitted",
      title: "New expense",
      message: "Test",
      dedupePrefix: "exp:1",
    },
    mockPort
  );
  assert.equal(res.created, 2);
  assert.deepEqual(calls[0].recipientIds, ["u-owner", "u-admin"]);

  // Self-only recipient list returns 0 without calling RPC
  const selfRes = await createNotifications(
    "tok",
    {
      recipientIds: ["u-actor"],
      actorUserId: "u-actor",
      organizationId: "org-1",
      type: "expense.approved",
      title: "Approved",
      message: "Self",
    },
    mockPort
  );
  assert.equal(selfRes.created, 0);
  assert.equal(calls.length, 1);

  // Invitation helper skips missing/self invitee and emits with dedupePrefix
  const invRes = await notifyOrganizationInvitationCreated(
    "tok",
    {
      actorUserId: "u-actor",
      organizationId: "org-1",
      organizationName: "Org One",
      invitedUserId: "u-invitee",
      invitationId: "inv-123",
      invitedRole: "treasurer",
    },
    mockPort
  );
  assert.equal(invRes.created, 1);
  assert.equal(calls[1].type, "organization.invitation_created");
  assert.equal(calls[1].dedupePrefix, "org_invite:inv-123");

  // Best-effort error handling never throws into financial callers
  const failingPort = {
    ...mockPort,
    emitNotificationsRpc: async () => {
      throw new Error("Transient DB error");
    },
  };
  const failedRes = await createNotifications(
    "tok",
    {
      recipientIds: ["u-owner"],
      actorUserId: "u-actor",
      organizationId: "org-1",
      type: "expense.submitted",
      title: "New expense",
      message: "Test",
    },
    failingPort
  );
  assert.equal(failedRes.created, 0);
  assert.equal(failedRes.error, "Transient DB error");

  // Approver resolution excludes actor
  const approvers = await resolveEligibleApprovers("tok", "org-1", true, "u-actor", mockPort);
  assert.deepEqual(approvers, ["u-owner", "u-admin"]);
});

test("NOTIF-08: Phase 3 & 4 targeted invitations, cash advances, payments, role updates, preferences, delivery queue, and due reminders", async () => {
  const db = await createMigratedDb();
  try {
    const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const memberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const inviteeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    await db.query("insert into auth.users(id, email) values ($1, $2), ($3, $4), ($5, $6)", [
      ownerId,
      "owner3@example.com",
      memberId,
      "member3@example.com",
      inviteeId,
      "invitee3@example.com",
    ]);

    await db.exec("set local role authenticated;");
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const org = (
      await db.query<{ result: { id: string } }>(
        "select public.create_typed_organization('Phase34 Org', 'PHP', 'other', '20000000-0000-4000-8000-000000000003') as result"
      )
    ).rows[0].result;

    // 1. Targeted invitation -> notifies invitee -> accept -> active membership
    const inv = (
      await db.query<{ result: { id: string; invited_user_id: string } }>(
        "select public.create_organization_invitation($1, 'invitee3@example.com', 'treasurer') as result",
        [org.id]
      )
    ).rows[0].result;
    assert.equal(inv.invited_user_id, inviteeId);

    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${memberId}';`);
    assert.equal((await db.query("select * from public.list_my_pending_organization_invitations()")).rows.length, 0);
    await db.exec(`set request.jwt.claim.sub = '${inviteeId}';`);
    assert.equal((await db.query("select id from public.notifications where entity_id=$1 and organization_id=$2",
      [inv.id, org.id])).rows.length, 0);
    assert.equal((await db.query("select id from public.notifications where entity_id=$1", [inv.id])).rows.length, 1);
    assert.deepEqual((await db.query(
      "select id, organization_name from public.list_my_pending_organization_invitations()",
    )).rows, [{ id: inv.id, organization_name: "Phase34 Org" }]);

    await db.query("select public.respond_organization_invitation($1, true)", [inv.id]);
    assert.equal((await db.query("select * from public.list_my_pending_organization_invitations()")).rows.length, 0);
    const settled = (await db.query<{read_at: Date | null}>(
      "select read_at from public.notifications where entity_id=$1", [inv.id],
    )).rows[0];
    assert.ok(settled?.read_at);
    await db.exec("reset role");
    const activeMembership = (
      await db.query<{ role: string; status: string }>(
        "select role, status from public.organization_members where organization_id = $1 and profile_id = $2",
        [org.id, inviteeId]
      )
    ).rows[0];
    assert.equal(activeMembership.role, "treasurer");
    assert.equal(activeMembership.status, "active");

    const secondInvite = (await db.query<{ id: string }>(
      "insert into public.organization_invitations(organization_id,invited_user_id,invited_email,role,invited_by) " +
      "values ($1,$2,'invitee3@example.com','member',$3) returning id", [org.id, inviteeId, ownerId],
    )).rows[0].id;
    await db.query("update public.organization_members set status='suspended' where organization_id=$1 and profile_id=$2",
      [org.id, inviteeId]);
    await assert.rejects(db.query("select public.respond_organization_invitation($1,true)", [secondInvite]), /restricted/);
    await db.query("update public.organization_members set status='active' where organization_id=$1 and profile_id=$2",
      [org.id, inviteeId]);
    await db.query("select public.respond_organization_invitation($1,true)", [secondInvite]);
    assert.equal((await db.query(
      "select role from public.organization_members where organization_id=$1 and profile_id=$2", [org.id, inviteeId],
    )).rows[0].role, "treasurer");

    // 2. Join memberId via invite_code, then update role -> member.role_updated notification
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const code = (
      await db.query<{ invite_code: string }>("select invite_code from public.organizations where id = $1", [org.id])
    ).rows[0].invite_code;
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    await db.query("select public.join_organization_by_code($1)", [code]);

    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const memberRowId = (
      await db.query<{ id: string }>(
        "select id from public.organization_members where organization_id = $1 and profile_id = $2",
        [org.id, memberId]
      )
    ).rows[0].id;
    await db.query("select public.update_member_role($1, 'auditor')", [memberRowId]);
    await db.query("select public.update_member_role($1, 'member')", [memberRowId]);

    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    const roleNotifs = (
      await db.query<{ type: string }>("select type from public.notifications where type = 'member.role_updated'")
    ).rows;
    assert.equal(roleNotifs.length, 2);

    // 3. Cash advance request submitted -> owner notified; approved -> requester notified
    const caReq = (
      await db.query<{ result: { id: string; revision: number } }>(
        "select row_to_json(public.manage_cash_advance_request($1, null, 'create', jsonb_build_object('title', 'Event Booth', 'purpose', 'Setup', 'amountCentavos', 250000))) as result",
        [org.id]
      )
    ).rows[0].result;

    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const ownerCaNotifs = (
      await db.query<{ type: string; entity_id: string }>(
        "select type, entity_id from public.notifications where type = 'cash_advance.submitted'"
      )
    ).rows;
    assert.equal(ownerCaNotifs.length, 1);
    assert.equal(ownerCaNotifs[0].entity_id, caReq.id);

    await db.query(
      "select public.manage_cash_advance_request($1, $2, 'approve', jsonb_build_object('revision', $3::integer))",
      [org.id, caReq.id, caReq.revision]
    );
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    const memberCaNotifs = (
      await db.query<{ type: string }>("select type from public.notifications where type = 'cash_advance.approved'")
    ).rows;
    assert.equal(memberCaNotifs.length, 1);

    // 4. Collection due soon + obligation -> due reminder (officer-only, deduplicated)
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const col = (
      await db.query<{ id: string }>(
        "insert into public.collections(organization_id, title, currency, target_amount_centavos, due_date, created_by) values ($1, 'Annual Dues', 'PHP', 50000, current_date + 1, $2) returning id",
        [org.id, ownerId]
      )
    ).rows[0];
    await db.query(
      "insert into public.obligations(organization_id, collection_id, member_id, amount_centavos, status) values ($1, $2, $3, 50000, 'pending')",
      [org.id, col.id, memberRowId]
    );

    // Non-officer cannot trigger reminders
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    await assert.rejects(db.query("select public.trigger_workspace_due_reminders($1, 3)", [org.id]));

    // Officer triggers reminders twice -> deduplicated to 1 notification
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const firstSent = (await db.query<{ n: number }>("select public.trigger_workspace_due_reminders($1, 3) as n", [org.id])).rows[0].n;
    const secondSent = (await db.query<{ n: number }>("select public.trigger_workspace_due_reminders($1, 3) as n", [org.id])).rows[0].n;
    assert.equal(firstSent, 1);
    assert.equal(secondSent, 0);

    // 5. Preference suppression: in_app_approvals = false suppresses cash_advance.approved
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    await db.query(
      "insert into public.user_preferences(user_id, notifications) values ($1, '{\"in_app_approvals\": false}'::jsonb) on conflict (user_id) do update set notifications = excluded.notifications",
      [memberId]
    );
    const caReq2 = (
      await db.query<{ result: { id: string; revision: number } }>(
        "select row_to_json(public.manage_cash_advance_request($1, null, 'create', jsonb_build_object('title', 'Second Booth', 'purpose', 'Setup', 'amountCentavos', 100000))) as result",
        [org.id]
      )
    ).rows[0].result;
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    await db.query(
      "select public.manage_cash_advance_request($1, $2, 'approve', jsonb_build_object('revision', $3::integer))",
      [org.id, caReq2.id, caReq2.revision]
    );
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    const approvedCount = (
      await db.query<{ id: string }>("select id from public.notifications where type = 'cash_advance.approved'")
    ).rows.length;
    assert.equal(approvedCount, 1); // Only the first one before preference opt-out

    // 6. Delivery outbox queue populated automatically for email-enabled notifications
    await db.exec("reset role;");
    const queuedCount = (
      await db.query<{ c: string }>("select count(*) as c from public.notification_delivery_queue where status = 'pending'")
    ).rows[0].c;
    assert.ok(Number(queuedCount) >= 3);
  } finally {
    await db.close();
  }
});

test("platform inbox alerts route to assigned admins, deduplicate locks, and respect current role", async () => {
  const db = await createMigratedDb();
  const presenter = "10000000-0000-4000-8000-000000000010";
  const assignee = "10000000-0000-4000-8000-000000000011";
  const account = "10000000-0000-4000-8000-000000000012";
  const authenticate = (user: string) => db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
  const alerts = () => db.query<{ type: string }>(
    "select type from public.notifications where type like 'platform.%' order by type",
  );
  try {
    await db.exec(`
      insert into auth.users(id) values ('${presenter}'), ('${assignee}'), ('${account}');
      set app.allow_platform_role_change = 'true';
      update public.profiles set role='super_admin' where id='${presenter}';
      update public.profiles set role='admin' where id='${assignee}';
      set app.allow_platform_role_change = 'false';
    `);
    await authenticate(assignee);
    await db.query("select public.platform_admin_create_incident('Assigned issue','auth','high')");
    await db.query("select public.platform_admin_create_incident('Routine issue','auth','low')");
    assert.deepEqual((await alerts()).rows, [{ type: "platform.incident_opened" }]);

    await authenticate(account);
    assert.deepEqual((await alerts()).rows, []);
    await assert.rejects(db.query(
      "select public.emit_notifications(array[$1::uuid],null,'platform.incident_opened','Spoof','Payload')", [presenter],
    ), /Platform alerts must be generated/);
    await assert.rejects(db.query(
      "select public.emit_notifications(array[$1::uuid],null,'member.role_updated','Spoof','Payload','{}',null,null,' platform.incident:fake')", [presenter],
    ), /Platform alerts must be generated/);
    await assert.rejects(db.query(
      "select public.emit_platform_inbox_alert('platform.incident_opened','Spoof','Payload','spoof',null,null)",
    ), /permission denied/);

    await db.exec("reset role");
    await db.exec(`
      insert into public.security_incidents(title,category,severity) values ('Unassigned issue','auth','critical');
      update public.profiles set locked_until=now()+interval '30 minutes' where id='${account}';
      update public.profiles set locked_until=now()+interval '40 minutes' where id='${account}';
      update public.profiles set locked_until=null where id='${account}';
      update public.profiles set locked_until=now()+interval '50 minutes' where id='${account}';
    `);
    await authenticate(presenter);
    assert.deepEqual((await alerts()).rows, [{ type: "platform.account_locked" }, { type: "platform.incident_opened" }]);
    assert.equal((await db.query<{ n: number }>("select public.mark_all_notifications_read() as n")).rows[0].n, 2);
    await authenticate(assignee);
    assert.deepEqual((await alerts()).rows, [{ type: "platform.incident_opened" }]);

    await db.exec(`
      reset role;
      set app.allow_platform_role_change = 'true';
      update public.profiles set role='user' where id='${assignee}';
      set app.allow_platform_role_change = 'false';
    `);
    await authenticate(assignee);
    assert.deepEqual((await alerts()).rows, []);
    await db.exec("reset role");
    assert.equal((await db.query("select id from public.notification_delivery_queue where notification_type like 'platform.%'")).rows.length, 0);
  } finally {
    await db.close();
  }
});
