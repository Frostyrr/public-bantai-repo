begin;

-- A passive read of the same deadline used by session_end.
create function public.bantai_session_idle_remaining(p_session uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case
    when p.role = 'super_admin' and (settings.value->>'super_admin_exempt')::boolean then null
    when (settings.value->>'idle_seconds')::integer = 0 then null
    else greatest(0, ceil(extract(epoch from (
      s.last_activity_at + make_interval(secs => (settings.value->>'idle_seconds')::integer)
      - bantai_private.session_now()
    )))::integer)
  end
  from bantai_private.sessions s
  join public.profiles p on p.id = s.user_id
  join public.platform_settings settings on settings.key = 'session_timeout'
  where s.id = p_session and s.user_id = p_user and s.end_reason is null
$$;

revoke all on function public.bantai_session_idle_remaining(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bantai_session_idle_remaining(uuid, uuid) to service_role;

commit;
