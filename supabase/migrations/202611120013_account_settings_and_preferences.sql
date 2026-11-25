-- Migration: 202611120013_account_settings_and_preferences.sql
-- Description: Profile avatars, user preferences, safe leave-organization flow, and account anonymization.

begin;

-- 1. Add avatar_url to public.profiles
alter table public.profiles
  add column if not exists avatar_url text;

-- 2. Allow authenticated users to update their own profile (display_name, avatar_url)
grant update (display_name, avatar_url) on public.profiles to authenticated;

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 3. Extend organization_members status constraint to support 'left'
alter table public.organization_members
  drop constraint if exists organization_members_status_check;

alter table public.organization_members
  add constraint organization_members_status_check
  check (status in ('active', 'suspended', 'left'));

-- 4. User preferences table
create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'system')),
  reduced_motion boolean not null default false,
  default_organization_id uuid references public.organizations(id) on delete set null,
  notifications jsonb not null default '{
    "email_approvals": true,
    "email_payments": true,
    "email_invites": true,
    "in_app_approvals": true,
    "in_app_payments": true,
    "in_app_invites": true
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;

drop policy if exists user_preferences_self_read on public.user_preferences;
create policy user_preferences_self_read on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_preferences_self_insert on public.user_preferences;
create policy user_preferences_self_insert on public.user_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_preferences_self_update on public.user_preferences;
create policy user_preferences_self_update on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_preferences_self_delete on public.user_preferences;
create policy user_preferences_self_delete on public.user_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

-- 5. Safe leave organization function
create or replace function public.leave_organization(
  p_org_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_member_id uuid;
  v_role text;
  v_other_owners int;
  v_unliquidated_advances int;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select id, role into v_member_id, v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_member_id is null then
    raise exception 'You are not an active member of this organization.';
  end if;

  if v_role = 'owner' then
    select count(*) into v_other_owners
    from public.organization_members
    where organization_id = p_org_id and role = 'owner' and status = 'active' and profile_id != v_caller;

    if v_other_owners = 0 then
      raise exception 'Cannot leave organization as the sole owner. Transfer ownership or close the organization first.';
    end if;
  end if;

  select count(*) into v_unliquidated_advances
  from public.cash_advances
  where accountable_person_id = v_member_id
    and status in ('outstanding', 'under_review', 'disputed');

  if v_unliquidated_advances > 0 then
    raise exception 'Cannot leave organization with unliquidated cash advances. Please liquidate or return advances first.';
  end if;

  update public.organization_members
  set status = 'left'
  where id = v_member_id;

  update public.user_preferences
  set default_organization_id = null
  where user_id = v_caller and default_organization_id = p_org_id;

  insert into public.audit_logs (
    organization_id, actor_id, database_actor, action, entity_id, before_value, after_value
  ) values (
    p_org_id, v_caller, session_user, 'leave_organization', v_member_id,
    jsonb_build_object('role', v_role, 'status', 'active'),
    jsonb_build_object('role', v_role, 'status', 'left')
  );

  return jsonb_build_object('success', true, 'organization_id', p_org_id);
end;
$$;

revoke all on function public.leave_organization(uuid) from public, anon;
grant execute on function public.leave_organization(uuid) to authenticated;

-- 6. Safe delete personal account function
create or replace function public.delete_personal_account()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_sole_owner_orgs text[];
  v_unliquidated_advances int;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  -- Check if caller is sole owner of any active org
  select array_agg(o.name) into v_sole_owner_orgs
  from public.organization_members m1
  join public.organizations o on o.id = m1.organization_id
  where m1.profile_id = v_caller
    and m1.role = 'owner'
    and m1.status = 'active'
    and not exists (
      select 1 from public.organization_members m2
      where m2.organization_id = m1.organization_id
        and m2.role = 'owner'
        and m2.status = 'active'
        and m2.profile_id != v_caller
    );

  if v_sole_owner_orgs is not null and array_length(v_sole_owner_orgs, 1) > 0 then
    raise exception 'Cannot delete account while you are the sole owner of: %. Please transfer ownership or close these organizations first.', array_to_string(v_sole_owner_orgs, ', ');
  end if;

  -- Check unliquidated cash advances across all orgs
  select count(*) into v_unliquidated_advances
  from public.cash_advances ca
  join public.organization_members om on ca.accountable_person_id = om.id
  where om.profile_id = v_caller
    and ca.status in ('outstanding', 'under_review', 'disputed');

  if v_unliquidated_advances > 0 then
    raise exception 'Cannot delete account with unliquidated cash advances. Please liquidate all advances first.';
  end if;

  -- Suspend/mark memberships as left
  update public.organization_members
  set status = 'left'
  where profile_id = v_caller and status = 'active';

  -- Remove personal preferences
  delete from public.user_preferences
  where user_id = v_caller;

  -- Anonymize personal profile (preserves ledger integrity)
  update public.profiles
  set display_name = 'Former Member',
      avatar_url = null
  where id = v_caller;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.delete_personal_account() from public, anon;
grant execute on function public.delete_personal_account() to authenticated;

commit;
