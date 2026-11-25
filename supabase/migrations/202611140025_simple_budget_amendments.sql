begin;
create or replace function public.manage_budget_amendment(org uuid, budget uuid, expected bigint,
  proposed bigint, explanation text, amendment uuid, decision text)
returns public.budget_amendments language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  current_budget public.budgets;
  change public.budget_amendments;
  committed numeric;
  current_preset text;
begin
  select role into actor_role from public.organization_members where organization_id = org
    and profile_id = actor and status = 'active';
  if actor_role is null or actor_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'You cannot manage budget amendments.' using errcode = '42501';
  end if;
  select * into current_budget from public.budgets where id = budget and organization_id = org for update;
  if not found then raise exception 'Budget not found.' using errcode = 'P0002'; end if;
  if amendment is null then
    if current_budget.status <> 'active' or expected is distinct from current_budget.allocated_amount_centavos
      or proposed is null or proposed < 0 or proposed = expected then
      raise exception 'Review the current allocation and enter a different proposed amount.' using errcode = '23514';
    end if;
    select approval_preset into current_preset from public.organizations where id=org for share;
    if current_preset = 'simple' and not exists (
      select 1 from public.budget_amendments where budget_id=budget and status='pending'
    ) then
      select coalesce(sum(amount_centavos),0) into committed from public.expenses
        where budget_id=budget and status in ('pending','verified','approved');
      committed := committed + (select coalesce(sum(amount_released_centavos),0) from public.cash_advances where budget_id=budget);
      if proposed < committed then
        raise exception 'The proposed allocation is below existing commitments.' using errcode='23514';
      end if;
      insert into public.budget_amendments(budget_id,organization_id,previous_centavos,proposed_centavos,reason,proposed_by,status)
      values(budget,org,expected,proposed,trim(explanation),actor,'approved') returning * into change;
      update public.budgets set allocated_amount_centavos=proposed,updated_at=now() where id=budget;
      return change;
    end if;
    insert into public.budget_amendments(budget_id, organization_id, previous_centavos, proposed_centavos, reason, proposed_by)
    values(budget, org, expected, proposed, trim(explanation), actor) returning * into change;
    return change;
  end if;
  if actor_role not in ('owner','organization_admin') then
    raise exception 'An owner or admin must decide the amendment.' using errcode = '42501';
  end if;
  select * into change from public.budget_amendments where id = amendment and budget_id = budget and organization_id = org;
  if not found or change.status <> 'pending' or decision is null or decision not in ('approved','rejected') then
    raise exception 'This amendment is no longer pending.' using errcode = '23514';
  end if;
  if change.proposed_by = actor then
    raise exception 'A different owner or admin must decide this amendment.' using errcode = '42501';
  end if;
  if decision = 'approved' then
    if current_budget.status <> 'active' or current_budget.allocated_amount_centavos <> change.previous_centavos then
      raise exception 'The budget changed. Review a new amendment.' using errcode = '23514';
    end if;
    select coalesce(sum(amount_centavos),0) into committed from public.expenses
      where budget_id = budget and status in ('pending','verified','approved');
    committed := committed + (select coalesce(sum(amount_released_centavos),0) from public.cash_advances where budget_id = budget);
    if change.proposed_centavos < committed then
      raise exception 'The proposed allocation is below existing commitments.' using errcode = '23514';
    end if;
  end if;
  update public.budget_amendments set status = decision, decided_at = now(), decided_by = actor
    where id = amendment returning * into change;
  if decision = 'approved' then
    update public.budgets set allocated_amount_centavos = change.proposed_centavos, updated_at = now() where id = budget;
  end if;
  return change;
end;
$$;
commit;
