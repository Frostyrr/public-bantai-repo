begin;

alter table public.directory_import_batches add column import_fields_hash text;

create function public.commit_directory_import_with_fields(
  target_org uuid, request_key uuid, roster jsonb, proposed_fields jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  prior public.directory_import_batches%rowtype;
  result jsonb;
  fields_hash text := md5(proposed_fields::text);
begin
  if not public.has_directory_capability(target_org, 'import')
     or not public.has_directory_capability(target_org, 'edit') then
    raise exception 'Directory import and field editing are required.' using errcode = '42501';
  end if;
  if jsonb_typeof(proposed_fields) is distinct from 'array' then
    raise exception 'Provide proposed directory fields.' using errcode = '23514';
  end if;
  if jsonb_array_length(proposed_fields) not between 1 and 10 then
    raise exception 'Create between one and ten fields per import.' using errcode = '23514';
  end if;

  -- Use the same lock order as directory schema updates and roster commits.
  lock table public.organization_directory_members in share row exclusive mode;
  lock table public.directory_field_definitions in share row exclusive mode;
  select * into prior from public.directory_import_batches
    where organization_id = target_org and request_id = request_key;
  if found then
    if prior.import_fields_hash is distinct from fields_hash then
      raise exception 'This request ID belongs to a different import.' using errcode = '23505';
    end if;
    return public.commit_directory_import(target_org, request_key, roster);
  end if;

  if exists (
    select 1 from jsonb_to_recordset(proposed_fields) as f(key text, label text, kind text)
    where f.key is null or f.key !~ '^[a-z][a-z0-9_]{0,39}$'
      or f.label is null or length(btrim(f.label)) not between 1 and 80
      or f.kind is null or f.kind not in ('text', 'number', 'date', 'checkbox')
  ) then
    raise exception 'Invalid proposed directory fields.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(proposed_fields) as f(key text, label text)
    join public.directory_field_definitions d on d.organization_id = target_org
      and (d.key = f.key or (d.active and lower(btrim(d.label)) = lower(btrim(f.label))))
  ) or exists (
    select 1 from jsonb_to_recordset(proposed_fields) as f(label text)
    group by lower(btrim(f.label)) having count(*) > 1
  ) then
    raise exception 'A proposed field conflicts with a directory field.' using errcode = '23505';
  end if;

  insert into public.directory_field_definitions (organization_id, key, label, kind)
    select target_org, f.key, btrim(f.label), f.kind
    from jsonb_to_recordset(proposed_fields) as f(key text, label text, kind text);
  result := public.commit_directory_import(target_org, request_key, roster);
  if (result->>'inserted')::integer = 0 then
    raise exception 'The reviewed rows are already in the directory.' using errcode = '23505';
  end if;
  update public.directory_import_batches set import_fields_hash = fields_hash
    where organization_id = target_org and request_id = request_key;
  return result;
end;
$$;

revoke all on function public.commit_directory_import_with_fields(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.commit_directory_import_with_fields(uuid, uuid, jsonb, jsonb) to authenticated;

commit;
