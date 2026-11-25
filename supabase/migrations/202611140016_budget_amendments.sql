begin;

create table public.budget_amendments (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets(id) on delete restrict,
  organization_id uuid not null references public.organizations(id),
  previous_centavos bigint not null,
  proposed_centavos bigint not null check (proposed_centavos >= 0),
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  proposed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'))
);
alter table public.budget_amendments enable row level security;
revoke all on public.budget_amendments from public, anon, authenticated;
grant select on public.budget_amendments to authenticated;
create policy budget_amendment_read on public.budget_amendments for select to authenticated
using (exists (select 1 from public.budgets b where b.id = budget_amendments.budget_id and b.organization_id = budget_amendments.organization_id));
create unique index budget_one_pending_amendment on public.budget_amendments(budget_id) where status = 'pending';
create trigger budget_amendments_audit after insert or update on public.budget_amendments
for each row execute function public.audit_record_change();

create function public.manage_budget_amendment(org uuid, budget uuid, expected bigint,
  proposed bigint, explanation text, amendment uuid, decision text)
returns public.budget_amendments language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  current_budget public.budgets;
  change public.budget_amendments;
  committed numeric;
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
      where budget_id = budget and status in ('pending','verified','approved');
    committed := committed + (select coalesce(sum(amount_released_centavos),0) from public.cash_advances where budget_id = budget);
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
revoke all on function public.manage_budget_amendment(uuid,uuid,bigint,bigint,text,uuid,text) from public,anon;
grant execute on function public.manage_budget_amendment(uuid,uuid,bigint,bigint,text,uuid,text) to authenticated;

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
     or exists (select 1 from public.budget_amendments where budget_id = p_budget_id) then
    raise exception 'This budget has linked expenses, cash advances, or amendments and cannot be deleted.' using errcode = '23514';
  end if;

  delete from public.budgets where id = p_budget_id and organization_id = p_org_id;
  return jsonb_build_object('id', p_budget_id, 'action', 'deleted', 'message', 'Budget deleted.');
end;
$$;

commit;
