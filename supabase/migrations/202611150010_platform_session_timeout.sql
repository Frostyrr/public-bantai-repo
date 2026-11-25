-- Customizable platform session timeout setting and audit-logged super_admin RPC.
begin;

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_reason text,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;

insert into public.platform_settings (key, value, updated_reason)
values (
  'session_timeout',
  jsonb_build_object('timeout_minutes', 1440),
  'Default 24-hour platform session timeout'
)
on conflict (key) do nothing;

create or replace function public.get_platform_session_timeout()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select value, updated_reason, updated_at
  into v_row
  from public.platform_settings
  where key = 'session_timeout';

  return jsonb_build_object(
    'timeout_minutes', coalesce((v_row.value->>'timeout_minutes')::integer, 1440),
    'updated_reason', v_row.updated_reason,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_platform_session_timeout() from public;
grant execute on function public.get_platform_session_timeout() to authenticated;

create or replace function public.admin_set_session_timeout(
  p_timeout_minutes integer,
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
  v_minutes integer := coalesce(p_timeout_minutes, 1440);
  v_before jsonb;
  v_after jsonb;
begin
  if not public.is_platform_admin(true) then
    raise exception 'Super administrator access required';
  end if;

  if v_minutes <> 0 and (v_minutes < 5 or v_minutes > 43200) then
    raise exception 'Session timeout must be 0 (no custom limit) or between 5 and 43200 minutes';
  end if;

  if length(v_reason) < 3 then
    raise exception 'A documented reason (at least 3 characters) is required';
  end if;

  select value
  into v_before
  from public.platform_settings
  where key = 'session_timeout';

  v_after := jsonb_build_object('timeout_minutes', v_minutes);

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
    'updated_reason', v_reason,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.admin_set_session_timeout(integer, text) from public;
grant execute on function public.admin_set_session_timeout(integer, text) to authenticated;

commit;
