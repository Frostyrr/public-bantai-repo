begin;

create table public.organization_directory_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 150),
  member_code text check (char_length(btrim(member_code)) between 1 and 100),
  email text check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 40),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index directory_org_member_code
  on public.organization_directory_members (organization_id, lower(btrim(member_code)))
  where member_code is not null;
create index directory_org_status_name
  on public.organization_directory_members (organization_id, status, display_name, id);

alter table public.organization_directory_members enable row level security;
revoke all on public.organization_directory_members from public, anon, authenticated;
grant select on public.organization_directory_members to authenticated;
grant insert (organization_id, display_name, member_code, email, phone),
  update (display_name, member_code, email, phone, status)
  on public.organization_directory_members to authenticated;

create table public.directory_capability_grants (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid not null,
  capability text not null check (capability in ('edit', 'import', 'export', 'financial_view')),
  primary key (organization_id, profile_id, capability),
  foreign key (organization_id, profile_id) references public.organization_members(organization_id, profile_id) on delete cascade
);
alter table public.directory_capability_grants enable row level security;
revoke all on public.directory_capability_grants from public, anon, authenticated;

create function public.has_directory_capability(target_org uuid, capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    left join public.directory_capability_grants g
      on g.organization_id = m.organization_id and g.profile_id = m.profile_id and g.capability = $2
    where m.organization_id = target_org and m.profile_id = (select auth.uid()) and m.status = 'active'
      and case $2
        when 'view' then m.role in ('owner', 'organization_admin', 'treasurer')
        when 'edit' then m.role in ('owner', 'organization_admin') or (m.role = 'treasurer' and g.capability is not null)
        when 'import' then m.role in ('owner', 'organization_admin') or (m.role = 'treasurer' and g.capability is not null)
        when 'export' then m.role = 'owner' or (m.role in ('organization_admin', 'treasurer') and g.capability is not null)
        when 'financial_view' then m.role in ('owner', 'organization_admin', 'treasurer') or (m.role = 'auditor' and g.capability is not null)
        when 'record_payment' then m.role in ('owner', 'organization_admin', 'treasurer')
        else false
      end
  );
$$;
revoke all on function public.has_directory_capability(uuid, text) from public, anon;
grant execute on function public.has_directory_capability(uuid, text) to authenticated;

create policy directory_read on public.organization_directory_members for select to authenticated
  using (public.has_directory_capability(organization_id, 'view'));
create policy directory_create on public.organization_directory_members for insert to authenticated
  with check (public.has_directory_capability(organization_id, 'edit'));
create policy directory_edit on public.organization_directory_members for update to authenticated
  using (public.has_directory_capability(organization_id, 'edit'))
  with check (public.has_directory_capability(organization_id, 'edit'));

create function public.audit_directory_member_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  insert into public.audit_logs (organization_id, actor_id, action, entity_id, after_value)
  values (
    new.organization_id, auth.uid(), 'directory_member_' || lower(tg_op), new.id,
    jsonb_build_object('status', new.status)
  );
  return new;
end;
$$;
revoke all on function public.audit_directory_member_change() from public, anon, authenticated;
create trigger directory_member_audit before insert or update on public.organization_directory_members
  for each row execute function public.audit_directory_member_change();

commit;
