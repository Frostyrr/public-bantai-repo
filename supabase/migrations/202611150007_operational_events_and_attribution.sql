-- Separate operational 5xx/dependency events from security events,
-- fix actor attribution (requesting_user_id vs responsible actor_id),
-- add signature deduplication, and non-destructively reclassify historical 5xx false positives.
begin;

-- 1. Expand category constraints to support 'operational'
do $$
declare
  v_con record;
begin
  for v_con in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.security_events'::regclass, 'public.security_incidents'::regclass)
      and pg_get_constraintdef(oid) like '%category%'
  loop
    execute format('alter table %s drop constraint if exists %I', v_con.tbl, v_con.conname);
  end loop;
end $$;

alter table public.security_events
  add constraint security_events_category_check
  check (category in ('auth', 'access_control', 'financial', 'api_abuse', 'data_protection', 'operational'));

alter table public.security_incidents
  add constraint security_incidents_category_check
  check (category in ('auth', 'access_control', 'financial', 'api_abuse', 'data_protection', 'operational'));

-- 2. Add attribution, classification, and deduplication columns
alter table public.security_events
  add column if not exists event_class text not null default 'security'
    check (event_class in ('operational', 'security', 'audit')),
  add column if not exists event_source text not null default 'api'
    check (event_source in ('api', 'auth', 'middleware', 'database', 'infrastructure')),
  add column if not exists requesting_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists classification_reason text,
  add column if not exists occurrence_count integer not null default 1,
  add column if not exists last_occurred_at timestamptz not null default now(),
  add column if not exists signature_hash text,
  add column if not exists enforcement_eligible boolean not null default false;

alter table public.security_incidents
  add column if not exists event_class text not null default 'security'
    check (event_class in ('operational', 'security'));

create index if not exists idx_security_events_class_time
  on public.security_events (event_class, occurred_at desc);

create index if not exists idx_security_events_signature_window
  on public.security_events (signature_hash, last_occurred_at desc)
  where signature_hash is not null;

-- 3. Non-destructively reclassify historical 5xx false positives (preserving original values in metadata)
update public.security_events
set
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'reclassified_from', jsonb_build_object(
      'category', category,
      'severity', severity,
      'actor_id', actor_id,
      'reclassified_at', now()
    )
  ),
  requesting_user_id = coalesce(requesting_user_id, actor_id),
  actor_id = null,
  category = 'operational',
  event_class = 'operational',
  event_source = 'api',
  severity = case when http_status = 503 then 'low' else 'medium' end,
  enforcement_eligible = false,
  classification_reason = 'Reclassified from historical 5xx API abuse false positive: backend or dependency failure'
where http_status >= 500
  and category = 'api_abuse'
  and action = 'server_error_5xx';

-- 4. Update record_authenticated_security_event with attribution, classification, and 5xx deduplication
drop function if exists public.record_authenticated_security_event(
  text, text, text, text, integer, text, text, uuid, jsonb
);

create or replace function public.record_authenticated_security_event(
  p_category text,
  p_severity text,
  p_action text,
  p_outcome text,
  p_http_status integer default null,
  p_route text default null,
  p_request_id text default null,
  p_organization_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_event_source text default 'api',
  p_classification_reason text default null,
  p_enforcement_eligible boolean default false,
  p_dedup_window_seconds integer default 300
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_is_operational boolean := (p_category = 'operational' or coalesce(p_http_status, 0) >= 500);
  v_class text := case when v_is_operational then 'operational' else 'security' end;
  v_category text := case when v_is_operational then 'operational' else p_category end;
  v_source text := case
    when p_event_source in ('api', 'auth', 'middleware', 'database', 'infrastructure') then p_event_source
    else 'api'
  end;
  v_sig text := md5(coalesce(v_category, '') || '|' || coalesce(p_action, '') || '|' || coalesce(p_http_status::text, '') || '|' || coalesce(p_route, ''));
  v_existing_id bigint;
  v_id bigint;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if v_is_operational and p_dedup_window_seconds > 0 then
    select id into v_existing_id
    from public.security_events
    where signature_hash = v_sig
      and event_class = 'operational'
      and last_occurred_at >= now() - make_interval(secs => p_dedup_window_seconds)
    order by last_occurred_at desc
    limit 1;

    if v_existing_id is not null then
      update public.security_events
      set
        occurrence_count = occurrence_count + 1,
        last_occurred_at = now(),
        severity = case when occurrence_count + 1 >= 5 then 'medium' else severity end,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'latest_request_id', p_request_id,
          'latest_requesting_user_id', v_actor
        )
      where id = v_existing_id;
      return v_existing_id;
    end if;
  end if;

  insert into public.security_events (
    category, event_class, event_source, severity, action,
    actor_id, requesting_user_id, organization_id,
    http_status, route, request_id, outcome,
    classification_reason, enforcement_eligible, signature_hash, metadata
  )
  values (
    v_category,
    v_class,
    v_source,
    p_severity,
    left(trim(p_action), 120),
    case when v_is_operational then null else v_actor end,
    v_actor,
    p_organization_id,
    p_http_status,
    left(p_route, 200),
    left(p_request_id, 64),
    p_outcome,
    p_classification_reason,
    case when v_is_operational then false else coalesce(p_enforcement_eligible, false) end,
    v_sig,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_authenticated_security_event(
  text, text, text, text, integer, text, text, uuid, jsonb, text, text, boolean, integer
) from public, anon;
grant execute on function public.record_authenticated_security_event(
  text, text, text, text, integer, text, text, uuid, jsonb, text, text, boolean, integer
) to authenticated;

-- 5. Ensure edge 5xx/operational events never trigger brute-force counters or IP locks
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
  v_is_operational boolean := (p_category = 'operational' or coalesce(p_http_status, 0) >= 500);
  v_recent_15m integer := 0;
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
    select
      count(*),
      count(distinct route)
    into v_recent_15m, v_distinct_routes
    from public.security_events
    where source_ip = p_source_ip
      and event_class = 'security'
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
    category, event_class, event_source, severity, action, outcome,
    http_status, route, request_id, source_ip, threat_score,
    enforcement_eligible, classification_reason, metadata
  ) values (
    p_category, 'security', 'middleware', p_severity, left(trim(p_action), 120), p_outcome,
    p_http_status, left(p_route, 200), left(p_request_id, 64),
    nullif(trim(coalesce(p_source_ip, '')), ''), v_threat_score,
    (v_recent_15m + 1) >= 5,
    'Edge security event from unauthenticated/unauthorized traffic',
    coalesce(p_metadata, '{}'::jsonb)
  );

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

    if not exists (
      select 1 from public.security_incidents
      where status in ('open', 'investigating')
        and event_class = 'security'
        and title like '%' || p_source_ip || '%'
        and detected_at >= v_now - interval '30 minutes'
    ) then
      insert into public.security_incidents (
        title, category, event_class, severity, status, resolution_notes
      ) values (
        'Automated Brute-Force Cooldown: ' || p_source_ip,
        case when p_category = 'auth' then 'auth' else 'api_abuse' end,
        'security',
        'high',
        'open',
        'Auto-triggered after ' || (v_recent_15m + 1) || ' failed/denied requests in 15m.'
      );
    end if;
  elsif p_source_ip is not null and length(trim(p_source_ip)) > 0 and (v_recent_15m + 1) >= 5 then
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

-- 6. Update platform_admin_security_overview to exclude operational 5xx from security high/critical & burst counts
create or replace function public.platform_admin_security_overview(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_denied_403 bigint;
  v_rate_limited_429 bigint;
  v_errors_5xx bigint;
  v_financial_blocked bigint;
  v_high_critical bigint;
  v_open_incidents bigint;
  v_daily_trend jsonb;
  v_category_breakdown jsonb;
  v_burst_alerts jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select
    count(*) filter (where http_status = 403 and event_class = 'security'),
    count(*) filter (where http_status = 429 and event_class = 'security'),
    coalesce(sum(occurrence_count) filter (where http_status >= 500 or event_class = 'operational'), 0),
    count(*) filter (where category = 'financial'),
    count(*) filter (where event_class = 'security' and severity in ('high', 'critical'))
  into v_denied_403, v_rate_limited_429, v_errors_5xx, v_financial_blocked, v_high_critical
  from public.security_events
  where occurred_at >= v_since;

  select count(*)
  into v_open_incidents
  from public.security_incidents
  where status in ('open', 'investigating')
    and event_class = 'security';

  select coalesce(jsonb_agg(day_row order by day_row->>'day'), '[]'::jsonb)
  into v_daily_trend
  from (
    select jsonb_build_object(
      'day', to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD'),
      'total', count(*) filter (where event_class = 'security'),
      'high_critical', count(*) filter (where event_class = 'security' and severity in ('high', 'critical'))
    ) as day_row
    from public.security_events
    where occurred_at >= v_since
    group by date_trunc('day', occurred_at at time zone 'UTC')
  ) sub;

  select jsonb_build_object(
    'auth', count(*) filter (where category = 'auth'),
    'access_control', count(*) filter (where category = 'access_control'),
    'financial', count(*) filter (where category = 'financial'),
    'api_abuse', count(*) filter (where category = 'api_abuse'),
    'data_protection', count(*) filter (where category = 'data_protection'),
    'operational', count(*) filter (where category = 'operational')
  )
  into v_category_breakdown
  from public.security_events
  where occurred_at >= v_since;

  select coalesce(jsonb_agg(alert_row order by (alert_row->>'event_count')::bigint desc), '[]'::jsonb)
  into v_burst_alerts
  from (
    select jsonb_build_object(
      'actor_id', e.actor_id,
      'actor_name', p.display_name,
      'route', coalesce(e.route, 'unknown'),
      'http_status', e.http_status,
      'event_count', count(*),
      'latest_at', max(e.occurred_at)
    ) as alert_row
    from public.security_events e
    left join public.profiles p on p.id = e.actor_id
    where e.occurred_at >= now() - interval '15 minutes'
      and e.event_class = 'security'
      and e.http_status in (403, 429)
    group by e.actor_id, p.display_name, coalesce(e.route, 'unknown'), e.http_status
    having count(*) >= 5
    limit 10
  ) sub;

  return jsonb_build_object(
    'window_days', v_days,
    'denied_403', v_denied_403,
    'rate_limited_429', v_rate_limited_429,
    'errors_5xx', v_errors_5xx,
    'financial_blocked', v_financial_blocked,
    'high_critical_events', v_high_critical,
    'open_incidents', v_open_incidents,
    'status_breakdown', jsonb_build_object(
      'status_403', v_denied_403,
      'status_429', v_rate_limited_429,
      'status_5xx', v_errors_5xx
    ),
    'category_breakdown', v_category_breakdown,
    'burst_alerts', v_burst_alerts,
    'daily_trend', v_daily_trend
  );
end;
$$;

-- 7. Update platform_admin_list_security_events to filter by event_class & return attribution fields
drop function if exists public.platform_admin_list_security_events(
  text, text, timestamptz, timestamptz, integer, integer
);

create or replace function public.platform_admin_list_security_events(
  p_category text default null,
  p_severity text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_event_class text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_events jsonb;
  v_total bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select count(*)
  into v_total
  from public.security_events e
  where (p_category is null or e.category = p_category)
    and (p_severity is null or e.severity = p_severity)
    and (p_event_class is null or e.event_class = p_event_class)
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at <= p_to);

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_events
  from (
    select jsonb_build_object(
      'id', e.id,
      'occurred_at', e.occurred_at,
      'last_occurred_at', e.last_occurred_at,
      'occurrence_count', e.occurrence_count,
      'category', e.category,
      'event_class', e.event_class,
      'event_source', e.event_source,
      'severity', e.severity,
      'action', e.action,
      'actor_id', e.actor_id,
      'actor_name', p.display_name,
      'requesting_user_id', e.requesting_user_id,
      'requesting_user_name', rp.display_name,
      'organization_id', e.organization_id,
      'organization_name', o.name,
      'http_status', e.http_status,
      'route', e.route,
      'request_id', e.request_id,
      'outcome', e.outcome,
      'classification_reason', e.classification_reason,
      'enforcement_eligible', e.enforcement_eligible,
      'metadata', e.metadata
    ) as row_obj
    from public.security_events e
    left join public.profiles p on p.id = e.actor_id
    left join public.profiles rp on rp.id = e.requesting_user_id
    left join public.organizations o on o.id = e.organization_id
    where (p_category is null or e.category = p_category)
      and (p_severity is null or e.severity = p_severity)
      and (p_event_class is null or e.event_class = p_event_class)
      and (p_from is null or e.occurred_at >= p_from)
      and (p_to is null or e.occurred_at <= p_to)
    order by e.last_occurred_at desc, e.id desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('events', v_events, 'total', v_total);
end;
$$;

revoke all on function public.platform_admin_list_security_events(
  text, text, timestamptz, timestamptz, integer, integer, text
) from public, anon;
grant execute on function public.platform_admin_list_security_events(
  text, text, timestamptz, timestamptz, integer, integer, text
) to authenticated;

-- 8. Ensure check_source_restriction ignores operational 5xx events when computing progressive delays
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
    and event_class = 'security'
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

commit;
