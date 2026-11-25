begin;

-- =============================================================================
-- 1. SEC-01 & PERF-BE-05: Harden account/organization identity SECURITY DEFINER
--    RPCs against cross-organization username/avatar enumeration and eliminate
--    O(N) per-row correlated subqueries in organization_identity_labels.
-- =============================================================================

create or replace function public.resolve_account_identity(p_user uuid, p_org uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org_nickname text;
  v_username text;
begin
  perform bantai_gateway.check_session();
  if v_caller is null or p_user is null then
    return 'Member';
  end if;

  if p_org is not null and public.is_active_org_member(p_org, v_caller) then
    select nullif(btrim(m.display_name), '')
      into v_org_nickname
      from public.organization_members m
     where m.organization_id = p_org
       and m.profile_id = p_user;

    if found then
      if v_org_nickname is not null then
        return v_org_nickname;
      end if;
      select '@' || u.username
        into v_username
        from bantai_private.account_usernames u
       where u.user_id = p_user;
      return coalesce(v_username, 'Member');
    end if;
  end if;

  if p_user = v_caller
     or public.is_platform_admin()
     or exists (
       select 1
         from public.organization_members caller_m
         join public.organization_members target_m
           on target_m.organization_id = caller_m.organization_id
        where caller_m.profile_id = v_caller
          and caller_m.status = 'active'
          and target_m.profile_id = p_user
          and public.is_active_org_member(caller_m.organization_id, v_caller)
     ) then
    select '@' || u.username
      into v_username
      from bantai_private.account_usernames u
     where u.user_id = p_user;
    return coalesce(v_username, 'Member');
  end if;

  return 'Member';
end;
$$;

create or replace function public.account_identity_labels(p_ids uuid[])
returns table(id uuid, username text, display_name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
begin
  perform bantai_gateway.check_session();
  if v_caller is null or p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Too many identity IDs requested.' using errcode = '22023';
  end if;

  v_is_admin := public.is_platform_admin();

  return query
  select p.id,
         n.username,
         coalesce('@' || n.username, 'Member') as display_name,
         p.avatar_url
    from public.profiles p
    left join bantai_private.account_usernames n
      on n.user_id = p.id
   where p.id = any(p_ids)
     and (
       p.id = v_caller
       or v_is_admin
       or exists (
         select 1
           from public.organization_members caller_m
           join public.organization_members target_m
             on target_m.organization_id = caller_m.organization_id
          where caller_m.profile_id = v_caller
            and caller_m.status = 'active'
            and target_m.profile_id = p.id
            and public.is_active_org_member(caller_m.organization_id, v_caller)
       )
     );
end;
$$;

create or replace function public.organization_identity_labels(p_org uuid)
returns table(id uuid, username text, display_name text, organization_display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform bantai_gateway.check_session();
  if auth.uid() is null or p_org is null or not public.is_active_org_member(p_org, auth.uid()) then
    return;
  end if;

  return query
  select m.profile_id as id,
         n.username,
         coalesce(nullif(btrim(m.display_name), ''), '@' || n.username, 'Member') as display_name,
         m.display_name as organization_display_name
    from public.organization_members m
    left join bantai_private.account_usernames n
      on n.user_id = m.profile_id
   where m.organization_id = p_org;
end;
$$;

revoke all on function
  public.resolve_account_identity(uuid, uuid),
  public.account_identity_labels(uuid[]),
  public.organization_identity_labels(uuid)
from public, anon;

grant execute on function
  public.resolve_account_identity(uuid, uuid),
  public.account_identity_labels(uuid[]),
  public.organization_identity_labels(uuid)
to authenticated;

-- =============================================================================
-- 2. SEC-02: Enforce active (non-suspended, non-closed) workspace & unarchived
--    expense guards on settle_reimbursement, resolve structured identities in
--    list_reimbursements, and enforce session gateway in workspace_financial_summary.
-- =============================================================================

create or replace function public.list_reimbursements(org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform bantai_gateway.check_session();
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'Active workspace access required.' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'amount', e.amount_centavos,
      'currency', e.currency,
      'status', e.status,
      'incurredDate', e.incurred_date,
      'claimant', e.submitted_by,
      'paymentId', p.id,
      'paidOn', p.paid_on,
      'claimantName', coalesce(
        nullif(btrim(m.display_name), ''),
        '@' || u.username,
        nullif(btrim(profile.display_name), ''),
        'Member'
      )
    ) order by e.created_at desc), '[]'::jsonb)
    from public.reimbursement_claims r
    join public.expenses e on e.id = r.expense_id
    left join public.profiles profile on profile.id = e.submitted_by
    left join public.organization_members m
      on m.organization_id = org and m.profile_id = e.submitted_by
    left join bantai_private.account_usernames u
      on u.user_id = e.submitted_by
    left join public.reimbursement_payments p
      on p.expense_id = e.id and p.voided_at is null
    where e.organization_id = org
      and (e.submitted_by = auth.uid() or public.can_read_private_financial_rows(org))
  );
end;
$$;

create or replace function public.settle_reimbursement(
  org uuid,
  claim uuid,
  payment uuid,
  paid_on date,
  method text,
  reference text,
  void_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  expense public.expenses;
  existing public.reimbursement_payments;
  actor uuid := auth.uid();
begin
  perform bantai_gateway.check_session();
  if not public.is_active_org_member(org, actor) then
    raise exception 'Active workspace access required.' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.organization_members
     where organization_id = org
       and profile_id = actor
       and status = 'active'
       and role in ('owner', 'treasurer')
  ) then
    raise exception 'Payment recording requires treasury access.' using errcode = '42501';
  end if;

  select e.*
    into expense
    from public.expenses e
    join public.reimbursement_claims r on r.expense_id = e.id
   where e.id = claim
     and e.organization_id = org
     for update of e;

  if not found or expense.status <> 'approved' then
    raise exception 'An approved claim is required.';
  end if;
  if expense.archived_at is not null then
    raise exception 'Archived claims cannot be modified.' using errcode = '23514';
  end if;

  select *
    into existing
    from public.reimbursement_payments
   where id = payment
     and expense_id = claim;

  if void_reason is not null then
    if not found or length(btrim(void_reason)) not between 3 and 500 then
      raise exception 'Provide a correction reason.';
    end if;
    if existing.voided_at is not null then
      return;
    end if;
    update public.reimbursement_payments
       set voided_at = now(),
           voided_by = actor,
           void_reason = settle_reimbursement.void_reason
     where id = payment;
    insert into public.audit_logs(organization_id, actor_id, action, entity_id, after_value)
    values (org, actor, 'reimbursement.payment_voided', claim, jsonb_build_object('paymentId', payment, 'reason', void_reason));
    return;
  end if;

  if found
     and existing.voided_at is null
     and existing.paid_on = settle_reimbursement.paid_on
     and existing.method = settle_reimbursement.method
     and existing.reference is not distinct from nullif(btrim(reference), '') then
    return;
  end if;

  if payment is null
     or paid_on is null
     or paid_on < expense.incurred_date
     or paid_on > current_date
     or method is null
     or method not in ('cash', 'bank_transfer', 'e_wallet', 'other')
     or length(coalesce(reference, '')) > 150
     or (method <> 'cash' and nullif(btrim(reference), '') is null) then
    raise exception 'Provide valid payment details.';
  end if;

  if exists (
    select 1
      from public.reimbursement_payments
     where expense_id = claim
       and voided_at is null
  ) then
    raise exception 'This claim is already paid.';
  end if;

  insert into public.reimbursement_payments(id, expense_id, amount_centavos, paid_on, method, reference, recorded_by)
  values (payment, claim, expense.amount_centavos, paid_on, method, nullif(btrim(reference), ''), actor);

  insert into public.audit_logs(organization_id, actor_id, action, entity_id, after_value)
  values (org, actor, 'reimbursement.paid', claim, jsonb_build_object('paymentId', payment, 'amountCentavos', expense.amount_centavos, 'paidOn', paid_on));
end;
$$;

create or replace function public.workspace_financial_summary(
  org uuid,
  space uuid default null::uuid,
  period uuid default null::uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform bantai_gateway.check_session();
  return (
    select jsonb_build_object(
      'total_collected_centavos', c.total,
      'total_budget_allocated_centavos', b.total,
      'total_expenses_centavos', e.total - a.overlap + a.spent,
      'directly_paid_expenses_centavos', e.total - a.overlap - r.unpaid,
      'outstanding_reimbursements_centavos', r.unpaid,
      'advances_released_centavos', a.released,
      'advance_cash_returns_centavos', a.returned,
      'approved_liquidation_spending_centavos', a.spent,
      'unresolved_discrepancies_centavos', a.discrepancy,
      'written_off_discrepancies_centavos', a.loss,
      'provisional', a.provisional,
      'budget_assigned_expenses_centavos', e.total - a.overlap + a.spent - e.unallocated - a.unallocated,
      'unallocated_expenses_centavos', e.unallocated + a.unallocated,
      'total_outstanding_advances_centavos', a.unsettled,
      'reserve_balance_centavos', c.total - e.total + a.overlap - a.released + a.returned + r.unpaid
    )
    from (
      select coalesce(sum(t.total_collected_centavos::numeric), 0) total
      from public.collection_financial_totals(org, null) t
      join public.collections c on c.id = t.collection_id
      where (space is null or c.space_id = space)
        and (period is null or c.reporting_period_id = period)
    ) c
    cross join (
      select coalesce(sum(allocated_amount_centavos), 0) total
      from public.budgets
      where organization_id = org
        and status = 'active'
        and (space is null or space_id = space)
        and (period is null or reporting_period_id = period)
    ) b
    cross join (
      select coalesce(sum(amount_centavos), 0) total,
             coalesce(sum(amount_centavos) filter (where budget_id is null), 0) unallocated
      from public.expenses
      where organization_id = org
        and status = 'approved'
        and (space is null or space_id = space)
        and (period is null or reporting_period_id = period)
    ) e
    cross join (
      select coalesce(sum(overlap), 0) overlap,
             coalesce(sum(spent), 0) spent,
             coalesce(sum(released), 0) released,
             coalesce(sum(returned), 0) returned,
             coalesce(sum(discrepancy), 0) discrepancy,
             coalesce(sum(loss), 0) loss,
             coalesce(sum(unsettled), 0) unsettled,
             coalesce(bool_or(provisional), false) provisional,
             coalesce(sum(case when budget_id is null then spent - attributed_from_unallocated else 0 end - unallocated_overlap), 0) unallocated
      from public.advance_accounting
      where organization_id = org
        and (space is null or space_id = space)
        and (period is null or reporting_period_id = period)
    ) a
    cross join (
      select coalesce(sum(e.amount_centavos), 0) unpaid
      from public.reimbursement_claims claim
      join public.expenses e on e.id = claim.expense_id
      where e.organization_id = org
        and e.status = 'approved'
        and (space is null or e.space_id = space)
        and (period is null or e.reporting_period_id = period)
        and not exists (
          select 1
            from public.reimbursement_payments p
           where p.expense_id = e.id
             and p.voided_at is null
        )
    ) r
    where public.is_active_org_member(org, auth.uid())
  );
end;
$function$;

revoke all on function
  public.list_reimbursements(uuid),
  public.settle_reimbursement(uuid, uuid, uuid, date, text, text, text),
  public.workspace_financial_summary(uuid, uuid, uuid)
from public, anon;

grant execute on function
  public.list_reimbursements(uuid),
  public.settle_reimbursement(uuid, uuid, uuid, date, text, text, text),
  public.workspace_financial_summary(uuid, uuid, uuid)
to authenticated;

-- =============================================================================
-- 3. SEC-06: Upgrade invite_code generation from PRNG md5(random()) to OS CSPRNG
--    gen_random_uuid() entropy (48-bit / 12-hex) and redact raw invite secrets
--    from audit_logs.
-- =============================================================================

create or replace function public.create_organization_with_owner(
  org_name text,
  org_currency text default 'PHP'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
  actor_id uuid;
  clean_name text;
  clean_currency text;
  new_invite_code text;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'Authentication required to create an organization.';
  end if;

  clean_name := trim(org_name);
  if length(clean_name) < 2 or length(clean_name) > 150 then
    raise exception 'Organization name must be between 2 and 150 characters.';
  end if;

  clean_currency := upper(trim(coalesce(org_currency, 'PHP')));
  if clean_currency !~ '^[A-Z]{3}$' then
    clean_currency := 'PHP';
  end if;

  new_invite_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  insert into public.organizations (name, currency, invite_code)
  values (clean_name, clean_currency, new_invite_code)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, profile_id, role, status)
  values (new_org_id, actor_id, 'owner', 'active');

  return jsonb_build_object(
    'id', new_org_id,
    'name', clean_name,
    'currency', clean_currency,
    'invite_code', new_invite_code,
    'role', 'owner'
  );
end;
$$;

revoke all on function public.create_organization_with_owner(text, text) from public, anon, authenticated;

create or replace function public.regenerate_invite_code(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_code text;
begin
  perform bantai_gateway.check_session();
  if not public.is_active_org_member(p_org_id, auth.uid()) or not public.is_org_admin(p_org_id, auth.uid()) then
    raise exception 'Insufficient permissions to regenerate invite code' using errcode = '42501';
  end if;

  v_new_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  update public.organizations
     set invite_code = v_new_code
   where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'regenerate_invite_code',
    p_org_id,
    jsonb_build_object('invite_code_rotated', true),
    jsonb_build_object('invite_code_rotated', true)
  );

  return jsonb_build_object('invite_code', v_new_code);
end;
$$;

revoke all on function public.regenerate_invite_code(uuid) from public, anon;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
