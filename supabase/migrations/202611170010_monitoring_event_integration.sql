begin;

create table bantai_private.monitored_login_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade
);
alter table bantai_private.monitored_login_sessions enable row level security;
revoke all on bantai_private.monitored_login_sessions from public, anon, authenticated;

-- Called only after Express has verified the token, session, and MFA.
create function public.bantai_record_login_success(p_user uuid, p_session uuid, p_request_id text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into bantai_private.monitored_login_sessions(session_id)
  select id from auth.sessions
  where id = p_session and user_id = p_user and created_at >= now() - interval '24 hours'
  on conflict do nothing;
  if found then
    perform public.record_authenticated_security_event(
      p_user, 'access_control', 'low', 'LOGIN_SUCCESS', 'flagged', 200,
      '/user', p_request_id, null, '{"boundary":"protected_profile"}', 'auth'
    );
  end if;
end;
$$;
revoke all on function public.bantai_record_login_success(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.bantai_record_login_success(uuid, uuid, text) to service_role;

create function bantai_private.record_account_lock_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.record_authenticated_security_event(
    new.id, 'auth', 'low', 'ACCOUNT_LOCKED', 'blocked', null,
    null, null, null, jsonb_build_object('locked_until', new.locked_until), 'database'
  );
  return new;
end;
$$;
revoke all on function bantai_private.record_account_lock_event() from public, anon, authenticated;

create trigger monitor_account_lock after update of locked_until on public.profiles
for each row when (new.locked_until is distinct from old.locked_until and new.locked_until > now())
execute function bantai_private.record_account_lock_event();

alter table bantai_private.security_monitor_flags add column occurred_at timestamptz;

create or replace function public.bantai_run_security_monitor()
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
      (occurred_at at time zone 'Asia/Manila')::date as flag_day, hits, occurred_at
    from ip_windows where hits >= 10
    union all
    select 'account_targeted', username, (now() at time zone 'Asia/Manila')::date,
      count(distinct source_ip), max(occurred_at)
    from events where action = 'LOGIN_FAILED' and username is not null
    group by username having count(distinct source_ip) >= 3
    union all
    select 'otp_guessing', actor_id::text,
      (occurred_at at time zone 'Asia/Manila')::date, hits, occurred_at
    from otp_windows where hits >= 5
    union all
    select 'off_hours_login', actor_id::text,
      (occurred_at at time zone 'Asia/Manila')::date, 1::bigint, occurred_at
    from events where action = 'LOGIN_SUCCESS' and actor_id is not null
      and (occurred_at at time zone 'Asia/Manila')::time < time '05:00'
  ), findings as materialized (
    select pattern, target, flag_day, max(hits) as occurrences, max(occurred_at) as occurred_at
    from candidates group by pattern, target, flag_day
  ), inserted as (
    insert into bantai_private.security_monitor_flags(pattern, target, flag_day, occurrences, occurred_at)
    select pattern, target, flag_day, occurrences, occurred_at from findings
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

create function public.platform_admin_threat_overview_with_flags(p_days integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_overview jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;
  v_overview := public.platform_admin_threat_overview(p_days);
  return v_overview || jsonb_build_object('monitor_flags', (
    select coalesce(jsonb_agg(to_jsonb(flag) order by detected_at desc, pattern, target), '[]'::jsonb)
    from (
      select pattern, target, flag_day, detected_at, occurred_at, occurrences
      from bantai_private.security_monitor_flags
      where detected_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)))
      order by detected_at desc, pattern, target limit 50
    ) flag
  ));
end;
$$;
revoke all on function public.platform_admin_threat_overview_with_flags(integer) from public, anon, authenticated;
grant execute on function public.platform_admin_threat_overview_with_flags(integer) to authenticated;

commit;
