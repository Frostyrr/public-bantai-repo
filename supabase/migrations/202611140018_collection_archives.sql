begin;
alter table public.collections
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id) on delete set null,
  add column pre_archive_status text check (pre_archive_status in ('active', 'closed'));
create index collection_archive_order on public.collections
  (organization_id, archived_at desc nulls last, id) where status = 'archived';

create function public.capture_collection_archive() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'archived' and new.status = 'archived' then
    new.pre_archive_status := old.status;
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif old.status = 'archived' and new.status <> 'archived' then
    if new.status <> coalesce(old.pre_archive_status, 'closed') then
      raise exception 'Restore the collection to its previous status.' using errcode = '23514';
    end if;
    new.archived_at := null;
    new.archived_by := null;
    new.pre_archive_status := null;
  end if;
  return new;
end;
$$;
create trigger capture_collection_archive before update of status on public.collections
for each row execute function public.capture_collection_archive();

create function public.set_collection_archived(org uuid, collection uuid, archive boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare current_collection public.collections;
begin
  if not exists (select 1 from public.organization_members where organization_id = org
    and profile_id = auth.uid() and status = 'active' and role in ('owner','organization_admin','treasurer')) then
    raise exception 'You cannot archive or restore collections.' using errcode = '42501';
  end if;
  select * into current_collection from public.collections where organization_id = org and id = collection for update;
  if not found then raise exception 'Collection not found.' using errcode = 'P0002'; end if;
  if archive = (current_collection.status = 'archived') then return current_collection.status; end if;
  update public.collections set status = case when archive then 'archived'
    else coalesce(current_collection.pre_archive_status, 'closed') end, updated_at = now()
    where id = collection returning status into current_collection.status;
  return current_collection.status;
end;
$$;

create function public.list_collection_archives(org uuid, search text, page integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organization_members where organization_id = org
    and profile_id = auth.uid() and status = 'active' and role in ('owner','organization_admin','treasurer','auditor')) then
    raise exception 'You cannot view collection archives.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(rows) order by archived_at desc nulls last, id), '[]'::jsonb) from (
    select c.id, c.title, c.archived_at, p.display_name as archived_by, s.name as space
    from public.collections c
    left join public.profiles p on p.id = c.archived_by
    left join public.spaces s on s.id = c.space_id and s.organization_id = org
    where c.organization_id = org and c.status = 'archived'
      and strpos(lower(c.title), lower(coalesce(search,''))) > 0
    order by c.archived_at desc nulls last, c.id limit 21 offset (greatest(page, 0)::bigint * 20)
  ) rows);
end;
$$;
revoke all on function public.set_collection_archived(uuid,uuid,boolean), public.list_collection_archives(uuid,text,integer) from public,anon;
grant execute on function public.set_collection_archived(uuid,uuid,boolean), public.list_collection_archives(uuid,text,integer) to authenticated;
commit;
