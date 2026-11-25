-- Migration: 202611120014_org_ownership_and_deletion.sql
-- Description: Check organization deletability, transfer organization ownership, and safe organization deletion.

begin;

-- 1. Check organization deletability function
create or replace function public.check_org_deletability(
  p_org_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_unliquidated_count int := 0;
  v_unliquidated_centavos bigint := 0;
  v_is_deletable boolean := true;
  v_reasons text[] := array[]::text[];
  v_members_count int := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null then
    raise exception 'You are not an active member of this organization.';
  end if;

  if v_role != 'owner' then
    v_is_deletable := false;
    v_reasons := array_append(v_reasons, 'Only an organization owner can delete this organization.');
  end if;

  -- Count unliquidated cash advances
  select count(*), coalesce(sum(amount_released_centavos), 0)
  into v_unliquidated_count, v_unliquidated_centavos
  from public.cash_advances
  where organization_id = p_org_id
    and status in ('outstanding', 'under_review', 'disputed');

  if v_unliquidated_count > 0 then
    v_is_deletable := false;
    v_reasons := array_append(v_reasons, format('Cannot delete organization with %s unliquidated cash advance(s) totaling %s centavos. All cash advances must be liquidated or settled first.', v_unliquidated_count, v_unliquidated_centavos));
  end if;

  select count(*) into v_members_count
  from public.organization_members
  where organization_id = p_org_id and status = 'active';

  return jsonb_build_object(
    'organization_id', p_org_id,
    'is_deletable', v_is_deletable,
    'unliquidated_count', v_unliquidated_count,
    'unliquidated_amount_centavos', v_unliquidated_centavos,
    'members_count', v_members_count,
    'reasons', v_reasons
  );
end;
$$;

revoke all on function public.check_org_deletability(uuid) from public, anon;
grant execute on function public.check_org_deletability(uuid) to authenticated;

-- 2. Transfer organization ownership function
create or replace function public.transfer_organization_ownership(
  p_org_id uuid,
  p_target_member_id uuid,
  p_current_owner_role text default 'organization_admin'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_caller_member_id uuid;
  v_target_profile_id uuid;
  v_target_role text;
  v_target_status text;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  if p_current_owner_role not in ('owner', 'organization_admin', 'member') then
    raise exception 'Invalid subsequent role for former owner.';
  end if;

  -- Check caller is an active owner
  select id, role into v_caller_member_id, v_caller_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_caller_role is null or v_caller_role != 'owner' then
    raise exception 'Unauthorized: Only an organization owner can transfer ownership.';
  end if;

  -- Check target member
  select profile_id, role, status into v_target_profile_id, v_target_role, v_target_status
  from public.organization_members
  where id = p_target_member_id and organization_id = p_org_id;

  if v_target_profile_id is null or v_target_status != 'active' then
    raise exception 'Target member must be an active member of this organization.';
  end if;

  if v_target_profile_id = v_caller then
    raise exception 'Cannot transfer ownership to yourself.';
  end if;

  -- Promote target member to owner
  update public.organization_members
  set role = 'owner'
  where id = p_target_member_id;

  -- Update caller's role
  update public.organization_members
  set role = p_current_owner_role
  where id = v_caller_member_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, actor_id, database_actor, action, entity_id, before_value, after_value
  ) values (
    p_org_id, v_caller, session_user, 'transfer_ownership', p_target_member_id,
    jsonb_build_object('from_profile', v_caller, 'to_profile', v_target_profile_id),
    jsonb_build_object('new_owner_role', 'owner', 'previous_owner_new_role', p_current_owner_role)
  );

  return jsonb_build_object(
    'success', true,
    'organization_id', p_org_id,
    'new_owner_member_id', p_target_member_id,
    'new_owner_profile_id', v_target_profile_id,
    'previous_owner_new_role', p_current_owner_role
  );
end;
$$;

revoke all on function public.transfer_organization_ownership(uuid, uuid, text) from public, anon;
grant execute on function public.transfer_organization_ownership(uuid, uuid, text) to authenticated;

-- 3. Delete organization function
create or replace function public.delete_organization(
  p_org_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_unliquidated_count int := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role != 'owner' then
    raise exception 'Unauthorized: Only an organization owner can delete the organization.';
  end if;

  -- Verify no unliquidated cash advances
  select count(*) into v_unliquidated_count
  from public.cash_advances
  where organization_id = p_org_id
    and status in ('outstanding', 'under_review', 'disputed');

  if v_unliquidated_count > 0 then
    raise exception 'Cannot delete organization with unliquidated cash advances. All advances must be liquidated or returned first.';
  end if;

  -- Clean up default org in user preferences
  update public.user_preferences
  set default_organization_id = null
  where default_organization_id = p_org_id;

  -- Delete all organization child records cleanly
  delete from public.liquidations where organization_id = p_org_id;
  delete from public.cash_advances where organization_id = p_org_id;
  delete from public.approvals where organization_id = p_org_id;
  delete from public.expenses where organization_id = p_org_id;
  delete from public.budgets where organization_id = p_org_id;
  delete from public.payments where organization_id = p_org_id;
  delete from public.obligations where organization_id = p_org_id;
  delete from public.collections where organization_id = p_org_id;
  delete from public.spaces where organization_id = p_org_id;
  delete from public.reporting_periods where organization_id = p_org_id;
  delete from public.organization_members where organization_id = p_org_id;
  delete from public.audit_logs where organization_id = p_org_id;
  delete from public.organizations where id = p_org_id;

  return jsonb_build_object('success', true, 'organization_id', p_org_id);
end;
$$;

revoke all on function public.delete_organization(uuid) from public, anon;
grant execute on function public.delete_organization(uuid) to authenticated;

commit;
