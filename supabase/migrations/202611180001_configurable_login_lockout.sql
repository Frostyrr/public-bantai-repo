begin;

-- Configurable lockout thresholds, stored next to the session timeout policy.
insert into public.platform_settings (key, value, updated_reason)
values ('login_lockout', jsonb_build_object(
  'account_failures_per_tier', 3,
  'account_tier_seconds', jsonb_build_array(15, 30, 60),
  'ip_failure_threshold', 10,
  'ip_window_seconds', 600,
  'ip_block_seconds', 600,
  'edge_failure_threshold', 10,
  'edge_window_seconds', 900,
  'edge_block_seconds', 900
), 'Initial login lockout defaults')
on conflict (key) do nothing;

create or replace function bantai_private.lockout_policy()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'account_failures_per_tier', 3,
    'account_tier_seconds', jsonb_build_array(15, 30, 60),
    'ip_failure_threshold', 10, 'ip_window_seconds', 600, 'ip_block_seconds', 600,
    'edge_failure_threshold', 10, 'edge_window_seconds', 900, 'edge_block_seconds', 900
  ) || coalesce((select value from public.platform_settings where key = 'login_lockout'), '{}'::jsonb)
$$;
revoke all on function bantai_private.lockout_policy() from public, anon, authenticated;

-- Default IP block duration now follows the policy.
create or replace function public.bantai_login_restriction(p_email text, p_identifier text, p_ip text)
returns jsonb language sql volatile security definer set search_path = ''
as $$
  with state as (
    select coalesce(s.failures, 0) as failures,
      greatest(s.locked_until, p.locked_until) as account_end,
      case when ip.status = 'restricted' then coalesce(ip.expires_at, bantai_private.session_now()
        + make_interval(secs => (bantai_private.lockout_policy()->>'ip_block_seconds')::integer)) end as ip_end
    from bantai_private.login_target(p_email, p_identifier) t
    left join bantai_private.login_failure_streaks s on s.target = t.target
    left join public.profiles p on p.id = t.user_id
    left join public.source_restrictions ip on ip.source_ip = p_ip
  )
  select jsonb_build_object('retry_after', greatest(0, ceil(extract(epoch from
    (greatest(account_end, ip_end) - bantai_private.session_now())))::integer),
    'suggest_recovery', failures >= 2)
  from state
$$;

create or replace function public.bantai_record_login_failure(p_email text, p_identifier text, p_ip text, p_request_id text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_policy jsonb := bantai_private.lockout_policy();
  v_step integer := greatest(1, (v_policy->>'account_failures_per_tier')::integer);
  v_tiers jsonb := v_policy->'account_tier_seconds';
  v_tier_count integer := greatest(1, jsonb_array_length(v_policy->'account_tier_seconds'));
  v_ip_threshold integer := greatest(1, (v_policy->>'ip_failure_threshold')::integer);
  v_ip_window interval := make_interval(secs => (v_policy->>'ip_window_seconds')::integer);
  v_ip_block interval := make_interval(secs => (v_policy->>'ip_block_seconds')::integer);
  v_target text;
  v_user uuid;
  v_now timestamptz;
  v_retry integer;
  v_failures integer;
  v_locked_until timestamptz;
  v_ip_failures integer := 0;
  v_remaining integer;
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
    failures = case when streak.failures >= v_step * v_tier_count or
      (v_user is null and streak.last_failure_at < v_now - interval '24 hours')
      then 1 else streak.failures + 1 end
  returning failures into v_failures;

  insert into public.security_events(category, event_class, event_source, severity,
    action, outcome, actor_id, source_ip, http_status, route, request_id, metadata, occurred_at)
  values ('auth', 'security', 'auth', 'low', 'LOGIN_FAILED', 'flagged',
    v_user, p_ip, 401, '/auth/login', left(p_request_id, 64),
    jsonb_build_object('username_typed', case when strpos(p_identifier, '@') = 0 then left(p_identifier, 20) end,
      'user_agent', left(p_user_agent, 300)), v_now);

  if v_failures % v_step = 0 then
    v_locked_until := v_now + make_interval(secs => coalesce((v_tiers->>(v_failures / v_step - 1))::integer, 60));
    update bantai_private.login_failure_streaks set locked_until = v_locked_until where target = v_target;
    update public.profiles set locked_until = greatest(locked_until, v_locked_until)
      where id = v_user and (locked_until is null or locked_until <= v_now);
  end if;

  if p_ip is not null then
    select count(*) into v_ip_failures from public.security_events
    where source_ip = p_ip and action = 'LOGIN_FAILED'
      and occurred_at > v_now - v_ip_window and occurred_at <= v_now;
    if v_ip_failures >= v_ip_threshold then
      insert into public.source_restrictions as restriction
        (source_ip, status, reason, attempts_count, expires_at, auto_triggered)
      values (p_ip, 'restricted', 'Credential failure threshold', v_ip_failures, v_now + v_ip_block, true)
      on conflict (source_ip) do update set status = excluded.status, reason = excluded.reason,
        attempts_count = excluded.attempts_count, expires_at = excluded.expires_at,
        auto_triggered = true, updated_at = v_now
      where restriction.status <> 'restricted' or restriction.expires_at <= v_now;
      if found then
        insert into public.security_events(category, event_class, event_source, severity,
          action, outcome, source_ip, route, request_id, metadata, occurred_at)
        values ('auth', 'security', 'auth', 'low', 'IP_BLOCKED', 'flagged',
          p_ip, '/auth/login', left(p_request_id, 64), jsonb_build_object('failures', v_ip_failures,
          'expires_at', v_now + v_ip_block), v_now);
      end if;
    end if;
  end if;

  v_remaining := v_step - (v_failures % v_step);
  if p_ip is not null then v_remaining := least(v_remaining, greatest(0, v_ip_threshold - v_ip_failures)); end if;
  return public.bantai_login_restriction(p_email, p_identifier, p_ip)
    || jsonb_build_object('attempts_remaining', v_remaining);
end;
$$;

create or replace function bantai_private.record_account_lock_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_failures integer;
  v_request_id text;
  v_metadata jsonb;
  v_step integer := greatest(1, (bantai_private.lockout_policy()->>'account_failures_per_tier')::integer);
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
    case when v_failures > 0 and v_failures % v_step = 0 then 'LOCKOUT_TIER_' || (v_failures / v_step)::text else 'ACCOUNT_LOCKED' end,
     'blocked', null, null, v_request_id, null,
    coalesce(v_metadata, '{}'::jsonb)
      || jsonb_build_object('locked_until', new.locked_until, 'failures', v_failures), 'database'
  );
  return new;
end;
$$;

-- Edge events: 429 responses are a consequence of throttling, not evidence of abuse.
-- They are still recorded but never counted toward (or trigger) an IP block.
create or replace function public.record_edge_security_event(
  p_source_ip text, p_category text, p_severity text, p_action text, p_outcome text,
  p_http_status integer, p_route text, p_request_id text, p_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_policy jsonb := bantai_private.lockout_policy();
  v_threshold integer := greatest(1, (v_policy->>'edge_failure_threshold')::integer);
  v_window interval := make_interval(secs => (v_policy->>'edge_window_seconds')::integer);
  v_block interval := make_interval(secs => (v_policy->>'edge_block_seconds')::integer);
  v_now timestamptz := now();
  v_is_operational boolean := (p_category = 'operational' or coalesce(p_http_status, 0) >= 500);
  v_counts boolean := coalesce(p_http_status, 0) <> 429;
  v_recent integer := 0;
  v_distinct_routes integer := 0;
  v_threat_score integer := 0;
  v_auto_restricted boolean := false;
begin
  if p_category not in ('auth', 'access_control', 'financial', 'api_abuse', 'data_protection', 'operational') then
    raise exception 'Invalid security event category';
  end if;
  if p_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Invalid security event severity';
  end if;

  if v_is_operational then
    insert into public.security_events (
      category, event_class, event_source, severity, action, outcome,
      http_status, route, request_id, source_ip, threat_score,
      enforcement_eligible, classification_reason, metadata
    ) values (
      'operational', 'operational', 'api',
      case when p_http_status = 503 then 'low' else 'medium' end,
      left(trim(p_action), 120), p_outcome, p_http_status, left(p_route, 200),
      left(p_request_id, 64), nullif(trim(coalesce(p_source_ip, '')), ''), 0,
      false, 'Operational HTTP 5xx response (excluded from brute-force scoring)',
      coalesce(p_metadata, '{}'::jsonb)
    );
    return jsonb_build_object('recorded', true, 'threat_score', 0, 'auto_restricted', false);
  end if;

  if p_source_ip is not null and length(trim(p_source_ip)) > 0 then
    select count(*), count(distinct route) into v_recent, v_distinct_routes
    from public.security_events
    where source_ip = p_source_ip and event_class = 'security'
      and occurred_at >= v_now - v_window
      and outcome in ('denied', 'blocked', 'failed')
      and coalesce(http_status, 0) <> 429;
  end if;

  v_threat_score := least(100,
    (case p_severity when 'critical' then 40 when 'high' then 25 when 'medium' then 15 else 5 end)
    + (v_recent * 6) + (case when v_distinct_routes >= 3 then 15 else 0 end));

  insert into public.security_events (
    category, event_class, event_source, severity, action, outcome,
    http_status, route, request_id, source_ip, threat_score,
    enforcement_eligible, classification_reason, metadata
  ) values (
    p_category, 'security', 'middleware', p_severity, left(trim(p_action), 120), p_outcome,
    p_http_status, left(p_route, 200), left(p_request_id, 64),
    nullif(trim(coalesce(p_source_ip, '')), ''), v_threat_score,
    v_counts and (v_recent + 1) >= greatest(1, v_threshold / 2),
    case when v_counts then 'Edge security event from unauthenticated/unauthorized traffic'
      else 'Throttled request (excluded from IP block scoring)' end,
    coalesce(p_metadata, '{}'::jsonb)
  );

  if not v_counts or p_source_ip is null or length(trim(p_source_ip)) = 0 then
    return jsonb_build_object('recorded', true, 'threat_score', v_threat_score, 'auto_restricted', false);
  end if;

  if (v_recent + 1) >= v_threshold then
    insert into public.source_restrictions (
      source_ip, status, reason, risk_score, attempts_count, auto_triggered, expires_at, updated_at
    ) values (
      p_source_ip, 'restricted',
      'Automated cooldown: repeated unauthorized or failed authentication attempts',
      v_threat_score, v_recent + 1, true, v_now + v_block, v_now
    )
    on conflict (source_ip) do update set
      status = 'restricted',
      reason = excluded.reason,
      risk_score = greatest(public.source_restrictions.risk_score, v_threat_score),
      attempts_count = public.source_restrictions.attempts_count + 1,
      auto_triggered = true,
      expires_at = greatest(coalesce(public.source_restrictions.expires_at, v_now), v_now + v_block),
      updated_at = v_now;
    v_auto_restricted := true;

    if not exists (
      select 1 from public.security_incidents
      where status in ('open', 'investigating') and event_class = 'security'
        and title like '%' || p_source_ip || '%' and detected_at >= v_now - interval '30 minutes'
    ) then
      insert into public.security_incidents (title, category, event_class, severity, status, resolution_notes)
      values ('Automated Brute-Force Cooldown: ' || p_source_ip,
        case when p_category = 'auth' then 'auth' else 'api_abuse' end, 'security', 'high', 'open',
        'Auto-triggered after ' || (v_recent + 1) || ' failed/denied requests.');
    end if;
  elsif (v_recent + 1) >= greatest(1, v_threshold / 2) then
    insert into public.source_restrictions (
      source_ip, status, reason, risk_score, attempts_count, auto_triggered, updated_at
    ) values (p_source_ip, 'monitoring', 'Elevated failed request frequency', v_threat_score, v_recent + 1, true, v_now)
    on conflict (source_ip) do update set
      status = case when public.source_restrictions.status = 'restricted' then 'restricted' else 'monitoring' end,
      risk_score = greatest(public.source_restrictions.risk_score, v_threat_score),
      attempts_count = public.source_restrictions.attempts_count + 1,
      updated_at = v_now;
  end if;

  return jsonb_build_object('recorded', true, 'threat_score', v_threat_score, 'auto_restricted', v_auto_restricted);
end;
$$;

-- Progressive delay ignores throttled (429) responses too.
create or replace function public.check_source_restriction(p_source_ip text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_rec record;
  v_recent_5m integer := 0;
  v_delay_ms integer := 0;
begin
  if p_source_ip is null or length(trim(p_source_ip)) = 0 then
    return jsonb_build_object('restricted', false, 'delay_ms', 0);
  end if;

  select status, reason, expires_at into v_rec
  from public.source_restrictions where source_ip = p_source_ip;

  if found and v_rec.status = 'restricted' then
    if v_rec.expires_at is null or v_rec.expires_at > v_now then
      return jsonb_build_object('restricted', true, 'reason', v_rec.reason,
        'expires_at', v_rec.expires_at, 'delay_ms', 0);
    else
      update public.source_restrictions set status = 'cleared', updated_at = v_now
      where source_ip = p_source_ip and status = 'restricted';
    end if;
  end if;

  select count(*) into v_recent_5m
  from public.security_events
  where source_ip = p_source_ip and event_class = 'security'
    and occurred_at >= v_now - interval '5 minutes'
    and outcome in ('denied', 'blocked', 'failed')
    and coalesce(http_status, 0) <> 429;

  if v_recent_5m >= 5 then
    v_delay_ms := least(2000, (v_recent_5m - 4) * 350);
  end if;
  return jsonb_build_object('restricted', false, 'delay_ms', v_delay_ms);
end;
$$;

-- Platform admin read / super admin write.
create or replace function public.get_platform_login_lockout()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;
  return bantai_private.lockout_policy() || coalesce((
    select jsonb_build_object('updated_reason', updated_reason, 'updated_at', updated_at)
    from public.platform_settings where key = 'login_lockout'), '{}'::jsonb);
end;
$$;

create or replace function public.admin_set_login_lockout(p_policy jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_before jsonb;
  v_after jsonb;
  v_tier jsonb;
  v_now timestamptz := now();
begin
  perform pg_advisory_xact_lock(1145130580, 2);
  if not public.is_platform_admin(true) then
    raise exception 'Super administrator access required';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'Invalid reason. A documented reason of 3 to 500 characters is required.';
  end if;
  v_after := jsonb_build_object(
    'account_failures_per_tier', (p_policy->>'account_failures_per_tier')::integer,
    'account_tier_seconds', p_policy->'account_tier_seconds',
    'ip_failure_threshold', (p_policy->>'ip_failure_threshold')::integer,
    'ip_window_seconds', (p_policy->>'ip_window_seconds')::integer,
    'ip_block_seconds', (p_policy->>'ip_block_seconds')::integer,
    'edge_failure_threshold', (p_policy->>'edge_failure_threshold')::integer,
    'edge_window_seconds', (p_policy->>'edge_window_seconds')::integer,
    'edge_block_seconds', (p_policy->>'edge_block_seconds')::integer
  );
  if (v_after->>'account_failures_per_tier')::integer not between 1 and 20
    or (v_after->>'ip_failure_threshold')::integer not between 3 and 1000
    or (v_after->>'edge_failure_threshold')::integer not between 3 and 1000
    or (v_after->>'ip_window_seconds')::integer not between 60 and 86400
    or (v_after->>'edge_window_seconds')::integer not between 60 and 86400
    or (v_after->>'ip_block_seconds')::integer not between 30 and 86400
    or (v_after->>'edge_block_seconds')::integer not between 30 and 86400
    or jsonb_typeof(v_after->'account_tier_seconds') <> 'array'
    or jsonb_array_length(v_after->'account_tier_seconds') not between 1 and 10 then
    raise exception 'Invalid lockout policy values.';
  end if;
  for v_tier in select * from jsonb_array_elements(v_after->'account_tier_seconds') loop
    if jsonb_typeof(v_tier) <> 'number' or v_tier::text::integer not between 1 and 86400 then
      raise exception 'Each account tier must be 1 to 86400 seconds.';
    end if;
  end loop;

  select value into v_before from public.platform_settings where key = 'login_lockout';
  update public.platform_settings
  set value = v_after, updated_by = v_actor, updated_reason = v_reason, updated_at = v_now
  where key = 'login_lockout';

  insert into public.audit_logs (organization_id, actor_id, action, entity_id, before_value, after_value)
  values (null, v_actor, 'platform_login_lockout_updated', v_actor, v_before,
    v_after || jsonb_build_object('reason', v_reason));
  return v_after || jsonb_build_object('updated_reason', v_reason, 'updated_at', v_now);
end;
$$;

revoke all on function public.get_platform_login_lockout() from public, anon;
grant execute on function public.get_platform_login_lockout() to authenticated;
revoke all on function public.admin_set_login_lockout(jsonb, text) from public, anon;
grant execute on function public.admin_set_login_lockout(jsonb, text) to authenticated;

commit;
