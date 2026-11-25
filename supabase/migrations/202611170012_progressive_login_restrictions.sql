begin;

create table bantai_private.login_failure_streaks (
  target text primary key,
  failures integer not null,
  locked_until timestamptz,
  last_failure_at timestamptz not null
);
alter table bantai_private.login_failure_streaks enable row level security;
revoke all on bantai_private.login_failure_streaks from public, anon, authenticated;

create function bantai_private.login_target(p_email text, p_identifier text)
returns table(target text, user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select coalesce(u.id::text, 'unknown:' || md5(lower(p_identifier))), u.id
  from (select 1) seed
  left join auth.users u on lower(u.email) = lower(p_email)
  order by u.id limit 1
$$;

create function public.bantai_login_restriction(p_email text, p_identifier text, p_ip text)
returns jsonb language sql volatile security definer set search_path = ''
as $$
  with state as (
    select greatest(s.locked_until, p.locked_until) as account_end,
      case when ip.status = 'restricted' then coalesce(ip.expires_at, bantai_private.session_now() + interval '10 minutes') end as ip_end
    from bantai_private.login_target(p_email, p_identifier) t
    left join bantai_private.login_failure_streaks s on s.target = t.target
    left join public.profiles p on p.id = t.user_id
    left join public.source_restrictions ip on ip.source_ip = p_ip
  )
  select jsonb_build_object('retry_after', greatest(0, ceil(extract(epoch from
    (greatest(account_end, ip_end) - bantai_private.session_now())))::integer))
  from state
$$;

-- Server-only writer. The caller records only provider-confirmed bad credentials.
create function public.bantai_record_login_failure(p_email text, p_identifier text, p_ip text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_target text;
  v_user uuid;
  v_now timestamptz;
  v_retry integer;
  v_failures integer;
  v_locked_until timestamptz;
  v_ip_failures integer;
begin
  select t.target, t.user_id into strict v_target, v_user from bantai_private.login_target(p_email, p_identifier) t;
  -- Always take source lock before account lock. Different sources may target one account.
  if p_ip is not null then perform pg_advisory_xact_lock(10701, hashtext(p_ip)); end if;
  perform pg_advisory_xact_lock(10702, hashtext(v_target));
  v_retry := (public.bantai_login_restriction(p_email, p_identifier, p_ip)->>'retry_after')::integer;
  if v_retry > 0 then return jsonb_build_object('retry_after', v_retry); end if;
  v_now := bantai_private.session_now();

  insert into bantai_private.login_failure_streaks as streak(target, failures, last_failure_at)
  values (v_target, 1, v_now)
  on conflict (target) do update set last_failure_at = excluded.last_failure_at,
    failures = case when streak.failures >= 9 or
      (v_user is null and streak.last_failure_at < v_now - interval '24 hours')
      then 1 else streak.failures + 1 end
  returning failures into v_failures;

  -- This exact credential event is excluded from the older broad edge cooldown
  -- counters. Those counters only consider denied, blocked and failed outcomes.
  insert into public.security_events(category, event_class, event_source, severity,
    action, outcome, actor_id, source_ip, http_status, route, request_id, metadata, occurred_at)
  values ('auth', 'security', 'auth', 'low', 'LOGIN_FAILED', 'flagged',
    v_user, p_ip, 401, '/auth/login', left(p_request_id, 64),
    jsonb_build_object('username_typed', case when strpos(p_identifier, '@') = 0 then left(p_identifier, 20) end), v_now);

  v_locked_until := case v_failures
    when 3 then v_now + interval '15 seconds'
    when 6 then v_now + interval '30 seconds'
    when 9 then v_now + interval '60 seconds'
  end;
  if v_locked_until is not null then
    update bantai_private.login_failure_streaks set locked_until = v_locked_until where target = v_target;
    update public.profiles set locked_until = greatest(locked_until, v_locked_until)
      where id = v_user and (locked_until is null or locked_until <= v_now);
  end if;

  if p_ip is not null then
    select count(*) into v_ip_failures from public.security_events
    where source_ip = p_ip and action = 'LOGIN_FAILED'
      and occurred_at > v_now - interval '10 minutes' and occurred_at <= v_now;
    if v_ip_failures >= 10 then
      insert into public.source_restrictions as restriction
        (source_ip, status, reason, attempts_count, expires_at, auto_triggered)
      values (p_ip, 'restricted', 'Credential failure threshold', v_ip_failures, v_now + interval '10 minutes', true)
      on conflict (source_ip) do update set status = excluded.status, reason = excluded.reason,
        attempts_count = excluded.attempts_count, expires_at = excluded.expires_at,
        auto_triggered = true, updated_at = v_now
      where restriction.status <> 'restricted' or restriction.expires_at <= v_now;
      if found then
        insert into public.security_events(category, event_class, event_source, severity,
          action, outcome, source_ip, route, request_id, metadata, occurred_at)
        values ('auth', 'security', 'auth', 'low', 'IP_BLOCKED', 'flagged',
          p_ip, '/auth/login', left(p_request_id, 64), jsonb_build_object('failures', v_ip_failures,
          'expires_at', v_now + interval '10 minutes'), v_now);
      end if;
    end if;
  end if;
  return public.bantai_login_restriction(p_email, p_identifier, p_ip);
end;
$$;

-- Keep manual lockouts and credential tiers in the same authoritative trigger.
create or replace function bantai_private.record_account_lock_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_failures integer;
begin
  select failures into v_failures from bantai_private.login_failure_streaks
    where target = new.id::text and locked_until = new.locked_until;
  perform public.record_authenticated_security_event(
    new.id, 'auth', 'low',
    case when v_failures in (3, 6, 9) then 'LOCKOUT_TIER_' || (v_failures / 3)::text else 'ACCOUNT_LOCKED' end,
    'blocked', null, null, null, null,
    jsonb_build_object('locked_until', new.locked_until, 'failures', v_failures), 'database'
  );
  return new;
end;
$$;

-- Clear only attempts predating the newly verified session. A late first use
-- of an older session cannot clear failures recorded after that sign-in.
create function bantai_private.clear_verified_login_streak()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from bantai_private.login_failure_streaks s using auth.sessions live
    where live.id = new.session_id and s.target = live.user_id::text
      and s.last_failure_at <= live.created_at;
  return new;
end;
$$;

create trigger clear_verified_login_streak after insert on bantai_private.monitored_login_sessions
for each row execute function bantai_private.clear_verified_login_streak();

revoke all on function bantai_private.login_target(text, text), bantai_private.clear_verified_login_streak(),
  public.bantai_login_restriction(text, text, text), public.bantai_record_login_failure(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bantai_login_restriction(text, text, text),
  public.bantai_record_login_failure(text, text, text, text) to service_role;

commit;
