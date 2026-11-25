-- Security monitoring enhancements: status/category breakdowns, burst detection, and DB health ping.
begin;

create or replace function public.platform_admin_health_ping()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  perform 1;
  return true;
end;
$$;

revoke all on function public.platform_admin_health_ping() from public, anon;
grant execute on function public.platform_admin_health_ping() to authenticated;

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
    count(*) filter (where http_status = 403),
    count(*) filter (where http_status = 429),
    count(*) filter (where http_status >= 500),
    count(*) filter (where category = 'financial'),
    count(*) filter (where severity in ('high', 'critical'))
  into v_denied_403, v_rate_limited_429, v_errors_5xx, v_financial_blocked, v_high_critical
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

  select jsonb_build_object(
    'auth', count(*) filter (where category = 'auth'),
    'access_control', count(*) filter (where category = 'access_control'),
    'financial', count(*) filter (where category = 'financial'),
    'api_abuse', count(*) filter (where category = 'api_abuse'),
    'data_protection', count(*) filter (where category = 'data_protection')
  )
  into v_category_breakdown
  from public.security_events
  where occurred_at >= v_since;

  -- Automated 15-minute burst detection: actors with >= 5 denied/rate-limited events
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

commit;
