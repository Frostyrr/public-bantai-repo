begin;

create or replace function public.platform_admin_threat_overview_with_flags(p_days integer)
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
  ), 'login_failures_hourly', (
    with bins as (
      select generate_series(0, 23) as age
    ), counts as (
      select floor(extract(epoch from (now() - occurred_at)) / 3600)::int as age, count(*) as failures
      from public.security_events
      where action = 'LOGIN_FAILED' and event_class = 'security'
        and occurred_at > now() - interval '24 hours' and occurred_at <= now()
      group by 1
    )
    select jsonb_agg(jsonb_build_object(
      'start_at', now() - make_interval(hours => bins.age + 1),
      'failures', coalesce(counts.failures, 0)
    ) order by bins.age desc)
    from bins left join counts using (age)
  ), 'top_login_failure_ips', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'ip', top.source_ip, 'failures', top.failures, 'blocked',
      coalesce(r.status = 'restricted' and (r.expires_at is null or r.expires_at > now()), false)
    ) order by top.failures desc, top.source_ip), '[]'::jsonb)
    from (
      select source_ip, count(*) as failures from public.security_events
      where action = 'LOGIN_FAILED' and event_class = 'security' and source_ip is not null
        and occurred_at > now() - interval '24 hours' and occurred_at <= now()
      group by source_ip order by failures desc, source_ip limit 5
    ) top left join public.source_restrictions r on r.source_ip = top.source_ip
  ));
end;
$$;

commit;
