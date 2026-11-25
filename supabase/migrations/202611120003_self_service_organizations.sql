-- Migration: Self-service organization creation, owner role, and invite-code joining.
begin;

-- 1. Modernize role constraint to include 'owner' and 'member' alongside legacy roles.
alter table public.organization_members
  drop constraint if exists organization_members_role_check;

alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner', 'organization_admin', 'treasurer', 'auditor', 'member', 'student'));

-- Migrate any legacy 'student' roles to 'member'
update public.organization_members
set role = 'member'
where role = 'student';

-- 2. Add currency and unique invite code to public.organizations
alter table public.organizations
  add column if not exists currency char(3) not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  add column if not exists invite_code text unique check (invite_code is null or length(trim(invite_code)) >= 6);

-- Populate invite codes for any pre-existing organizations without one
update public.organizations
set invite_code = lower(substr(md5(id::text || clock_timestamp()::text), 1, 8))
where invite_code is null;

-- 3. Non-recursive security definer helper to check active organization membership
create or replace function public.is_active_org_member(org_id uuid, user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id and profile_id = user_id and status = 'active'
  );
$$;

revoke all on function public.is_active_org_member(uuid, uuid) from public, anon;
grant execute on function public.is_active_org_member(uuid, uuid) to authenticated;

-- 4. Update organization_members RLS to allow reading rosters within one's own organizations
drop policy if exists memberships_self_read on public.organization_members;
create policy memberships_org_read on public.organization_members for select to authenticated
  using (
    (profile_id = (select auth.uid()) and status = 'active') or
    public.is_active_org_member(organization_members.organization_id, (select auth.uid()))
  );

-- 5. Atomic self-service organization creation and owner provisioning
create or replace function public.create_organization_with_owner(
  org_name text,
  org_currency text default 'PHP'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  new_org_id uuid;
  actor_id uuid;
  clean_name text;
  clean_currency text;
  new_invite_code text;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'Authentication required to create an organization.';
  end if;

  clean_name := trim(org_name);
  if length(clean_name) < 2 or length(clean_name) > 150 then
    raise exception 'Organization name must be between 2 and 150 characters.';
  end if;

  clean_currency := upper(trim(coalesce(org_currency, 'PHP')));
  if clean_currency !~ '^[A-Z]{3}$' then
    clean_currency := 'PHP';
  end if;

  new_invite_code := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- 1. Insert organization
  insert into public.organizations (name, currency, invite_code)
  values (clean_name, clean_currency, new_invite_code)
  returning id into new_org_id;

  -- 2. Atomically assign creator as Owner
  insert into public.organization_members (organization_id, profile_id, role, status)
  values (new_org_id, actor_id, 'owner', 'active');

  return jsonb_build_object(
    'id', new_org_id,
    'name', clean_name,
    'currency', clean_currency,
    'invite_code', new_invite_code,
    'role', 'owner'
  );
end;
$$;

revoke all on function public.create_organization_with_owner(text, text) from public, anon;
grant execute on function public.create_organization_with_owner(text, text) to authenticated;

-- 6. Self-service organization joining via invite code
create or replace function public.join_organization_by_code(
  code text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  target_org_id uuid;
  target_org_name text;
  target_currency text;
  existing_status text;
  existing_role text;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'Authentication required to join an organization.';
  end if;

  if code is null or length(trim(code)) < 4 then
    raise exception 'Invalid invitation code.';
  end if;

  select id, name, currency into target_org_id, target_org_name, target_currency
  from public.organizations
  where lower(trim(invite_code)) = lower(trim(code));

  if target_org_id is null then
    raise exception 'Organization not found for the provided code.';
  end if;

  select status, role into existing_status, existing_role
  from public.organization_members
  where organization_id = target_org_id and profile_id = actor_id;

  if existing_status = 'active' then
    raise exception 'You are already an active member of this organization.';
  elsif existing_status = 'suspended' then
    raise exception 'Your membership in this organization is suspended.';
  end if;

  insert into public.organization_members (organization_id, profile_id, role, status)
  values (target_org_id, actor_id, 'member', 'active')
  on conflict (organization_id, profile_id) do update set status = 'active';

  return jsonb_build_object(
    'id', target_org_id,
    'name', target_org_name,
    'currency', target_currency,
    'role', coalesce(existing_role, 'member')
  );
end;
$$;

revoke all on function public.join_organization_by_code(text) from public, anon;
grant execute on function public.join_organization_by_code(text) to authenticated;

commit;
