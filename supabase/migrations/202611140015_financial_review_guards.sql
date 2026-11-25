begin;

alter function public.review_expense(uuid, uuid, text, text) rename to review_expense_internal;
revoke execute on function public.review_expense_internal(uuid, uuid, text, text) from public, anon, authenticated;

create function public.review_expense(p_org_id uuid, p_expense_id uuid, p_decision text, p_notes text, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actual_revision integer;
begin
  if not exists (select 1 from public.organization_members where organization_id = p_org_id
    and profile_id = auth.uid() and status = 'active') then
    raise exception 'Organization access is required.' using errcode = '42501';
  end if;
  select review_revision into actual_revision from public.expenses
    where id = p_expense_id and organization_id = p_org_id for update;
  if not found then
    raise exception 'Expense not found.' using errcode = 'P0002';
  end if;
  if actual_revision is distinct from p_expected_revision then
    raise exception 'This expense was revised. Refresh and review the latest version.' using errcode = '40001';
  end if;
  return public.review_expense_internal(p_org_id, p_expense_id, p_decision, p_notes);
end;
$$;
revoke execute on function public.review_expense(uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.review_expense(uuid, uuid, text, text, integer) to authenticated;

create function public.protect_released_advance()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Released cash advances must be retained.' using errcode = '23514';
  end if;
  if (new.amount_released_centavos, new.accountable_person_id, new.released_at, new.released_by,
      new.disbursement_method, new.reference_number, new.budget_id, new.space_id, new.reporting_period_id)
     is distinct from
     (old.amount_released_centavos, old.accountable_person_id, old.released_at, old.released_by,
      old.disbursement_method, old.reference_number, old.budget_id, old.space_id, old.reporting_period_id) then
    raise exception 'Released cash advance financial details are locked.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger protect_released_advance before update or delete on public.cash_advances
for each row execute function public.protect_released_advance();

commit;
