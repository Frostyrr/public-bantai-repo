import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { classifySecurityEvent } from "../src/middleware/requestTiming";

test("platform admin roles: enforces default role, prevents self-escalation, gates RPCs, and audits role changes", async () => {
  const db = new PGlite();
  const superAdminId = "10000000-0000-4000-8000-000000000001";
  const adminId = "10000000-0000-4000-8000-000000000002";
  const userId = "10000000-0000-4000-8000-000000000003";

  try {
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

    await db.exec(`
      insert into auth.users(id, email) values
        ('${superAdminId}', 'super@bantai.test'),
        ('${adminId}', 'admin@bantai.test'),
        ('${userId}', 'member@bantai.test');
      set local app.allow_platform_role_change = 'true';
      update public.profiles set role = 'super_admin' where id = '${superAdminId}';
      update public.profiles set role = 'admin' where id = '${adminId}';
      set local app.allow_platform_role_change = 'false';
    `);

    // 1. Default role for regular user is 'user'
    const defaultRole = (
      await db.query<{ role: string }>("select role from public.profiles where id = $1", [userId])
    ).rows[0].role;
    assert.equal(defaultRole, "user");

    // 2. Regular user cannot self-escalate via direct UPDATE on profiles
    await db.exec(`
      set role authenticated;
      set request.jwt.claim.sub = '${userId}';
    `);
    await assert.rejects(
      db.query("update public.profiles set role = 'super_admin' where id = $1", [userId]),
      /permission denied|Direct modification of platform role is forbidden/
    );

    // 3. Regular user cannot call any platform admin RPCs
    await assert.rejects(db.query("select public.platform_admin_overview()"), /Platform administrator access required/);
    await assert.rejects(db.query("select public.platform_admin_list_users()"), /Platform administrator access required/);
    await assert.rejects(
      db.query("select public.platform_admin_set_user_role($1, 'admin')", [userId]),
      /Super administrator access required/
    );

    // 4. 'admin' can read overview, users, organizations, audit logs, but cannot change roles
    await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
    const overview = (
      await db.query<{ result: { total_users: number; admin_count: number; super_admin_count: number } }>(
        "select public.platform_admin_overview() as result"
      )
    ).rows[0].result;
    assert.equal(overview.total_users, 3);
    assert.equal(overview.admin_count, 1);
    assert.equal(overview.super_admin_count, 1);

    const userList = (
      await db.query<{ result: { users: Array<{ email: string; role: string }>; total: number } }>(
        "select public.platform_admin_list_users('member', null, 25, 0) as result"
      )
    ).rows[0].result;
    assert.equal(userList.total, 1);
    assert.equal(userList.users[0].email, "member@bantai.test");
    assert.equal(userList.users[0].role, "user");

    await assert.rejects(
      db.query("select public.platform_admin_set_user_role($1, 'admin')", [userId]),
      /Super administrator access required/
    );

    // 5. 'super_admin' cannot demote the last remaining super_admin
    await db.exec(`set request.jwt.claim.sub = '${superAdminId}';`);
    await assert.rejects(
      db.query("select public.platform_admin_set_user_role($1, 'user')", [superAdminId]),
      /Cannot demote the last super_admin/
    );

    // 6. 'super_admin' can promote a user to 'admin' and it is logged in audit_logs
    const updated = (
      await db.query<{ result: { id: string; previous_role: string; role: string } }>(
        "select public.platform_admin_set_user_role($1, 'admin') as result",
        [userId]
      )
    ).rows[0].result;
    assert.equal(updated.previous_role, "user");
    assert.equal(updated.role, "admin");

    const logs = (
      await db.query<{ result: { logs: Array<{ action: string; entity_id: string }>; total: number } }>(
        "select public.platform_admin_list_audit_logs('platform_role_updated', 10, 0) as result"
      )
    ).rows[0].result;
    assert.equal(logs.total, 1);
    assert.equal(logs.logs[0].action, "platform_role_updated");
    assert.equal(logs.logs[0].entity_id, userId);

    await db.query(
      "select public.create_typed_organization('Test Council', 'PHP', 'student', '20000000-0000-4000-8000-000000000099')"
    );
    const orgs = (
      await db.query<{
        result: {
          organizations: Array<{ name: string; creator_id: string; creator_email: string }>;
          total: number;
        };
      }>("select public.platform_admin_list_organizations('', 10, 0) as result")
    ).rows[0].result;
    assert.equal(orgs.total, 1);
    assert.equal(orgs.organizations[0].name, "Test Council");
    assert.equal(orgs.organizations[0].creator_id, superAdminId);
    assert.equal(orgs.organizations[0].creator_email, "super@bantai.test");
  } finally {
    await db.close();
  }
});

test("security telemetry and incidents: records events, gates admin views, preserves event immutability, and filters audit logs by date", async () => {
  const db = new PGlite();
  const adminId = "20000000-0000-4000-8000-000000000001";
  const userId = "20000000-0000-4000-8000-000000000002";

  try {
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

    await db.exec(`
      insert into auth.users(id, email) values
        ('${adminId}', 'secadmin@bantai.test'),
        ('${userId}', 'secuser@bantai.test');
      set local app.allow_platform_role_change = 'true';
      update public.profiles set role = 'admin' where id = '${adminId}';
      set local app.allow_platform_role_change = 'false';
    `);

    // 1. Only the backend writer can record security events for a verified actor.
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
    await assert.rejects(
      db.query("select public.record_authenticated_security_event('auth', 'high', 'test', 'denied')"),
      /does not exist/,
    );
    const writeEvent = () => db.query<{ id: string }>(
      `select public.record_authenticated_security_event(
         $1, 'api_abuse', 'high', 'rate_limit_exceeded', 'blocked',
         429, '/organizations', 'req-123', null, '{"source":"test"}'::jsonb
       ) as id`,
      [userId],
    );
    await assert.rejects(writeEvent(), /permission denied/);
    await db.exec("set role anon;");
    await assert.rejects(writeEvent(), /permission denied/);
    await db.exec("set role service_role;");
    const eventRow = (await writeEvent()).rows[0];
    await db.exec("set role authenticated;");
    const eventId = Number(eventRow.id);
    assert.ok(eventId > 0);

    // 2. Non-admin cannot view security overview or create incidents
    for (const rpc of [
      "platform_admin_overview()",
      "platform_admin_list_security_events()",
      "platform_admin_threat_overview(7)",
      "platform_admin_list_incidents()",
    ]) {
      await assert.rejects(db.query(`select public.${rpc}`), /Platform administrator access required/);
    }
    await assert.rejects(
      db.query("select public.platform_admin_security_overview(7)"),
      /Platform administrator access required/,
    );
    await assert.rejects(
      db.query(
        "select public.platform_admin_create_incident('Unauthorized test', 'api_abuse', 'high', null, null, null)",
      ),
      /Platform administrator access required/,
    );

    // 3. Platform admin can inspect overview, events, create & update incidents, and ping health
    await db.exec(`select set_config('request.jwt.claim.sub', '${adminId}', false);`);
    const ping = (
      await db.query<{ platform_admin_health_ping: boolean }>(
        "select public.platform_admin_health_ping()",
      )
    ).rows[0].platform_admin_health_ping;
    assert.equal(ping, true);

    const overview = (
      await db.query<{
        platform_admin_security_overview: {
          rate_limited_429: number;
          errors_5xx: number;
          high_critical_events: number;
          open_incidents: number;
          status_breakdown: { status_403: number; status_429: number; status_5xx: number };
          category_breakdown: { api_abuse: number };
          burst_alerts: Array<{ event_count: number; http_status: number }>;
          daily_trend: unknown[];
        };
      }>(
        "select public.platform_admin_security_overview(7)",
      )
    ).rows[0].platform_admin_security_overview;
    assert.equal(overview.rate_limited_429, 1);
    assert.equal(overview.errors_5xx, 0);
    assert.equal(overview.high_critical_events, 1);
    assert.equal(overview.open_incidents, 0);
    assert.equal(overview.status_breakdown.status_429, 1);
    assert.equal(overview.category_breakdown.api_abuse, 1);
    assert.equal(overview.burst_alerts.length, 0);
    assert.ok(overview.daily_trend.length >= 1);

    // Trigger burst alert (>= 5 429 events from same user within 15m) + 1 5xx event
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); set role service_role;`);
    for (let i = 0; i < 4; i++) {
      await db.query(
        `select public.record_authenticated_security_event(
           '${userId}', 'api_abuse', 'medium', 'rate_limit_exceeded', 'blocked',
           429, '/organizations', $1, null, '{}'::jsonb
         )`,
        [`req-burst-${i}`],
      );
    }
    await db.query(
      `select public.record_authenticated_security_event(
         '${userId}', 'api_abuse', 'high', 'server_error_5xx', 'failed',
         503, '/organizations', 'req-503', null, '{}'::jsonb
       )`,
    );
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', false);`);
    const burstOverview = (
      await db.query<{
        platform_admin_security_overview: {
          errors_5xx: number;
          burst_alerts: Array<{ event_count: number; http_status: number }>;
        };
      }>(
        "select public.platform_admin_security_overview(7)",
      )
    ).rows[0].platform_admin_security_overview;
    assert.equal(burstOverview.errors_5xx, 1);
    assert.equal(burstOverview.burst_alerts.length, 1);
    assert.equal(burstOverview.burst_alerts[0].event_count, 5);
    assert.equal(burstOverview.burst_alerts[0].http_status, 429);

    const eventsRes = (
      await db.query<{ platform_admin_list_security_events: { total: number; events: Array<{ id: number; actor_id: string; request_id: string }> } }>(
        "select public.platform_admin_list_security_events('api_abuse', 'high', null, null, 20, 0)",
      )
    ).rows[0].platform_admin_list_security_events;
    assert.equal(eventsRes.total, 1);
    assert.equal(eventsRes.events[0].actor_id, userId);
    assert.equal(eventsRes.events[0].request_id, "req-123");

    const opEventsRes = (
      await db.query<{
        platform_admin_list_security_events: {
          total: number;
          events: Array<{ actor_id: string | null; requesting_user_id: string | null; request_id: string }>;
        };
      }>(
        "select public.platform_admin_list_security_events('operational', null, null, null, 20, 0, 'operational')",
      )
    ).rows[0].platform_admin_list_security_events;
    assert.equal(opEventsRes.total, 1);
    assert.equal(opEventsRes.events[0].actor_id, null);
    assert.equal(opEventsRes.events[0].requesting_user_id, userId);
    assert.equal(opEventsRes.events[0].request_id, "req-503");

    const created = (
      await db.query<{ platform_admin_create_incident: { id: string; status: string } }>(
        "select public.platform_admin_create_incident('Burst 429s', 'api_abuse', 'high', null, $1::bigint[], 'Investigating burst')",
        [[eventId]],
      )
    ).rows[0].platform_admin_create_incident;
    assert.equal(created.status, "open");

    const updated = (
      await db.query<{ platform_admin_update_incident: { id: string; status: string; resolved_at: string | null } }>(
        "select public.platform_admin_update_incident($1::uuid, 'resolved', 'Confirmed automated client retry', null)",
        [created.id],
      )
    ).rows[0].platform_admin_update_incident;
    assert.equal(updated.status, "resolved");
    assert.ok(updated.resolved_at);

    // 4. Security event remains immutable after incident resolution
    await db.exec("reset role;");
    const persistedEvent = (
      await db.query<{ action: string; outcome: string }>(
        "select action, outcome from public.security_events where id = $1",
        [eventId],
      )
    ).rows[0];
    assert.equal(persistedEvent.action, "rate_limit_exceeded");
    assert.equal(persistedEvent.outcome, "blocked");

    // 5. Audit logs support date filtering and record incident lifecycle
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', false);`);
    const futureIso = new Date(Date.now() + 86_400_000).toISOString();
    const emptyFuture = (
      await db.query<{ platform_admin_list_audit_logs: { total: number } }>(
        "select public.platform_admin_list_audit_logs('', 20, 0, $1::timestamptz, null)",
        [futureIso],
      )
    ).rows[0].platform_admin_list_audit_logs;
    assert.equal(emptyFuture.total, 0);

    const recentLogs = (
      await db.query<{ platform_admin_list_audit_logs: { total: number; logs: Array<{ action: string }> } }>(
        "select public.platform_admin_list_audit_logs('security_incident_updated', 20, 0, null, $1::timestamptz)",
        [futureIso],
      )
    ).rows[0].platform_admin_list_audit_logs;
    assert.equal(recentLogs.total, 1);
    assert.equal(recentLogs.logs[0].action, "security_incident_updated");
  } finally {
    await db.close();
  }
});

test("account & workspace suspension and aggregate financial oversight enforce guards and detect anomalies", async () => {
  const db = new PGlite();
  const adminId = "30000000-0000-4000-8000-000000000001";
  const ownerId = "30000000-0000-4000-8000-000000000002";
  const orgId = "30000000-0000-4000-8000-000000000010";
  const memberId = "30000000-0000-4000-8000-000000000020";
  const budgetId = "30000000-0000-4000-8000-000000000030";

  try {
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

    await db.exec(`
      insert into auth.users(id, email) values
        ('${adminId}', 'platadmin@bantai.test'),
        ('${ownerId}', 'orgowner@bantai.test');
      set local app.allow_platform_role_change = 'true';
      update public.profiles set role = 'admin' where id = '${adminId}';
      set local app.allow_platform_role_change = 'false';

      insert into public.organizations(id, name, currency) values ('${orgId}', 'Oversight Org', 'PHP');
      insert into public.organization_members(id, organization_id, profile_id, role, status)
      values ('${memberId}', '${orgId}', '${ownerId}', 'owner', 'active');

      insert into public.budgets(id, organization_id, name, currency, allocated_amount_centavos, status, created_by)
      values ('${budgetId}', '${orgId}', 'Ops Budget', 'PHP', 10000, 'active', '${ownerId}');

      -- Approved expense exceeding budget (15000 > 10000) + disputed cash advance
      select set_config('request.jwt.claim.sub', '${ownerId}', false);
      insert into public.expenses(organization_id, budget_id, title, category, amount_centavos, currency, incurred_date, submitted_by, status)
      values ('${orgId}', '${budgetId}', 'Overrun Expense', 'operational', 15000, 'PHP', current_date, '${ownerId}', 'approved');

      insert into public.cash_advances(organization_id, budget_id, accountable_person_id, title, purpose, amount_released_centavos, currency, disbursement_method, released_by, status)
      values ('${orgId}', '${budgetId}', '${memberId}', 'Disputed Advance', 'Field ops', 2000, 'PHP', 'cash', '${ownerId}', 'disputed');
    `);

    // 1. Non-admin rejected from suspension & financial oversight RPCs
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', false);`);
    await assert.rejects(
      db.query("select public.platform_admin_financial_overview()"),
      /Platform administrator access required/,
    );
    await assert.rejects(
      db.query("select public.platform_admin_set_org_suspension($1::uuid, true, 'Policy check')", [orgId]),
      /Platform administrator access required/,
    );

    // 2. Platform admin checks financial overview & deterministic anomalies
    await db.exec(`select set_config('request.jwt.claim.sub', '${adminId}', false);`);
    const finOverview = (
      await db.query<{
        platform_admin_financial_overview: {
          workspace_status: { active: number; suspended: number; closed: number };
          by_currency: Array<{
            currency: string;
            budget_allocated_centavos: number;
            approved_expenses_centavos: number;
            disputed_advances_count: number;
          }>;
        };
      }>("select public.platform_admin_financial_overview()")
    ).rows[0].platform_admin_financial_overview;
    assert.equal(finOverview.workspace_status.active, 1);
    const phpRow = finOverview.by_currency.find((c) => c.currency === "PHP");
    assert.ok(phpRow);
    assert.equal(phpRow.budget_allocated_centavos, 10000);
    assert.equal(phpRow.approved_expenses_centavos, 15000);
    assert.equal(phpRow.disputed_advances_count, 1);

    const anomalies = (
      await db.query<{
        platform_admin_financial_anomalies: {
          anomalies: Array<{
            organization_id: string;
            over_budget_count: number;
            disputed_advances_count: number;
          }>;
        };
      }>("select public.platform_admin_financial_anomalies()")
    ).rows[0].platform_admin_financial_anomalies;
    assert.equal(anomalies.anomalies.length, 1);
    assert.equal(anomalies.anomalies[0].over_budget_count, 1);
    assert.equal(anomalies.anomalies[0].disputed_advances_count, 1);

    // 3. Account & workspace suspension require a reason, block mutations, and restore cleanly
    await assert.rejects(
      db.query("select public.platform_admin_set_user_suspension($1::uuid, true, '')", [ownerId]),
      /Suspension reason/,
    );
    await assert.rejects(
      db.query("select public.platform_admin_set_user_suspension($1::uuid, true, 'Self')", [adminId]),
      /Cannot suspend your own account/,
    );

    const userSusp = (
      await db.query<{ platform_admin_set_user_suspension: { suspended: boolean } }>(
        "select public.platform_admin_set_user_suspension($1::uuid, true, 'Abuse investigation')",
        [ownerId],
      )
    ).rows[0].platform_admin_set_user_suspension;
    assert.equal(userSusp.suspended, true);

    const orgSusp = (
      await db.query<{ platform_admin_set_org_suspension: { suspended: boolean } }>(
        "select public.platform_admin_set_org_suspension($1::uuid, true, 'Pending compliance review')",
        [orgId],
      )
    ).rows[0].platform_admin_set_org_suspension;
    assert.equal(orgSusp.suspended, true);

    // Suspended org rejects new financial mutations
    await db.exec("reset role;");
    await assert.rejects(
      db.query(
        `insert into public.budgets(organization_id, name, currency, allocated_amount_centavos, status, created_by)
         values ($1, 'Blocked Budget', 'PHP', 500, 'active', $2)`,
        [orgId, ownerId],
      ),
      /currently suspended by platform administration/,
    );

    // Restore both
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${adminId}', false);`);
    const orgRestored = (
      await db.query<{ platform_admin_set_org_suspension: { suspended: boolean } }>(
        "select public.platform_admin_set_org_suspension($1::uuid, false, 'Cleared')",
        [orgId],
      )
    ).rows[0].platform_admin_set_org_suspension;
    assert.equal(orgRestored.suspended, false);

    // 4. Overview attention summary, Workspace 360, and Financial Compliance RPCs
    const attentionSummary = (
      await db.query<{
        platform_admin_attention_summary: {
          window_days: number;
          active_workspaces: number;
          financial_exceptions_count: number;
          activity_trend: Array<{ day: string; audit_events: number; security_events: number }>;
          attention_items: Array<{ type: string; id: string; title: string; severity: string }>;
        };
      }>("select public.platform_admin_attention_summary(7)")
    ).rows[0].platform_admin_attention_summary;
    assert.equal(attentionSummary.window_days, 7);
    assert.equal(attentionSummary.active_workspaces, 1);
    assert.ok(attentionSummary.financial_exceptions_count >= 1);
    assert.equal(attentionSummary.activity_trend.length, 7);
    assert.ok(attentionSummary.attention_items.some((item) => item.type === "financial_exception"));

    const workspace360 = (
      await db.query<{
        platform_admin_workspace_360: {
          workspace: { id: string; name: string };
          financial_summary: {
            currency: string;
            budget_allocated_centavos: number;
            approved_expenses_centavos: number;
            disputed_advances_count: number;
          };
          role_distribution: Array<{ role: string; count: number }>;
        };
      }>("select public.platform_admin_workspace_360($1::uuid)", [orgId])
    ).rows[0].platform_admin_workspace_360;
    assert.equal(workspace360.workspace.id, orgId);
    assert.equal(workspace360.financial_summary.currency, "PHP");
    assert.equal(workspace360.financial_summary.budget_allocated_centavos, 10000);
    assert.equal(workspace360.financial_summary.approved_expenses_centavos, 15000);
    assert.equal(workspace360.financial_summary.disputed_advances_count, 1);
    assert.ok(workspace360.role_distribution.length >= 1);

    const compliance = (
      await db.query<{
        platform_admin_financial_compliance: {
          budget_compliance: Array<{
            organization_id: string;
            utilization_pct: number;
          }>;
          approval_breakdown: { approved_count: number };
          liquidation_aging: { disputed_count: number };
        };
      }>("select public.platform_admin_financial_compliance()")
    ).rows[0].platform_admin_financial_compliance;
    assert.equal(compliance.budget_compliance.length, 1);
    assert.equal(compliance.budget_compliance[0].organization_id, orgId);
    assert.equal(compliance.budget_compliance[0].utilization_pct, 170);
    assert.equal(compliance.approval_breakdown.approved_count, 1);
    assert.equal(compliance.liquidation_aging.disputed_count, 1);

    // Non-admin rejected from new RPCs
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false);`);
    await assert.rejects(
      db.query("select public.platform_admin_attention_summary(7)"),
      /Platform administrator access required/,
    );
    await assert.rejects(
      db.query("select public.platform_admin_workspace_360($1::uuid)", [orgId]),
      /Platform administrator access required/,
    );
    await assert.rejects(
      db.query("select public.platform_admin_financial_compliance()"),
      /Platform administrator access required/,
    );
  } finally {
    await db.close();
  }
});

test("brute-force protection, durable rate limits, and enforcement actions enforce safety guards", async () => {
  const db = new PGlite();
  try {
    const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
    `);

    await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(dir, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users(id, email) values
        ('${adminId}', 'admin@bantai.test'),
        ('${userId}', 'user@bantai.test');
      set local app.allow_platform_role_change = 'true';
      update public.profiles set role = 'super_admin', display_name = 'Admin' where id = '${adminId}';
      update public.profiles set display_name = 'Standard User' where id = '${userId}';
      set local app.allow_platform_role_change = 'false';
    `);

    // 1. Durable rate limiter enforces window limit
    const r1 = (
      await db.query<{ consume_rate_limit: { allowed: boolean; remaining: number } }>(
        "select public.consume_rate_limit('test:ip1', 60, 2)",
      )
    ).rows[0].consume_rate_limit;
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 1);

    await db.query("select public.consume_rate_limit('test:ip1', 60, 2)");
    const r3 = (
      await db.query<{ consume_rate_limit: { allowed: boolean; remaining: number } }>(
        "select public.consume_rate_limit('test:ip1', 60, 2)",
      )
    ).rows[0].consume_rate_limit;
    assert.equal(r3.allowed, false);
    assert.equal(r3.remaining, 0);

    // 2. Automated brute-force detection: 5 attempts => progressive delay; 10 attempts => auto IP restriction
    const attackerIp = "203.0.113.42";
    for (let i = 1; i <= 5; i += 1) {
      await db.query(
        "select public.record_edge_security_event($1, 'auth', 'medium', 'unauthorized_auth_attempt', 'denied', 401, '/user/profile', $2)",
        [attackerIp, `req-${i}`],
      );
    }
    const check5 = (
      await db.query<{ check_source_restriction: { restricted: boolean; delay_ms: number } }>(
        "select public.check_source_restriction($1)",
        [attackerIp],
      )
    ).rows[0].check_source_restriction;
    assert.equal(check5.restricted, false);
    assert.ok(check5.delay_ms > 0);

    for (let i = 6; i <= 10; i += 1) {
      await db.query(
        "select public.record_edge_security_event($1, 'auth', 'medium', 'unauthorized_auth_attempt', 'denied', 401, '/user/profile', $2)",
        [attackerIp, `req-${i}`],
      );
    }
    const check10 = (
      await db.query<{ check_source_restriction: { restricted: boolean } }>(
        "select public.check_source_restriction($1)",
        [attackerIp],
      )
    ).rows[0].check_source_restriction;
    assert.equal(check10.restricted, true);

    // 3. Non-admin rejected from threat overview & enforcement
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
    await assert.rejects(
      db.query("select public.platform_admin_threat_overview(7)"),
      /Platform administrator access required/,
    );
    await assert.rejects(
      db.query("select public.platform_admin_enforce_action('temp_ip_block', 'Abuse', $1, null, 30)", [attackerIp]),
      /Platform administrator access required/,
    );

    // 4. Super admin enforces actions & safety guards prevent self-lockout / last-super-admin lockout
    await db.exec(`select set_config('request.jwt.claim.sub', '${adminId}', false);`);
    await assert.rejects(
      db.query("select public.platform_admin_enforce_action('temp_account_lock', 'Self lock', null, $1::uuid, 30)", [adminId]),
      /Cannot restrict or revoke your own active administrator session/,
    );

    await db.query(
      "select public.platform_admin_enforce_action('temp_account_lock', 'Suspicious activity', null, $1::uuid, 30)",
      [userId],
    );
    await db.query(
      "select public.platform_admin_enforce_action('revoke_sessions', 'Token compromise', null, $1::uuid, 60)",
      [userId],
    );

    const overview = (
      await db.query<{
        platform_admin_threat_overview: {
          active_threats: number;
          restricted_ips: number;
          restricted_accounts: number;
          suspicious_sources: Array<{ source_ip: string; attempts: number; restriction_status: string }>;
          account_lockouts: Array<{ user_id: string }>;
          enforcement_history: Array<{ action_type: string }>;
        };
      }>("select public.platform_admin_threat_overview(7)")
    ).rows[0].platform_admin_threat_overview;
    assert.ok(overview.active_threats >= 1);
    assert.ok(overview.restricted_ips >= 1);
    assert.ok(overview.restricted_accounts >= 1);
    assert.ok(overview.suspicious_sources.some((s) => s.source_ip === attackerIp && s.attempts === 10));
    assert.ok(overview.account_lockouts.some((l) => l.user_id === userId));
    assert.ok(overview.enforcement_history.some((h) => h.action_type === "revoke_sessions"));

    // Clear IP & user restrictions
    await db.query(
      "select public.platform_admin_enforce_action('remove_restriction', 'Verified clear', $1, null, 60)",
      [attackerIp],
    );
    const clearedCheck = (
      await db.query<{ check_source_restriction: { restricted: boolean } }>(
        "select public.check_source_restriction($1)",
        [attackerIp],
      )
    ).rows[0].check_source_restriction;
    assert.equal(clearedCheck.restricted, false);
  } finally {
    await db.close();
  }
});

test("operational 503 classification, deduplication, actor attribution, and brute-force isolation", async () => {
  // 1. Unit assertions on classifySecurityEvent
  const op503 = classifySecurityEvent(503, "/admin/attention-summary");
  assert.ok(op503);
  assert.equal(op503.category, "operational");
  assert.equal(op503.severity, "low");
  assert.equal(op503.enforcementEligible, false);

  const sec403Admin = classifySecurityEvent(403, "/admin/users");
  assert.ok(sec403Admin);
  assert.equal(sec403Admin.category, "access_control");
  assert.equal(sec403Admin.severity, "high");
  assert.equal(sec403Admin.enforcementEligible, true);

  const sec429 = classifySecurityEvent(429, "/organizations");
  assert.ok(sec429);
  assert.equal(sec429.category, "api_abuse");
  assert.equal(sec429.enforcementEligible, false);

  // 2. PGlite DB assertions: operational 503s preserve requesting_user_id, null actor_id, deduplicate, and never trigger lockouts
  const db = new PGlite();
  try {
    const adminId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
    `);
    await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(dir, file), "utf8"));
    }
    await db.exec(`
      insert into auth.users(id, email) values ('${adminId}', 'super@bantai.test');
      set local app.allow_platform_role_change = 'true';
      update public.profiles set role = 'super_admin', display_name = 'Super Admin' where id = '${adminId}';
      set local app.allow_platform_role_change = 'false';
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${adminId}', false);
    `);

    await db.exec("set role service_role;");
    const id1 = (
      await db.query<{ record_authenticated_security_event: string }>(
        "select public.record_authenticated_security_event($1, 'operational', 'low', 'service_unavailable_503', 'failed', 503, '/admin/attention-summary', 'req-1', null, '{}', 'database', 'Backend RPC unavailable', false, 300)",
        [adminId],
      )
    ).rows[0].record_authenticated_security_event;

    const id2 = (
      await db.query<{ record_authenticated_security_event: string }>(
        "select public.record_authenticated_security_event($1, 'operational', 'low', 'service_unavailable_503', 'failed', 503, '/admin/attention-summary', 'req-2', null, '{}', 'database', 'Backend RPC unavailable', false, 300)",
        [adminId],
      )
    ).rows[0].record_authenticated_security_event;

    // Identical 503 within window deduplicates to the same row with occurrence_count = 2
    assert.equal(id1, id2);

    await db.exec("set role authenticated;");
    const opList = (
      await db.query<{
        platform_admin_list_security_events: {
          events: Array<{
            event_class: string;
            actor_id: string | null;
            requesting_user_id: string | null;
            occurrence_count: number;
            enforcement_eligible: boolean;
          }>;
        };
      }>("select public.platform_admin_list_security_events(null, null, null, null, 20, 0, 'operational')")
    ).rows[0].platform_admin_list_security_events;
    assert.equal(opList.events.length, 1);
    assert.equal(opList.events[0].event_class, "operational");
    assert.equal(opList.events[0].actor_id, null);
    assert.equal(opList.events[0].requesting_user_id, adminId);
    assert.equal(opList.events[0].occurrence_count, 2);
    assert.equal(opList.events[0].enforcement_eligible, false);

    // Security overview excludes operational 503 from high_critical_events & burst_alerts
    const secOverview = (
      await db.query<{
        platform_admin_security_overview: { high_critical_events: number; errors_5xx: number; burst_alerts: unknown[] };
      }>("select public.platform_admin_security_overview(7)")
    ).rows[0].platform_admin_security_overview;
    assert.equal(secOverview.high_critical_events, 0);
    assert.equal(secOverview.errors_5xx, 2);
    assert.equal(secOverview.burst_alerts.length, 0);

    // Edge 503s never increment brute-force counters or restrict IP
    await db.exec("reset role;");
    for (let i = 0; i < 12; i += 1) {
      await db.query(
        "select public.record_edge_security_event('198.51.100.99', 'operational', 'low', 'service_unavailable_503', 'failed', 503, '/admin/financial/overview', $1)",
        [`edge-503-${i}`],
      );
    }
    await db.exec("set role authenticated;");
    const check503Ip = (
      await db.query<{ check_source_restriction: { restricted: boolean; delay_ms: number } }>(
        "select public.check_source_restriction('198.51.100.99')",
      )
    ).rows[0].check_source_restriction;
    assert.equal(check503Ip.restricted, false);
    assert.equal(check503Ip.delay_ms, 0);

    const { rows: [combined] } = await db.query<{ total: number; errors: number }>(
      `select
        (public.platform_admin_list_security_events(p_event_class => 'operational')->>'total')::int as total,
        (public.platform_admin_security_overview(7)->>'errors_5xx')::int as errors`,
    );
    assert.deepEqual(combined, { total: 13, errors: 14 });

    // A live grouping can span the reporting boundary, but the card attributes
    // the entire group to the first occurrence.
    await db.exec("reset role;");
    await db.query("update public.security_events set occurred_at = now() - interval '8 days' where id = $1", [id1]);
    await db.exec("set role authenticated;");
    const { rows: [outsideWindow] } = await db.query<{ errors: number }>(
      "select (public.platform_admin_security_overview(7)->>'errors_5xx')::int as errors",
    );
    assert.equal(outsideWindow.errors, 12);

    // Integrate the same service-only writers used by authentication and the monitor.
    const sessionId = "90000000-0000-4000-8000-000000000001";
    await db.exec("reset role");
    await db.query("insert into auth.sessions(id, user_id) values ($1, $2)", [sessionId, adminId]);
    await db.query("update public.profiles set locked_until=now() + interval '1 minute' where id=$1", [adminId]);
    await db.exec("set role service_role");
    for (let i = 0; i < 2; i++) {
      await db.query("select public.bantai_record_login_success($1,$2,$3)", [adminId, sessionId, "monitor-login"]);
    }
    for (let i = 0; i < 5; i++) {
      await db.query(
        "select public.record_authenticated_security_event($1,'auth','low','OTP_FAILED','failed',400)",
        [adminId],
      );
    }
    for (const ip of ["192.0.2.11", "192.0.2.12", "192.0.2.13"]) {
      await db.query(
        `select public.record_edge_security_event($1,'auth','low','LOGIN_FAILED','denied',401,
          '/auth/login',null,'{"username_typed":"monitoruser"}')`, [ip],
      );
    }
    await db.query("select public.bantai_run_security_monitor()");
    const repeated = await db.query<{ inserted: number }>(
      "select (public.bantai_run_security_monitor()->>'inserted')::int as inserted",
    );
    assert.equal(repeated.rows[0].inserted, 0);

    await db.exec("reset role");
    const actions = await db.query<{ action: string; total: number }>(
      `select action, count(*)::int as total from public.security_events
       where action in ('LOGIN_SUCCESS','ACCOUNT_LOCKED') group by action order by action`,
    );
    assert.deepEqual(actions.rows, [{ action: "ACCOUNT_LOCKED", total: 1 }, { action: "LOGIN_SUCCESS", total: 1 }]);

    await db.exec("set role authenticated");
    const flags = await db.query<{ flags: Array<{ pattern: string; occurred_at: string }> }>(
      "select public.platform_admin_threat_overview_with_flags(7)->'monitor_flags' as flags",
    );
    assert.ok(flags.rows[0].flags.some(flag => flag.pattern === "otp_guessing" && flag.occurred_at));
    assert.ok(flags.rows[0].flags.some(flag => flag.pattern === "account_targeted" && flag.occurred_at));
    const metrics = await db.query<{ overview: {
      login_failures_hourly: Array<{ failures: number }>;
      top_login_failure_ips: Array<{ ip: string; failures: number; blocked: boolean }>;
    } }>("select public.platform_admin_threat_overview_with_flags(7) as overview");
    const { login_failures_hourly: hourly, top_login_failure_ips: topIps } = metrics.rows[0].overview;
    assert.equal(hourly.length, 24);
    assert.equal(hourly.reduce((sum, point) => sum + point.failures, 0), 3);
    assert.deepEqual(topIps, ["192.0.2.11", "192.0.2.12", "192.0.2.13"].map(ip =>
      ({ ip, failures: 1, blocked: false })));
    await db.exec("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(db.query("select public.platform_admin_threat_overview_with_flags(7)"),
      /Platform administrator access required/);
    await assert.rejects(db.query("select public.bantai_run_security_monitor()"), /permission denied/);
  } finally {
    await db.close();
  }
});
