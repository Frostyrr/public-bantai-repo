begin;

-- FIN-01: Include linked cash advances when enforcing budget allocation caps in review_expense_internal.
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

    select coalesce(sum(amount_centavos), 0) into v_already_spent
    from public.expenses
    where budget_id = v_expense.budget_id and organization_id = p_org_id and status = 'approved';

    select coalesce(sum(amount_released_centavos), 0) into v_advances_committed
    from public.cash_advances
    where budget_id = v_expense.budget_id and organization_id = p_org_id;

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

revoke all on function public.review_expense_internal(uuid, uuid, text, text) from public, anon, authenticated;

-- FIN-03: Fallback to UTC when organization time_zone is NULL so overdue evaluation is never silently suppressed.
create or replace function public.directory_member_financial_rows(
  target_org uuid,
  target_member uuid,
  target_collection uuid default null,
  target_obligations uuid[] default null
)
returns table (
  obligation_id uuid, collection_id uuid, collection_title text, due_date date, currency text,
  assessed_centavos text, paid_centavos text, remaining_centavos text, overpaid_centavos text, status text, overdue boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_directory_capability(target_org, 'financial_view') then
    raise exception 'Member finances are not accessible.' using errcode = '42501';
  end if;
  return query
    select o.id, c.id, c.title, c.due_date, c.currency::text, o.amount_centavos::text, totals.paid::text,
      (case when o.status = 'waived' then 0 else greatest(o.amount_centavos - totals.paid, 0) end)::text,
      greatest(totals.paid - o.amount_centavos, 0)::text, o.status,
      coalesce(c.due_date < (now() at time zone coalesce(org.time_zone, 'UTC'))::date
        and o.status <> 'waived' and o.amount_centavos > totals.paid, false)
    from public.obligations o
    join public.collections c on c.id = o.collection_id and c.organization_id = o.organization_id
    join public.organizations org on org.id = o.organization_id
    cross join lateral (
      select coalesce(sum(p.amount_centavos), 0) as paid from public.payments p
      where p.obligation_id = o.id and p.organization_id = o.organization_id
        and p.collection_id = o.collection_id and p.status = 'completed'
    ) totals
    where o.organization_id = target_org and (target_member is null or o.directory_member_id = target_member)
      and (target_collection is null or o.collection_id = target_collection)
      and (target_obligations is null or o.id = any(target_obligations))
    order by o.created_at desc, o.id;
end;
$$;

revoke all on function public.directory_member_financial_rows(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;

-- SEC-04: Explicit active org membership predicate on budget_amendments RLS policy.
drop policy if exists budget_amendment_read on public.budget_amendments;
create policy budget_amendment_read on public.budget_amendments for select to authenticated
  using (
    public.is_active_org_member(organization_id, (select auth.uid()))
    and exists (
      select 1 from public.budgets b
      where b.id = budget_amendments.budget_id
        and b.organization_id = budget_amendments.organization_id
    )
  );

commit;
