begin;

create trigger suspended_organization_guard before insert on public.liquidation_reconciliations
  for each row execute function public.guard_suspended_organization();
create trigger suspended_organization_guard before insert on public.liquidation_resolution_entries
  for each row execute function public.guard_suspended_organization();

commit;
