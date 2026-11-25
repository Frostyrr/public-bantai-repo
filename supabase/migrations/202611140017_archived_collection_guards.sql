begin;

create function public.guard_archived_collection_finances()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent uuid;
  collection_status text;
begin
  if tg_op = 'INSERT' then parent := new.collection_id;
  else parent := old.collection_id;
  end if;
  select status into collection_status from public.collections where id = parent for update;
  if collection_status = 'archived' then
    raise exception 'Restore the collection before changing its dues or payments.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger archived_collection_obligations before insert or update or delete on public.obligations
for each row execute function public.guard_archived_collection_finances();
create trigger archived_collection_payments before insert or update or delete on public.payments
for each row execute function public.guard_archived_collection_finances();

create function public.guard_archived_collection_edit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'archived' and
    (to_jsonb(old) - array['status','updated_at']) is distinct from
    (to_jsonb(new) - array['status','updated_at']) then
    raise exception 'Restore the collection before editing its details.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger archived_collection_details before update on public.collections
for each row execute function public.guard_archived_collection_edit();

commit;
