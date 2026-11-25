-- Apply once through Supabase SQL Editor or the Supabase CLI.
-- Identity-only foundation. Financial tables will use separately reviewed migrations.
begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 150),
  created_at timestamptz not null default now()
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('organization_admin','treasurer','auditor','student')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);
create index organization_members_profile_status on public.organization_members(profile_id, status);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  database_actor text not null default session_user,
  action text not null,
  entity_id uuid not null,
  before_value jsonb,
  after_value jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_logs_organization_time on public.audit_logs(organization_id, occurred_at, id);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.profiles, public.organizations, public.organization_members, public.audit_logs from anon, authenticated;
grant select on public.profiles, public.organizations, public.organization_members to authenticated;

create policy profiles_self_read on public.profiles for select to authenticated using (id = (select auth.uid()));
-- Self-only membership reads avoid recursive membership policies.
create policy memberships_self_read on public.organization_members for select to authenticated
  using (profile_id = (select auth.uid()) and status = 'active');
create policy organizations_member_read on public.organizations for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = organizations.id
      and m.profile_id = (select auth.uid()) and m.status = 'active'
  ));

create function public.create_profile_for_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;
create trigger auth_user_profile after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;

create function public.audit_membership_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(organization_id, actor_id, action, entity_id, before_value, after_value)
  values (
    case when TG_OP = 'DELETE' then old.organization_id else new.organization_id end,
    auth.uid(), 'membership.' || lower(TG_OP),
    case when TG_OP = 'DELETE' then old.id else new.id end,
    case when TG_OP <> 'INSERT' then to_jsonb(old) else null end,
    case when TG_OP <> 'DELETE' then to_jsonb(new) else null end
  );
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_membership_change() from public, anon, authenticated;
create trigger membership_audit after insert or update or delete on public.organization_members
  for each row execute function public.audit_membership_change();
-- No application write policies yet: organization/role provisioning is dashboard-only.
-- No client audit-log privileges. A later administrative API must preserve this boundary.
commit;
