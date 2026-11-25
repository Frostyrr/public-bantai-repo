-- Support sub-minute (seconds) precision for platform session timeout policy.
begin;

create or replace function public.get_platform_session_timeout()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_minutes integer;
  v_seconds integer;
begin
  select value, updated_reason, updated_at
  into v_row
  from public.platform_settings
  where key = 'session_timeout';

  v_minutes := coalesce((v_row.value->>'timeout_minutes')::integer, 1440);
  v_seconds := coalesce((v_row.value->>'timeout_seconds')::integer, v_minutes * 60);

  return jsonb_build_object(
    'timeout_minutes', v_minutes,
    'timeout_seconds', v_seconds,
    'updated_reason', v_row.updated_reason,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_platform_session_timeout() from public;
grant execute on function public.get_platform_session_timeout() to authenticated;

drop function if exists public.admin_set_session_timeout(integer, text);

create or replace function public.admin_set_session_timeout(
  p_timeout_minutes integer,
  p_reason text,
  p_timeout_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_seconds integer := coalesce(p_timeout_seconds, coalesce(p_timeout_minutes, 1440) * 60);
  v_minutes integer;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.is_platform_admin(true) then
    raise exception 'Super administrator access required';
  end if;

  if v_seconds <> 0 and (v_seconds < 5 or v_seconds > 2592000) then
    raise exception 'Session timeout must be 0 (no custom limit) or between 5 seconds and 30 days';
  end if;

  v_minutes := case
    when v_seconds = 0 then 0
    else greatest(1, round(v_seconds::numeric / 60)::integer)
  end;

  if length(v_reason) < 3 then
    raise exception 'A documented reason (at least 3 characters) is required';
  end if;

  select value
  into v_before
  from public.platform_settings
  where key = 'session_timeout';

  v_after := jsonb_build_object(
    'timeout_minutes', v_minutes,
    'timeout_seconds', v_seconds
  );

  insert into public.platform_settings (
    key,
    value,
    updated_by,
    updated_reason,
    updated_at
  ) values (
    'session_timeout',
    v_after,
    v_actor,
    v_reason,
    now()
  )
  on conflict (key) do update set
    value = excluded.value,
    updated_by = excluded.updated_by,
    updated_reason = excluded.updated_reason,
    updated_at = excluded.updated_at;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_id, before_value, after_value
  ) values (
    null,
    v_actor,
    'platform_session_timeout_updated',
    v_actor,
    v_before,
    v_after || jsonb_build_object('reason', v_reason)
  );

  return jsonb_build_object(
    'timeout_minutes', v_minutes,
    'timeout_seconds', v_seconds,
    'updated_reason', v_reason,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.admin_set_session_timeout(integer, text, integer) from public;
grant execute on function public.admin_set_session_timeout(integer, text, integer) to authenticated;

commit;
