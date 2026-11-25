-- Migration: 202611180010_org_onboarding_progress.sql
-- Description: Per-user, per-organization onboarding checklist & coachmark tour progress.

begin;

create table if not exists public.organization_onboarding_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  checklist_dismissed boolean not null default false,
  checklist_completed_at timestamptz,
  reviewed_org_details_at timestamptz,
  tours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create index if not exists idx_org_onboarding_progress_org
  on public.organization_onboarding_progress (organization_id);

alter table public.organization_onboarding_progress enable row level security;

revoke all on public.organization_onboarding_progress from anon, authenticated;
grant select, insert, update on public.organization_onboarding_progress to authenticated;

drop policy if exists org_onboarding_progress_self_read on public.organization_onboarding_progress;
create policy org_onboarding_progress_self_read
  on public.organization_onboarding_progress
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = organization_onboarding_progress.organization_id
        and m.profile_id = (select auth.uid())
        and m.status = 'active'
    )
  );

drop policy if exists org_onboarding_progress_self_insert on public.organization_onboarding_progress;
create policy org_onboarding_progress_self_insert
  on public.organization_onboarding_progress
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = organization_onboarding_progress.organization_id
        and m.profile_id = (select auth.uid())
        and m.status = 'active'
    )
  );

drop policy if exists org_onboarding_progress_self_update on public.organization_onboarding_progress;
create policy org_onboarding_progress_self_update
  on public.organization_onboarding_progress
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = organization_onboarding_progress.organization_id
        and m.profile_id = (select auth.uid())
        and m.status = 'active'
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = organization_onboarding_progress.organization_id
        and m.profile_id = (select auth.uid())
        and m.status = 'active'
    )
  );

notify pgrst, 'reload schema';

commit;
