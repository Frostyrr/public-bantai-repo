begin;
alter table public.organizations
 add column expense_approval_policy text not null default 'standard' check(expense_approval_policy in ('standard','owner_admin_self','strict')),
 add column treasurer_expense_approval boolean not null default false,
 add column expense_policy_version integer not null default 1;
alter table public.organization_members add column can_submit_expenses boolean not null default false;
-- Preserve existing member submission access, but new members require an explicit grant.
update public.organization_members set can_submit_expenses=true where role in ('member','student');
alter table public.expenses
 add column approval_policy_snapshot text not null default 'legacy' check(approval_policy_snapshot in ('legacy','standard','owner_admin_self','strict')),
 add column treasurer_approval_snapshot boolean not null default true,
 add column approval_policy_version integer not null default 0,
 add column required_approvals integer not null default 1 check(required_approvals in (1,2)),
 add column review_revision integer not null default 1;
alter table public.approvals
 add column expense_revision integer,
 add column policy_snapshot text,
 add column policy_version integer,
 add column self_approval boolean not null default false,
 add column previous_status text,
 add column new_status text;
-- Historical rows remain untouched; only new revision decisions participate in uniqueness.
create unique index expense_approval_once_per_revision on public.approvals(entity_id,expense_revision,officer_id)
 where entity_type='expense' and decision='approved' and expense_revision is not null;

create function public.set_expense_approval_policy(p_org_id uuid,p_policy text,p_treasurer boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org public.organizations;
begin
 if not exists(select 1 from public.organization_members where organization_id=p_org_id and profile_id=auth.uid() and status='active' and role='owner') then raise exception 'Only the owner can change financial approval policies.'; end if;
 if p_policy is null or p_policy not in ('standard','owner_admin_self','strict') or p_treasurer is null then raise exception 'Invalid approval settings.'; end if;
 perform 1 from public.organizations where id=p_org_id for update;
 update public.organizations set expense_approval_policy=p_policy,treasurer_expense_approval=p_treasurer,expense_policy_version=expense_policy_version+1 where id=p_org_id returning * into v_org;
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value) values(p_org_id,auth.uid(),'expense_policy_changed',p_org_id,to_jsonb(v_org));
 return to_jsonb(v_org);
end; $$;
revoke all on function public.set_expense_approval_policy(uuid,text,boolean) from public;
grant execute on function public.set_expense_approval_policy(uuid,text,boolean) to authenticated;

create function public.set_member_expense_submission(p_org_id uuid,p_member_id uuid,p_allowed boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.organization_members where organization_id=p_org_id and profile_id=auth.uid() and status='active' and role='owner') then raise exception 'Only the owner can grant submission permission.'; end if;
 update public.organization_members set can_submit_expenses=p_allowed where id=p_member_id and organization_id=p_org_id and role in ('member','student') and status='active';
 if not found then raise exception 'Eligible member not found.'; end if;
end; $$;
revoke all on function public.set_member_expense_submission(uuid,uuid,boolean) from public;
grant execute on function public.set_member_expense_submission(uuid,uuid,boolean) to authenticated;

create function public.snapshot_expense_policy() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org public.organizations; v_member public.organization_members;
begin
 select * into v_member from public.organization_members where organization_id=new.organization_id and profile_id=auth.uid() and status='active';
 if not found or v_member.role='auditor' or (v_member.role in ('member','student') and not v_member.can_submit_expenses) then raise exception 'You do not have permission to submit expenses.'; end if;
 select * into v_org from public.organizations where id=new.organization_id for share;
 new.approval_policy_snapshot:=v_org.expense_approval_policy;
 new.treasurer_approval_snapshot:=v_org.treasurer_expense_approval;
 new.approval_policy_version:=v_org.expense_policy_version;
 new.required_approvals:=case when v_org.expense_approval_policy='strict' then 2 else 1 end;
 return new;
end; $$;
create trigger expenses_policy_snapshot before insert on public.expenses for each row execute function public.snapshot_expense_policy();
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

  -- If approving, verify against allocated budget cap if linked
  if p_decision = 'approved' and v_count + 1 >= v_expense.required_approvals and v_expense.budget_id is not null then
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

  -- Record in approvals table
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

create or replace function public.invalidate_expense_verification()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - array['status','verified_by','verified_at','approved_by','approved_at','review_notes','updated_at','approval_policy_snapshot','treasurer_approval_snapshot','approval_policy_version','required_approvals','review_revision'])
     is distinct from
     (to_jsonb(old) - array['status','verified_by','verified_at','approved_by','approved_at','review_notes','updated_at','approval_policy_snapshot','treasurer_approval_snapshot','approval_policy_version','required_approvals','review_revision']) then
    if old.status in ('approved', 'rejected', 'cancelled') then
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

commit;
