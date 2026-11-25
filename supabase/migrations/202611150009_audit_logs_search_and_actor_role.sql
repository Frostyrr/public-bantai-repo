-- Enhance platform_admin_list_audit_logs to return actor_role and search across
-- action, timestamp, actor, scope (organization), entity_id, and before/after summary values.
begin;

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
  left join public.profiles p on p.id = a.actor_id
  left join public.organizations o on o.id = a.organization_id
  where (
      v_action = ''
      or a.action ilike '%' || v_action || '%'
      or coalesce(p.display_name, 'System') ilike '%' || v_action || '%'
      or coalesce(p.role, 'system') ilike '%' || v_action || '%'
      or coalesce(a.actor_id::text, '') ilike '%' || v_action || '%'
      or coalesce(o.name, 'Platform') ilike '%' || v_action || '%'
      or coalesce(a.entity_id::text, '') ilike '%' || v_action || '%'
      or coalesce(a.before_value::text, '') ilike '%' || v_action || '%'
      or coalesce(a.after_value::text, '') ilike '%' || v_action || '%'
      or to_char(a.occurred_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') ilike '%' || v_action || '%'
    )
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
      'actor_role', p.role,
      'action', a.action,
      'entity_id', a.entity_id,
      'before_value', a.before_value,
      'after_value', a.after_value,
      'occurred_at', a.occurred_at
    ) as row_obj
    from public.audit_logs a
    left join public.profiles p on p.id = a.actor_id
    left join public.organizations o on o.id = a.organization_id
    where (
        v_action = ''
        or a.action ilike '%' || v_action || '%'
        or coalesce(p.display_name, 'System') ilike '%' || v_action || '%'
        or coalesce(p.role, 'system') ilike '%' || v_action || '%'
        or coalesce(a.actor_id::text, '') ilike '%' || v_action || '%'
        or coalesce(o.name, 'Platform') ilike '%' || v_action || '%'
        or coalesce(a.entity_id::text, '') ilike '%' || v_action || '%'
        or coalesce(a.before_value::text, '') ilike '%' || v_action || '%'
        or coalesce(a.after_value::text, '') ilike '%' || v_action || '%'
        or to_char(a.occurred_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') ilike '%' || v_action || '%'
      )
      and (p_from is null or a.occurred_at >= p_from)
      and (p_to is null or a.occurred_at <= p_to)
    order by a.occurred_at desc, a.id desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('logs', v_logs, 'total', v_total);
end;
$$;

commit;
