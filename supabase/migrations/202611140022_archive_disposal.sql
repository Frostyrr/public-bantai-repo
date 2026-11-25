begin;
alter table public.collections add column retention_hold boolean not null default false;

create function public.collection_deletion_policy(c public.collections)
returns text language sql stable set search_path = '' as $$
 select case
  when c.retention_hold or exists (select 1 from public.obligations where collection_id=c.id and status not in ('paid','waived'))
    then 'protected'
  when exists (select 1 from public.obligations where collection_id=c.id)
    or exists (select 1 from public.payments where collection_id=c.id)
    or exists (select 1 from public.approvals where organization_id=c.organization_id and entity_id=c.id)
    then 'retention_review'
  when c.status='archived' then 'immediate'
  else 'protected' end;
$$;
revoke all on function public.collection_deletion_policy(public.collections) from public,anon,authenticated;

create function public.purge_archived_collection(org uuid, collection uuid, confirmation text)
returns void language plpgsql security definer set search_path='' as $$
declare c public.collections;
begin
 if not exists(select 1 from public.organization_members where organization_id=org and profile_id=auth.uid()
   and status='active' and role in ('owner','organization_admin')) then
   raise exception 'Only an owner or admin may permanently delete an archive.' using errcode='42501';
 end if;
 select * into c from public.collections where organization_id=org and id=collection for update;
 if not found then raise exception 'Collection not found.' using errcode='P0002'; end if;
 if public.collection_deletion_policy(c)<>'immediate' then
   raise exception 'This collection must be retained.' using errcode='23514';
 end if;
 if confirmation is distinct from c.title then
   raise exception 'Enter the exact collection name.' using errcode='23514';
 end if;
 delete from public.collections where id=c.id and organization_id=org;
end;
$$;
revoke all on function public.purge_archived_collection(uuid,uuid,text) from public,anon;
grant execute on function public.purge_archived_collection(uuid,uuid,text) to authenticated;

-- The existing removal operation now moves collections into Archives.
create or replace function public.delete_collection(p_org_id uuid,p_collection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.set_collection_archived(p_org_id,p_collection_id,true);
 return jsonb_build_object('id',p_collection_id,'action','archived','message','Collection archived.');
end;
$$;

drop trigger collections_audit on public.collections;
create trigger collections_audit after insert or update on public.collections
for each row execute function public.audit_record_change();

create function public.audit_collection_disposal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
 values(old.organization_id,auth.uid(),'collections.delete',old.id,
 jsonb_build_object('classification','immediate','reason','Unused archived collection'));
 return old;
end;
$$;
create function public.reject_protected_collection_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.collection_deletion_policy(old)<>'immediate' then
   raise exception 'This collection must be retained.' using errcode='23514';
 end if;
 return old;
end;
$$;
create trigger collection_disposal_guard before delete on public.collections
for each row execute function public.reject_protected_collection_delete();

create trigger collection_disposal_audit after delete on public.collections
for each row execute function public.audit_collection_disposal();

create or replace function public.list_collection_archives(org uuid, search text, page integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organization_members where organization_id = org
    and profile_id = auth.uid() and status = 'active' and role in ('owner','organization_admin','treasurer','auditor')) then
    raise exception 'You cannot view collection archives.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(rows) order by archived_at desc nulls last, id), '[]'::jsonb) from (
    select c.id, c.title, c.archived_at, p.display_name as archived_by, s.name as space, public.collection_deletion_policy(c) as classification
    from public.collections c
    left join public.profiles p on p.id = c.archived_by
    left join public.spaces s on s.id = c.space_id and s.organization_id = org
    where c.organization_id = org and c.status = 'archived'
      and strpos(lower(c.title), lower(coalesce(search,''))) > 0
    order by c.archived_at desc nulls last, c.id limit 21 offset (greatest(page, 0)::bigint * 20)
  ) rows);
end;
$$;
commit;
