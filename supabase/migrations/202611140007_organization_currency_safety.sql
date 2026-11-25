begin;
-- No existing currency/amounts are backfilled, converted, or relabeled.
create function public.guard_organization_currency()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='UPDATE' then
   if new.currency is not distinct from old.currency then return new; end if;
 end if;
 if new.currency not in ('PHP','USD','EUR','GBP','JPY','CAD','AUD','SGD') then
   raise exception 'Choose a supported currency.' using errcode='23514';
 end if;
 if tg_op='UPDATE' then
   if exists(select 1 from public.collections where organization_id=old.id)
    or exists(select 1 from public.budgets where organization_id=old.id)
    or exists(select 1 from public.expenses where organization_id=old.id)
    or exists(select 1 from public.cash_advances where organization_id=old.id) then
     raise exception 'Currency cannot change after financial records exist. Historical amounts are never converted.' using errcode='23514';
   end if;
 end if;
 return new;
end;
$$;
revoke all on function public.guard_organization_currency() from public,anon,authenticated;
create trigger organization_currency_safety before insert or update of currency on public.organizations
 for each row execute function public.guard_organization_currency();

-- Serialize financial currency snapshots against a concurrent organization-currency edit.
-- Reject stale-currency writes rather than silently relabeling the submitted amount.
create function public.guard_financial_currency_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_currency text;
begin
 select currency::text into current_currency from public.organizations where id=new.organization_id for share;
 if not found or new.currency::text is distinct from current_currency then
   raise exception 'The organization currency changed. Refresh and review the financial amount before submitting.' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function public.guard_financial_currency_snapshot() from public,anon,authenticated;
create trigger collection_currency_snapshot before insert or update of organization_id,currency on public.collections
 for each row execute function public.guard_financial_currency_snapshot();
create trigger budget_currency_snapshot before insert or update of organization_id,currency on public.budgets
 for each row execute function public.guard_financial_currency_snapshot();
create trigger expense_currency_snapshot before insert or update of organization_id,currency on public.expenses
 for each row execute function public.guard_financial_currency_snapshot();
create trigger advance_currency_snapshot before insert or update of organization_id,currency on public.cash_advances
 for each row execute function public.guard_financial_currency_snapshot();
commit;
