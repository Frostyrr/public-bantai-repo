begin;

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
     or exists (select 1 from public.cash_advances where budget_id = p_budget_id) then
    raise exception 'This budget has linked expenses or cash advances and cannot be deleted.' using errcode = '23514';
  end if;

  delete from public.budgets where id = p_budget_id and organization_id = p_org_id;
  return jsonb_build_object('id', p_budget_id, 'action', 'deleted', 'message', 'Budget deleted.');
end;
$$;

commit;
