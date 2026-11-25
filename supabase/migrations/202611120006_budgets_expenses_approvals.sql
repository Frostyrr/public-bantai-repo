-- Migration: 202611120006_budgets_expenses_approvals.sql
-- Description: Core Phase 5 schema for Budgets, Expenses, Spending Limits, and Multi-Role Approvals.

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  reporting_period_id uuid references public.reporting_periods(id) on delete set null,
  name text not null check (char_length(trim(name)) > 0 and char_length(name) <= 150),
  description text check (char_length(description) <= 1000),
  currency char(3) not null default 'PHP',
  allocated_amount_centavos bigint not null check (allocated_amount_centavos >= 0),
  status text not null default 'active' check (status in ('active', 'closed', 'archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_budgets_org on public.budgets(organization_id);
create index if not exists idx_budgets_space on public.budgets(space_id);
create index if not exists idx_budgets_period on public.budgets(reporting_period_id);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  budget_id uuid references public.budgets(id) on delete set null,
  space_id uuid references public.spaces(id) on delete set null,
  reporting_period_id uuid references public.reporting_periods(id) on delete set null,
  title text not null check (char_length(trim(title)) > 0 and char_length(title) <= 150),
  description text check (char_length(description) <= 1000),
  category text not null check (category in ('operational', 'supplies', 'events', 'travel', 'food', 'equipment', 'services', 'other')),
  amount_centavos bigint not null check (amount_centavos > 0),
  currency char(3) not null default 'PHP',
  incurred_date date not null,
  receipt_url text check (char_length(receipt_url) <= 1000),
  vendor_name text check (char_length(vendor_name) <= 150),
  submitted_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'verified', 'approved', 'rejected', 'cancelled')),
  review_notes text check (char_length(review_notes) <= 1000),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expenses_org on public.expenses(organization_id);
create index if not exists idx_expenses_budget on public.expenses(budget_id);
create index if not exists idx_expenses_space on public.expenses(space_id);
create index if not exists idx_expenses_period on public.expenses(reporting_period_id);
create index if not exists idx_expenses_status on public.expenses(organization_id, status);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('expense', 'liquidation', 'budget')),
  entity_id uuid not null,
  decision text not null check (decision in ('verified', 'approved', 'rejected')),
  notes text check (char_length(notes) <= 1000),
  officer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_approvals_org on public.approvals(organization_id);
create index if not exists idx_approvals_entity on public.approvals(entity_type, entity_id);

-- Enable RLS
alter table public.budgets enable row level security;
alter table public.expenses enable row level security;
alter table public.approvals enable row level security;

-- Grants and permissions
revoke all on public.budgets, public.expenses, public.approvals from anon, authenticated;
grant select on public.budgets, public.expenses, public.approvals to authenticated;

-- Read policies
create policy budgets_org_read on public.budgets
  for select to authenticated
  using (public.is_active_org_member(organization_id, (select auth.uid())));

create policy expenses_org_read on public.expenses
  for select to authenticated
  using (public.is_active_org_member(organization_id, (select auth.uid())));

create policy approvals_org_read on public.approvals
  for select to authenticated
  using (public.is_active_org_member(organization_id, (select auth.uid())));

-- Audit triggers
create trigger budgets_audit
  after insert or update or delete on public.budgets
  for each row execute function public.audit_record_change();

create trigger expenses_audit
  after insert or update or delete on public.expenses
  for each row execute function public.audit_record_change();

create trigger approvals_audit
  after insert or update or delete on public.approvals
  for each row execute function public.audit_record_change();

-- Atomic Budget Creation
create or replace function public.create_budget(
  p_org_id uuid,
  p_name text,
  p_allocated_centavos bigint,
  p_description text default null,
  p_space_id uuid default null,
  p_period_id uuid default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_org_currency char(3);
  v_budget public.budgets;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to create budgets for this organization.';
  end if;

  if p_allocated_centavos < 0 then
    raise exception 'Allocated budget amount must be non-negative.';
  end if;

  select currency into v_org_currency from public.organizations where id = p_org_id;
  if v_org_currency is null then
    v_org_currency := 'PHP';
  end if;

  insert into public.budgets (
    organization_id,
    space_id,
    reporting_period_id,
    name,
    description,
    currency,
    allocated_amount_centavos,
    created_by
  ) values (
    p_org_id,
    p_space_id,
    p_period_id,
    trim(p_name),
    p_description,
    v_org_currency,
    p_allocated_centavos,
    v_caller
  ) returning * into v_budget;

  return jsonb_build_object(
    'id', v_budget.id,
    'organization_id', v_budget.organization_id,
    'name', v_budget.name,
    'description', v_budget.description,
    'currency', v_budget.currency,
    'allocated_amount_centavos', v_budget.allocated_amount_centavos,
    'status', v_budget.status,
    'created_at', v_budget.created_at
  );
end;
$$;

-- Atomic Expense Submission
create or replace function public.submit_expense(
  p_org_id uuid,
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
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_org_currency char(3);
  v_expense public.expenses;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  -- Any active member can submit an expense for reimbursement/recording
  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null then
    raise exception 'Unauthorized to submit expenses for this organization.';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  if p_budget_id is not null then
    if not exists (select 1 from public.budgets where id = p_budget_id and organization_id = p_org_id and status = 'active') then
      raise exception 'Budget allocation not found or not active.';
    end if;
  end if;

  select currency into v_org_currency from public.organizations where id = p_org_id;
  if v_org_currency is null then
    v_org_currency := 'PHP';
  end if;

  insert into public.expenses (
    organization_id,
    budget_id,
    space_id,
    reporting_period_id,
    title,
    description,
    category,
    amount_centavos,
    currency,
    incurred_date,
    receipt_url,
    vendor_name,
    submitted_by,
    status
  ) values (
    p_org_id,
    p_budget_id,
    p_space_id,
    p_period_id,
    trim(p_title),
    p_description,
    p_category,
    p_amount_centavos,
    v_org_currency,
    p_incurred_date,
    p_receipt_url,
    p_vendor_name,
    v_caller,
    'pending'
  ) returning * into v_expense;

  return jsonb_build_object(
    'id', v_expense.id,
    'organization_id', v_expense.organization_id,
    'budget_id', v_expense.budget_id,
    'title', v_expense.title,
    'amount_centavos', v_expense.amount_centavos,
    'category', v_expense.category,
    'status', v_expense.status,
    'created_at', v_expense.created_at
  );
end;
$$;

-- Atomic Expense Review (Verify / Approve / Reject) with Budget Cap Enforcement
create or replace function public.review_expense(
  p_org_id uuid,
  p_expense_id uuid,
  p_decision text, -- 'verified', 'approved', 'rejected'
  p_notes text default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_expense public.expenses;
  v_allocated bigint;
  v_already_spent bigint;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer', 'auditor') then
    raise exception 'Unauthorized to review expenses.';
  end if;

  if p_decision not in ('verified', 'approved', 'rejected') then
    raise exception 'Invalid review decision.';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id and organization_id = p_org_id;

  if not found then
    raise exception 'Expense record not found in this organization.';
  end if;

  if v_expense.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'Expense has already reached a terminal review status.';
  end if;

  -- If approving, verify against allocated budget cap if linked
  if p_decision = 'approved' and v_expense.budget_id is not null then
    select allocated_amount_centavos into v_allocated
    from public.budgets
    where id = v_expense.budget_id;

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
      status = 'approved',
      approved_by = v_caller,
      approved_at = now(),
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
    officer_id
  ) values (
    p_org_id,
    'expense',
    p_expense_id,
    p_decision,
    p_notes,
    v_caller
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

-- Grant execution to authenticated users
grant execute on function public.create_budget(uuid, text, bigint, text, uuid, uuid) to authenticated;
grant execute on function public.submit_expense(uuid, text, bigint, text, date, text, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.review_expense(uuid, uuid, text, text) to authenticated;
