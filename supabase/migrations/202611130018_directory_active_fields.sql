begin;
alter table public.directory_field_definitions add column active boolean not null default true;

create or replace function public.change_directory_field_set(
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
  select coalesce(jsonb_agg(to_jsonb(d) - 'organization_id' - 'active' order by d.key), '[]') into current_fields
    from public.directory_field_definitions d where d.organization_id = target_org and d.active;
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

  update public.directory_field_definitions set active = false
    where organization_id = target_org and key = any(removed_keys);

  if replacement is not null then
    insert into public.directory_field_definitions (organization_id, key, label, kind, options)
      select target_org, r.key, r.label, r.kind, r.options
      from jsonb_to_recordset(replacement) as r(key text, label text, kind text, options text[])
      on conflict (organization_id, key) do update set label = excluded.label, active = true
      where directory_field_definitions.kind = excluded.kind
        and directory_field_definitions.options = excluded.options;
    if exists (
      select 1 from jsonb_to_recordset(replacement) as r(key text, kind text, options text[])
      join public.directory_field_definitions d on d.organization_id = target_org and d.key = r.key
      where d.kind <> r.kind or d.options <> r.options
    ) then
      raise exception 'A retained field uses a different type or choices. Use a new field key.' using errcode = '23514';
    end if;
  end if;
end;
$$;
revoke all on function public.change_directory_field_set(uuid,jsonb,jsonb,text,boolean) from public, anon;
grant execute on function public.change_directory_field_set(uuid,jsonb,jsonb,text,boolean) to authenticated;

create or replace function public.validate_directory_attributes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  field record;
  kind text;
  is_active boolean;
  allowed_options text[];
  value_text text;
begin
  if jsonb_typeof(new.attributes) <> 'object' or pg_column_size(new.attributes) > 16384 then
    raise exception 'Custom attributes must be an object of at most 16 KB.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.attributes := coalesce((
      select jsonb_object_agg(e.key, e.value)
      from jsonb_each(old.attributes) e
      join public.directory_field_definitions d
        on d.organization_id = new.organization_id and d.key = e.key and not d.active
    ), '{}'::jsonb) || new.attributes;
  end if;
  for field in select * from jsonb_each(new.attributes) loop
    select d.kind, d.options, d.active into kind, allowed_options, is_active from public.directory_field_definitions d
      where d.organization_id = new.organization_id and d.key = field.key;
    if not coalesce(is_active, true) then
      if tg_op = 'INSERT' then
        raise exception 'This directory field is inactive.' using errcode = '23514';
      end if;
      if not (old.attributes ? field.key) or field.value is distinct from old.attributes->field.key then
        raise exception 'This directory field is inactive.' using errcode = '23514';
      end if;
      continue;
    end if;
    value_text := field.value #>> '{}';
    if kind is null or not coalesce(case kind
      when 'text' then jsonb_typeof(field.value) = 'string' and char_length(value_text) <= 500
      when 'number' then jsonb_typeof(field.value) = 'number'
      when 'checkbox' then jsonb_typeof(field.value) = 'boolean'
      when 'select' then jsonb_typeof(field.value) = 'string' and value_text = any(allowed_options)
      when 'date' then jsonb_typeof(field.value) = 'string' and value_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      else false end, false) then
      raise exception 'Invalid custom attribute.' using errcode = '23514';
    end if;
    if kind = 'date' then
      perform value_text::date;
    end if;
  end loop;
  return new;
end;
$$;

commit;
