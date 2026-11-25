begin;

-- =============================================================================
-- Migration 042: Post-Recovery Schema/RPC Parity, Internal RPC Lockdown,
-- and Server-Only Security-Enforcement Writes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Restore missing columns, tables, and RLS policies on post-recovery DBs
-- -----------------------------------------------------------------------------
alter table public.ai_conversations
  add column if not exists access_role text;

drop policy if exists bani_current_role_scope on public.ai_conversations;
create policy bani_current_role_scope on public.ai_conversations
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = ai_conversations.organization_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
      and m.role = ai_conversations.access_role
  ))
  with check (exists (
    select 1 from public.organization_members m
    where m.organization_id = ai_conversations.organization_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
      and m.role = ai_conversations.access_role
  ));

drop policy if exists expense_member_workflow_scope on public.expenses;
create policy expense_member_workflow_scope on public.expenses
  as restrictive for select to authenticated
  using (
    status = 'approved' or submitted_by = auth.uid() or exists (
      select 1 from public.organization_members m
      where m.organization_id = expenses.organization_id
        and m.profile_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'organization_admin', 'treasurer', 'auditor')
    )
  );

create table if not exists public.published_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  currency text not null,
  collected_centavos numeric not null,
  recognized_spending_centavos numeric not null,
  reserve_centavos numeric not null,
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles(id)
);
alter table public.published_financial_snapshots
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references public.profiles(id);
alter table public.published_financial_snapshots enable row level security;
revoke all on public.published_financial_snapshots from public, anon, authenticated;

alter table public.expense_evidence
  add column if not exists storage_path text,
  add column if not exists storage_sha256 text,
  add column if not exists storage_verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expense_evidence'::regclass
      and conname = 'expense_evidence_storage_path_key'
  ) then
    alter table public.expense_evidence
      add constraint expense_evidence_storage_path_key unique (storage_path);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expense_evidence'::regclass
      and conname = 'verified_storage_metadata'
  ) then
    alter table public.expense_evidence
      add constraint verified_storage_metadata check (
        (storage_path is null and storage_sha256 is null and storage_verified_at is null)
        or (
          storage_path is not null
          and storage_sha256 is not null
          and storage_sha256 ~ '^[0-9a-f]{64}$'
          and storage_verified_at is not null
        )
      );
  end if;
end;
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values (
      'expense-evidence',
      'expense-evidence',
      false,
      1048576,
      array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    )
    on conflict (id) do nothing;

    if not exists (
      select 1 from storage.policies where name = 'expense_evidence_no_client_access'
    ) and not exists (
      select 1 from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'expense_evidence_no_client_access'
    ) then
      execute $policy$
        create policy expense_evidence_no_client_access on storage.objects
        as restrictive for all to anon, authenticated
        using (bucket_id <> 'expense-evidence')
        with check (bucket_id <> 'expense-evidence')
      $policy$;
    end if;
  end if;
exception
  when undefined_table then
    null;
end;
$$;

-- Reconcile table/view grants on internal security and accounting relations
revoke all on table
  public.enforcement_actions,
  public.rate_limit_buckets,
  public.source_restrictions
from public, anon, authenticated;

revoke all on public.advance_accounting, public.budget_accounting from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Restore missing triggers and trigger functions (from 014, 016, 029)
-- -----------------------------------------------------------------------------
create or replace function public.guard_closed_organization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source uuid;
  destination uuid;
  parent record;
begin
  if tg_op <> 'INSERT' then source := old.organization_id; end if;
  if tg_op <> 'DELETE' then destination := new.organization_id; end if;
  for parent in select id, closed_at from public.organizations
    where id in (source, destination) order by id for share
  loop
    if parent.closed_at is not null then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_space_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.space_id is null then return new; end if;
  if tg_op = 'UPDATE' and (new.space_id, new.organization_id)
    is not distinct from (old.space_id, old.organization_id) then return new; end if;
  perform 1 from public.spaces
    where id = new.space_id and organization_id = new.organization_id and status = 'active'
    for share;
  if not found then
    raise exception 'Choose an active space in this organization.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_closed_organization_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.closed_at is not null then
    if tg_op = 'DELETE' then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
    if (to_jsonb(new) - array['suspended_at','suspended_by','suspension_reason'])
      is distinct from (to_jsonb(old) - array['suspended_at','suspended_by','suspension_reason']) then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_closed_indirect_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source uuid;
  destination uuid;
  parent record;
begin
  if tg_table_name = 'ai_messages' then
    if tg_op <> 'INSERT' then
      select organization_id into source from public.ai_conversations where id = old.conversation_id;
    end if;
    if tg_op <> 'DELETE' then
      select organization_id into destination from public.ai_conversations where id = new.conversation_id;
    end if;
  else
    if tg_op <> 'INSERT' then
      select organization_id into source from public.expenses where id = old.expense_id;
    end if;
    if tg_op <> 'DELETE' then
      select organization_id into destination from public.expenses where id = new.expense_id;
    end if;
  end if;
  if tg_table_name = 'expense_evidence' and tg_op = 'UPDATE' then
    if old.storage_verified_at is null and new.storage_verified_at is not null
      and (to_jsonb(old) - array['storage_path','storage_sha256','storage_verified_at'])
        = (to_jsonb(new) - array['storage_path','storage_sha256','storage_verified_at'])
      and new.storage_path = source::text || '/' || old.expense_id::text || '/' || old.id::text
      and new.storage_sha256 = encode(sha256(old.content), 'hex') then
      return new;
    end if;
  end if;
  for parent in select closed_at from public.organizations
    where id in (source, destination) order by id for share
  loop
    if parent.closed_at is not null then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_bani_conversation_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select m.role into new.access_role from public.organization_members m
      where m.organization_id = new.organization_id
        and m.profile_id = new.created_by
        and m.status = 'active';
  elsif (old.organization_id, old.created_by, old.access_role)
      is distinct from (new.organization_id, new.created_by, new.access_role) then
    raise exception 'Conversation authorization cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.reject_new_external_receipt()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.receipt_url is null then new.receipt_url := old.receipt_url; end if;
    if new.receipt_url is not distinct from old.receipt_url then return new; end if;
  end if;
  if new.receipt_url is not null then
    raise exception 'Attach a receipt file instead of adding an external link.' using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare
  target text;
begin
  foreach target in array array['collections','budgets','expenses','cash_advances'] loop
    execute format('drop trigger if exists active_space_assignment on public.%I', target);
    execute format(
      'create trigger active_space_assignment before insert or update of space_id, organization_id on public.%I for each row execute function public.guard_space_assignment()',
      target
    );
  end loop;

  foreach target in array array[
    'approvals','budget_amendments','collection_assessment_failures','collection_assessment_requests',
    'collection_scope_groups','collection_scope_members','directory_import_batches','expense_submission_requests',
    'liquidation_expense_allocations','liquidation_reconciliations','liquidation_resolution_entries',
    'organization_invitations','receipt_counters'
  ] loop
    execute format('drop trigger if exists closed_organization_guard on public.%I', target);
    execute format(
      'create trigger closed_organization_guard before insert or update or delete on public.%I for each row execute function public.guard_closed_organization()',
      target
    );
  end loop;
end;
$$;

drop trigger if exists closed_organization_record on public.organizations;
create trigger closed_organization_record before update or delete on public.organizations
  for each row execute function public.guard_closed_organization_record();

drop trigger if exists closed_conversation_message on public.ai_messages;
create trigger closed_conversation_message before insert or update or delete on public.ai_messages
  for each row execute function public.guard_closed_indirect_record();

drop trigger if exists closed_expense_evidence on public.expense_evidence;
create trigger closed_expense_evidence before insert or update or delete on public.expense_evidence
  for each row execute function public.guard_closed_indirect_record();

drop trigger if exists bani_conversation_scope on public.ai_conversations;
create trigger bani_conversation_scope before insert or update on public.ai_conversations
  for each row execute function public.guard_bani_conversation_scope();

drop trigger if exists preserve_legacy_receipt_reference on public.expenses;
create trigger preserve_legacy_receipt_reference before insert or update of receipt_url on public.expenses
  for each row execute function public.reject_new_external_receipt();

-- -----------------------------------------------------------------------------
-- 3. Restore missing application & internal RPCs (from 013, 019, 020, 025, 029)
-- -----------------------------------------------------------------------------
create or replace function public.leave_organization(
  p_org_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_member_id uuid;
  v_role text;
  v_other_owners int;
  v_unliquidated_advances int;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select id, role into v_member_id, v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_member_id is null then
    raise exception 'You are not an active member of this organization.';
  end if;

  if v_role = 'owner' then
    select count(*) into v_other_owners
    from public.organization_members
    where organization_id = p_org_id and role = 'owner' and status = 'active' and profile_id != v_caller;

    if v_other_owners = 0 then
      raise exception 'Cannot leave organization as the sole owner. Transfer ownership or close the organization first.';
    end if;
  end if;

  select count(*) into v_unliquidated_advances
  from public.cash_advances
  where accountable_person_id = v_member_id
    and status in ('outstanding', 'under_review', 'disputed');

  if v_unliquidated_advances > 0 then
    raise exception 'Cannot leave organization with unliquidated cash advances. Please liquidate or return advances first.';
  end if;

  update public.organization_members
  set status = 'left'
  where id = v_member_id;

  update public.user_preferences
  set default_organization_id = null
  where user_id = v_caller and default_organization_id = p_org_id;

  insert into public.audit_logs (
    organization_id, actor_id, database_actor, action, entity_id, before_value, after_value
  ) values (
    p_org_id, v_caller, session_user, 'leave_organization', v_member_id,
    jsonb_build_object('role', v_role, 'status', 'active'),
    jsonb_build_object('role', v_role, 'status', 'left')
  );

  return jsonb_build_object('success', true, 'organization_id', p_org_id);
end;
$$;

create or replace function public.delete_personal_account()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_sole_owner_orgs text[];
  v_unliquidated_advances int;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select array_agg(o.name) into v_sole_owner_orgs
  from public.organization_members m1
  join public.organizations o on o.id = m1.organization_id
  where m1.profile_id = v_caller
    and m1.role = 'owner'
    and m1.status = 'active'
    and not exists (
      select 1 from public.organization_members m2
      where m2.organization_id = m1.organization_id
        and m2.role = 'owner'
        and m2.status = 'active'
        and m2.profile_id != v_caller
    );

  if v_sole_owner_orgs is not null and array_length(v_sole_owner_orgs, 1) > 0 then
    raise exception 'Cannot delete account while you are the sole owner of: %. Please transfer ownership or close these organizations first.', array_to_string(v_sole_owner_orgs, ', ');
  end if;

  select count(*) into v_unliquidated_advances
  from public.cash_advances ca
  join public.organization_members om on ca.accountable_person_id = om.id
  where om.profile_id = v_caller
    and ca.status in ('outstanding', 'under_review', 'disputed');

  if v_unliquidated_advances > 0 then
    raise exception 'Cannot delete account with unliquidated cash advances. Please liquidate all advances first.';
  end if;

  update public.organization_members
  set status = 'left'
  where profile_id = v_caller and status = 'active';

  delete from public.user_preferences
  where user_id = v_caller;

  update public.profiles
  set display_name = 'Former Member',
      avatar_url = null
  where id = v_caller;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.member_expense_transactions(org uuid)
returns table(id uuid, incurred_date date, amount_centavos bigint, category text, status text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.incurred_date, e.amount_centavos, e.category::text, e.status::text
  from public.expenses e
  where e.organization_id = org
    and e.status = 'approved'
    and public.is_active_org_member(org, auth.uid())
$$;

create or replace function public.member_advance_transactions(org uuid)
returns table(
  id uuid,
  released_at timestamptz,
  amount_centavos bigint,
  status text,
  approved_spending_centavos bigint,
  cash_returned_centavos bigint
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.released_at, a.amount_released_centavos, 'liquidated'::text, v.spent::bigint, v.returned::bigint
  from public.cash_advances a
  join public.advance_accounting v on v.id = a.id and v.organization_id = a.organization_id
  where a.organization_id = org
    and a.status = 'liquidated'
    and public.is_active_org_member(org, auth.uid())
$$;

create or replace function public.member_ledger_totals(org uuid)
returns table(
  collected_centavos numeric,
  recognized_spending_centavos numeric,
  reserve_centavos numeric,
  unsettled_advances_centavos numeric,
  provisional boolean
)
language sql stable security definer set search_path = '' as $$
  select
    c.total,
    e.total - a.overlap + a.spent,
    c.total - e.total + a.overlap - a.released + a.returned,
    a.unsettled,
    a.provisional
  from (
    select coalesce(sum(total_collected_centavos::numeric), 0) total
    from public.collection_financial_totals(org, null)
  ) c
  cross join (
    select coalesce(sum(amount_centavos), 0) total
    from public.expenses where organization_id = org and status = 'approved'
  ) e
  cross join (
    select
      coalesce(sum(overlap), 0) overlap,
      coalesce(sum(spent), 0) spent,
      coalesce(sum(released), 0) released,
      coalesce(sum(returned), 0) returned,
      coalesce(sum(unsettled), 0) unsettled,
      coalesce(bool_or(provisional), false) provisional
    from public.advance_accounting where organization_id = org
  ) a
  where public.is_active_org_member(org, auth.uid())
$$;

create or replace function public.publish_financial_snapshot(org uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  snapshot_id uuid;
  org_currency text;
  totals record;
begin
  select currency into org_currency from public.organizations
    where id = org and closed_at is null and suspended_at is null for share;
  if not found then raise exception 'Workspace unavailable.' using errcode = '42501'; end if;
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'Owner approval required.' using errcode = '42501';
  end if;
  perform 1 from public.organization_members
    where organization_id = org and profile_id = auth.uid() and status = 'active' and role = 'owner' for share;
  if not found then raise exception 'Owner approval required.' using errcode = '42501'; end if;
  select * into strict totals from public.member_ledger_totals(org);
  if totals.provisional then
    raise exception 'Resolve provisional accounting before publication.' using errcode = '23514';
  end if;
  insert into public.published_financial_snapshots(
    organization_id, approved_by, currency,
    collected_centavos, recognized_spending_centavos, reserve_centavos
  )
  values (
    org, auth.uid(), org_currency,
    totals.collected_centavos, totals.recognized_spending_centavos, totals.reserve_centavos
  )
  returning id into snapshot_id;
  return snapshot_id;
end;
$$;

create or replace function public.read_published_financial_snapshot(snapshot uuid)
returns table(
  approved_at timestamptz,
  currency text,
  collected_centavos numeric,
  recognized_spending_centavos numeric,
  reserve_centavos numeric
)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform set_config('response.headers', '[{"Cache-Control":"no-store"}]', true);
  return query
  select s.approved_at, s.currency, s.collected_centavos, s.recognized_spending_centavos, s.reserve_centavos
  from public.published_financial_snapshots s
  where s.id = snapshot and s.withdrawn_at is null;
end;
$$;

create or replace function public.revoke_workspace_history(org uuid, subject uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.workspace_history_entitlements e
    join public.organizations o on o.id = e.organization_id
    join public.profiles p on p.id = e.profile_id
    where e.organization_id = org
      and e.profile_id = auth.uid()
      and e.closure_role = 'owner'
      and o.closed_at is not null
      and o.suspended_at is null
      and p.suspended_at is null
      and not exists (
        select 1 from public.workspace_history_revocations r
        where r.organization_id = org and r.profile_id = e.profile_id
      )
  ) then
    raise exception 'Historical access administration is unavailable.' using errcode = '42501';
  end if;
  insert into public.workspace_history_revocations(organization_id, profile_id, revoked_by)
    select org, subject, auth.uid()
    from public.workspace_history_entitlements
    where organization_id = org and profile_id = subject
    on conflict do nothing;
  return found;
end;
$$;

create or replace function public.pending_expense_storage_copies(batch_size integer default 20)
returns table(id uuid, object_path text, mime text, data text, sha256 text)
language sql stable security definer set search_path = '' as $$
  select
    a.id,
    e.organization_id::text || '/' || e.id::text || '/' || a.id::text,
    a.mime,
    encode(a.content, 'base64'),
    encode(sha256(a.content), 'hex')
  from public.expense_evidence a
  join public.expenses e on e.id = a.expense_id
  where a.storage_verified_at is null
  order by a.id
  limit least(greatest(coalesce(batch_size, 20), 1), 100)
$$;

create or replace function public.confirm_expense_storage_copy(
  attachment uuid,
  expected_path text,
  expected_hash text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.expense_evidence a
  set storage_path = expected_path,
      storage_sha256 = expected_hash,
      storage_verified_at = now()
  from public.expenses e
  where e.id = a.expense_id
    and a.id = attachment
    and a.storage_verified_at is null
    and expected_path = e.organization_id::text || '/' || e.id::text || '/' || a.id::text
    and expected_hash = encode(sha256(a.content), 'hex');
  return found;
end;
$$;

create or replace function public.expense_storage_location(org uuid, expense uuid, attachment uuid)
returns table(object_path text, sha256 text)
language sql stable security definer set search_path = '' as $$
  select a.storage_path, a.storage_sha256
  from public.expense_evidence a
  join public.expenses e on e.id = a.expense_id
  where e.organization_id = org
    and e.id = expense
    and a.id = attachment
    and a.storage_verified_at is not null
    and public.is_active_org_member(org, auth.uid())
    and (e.submitted_by = auth.uid() or public.can_read_private_financial_rows(org))
$$;

-- -----------------------------------------------------------------------------
-- 4. Lock down internal-only functions, trigger functions, and security-write RPCs
-- -----------------------------------------------------------------------------

-- 4a. Internal financial, collection, org-creation, and maintenance functions:
--     No PUBLIC, anon, or authenticated EXECUTE.
revoke all on function
  public.review_expense_internal(uuid, uuid, text, text),
  public.review_expense_with_private_result(uuid, uuid, text, text, integer),
  public.review_liquidation_with_private_result(uuid, uuid, text, text),
  public.delete_collection(uuid, uuid),
  public.create_organization_with_owner(text, text),
  public.lock_liquidation_accounting(uuid, uuid),
  public.cleanup_directory_import_reports(),
  public.pending_expense_storage_copies(integer),
  public.confirm_expense_storage_copy(uuid, text, text)
from public, anon, authenticated;

-- 4b. Security-enforcement write RPCs: revoke from PUBLIC, anon, authenticated;
--     grant exclusively to service_role (server-only Express middleware).
revoke all on function
  public.consume_rate_limit(text, integer, integer),
  public.record_edge_security_event(text, text, text, text, text, integer, text, text, jsonb)
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.cleanup_directory_import_reports(),
      public.pending_expense_storage_copies(integer),
      public.confirm_expense_storage_copy(uuid, text, text),
      public.consume_rate_limit(text, integer, integer),
      public.record_edge_security_event(text, text, text, text, text, integer, text, text, jsonb)
    to service_role;
  end if;
end;
$$;

-- 4c. Revoke PUBLIC and anon from all trigger functions in public
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn.sig);
  end loop;
end;
$$;

-- 4d. Ensure authenticated-only RPCs (including those restored or recreated in 041/042)
--     do not retain PUBLIC or anon EXECUTE grants.
revoke all on function
  public.leave_organization(uuid),
  public.delete_personal_account(),
  public.member_expense_transactions(uuid),
  public.member_advance_transactions(uuid),
  public.member_ledger_totals(uuid),
  public.publish_financial_snapshot(uuid),
  public.withdraw_financial_snapshot(uuid, uuid),
  public.revoke_workspace_history(uuid, uuid),
  public.expense_storage_location(uuid, uuid, uuid),
  public.mark_all_notifications_read(uuid)
from public, anon;

grant execute on function
  public.leave_organization(uuid),
  public.delete_personal_account(),
  public.member_expense_transactions(uuid),
  public.member_advance_transactions(uuid),
  public.member_ledger_totals(uuid),
  public.publish_financial_snapshot(uuid),
  public.withdraw_financial_snapshot(uuid, uuid),
  public.revoke_workspace_history(uuid, uuid),
  public.expense_storage_location(uuid, uuid, uuid),
  public.mark_all_notifications_read(uuid)
to authenticated;

-- 4e. Explicitly preserve the two intended anon-callable read/check RPCs:
revoke all on function
  public.check_source_restriction(text),
  public.read_published_financial_snapshot(uuid)
from public;

grant execute on function
  public.check_source_restriction(text),
  public.read_published_financial_snapshot(uuid)
to anon, authenticated;

commit;
