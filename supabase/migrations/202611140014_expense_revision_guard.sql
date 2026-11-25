begin;

create or replace function public.invalidate_expense_verification()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (old.status in ('verified', 'rejected') and new.status = 'pending') or (to_jsonb(new) - array['status','verified_by','verified_at','approved_by','approved_at','review_notes','updated_at','approval_policy_snapshot','treasurer_approval_snapshot','approval_policy_version','required_approvals','review_revision'])
     is distinct from
     (to_jsonb(old) - array['status','verified_by','verified_at','approved_by','approved_at','review_notes','updated_at','approval_policy_snapshot','treasurer_approval_snapshot','approval_policy_version','required_approvals','review_revision']) then
    if old.status in ('approved', 'cancelled') then
      raise exception 'Terminal expenses cannot be edited.';
    end if;
    new.review_revision := old.review_revision + 1;
    new.status := 'pending';
    new.approved_by := null;
    new.approved_at := null;
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

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
  where id = p_expense_id and organization_id = p_org_id for update;

  if v_expense.id is null then
    raise exception 'Expense not found.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_expense.submitted_by is distinct from v_caller
     or v_expense.status not in ('pending', 'verified', 'rejected') then
    raise exception 'Only the active submitter can revise an expense awaiting review or rejected.' using errcode = '42501';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  update public.expenses
  set status = 'pending',
      review_notes = null,
      title = trim(p_title),
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

commit;

