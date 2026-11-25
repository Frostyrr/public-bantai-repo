-- Security telemetry events, incident triage workflow, and date-filtered audit log queries.
begin;

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  category text not null check (category in ('auth', 'access_control', 'financial', 'api_abuse', 'data_protection')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  action text not null check (length(trim(action)) between 1 and 120),
  actor_id uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  http_status integer,
  route text,
  request_id text,
  outcome text not null check (outcome in ('blocked', 'denied', 'failed', 'flagged')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists security_events_occurred_idx on public.security_events(occurred_at desc, id desc);
create index if not exists security_events_cat_sev_idx on public.security_events(category, severity, occurred_at desc);

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 3 and 200),
  category text not null check (category in ('auth', 'access_control', 'financial', 'api_abuse', 'data_protection')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'false_positive')),
  organization_id uuid references public.organizations(id) on delete set null,
  event_ids bigint[] not null default '{}',
  assigned_to uuid references public.profiles(id) on delete set null,
  resolution_notes text,
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists security_incidents_status_idx on public.security_incidents(status, severity, detected_at desc);

alter table public.security_events enable row level security;
alter table public.security_incidents enable row level security;
revoke all on public.security_events, public.security_incidents from anon, authenticated;

-- Record an authenticated security event (actor_id is always derived from auth.uid()).
create or replace function public.record_authenticated_security_event(
  p_category text,
  p_severity text,
  p_action text,
  p_outcome text,
  p_http_status integer default null,
  p_route text default null,
  p_request_id text default null,
  p_organization_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id bigint;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  insert into public.security_events (
    category, severity, action, actor_id, organization_id,
    http_status, route, request_id, outcome, metadata
  )
  values (
    p_category,
    p_severity,
    left(trim(p_action), 120),
    v_actor,
    p_organization_id,
    p_http_status,
    left(p_route, 200),
    left(p_request_id, 64),
    p_outcome,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Platform admin security overview & daily trend (real data only).
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
  v_financial_blocked bigint;
  v_high_critical bigint;
  v_open_incidents bigint;
  v_daily_trend jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select
    count(*) filter (where http_status = 403),
    count(*) filter (where http_status = 429),
    count(*) filter (where category = 'financial'),
    count(*) filter (where severity in ('high', 'critical'))
  into v_denied_403, v_rate_limited_429, v_financial_blocked, v_high_critical
  from public.security_events
  where occurred_at >= v_since;

  select count(*)
  into v_open_incidents
  from public.security_incidents
  where status in ('open', 'investigating');

  select coalesce(jsonb_agg(day_row order by day_row->>'day'), '[]'::jsonb)
  into v_daily_trend
  from (
    select jsonb_build_object(
      'day', to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD'),
      'total', count(*),
      'high_critical', count(*) filter (where severity in ('high', 'critical'))
    ) as day_row
    from public.security_events
    where occurred_at >= v_since
    group by date_trunc('day', occurred_at at time zone 'UTC')
  ) sub;

  return jsonb_build_object(
    'window_days', v_days,
    'denied_403', v_denied_403,
    'rate_limited_429', v_rate_limited_429,
    'financial_blocked', v_financial_blocked,
    'high_critical_events', v_high_critical,
    'open_incidents', v_open_incidents,
    'daily_trend', v_daily_trend
  );
end;
$$;

-- Paginated, filterable security events list.
create or replace function public.platform_admin_list_security_events(
  p_category text default null,
  p_severity text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
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
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at <= p_to);

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_events
  from (
    select jsonb_build_object(
      'id', e.id,
      'occurred_at', e.occurred_at,
      'category', e.category,
      'severity', e.severity,
      'action', e.action,
      'actor_id', e.actor_id,
      'actor_name', p.display_name,
      'organization_id', e.organization_id,
      'organization_name', o.name,
      'http_status', e.http_status,
      'route', e.route,
      'request_id', e.request_id,
      'outcome', e.outcome,
      'metadata', e.metadata
    ) as row_obj
    from public.security_events e
    left join public.profiles p on p.id = e.actor_id
    left join public.organizations o on o.id = e.organization_id
    where (p_category is null or e.category = p_category)
      and (p_severity is null or e.severity = p_severity)
      and (p_from is null or e.occurred_at >= p_from)
      and (p_to is null or e.occurred_at <= p_to)
    order by e.occurred_at desc, e.id desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('events', v_events, 'total', v_total);
end;
$$;

-- List security incidents.
create or replace function public.platform_admin_list_incidents(
  p_status text default null,
  p_severity text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_incidents jsonb;
  v_total bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select count(*)
  into v_total
  from public.security_incidents i
  where (p_status is null or i.status = p_status)
    and (p_severity is null or i.severity = p_severity);

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_incidents
  from (
    select jsonb_build_object(
      'id', i.id,
      'title', i.title,
      'category', i.category,
      'severity', i.severity,
      'status', i.status,
      'organization_id', i.organization_id,
      'organization_name', o.name,
      'event_ids', i.event_ids,
      'assigned_to', i.assigned_to,
      'assignee_name', p.display_name,
      'resolution_notes', i.resolution_notes,
      'detected_at', i.detected_at,
      'updated_at', i.updated_at,
      'resolved_at', i.resolved_at
    ) as row_obj
    from public.security_incidents i
    left join public.organizations o on o.id = i.organization_id
    left join public.profiles p on p.id = i.assigned_to
    where (p_status is null or i.status = p_status)
      and (p_severity is null or i.severity = p_severity)
    order by
      case i.status when 'open' then 0 when 'investigating' then 1 else 2 end,
      i.detected_at desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('incidents', v_incidents, 'total', v_total);
end;
$$;

-- Create a security incident and log to audit_logs.
create or replace function public.platform_admin_create_incident(
  p_title text,
  p_category text,
  p_severity text,
  p_organization_id uuid default null,
  p_event_ids bigint[] default '{}',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  insert into public.security_incidents (
    title, category, severity, status, organization_id, event_ids, assigned_to, resolution_notes
  )
  values (
    trim(p_title),
    p_category,
    p_severity,
    'open',
    p_organization_id,
    coalesce(p_event_ids, '{}'),
    v_actor,
    p_notes
  )
  returning id into v_id;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_id, after_value
  )
  values (
    p_organization_id,
    v_actor,
    'security_incident_created',
    v_id,
    jsonb_build_object('title', trim(p_title), 'category', p_category, 'severity', p_severity)
  );

  return jsonb_build_object('id', v_id, 'status', 'open');
end;
$$;

-- Update incident status/notes (security_events remain immutable).
create or replace function public.platform_admin_update_incident(
  p_incident_id uuid,
  p_status text,
  p_resolution_notes text default null,
  p_assigned_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.security_incidents;
  v_resolved_at timestamptz;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  if p_status not in ('open', 'investigating', 'resolved', 'false_positive') then
    raise exception 'Invalid incident status';
  end if;

  select * into v_old
  from public.security_incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception 'Security incident not found';
  end if;

  v_resolved_at := case
    when p_status in ('resolved', 'false_positive') then coalesce(v_old.resolved_at, now())
    else null
  end;

  update public.security_incidents
  set
    status = p_status,
    resolution_notes = coalesce(p_resolution_notes, resolution_notes),
    assigned_to = coalesce(p_assigned_to, assigned_to),
    updated_at = now(),
    resolved_at = v_resolved_at
  where id = p_incident_id;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_id, before_value, after_value
  )
  values (
    v_old.organization_id,
    v_actor,
    'security_incident_updated',
    p_incident_id,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', p_status)
  );

  return jsonb_build_object('id', p_incident_id, 'status', p_status, 'resolved_at', v_resolved_at);
end;
$$;

-- Replace platform_admin_list_audit_logs with date-range filtering support.
drop function if exists public.platform_admin_list_audit_logs(text, integer, integer);
create or replace function public.platform_admin_list_audit_logs(
  p_action text default '',
  p_limit integer default 50,
  p_offset integer default 0,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_action text := trim(coalesce(p_action, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_logs jsonb;
  v_total bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select count(*)
  into v_total
  from public.audit_logs a
  where (v_action = '' or a.action ilike '%' || v_action || '%')
    and (p_from is null or a.occurred_at >= p_from)
    and (p_to is null or a.occurred_at <= p_to);

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_logs
  from (
    select jsonb_build_object(
      'id', a.id,
      'organization_id', a.organization_id,
      'organization_name', o.name,
      'actor_id', a.actor_id,
      'actor_name', p.display_name,
      'action', a.action,
      'entity_id', a.entity_id,
      'before_value', a.before_value,
      'after_value', a.after_value,
      'occurred_at', a.occurred_at
    ) as row_obj
    from public.audit_logs a
    left join public.profiles p on p.id = a.actor_id
    left join public.organizations o on o.id = a.organization_id
    where (v_action = '' or a.action ilike '%' || v_action || '%')
      and (p_from is null or a.occurred_at >= p_from)
      and (p_to is null or a.occurred_at <= p_to)
    order by a.occurred_at desc, a.id desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('logs', v_logs, 'total', v_total);
end;
$$;

revoke all on function public.record_authenticated_security_event(text, text, text, text, integer, text, text, uuid, jsonb) from public, anon;
grant execute on function public.record_authenticated_security_event(text, text, text, text, integer, text, text, uuid, jsonb) to authenticated;

revoke all on function public.platform_admin_security_overview(integer) from public, anon;
grant execute on function public.platform_admin_security_overview(integer) to authenticated;

revoke all on function public.platform_admin_list_security_events(text, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.platform_admin_list_security_events(text, text, timestamptz, timestamptz, integer, integer) to authenticated;

revoke all on function public.platform_admin_list_incidents(text, text, integer, integer) from public, anon;
grant execute on function public.platform_admin_list_incidents(text, text, integer, integer) to authenticated;

revoke all on function public.platform_admin_create_incident(text, text, text, uuid, bigint[], text) from public, anon;
grant execute on function public.platform_admin_create_incident(text, text, text, uuid, bigint[], text) to authenticated;

revoke all on function public.platform_admin_update_incident(uuid, text, text, uuid) from public, anon;
grant execute on function public.platform_admin_update_incident(uuid, text, text, uuid) to authenticated;

revoke all on function public.platform_admin_list_audit_logs(text, integer, integer, timestamptz, timestamptz) from public, anon;
grant execute on function public.platform_admin_list_audit_logs(text, integer, integer, timestamptz, timestamptz) to authenticated;

commit;
