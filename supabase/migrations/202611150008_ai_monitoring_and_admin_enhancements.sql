-- Bani AI monitoring telemetry, workspace AI quotas, and enhanced admin console RPCs
-- (User details, Workspace 360 Activity/Bani Usage, Financial trends, Filtered Security Heatmap).
begin;

-- 1. Non-content Bani AI usage telemetry
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  model text not null default 'unknown',
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  tool_calls_count integer not null default 0 check (tool_calls_count >= 0),
  status text not null check (status in ('success', 'error', 'aborted', 'rate_limited')),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_logs_created_at
  on public.ai_usage_logs (created_at desc);

create index if not exists idx_ai_usage_logs_org_created_at
  on public.ai_usage_logs (organization_id, created_at desc);

create index if not exists idx_ai_usage_logs_user_created_at
  on public.ai_usage_logs (user_id, created_at desc);

alter table public.ai_usage_logs enable row level security;
revoke all on public.ai_usage_logs from anon, authenticated;

-- 2. Per-workspace AI quotas and kill-switch (never suspends workspace on quota exhaustion)
create table if not exists public.ai_workspace_quotas (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  ai_enabled boolean not null default true,
  daily_request_limit integer not null default 200 check (daily_request_limit >= 0),
  monthly_token_limit bigint not null default 2000000 check (monthly_token_limit >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_reason text,
  updated_at timestamptz not null default now()
);

alter table public.ai_workspace_quotas enable row level security;
revoke all on public.ai_workspace_quotas from anon, authenticated;

-- 3. Runtime quota check for Bani chat endpoint (called with authenticated user context)
create or replace function public.check_ai_workspace_quota(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_member boolean;
  v_ai_enabled boolean := true;
  v_daily_limit integer := 200;
  v_monthly_limit bigint := 2000000;
  v_daily_requests bigint := 0;
  v_monthly_tokens bigint := 0;
  v_allowed boolean := true;
  v_reason text := null;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select exists(
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = v_user_id
  ) into v_is_member;

  if not v_is_member then
    raise exception 'Organization membership required';
  end if;

  select
    q.ai_enabled,
    q.daily_request_limit,
    q.monthly_token_limit
  into v_ai_enabled, v_daily_limit, v_monthly_limit
  from public.ai_workspace_quotas q
  where q.organization_id = p_organization_id;

  v_ai_enabled := coalesce(v_ai_enabled, true);
  v_daily_limit := coalesce(v_daily_limit, 200);
  v_monthly_limit := coalesce(v_monthly_limit, 2000000);

  select count(*)
  into v_daily_requests
  from public.ai_usage_logs l
  where l.organization_id = p_organization_id
    and l.created_at >= date_trunc('day', now())
    and l.status in ('success', 'error', 'aborted');

  select coalesce(sum(l.total_tokens), 0)
  into v_monthly_tokens
  from public.ai_usage_logs l
  where l.organization_id = p_organization_id
    and l.created_at >= date_trunc('month', now());

  if not v_ai_enabled then
    v_allowed := false;
    v_reason := 'ai_disabled';
  elsif v_daily_limit > 0 and v_daily_requests >= v_daily_limit then
    v_allowed := false;
    v_reason := 'daily_request_limit_exceeded';
  elsif v_monthly_limit > 0 and v_monthly_tokens >= v_monthly_limit then
    v_allowed := false;
    v_reason := 'monthly_token_limit_exceeded';
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'ai_enabled', v_ai_enabled,
    'daily_requests_used', v_daily_requests,
    'daily_request_limit', v_daily_limit,
    'monthly_tokens_used', v_monthly_tokens,
    'monthly_token_limit', v_monthly_limit
  );
end;
$$;

revoke all on function public.check_ai_workspace_quota(uuid) from public;
grant execute on function public.check_ai_workspace_quota(uuid) to authenticated;

-- 4. Record non-content AI usage log (called after streaming or on quota block)
create or replace function public.record_ai_usage_log(
  p_organization_id uuid,
  p_conversation_id uuid default null,
  p_model text default 'unknown',
  p_prompt_tokens integer default 0,
  p_completion_tokens integer default 0,
  p_total_tokens integer default 0,
  p_latency_ms integer default 0,
  p_tool_calls_count integer default 0,
  p_status text default 'success',
  p_error_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_status text := case
    when p_status in ('success', 'error', 'aborted', 'rate_limited') then p_status
    else 'error'
  end;
begin
  if v_user_id is null then
    return null;
  end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = v_user_id
  ) then
    return null;
  end if;

  insert into public.ai_usage_logs (
    organization_id,
    user_id,
    conversation_id,
    model,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    latency_ms,
    tool_calls_count,
    status,
    error_code
  ) values (
    p_organization_id,
    v_user_id,
    p_conversation_id,
    left(coalesce(nullif(trim(p_model), ''), 'unknown'), 120),
    greatest(0, coalesce(p_prompt_tokens, 0)),
    greatest(0, coalesce(p_completion_tokens, 0)),
    greatest(0, coalesce(p_total_tokens, greatest(0, coalesce(p_prompt_tokens, 0)) + greatest(0, coalesce(p_completion_tokens, 0)))),
    greatest(0, coalesce(p_latency_ms, 0)),
    greatest(0, coalesce(p_tool_calls_count, 0)),
    v_status,
    left(nullif(trim(coalesce(p_error_code, '')), ''), 120)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text) from public;
grant execute on function public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text) to authenticated;

-- 5. Admin AI Overview RPC
create or replace function public.admin_get_ai_overview(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_summary jsonb;
  v_series jsonb;
  v_status_breakdown jsonb;
  v_recent_errors jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select jsonb_build_object(
    'total_requests', count(*),
    'success_requests', count(*) filter (where status = 'success'),
    'error_requests', count(*) filter (where status = 'error'),
    'rate_limited_requests', count(*) filter (where status = 'rate_limited'),
    'aborted_requests', count(*) filter (where status = 'aborted'),
    'active_workspaces', count(distinct organization_id),
    'active_users', count(distinct user_id),
    'total_prompt_tokens', coalesce(sum(prompt_tokens), 0),
    'total_completion_tokens', coalesce(sum(completion_tokens), 0),
    'total_tokens', coalesce(sum(total_tokens), 0),
    'avg_latency_ms', coalesce(round(avg(latency_ms) filter (where status = 'success')), 0),
    'total_tool_calls', coalesce(sum(tool_calls_count), 0),
    'disabled_workspaces', (select count(*) from public.ai_workspace_quotas where ai_enabled = false)
  )
  into v_summary
  from public.ai_usage_logs
  where created_at >= v_since;

  with days_series as (
    select generate_series(
      date_trunc('day', v_since),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  ),
  agg as (
    select
      created_at::date as day,
      count(*) as requests,
      count(*) filter (where status = 'error') as errors,
      count(*) filter (where status = 'rate_limited') as rate_limited,
      coalesce(sum(total_tokens), 0) as tokens
    from public.ai_usage_logs
    where created_at >= v_since
    group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', to_char(d.day, 'YYYY-MM-DD'),
      'requests', coalesce(a.requests, 0),
      'errors', coalesce(a.errors, 0),
      'rate_limited', coalesce(a.rate_limited, 0),
      'tokens', coalesce(a.tokens, 0)
    )
    order by d.day
  ), '[]'::jsonb)
  into v_series
  from days_series d
  left join agg a on a.day = d.day;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'status', s.status,
      'count', s.cnt
    )
    order by s.cnt desc
  ), '[]'::jsonb)
  into v_status_breakdown
  from (
    select status, count(*) as cnt
    from public.ai_usage_logs
    where created_at >= v_since
    group by status
  ) s;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'organization_id', l.organization_id,
      'organization_name', o.name,
      'model', l.model,
      'status', l.status,
      'error_code', l.error_code,
      'latency_ms', l.latency_ms,
      'created_at', l.created_at
    )
    order by l.created_at desc
  ), '[]'::jsonb)
  into v_recent_errors
  from (
    select *
    from public.ai_usage_logs
    where created_at >= v_since
      and status in ('error', 'rate_limited')
    order by created_at desc
    limit 20
  ) l
  left join public.organizations o on o.id = l.organization_id;

  return jsonb_build_object(
    'days', v_days,
    'summary', v_summary,
    'daily_series', v_series,
    'status_breakdown', v_status_breakdown,
    'recent_errors', v_recent_errors
  );
end;
$$;

revoke all on function public.admin_get_ai_overview(integer) from public;
grant execute on function public.admin_get_ai_overview(integer) to authenticated;

-- 6. Admin AI Workspace Usage & Quota List
create or replace function public.admin_list_ai_workspace_usage(
  p_days integer default 7,
  p_search text default '',
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_search text := trim(coalesce(p_search, ''));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_rows jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  with period_usage as (
    select
      organization_id,
      count(*) as requests,
      count(*) filter (where status = 'error') as errors,
      count(*) filter (where status = 'rate_limited') as rate_limited,
      coalesce(sum(total_tokens), 0) as total_tokens,
      coalesce(round(avg(latency_ms) filter (where status = 'success')), 0) as avg_latency_ms,
      max(created_at) as last_used_at
    from public.ai_usage_logs
    where created_at >= v_since
    group by organization_id
  ),
  today_usage as (
    select
      organization_id,
      count(*) as daily_requests
    from public.ai_usage_logs
    where created_at >= date_trunc('day', now())
      and status in ('success', 'error', 'aborted')
    group by organization_id
  ),
  month_usage as (
    select
      organization_id,
      coalesce(sum(total_tokens), 0) as monthly_tokens
    from public.ai_usage_logs
    where created_at >= date_trunc('month', now())
    group by organization_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'organization_id', o.id,
      'organization_name', o.name,
      'ai_enabled', coalesce(q.ai_enabled, true),
      'daily_request_limit', coalesce(q.daily_request_limit, 200),
      'monthly_token_limit', coalesce(q.monthly_token_limit, 2000000),
      'daily_requests_used', coalesce(tu.daily_requests, 0),
      'monthly_tokens_used', coalesce(mu.monthly_tokens, 0),
      'period_requests', coalesce(pu.requests, 0),
      'period_errors', coalesce(pu.errors, 0),
      'period_rate_limited', coalesce(pu.rate_limited, 0),
      'period_tokens', coalesce(pu.total_tokens, 0),
      'avg_latency_ms', coalesce(pu.avg_latency_ms, 0),
      'last_used_at', pu.last_used_at
    )
    order by coalesce(pu.requests, 0) desc, o.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.organizations o
  left join public.ai_workspace_quotas q on q.organization_id = o.id
  left join period_usage pu on pu.organization_id = o.id
  left join today_usage tu on tu.organization_id = o.id
  left join month_usage mu on mu.organization_id = o.id
  where o.closed_at is null
    and (
      v_search = ''
      or o.name ilike '%' || v_search || '%'
      or o.id::text ilike '%' || v_search || '%'
    )
  limit v_limit;

  return jsonb_build_object('workspaces', v_rows);
end;
$$;

revoke all on function public.admin_list_ai_workspace_usage(integer, text, integer) from public;
grant execute on function public.admin_list_ai_workspace_usage(integer, text, integer) to authenticated;

-- 7. Admin Set Workspace AI Quota (with mandatory reason & audit log)
create or replace function public.admin_set_workspace_ai_quota(
  p_organization_id uuid,
  p_ai_enabled boolean,
  p_daily_request_limit integer,
  p_monthly_token_limit bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_before jsonb;
  v_after jsonb;
begin
  if not public.is_platform_admin(true) then
    raise exception 'Super administrator access required';
  end if;

  if length(v_reason) < 3 then
    raise exception 'A documented reason (at least 3 characters) is required';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'Organization not found';
  end if;

  select jsonb_build_object(
    'ai_enabled', coalesce(q.ai_enabled, true),
    'daily_request_limit', coalesce(q.daily_request_limit, 200),
    'monthly_token_limit', coalesce(q.monthly_token_limit, 2000000)
  )
  into v_before
  from public.ai_workspace_quotas q
  where q.organization_id = p_organization_id;

  insert into public.ai_workspace_quotas (
    organization_id,
    ai_enabled,
    daily_request_limit,
    monthly_token_limit,
    updated_by,
    updated_reason,
    updated_at
  ) values (
    p_organization_id,
    coalesce(p_ai_enabled, true),
    greatest(0, coalesce(p_daily_request_limit, 200)),
    greatest(0, coalesce(p_monthly_token_limit, 2000000)),
    v_actor,
    v_reason,
    now()
  )
  on conflict (organization_id) do update set
    ai_enabled = excluded.ai_enabled,
    daily_request_limit = excluded.daily_request_limit,
    monthly_token_limit = excluded.monthly_token_limit,
    updated_by = excluded.updated_by,
    updated_reason = excluded.updated_reason,
    updated_at = excluded.updated_at;

  v_after := jsonb_build_object(
    'ai_enabled', coalesce(p_ai_enabled, true),
    'daily_request_limit', greatest(0, coalesce(p_daily_request_limit, 200)),
    'monthly_token_limit', greatest(0, coalesce(p_monthly_token_limit, 2000000)),
    'reason', v_reason
  );

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_id, before_value, after_value
  ) values (
    p_organization_id,
    v_actor,
    'platform_ai_quota_updated',
    p_organization_id,
    v_before,
    v_after
  );

  return v_after;
end;
$$;

revoke all on function public.admin_set_workspace_ai_quota(uuid, boolean, integer, bigint, text) from public;
grant execute on function public.admin_set_workspace_ai_quota(uuid, boolean, integer, bigint, text) to authenticated;

-- 8. Admin User Details (memberships, privilege timeline, account security history)
create or replace function public.admin_get_user_details(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_memberships jsonb;
  v_role_history jsonb;
  v_security_history jsonb;
  v_enforcement_history jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'organization_id', o.id,
      'organization_name', o.name,
      'workspace_role', om.role,
      'joined_at', om.created_at,
      'suspended_at', o.suspended_at,
      'closed_at', o.closed_at
    )
    order by om.created_at desc
  ), '[]'::jsonb)
  into v_memberships
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = p_user_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', al.id,
      'action', al.action,
      'before_value', al.before_value,
      'after_value', al.after_value,
      'created_at', al.created_at
    )
    order by al.created_at desc
  ), '[]'::jsonb)
  into v_role_history
  from (
    select id, action, before_value, after_value, created_at
    from public.audit_logs
    where entity_id = p_user_id
      and action ilike '%role%'
    order by created_at desc
    limit 20
  ) al;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', se.id,
      'event_type', se.event_type,
      'category', se.category,
      'severity', se.severity,
      'source_ip', se.source_ip,
      'occurred_at', se.occurred_at
    )
    order by se.occurred_at desc
  ), '[]'::jsonb)
  into v_security_history
  from (
    select id, event_type, category, severity, source_ip, occurred_at
    from public.security_events
    where user_id = p_user_id
       or requesting_user_id = p_user_id
    order by occurred_at desc
    limit 20
  ) se;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ea.id,
      'action_type', ea.action_type,
      'reason', ea.reason,
      'expires_at', ea.expires_at,
      'created_at', ea.created_at
    )
    order by ea.created_at desc
  ), '[]'::jsonb)
  into v_enforcement_history
  from (
    select id, action_type, reason, expires_at, created_at
    from public.enforcement_actions
    where target_user_id = p_user_id
    order by created_at desc
    limit 15
  ) ea;

  return jsonb_build_object(
    'memberships', v_memberships,
    'role_history', v_role_history,
    'security_history', v_security_history,
    'enforcement_history', v_enforcement_history
  );
end;
$$;

revoke all on function public.admin_get_user_details(uuid) from public;
grant execute on function public.admin_get_user_details(uuid) to authenticated;

-- 9. Workspace 360° Extended (Activity & Bani Usage tabs)
create or replace function public.admin_get_org_360_extended(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_activity_series jsonb;
  v_ai_summary jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  with days_series as (
    select generate_series(
      date_trunc('day', v_since),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  ),
  audit_agg as (
    select created_at::date as day, count(*) as audit_events
    from public.audit_logs
    where organization_id = p_organization_id
      and created_at >= v_since
    group by 1
  ),
  ai_agg as (
    select
      created_at::date as day,
      count(*) as ai_requests,
      coalesce(sum(total_tokens), 0) as ai_tokens
    from public.ai_usage_logs
    where organization_id = p_organization_id
      and created_at >= v_since
    group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', to_char(d.day, 'YYYY-MM-DD'),
      'audit_events', coalesce(a.audit_events, 0),
      'ai_requests', coalesce(ai.ai_requests, 0),
      'ai_tokens', coalesce(ai.ai_tokens, 0)
    )
    order by d.day
  ), '[]'::jsonb)
  into v_activity_series
  from days_series d
  left join audit_agg a on a.day = d.day
  left join ai_agg ai on ai.day = d.day;

  select jsonb_build_object(
    'ai_enabled', coalesce((select q.ai_enabled from public.ai_workspace_quotas q where q.organization_id = p_organization_id), true),
    'daily_request_limit', coalesce((select q.daily_request_limit from public.ai_workspace_quotas q where q.organization_id = p_organization_id), 200),
    'monthly_token_limit', coalesce((select q.monthly_token_limit from public.ai_workspace_quotas q where q.organization_id = p_organization_id), 2000000),
    'daily_requests_used', (
      select count(*) from public.ai_usage_logs l
      where l.organization_id = p_organization_id
        and l.created_at >= date_trunc('day', now())
        and l.status in ('success', 'error', 'aborted')
    ),
    'monthly_tokens_used', (
      select coalesce(sum(l.total_tokens), 0) from public.ai_usage_logs l
      where l.organization_id = p_organization_id
        and l.created_at >= date_trunc('month', now())
    ),
    'period_requests', count(*),
    'period_errors', count(*) filter (where status = 'error'),
    'period_rate_limited', count(*) filter (where status = 'rate_limited'),
    'period_tokens', coalesce(sum(total_tokens), 0),
    'avg_latency_ms', coalesce(round(avg(latency_ms) filter (where status = 'success')), 0)
  )
  into v_ai_summary
  from public.ai_usage_logs
  where organization_id = p_organization_id
    and created_at >= v_since;

  return jsonb_build_object(
    'days', v_days,
    'activity_series', v_activity_series,
    'ai_summary', v_ai_summary
  );
end;
$$;

revoke all on function public.admin_get_org_360_extended(uuid, integer) from public;
grant execute on function public.admin_get_org_360_extended(uuid, integer) to authenticated;

-- 10. Privacy-preserving cross-workspace Financial Trends
create or replace function public.admin_get_financial_trends(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_series jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  with days_series as (
    select generate_series(
      date_trunc('day', v_since),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  ),
  pay_agg as (
    select
      created_at::date as day,
      count(*) as payment_count,
      coalesce(sum(amount_centavos), 0) as collected_centavos
    from public.payments
    where created_at >= v_since
      and status = 'confirmed'
    group by 1
  ),
  exp_agg as (
    select
      created_at::date as day,
      count(*) as expense_count,
      coalesce(sum(amount_centavos), 0) as approved_expenses_centavos
    from public.expenses
    where created_at >= v_since
      and status = 'approved'
    group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', to_char(d.day, 'YYYY-MM-DD'),
      'payment_count', coalesce(p.payment_count, 0),
      'collected_centavos', coalesce(p.collected_centavos, 0),
      'expense_count', coalesce(e.expense_count, 0),
      'approved_expenses_centavos', coalesce(e.approved_expenses_centavos, 0)
    )
    order by d.day
  ), '[]'::jsonb)
  into v_series
  from days_series d
  left join pay_agg p on p.day = d.day
  left join exp_agg e on e.day = d.day;

  return jsonb_build_object(
    'days', v_days,
    'series', v_series
  );
end;
$$;

revoke all on function public.admin_get_financial_trends(integer) from public;
grant execute on function public.admin_get_financial_trends(integer) to authenticated;

-- 11. Filtered Security Activity Heatmap (date range, timezone offset, auth event type)
create or replace function public.admin_get_security_heatmap_filtered(
  p_days integer default 7,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_tz_offset_minutes integer default 0,
  p_event_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_end timestamptz := coalesce(p_end_date, now());
  v_start timestamptz := coalesce(p_start_date, v_end - make_interval(days => v_days));
  v_tz_offset integer := least(greatest(coalesce(p_tz_offset_minutes, 0), -720), 840);
  v_event_type text := nullif(trim(coalesce(p_event_type, '')), '');
  v_cells jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'dow', dow,
      'hour', hr,
      'count', cnt
    )
    order by dow, hr
  ), '[]'::jsonb)
  into v_cells
  from (
    select
      extract(dow from (occurred_at + make_interval(mins => v_tz_offset)))::integer as dow,
      extract(hour from (occurred_at + make_interval(mins => v_tz_offset)))::integer as hr,
      count(*)::integer as cnt
    from public.security_events
    where category = 'security'
      and occurred_at >= v_start
      and occurred_at <= v_end
      and (
        v_event_type is null
        or event_type = v_event_type
      )
      and (
        v_event_type is not null
        or event_type in (
          'failed_login',
          'auth_failure_edge',
          'rate_limited',
          'rate_limit_exceeded',
          'account_locked',
          'ip_restricted'
        )
      )
    group by 1, 2
  ) t;

  return jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'tz_offset_minutes', v_tz_offset,
    'event_type', v_event_type,
    'heatmap', v_cells
  );
end;
$$;

revoke all on function public.admin_get_security_heatmap_filtered(integer, timestamptz, timestamptz, integer, text) from public;
grant execute on function public.admin_get_security_heatmap_filtered(integer, timestamptz, timestamptz, integer, text) to authenticated;

commit;
