begin;

create table public.directory_field_definitions (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  kind text not null check (kind in ('text', 'number', 'date', 'checkbox')),
  primary key (organization_id, key)
);
alter table public.directory_field_definitions enable row level security;
revoke all on public.directory_field_definitions from public, anon, authenticated;
grant select, insert on public.directory_field_definitions to authenticated;
grant update (label) on public.directory_field_definitions to authenticated;
create policy field_read on public.directory_field_definitions for select to authenticated
  using (public.has_directory_capability(organization_id, 'view'));
create policy field_create on public.directory_field_definitions for insert to authenticated
  with check (public.has_directory_capability(organization_id, 'edit'));
create policy field_rename on public.directory_field_definitions for update to authenticated
  using (public.has_directory_capability(organization_id, 'edit'))
  with check (public.has_directory_capability(organization_id, 'edit'));

alter table public.organization_directory_members
  add column attributes jsonb not null default '{}'::jsonb;
grant insert (attributes), update (attributes) on public.organization_directory_members to authenticated;

create function public.validate_directory_attributes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  field record;
  kind text;
  value_text text;
begin
  if jsonb_typeof(new.attributes) <> 'object' or pg_column_size(new.attributes) > 16384 then
    raise exception 'Custom attributes must be an object of at most 16 KB.' using errcode = '23514';
  end if;
  for field in select * from jsonb_each(new.attributes) loop
    select d.kind into kind from public.directory_field_definitions d
      where d.organization_id = new.organization_id and d.key = field.key;
    value_text := field.value #>> '{}';
    if kind is null or not coalesce(case kind
      when 'text' then jsonb_typeof(field.value) = 'string' and char_length(value_text) <= 500
      when 'number' then jsonb_typeof(field.value) = 'number'
      when 'checkbox' then jsonb_typeof(field.value) = 'boolean'
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
revoke all on function public.validate_directory_attributes() from public, anon, authenticated;
create trigger directory_attributes_validate
  before insert or update of attributes on public.organization_directory_members
  for each row execute function public.validate_directory_attributes();

commit;
