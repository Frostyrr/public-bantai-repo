-- Two-person review: submitter and an independent officer. No owner/admin bypass.
-- Existing terminal approvals are retained; legacy self-verification must be corrected before approval.
begin;
create or replace function public.review_expense(
  p_org_id uuid,
  p_expense_id uuid,
  p_decision text, -- 'verified', 'approved', 'rejected'
  p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_expense public.expenses;
  v_allocated bigint;
  v_already_spent bigint;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer', 'auditor') then
    raise exception 'Unauthorized to review expenses.';
  end if;

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

  if v_expense.submitted_by = v_caller then
    raise exception 'A different officer must review your expense.';
  end if;
  if p_decision = 'verified' and not (v_expense.status = 'pending' or (v_expense.status = 'verified' and (v_expense.verified_by is null or v_expense.verified_by = v_expense.submitted_by))) then
    raise exception 'Only pending expenses can be verified.';
  end if;
  if p_decision = 'approved' and (v_expense.status <> 'verified' or v_expense.verified_by is null or v_expense.verified_by = v_expense.submitted_by) then
    raise exception 'An independent officer must verify the expense before approval.';
  end if;
  if p_decision = 'rejected' and coalesce(length(trim(p_notes)), 0) < 3 then
    raise exception 'Provide a reason for rejection (at least 3 characters).';
  end if;

  -- If approving, verify against allocated budget cap if linked
  if p_decision = 'approved' and v_expense.budget_id is not null then
    select allocated_amount_centavos into v_allocated
    from public.budgets
    where id = v_expense.budget_id and organization_id = p_org_id for update;
    if not found then raise exception 'Budget is not available in this organization.'; end if;

    select coalesce(sum(amount_centavos), 0) into v_already_spent
    from public.expenses
    where budget_id = v_expense.budget_id and status = 'approved';

    if (v_already_spent + v_expense.amount_centavos) > v_allocated then
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
      status = 'approved',
      approved_by = v_caller,
      approved_at = now(),
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

  -- Record in approvals table
  insert into public.approvals (
    organization_id,
    entity_type,
    entity_id,
    decision,
    notes,
    officer_id
  ) values (
    p_org_id,
    'expense',
    p_expense_id,
    p_decision,
    p_notes,
    v_caller
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

create or replace function public.review_liquidation(
  p_org_id uuid,
  p_liquidation_id uuid,
  p_decision text, -- 'approved', 'rejected'
  p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_liquidation public.liquidations;
  v_advance public.cash_advances;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer', 'auditor') then
    raise exception 'Unauthorized to review liquidation.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid review decision.';
  end if;

  select * into v_liquidation
  from public.liquidations
  where id = p_liquidation_id and organization_id = p_org_id for update;

  if not found then
    raise exception 'Liquidation record not found.';
  end if;

  select * into v_advance
  from public.cash_advances
  where id = v_liquidation.cash_advance_id and organization_id = p_org_id for update;

  if v_liquidation.status <> 'submitted' or v_advance.status <> 'under_review' then
    raise exception 'Only submitted liquidations awaiting review can be reviewed.';
  end if;
  if v_liquidation.submitted_by = v_caller or exists (
    select 1 from public.organization_members where id = v_advance.accountable_person_id and profile_id = v_caller
  ) then
    raise exception 'A different officer must review this liquidation.';
  end if;
  if p_decision = 'rejected' and coalesce(length(trim(p_notes)), 0) < 3 then
    raise exception 'Provide a reason for rejection (at least 3 characters).';
  end if;

  if p_decision = 'approved' then
    if v_liquidation.outstanding_balance_centavos <> 0 and (p_notes is null or char_length(trim(p_notes)) < 3) then
      raise exception 'Approval requires explicit explanation notes for non-zero discrepancy balance.';
    end if;

    update public.liquidations
    set
      status = 'approved',
      reviewed_by = v_caller,
      reviewed_at = now(),
      review_notes = p_notes,
      updated_at = now()
    where id = p_liquidation_id
    returning * into v_liquidation;

    update public.cash_advances
    set status = 'liquidated', updated_at = now()
    where id = v_advance.id;
  elsif p_decision = 'rejected' then
    update public.liquidations
    set
      status = 'rejected',
      reviewed_by = v_caller,
      reviewed_at = now(),
      review_notes = p_notes,
      updated_at = now()
    where id = p_liquidation_id
    returning * into v_liquidation;

    update public.cash_advances
    set status = 'disputed', updated_at = now()
    where id = v_advance.id;
  end if;

  -- Record in approvals table
  insert into public.approvals (
    organization_id,
    entity_type,
    entity_id,
    decision,
    notes,
    officer_id
  ) values (
    p_org_id,
    'liquidation',
    p_liquidation_id,
    p_decision,
    p_notes,
    v_caller
  );

  return jsonb_build_object(
    'id', v_liquidation.id,
    'status', v_liquidation.status,
    'reviewed_by', v_liquidation.reviewed_by,
    'review_notes', v_liquidation.review_notes,
    'updated_at', v_liquidation.updated_at
  );
end;
$$;

-- Financial edits invalidate a previous verification. Historical terminal records stay protected.
create or replace function public.invalidate_expense_verification()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - array['status','verified_by','verified_at','approved_by','approved_at','review_notes','updated_at'])
     is distinct from
     (to_jsonb(old) - array['status','verified_by','verified_at','approved_by','approved_at','review_notes','updated_at']) then
    if old.status in ('approved', 'rejected', 'cancelled') then
      raise exception 'Terminal expenses cannot be edited.';
    end if;
    new.status := 'pending';
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;
create trigger expenses_reset_verification before update on public.expenses
for each row execute function public.invalidate_expense_verification();

commit;
