-- Migration: 202611120007_cash_advances_and_liquidation.sql
-- Description: Core Phase 6 schema for Cash Releases / Advances, Liquidation Reconciliation, and Review Decisions.

create table if not exists public.cash_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  reporting_period_id uuid references public.reporting_periods(id) on delete set null,
  budget_id uuid references public.budgets(id) on delete set null,
  accountable_person_id uuid not null references public.organization_members(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0 and char_length(title) <= 150),
  purpose text not null check (char_length(purpose) <= 1000),
  amount_released_centavos bigint not null check (amount_released_centavos > 0),
  currency char(3) not null default 'PHP',
  disbursement_method text not null check (disbursement_method in ('cash', 'bank_transfer', 'check', 'gcash', 'maya', 'other')),
  reference_number text check (char_length(reference_number) <= 100),
  released_at timestamptz not null default now(),
  released_by uuid not null references auth.users(id),
  status text not null default 'outstanding' check (status in ('outstanding', 'under_review', 'liquidated', 'disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_advances_org on public.cash_advances(organization_id);
create index if not exists idx_advances_person on public.cash_advances(accountable_person_id);
create index if not exists idx_advances_status on public.cash_advances(organization_id, status);

create table if not exists public.liquidations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_advance_id uuid not null references public.cash_advances(id) on delete cascade unique,
  total_spent_centavos bigint not null default 0 check (total_spent_centavos >= 0),
  total_returned_centavos bigint not null default 0 check (total_returned_centavos >= 0),
  outstanding_balance_centavos bigint not null default 0,
  reconciliation_notes text check (char_length(reconciliation_notes) <= 1000),
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  submitted_by uuid not null references auth.users(id),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_notes text check (char_length(review_notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_liquidations_org on public.liquidations(organization_id);
create index if not exists idx_liquidations_advance on public.liquidations(cash_advance_id);

-- Enable RLS
alter table public.cash_advances enable row level security;
alter table public.liquidations enable row level security;

-- Grants and permissions
revoke all on public.cash_advances, public.liquidations from anon, authenticated;
grant select on public.cash_advances, public.liquidations to authenticated;

-- Read policies
create policy cash_advances_org_read on public.cash_advances
  for select to authenticated
  using (public.is_active_org_member(organization_id, (select auth.uid())));

create policy liquidations_org_read on public.liquidations
  for select to authenticated
  using (public.is_active_org_member(organization_id, (select auth.uid())));

-- Audit triggers
create trigger cash_advances_audit
  after insert or update or delete on public.cash_advances
  for each row execute function public.audit_record_change();

create trigger liquidations_audit
  after insert or update or delete on public.liquidations
  for each row execute function public.audit_record_change();

-- Atomic Cash Advance Creation
create or replace function public.create_cash_advance(
  p_org_id uuid,
  p_accountable_person_id uuid,
  p_title text,
  p_purpose text,
  p_amount_centavos bigint,
  p_disbursement_method text,
  p_reference_number text default null,
  p_budget_id uuid default null,
  p_space_id uuid default null,
  p_period_id uuid default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_org_currency char(3);
  v_advance public.cash_advances;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to release cash advances.';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Advance amount must be greater than zero.';
  end if;

  -- Validate accountable person belongs to this org
  if not exists (select 1 from public.organization_members where id = p_accountable_person_id and organization_id = p_org_id and status = 'active') then
    raise exception 'Accountable person must be an active member of this organization.';
  end if;

  select currency into v_org_currency from public.organizations where id = p_org_id;
  if v_org_currency is null then
    v_org_currency := 'PHP';
  end if;

  insert into public.cash_advances (
    organization_id,
    space_id,
    reporting_period_id,
    budget_id,
    accountable_person_id,
    title,
    purpose,
    amount_released_centavos,
    currency,
    disbursement_method,
    reference_number,
    released_by
  ) values (
    p_org_id,
    p_space_id,
    p_period_id,
    p_budget_id,
    p_accountable_person_id,
    trim(p_title),
    trim(p_purpose),
    p_amount_centavos,
    v_org_currency,
    p_disbursement_method,
    p_reference_number,
    v_caller
  ) returning * into v_advance;

  return jsonb_build_object(
    'id', v_advance.id,
    'organization_id', v_advance.organization_id,
    'accountable_person_id', v_advance.accountable_person_id,
    'title', v_advance.title,
    'amount_released_centavos', v_advance.amount_released_centavos,
    'status', v_advance.status,
    'released_at', v_advance.released_at
  );
end;
$$;

-- Atomic Liquidation Submission
create or replace function public.submit_liquidation(
  p_org_id uuid,
  p_cash_advance_id uuid,
  p_spent_centavos bigint,
  p_returned_centavos bigint,
  p_notes text default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_advance public.cash_advances;
  v_liquidation public.liquidations;
  v_balance bigint;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null then
    raise exception 'Unauthorized to submit liquidation.';
  end if;

  select * into v_advance
  from public.cash_advances
  where id = p_cash_advance_id and organization_id = p_org_id;

  if not found then
    raise exception 'Cash advance record not found.';
  end if;

  if v_advance.status = 'liquidated' then
    raise exception 'Cash advance is already liquidated.';
  end if;

  if p_spent_centavos < 0 or p_returned_centavos < 0 then
    raise exception 'Spent and returned amounts must be non-negative.';
  end if;

  -- Formula: Unreconciled Balance = Released - Spent - Returned
  v_balance := v_advance.amount_released_centavos - p_spent_centavos - p_returned_centavos;

  insert into public.liquidations (
    organization_id,
    cash_advance_id,
    total_spent_centavos,
    total_returned_centavos,
    outstanding_balance_centavos,
    reconciliation_notes,
    status,
    submitted_by
  ) values (
    p_org_id,
    p_cash_advance_id,
    p_spent_centavos,
    p_returned_centavos,
    v_balance,
    p_notes,
    'submitted',
    v_caller
  )
  on conflict (cash_advance_id)
  do update set
    total_spent_centavos = excluded.total_spent_centavos,
    total_returned_centavos = excluded.total_returned_centavos,
    outstanding_balance_centavos = excluded.outstanding_balance_centavos,
    reconciliation_notes = excluded.reconciliation_notes,
    status = 'submitted',
    submitted_at = now(),
    submitted_by = v_caller,
    updated_at = now()
  returning * into v_liquidation;

  -- Update advance status to 'under_review'
  update public.cash_advances
  set status = 'under_review', updated_at = now()
  where id = p_cash_advance_id;

  return jsonb_build_object(
    'id', v_liquidation.id,
    'cash_advance_id', v_liquidation.cash_advance_id,
    'total_spent_centavos', v_liquidation.total_spent_centavos,
    'total_returned_centavos', v_liquidation.total_returned_centavos,
    'outstanding_balance_centavos', v_liquidation.outstanding_balance_centavos,
    'status', v_liquidation.status
  );
end;
$$;

-- Atomic Liquidation Review (Approve / Reject)
create or replace function public.review_liquidation(
  p_org_id uuid,
  p_liquidation_id uuid,
  p_decision text, -- 'approved', 'rejected'
  p_notes text default null
)
returns jsonb language plpgsql security definer as $$
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
  where id = p_liquidation_id and organization_id = p_org_id;

  if not found then
    raise exception 'Liquidation record not found.';
  end if;

  select * into v_advance
  from public.cash_advances
  where id = v_liquidation.cash_advance_id;

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

-- Grant execution to authenticated users
grant execute on function public.create_cash_advance(uuid, uuid, text, text, bigint, text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.submit_liquidation(uuid, uuid, bigint, bigint, text) to authenticated;
grant execute on function public.review_liquidation(uuid, uuid, text, text) to authenticated;
