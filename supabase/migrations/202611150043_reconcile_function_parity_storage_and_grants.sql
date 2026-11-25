begin;

-- =============================================================================
-- Migration 043: Reconcile Function Definition Parity, Hardened
-- reconcile_collection_assessment, Internal RPC Lockdown, and Storage Init
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Reconcile the 10 divergent function definitions with fresh_db (026-038)
-- -----------------------------------------------------------------------------
create or replace function public.lock_liquidation_accounting(org uuid, settlement uuid)
 returns public.liquidations
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare record public.liquidations;
begin
  if not public.is_active_org_member(org,auth.uid()) or not exists (select 1 from public.organization_members where organization_id=org
    and profile_id=auth.uid() and status='active' and role in ('owner','organization_admin')) then
    raise exception 'Owner or admin authorization required.' using errcode='42501';
  end if;
  select * into record from public.liquidations where id=settlement and organization_id=org for update;
  if not found or record.status <> 'approved' then
    raise exception 'An approved liquidation in this organization is required.' using errcode='23514';
  end if;
  perform 1 from public.organizations where id=org and closed_at is null for share;
  if not found then raise exception 'This organization is closed.' using errcode='23514'; end if;
  return record;
end $function$;

create or replace function public.read_expense_evidence(org uuid, expense uuid, attachment uuid default null::uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = ''
as $function$
begin
 if not public.is_active_org_member(org,auth.uid()) or not exists(select 1 from public.expenses e join public.organization_members m on m.organization_id=e.organization_id
  where e.id=expense and e.organization_id=org and m.profile_id=auth.uid() and m.status='active'
  and (e.submitted_by=auth.uid() or m.role in ('owner','treasurer'))) then
  raise exception 'Expense evidence is unavailable.' using errcode='42501';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.filename,'mime',a.mime)
  || case when attachment is null then '{}'::jsonb else jsonb_build_object('data',encode(a.content,'base64')) end order by a.id),'[]')
  from public.expense_evidence a where a.expense_id=expense and (attachment is null or a.id=attachment));
end;
$function$;

create or replace function public.record_ai_usage_log(p_organization_id uuid, p_conversation_id uuid default null::uuid, p_model text default 'unknown'::text, p_prompt_tokens integer default 0, p_completion_tokens integer default 0, p_total_tokens integer default 0, p_latency_ms integer default 0, p_tool_calls_count integer default 0, p_status text default 'success'::text, p_error_code text default null::text, p_request_id text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_request_id text := left(nullif(trim(coalesce(p_request_id, '')), ''), 120);
  v_status text := case
    when p_status in ('success', 'error', 'aborted', 'rate_limited') then p_status
    else 'error'
  end;
begin
  if v_user_id is null then
    return null;
  end if;

  if not public.is_active_org_member(p_organization_id, v_user_id) then
    return null;
  end if;

  if p_conversation_id is not null and not exists (
    select 1
    from public.ai_conversations c
    join public.organization_members om
      on om.organization_id = c.organization_id and om.profile_id = v_user_id
    where c.id = p_conversation_id
      and c.organization_id = p_organization_id
      and c.created_by = v_user_id
      and om.status = 'active'
      and om.role = c.access_role
  ) then
    return null;
  end if;

  if v_request_id is not null then
    select id into v_id
    from public.ai_usage_logs
    where request_id = v_request_id
      and organization_id = p_organization_id
      and user_id = v_user_id
      and conversation_id is not distinct from p_conversation_id
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.ai_usage_logs (
    organization_id,
    user_id,
    conversation_id,
    model,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    latency_ms,
    tool_calls_count,
    status,
    error_code,
    request_id
  ) values (
    p_organization_id,
    v_user_id,
    p_conversation_id,
    left(coalesce(nullif(trim(p_model), ''), 'unknown'), 120),
    greatest(0, coalesce(p_prompt_tokens, 0)),
    greatest(0, coalesce(p_completion_tokens, 0)),
    greatest(0, coalesce(p_total_tokens, greatest(0, coalesce(p_prompt_tokens, 0)) + greatest(0, coalesce(p_completion_tokens, 0)))),
    greatest(0, coalesce(p_latency_ms, 0)),
    greatest(0, coalesce(p_tool_calls_count, 0)),
    v_status,
    left(nullif(trim(coalesce(p_error_code, '')), ''), 120),
    v_request_id
  )
  on conflict (request_id) where request_id is not null do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.record_payment(p_org_id uuid, p_obligation_id uuid, p_amount_centavos bigint, p_payment_method text, p_reference_number text default null::text, p_idempotency_key text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_obligation record;
  v_existing public.payments;
  v_receipt_no text;
  v_payment public.payments;
  v_key text;
begin
  if not public.is_active_org_member(p_org_id, v_caller) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;

  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  v_key := coalesce(nullif(trim(p_idempotency_key), ''), gen_random_uuid()::text);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('record_payment:' || p_org_id::text || ':' || v_key, 0)
  );

  if not public.is_active_org_member(p_org_id, v_caller) then
    raise exception 'Active workspace access required.' using errcode='42501';
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

  select * into v_existing
  from public.payments
  where organization_id = p_org_id and idempotency_key = v_key;

  if found then
    if row(v_existing.obligation_id, v_existing.amount_centavos,
           v_existing.payment_method, v_existing.reference_number)
       is distinct from row(p_obligation_id, p_amount_centavos,
                            p_payment_method, p_reference_number) then
      raise exception 'This payment key was already used with different payment details.'
        using errcode = 'PT409';
    end if;

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

  select o.id, o.collection_id, o.amount_centavos, o.status
  into v_obligation
  from public.obligations o
  where o.id = p_obligation_id and o.organization_id = p_org_id;

  if not found then
    raise exception 'Obligation not found in this organization.';
  end if;

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
$function$;

create or replace function public.review_expense(p_org_id uuid, p_expense_id uuid, p_decision text, p_notes text, p_expected_revision integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare result jsonb;
begin
  if not public.is_active_org_member(p_org_id,auth.uid()) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;
  result := public.review_expense_with_private_result(p_org_id,p_expense_id,p_decision,p_notes,p_expected_revision);
  if not public.can_read_private_financial_rows(p_org_id) then
    result := result - array['verified_by','approved_by','review_notes'];
  end if;
  return result;
end;
$function$;

create or replace function public.review_liquidation(p_org_id uuid, p_liquidation_id uuid, p_decision text, p_notes text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare result jsonb;
begin
  if not public.is_active_org_member(p_org_id,auth.uid()) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;
  result := public.review_liquidation_with_private_result(p_org_id,p_liquidation_id,p_decision,p_notes);
  if not public.can_read_private_financial_rows(p_org_id) then
    result := result - array['reviewed_by','review_notes'];
  end if;
  return result;
end;
$function$;

create or replace function public.submit_reviewed_expense(org uuid, request_id uuid, draft jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare actor uuid:=auth.uid(); prior public.expense_submission_requests; result jsonb; linked public.budgets;
begin
 if actor is null or not public.is_active_org_member(org,actor) then
  raise exception 'Expense submission is unavailable.' using errcode='42501';
 end if;
 if not exists (
  select 1 from public.organization_members m
  where m.organization_id=org and m.profile_id=actor and m.status='active'
   and m.role<>'auditor' and (m.role not in ('member','student') or m.can_submit_expenses)
 ) then raise exception 'Expense submission is unavailable.' using errcode='42501'; end if;
 if request_id is null then raise exception 'A submission request ID is required.' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||actor::text||request_id::text,0));
 select * into prior from public.expense_submission_requests r
 where r.organization_id=org and r.actor_id=actor and r.request_id=submit_reviewed_expense.request_id;
 if found then
  if prior.payload<>draft then raise exception 'This submission was already used for different expense details.' using errcode='23514'; end if;
  return prior.result;
 end if;
 if draft->>'budgetId' is not null then
  select * into linked from public.budgets where id=(draft->>'budgetId')::uuid and organization_id=org for share;
  if not found or linked.status<>'active'
   or (linked.space_id is not null and draft->>'spaceId' is not null and linked.space_id<>(draft->>'spaceId')::uuid)
   or (linked.reporting_period_id is not null and draft->>'periodId' is not null and linked.reporting_period_id<>(draft->>'periodId')::uuid)
  then raise exception 'Choose an active budget for this space and reporting period.' using errcode='23514'; end if;
 end if;
 if (draft->>'spaceId' is not null and not exists(select 1 from public.spaces where organization_id=org and id=(draft->>'spaceId')::uuid))
 or (draft->>'periodId' is not null and not exists(select 1 from public.reporting_periods where organization_id=org and id=(draft->>'periodId')::uuid))
 then raise exception 'Choose a space and reporting period from this organization.' using errcode='23514'; end if;
 result:=public.submit_expense(org,draft->>'title',(draft->>'amountCentavos')::bigint,draft->>'category',
 (draft->>'incurredDate')::date,draft->>'description',(draft->>'budgetId')::uuid,(draft->>'spaceId')::uuid,
 (draft->>'periodId')::uuid,draft->>'receiptUrl',draft->>'vendorName');
 insert into public.expense_submission_requests values(org,actor,request_id,draft,result);
 return result;
end;
$function$;

create or replace function public.update_member_role(p_membership_id uuid, p_new_role text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  actor_id uuid;
  target_org_id uuid;
  target_profile_id uuid;
  old_role text;
  owner_count int;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_new_role not in ('owner', 'organization_admin', 'treasurer', 'auditor', 'member') then
    raise exception 'Invalid organization role.';
  end if;

  select organization_id, profile_id, role into target_org_id, target_profile_id, old_role
  from public.organization_members
  where id = p_membership_id;

  if target_org_id is null then
    raise exception 'Membership record not found.';
  end if;

  if not public.is_org_admin(target_org_id, actor_id) then
    raise exception 'Unauthorized: Only owners and admins can modify member roles.';
  end if;

  if (old_role = 'owner' or p_new_role = 'owner') and not exists (
    select 1 from public.organization_members m
    where m.organization_id=target_org_id and m.profile_id=actor_id
      and m.status='active' and m.role='owner'
  ) then
    raise exception 'Only owners can grant or change ownership.' using errcode='42501';
  end if;

  if old_role = 'owner' and p_new_role <> 'owner' then
    select count(*) into owner_count
    from public.organization_members
    where organization_id = target_org_id and role = 'owner' and status = 'active';

    if owner_count <= 1 then
      raise exception 'Cannot demote the only owner. Assign another owner first.';
    end if;
  end if;

  update public.organization_members
  set role = p_new_role
  where id = p_membership_id;

  return jsonb_build_object(
    'id', p_membership_id,
    'organization_id', target_org_id,
    'profile_id', target_profile_id,
    'role', p_new_role
  );
end;
$function$;

create or replace function public.workspace_budget_totals(org uuid, budgets uuid[])
 returns table(id uuid, spent numeric, committed numeric, provisional boolean)
 language sql
 stable security definer
 set search_path = ''
as $function$
  select a.id,a.spent,a.committed,a.provisional from public.budget_accounting a
  where a.organization_id=org and a.id=any(budgets)
    and public.is_active_org_member(org,auth.uid())
$function$;

create or replace function public.workspace_financial_summary(org uuid, space uuid default null::uuid, period uuid default null::uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path = ''
as $function$
  select jsonb_build_object(
    'total_collected_centavos', c.total,
    'total_budget_allocated_centavos', b.total,
    'total_expenses_centavos', e.total-a.overlap+a.spent,
    'directly_paid_expenses_centavos', e.total-a.overlap,
    'advances_released_centavos', a.released,
    'advance_cash_returns_centavos', a.returned,
    'approved_liquidation_spending_centavos', a.spent,
    'unresolved_discrepancies_centavos', a.discrepancy,
    'written_off_discrepancies_centavos', a.loss,
    'provisional', a.provisional,
    'budget_assigned_expenses_centavos', e.total-a.overlap+a.spent-e.unallocated-a.unallocated,
    'unallocated_expenses_centavos', e.unallocated+a.unallocated,
    'total_outstanding_advances_centavos', a.unsettled,
    'reserve_balance_centavos', c.total-e.total+a.overlap-a.released+a.returned
  )
  from (
    select coalesce(sum(t.total_collected_centavos::numeric),0) total
    from public.collection_financial_totals(org,null) t join public.collections c on c.id=t.collection_id
    where (space is null or c.space_id=space) and (period is null or c.reporting_period_id=period)
  ) c
  cross join (
    select coalesce(sum(allocated_amount_centavos),0) total from public.budgets
    where organization_id=org and status='active'
      and (space is null or space_id=space) and (period is null or reporting_period_id=period)
  ) b
  cross join (
    select coalesce(sum(amount_centavos),0) total,
      coalesce(sum(amount_centavos) filter(where budget_id is null),0) unallocated
    from public.expenses where organization_id=org and status='approved'
      and (space is null or space_id=space) and (period is null or reporting_period_id=period)
  ) e
  cross join (
    select coalesce(sum(overlap),0) overlap,coalesce(sum(spent),0) spent,
      coalesce(sum(released),0) released,coalesce(sum(returned),0) returned,
      coalesce(sum(discrepancy),0) discrepancy,coalesce(sum(loss),0) loss,
      coalesce(sum(unsettled),0) unsettled,coalesce(bool_or(provisional),false) provisional,
      coalesce(sum(case when budget_id is null then spent-attributed_from_unallocated else 0 end-unallocated_overlap),0) unallocated
    from public.advance_accounting where organization_id=org
      and (space is null or space_id=space) and (period is null or reporting_period_id=period)
  ) a
  where public.is_active_org_member(org,auth.uid())
$function$;

-- -----------------------------------------------------------------------------
-- 2. Harden reconcile_collection_assessment (defense-in-depth + grant revoke)
-- -----------------------------------------------------------------------------
create or replace function public.reconcile_collection_assessment(org uuid, collection uuid, member uuid default null::uuid)
 returns integer
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  c public.collections;
  inserted integer;
begin
  if current_user in ('anon', 'authenticated') and pg_trigger_depth() = 0 then
    if not public.is_active_org_member(org, auth.uid()) or not public.is_org_officer(org, auth.uid()) then
      raise exception 'Unauthorized to reconcile collection assessment.' using errcode = '42501';
    end if;
  end if;

  select * into c from public.collections where organization_id = org and id = collection for update nowait;
  if not found or c.status <> 'active' or not c.auto_assess_new_members then return 0; end if;

  insert into public.obligations(organization_id, collection_id, directory_member_id, amount_centavos, status, notes)
  select org, collection, p.id, c.standard_dues_centavos, 'pending', 'Automatic collection assessment'
  from public.collection_scope_live(org, collection, c.member_scope) p
  where member is null or p.id = member
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 3. Exhaustive internal-only RPC lockdown (closes any recovery-path drift)
-- -----------------------------------------------------------------------------
revoke all on function
  public.reconcile_collection_assessment(uuid, uuid, uuid),
  public.collection_scope_live(uuid, uuid, text),
  public.collection_scope_population(uuid, text, uuid[], uuid[]),
  public.collection_deletion_policy(public.collections),
  public.directory_member_financial_rows(uuid, uuid, uuid, uuid[]),
  public.emit_due_payment_reminders(uuid, integer),
  public.generate_receipt_number(uuid),
  public.lock_advance_budget_accounting(),
  public.should_notify_in_app(uuid, text),
  public.review_expense_internal(uuid, uuid, text, text),
  public.review_expense_with_private_result(uuid, uuid, text, text, integer),
  public.review_liquidation_with_private_result(uuid, uuid, text, text),
  public.delete_collection(uuid, uuid),
  public.create_organization_with_owner(text, text),
  public.lock_liquidation_accounting(uuid, uuid),
  public.cleanup_directory_import_reports(),
  public.pending_expense_storage_copies(integer),
  public.confirm_expense_storage_copy(uuid, text, text),
  public.consume_rate_limit(text, integer, integer),
  public.record_edge_security_event(text, text, text, text, text, integer, text, text, jsonb)
from public, anon, authenticated;

revoke all on function
  public.read_expense_evidence(uuid, uuid, uuid),
  public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text, text),
  public.record_payment(uuid, uuid, bigint, text, text, text),
  public.review_expense(uuid, uuid, text, text, integer),
  public.review_liquidation(uuid, uuid, text, text),
  public.submit_reviewed_expense(uuid, uuid, jsonb),
  public.update_member_role(uuid, text),
  public.workspace_budget_totals(uuid, uuid[]),
  public.workspace_financial_summary(uuid, uuid, uuid)
from public, anon;

grant execute on function
  public.read_expense_evidence(uuid, uuid, uuid),
  public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text, text),
  public.record_payment(uuid, uuid, bigint, text, text, text),
  public.review_expense(uuid, uuid, text, text, integer),
  public.review_liquidation(uuid, uuid, text, text),
  public.submit_reviewed_expense(uuid, uuid, jsonb),
  public.update_member_role(uuid, text),
  public.workspace_budget_totals(uuid, uuid[]),
  public.workspace_financial_summary(uuid, uuid, uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Fix Storage initialization: never query storage.policies or swallow errors
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null or to_regclass('storage.objects') is not null then
    if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
      raise exception 'Incomplete Supabase Storage schema: storage.buckets and storage.objects are both required.';
    end if;

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
      select 1 from storage.buckets
      where id = 'expense-evidence'
        and not public
        and file_size_limit = 1048576
        and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
        and cardinality(allowed_mime_types) = 4
    ) then
      raise exception 'Existing expense-evidence bucket has incompatible settings.';
    end if;

    if not exists (
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
end;
$$;

commit;
