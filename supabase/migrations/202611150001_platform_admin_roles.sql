-- Platform-wide user roles and admin dashboard RPCs.
begin;

alter table public.profiles
  add column if not exists role text not null default 'user'
  check (role in ('user', 'admin', 'super_admin'));

create index if not exists profiles_role_idx on public.profiles(role);

-- Prevent users from escalating their own platform role via direct table updates.
create or replace function public.guard_profile_platform_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('app.allow_platform_role_change', true), '') <> 'true' then
    raise exception 'Direct modification of platform role is forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_platform_role_change_trg on public.profiles;
create trigger guard_profile_platform_role_change_trg
  before update on public.profiles
  for each row
  execute function public.guard_profile_platform_role_change();

-- Helper: check whether the authenticated caller holds a platform admin role.
create or replace function public.is_platform_admin(required_super boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        (required_super and p.role = 'super_admin')
        or (not required_super and p.role in ('admin', 'super_admin'))
      )
  );
$$;

-- Overview metrics for the platform admin dashboard.
create or replace function public.platform_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total_users bigint;
  v_admin_count bigint;
  v_super_admin_count bigint;
  v_total_orgs bigint;
  v_active_memberships bigint;
  v_recent_audits bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select
    count(*),
    count(*) filter (where role = 'admin'),
    count(*) filter (where role = 'super_admin')
  into v_total_users, v_admin_count, v_super_admin_count
  from public.profiles;

  select count(*) into v_total_orgs from public.organizations;
  select count(*) into v_active_memberships from public.organization_members where status = 'active';
  select count(*) into v_recent_audits from public.audit_logs where occurred_at >= now() - interval '24 hours';

  return jsonb_build_object(
    'total_users', v_total_users,
    'admin_count', v_admin_count,
    'super_admin_count', v_super_admin_count,
    'total_organizations', v_total_orgs,
    'active_memberships', v_active_memberships,
    'recent_audit_events_24h', v_recent_audits
  );
end;
$$;

-- Paginated, searchable user directory with global roles.
create or replace function public.platform_admin_list_users(
  p_search text default '',
  p_role text default null,
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
  v_search text := trim(coalesce(p_search, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_users jsonb;
  v_total bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  if p_role is not null and p_role not in ('user', 'admin', 'super_admin') then
    raise exception 'Invalid role filter';
  end if;

  select count(*)
  into v_total
  from public.profiles p
  left join auth.users u on u.id = p.id
  where (p_role is null or p.role = p_role)
    and (
      v_search = ''
      or coalesce(p.display_name, '') ilike '%' || v_search || '%'
      or coalesce(u.email, '') ilike '%' || v_search || '%'
      or p.id::text ilike '%' || v_search || '%'
    );

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_users
  from (
    select jsonb_build_object(
      'id', p.id,
      'email', u.email,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'role', p.role,
      'created_at', p.created_at,
      'organization_count', (
        select count(*)
        from public.organization_members m
        where m.profile_id = p.id and m.status = 'active'
      )
    ) as row_obj
    from public.profiles p
    left join auth.users u on u.id = p.id
    where (p_role is null or p.role = p_role)
      and (
        v_search = ''
        or coalesce(p.display_name, '') ilike '%' || v_search || '%'
        or coalesce(u.email, '') ilike '%' || v_search || '%'
        or p.id::text ilike '%' || v_search || '%'
      )
    order by
      case p.role when 'super_admin' then 0 when 'admin' then 1 else 2 end,
      p.created_at desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('users', v_users, 'total', v_total);
end;
$$;

-- Super-admin-only global role assignment with last-super-admin guard and audit logging.
create or replace function public.platform_admin_set_user_role(
  p_target_user_id uuid,
  p_new_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old_role text;
  v_super_count bigint;
begin
  if not public.is_platform_admin(true) then
    raise exception 'Super administrator access required';
  end if;

  if p_new_role not in ('user', 'admin', 'super_admin') then
    raise exception 'Invalid platform role';
  end if;

  select role into v_old_role
  from public.profiles
  where id = p_target_user_id
  for update;

  if not found then
    raise exception 'User profile not found';
  end if;

  if v_old_role = 'super_admin' and p_new_role <> 'super_admin' then
    select count(*) into v_super_count
    from public.profiles
    where role = 'super_admin';

    if v_super_count <= 1 then
      raise exception 'Cannot demote the last super_admin';
    end if;
  end if;

  perform set_config('app.allow_platform_role_change', 'true', true);
  update public.profiles
  set role = p_new_role
  where id = p_target_user_id;
  perform set_config('app.allow_platform_role_change', 'false', true);

  insert into public.audit_logs (
    organization_id,
    actor_id,
    action,
    entity_id,
    before_value,
    after_value
  )
  values (
    null,
    v_actor,
    'platform_role_updated',
    p_target_user_id,
    jsonb_build_object('role', v_old_role),
    jsonb_build_object('role', p_new_role)
  );

  return jsonb_build_object(
    'id', p_target_user_id,
    'previous_role', v_old_role,
    'role', p_new_role
  );
end;
$$;

-- Paginated, searchable organizations overview.
create or replace function public.platform_admin_list_organizations(
  p_search text default '',
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
  v_search text := trim(coalesce(p_search, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_orgs jsonb;
  v_total bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select count(*)
  into v_total
  from public.organizations o
  where v_search = ''
    or o.name ilike '%' || v_search || '%'
    or o.id::text ilike '%' || v_search || '%';

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_orgs
  from (
    select jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'organization_type', o.organization_type,
      'currency', o.currency,
      'time_zone', o.time_zone,
      'created_at', o.created_at,
      'creator_id', creator.profile_id,
      'creator_name', creator.display_name,
      'creator_email', creator.email,
      'active_member_count', (
        select count(*)
        from public.organization_members m
        where m.organization_id = o.id and m.status = 'active'
      )
    ) as row_obj
    from public.organizations o
    left join lateral (
      select m.profile_id, p.display_name, u.email
      from public.organization_members m
      left join public.profiles p on p.id = m.profile_id
      left join auth.users u on u.id = m.profile_id
      where m.organization_id = o.id
      order by
        case when m.role = 'owner' then 0 when m.role = 'organization_admin' then 1 else 2 end,
        case when m.status = 'active' then 0 else 1 end,
        m.created_at asc
      limit 1
    ) creator on true
    where v_search = ''
      or o.name ilike '%' || v_search || '%'
      or o.id::text ilike '%' || v_search || '%'
      or coalesce(creator.display_name, '') ilike '%' || v_search || '%'
      or coalesce(creator.email, '') ilike '%' || v_search || '%'
    order by o.created_at desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('organizations', v_orgs, 'total', v_total);
end;
$$;

-- System-wide audit logs & security events.
create or replace function public.platform_admin_list_audit_logs(
  p_action text default '',
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
  where v_action = '' or a.action ilike '%' || v_action || '%';

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
    where v_action = '' or a.action ilike '%' || v_action || '%'
    order by a.occurred_at desc, a.id desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('logs', v_logs, 'total', v_total);
end;
$$;

revoke all on function public.guard_profile_platform_role_change() from public, anon, authenticated;
revoke all on function public.is_platform_admin(boolean) from public, anon;
grant execute on function public.is_platform_admin(boolean) to authenticated;
revoke all on function public.platform_admin_overview() from public, anon;
grant execute on function public.platform_admin_overview() to authenticated;
revoke all on function public.platform_admin_list_users(text, text, integer, integer) from public, anon;
grant execute on function public.platform_admin_list_users(text, text, integer, integer) to authenticated;
revoke all on function public.platform_admin_set_user_role(uuid, text) from public, anon;
grant execute on function public.platform_admin_set_user_role(uuid, text) to authenticated;
revoke all on function public.platform_admin_list_organizations(text, integer, integer) from public, anon;
grant execute on function public.platform_admin_list_organizations(text, integer, integer) to authenticated;
revoke all on function public.platform_admin_list_audit_logs(text, integer, integer) from public, anon;
grant execute on function public.platform_admin_list_audit_logs(text, integer, integer) to authenticated;

commit;
