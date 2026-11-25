begin;

create table public.liquidation_reconciliations (
  liquidation_id uuid primary key references public.liquidations(id),
  organization_id uuid not null references public.organizations(id),
  actor uuid not null default auth.uid(),
  confirmed_at timestamptz not null default now(),
  reason text not null,
  payload jsonb not null
);

create table public.liquidation_expense_allocations (
  liquidation_id uuid not null references public.liquidation_reconciliations(liquidation_id),
  expense_id uuid not null references public.expenses(id),
  organization_id uuid not null references public.organizations(id),
  amount_centavos bigint not null check (amount_centavos > 0),
  attributed_budget_id uuid references public.budgets(id),
  primary key (liquidation_id, expense_id)
);

create table public.liquidation_resolution_entries (
  id uuid primary key,
  liquidation_id uuid not null references public.liquidations(id),
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('recovery','write_off','excess_return')),
  amount_centavos bigint not null check (amount_centavos <> 0),
  reverses uuid unique references public.liquidation_resolution_entries(id),
  actor uuid not null default auth.uid(),
  recorded_at timestamptz not null default now(),
  reason text not null
);

do $$
declare relation text;
begin
  foreach relation in array array['liquidation_reconciliations','liquidation_expense_allocations','liquidation_resolution_entries'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
    execute format('create policy organization_read on public.%I for select to authenticated using (public.is_active_org_member(organization_id, auth.uid()))', relation);
  end loop;
end $$;

create function public.lock_advance_budget_accounting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'cash_advances' then
    if new.budget_id is not null then
      perform 1 from public.budgets where id=new.budget_id and organization_id=new.organization_id for update;
    end if;
  else
    if tg_op <> 'INSERT' and old.status='approved' then
      raise exception 'Approved liquidation records must be retained.' using errcode='23514';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if new.status='approved' then
      perform 1 from public.budgets b join public.cash_advances a
        on a.budget_id=b.id and a.organization_id=b.organization_id
        where a.id=new.cash_advance_id and a.organization_id=new.organization_id for update of b;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.lock_advance_budget_accounting() from public, anon, authenticated;
create trigger serialize_advance_release before insert on public.cash_advances
  for each row execute function public.lock_advance_budget_accounting();
create trigger preserve_approved_liquidations before update or delete on public.liquidations
  for each row execute function public.lock_advance_budget_accounting();

create function public.lock_liquidation_accounting(org uuid, settlement uuid)
returns public.liquidations language plpgsql security definer set search_path = '' as $$
declare record public.liquidations;
begin
  if not exists (select 1 from public.organization_members where organization_id=org
    and profile_id=auth.uid() and status='active' and role in ('owner','organization_admin')) then
    raise exception 'Owner or admin authorization required.' using errcode='42501';
  end if;
  select * into record from public.liquidations where id=settlement and organization_id=org for update;
  if not found or record.status <> 'approved' then
    raise exception 'An approved liquidation in this organization is required.' using errcode='23514';
  end if;
  perform 1 from public.organizations where id=org and closed_at is null for share;
  if not found then raise exception 'This organization is closed.' using errcode='23514'; end if;
  return record;
end $$;
revoke all on function public.lock_liquidation_accounting(uuid,uuid) from public, anon, authenticated;

create function public.confirm_liquidation_reconciliation(org uuid, settlement uuid, links jsonb, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  settlement_row public.liquidations;
  advance_row public.cash_advances;
  expense_row public.expenses;
  link record;
  allocated numeric := 0;
  prior public.liquidation_reconciliations;
begin
  settlement_row := public.lock_liquidation_accounting(org, settlement);
  if jsonb_typeof(links) is distinct from 'array' or coalesce(length(trim(reason)),0)<3 then
    raise exception 'Provide allocations and a confirmation reason.' using errcode='23514';
  end if;
  select * into prior from public.liquidation_reconciliations where liquidation_id=settlement;
  if found then
    if prior.payload=links and prior.reason=trim(reason) then return; end if;
    raise exception 'This liquidation already has a confirmed reconciliation.' using errcode='23514';
  end if;
  select * into strict advance_row from public.cash_advances where id=settlement_row.cash_advance_id and organization_id=org for update;
  insert into public.liquidation_reconciliations(liquidation_id,organization_id,reason,payload)
    values(settlement,org,trim(reason),links);
  for link in select * from jsonb_to_recordset(links) as l(expense_id uuid, amount_centavos bigint, attributed_budget_id uuid) order by expense_id loop
    select * into expense_row from public.expenses where id=link.expense_id and organization_id=org for update;
    if not found or expense_row.status <> 'approved' or expense_row.currency <> advance_row.currency
      or (expense_row.budget_id is not null and advance_row.budget_id is not null
        and expense_row.budget_id <> advance_row.budget_id)
      or (expense_row.budget_id is distinct from advance_row.budget_id
        and link.attributed_budget_id is distinct from coalesce(expense_row.budget_id, advance_row.budget_id))
      or (link.attributed_budget_id is not null
        and link.attributed_budget_id is distinct from coalesce(expense_row.budget_id, advance_row.budget_id))
      or expense_row.space_id is distinct from advance_row.space_id
      or expense_row.reporting_period_id is distinct from advance_row.reporting_period_id
      or coalesce(link.amount_centavos,0)<=0 then
      raise exception 'Choose an approved expense with matching budget, space, reporting period, and currency.' using errcode='23514';
    end if;
    perform 1 from public.budgets where id=coalesce(expense_row.budget_id,advance_row.budget_id)
      and organization_id=org for update;
    allocated := allocated + link.amount_centavos;
    if allocated > settlement_row.total_spent_centavos or
      link.amount_centavos + (select coalesce(sum(a.amount_centavos),0) from public.liquidation_expense_allocations a where a.expense_id=expense_row.id) > expense_row.amount_centavos then
      raise exception 'Allocation exceeds recorded spending.' using errcode='23514';
    end if;
    insert into public.liquidation_expense_allocations values(settlement,expense_row.id,org,link.amount_centavos,link.attributed_budget_id);
  end loop;
end $$;

create function public.record_liquidation_resolution(org uuid, settlement uuid, request_id uuid,
  entry_kind text, amount bigint, reason text, reversal uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.liquidations;
  a public.cash_advances;
  prior public.liquidation_resolution_entries;
  original public.liquidation_resolution_entries;
  available numeric;
begin
  l := public.lock_liquidation_accounting(org,settlement);
  select * into prior from public.liquidation_resolution_entries where id=request_id;
  if found then
    if prior.liquidation_id=settlement and prior.kind=entry_kind and prior.amount_centavos=amount
      and prior.reason=trim(reason) and prior.reverses is not distinct from reversal then return; end if;
    raise exception 'Request ID was already used.' using errcode='23514';
  end if;
  if request_id is null or coalesce(length(trim(reason)),0)<3 or amount is null
    or entry_kind is null or entry_kind not in ('recovery','write_off','excess_return') then
    raise exception 'A valid resolution and reason are required.' using errcode='23514';
  end if;
  if reversal is not null then
    select * into original from public.liquidation_resolution_entries where id=reversal and liquidation_id=settlement;
    if not found or original.reverses is not null or original.kind<>entry_kind or amount<>-original.amount_centavos then
      raise exception 'A compensating entry must fully reverse the original resolution.' using errcode='23514';
    end if;
  else
    select * into strict a from public.cash_advances where id=l.cash_advance_id and organization_id=org;
    if entry_kind='excess_return' then
      available := greatest(0,l.total_returned_centavos-a.amount_released_centavos) -
        (select coalesce(sum(amount_centavos),0) from public.liquidation_resolution_entries where liquidation_id=settlement and kind='excess_return');
    else
      available := greatest(0,l.outstanding_balance_centavos) -
        (select coalesce(sum(amount_centavos),0) from public.liquidation_resolution_entries where liquidation_id=settlement and kind in ('recovery','write_off'));
    end if;
    if amount<=0 or amount>available then
      raise exception 'Resolution exceeds the remaining amount.' using errcode='23514';
    end if;
  end if;
  perform 1 from public.budgets b join public.cash_advances advance
    on advance.budget_id=b.id and advance.organization_id=b.organization_id
    where advance.id=l.cash_advance_id and advance.organization_id=org for update of b;
  insert into public.liquidation_resolution_entries(id,liquidation_id,organization_id,kind,amount_centavos,reverses,reason)
    values(request_id,settlement,org,entry_kind,amount,reversal,trim(reason));
end $$;
revoke all on function public.confirm_liquidation_reconciliation(uuid,uuid,jsonb,text),
  public.record_liquidation_resolution(uuid,uuid,uuid,text,bigint,text,uuid) from public, anon;
grant execute on function public.confirm_liquidation_reconciliation(uuid,uuid,jsonb,text),
  public.record_liquidation_resolution(uuid,uuid,uuid,text,bigint,text,uuid) to authenticated;

create view public.advance_accounting with (security_invoker=true) as
select a.id, a.organization_id, a.budget_id, a.space_id, a.reporting_period_id,
  a.amount_released_centavos as released,
  coalesce(l.total_spent_centavos,0) as spent,
  least(coalesce(l.total_returned_centavos,0),a.amount_released_centavos) + r.cash as returned,
  case when a.status in ('outstanding','under_review','disputed') then a.amount_released_centavos else 0 end as unsettled,
  greatest(0,coalesce(l.outstanding_balance_centavos,0)) - r.resolved as discrepancy,
  r.loss,
  x.overlap, x.unallocated_overlap, x.attributed_from_unallocated,
  (l.id is not null and c.liquidation_id is null) or coalesce(l.total_returned_centavos > a.amount_released_centavos + r.excess,false) as provisional
from public.cash_advances a
left join public.liquidations l on l.cash_advance_id=a.id and l.organization_id=a.organization_id and l.status='approved'
left join public.liquidation_reconciliations c on c.liquidation_id=l.id
cross join lateral (
  select coalesce(sum(e.amount_centavos) filter (where kind in ('recovery','excess_return')),0) as cash,
    coalesce(sum(e.amount_centavos) filter (where kind in ('recovery','write_off')),0) as resolved,
    coalesce(sum(e.amount_centavos) filter (where kind='write_off'),0) as loss,
    coalesce(sum(e.amount_centavos) filter (where kind='excess_return'),0) as excess
  from public.liquidation_resolution_entries e where e.liquidation_id=l.id
) r
cross join lateral (
  select coalesce(sum(e.amount_centavos),0) as overlap,
    coalesce(sum(e.amount_centavos) filter (where expense.budget_id is null),0) as unallocated_overlap,
    coalesce(sum(e.amount_centavos) filter (where a.budget_id is null and e.attributed_budget_id is not null),0) as attributed_from_unallocated
  from public.liquidation_expense_allocations e
  join public.expenses expense on expense.id=e.expense_id and expense.organization_id=e.organization_id
  where e.liquidation_id=l.id
) x;
revoke all on public.advance_accounting from public, anon;
grant select on public.advance_accounting to authenticated;

create view public.budget_accounting with (security_invoker=true) as
select b.id, b.organization_id,
  coalesce(e.spent,0) + coalesce(a.spent,0) - x.deducted + x.attributed as spent,
  coalesce(a.committed,0) as committed, coalesce(a.provisional,false) as provisional
from public.budgets b
cross join lateral (
  select sum(amount_centavos) as spent from public.expenses
  where organization_id=b.organization_id and budget_id=b.id and status='approved'
) e
cross join lateral (
  select sum(spent+loss) as spent, sum(unsettled+discrepancy) as committed, bool_or(provisional) as provisional
  from public.advance_accounting where organization_id=b.organization_id and budget_id=b.id
) a
cross join lateral (
  select
    coalesce(sum(link.amount_centavos) filter (where expense.budget_id=b.id),0) as deducted,
    coalesce(sum(link.amount_centavos) filter (where advance.budget_id is null and link.attributed_budget_id=b.id),0) as attributed
  from public.liquidation_expense_allocations link
  join public.expenses expense on expense.id=link.expense_id and expense.organization_id=link.organization_id
  join public.liquidations settlement on settlement.id=link.liquidation_id and settlement.organization_id=link.organization_id
  join public.cash_advances advance on advance.id=settlement.cash_advance_id and advance.organization_id=link.organization_id
  where link.organization_id=b.organization_id and (expense.budget_id=b.id or link.attributed_budget_id=b.id)
) x;
revoke all on public.budget_accounting from public, anon;
grant select on public.budget_accounting to authenticated;

create or replace function public.review_expense_internal(
  p_org_id uuid,
  p_expense_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_expense public.expenses;
  v_allocated bigint;
  v_already_spent bigint;
  v_advances_committed bigint;
  v_self boolean;
  v_count integer;
  v_previous text;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if p_decision not in ('verified', 'approved', 'rejected') then
    raise exception 'Invalid review decision.';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id and organization_id = p_org_id for update;

  if not found then
    raise exception 'Expense record not found in this organization.';
  end if;

  if v_expense.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'Expense has already reached a terminal review status.';
  end if;

  v_previous := v_expense.status;
  v_self := v_expense.submitted_by = v_caller;
  if v_role is null or not (
    v_role in ('owner','organization_admin') or
    (v_role = 'treasurer' and v_expense.treasurer_approval_snapshot) or
    (v_role = 'auditor' and v_expense.approval_policy_snapshot = 'legacy')
  ) then raise exception 'Your role is not authorized under this expense approval policy.'; end if;
  if v_self and not (v_expense.approval_policy_snapshot = 'owner_admin_self' and v_role in ('owner','organization_admin') and p_decision = 'approved') then
    raise exception 'Another authorized officer must review your submission.';
  end if;
  if v_self and coalesce(length(trim(p_notes)),0) < 3 then raise exception 'Self-approval requires a justification (at least 3 characters).'; end if;
  if p_decision = 'verified' and v_expense.status <> 'pending' then raise exception 'Only pending expenses can be verified.'; end if;
  if p_decision = 'approved' and not v_self and (v_expense.status <> 'verified' or v_expense.verified_by is null or v_expense.verified_by = v_expense.submitted_by) then
    raise exception 'Independent verification is required before approval.';
  end if;
  if p_decision = 'approved' and exists(select 1 from public.approvals where entity_type='expense' and entity_id=p_expense_id and expense_revision=v_expense.review_revision and decision='approved' and officer_id=v_caller) then
    raise exception 'You have already approved this expense revision.';
  end if;
  select count(*) into v_count from public.approvals where entity_type='expense' and entity_id=p_expense_id and expense_revision=v_expense.review_revision and decision='approved';
  if p_decision = 'rejected' and coalesce(length(trim(p_notes)), 0) < 3 then
    raise exception 'Provide a reason for rejection (at least 3 characters).';
  end if;

  if p_decision = 'approved' and v_count + 1 >= v_expense.required_approvals and v_expense.budget_id is not null then
    select allocated_amount_centavos into v_allocated
    from public.budgets
    where id = v_expense.budget_id and organization_id = p_org_id for update;
    if not found then raise exception 'Budget is not available in this organization.'; end if;

    select spent, committed into strict v_already_spent, v_advances_committed
    from public.budget_accounting where id=v_expense.budget_id and organization_id=p_org_id;

    if (v_already_spent + v_advances_committed + v_expense.amount_centavos) > v_allocated then
      raise exception 'Approval rejected: Expense exceeds the remaining authorized budget allocation.';
    end if;
  end if;

  if p_decision = 'verified' then
    update public.expenses
    set
      status = 'verified',
      verified_by = v_caller,
      verified_at = now(),
      review_notes = coalesce(p_notes, review_notes),
      updated_at = now()
    where id = p_expense_id
    returning * into v_expense;
  elsif p_decision = 'approved' then
    update public.expenses
    set
      status = case when v_count + 1 >= required_approvals then 'approved' else 'verified' end,
      approved_by = case when v_count + 1 >= required_approvals then v_caller else null end,
      approved_at = case when v_count + 1 >= required_approvals then now() else null end,
      review_notes = coalesce(p_notes, review_notes),
      updated_at = now()
    where id = p_expense_id
    returning * into v_expense;
  elsif p_decision = 'rejected' then
    update public.expenses
    set
      status = 'rejected',
      review_notes = coalesce(p_notes, review_notes),
      updated_at = now()
    where id = p_expense_id
    returning * into v_expense;
  end if;

  insert into public.approvals (
    organization_id,
    entity_type,
    entity_id,
    decision,
    notes,
    officer_id, expense_revision, policy_snapshot, policy_version, self_approval, previous_status, new_status
  ) values (
    p_org_id,
    'expense',
    p_expense_id,
    p_decision,
    p_notes,
    v_caller, v_expense.review_revision, v_expense.approval_policy_snapshot, v_expense.approval_policy_version, v_self, v_previous, v_expense.status
  );

  return jsonb_build_object(
    'id', v_expense.id,
    'status', v_expense.status,
    'verified_by', v_expense.verified_by,
    'approved_by', v_expense.approved_by,
    'review_notes', v_expense.review_notes,
    'updated_at', v_expense.updated_at
  );
end;
$$;

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
        where budget_id=budget and status in ('pending','verified');
      committed := committed + (select spent + accounting.committed from public.budget_accounting accounting where id=budget and organization_id=org);
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
      where budget_id = budget and status in ('pending','verified');
    committed := committed + (select spent + accounting.committed from public.budget_accounting accounting where id=budget and organization_id=org);
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
