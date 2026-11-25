-- Migration: 202611120005_collections_and_payments.sql
-- Description: Core Phase 4 schema for Collections, Member Obligations, Payments, Sequential Receipts, and Reversals.

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  reporting_period_id uuid references public.reporting_periods(id) on delete set null,
  title text not null check (char_length(trim(title)) > 0 and char_length(title) <= 150),
  description text check (char_length(description) <= 1000),
  currency char(3) not null default 'PHP',
  target_amount_centavos bigint not null default 0 check (target_amount_centavos >= 0),
  due_date date,
  status text not null default 'active' check (status in ('active', 'closed', 'archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_collections_org on public.collections(organization_id);
create index if not exists idx_collections_space on public.collections(space_id);
create index if not exists idx_collections_period on public.collections(reporting_period_id);

create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  member_id uuid not null references public.organization_members(id) on delete cascade,
  amount_centavos bigint not null check (amount_centavos >= 0),
  status text not null default 'pending' check (status in ('pending', 'partially_paid', 'paid', 'waived')),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, member_id)
);

create index if not exists idx_obligations_org on public.obligations(organization_id);
create index if not exists idx_obligations_collection on public.obligations(collection_id);
create index if not exists idx_obligations_member on public.obligations(member_id);

create table if not exists public.receipt_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fiscal_year int not null,
  last_number int not null default 0,
  primary key (organization_id, fiscal_year)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  obligation_id uuid not null references public.obligations(id) on delete cascade,
  amount_centavos bigint not null check (amount_centavos > 0),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'gcash', 'maya', 'other')),
  reference_number text check (char_length(reference_number) <= 100),
  receipt_number text not null,
  idempotency_key text not null,
  status text not null default 'completed' check (status in ('completed', 'reversed')),
  reversal_reason text check (char_length(reversal_reason) <= 500),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  recorded_by uuid not null references auth.users(id),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index if not exists idx_payments_org on public.payments(organization_id);
create index if not exists idx_payments_collection on public.payments(collection_id);
create index if not exists idx_payments_obligation on public.payments(obligation_id);
create index if not exists idx_payments_receipt on public.payments(organization_id, receipt_number);

-- Enable RLS
alter table public.collections enable row level security;
alter table public.obligations enable row level security;
alter table public.payments enable row level security;
alter table public.receipt_counters enable row level security;

-- Grants and permissions
revoke all on public.collections, public.obligations, public.payments, public.receipt_counters from anon, authenticated;
grant select on public.collections, public.obligations, public.payments to authenticated;

-- Read policies
create policy collections_org_read on public.collections
  for select to authenticated
  using (public.is_active_org_member(organization_id, (select auth.uid())));

create policy obligations_org_read on public.obligations
  for select to authenticated
  using (public.is_active_org_member(organization_id, (select auth.uid())));

create policy payments_org_read on public.payments
  for select to authenticated
  using (public.is_active_org_member(organization_id, (select auth.uid())));

-- Audit triggers
create trigger collections_audit
  after insert or update or delete on public.collections
  for each row execute function public.audit_record_change();

create trigger obligations_audit
  after insert or update or delete on public.obligations
  for each row execute function public.audit_record_change();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_record_change();

-- Sequential Receipt Number Generator
create or replace function public.generate_receipt_number(p_org_id uuid)
returns text language plpgsql security definer as $$
declare
  v_year int := extract(year from current_date);
  v_seq int;
begin
  insert into public.receipt_counters (organization_id, fiscal_year, last_number)
  values (p_org_id, v_year, 1)
  on conflict (organization_id, fiscal_year)
  do update set last_number = public.receipt_counters.last_number + 1
  returning last_number into v_seq;

  return 'RCP-' || v_year::text || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- Obligation status recalculation trigger
create or replace function public.recalculate_obligation_status()
returns trigger language plpgsql security definer as $$
declare
  v_target_id uuid;
  v_obligation_amount bigint;
  v_current_status text;
  v_total_paid bigint;
begin
  v_target_id := coalesce(new.obligation_id, old.obligation_id);

  select amount_centavos, status into v_obligation_amount, v_current_status
  from public.obligations
  where id = v_target_id;

  if not found or v_current_status = 'waived' then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount_centavos), 0) into v_total_paid
  from public.payments
  where obligation_id = v_target_id and status = 'completed';

  if v_total_paid >= v_obligation_amount and v_obligation_amount > 0 then
    update public.obligations set status = 'paid', updated_at = now() where id = v_target_id;
  elsif v_total_paid > 0 then
    update public.obligations set status = 'partially_paid', updated_at = now() where id = v_target_id;
  else
    update public.obligations set status = 'pending', updated_at = now() where id = v_target_id;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trigger_payment_obligation_status
  after insert or update of amount_centavos, status on public.payments
  for each row execute function public.recalculate_obligation_status();

-- Atomic Collection Creation with optional batch member obligation assignment
create or replace function public.create_collection(
  p_org_id uuid,
  p_title text,
  p_description text default null,
  p_space_id uuid default null,
  p_period_id uuid default null,
  p_target_centavos bigint default 0,
  p_due_date date default null,
  p_default_obligation_centavos bigint default 0,
  p_assign_all boolean default false
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_org_currency char(3);
  v_collection public.collections;
  v_assigned_count int := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  -- Caller must be active owner, organization_admin, or treasurer
  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to create collections for this organization.';
  end if;

  select currency into v_org_currency from public.organizations where id = p_org_id;
  if v_org_currency is null then
    v_org_currency := 'PHP';
  end if;

  insert into public.collections (
    organization_id,
    space_id,
    reporting_period_id,
    title,
    description,
    currency,
    target_amount_centavos,
    due_date,
    created_by
  ) values (
    p_org_id,
    p_space_id,
    p_period_id,
    trim(p_title),
    p_description,
    v_org_currency,
    coalesce(p_target_centavos, 0),
    p_due_date,
    v_caller
  ) returning * into v_collection;

  -- Batch assign default obligation to all active members if requested
  if p_assign_all and p_default_obligation_centavos >= 0 then
    insert into public.obligations (
      organization_id,
      collection_id,
      member_id,
      amount_centavos,
      status
    )
    select
      p_org_id,
      v_collection.id,
      m.id,
      p_default_obligation_centavos,
      case when p_default_obligation_centavos = 0 then 'paid' else 'pending' end
    from public.organization_members m
    where m.organization_id = p_org_id and m.status = 'active';

    get diagnostics v_assigned_count = row_count;
  end if;

  return jsonb_build_object(
    'id', v_collection.id,
    'organization_id', v_collection.organization_id,
    'space_id', v_collection.space_id,
    'reporting_period_id', v_collection.reporting_period_id,
    'title', v_collection.title,
    'description', v_collection.description,
    'currency', v_collection.currency,
    'target_amount_centavos', v_collection.target_amount_centavos,
    'due_date', v_collection.due_date,
    'status', v_collection.status,
    'created_at', v_collection.created_at,
    'assigned_obligations_count', v_assigned_count
  );
end;
$$;

-- Atomic Single Obligation Assignment
create or replace function public.assign_member_obligation(
  p_org_id uuid,
  p_collection_id uuid,
  p_member_id uuid,
  p_amount_centavos bigint,
  p_notes text default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_obligation public.obligations;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to assign obligations.';
  end if;

  -- Verify collection belongs to this org
  if not exists (select 1 from public.collections where id = p_collection_id and organization_id = p_org_id) then
    raise exception 'Collection not found in this organization.';
  end if;

  -- Verify member belongs to this org
  if not exists (select 1 from public.organization_members where id = p_member_id and organization_id = p_org_id) then
    raise exception 'Member not found in this organization.';
  end if;

  insert into public.obligations (
    organization_id,
    collection_id,
    member_id,
    amount_centavos,
    notes,
    status
  ) values (
    p_org_id,
    p_collection_id,
    p_member_id,
    p_amount_centavos,
    p_notes,
    case when p_amount_centavos = 0 then 'paid' else 'pending' end
  )
  on conflict (collection_id, member_id)
  do update set
    amount_centavos = excluded.amount_centavos,
    notes = coalesce(excluded.notes, public.obligations.notes),
    updated_at = now()
  returning * into v_obligation;

  return jsonb_build_object(
    'id', v_obligation.id,
    'collection_id', v_obligation.collection_id,
    'member_id', v_obligation.member_id,
    'amount_centavos', v_obligation.amount_centavos,
    'status', v_obligation.status,
    'notes', v_obligation.notes
  );
end;
$$;

-- Atomic Payment Recording with Receipt Generation and Idempotency
create or replace function public.record_payment(
  p_org_id uuid,
  p_obligation_id uuid,
  p_amount_centavos bigint,
  p_payment_method text,
  p_reference_number text default null,
  p_idempotency_key text default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_obligation record;
  v_existing public.payments;
  v_receipt_no text;
  v_payment public.payments;
  v_key text;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to record payments.';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  v_key := coalesce(nullif(trim(p_idempotency_key), ''), gen_random_uuid()::text);

  -- Check idempotency
  select * into v_existing
  from public.payments
  where organization_id = p_org_id and idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'obligation_id', v_existing.obligation_id,
      'collection_id', v_existing.collection_id,
      'amount_centavos', v_existing.amount_centavos,
      'payment_method', v_existing.payment_method,
      'reference_number', v_existing.reference_number,
      'receipt_number', v_existing.receipt_number,
      'idempotency_key', v_existing.idempotency_key,
      'status', v_existing.status,
      'paid_at', v_existing.paid_at,
      'is_duplicate_replay', true
    );
  end if;

  -- Validate obligation belongs to this org
  select o.id, o.collection_id, o.amount_centavos, o.status
  into v_obligation
  from public.obligations o
  where o.id = p_obligation_id and o.organization_id = p_org_id;

  if not found then
    raise exception 'Obligation not found in this organization.';
  end if;

  -- Generate sequential receipt number
  v_receipt_no := public.generate_receipt_number(p_org_id);

  insert into public.payments (
    organization_id,
    collection_id,
    obligation_id,
    amount_centavos,
    payment_method,
    reference_number,
    receipt_number,
    idempotency_key,
    recorded_by,
    paid_at
  ) values (
    p_org_id,
    v_obligation.collection_id,
    v_obligation.id,
    p_amount_centavos,
    p_payment_method,
    p_reference_number,
    v_receipt_no,
    v_key,
    v_caller,
    now()
  ) returning * into v_payment;

  return jsonb_build_object(
    'id', v_payment.id,
    'obligation_id', v_payment.obligation_id,
    'collection_id', v_payment.collection_id,
    'amount_centavos', v_payment.amount_centavos,
    'payment_method', v_payment.payment_method,
    'reference_number', v_payment.reference_number,
    'receipt_number', v_payment.receipt_number,
    'idempotency_key', v_payment.idempotency_key,
    'status', v_payment.status,
    'paid_at', v_payment.paid_at,
    'is_duplicate_replay', false
  );
end;
$$;

-- Atomic Payment Reversal
create or replace function public.reverse_payment(
  p_org_id uuid,
  p_payment_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_payment public.payments;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to reverse payments.';
  end if;

  if trim(p_reason) is null or char_length(trim(p_reason)) < 3 then
    raise exception 'A valid reversal reason must be provided.';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id and organization_id = p_org_id;

  if not found then
    raise exception 'Payment not found in this organization.';
  end if;

  if v_payment.status = 'reversed' then
    raise exception 'Payment is already reversed.';
  end if;

  update public.payments
  set
    status = 'reversed',
    reversal_reason = trim(p_reason),
    reversed_at = now(),
    reversed_by = v_caller
  where id = p_payment_id
  returning * into v_payment;

  return jsonb_build_object(
    'id', v_payment.id,
    'receipt_number', v_payment.receipt_number,
    'status', v_payment.status,
    'reversal_reason', v_payment.reversal_reason,
    'reversed_at', v_payment.reversed_at
  );
end;
$$;

-- Grant execution to authenticated users
revoke all on function public.generate_receipt_number(uuid) from public, anon, authenticated;
grant execute on function public.create_collection(uuid, text, text, uuid, uuid, bigint, date, bigint, boolean) to authenticated;
grant execute on function public.assign_member_obligation(uuid, uuid, uuid, bigint, text) to authenticated;
grant execute on function public.record_payment(uuid, uuid, bigint, text, text, text) to authenticated;
grant execute on function public.reverse_payment(uuid, uuid, text) to authenticated;

