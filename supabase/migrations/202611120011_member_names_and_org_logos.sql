-- Migration: Enable co-member profile visibility, backfill display names, and support organization settings & logos
begin;

-- 1. Create a security definer helper to check if two users belong to any common active organization
create or replace function public.is_org_comember(target_profile_id uuid, viewer_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members m1
    join public.organization_members m2 on m1.organization_id = m2.organization_id
    where m1.profile_id = viewer_user_id
      and m1.status = 'active'
      and m2.profile_id = target_profile_id
      and m2.status = 'active'
  );
$$;

revoke all on function public.is_org_comember(uuid, uuid) from public, anon;
grant execute on function public.is_org_comember(uuid, uuid) to authenticated;

-- 2. Update RLS policy on public.profiles: users can view their own profile and profiles of co-members
drop policy if exists profiles_self_read on public.profiles;
drop policy if exists profiles_comember_read on public.profiles;

create policy profiles_comember_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid()) or
    public.is_org_comember(profiles.id, (select auth.uid()))
  );

-- 3. Backfill any NULL or empty display_name in public.profiles from auth.users metadata or email prefix
update public.profiles p
set display_name = coalesce(
  nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
  nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
  nullif(trim(u.raw_user_meta_data->>'name'), ''),
  nullif(trim(split_part(u.email, '@', 1)), '')
)
from auth.users u
where p.id = u.id and (p.display_name is null or trim(p.display_name) = '');

-- 4. Update the trigger to ensure future user signups and logins auto-populate display_name
create or replace function public.create_profile_for_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(trim(split_part(new.email, '@', 1)), '')
    )
  )
  on conflict (id) do update set
    display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

-- 5. Add optional logo_url column to public.organizations
alter table public.organizations
  add column if not exists logo_url text check (logo_url is null or length(trim(logo_url)) between 1 and 250000);

-- 6. Add secure RPC function to update organization logo with role check and audit logging
create or replace function public.update_organization_logo(
  p_org_id uuid,
  p_logo_url text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_old_logo text;
begin
  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = auth.uid() and status = 'active';

  if v_role not in ('owner', 'organization_admin') then
    raise exception 'Insufficient permissions to update workspace logo';
  end if;

  select logo_url into v_old_logo from public.organizations where id = p_org_id;

  update public.organizations
  set logo_url = nullif(trim(p_logo_url), '')
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'update_organization_logo',
    p_org_id,
    jsonb_build_object('logo_url', v_old_logo),
    jsonb_build_object('logo_url', nullif(trim(p_logo_url), ''))
  );

  return jsonb_build_object('success', true, 'logo_url', nullif(trim(p_logo_url), ''));
end;
$$;

revoke all on function public.update_organization_logo(uuid, text) from public, anon;
grant execute on function public.update_organization_logo(uuid, text) to authenticated;

-- 7. Add secure RPC function to update organization details (name, currency)
create or replace function public.update_organization(
  p_org_id uuid,
  p_name text,
  p_currency text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_old_name text;
  v_old_currency text;
  v_clean_name text;
  v_clean_currency text;
begin
  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = auth.uid() and status = 'active';

  if v_role not in ('owner', 'organization_admin') then
    raise exception 'Insufficient permissions to update workspace settings';
  end if;

  v_clean_name := trim(p_name);
  if length(v_clean_name) < 1 or length(v_clean_name) > 150 then
    raise exception 'Organization name must be between 1 and 150 characters';
  end if;

  select name, currency into v_old_name, v_old_currency from public.organizations where id = p_org_id;

  v_clean_currency := upper(trim(coalesce(p_currency, v_old_currency)));
  if length(v_clean_currency) != 3 then
    raise exception 'Currency must be a 3-letter code';
  end if;

  update public.organizations
  set name = v_clean_name,
      currency = v_clean_currency
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'update_organization',
    p_org_id,
    jsonb_build_object('name', v_old_name, 'currency', v_old_currency),
    jsonb_build_object('name', v_clean_name, 'currency', v_clean_currency)
  );

  return jsonb_build_object(
    'id', p_org_id,
    'name', v_clean_name,
    'currency', v_clean_currency
  );
end;
$$;

revoke all on function public.update_organization(uuid, text, text) from public, anon;
grant execute on function public.update_organization(uuid, text, text) to authenticated;

-- 8. Add secure RPC function to regenerate organization invite code
create or replace function public.regenerate_invite_code(
  p_org_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_new_code text;
  v_old_code text;
begin
  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = auth.uid() and status = 'active';

  if v_role not in ('owner', 'organization_admin') then
    raise exception 'Insufficient permissions to regenerate invite code';
  end if;

  select invite_code into v_old_code from public.organizations where id = p_org_id;
  v_new_code := lower(substr(md5(p_org_id::text || clock_timestamp()::text || random()::text), 1, 8));

  update public.organizations
  set invite_code = v_new_code
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'regenerate_invite_code',
    p_org_id,
    jsonb_build_object('invite_code', v_old_code),
    jsonb_build_object('invite_code', v_new_code)
  );

  return jsonb_build_object('invite_code', v_new_code);
end;
$$;

revoke all on function public.regenerate_invite_code(uuid) from public, anon;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;

commit;
