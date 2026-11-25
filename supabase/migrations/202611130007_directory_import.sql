begin;
create table public.directory_import_batches (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  inserted_count integer not null,
  skipped_count integer not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, request_id)
);
alter table public.directory_import_batches enable row level security;
revoke all on public.directory_import_batches from public, anon, authenticated;

create function public.commit_directory_import(target_org uuid, request_key uuid, roster jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  batch public.directory_import_batches%rowtype;
  inserted integer;
begin
  if not public.has_directory_capability(target_org, 'import') then
    raise exception 'Directory import is not permitted.' using errcode = '42501';
  end if;
  if jsonb_typeof(roster) is distinct from 'array' then
    raise exception 'Provide a directory roster.' using errcode = '23514';
  end if;
  if jsonb_array_length(roster) not between 1 and 500 or octet_length(roster::text) > 500000 then
    raise exception 'The roster must contain between 1 and 500 rows and fit within 500 KB.' using errcode = '23514';
  end if;
  insert into public.directory_import_batches values (target_org, request_key, auth.uid(), 0, 0)
    on conflict do nothing returning * into batch;
  if not found then
    select * into batch from public.directory_import_batches
      where organization_id = target_org and request_id = request_key and actor_id = auth.uid();
    if not found then
      raise exception 'Import request is unavailable.' using errcode = '42501';
    end if;
    return jsonb_build_object('inserted', batch.inserted_count, 'skipped', batch.skipped_count);
  end if;
  insert into public.organization_directory_members (organization_id, display_name, member_code, email, phone, attributes)
    select target_org, btrim(r.display_name), nullif(btrim(r.member_code), ''), nullif(btrim(r.email), ''),
      nullif(btrim(r.phone), ''), coalesce(r.attributes, '{}'::jsonb)
    from jsonb_to_recordset(roster) as r(display_name text, member_code text, email text, phone text, attributes jsonb)
    on conflict do nothing;
  get diagnostics inserted = row_count;
  update public.directory_import_batches set inserted_count = inserted, skipped_count = jsonb_array_length(roster) - inserted
    where organization_id = target_org and request_id = request_key
    returning * into batch;
  return jsonb_build_object('inserted', batch.inserted_count, 'skipped', batch.skipped_count);
end;
$$;
revoke all on function public.commit_directory_import(uuid, uuid, jsonb) from public, anon;
grant execute on function public.commit_directory_import(uuid, uuid, jsonb) to authenticated;
commit;
