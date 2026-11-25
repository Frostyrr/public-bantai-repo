begin;

create or replace function public.bantai_login_restriction(p_email text, p_identifier text, p_ip text)
returns jsonb language sql volatile security definer set search_path = ''
as $$
  with state as (
    select coalesce(s.failures, 0) as failures,
      greatest(s.locked_until, p.locked_until) as account_end,
      case when ip.status = 'restricted' then coalesce(ip.expires_at, bantai_private.session_now() + interval '10 minutes') end as ip_end
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

commit;
