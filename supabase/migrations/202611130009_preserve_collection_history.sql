begin;

create or replace function public.delete_collection(
  p_org_id uuid,
  p_collection_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_has_history boolean;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to delete collections for this organization.';
  end if;

  perform 1 from public.collections
  where id = p_collection_id and organization_id = p_org_id for update;
  if not found then
    raise exception 'Collection not found in this organization.';
  end if;

  select exists (
    select 1 from public.obligations where collection_id = p_collection_id
  ) or exists (
    select 1 from public.payments where collection_id = p_collection_id
  ) into v_has_history;

  if v_has_history then
    update public.collections set status = 'archived', updated_at = now()
    where id = p_collection_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_collection_id, 'action', 'archived', 'message', 'Collection has financial history and was archived.');
  else
    delete from public.collections where id = p_collection_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_collection_id, 'action', 'deleted', 'message', 'Collection was deleted successfully.');
  end if;
end;
$$;

commit;
