import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("credential restrictions enforce tier and IP boundaries without extending active blocks", async () => {
  const db = new PGlite();
  const user = "00000000-0000-4000-8000-000000000001";
  const session = "00000000-0000-4000-8000-000000000002";
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await db.exec(await readFile(new URL("./fixtures/supabase-session-auth.sql", import.meta.url), "utf8"));
    const dir = new URL("../../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    await db.query("insert into auth.users(id,email) values ($1,'member@example.test')", [user]);
    await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, user]);
    await db.exec(`
      create or replace function bantai_private.session_now() returns timestamptz
      language sql volatile set search_path = ''
      as $$ select current_setting('bantai.test_clock')::timestamptz $$;
    `);
    const start = Date.now() + 60_000;
    const clock = (seconds: number) => db.query("select set_config('bantai.test_clock',$1,false)",
      [new Date(start + seconds * 1000).toISOString()]);
    const attempt = async (email: string | null, identifier: string, ip: string) =>
      (await db.query<{ retry: number }>(
        "select (public.bantai_record_login_failure($1,$2,$3,null,'Fixture browser')->>'retry_after')::int as retry",
        [email, identifier, ip],
      )).rows[0].retry;
    const check = async (email: string | null, identifier: string, ip: string) =>
      (await db.query<{ retry: number }>(
        "select (public.bantai_login_restriction($1,$2,$3)->>'retry_after')::int as retry",
        [email, identifier, ip],
      )).rows[0].retry;
    const fail = (identifier = "Member01") => attempt("member@example.test", identifier, "192.0.2.1");

    await clock(0);
    await db.exec("set role authenticated");
    await assert.rejects(fail(), /permission denied/);
    await assert.rejects(check(null, "Member01", "192.0.2.1"), /permission denied/);
    await db.exec("set role service_role");
    const suggestRecovery = async () => (await db.query<{ suggested: boolean }>(
      "select (public.bantai_login_restriction('member@example.test','Member01','192.0.2.1')->>'suggest_recovery')::boolean as suggested",
    )).rows[0].suggested;
    assert.equal(await fail(), 0);
    assert.equal(await suggestRecovery(), false);
    assert.equal(await fail("member@example.test"), 0);
    assert.equal(await suggestRecovery(), true);
    assert.equal(await fail("MEMBER01"), 15);
    await clock(14);
    assert.equal(await fail(), 1);
    assert.equal(await check("member@example.test", "member@example.test", "192.0.2.2"), 1);

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
      [user, JSON.stringify({ role: "authenticated", sub: user, session_id: session, aal: "aal1" })]);
    await assert.rejects(db.exec("select bantai_gateway.check_session()"), /Account access is restricted/);
    const result = await db.query<{ allowed: boolean }>("select public.bantai_storage_session_allowed() as allowed");
    assert.equal(result.rows[0].allowed, false);

    await db.exec("set role service_role");
    await clock(15);
    assert.equal(await check("member@example.test", "Member01", "192.0.2.1"), 0);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 30);
    await clock(45);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 60);

    // The first event is exactly ten minutes old and does not count.
    const ip = "192.0.2.8";
    await clock(200);
    assert.equal(await attempt(null, "unknownzero", ip), 0);
    await clock(800);
    for (let i = 1; i <= 9; i++) assert.equal(await attempt(null, "unknown" + i, ip), 0);
    await clock(801);
    assert.equal(await attempt(null, "unknownten", ip), 600);
    await clock(1400);
    assert.equal(await attempt(null, "differentidentity", ip), 1);
    await clock(1401);
    assert.equal(await check(null, "differentidentity", ip), 0);

    await db.exec("reset role");
    const events = await db.query<{ action: string; total: number }>(
      `select action, count(*)::int as total from public.security_events
       where action in ('IP_BLOCKED','LOCKOUT_TIER_1','LOCKOUT_TIER_2','LOCKOUT_TIER_3')
       group by action order by action`,
    );
    assert.deepEqual(events.rows, ["IP_BLOCKED", "LOCKOUT_TIER_1", "LOCKOUT_TIER_2", "LOCKOUT_TIER_3"]
      .map(action => ({ action, total: 1 })));
    assert.equal((await db.query("select 1 from public.security_events where action='ACCOUNT_LOCKED'")).rows.length, 0);

    await db.query("update auth.users set email_confirmed_at=now(), encrypted_password='fixture-old' where id=$1", [user]);
    await db.query("update auth.users set encrypted_password='fixture-new' where id=$1", [user]);
    await db.query("update auth.users set recovery_sent_at=now() where id=$1", [user]);
    const lifecycle = await db.query<{ action: string }>(
      "select action from public.security_events where action in ('REGISTERED','ACCOUNT_VERIFIED','RESET_REQUESTED') order by id",
    );
    assert.deepEqual(lifecycle.rows.map(event => event.action), ["REGISTERED", "ACCOUNT_VERIFIED", "RESET_REQUESTED"]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select public.bantai_claim_security_alerts()"), /permission denied/);
    await db.exec("set role service_role");
    const queue = await db.query<{ id: string; attempt: number; email: string; metadata: { source_ip?: string; user_agent?: string } }>(
      "select id, attempt, email, metadata from public.bantai_claim_security_alerts()",
    );
    assert.equal(queue.rows.length, 3);
    assert.ok(queue.rows.every(row => row.email === "member@example.test"));
    assert.equal(queue.rows.filter(row => row.metadata.source_ip === "192.0.2.1"
      && row.metadata.user_agent === "Fixture browser").length, 3);
    assert.equal((await db.query("select * from public.bantai_claim_security_alerts()")).rows.length, 0);
    const first = queue.rows[0];
    const finish = () => db.query<{ sent: boolean }>(
      "select public.bantai_finish_security_alert($1,$2,'sent') as sent", [first.id, first.attempt],
    );
    assert.equal((await finish()).rows[0].sent, true);
    assert.equal((await finish()).rows[0].sent, false);
    await db.exec("reset role");
    assert.equal((await db.query("select 1 from public.security_events where action='ALERT_EMAIL_SENT'")).rows.length, 1);
    const delivery = await db.query<{ state: string }>(
      "select metadata->>'delivery_state' as state from public.security_events where action='ALERT_EMAIL_SENT'",
    );
    assert.equal(delivery.rows[0].state, "provider_accepted");
    assert.equal((await db.query("select 1 from public.notification_delivery_queue where message='PASSWORD_CHANGED'")).rows.length, 0);
    await db.query("update public.notification_delivery_queue set scheduled_for=now() - interval '1 second' where id=$1", [queue.rows[1].id]);
    await db.exec("set role service_role");
    assert.equal((await db.query("select * from public.bantai_claim_security_alerts()")).rows.length, 0);
    const last = queue.rows[2];
    await db.query("select public.bantai_finish_security_alert($1,$2,'retry')", [last.id, last.attempt]);
    await db.exec("reset role");
    const status = await db.query<{ status: string; last_error: string }>(
      "select status,last_error from public.notification_delivery_queue where id=$1", [queue.rows[1].id],
    );
    assert.deepEqual(status.rows[0], { status: "failed", last_error: "delivery_unconfirmed" });
    await db.query("update public.notification_delivery_queue set scheduled_for=now() - interval '1 second' where id=$1", [last.id]);
    await db.exec("set role service_role");
    assert.deepEqual((await db.query("select id,attempt from public.bantai_claim_security_alerts()")).rows,
      [{ id: last.id, attempt: 2 }]);
    await db.exec("reset role");
    const passwordEvent = await db.query<{ metadata: unknown }>(
      "select metadata from public.security_events where action='PASSWORD_CHANGED'",
    );
    assert.deepEqual(passwordEvent.rows, [{ metadata: {} }]);

    // Clearing only the visible profile lock used to leave the private lock in
    // force. Both a direct repair and the admin RPC must reset the same account.
    await clock(1500);
    await db.query("update public.profiles set locked_until=null, lock_reason=null where id=$1", [user]);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 15);
    await db.query("update public.profiles set locked_until=null, lock_reason=null where id=$1", [user]);
    assert.equal(await check("member@example.test", "Member01", "192.0.2.2"), 0);
    assert.equal((await db.query("select 1 from bantai_private.login_failure_streaks where target=$1", [user])).rows.length, 0);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 15);

    const admin = "00000000-0000-4000-8000-000000000003";
    await db.query("insert into auth.users(id,email) values ($1,'admin@example.test')", [admin]);
    await db.exec("set app.allow_platform_role_change='true'");
    await db.query("update public.profiles set role='super_admin' where id=$1", [admin]);
    await db.exec("set app.allow_platform_role_change='false'");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    await db.query(
      "select public.platform_admin_enforce_action('remove_restriction','Verified account unlock',null,$1::uuid,60)", [user],
    );
    await db.exec("reset role");
    assert.equal(await check("member@example.test", "Member01", "192.0.2.2"), 0);
    assert.equal((await db.query("select 1 from bantai_private.login_failure_streaks where target=$1", [user])).rows.length, 0);
    assert.equal((await db.query("select 1 from public.audit_logs where action='platform_enforcement_remove_restriction'")).rows.length, 1);
    // Resetting the failure streak starts at tier one rather than relocking at
    // the next tier on the very next bad credential.
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 0);
    assert.equal(await fail(), 15);
  } finally {
    await db.close();
  }
});
