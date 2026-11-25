begin;

alter table public.spaces add column if not exists updated_at timestamptz not null default now();

-- 1. Add avatar_url to public.profiles
alter table public.profiles
  add column if not exists avatar_url text;

-- 2. Allow authenticated users to update their own profile (display_name, avatar_url)
grant update (display_name, avatar_url) on public.profiles to authenticated;

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 4. User preferences table
create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'system')),
  reduced_motion boolean not null default false,
  default_organization_id uuid references public.organizations(id) on delete set null,
  notifications jsonb not null default '{
    "email_approvals": true,
    "email_payments": true,
    "email_invites": true,
    "in_app_approvals": true,
    "in_app_payments": true,
    "in_app_invites": true
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;

drop policy if exists user_preferences_self_read on public.user_preferences;
create policy user_preferences_self_read on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_preferences_self_insert on public.user_preferences;
create policy user_preferences_self_insert on public.user_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_preferences_self_update on public.user_preferences;
create policy user_preferences_self_update on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_preferences_self_delete on public.user_preferences;
create policy user_preferences_self_delete on public.user_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
commit;
