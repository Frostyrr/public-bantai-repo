-- Add request_id idempotency to ai_usage_logs and timezone-aware daily grouping to admin_get_ai_overview.
begin;

alter table public.ai_usage_logs
  add column if not exists request_id text;

create unique index if not exists idx_ai_usage_logs_request_id
  on public.ai_usage_logs (request_id)
  where request_id is not null;

drop function if exists public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text);

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
  p_error_code text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_request_id text := left(nullif(trim(coalesce(p_request_id, '')), ''), 120);
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

  if v_request_id is not null then
    select id into v_id
    from public.ai_usage_logs
    where request_id = v_request_id
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
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
    error_code,
    request_id
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
    left(nullif(trim(coalesce(p_error_code, '')), ''), 120),
    v_request_id
  )
  on conflict (request_id) where request_id is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text, text) from public;
grant execute on function public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text, text) to authenticated;

drop function if exists public.admin_get_ai_overview(integer);

create or replace function public.admin_get_ai_overview(
  p_days integer default 7,
  p_tz_offset_minutes integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_tz_offset integer := least(greatest(coalesce(p_tz_offset_minutes, 0), -720), 840);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_local_end_date date := ((now() at time zone 'UTC') + make_interval(mins => v_tz_offset))::date;
  v_local_start_date date := v_local_end_date - (v_days - 1);
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
    select generate_series(v_local_start_date, v_local_end_date, interval '1 day')::date as day
  ),
  agg as (
    select
      ((created_at at time zone 'UTC') + make_interval(mins => v_tz_offset))::date as day,
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

revoke all on function public.admin_get_ai_overview(integer, integer) from public;
grant execute on function public.admin_get_ai_overview(integer, integer) to authenticated;

commit;
