-- Brute-force protection, durable rate-limiting, temporary IP/account restrictions,
-- session revocation timestamps, and administrative enforcement history.
begin;

alter table public.profiles
  add column if not exists locked_until timestamptz,
  add column if not exists lock_reason text,
  add column if not exists sessions_revoked_at timestamptz;

alter table public.security_events
  add column if not exists source_ip text,
  add column if not exists threat_score integer not null default 0;

create index if not exists idx_security_events_source_ip_time
  on public.security_events (source_ip, occurred_at desc)
  where source_ip is not null;

create table if not exists public.source_restrictions (
  id uuid primary key default gen_random_uuid(),
  source_ip text not null unique,
  status text not null check (status in ('monitoring', 'restricted', 'cleared')),
  reason text not null,
  risk_score integer not null default 0,
  attempts_count integer not null default 0,
  auto_triggered boolean not null default false,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.source_restrictions enable row level security;

create table if not exists public.enforcement_actions (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (
    action_type in (
      'monitor',
      'temp_ip_block',
      'temp_account_lock',
      'revoke_sessions',
      'suspend_account',
      'remove_restriction'
    )
  ),
  target_type text not null check (target_type in ('ip', 'user')),
  target_ip text,
  target_user_id uuid references auth.users(id) on delete set null,
  duration_minutes integer,
  reason text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  auto_triggered boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_enforcement_actions_created_at
  on public.enforcement_actions (created_at desc);

alter table public.enforcement_actions enable row level security;

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  window_start timestamptz not null default now(),
  request_count integer not null default 1
);

alter table public.rate_limit_buckets enable row level security;

-- Durable rate limiter compatible with serverless deployments
create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_window_seconds integer,
  p_max_requests integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_window interval := make_interval(secs => greatest(1, p_window_seconds));
  v_count integer;
  v_start timestamptz;
  v_retry integer;
begin
  insert into public.rate_limit_buckets (bucket_key, window_start, request_count)
  values (p_bucket_key, v_now, 1)
  on conflict (bucket_key) do update
  set
    request_count = case
      when public.rate_limit_buckets.window_start + v_window <= v_now then 1
      else public.rate_limit_buckets.request_count + 1
    end,
    window_start = case
      when public.rate_limit_buckets.window_start + v_window <= v_now then v_now
      else public.rate_limit_buckets.window_start
    end
  returning request_count, window_start into v_count, v_start;

  v_retry := greatest(1, ceil(extract(epoch from (v_start + v_window - v_now)))::integer);

  return jsonb_build_object(
    'allowed', v_count <= p_max_requests,
    'remaining', greatest(0, p_max_requests - v_count),
    'retry_after_seconds', v_retry
  );
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer) to anon, authenticated;

-- Check whether an IP currently has an active restriction or progressive delay
create or replace function public.check_source_restriction(p_source_ip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

  select status, reason, expires_at
  into v_rec
  from public.source_restrictions
  where source_ip = p_source_ip;

  if found and v_rec.status = 'restricted' then
    if v_rec.expires_at is null or v_rec.expires_at > v_now then
      return jsonb_build_object(
        'restricted', true,
        'reason', v_rec.reason,
        'expires_at', v_rec.expires_at,
        'delay_ms', 0
      );
    else
      update public.source_restrictions
      set status = 'cleared', updated_at = v_now
      where source_ip = p_source_ip and status = 'restricted';
    end if;
  end if;

  select count(*) into v_recent_5m
  from public.security_events
  where source_ip = p_source_ip
    and occurred_at >= v_now - interval '5 minutes'
    and outcome in ('denied', 'blocked', 'failed');

  if v_recent_5m >= 5 then
    v_delay_ms := least(2000, (v_recent_5m - 4) * 350);
  end if;

  return jsonb_build_object(
    'restricted', false,
    'delay_ms', v_delay_ms
  );
end;
$$;

revoke all on function public.check_source_restriction(text) from public;
grant execute on function public.check_source_restriction(text) to anon, authenticated;

-- Record unauthenticated/edge security event and apply automated brute-force rules
create or replace function public.record_edge_security_event(
  p_source_ip text,
  p_category text,
  p_severity text,
  p_action text,
  p_outcome text,
  p_http_status integer,
  p_route text,
  p_request_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_recent_15m integer := 0;
  v_distinct_routes integer := 0;
  v_threat_score integer := 10;
  v_auto_restricted boolean := false;
begin
  if p_category not in ('auth', 'access_control', 'financial', 'api_abuse', 'data_protection') then
    raise exception 'Invalid security event category';
  end if;
  if p_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Invalid security event severity';
  end if;

  if p_source_ip is not null and length(trim(p_source_ip)) > 0 then
    select
      count(*),
      count(distinct route)
    into v_recent_15m, v_distinct_routes
    from public.security_events
    where source_ip = p_source_ip
      and occurred_at >= v_now - interval '15 minutes'
      and outcome in ('denied', 'blocked', 'failed');
  end if;

  v_threat_score := least(
    100,
    (case p_severity when 'critical' then 40 when 'high' then 25 when 'medium' then 15 else 5 end)
    + (v_recent_15m * 6)
    + (case when v_distinct_routes >= 3 then 15 else 0 end)
  );

  insert into public.security_events (
    category, severity, action, outcome, http_status, route, request_id,
    source_ip, threat_score, metadata
  ) values (
    p_category, p_severity, p_action, p_outcome, p_http_status, p_route, p_request_id,
    nullif(trim(coalesce(p_source_ip, '')), ''), v_threat_score, coalesce(p_metadata, '{}'::jsonb)
  );

  -- Policy: 10+ failed/unauthorized attempts in 15 minutes => temporary 15m source IP restriction
  if p_source_ip is not null and length(trim(p_source_ip)) > 0 and (v_recent_15m + 1) >= 10 then
    insert into public.source_restrictions (
      source_ip, status, reason, risk_score, attempts_count, auto_triggered, expires_at, updated_at
    ) values (
      p_source_ip,
      'restricted',
      'Automated 15m cooldown: repeated unauthorized or failed authentication attempts',
      v_threat_score,
      v_recent_15m + 1,
      true,
      v_now + interval '15 minutes',
      v_now
    )
    on conflict (source_ip) do update
    set
      status = 'restricted',
      reason = 'Automated 15m cooldown: repeated unauthorized or failed authentication attempts',
      risk_score = greatest(public.source_restrictions.risk_score, v_threat_score),
      attempts_count = public.source_restrictions.attempts_count + 1,
      auto_triggered = true,
      expires_at = greatest(coalesce(public.source_restrictions.expires_at, v_now), v_now + interval '15 minutes'),
      updated_at = v_now;

    v_auto_restricted := true;

    -- Escalate incident if none open for this IP in the last 30 minutes
    if not exists (
      select 1 from public.security_incidents
      where status in ('open', 'investigating')
        and title like '%' || p_source_ip || '%'
        and detected_at >= v_now - interval '30 minutes'
    ) then
      insert into public.security_incidents (
        title, category, severity, status, resolution_notes
      ) values (
        'Automated Brute-Force Cooldown: ' || p_source_ip,
        case when p_category = 'auth' then 'auth' else 'api_abuse' end,
        'high',
        'open',
        'Auto-triggered after ' || (v_recent_15m + 1) || ' failed/denied requests in 15m.'
      );
    end if;
  elsif p_source_ip is not null and length(trim(p_source_ip)) > 0 and (v_recent_15m + 1) >= 5 then
    -- Policy: 5+ failed attempts => monitor source
    insert into public.source_restrictions (
      source_ip, status, reason, risk_score, attempts_count, auto_triggered, updated_at
    ) values (
      p_source_ip,
      'monitoring',
      'Elevated failed request frequency (5+ in 15m)',
      v_threat_score,
      v_recent_15m + 1,
      true,
      v_now
    )
    on conflict (source_ip) do update
    set
      status = case when public.source_restrictions.status = 'restricted' then 'restricted' else 'monitoring' end,
      risk_score = greatest(public.source_restrictions.risk_score, v_threat_score),
      attempts_count = public.source_restrictions.attempts_count + 1,
      updated_at = v_now;
  end if;

  return jsonb_build_object(
    'recorded', true,
    'threat_score', v_threat_score,
    'auto_restricted', v_auto_restricted
  );
end;
$$;

revoke all on function public.record_edge_security_event(text, text, text, text, text, integer, text, text, jsonb) from public;
grant execute on function public.record_edge_security_event(text, text, text, text, text, integer, text, text, jsonb) to anon, authenticated;

-- Threat Detection Overview RPC for Security Center -> Threat Detection
create or replace function public.platform_admin_threat_overview(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_active_threats bigint;
  v_blocked_requests bigint;
  v_restricted_accounts bigint;
  v_restricted_ips bigint;
  v_unresolved_incidents bigint;
  v_trend jsonb;
  v_heatmap jsonb;
  v_sources jsonb;
  v_lockouts jsonb;
  v_history jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select count(*) into v_active_threats
  from public.source_restrictions
  where status in ('monitoring', 'restricted')
    and (expires_at is null or expires_at > now());

  select count(*) into v_blocked_requests
  from public.security_events
  where occurred_at >= v_since
    and outcome in ('blocked', 'denied')
    and http_status in (401, 403, 429);

  select count(*) into v_restricted_accounts
  from public.profiles
  where suspended_at is not null
     or (locked_until is not null and locked_until > now());

  select count(*) into v_restricted_ips
  from public.source_restrictions
  where status = 'restricted'
    and (expires_at is null or expires_at > now());

  select count(*) into v_unresolved_incidents
  from public.security_incidents
  where status in ('open', 'investigating');

  with days_series as (
    select generate_series(
      date_trunc('day', now() at time zone 'UTC') - make_interval(days => v_days - 1),
      date_trunc('day', now() at time zone 'UTC'),
      interval '1 day'
    ) as d
  ),
  daily as (
    select
      date_trunc('day', occurred_at at time zone 'UTC') as d,
      count(*) filter (where http_status = 401 or category = 'auth') as failed_auth,
      count(*) filter (where outcome = 'blocked' or http_status = 429) as blocked_requests
    from public.security_events
    where occurred_at >= v_since
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', to_char(ds.d, 'YYYY-MM-DD'),
    'failed_auth', coalesce(da.failed_auth, 0),
    'blocked_requests', coalesce(da.blocked_requests, 0)
  ) order by ds.d), '[]'::jsonb)
  into v_trend
  from days_series ds
  left join daily da on da.d = ds.d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'dow', dow,
    'hour', hr,
    'count', cnt
  )), '[]'::jsonb)
  into v_heatmap
  from (
    select
      extract(dow from (occurred_at at time zone 'UTC'))::integer as dow,
      extract(hour from (occurred_at at time zone 'UTC'))::integer as hr,
      count(*) as cnt
    from public.security_events
    where occurred_at >= v_since
    group by 1, 2
  ) hm;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_ip', src.source_ip,
    'attempts', src.attempts,
    'risk_score', src.risk_score,
    'risk_level', case
      when src.risk_score >= 70 then 'critical'
      when src.risk_score >= 45 then 'high'
      when src.risk_score >= 25 then 'medium'
      else 'low'
    end,
    'last_detected', src.last_detected,
    'restriction_status', coalesce(sr.status, 'none'),
    'expires_at', sr.expires_at,
    'reason', sr.reason
  ) order by src.risk_score desc, src.attempts desc), '[]'::jsonb)
  into v_sources
  from (
    select
      source_ip,
      count(*) as attempts,
      max(threat_score) as risk_score,
      max(occurred_at) as last_detected
    from public.security_events
    where source_ip is not null
      and occurred_at >= v_since
    group by source_ip
    order by max(threat_score) desc, count(*) desc
    limit 25
  ) src
  left join public.source_restrictions sr on sr.source_ip = src.source_ip;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id,
    'display_name', p.display_name,
    'email', u.email,
    'role', p.role,
    'locked_until', p.locked_until,
    'lock_reason', p.lock_reason,
    'suspended_at', p.suspended_at,
    'suspension_reason', p.suspension_reason,
    'sessions_revoked_at', p.sessions_revoked_at
  ) order by coalesce(p.locked_until, p.suspended_at, p.sessions_revoked_at) desc), '[]'::jsonb)
  into v_lockouts
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.suspended_at is not null
     or (p.locked_until is not null and p.locked_until > now())
     or p.sessions_revoked_at is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ea.id,
    'action_type', ea.action_type,
    'target_type', ea.target_type,
    'target_ip', ea.target_ip,
    'target_user_id', ea.target_user_id,
    'target_name', p.display_name,
    'duration_minutes', ea.duration_minutes,
    'reason', ea.reason,
    'actor_name', ap.display_name,
    'auto_triggered', ea.auto_triggered,
    'expires_at', ea.expires_at,
    'created_at', ea.created_at
  ) order by ea.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select * from public.enforcement_actions
    order by created_at desc
    limit 30
  ) ea
  left join public.profiles p on p.id = ea.target_user_id
  left join public.profiles ap on ap.id = ea.actor_user_id;

  return jsonb_build_object(
    'window_days', v_days,
    'active_threats', v_active_threats,
    'blocked_requests', v_blocked_requests,
    'restricted_accounts', v_restricted_accounts,
    'restricted_ips', v_restricted_ips,
    'unresolved_incidents', v_unresolved_incidents,
    'failed_auth_trend', v_trend,
    'activity_heatmap', v_heatmap,
    'suspicious_sources', v_sources,
    'account_lockouts', v_lockouts,
    'enforcement_history', v_history
  );
end;
$$;

revoke all on function public.platform_admin_threat_overview(integer) from public;
grant execute on function public.platform_admin_threat_overview(integer) to authenticated;

-- Authorized Administrative Enforcement RPC ("Take Action" controls)
create or replace function public.platform_admin_enforce_action(
  p_action_type text,
  p_reason text,
  p_target_ip text default null,
  p_target_user_id uuid default null,
  p_duration_minutes integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_duration integer := least(greatest(coalesce(p_duration_minutes, 60), 5), 43200);
  v_expires timestamptz := now() + make_interval(mins => v_duration);
  v_target_type text;
  v_target_role text;
  v_super_admin_count bigint;
  v_action_id uuid;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Enforcement reason must be at least 3 characters';
  end if;

  if p_action_type not in (
    'monitor',
    'temp_ip_block',
    'temp_account_lock',
    'revoke_sessions',
    'suspend_account',
    'remove_restriction'
  ) then
    raise exception 'Invalid enforcement action type';
  end if;

  if p_action_type in ('monitor', 'temp_ip_block') or (p_action_type = 'remove_restriction' and p_target_ip is not null) then
    if p_target_ip is null or length(trim(p_target_ip)) = 0 then
      raise exception 'Target IP is required for this action';
    end if;
    v_target_type := 'ip';
  else
    if p_target_user_id is null then
      raise exception 'Target user ID is required for this action';
    end if;
    v_target_type := 'user';
  end if;

  -- Safety guards: prevent self-lockout and prevent locking out all super_admins
  if v_target_type = 'user' then
    if p_target_user_id = v_actor and p_action_type in ('temp_account_lock', 'suspend_account', 'revoke_sessions') then
      raise exception 'Cannot restrict or revoke your own active administrator session';
    end if;

    select role into v_target_role from public.profiles where id = p_target_user_id;
    if not found then
      raise exception 'Target user profile not found';
    end if;

    if v_target_role = 'super_admin' and p_action_type in ('temp_account_lock', 'suspend_account') then
      select count(*) into v_super_admin_count
      from public.profiles
      where role = 'super_admin'
        and suspended_at is null
        and (locked_until is null or locked_until <= now());

      if v_super_admin_count <= 1 then
        raise exception 'Cannot lock or suspend the last active super administrator';
      end if;
    end if;
  end if;

  if p_action_type = 'monitor' then
    insert into public.source_restrictions (
      source_ip, status, reason, created_by, updated_at
    ) values (
      p_target_ip, 'monitoring', v_reason, v_actor, now()
    )
    on conflict (source_ip) do update
    set status = 'monitoring', reason = v_reason, expires_at = null, created_by = v_actor, updated_at = now();
    v_expires := null;
  elsif p_action_type = 'temp_ip_block' then
    insert into public.source_restrictions (
      source_ip, status, reason, expires_at, created_by, updated_at
    ) values (
      p_target_ip, 'restricted', v_reason, v_expires, v_actor, now()
    )
    on conflict (source_ip) do update
    set status = 'restricted', reason = v_reason, expires_at = v_expires, created_by = v_actor, updated_at = now();
  elsif p_action_type = 'temp_account_lock' then
    update public.profiles
    set locked_until = v_expires, lock_reason = v_reason
    where id = p_target_user_id;
  elsif p_action_type = 'revoke_sessions' then
    update public.profiles
    set sessions_revoked_at = now()
    where id = p_target_user_id;
    v_expires := null;
  elsif p_action_type = 'suspend_account' then
    update public.profiles
    set suspended_at = now(), suspension_reason = v_reason, suspended_by = v_actor
    where id = p_target_user_id;
    v_expires := null;
  elsif p_action_type = 'remove_restriction' then
    if v_target_type = 'ip' then
      update public.source_restrictions
      set status = 'cleared', expires_at = null, reason = v_reason, updated_at = now()
      where source_ip = p_target_ip;
    else
      update public.profiles
      set locked_until = null, lock_reason = null, suspended_at = null, suspension_reason = null, suspended_by = null
      where id = p_target_user_id;
    end if;
    v_expires := null;
  end if;

  insert into public.enforcement_actions (
    action_type, target_type, target_ip, target_user_id,
    duration_minutes, reason, actor_user_id, auto_triggered, expires_at
  ) values (
    p_action_type, v_target_type, p_target_ip, p_target_user_id,
    case when p_action_type in ('temp_ip_block', 'temp_account_lock') then v_duration else null end,
    v_reason, v_actor, false, v_expires
  )
  returning id into v_action_id;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_id, before_value, after_value
  ) values (
    null,
    v_actor,
    'platform_enforcement_' || p_action_type,
    coalesce(p_target_user_id, v_action_id),
    null,
    jsonb_build_object(
      'action_type', p_action_type,
      'target_type', v_target_type,
      'target_ip', p_target_ip,
      'target_user_id', p_target_user_id,
      'reason', v_reason,
      'expires_at', v_expires
    )
  );

  return jsonb_build_object(
    'id', v_action_id,
    'action_type', p_action_type,
    'target_type', v_target_type,
    'expires_at', v_expires
  );
end;
$$;

revoke all on function public.platform_admin_enforce_action(text, text, text, uuid, integer) from public;
grant execute on function public.platform_admin_enforce_action(text, text, text, uuid, integer) to authenticated;

commit;
