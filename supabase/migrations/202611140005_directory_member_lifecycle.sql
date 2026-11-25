begin;

-- Lifecycle metadata only. Existing member and financial rows are not changed by this migration.
create function public.directory_member_delete_preview(target_org uuid, target_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare obligation_count bigint; group_count bigint;
begin
  if not public.has_directory_capability(target_org,'edit') then
    raise exception 'You cannot manage directory members.' using errcode='42501';
  end if;
  if not exists(select 1 from public.organization_directory_members where organization_id=target_org and id=target_member) then
    raise exception 'Directory member not found.' using errcode='P0002';
  end if;
  select count(*) into obligation_count from public.obligations where organization_id=target_org and directory_member_id=target_member;
  select count(*) into group_count from public.directory_group_members where organization_id=target_org and member_id=target_member;
  return jsonb_build_object('canDelete',obligation_count=0,'obligations',obligation_count,'groupMemberships',group_count);
end;
$$;
revoke all on function public.directory_member_delete_preview(uuid,uuid) from public,anon;
grant execute on function public.directory_member_delete_preview(uuid,uuid) to authenticated;

create function public.delete_directory_member(target_org uuid,target_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare preview jsonb;
begin
  if not public.has_directory_capability(target_org,'edit') then
    raise exception 'You cannot delete directory members.' using errcode='42501';
  end if;
  -- Assignment also locks the member. The FK remains the final concurrent-write guard.
  perform 1 from public.organization_directory_members where organization_id=target_org and id=target_member for update;
  if not found then raise exception 'Directory member not found.' using errcode='P0002'; end if;
  preview := public.directory_member_delete_preview(target_org,target_member);
  if not (preview->>'canDelete')::boolean then
    raise exception 'This member has collection obligations. Archive the member to preserve financial history.' using errcode='23503';
  end if;
  -- Only directory group associations are disposable. Never cascade into financial tables.
  delete from public.directory_group_members where organization_id=target_org and member_id=target_member;
  delete from public.organization_directory_members where organization_id=target_org and id=target_member;
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(target_org,auth.uid(),'directory_member_deleted',target_member,
      jsonb_build_object('deleted',true,'group_memberships_removed',preview->'groupMemberships'));
end;
$$;
revoke all on function public.delete_directory_member(uuid,uuid) from public,anon;
grant execute on function public.delete_directory_member(uuid,uuid) to authenticated;

-- Continue existing audit behavior while making archive/restore actions explicit.
create or replace function public.audit_directory_member_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_action text;
begin
  new.updated_at := now();
  event_action := 'directory_member_' || lower(tg_op);
  if tg_op='UPDATE' then
    if old.status is distinct from new.status then
      event_action := case when new.status='archived' then 'directory_member_archived' else 'directory_member_restored' end;
    end if;
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(new.organization_id,auth.uid(),event_action,new.id,jsonb_build_object('status',new.status));
  return new;
end;
$$;
commit;
