begin;
create or replace function public.collection_deletion_policy(c public.collections)
returns text language sql stable set search_path = '' as $$
 select case
  when c.retention_hold or exists (select 1 from public.obligations where collection_id=c.id and status not in ('paid','waived'))
    then 'protected'
  when exists (select 1 from public.obligations where collection_id=c.id)
    or exists (select 1 from public.payments where collection_id=c.id)
    or exists (select 1 from public.approvals where organization_id=c.organization_id and entity_id=c.id)
    then 'retention_review'
  else 'immediate' end;
$$;
revoke all on function public.collection_deletion_policy(public.collections) from public,anon,authenticated;

create or replace function public.delete_collection(
  p_org_id uuid,
  p_collection_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
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

  perform 1 from public.collections
  where id = p_collection_id and organization_id = p_org_id for update;
  if not found then
    raise exception 'Collection not found in this organization.';
  end if;

  delete from public.collections where id = p_collection_id and organization_id = p_org_id;
  return jsonb_build_object('id', p_collection_id, 'action', 'deleted', 'message', 'Collection deleted.');
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
  where id = p_expense_id and organization_id = p_org_id for update;

  if v_expense.id is null then
    raise exception 'Expense not found.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or (v_expense.submitted_by is distinct from v_caller and v_role not in ('owner','organization_admin','treasurer')) then
    raise exception 'You cannot delete this expense.' using errcode='42501';
  end if;
  if v_expense.status not in ('pending','cancelled') or v_expense.review_revision > 1 or exists (
    select 1 from public.approvals where organization_id=p_org_id and entity_type='expense' and entity_id=p_expense_id
  ) then
    raise exception 'This expense has financial or review history and must be retained.' using errcode='23514';
  end if;

  delete from public.expense_submission_requests
    where organization_id=p_org_id and result->>'id'=p_expense_id::text;
  delete from public.expenses where id = p_expense_id and organization_id = p_org_id;

  return jsonb_build_object(
    'id', p_expense_id,
    'action', 'deleted',
    'message', 'Expense record was deleted successfully.'
  );
end;
$$;

create function public.delete_unused_cash_request(org uuid, request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.cash_advance_requests;
begin
  select * into r from public.cash_advance_requests where id=request_id and organization_id=org for update;
  if not found or not exists (select 1 from public.organization_members where organization_id=org and profile_id=auth.uid()
    and status='active' and (role in ('owner','organization_admin') or r.requester=auth.uid())) then
    raise exception 'Cash advance request is unavailable.' using errcode='42501';
  end if;
  if r.status <> 'pending' or r.revision <> 1 or r.advance_id is not null then
    raise exception 'This request has activity that must be retained.' using errcode='23514';
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_id)
    values(org,auth.uid(),'cash_advance_requests.delete',r.id);
  delete from public.cash_advance_requests where id=r.id;
end;
$$;
revoke all on function public.delete_unused_cash_request(uuid,uuid) from public,anon;
grant execute on function public.delete_unused_cash_request(uuid,uuid) to authenticated;

drop function if exists public.purge_archived_collection(uuid,uuid,text);
create or replace function public.delete_budget(p_org_id uuid, p_budget_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_org_id and profile_id = auth.uid() and status = 'active'
      and role in ('owner', 'organization_admin', 'treasurer')
  ) then
    raise exception 'You cannot delete budgets for this organization.' using errcode = '42501';
  end if;

  perform 1 from public.budgets
    where id = p_budget_id and organization_id = p_org_id for update;
  if not found then
    raise exception 'Budget not found in this organization.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.expenses where budget_id = p_budget_id)
     or exists (select 1 from public.cash_advances where budget_id = p_budget_id)
     or exists (select 1 from public.budget_amendments where budget_id = p_budget_id) or exists (select 1 from public.approvals where organization_id=p_org_id and entity_id=p_budget_id) then
    raise exception 'This budget has linked expenses, cash advances, or amendments and cannot be deleted.' using errcode = '23514';
  end if;

  delete from public.budgets where id = p_budget_id and organization_id = p_org_id;
  return jsonb_build_object('id', p_budget_id, 'action', 'deleted', 'message', 'Budget deleted.');
end;
$$;

create or replace function public.audit_collection_disposal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
 values(old.organization_id,auth.uid(),'collections.delete',old.id,
 jsonb_build_object('classification','immediate','reason','Unused collection'));
 return old;
end;
$$;

commit;
