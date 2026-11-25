begin;
alter table public.directory_field_definitions drop constraint directory_field_definitions_kind_check;
alter table public.directory_field_definitions add column options text[] not null default '{}';
alter table public.directory_field_definitions add check (
  (kind in ('text','number','date','checkbox') and cardinality(options) = 0)
  or (kind = 'select' and cardinality(options) between 1 and 30)
);

create index directory_attributes_filter on public.organization_directory_members using gin(attributes jsonb_path_ops);

create table public.directory_groups (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  primary key (organization_id, id)
);
create unique index directory_group_name on public.directory_groups(organization_id, lower(btrim(name)));
create table public.directory_group_members (
  organization_id uuid not null,
  group_id uuid not null,
  member_id uuid not null,
  primary key (organization_id, group_id, member_id),
  foreign key (organization_id, group_id) references public.directory_groups(organization_id, id) on delete cascade,
  foreign key (organization_id, member_id) references public.organization_directory_members(organization_id, id) on delete restrict
);
create index directory_member_groups on public.directory_group_members(organization_id, member_id);
alter table public.directory_groups enable row level security;
alter table public.directory_group_members enable row level security;
revoke all on public.directory_groups, public.directory_group_members from public, anon, authenticated;
grant select, insert on public.directory_groups, public.directory_group_members to authenticated;
grant delete on public.directory_group_members to authenticated;
create policy group_read on public.directory_groups for select to authenticated
  using (public.has_directory_capability(organization_id, 'view'));
create policy group_create on public.directory_groups for insert to authenticated
  with check (public.has_directory_capability(organization_id, 'edit'));
create policy group_member_read on public.directory_group_members for select to authenticated
  using (public.has_directory_capability(organization_id, 'view'));
create policy group_member_add on public.directory_group_members for insert to authenticated
  with check (public.has_directory_capability(organization_id, 'edit'));
create policy group_member_remove on public.directory_group_members for delete to authenticated
  using (public.has_directory_capability(organization_id, 'edit'));
create or replace function public.validate_directory_attributes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  field record;
  kind text;
  allowed_options text[];
  value_text text;
begin
  if jsonb_typeof(new.attributes) <> 'object' or pg_column_size(new.attributes) > 16384 then
    raise exception 'Custom attributes must be an object of at most 16 KB.' using errcode = '23514';
  end if;
  for field in select * from jsonb_each(new.attributes) loop
    select d.kind, d.options into kind, allowed_options from public.directory_field_definitions d
      where d.organization_id = new.organization_id and d.key = field.key;
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
