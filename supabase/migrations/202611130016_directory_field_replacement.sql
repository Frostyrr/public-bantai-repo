begin;

create or replace function public.audit_directory_field_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(organization_id, actor_id, action, entity_id, before_value, after_value)
  values (coalesce(new.organization_id, old.organization_id), auth.uid(),
    'directory_field_definitions.' || lower(tg_op), coalesce(new.organization_id, old.organization_id),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end;
$$;

drop trigger directory_field_audit on public.directory_field_definitions;
create trigger directory_field_audit
  after insert or update or delete on public.directory_field_definitions
  for each row execute function public.audit_directory_field_change();

create function public.change_directory_field_set(
  target_org uuid, expected_fields jsonb, replacement jsonb, remove_key text
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
    if jsonb_typeof(replacement) <> 'array' or jsonb_array_length(replacement) not between 1 and 10 then
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
revoke all on function public.change_directory_field_set(uuid,jsonb,jsonb,text) from public, anon;
grant execute on function public.change_directory_field_set(uuid,jsonb,jsonb,text) to authenticated;

commit;
