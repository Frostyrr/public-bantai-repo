begin;

create function public.validate_expense_budget_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare linked public.budgets;
begin
  if new.budget_id is null then return new; end if;
  if tg_op = 'UPDATE' and row(new.budget_id, new.organization_id, new.space_id, new.reporting_period_id)
    is not distinct from row(old.budget_id, old.organization_id, old.space_id, old.reporting_period_id)
  then return new; end if;

  select * into linked from public.budgets
  where id = new.budget_id and organization_id = new.organization_id for share;

  if not found or linked.status <> 'active' or linked.archived_at is not null
    or (linked.space_id is not null and new.space_id is not null and linked.space_id <> new.space_id)
    or (linked.reporting_period_id is not null and new.reporting_period_id is not null
      and linked.reporting_period_id <> new.reporting_period_id)
  then
    raise exception 'Choose an active budget in this organization that matches the expense space and reporting period.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger validate_expense_budget_assignment
before insert or update of budget_id, organization_id, space_id, reporting_period_id on public.expenses
for each row execute function public.validate_expense_budget_assignment();

commit;
