begin;

alter table public.budgets add column archived_by uuid references public.profiles(id);
alter table public.expenses add column archived_by uuid references public.profiles(id);

create function public.capture_financial_archive_actor() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.archived_by := case when new.archived_at is null then null else auth.uid() end;
  return new;
end;
$$;

-- Run after the existing read-only guard so restore can clear the actor.
create trigger zz_capture_financial_archive_actor before update of archived_at on public.budgets
for each row when (old.archived_at is distinct from new.archived_at)
execute function public.capture_financial_archive_actor();
create trigger zz_capture_financial_archive_actor before update of archived_at on public.expenses
for each row when (old.archived_at is distinct from new.archived_at)
execute function public.capture_financial_archive_actor();

create function public.require_active_archive_parent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.space_id is not null then
    perform 1 from public.spaces
    where id = old.space_id and organization_id = old.organization_id and status = 'active'
    for share;
    if not found then
      raise exception 'Restore the parent Space first.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger require_active_archive_parent before update of status on public.collections
for each row when (old.status = 'archived' and new.status <> 'archived')
execute function public.require_active_archive_parent();
create trigger require_active_archive_parent before update of archived_at on public.budgets
for each row when (old.archived_at is not null and new.archived_at is null)
execute function public.require_active_archive_parent();
create trigger require_active_archive_parent before update of archived_at on public.expenses
for each row when (old.archived_at is not null and new.archived_at is null)
execute function public.require_active_archive_parent();

commit;
