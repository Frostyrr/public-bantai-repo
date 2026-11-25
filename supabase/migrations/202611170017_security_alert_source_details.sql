begin;

drop function public.bantai_record_login_failure(text, text, text, text);

create function public.bantai_record_login_failure(p_email text, p_identifier text, p_ip text, p_request_id text, p_user_agent text default null)
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
    jsonb_build_object('username_typed', case when strpos(p_identifier, '@') = 0 then left(p_identifier, 20) end,
      'user_agent', left(p_user_agent, 300)), v_now);

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
declare
  v_failures integer;
  v_request_id text;
  v_metadata jsonb;
begin
  select streak.failures, event.request_id,
    jsonb_build_object('source_ip', event.source_ip, 'user_agent', event.metadata->>'user_agent')
  into v_failures, v_request_id, v_metadata
  from bantai_private.login_failure_streaks streak
  left join public.security_events event on event.actor_id = new.id and event.action = 'LOGIN_FAILED'
    and event.occurred_at = streak.last_failure_at
  where streak.target = new.id::text and streak.locked_until = new.locked_until
  order by event.id desc limit 1;
  perform public.record_authenticated_security_event(
    new.id, 'auth', 'low',
    case when v_failures in (3, 6, 9) then 'LOCKOUT_TIER_' || (v_failures / 3)::text else 'ACCOUNT_LOCKED' end,
     'blocked', null, null, v_request_id, null,
    coalesce(v_metadata, '{}'::jsonb)
      || jsonb_build_object('locked_until', new.locked_until, 'failures', v_failures), 'database'
  );
  return new;
end;
$$;

create or replace function bantai_private.enqueue_security_alert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.actor_id is not null then
    insert into public.notification_delivery_queue
      (recipient_user_id, channel, notification_type, title, message, metadata)
    values (new.actor_id, 'email', 'security.auth_alert',
      case when new.action = 'PASSWORD_CHANGED' then 'Your Bantai password was changed'
        else 'Failed sign-in attempts on your Bantai account' end,
      new.action,
      jsonb_build_object('occurred_at', new.occurred_at, 'failures', new.metadata->'failures',
        'source_ip', new.metadata->'source_ip', 'user_agent', new.metadata->'user_agent'));
  end if;
  return new;
end;
$$;

revoke all on function public.bantai_record_login_failure(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bantai_record_login_failure(text, text, text, text, text) to service_role;

commit;
