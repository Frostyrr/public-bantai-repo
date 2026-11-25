import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("private monitor finds four patterns and writes each daily flag once", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema bantai_private;
      create table public.security_events (
        occurred_at timestamptz, action text, source_ip text, actor_id uuid,
        metadata jsonb default '{}', event_class text default 'security'
      );
      insert into public.security_events(occurred_at, action, source_ip, metadata)
      select now() - (i * interval '40 seconds'), 'LOGIN_FAILED', '192.0.2.1',
        jsonb_build_object('username_typed', case when i = 1 then ' TargetUser ' else 'other' end)
      from generate_series(1, 10) i;
      insert into public.security_events(occurred_at, action, source_ip, metadata) values
        (now(), 'LOGIN_FAILED', '192.0.2.2', '{"username_typed":"targetuser"}'),
        (now(), 'LOGIN_FAILED', '192.0.2.3', '{"username_typed":"TARGETUSER"}');
      insert into public.security_events(occurred_at, action, actor_id)
      select now() - (i * interval '40 seconds'), 'OTP_FAILED', '00000000-0000-4000-8000-000000000001'
      from generate_series(1, 5) i;
      insert into public.security_events(occurred_at, action, actor_id)
      values (
        case when (now() at time zone 'Asia/Manila')::time >= time '02:00'
          then (date_trunc('day', now() at time zone 'Asia/Manila') + interval '2 hours') at time zone 'Asia/Manila'
          else (date_trunc('day', now() at time zone 'Asia/Manila') - interval '22 hours') at time zone 'Asia/Manila' end,
        'LOGIN_SUCCESS', '00000000-0000-4000-8000-000000000001'
      );
      insert into public.security_events(occurred_at, action, source_ip, event_class)
      select now() - interval '1 minute', 'LOGIN_FAILED', '192.0.2.4', 'operational'
      from generate_series(1, 10);
    `);
    const migration = await readFile(
      new URL("../../supabase/migrations/202611170009_private_security_monitor.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    const run = () => db.query<{ result: unknown }>("select public.bantai_run_security_monitor() as result");
    await db.exec("set role authenticated");
    await assert.rejects(run(), /permission denied/);
    await db.exec("set role service_role");
    const expected = {
      scanned: 18,
      findings: 4,
      inserted: 4,
      byPattern: { ip_threshold: 1, account_targeted: 1, otp_guessing: 1, off_hours_login: 1 },
    };
    assert.deepEqual((await run()).rows[0].result, expected);
    assert.deepEqual((await run()).rows[0].result, { ...expected, inserted: 0 });
  } finally {
    await db.close();
  }
});
