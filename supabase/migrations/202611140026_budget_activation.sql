begin;
alter table public.budgets drop constraint budgets_status_check,
 add constraint budgets_status_check check (status in ('active','closed','archived','pending_approval','rejected')),
 add column activation_policy_version integer;

create function public.snapshot_budget_activation() returns trigger
language plpgsql set search_path='' as $$
declare preset text; version integer;
begin
 select approval_preset, approval_preset_version into preset, version
 from public.organizations where id=new.organization_id for share;
 if preset='strict' then
   new.status:='pending_approval';
   new.activation_policy_version:=version;
 end if;
 return new;
end;
$$;
create trigger snapshot_budget_activation before insert on public.budgets
for each row execute function public.snapshot_budget_activation();

create function public.decide_budget_activation(org uuid, budget uuid, approve boolean)
returns text language plpgsql security definer set search_path='' as $$
declare b public.budgets; result text;
begin
 if approve is null or not exists(select 1 from public.organization_members
 where organization_id=org and profile_id=auth.uid() and status='active'
 and role in ('owner','organization_admin')) then
   raise exception 'An owner or admin must review this budget.' using errcode='42501';
 end if;
 select * into b from public.budgets where id=budget and organization_id=org for update;
 if not found or b.status <> 'pending_approval' then
   raise exception 'This budget is no longer awaiting approval.' using errcode='23514';
 end if;
 if b.created_by=auth.uid() then
   raise exception 'A different owner or admin must review this budget.' using errcode='42501';
 end if;
 result := case when approve then 'active' else 'rejected' end;
 update public.budgets set status=result,updated_at=now() where id=budget;
 return result;
end;
$$;
revoke all on function public.decide_budget_activation(uuid,uuid,boolean) from public,anon;
grant execute on function public.decide_budget_activation(uuid,uuid,boolean) to authenticated;
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

  select * into v_budget from public.budgets
    where id = p_budget_id and organization_id = p_org_id for update;
  if not found then raise exception 'Budget not found.'; end if;
  if v_budget.status in ('pending_approval','rejected') then
    raise exception 'Budgets awaiting review or rejected cannot be edited.' using errcode='23514';
  end if;
  if p_allocated_centavos is distinct from v_budget.allocated_amount_centavos then
    raise exception 'Use a budget amendment to change the authorized allocation.' using errcode = '23514';
  end if;

  update public.budgets
  set name = trim(p_name),
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

commit;
