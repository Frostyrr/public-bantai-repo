begin;
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

  if (old_role = 'owner' or p_new_role = 'owner') and not exists (
    select 1 from public.organization_members m
    where m.organization_id=target_org_id and m.profile_id=actor_id
      and m.status='active' and m.role='owner'
  ) then
    raise exception 'Only owners can grant or change ownership.' using errcode='42501';
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

commit;
