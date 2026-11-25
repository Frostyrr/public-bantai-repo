begin;

create table bantai_private.security_monitor_flags (
  pattern text not null,
  target text not null,
  flag_day date not null,
  detected_at timestamptz not null default now(),
  occurrences bigint not null,
  primary key (pattern, target, flag_day)
);
alter table bantai_private.security_monitor_flags enable row level security;
revoke all on bantai_private.security_monitor_flags from public, anon, authenticated;

create function public.bantai_run_security_monitor()
returns jsonb language sql volatile security definer set search_path = ''
as $$
  with events as materialized (
    select occurred_at, action, source_ip, actor_id,
      lower(nullif(btrim(metadata->>'username_typed'), '')) as username
    from public.security_events
    where occurred_at >= now() - interval '24 hours'
      and occurred_at <= now()
      and event_class = 'security'
      and action in ('LOGIN_FAILED', 'LOGIN_SUCCESS', 'OTP_FAILED')
  ), ip_windows as (
    select source_ip, occurred_at,
      count(*) over (partition by source_ip order by occurred_at
        range between interval '10 minutes' preceding and current row) as hits
    from events where action = 'LOGIN_FAILED' and source_ip is not null
  ), otp_windows as (
    select actor_id, occurred_at,
      count(*) over (partition by actor_id order by occurred_at
        range between interval '10 minutes' preceding and current row) as hits
    from events where action = 'OTP_FAILED' and actor_id is not null
  ), candidates as (
    select 'ip_threshold' as pattern, source_ip as target,
      (occurred_at at time zone 'Asia/Manila')::date as flag_day, hits
    from ip_windows where hits >= 10
    union all
    select 'account_targeted', username, (now() at time zone 'Asia/Manila')::date,
      count(distinct source_ip)
    from events where action = 'LOGIN_FAILED' and username is not null
    group by username having count(distinct source_ip) >= 3
    union all
    select 'otp_guessing', actor_id::text,
      (occurred_at at time zone 'Asia/Manila')::date, hits
    from otp_windows where hits >= 5
    union all
    select 'off_hours_login', actor_id::text,
      (occurred_at at time zone 'Asia/Manila')::date, 1::bigint
    from events where action = 'LOGIN_SUCCESS' and actor_id is not null
      and (occurred_at at time zone 'Asia/Manila')::time < time '05:00'
  ), findings as materialized (
    select pattern, target, flag_day, max(hits) as occurrences
    from candidates group by pattern, target, flag_day
  ), inserted as (
    insert into bantai_private.security_monitor_flags(pattern, target, flag_day, occurrences)
    select pattern, target, flag_day, occurrences from findings
    on conflict (pattern, target, flag_day) do nothing
    returning pattern
  )
  select jsonb_build_object(
    'scanned', (select count(*) from events),
    'findings', (select count(*) from findings),
    'inserted', (select count(*) from inserted),
    'byPattern', (select coalesce(jsonb_object_agg(pattern, total), '{}'::jsonb)
      from (select pattern, count(*) as total from findings group by pattern) totals)
  );
$$;

revoke all on function public.bantai_run_security_monitor() from public, anon, authenticated;
grant execute on function public.bantai_run_security_monitor() to service_role;

commit;
