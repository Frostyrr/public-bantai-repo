begin;

alter table public.organization_members
  drop constraint if exists organization_members_status_check,
  add constraint organization_members_status_check
    check (status in ('active', 'suspended', 'left'));

commit;
