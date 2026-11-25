-- Migration: Reporting Periods, Optional Spaces, and Member Role Management with Audit Logging
begin;

-- 1. Helper function: verify if user is an officer (owner, organization_admin, treasurer)
create or replace function public.is_org_officer(org_id uuid, user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and profile_id = user_id
      and status = 'active'
      and role in ('owner', 'organization_admin', 'treasurer')
  );
$$;

revoke all on function public.is_org_officer(uuid, uuid) from public, anon;
grant execute on function public.is_org_officer(uuid, uuid) to authenticated;

-- Helper function: verify if user is an owner or organization admin
create or replace function public.is_org_admin(org_id uuid, user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and profile_id = user_id
      and status = 'active'
      and role in ('owner', 'organization_admin')
  );
$$;

revoke all on function public.is_org_admin(uuid, uuid) from public, anon;
grant execute on function public.is_org_admin(uuid, uuid) to authenticated;

-- 2. Reporting Periods table
create table if not exists public.reporting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 100),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status text not null default 'active' check (status in ('active', 'closed', 'upcoming')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reporting_periods_org_status on public.reporting_periods(organization_id, status);

-- 3. Spaces table (Optional Collaborative Initiative Containers)
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 100),
  description text,
  status text not null default 'active' check (status in ('active', 'archived', 'completed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists spaces_org_status on public.spaces(organization_id, status);

-- 4. Enable RLS
alter table public.reporting_periods enable row level security;
alter table public.spaces enable row level security;

revoke all on public.reporting_periods, public.spaces from anon, authenticated;
grant select on public.reporting_periods, public.spaces to authenticated;

-- RLS Read Policies: active members can view their organization's periods and spaces
create policy periods_org_read on public.reporting_periods for select to authenticated
  using (public.is_active_org_member(reporting_periods.organization_id, (select auth.uid())));

create policy spaces_org_read on public.spaces for select to authenticated
  using (public.is_active_org_member(spaces.organization_id, (select auth.uid())));

-- 5. Generic Audit Trigger Function
create or replace function public.audit_record_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  org_id uuid;
  rec_id uuid;
begin
  org_id := case when TG_OP = 'DELETE' then old.organization_id else new.organization_id end;
  rec_id := case when TG_OP = 'DELETE' then old.id else new.id end;

  insert into public.audit_logs(organization_id, actor_id, action, entity_id, before_value, after_value)
  values (
    org_id,
    auth.uid(),
    TG_TABLE_NAME || '.' || lower(TG_OP),
    rec_id,
    case when TG_OP <> 'INSERT' then to_jsonb(old) else null end,
    case when TG_OP <> 'DELETE' then to_jsonb(new) else null end
  );

  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_record_change() from public, anon, authenticated;

drop trigger if exists periods_audit on public.reporting_periods;
create trigger periods_audit after insert or update or delete on public.reporting_periods
  for each row execute function public.audit_record_change();

drop trigger if exists spaces_audit on public.spaces;
create trigger spaces_audit after insert or update or delete on public.spaces
  for each row execute function public.audit_record_change();

-- 6. Atomic Stored Procedures for Reporting Periods
create or replace function public.create_reporting_period(
  p_org_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date,
  p_is_default boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  new_period_id uuid;
  clean_name text;
begin
  actor_id := auth.uid();
  if actor_id is null or not public.is_org_officer(p_org_id, actor_id) then
    raise exception 'Unauthorized: Only organization officers can create reporting periods.';
  end if;

  clean_name := trim(p_name);
  if length(clean_name) < 1 or length(clean_name) > 100 then
    raise exception 'Reporting period name must be between 1 and 100 characters.';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be earlier than start date.';
  end if;

  if p_is_default then
    update public.reporting_periods
    set is_default = false
    where organization_id = p_org_id and is_default = true;
  end if;

  insert into public.reporting_periods (organization_id, name, start_date, end_date, is_default, status)
  values (p_org_id, clean_name, p_start_date, p_end_date, p_is_default, 'active')
  returning id into new_period_id;

  return jsonb_build_object(
    'id', new_period_id,
    'organization_id', p_org_id,
    'name', clean_name,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'status', 'active',
    'is_default', p_is_default
  );
end;
$$;

revoke all on function public.create_reporting_period(uuid, text, date, date, boolean) from public, anon;
grant execute on function public.create_reporting_period(uuid, text, date, date, boolean) to authenticated;

-- 7. Atomic Stored Procedures for Spaces
create or replace function public.create_space(
  p_org_id uuid,
  p_name text,
  p_description text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  new_space_id uuid;
  clean_name text;
begin
  actor_id := auth.uid();
  if actor_id is null or not public.is_active_org_member(p_org_id, actor_id) then
    raise exception 'Unauthorized: Only organization members can create spaces.';
  end if;

  clean_name := trim(p_name);
  if length(clean_name) < 1 or length(clean_name) > 100 then
    raise exception 'Space name must be between 1 and 100 characters.';
  end if;

  insert into public.spaces (organization_id, name, description, created_by, status)
  values (p_org_id, clean_name, nullif(trim(p_description), ''), actor_id, 'active')
  returning id into new_space_id;

  return jsonb_build_object(
    'id', new_space_id,
    'organization_id', p_org_id,
    'name', clean_name,
    'description', p_description,
    'status', 'active'
  );
end;
$$;

revoke all on function public.create_space(uuid, text, text) from public, anon;
grant execute on function public.create_space(uuid, text, text) to authenticated;

-- 8. Stored Procedure for Member Role Management
create or replace function public.update_member_role(
  p_membership_id uuid,
  p_new_role text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  target_org_id uuid;
  target_profile_id uuid;
  old_role text;
  owner_count int;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_new_role not in ('owner', 'organization_admin', 'treasurer', 'auditor', 'member') then
    raise exception 'Invalid organization role.';
  end if;

  select organization_id, profile_id, role into target_org_id, target_profile_id, old_role
  from public.organization_members
  where id = p_membership_id;

  if target_org_id is null then
    raise exception 'Membership record not found.';
  end if;

  if not public.is_org_admin(target_org_id, actor_id) then
    raise exception 'Unauthorized: Only owners and admins can modify member roles.';
  end if;

  -- Ensure at least one owner remains
  if old_role = 'owner' and p_new_role <> 'owner' then
    select count(*) into owner_count
    from public.organization_members
    where organization_id = target_org_id and role = 'owner' and status = 'active';

    if owner_count <= 1 then
      raise exception 'Cannot demote the only owner. Assign another owner first.';
    end if;
  end if;

  update public.organization_members
  set role = p_new_role
  where id = p_membership_id;

  return jsonb_build_object(
    'id', p_membership_id,
    'organization_id', target_org_id,
    'profile_id', target_profile_id,
    'role', p_new_role
  );
end;
$$;

revoke all on function public.update_member_role(uuid, text) from public, anon;
grant execute on function public.update_member_role(uuid, text) to authenticated;

commit;
