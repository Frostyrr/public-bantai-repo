-- 202611120010_edit_and_delete_operations.sql
-- Role-based edit and delete operations for Spaces, Collections, Budgets, Expenses, and Cash Advances
-- Strictly enforces financial integrity, auditability, and role boundaries.

begin;

-- ====================================================
-- 1. SPACES: UPDATE & DELETE
-- ====================================================

create or replace function public.update_space(
  p_org_id uuid,
  p_space_id uuid,
  p_name text,
  p_description text default null,
  p_status text default 'active'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_space public.spaces;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin') then
    raise exception 'Unauthorized to update spaces for this organization.';
  end if;

  if p_status not in ('active', 'archived') then
    raise exception 'Invalid space status. Must be active or archived.';
  end if;

  update public.spaces
  set name = trim(p_name),
      description = nullif(trim(p_description), ''),
      status = p_status,
      updated_at = now()
  where id = p_space_id and organization_id = p_org_id
  returning * into v_space;

  if v_space.id is null then
    raise exception 'Space not found.';
  end if;

  return jsonb_build_object(
    'id', v_space.id,
    'organization_id', v_space.organization_id,
    'name', v_space.name,
    'description', v_space.description,
    'status', v_space.status
  );
end;
$$;

create or replace function public.delete_space(
  p_org_id uuid,
  p_space_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_has_records boolean;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin') then
    raise exception 'Unauthorized to delete spaces for this organization.';
  end if;

  -- Check if financial records or collections reference this space
  select exists (
    select 1 from public.collections where space_id = p_space_id
    union all
    select 1 from public.budgets where space_id = p_space_id
    union all
    select 1 from public.expenses where space_id = p_space_id
    union all
    select 1 from public.cash_advances where space_id = p_space_id
  ) into v_has_records;

  if v_has_records then
    -- Soft-archive space to maintain relational integrity
    update public.spaces set status = 'archived', updated_at = now()
    where id = p_space_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_space_id, 'action', 'archived', 'message', 'Space has linked financial records and was safely archived.');
  else
    delete from public.spaces where id = p_space_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_space_id, 'action', 'deleted', 'message', 'Space was deleted successfully.');
  end if;
end;
$$;

-- ====================================================
-- 2. COLLECTIONS: UPDATE & DELETE
-- ====================================================

create or replace function public.update_collection(
  p_org_id uuid,
  p_collection_id uuid,
  p_title text,
  p_description text default null,
  p_target_centavos bigint default 0,
  p_due_date date default null,
  p_space_id uuid default null,
  p_status text default 'active'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_coll public.collections;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to update collections for this organization.';
  end if;

  if p_status not in ('active', 'closed', 'archived') then
    raise exception 'Invalid collection status. Must be active, closed, or archived.';
  end if;

  if p_target_centavos < 0 then
    raise exception 'Target collection amount must be non-negative.';
  end if;

  update public.collections
  set title = trim(p_title),
      description = nullif(trim(p_description), ''),
      target_amount_centavos = p_target_centavos,
      due_date = p_due_date,
      space_id = p_space_id,
      status = p_status,
      updated_at = now()
  where id = p_collection_id and organization_id = p_org_id
  returning * into v_coll;

  if v_coll.id is null then
    raise exception 'Collection not found.';
  end if;

  return jsonb_build_object(
    'id', v_coll.id,
    'organization_id', v_coll.organization_id,
    'title', v_coll.title,
    'target_amount_centavos', v_coll.target_amount_centavos,
    'due_date', v_coll.due_date,
    'status', v_coll.status
  );
end;
$$;

create or replace function public.delete_collection(
  p_org_id uuid,
  p_collection_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_has_payments boolean;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to delete collections for this organization.';
  end if;

  -- Verify no completed payments exist for this collection
  select exists (
    select 1 from public.payments
    where collection_id = p_collection_id and status = 'completed'
  ) into v_has_payments;

  if v_has_payments then
    -- Cannot hard delete because receipts/payments are legal audit records
    update public.collections set status = 'archived', updated_at = now()
    where id = p_collection_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_collection_id, 'action', 'archived', 'message', 'Collection has recorded payments and was safely archived.');
  else
    delete from public.obligations where collection_id = p_collection_id;
    delete from public.collections where id = p_collection_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_collection_id, 'action', 'deleted', 'message', 'Collection was deleted successfully.');
  end if;
end;
$$;

-- ====================================================
-- 3. BUDGETS: UPDATE & DELETE
-- ====================================================

create or replace function public.update_budget(
  p_org_id uuid,
  p_budget_id uuid,
  p_name text,
  p_allocated_centavos bigint,
  p_description text default null,
  p_space_id uuid default null,
  p_period_id uuid default null,
  p_status text default 'active'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_spent bigint;
  v_budget public.budgets;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to update budgets for this organization.';
  end if;

  if p_status not in ('active', 'closed', 'archived') then
    raise exception 'Invalid budget status. Must be active, closed, or archived.';
  end if;

  -- Safety check: Allocated amount cannot be reduced below already approved expenditures
  select coalesce(sum(amount_centavos), 0) into v_spent
  from public.expenses
  where budget_id = p_budget_id and status = 'approved';

  if p_allocated_centavos < v_spent then
    raise exception 'Allocated budget cannot be less than already approved expenditures.';
  end if;

  update public.budgets
  set name = trim(p_name),
      allocated_amount_centavos = p_allocated_centavos,
      description = nullif(trim(p_description), ''),
      space_id = p_space_id,
      reporting_period_id = p_period_id,
      status = p_status,
      updated_at = now()
  where id = p_budget_id and organization_id = p_org_id
  returning * into v_budget;

  if v_budget.id is null then
    raise exception 'Budget not found.';
  end if;

  return jsonb_build_object(
    'id', v_budget.id,
    'organization_id', v_budget.organization_id,
    'name', v_budget.name,
    'allocated_amount_centavos', v_budget.allocated_amount_centavos,
    'status', v_budget.status
  );
end;
$$;

create or replace function public.delete_budget(
  p_org_id uuid,
  p_budget_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_has_approved_expenses boolean;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to delete budgets for this organization.';
  end if;

  select exists (
    select 1 from public.expenses where budget_id = p_budget_id and status = 'approved'
  ) into v_has_approved_expenses;

  if v_has_approved_expenses then
    update public.budgets set status = 'archived', updated_at = now()
    where id = p_budget_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_budget_id, 'action', 'archived', 'message', 'Budget has approved expenses and was safely archived.');
  else
    -- Detach pending expenses and advances
    update public.expenses set budget_id = null where budget_id = p_budget_id;
    update public.cash_advances set budget_id = null where budget_id = p_budget_id;
    delete from public.budgets where id = p_budget_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_budget_id, 'action', 'deleted', 'message', 'Budget was deleted successfully.');
  end if;
end;
$$;

-- ====================================================
-- 4. EXPENSES: UPDATE & DELETE
-- ====================================================

create or replace function public.update_expense(
  p_org_id uuid,
  p_expense_id uuid,
  p_title text,
  p_amount_centavos bigint,
  p_category text,
  p_incurred_date date,
  p_description text default null,
  p_budget_id uuid default null,
  p_space_id uuid default null,
  p_period_id uuid default null,
  p_receipt_url text default null,
  p_vendor_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_expense public.expenses;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id and organization_id = p_org_id;

  if v_expense.id is null then
    raise exception 'Expense not found.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  -- Only the submitter (while pending) or officers (while pending or verified) can edit
  if v_expense.submitted_by = v_caller and v_expense.status = 'pending' then
    -- allowed
  elsif v_role in ('owner', 'organization_admin', 'treasurer') and v_expense.status in ('pending', 'verified') then
    -- allowed
  else
    raise exception 'Cannot edit expense in % status or without appropriate permissions.', v_expense.status;
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  update public.expenses
  set title = trim(p_title),
      amount_centavos = p_amount_centavos,
      category = p_category,
      incurred_date = p_incurred_date,
      description = nullif(trim(p_description), ''),
      budget_id = p_budget_id,
      space_id = p_space_id,
      reporting_period_id = p_period_id,
      receipt_url = nullif(trim(p_receipt_url), ''),
      vendor_name = nullif(trim(p_vendor_name), ''),
      updated_at = now()
  where id = p_expense_id and organization_id = p_org_id
  returning * into v_expense;

  return jsonb_build_object(
    'id', v_expense.id,
    'organization_id', v_expense.organization_id,
    'title', v_expense.title,
    'amount_centavos', v_expense.amount_centavos,
    'status', v_expense.status
  );
end;
$$;

create or replace function public.delete_expense(
  p_org_id uuid,
  p_expense_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_expense public.expenses;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id and organization_id = p_org_id;

  if v_expense.id is null then
    raise exception 'Expense not found.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  -- Submitter can cancel/delete own pending expense; officers can delete pending or rejected expenses
  if v_expense.submitted_by = v_caller and v_expense.status = 'pending' then
    -- allowed
  elsif v_role in ('owner', 'organization_admin', 'treasurer') and v_expense.status in ('pending', 'rejected', 'cancelled') then
    -- allowed
  else
    raise exception 'Cannot delete expense in % status.', v_expense.status;
  end if;

  delete from public.expenses where id = p_expense_id and organization_id = p_org_id;

  return jsonb_build_object(
    'id', p_expense_id,
    'action', 'deleted',
    'message', 'Expense record was deleted successfully.'
  );
end;
$$;

-- ====================================================
-- 5. CASH ADVANCES & LIQUIDATION: UPDATE & DELETE
-- ====================================================

create or replace function public.update_cash_advance(
  p_org_id uuid,
  p_advance_id uuid,
  p_title text,
  p_purpose text,
  p_amount_centavos bigint,
  p_disbursement_method text,
  p_reference_number text default null,
  p_budget_id uuid default null,
  p_space_id uuid default null,
  p_period_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_adv public.cash_advances;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to update cash advances.';
  end if;

  select * into v_adv
  from public.cash_advances
  where id = p_advance_id and organization_id = p_org_id;

  if v_adv.id is null then
    raise exception 'Cash advance not found.';
  end if;

  if v_adv.status != 'outstanding' then
    raise exception 'Cannot edit cash advance after liquidation has been submitted.';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Advance amount must be greater than zero.';
  end if;

  update public.cash_advances
  set title = trim(p_title),
      purpose = trim(p_purpose),
      amount_released_centavos = p_amount_centavos,
      disbursement_method = p_disbursement_method,
      reference_number = nullif(trim(p_reference_number), ''),
      budget_id = p_budget_id,
      space_id = p_space_id,
      reporting_period_id = p_period_id,
      updated_at = now()
  where id = p_advance_id and organization_id = p_org_id
  returning * into v_adv;

  return jsonb_build_object(
    'id', v_adv.id,
    'organization_id', v_adv.organization_id,
    'title', v_adv.title,
    'amount_released_centavos', v_adv.amount_released_centavos,
    'status', v_adv.status
  );
end;
$$;

create or replace function public.delete_cash_advance(
  p_org_id uuid,
  p_advance_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_adv public.cash_advances;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to delete cash advances.';
  end if;

  select * into v_adv
  from public.cash_advances
  where id = p_advance_id and organization_id = p_org_id;

  if v_adv.id is null then
    raise exception 'Cash advance not found.';
  end if;

  if v_adv.status != 'outstanding' then
    raise exception 'Cannot delete cash advance with linked liquidation records.';
  end if;

  delete from public.cash_advances where id = p_advance_id and organization_id = p_org_id;

  return jsonb_build_object(
    'id', p_advance_id,
    'action', 'deleted',
    'message', 'Cash advance was deleted successfully.'
  );
end;
$$;

create or replace function public.delete_liquidation(
  p_org_id uuid,
  p_liquidation_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_liq public.liquidations;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_liq
  from public.liquidations
  where id = p_liquidation_id and organization_id = p_org_id;

  if v_liq.id is null then
    raise exception 'Liquidation record not found.';
  end if;

  if v_liq.status = 'approved' then
    raise exception 'Cannot delete approved liquidation records.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to cancel liquidation submissions.';
  end if;

  -- Reset cash advance status back to outstanding
  update public.cash_advances
  set status = 'outstanding', updated_at = now()
  where id = v_liq.cash_advance_id;

  delete from public.liquidations where id = p_liquidation_id and organization_id = p_org_id;

  return jsonb_build_object(
    'id', p_liquidation_id,
    'action', 'deleted',
    'message', 'Liquidation draft was cancelled and cash advance status restored to outstanding.'
  );
end;
$$;

commit;
