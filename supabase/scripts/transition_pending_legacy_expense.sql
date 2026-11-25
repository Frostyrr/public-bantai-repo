-- Run in Supabase SQL Editor after reviewing the organization's current policy.
-- Explicitly transition only this unreviewed expense to the enabled self-approval exception.
begin;
do $$
declare
  v_expense public.expenses;
  v_org public.organizations;
begin
  select * into v_expense from public.expenses
  where id='f15506ba-39e0-4190-ae23-7dd5ddc838f2'
    and organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' for update;
  if not found then raise exception 'Target expense not found.'; end if;
  if v_expense.approval_policy_snapshot not in ('legacy','standard') then
    raise exception 'Only legacy or standard expenses may use this targeted transition.';
  end if;
  if v_expense.status <> 'pending' or v_expense.verified_by is not null
     or v_expense.approved_by is not null or exists (
       select 1 from public.approvals where entity_type='expense' and entity_id=v_expense.id
     ) then raise exception 'Only an unreviewed pending expense may be transitioned.'; end if;
  select * into v_org from public.organizations where id=v_expense.organization_id for share;
  if v_org.expense_approval_policy <> 'owner_admin_self' then
    raise exception 'Enable Owner/Admin self-approval in organization settings first.';
  end if;
  update public.expenses set
    approval_policy_snapshot=v_org.expense_approval_policy,
    treasurer_approval_snapshot=v_org.treasurer_expense_approval,
    approval_policy_version=v_org.expense_policy_version,
    required_approvals=case when v_org.expense_approval_policy='strict' then 2 else 1 end,
    review_revision=review_revision+1,
    updated_at=now()
  where id=v_expense.id;
  -- Existing expenses_audit trigger records full before/after snapshots.
end $$;
commit;
select id,status,approval_policy_snapshot,treasurer_approval_snapshot,
       approval_policy_version,required_approvals,review_revision
from public.expenses where id='f15506ba-39e0-4190-ae23-7dd5ddc838f2';
