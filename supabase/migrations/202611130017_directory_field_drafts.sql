begin;

drop function public.change_directory_field_set(uuid,jsonb,jsonb,text);

create function public.change_directory_field_set(
  target_org uuid, expected_fields jsonb, replacement jsonb, remove_key text, confirm_value_loss boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_fields jsonb;
  removed_keys text[];
begin
  if not public.has_directory_capability(target_org, 'edit') then
    raise exception 'You cannot change directory fields.' using errcode = '42501';
  end if;
  if (replacement is null) = (remove_key is null) then
    raise exception 'Choose a replacement or a field to remove.' using errcode = '23514';
  end if;

  lock table public.organization_directory_members in share row exclusive mode;
  lock table public.directory_field_definitions in share row exclusive mode;
  select coalesce(jsonb_agg(to_jsonb(d) - 'organization_id' order by d.key), '[]') into current_fields
    from public.directory_field_definitions d where d.organization_id = target_org;
  if current_fields is distinct from (
    select coalesce(jsonb_agg(item order by item->>'key'), '[]') from jsonb_array_elements(expected_fields) item
  ) then
    raise exception 'The field list changed. Review the latest fields and try again.' using errcode = '40001';
  end if;

  if replacement is not null then
    if jsonb_typeof(replacement) <> 'array' or jsonb_array_length(replacement) > 500 then
      raise exception 'Choose a valid template.' using errcode = '23514';
    end if;
    select coalesce(array_agg(d.key), '{}') into removed_keys
    from public.directory_field_definitions d
    where d.organization_id = target_org and not exists (
      select 1 from jsonb_to_recordset(replacement) as r(key text, kind text, options text[])
      where r.key = d.key and r.kind = d.kind and r.options = d.options
    );
  else
    if not exists (select 1 from public.directory_field_definitions where organization_id = target_org and key = remove_key) then
      raise exception 'Directory field not found.' using errcode = 'P0002';
    end if;
    removed_keys := array[remove_key];
  end if;

  if not coalesce(confirm_value_loss, false) and exists (
    select 1 from public.organization_directory_members
    where organization_id = target_org and attributes ?| removed_keys
  ) then
    raise exception 'Confirm deletion of saved member values.' using errcode = 'P0001';
  end if;

  update public.organization_directory_members set attributes = attributes - removed_keys
    where organization_id = target_org and attributes ?| removed_keys;
  delete from public.directory_field_definitions where organization_id = target_org and key = any(removed_keys);

  if replacement is not null then
    insert into public.directory_field_definitions (organization_id, key, label, kind, options)
      select target_org, r.key, r.label, r.kind, r.options
      from jsonb_to_recordset(replacement) as r(key text, label text, kind text, options text[])
      on conflict (organization_id, key) do update set label = excluded.label
      where directory_field_definitions.label is distinct from excluded.label;
  end if;
end;
$$;
revoke all on function public.change_directory_field_set(uuid,jsonb,jsonb,text,boolean) from public, anon;
grant execute on function public.change_directory_field_set(uuid,jsonb,jsonb,text,boolean) to authenticated;

commit;
