-- Phase 4A Batch 4: Remaining SECURITY DEFINER RPC Suspension/Closure Hardening,
-- Receipt/Obligation Helper Hardening, and Platform-Admin Analytics Fixes

-- ============================================================================
-- 1. Receipt Number & Obligation Recalculation Hardening
-- ============================================================================

create or replace function public.generate_receipt_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.generate_receipt_number(uuid) from public, anon, authenticated;

create or replace function public.recalculate_obligation_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.recalculate_obligation_status() from public, anon, authenticated;

-- ============================================================================
-- 2. Platform-Admin Analytics RPC Column-Drift Fixes (Priority 3)
-- ============================================================================

create or replace function public.admin_get_user_details(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_memberships jsonb;
  v_role_history jsonb;
  v_security_history jsonb;
  v_enforcement_history jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'organization_id', o.id,
      'organization_name', o.name,
      'workspace_role', om.role,
      'joined_at', om.created_at,
      'suspended_at', o.suspended_at,
      'closed_at', o.closed_at
    )
    order by om.created_at desc
  ), '[]'::jsonb)
  into v_memberships
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.profile_id = p_user_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', al.id,
      'action', al.action,
      'before_value', al.before_value,
      'after_value', al.after_value,
      'created_at', al.occurred_at
    )
    order by al.occurred_at desc
  ), '[]'::jsonb)
  into v_role_history
  from (
    select id, action, before_value, after_value, occurred_at
    from public.audit_logs
    where entity_id = p_user_id
      and action ilike '%role%'
    order by occurred_at desc
    limit 20
  ) al;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', se.id,
      'event_type', se.action,
      'category', se.category,
      'severity', se.severity,
      'source_ip', se.source_ip,
      'occurred_at', se.occurred_at
    )
    order by se.occurred_at desc
  ), '[]'::jsonb)
  into v_security_history
  from (
    select id, action, category, severity, source_ip, occurred_at
    from public.security_events
    where actor_id = p_user_id
       or requesting_user_id = p_user_id
    order by occurred_at desc
    limit 20
  ) se;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ea.id,
      'action_type', ea.action_type,
      'reason', ea.reason,
      'expires_at', ea.expires_at,
      'created_at', ea.created_at
    )
    order by ea.created_at desc
  ), '[]'::jsonb)
  into v_enforcement_history
  from (
    select id, action_type, reason, expires_at, created_at
    from public.enforcement_actions
    where target_user_id = p_user_id
    order by created_at desc
    limit 15
  ) ea;

  return jsonb_build_object(
    'memberships', v_memberships,
    'role_history', v_role_history,
    'security_history', v_security_history,
    'enforcement_history', v_enforcement_history
  );
end;
$$;

create or replace function public.admin_get_org_360_extended(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_activity_series jsonb;
  v_ai_summary jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required' using errcode = '42501';
  end if;

  with days_series as (
    select generate_series(
      date_trunc('day', v_since),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  ),
  audit_agg as (
    select occurred_at::date as day, count(*) as audit_events
    from public.audit_logs
    where organization_id = p_organization_id
      and occurred_at >= v_since
    group by 1
  ),
  ai_agg as (
    select
      created_at::date as day,
      count(*) as ai_requests,
      coalesce(sum(total_tokens), 0) as ai_tokens
    from public.ai_usage_logs
    where organization_id = p_organization_id
      and created_at >= v_since
    group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', to_char(d.day, 'YYYY-MM-DD'),
      'audit_events', coalesce(a.audit_events, 0),
      'ai_requests', coalesce(ai.ai_requests, 0),
      'ai_tokens', coalesce(ai.ai_tokens, 0)
    )
    order by d.day
  ), '[]'::jsonb)
  into v_activity_series
  from days_series d
  left join audit_agg a on a.day = d.day
  left join ai_agg ai on ai.day = d.day;

  select jsonb_build_object(
    'ai_enabled', coalesce((select q.ai_enabled from public.ai_workspace_quotas q where q.organization_id = p_organization_id), true),
    'daily_request_limit', coalesce((select q.daily_request_limit from public.ai_workspace_quotas q where q.organization_id = p_organization_id), 200),
    'monthly_token_limit', coalesce((select q.monthly_token_limit from public.ai_workspace_quotas q where q.organization_id = p_organization_id), 2000000),
    'daily_requests_used', (
      select count(*) from public.ai_usage_logs l
      where l.organization_id = p_organization_id
        and l.created_at >= date_trunc('day', now())
        and l.status in ('success', 'error', 'aborted')
    ),
    'monthly_tokens_used', (
      select coalesce(sum(l.total_tokens), 0) from public.ai_usage_logs l
      where l.organization_id = p_organization_id
        and l.created_at >= date_trunc('month', now())
    ),
    'period_requests', count(*),
    'period_errors', count(*) filter (where status = 'error'),
    'period_rate_limited', count(*) filter (where status = 'rate_limited'),
    'period_tokens', coalesce(sum(total_tokens), 0),
    'avg_latency_ms', coalesce(round(avg(latency_ms) filter (where status = 'success')), 0)
  )
  into v_ai_summary
  from public.ai_usage_logs
  where organization_id = p_organization_id
    and created_at >= v_since;

  return jsonb_build_object(
    'days', v_days,
    'activity_series', v_activity_series,
    'ai_summary', v_ai_summary
  );
end;
$$;

create or replace function public.admin_get_security_heatmap_filtered(
  p_days integer default 7,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_tz_offset_minutes integer default 0,
  p_event_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_end timestamptz := coalesce(p_end_date, now());
  v_start timestamptz := coalesce(p_start_date, v_end - make_interval(days => v_days));
  v_tz_offset integer := least(greatest(coalesce(p_tz_offset_minutes, 0), -720), 840);
  v_event_type text := nullif(trim(coalesce(p_event_type, '')), '');
  v_cells jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'dow', dow,
      'hour', hr,
      'count', cnt
    )
    order by dow, hr
  ), '[]'::jsonb)
  into v_cells
  from (
    select
      extract(dow from (occurred_at + make_interval(mins => v_tz_offset)))::integer as dow,
      extract(hour from (occurred_at + make_interval(mins => v_tz_offset)))::integer as hr,
      count(*)::integer as cnt
    from public.security_events
    where category = 'security'
      and occurred_at >= v_start
      and occurred_at <= v_end
      and (
        v_event_type is null
        or action = v_event_type
      )
      and (
        v_event_type is not null
        or action in (
          'failed_login',
          'auth_failure_edge',
          'rate_limited',
          'rate_limit_exceeded',
          'account_locked',
          'ip_restricted'
        )
      )
    group by 1, 2
  ) t;

  return jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'tz_offset_minutes', v_tz_offset,
    'event_type', v_event_type,
    'heatmap', v_cells
  );
end;
$$;

-- ============================================================================
-- 3. Active/Non-Suspended Org Guards on Remaining 31 Direct-Query RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assign_member_obligation(p_org_id uuid, p_collection_id uuid, p_member_id uuid, p_amount_centavos bigint, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_obligation public.obligations;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.create_organization_invitation(p_org_id uuid, p_invited_email text, p_role text DEFAULT 'member'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_invited_email, '')));
  v_org_name text;
  v_target_user_id uuid;
  v_invitation public.organization_invitations;
  v_dedupe_key text;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'A valid email address is required.' using errcode = '22023';
  end if;

  if p_role not in ('organization_admin', 'treasurer', 'auditor', 'member') then
    raise exception 'Invalid invitation role.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org_id
      and m.profile_id = v_actor_id
      and m.status = 'active'
      and m.role in ('owner', 'organization_admin')
  ) then
    raise exception 'Only workspace owners or admins can invite members.' using errcode = '42501';
  end if;

  select name into v_org_name from public.organizations where id = p_org_id;
  if not found then
    raise exception 'Organization not found.' using errcode = 'P0002';
  end if;

  select id into v_target_user_id
  from auth.users
  where lower(email) = v_email
  limit 1;

  if v_target_user_id is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org_id
      and m.profile_id = v_target_user_id
      and m.status = 'active'
  ) then
    raise exception 'This user is already an active member of the workspace.' using errcode = '23505';
  end if;

  insert into public.organization_invitations (
    organization_id,
    invited_user_id,
    invited_email,
    role,
    invited_by
  ) values (
    p_org_id,
    v_target_user_id,
    v_email,
    p_role,
    v_actor_id
  )
  returning * into v_invitation;

  if v_target_user_id is not null and v_target_user_id <> v_actor_id then
    if public.should_notify_in_app(v_target_user_id, 'organization.invitation_created') then
      v_dedupe_key := format('org_invite:%s:%s', v_invitation.id, v_target_user_id);
      insert into public.notifications (
        recipient_user_id,
        organization_id,
        actor_user_id,
        type,
        title,
        message,
        metadata,
        entity_type,
        entity_id,
        dedupe_key
      ) values (
        v_target_user_id,
        null,
        v_actor_id,
        'organization.invitation_created',
        'Workspace invitation',
        format('You have been invited to join %s as %s.', coalesce(v_org_name, 'a workspace'), replace(p_role, '_', ' ')),
        jsonb_build_object(
          'organization_id', p_org_id,
          'organization_name', v_org_name,
          'invitation_id', v_invitation.id,
          'role', p_role
        ),
        'organization_invitation',
        v_invitation.id,
        v_dedupe_key
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_invitation.id,
    'organization_id', v_invitation.organization_id,
    'invited_user_id', v_invitation.invited_user_id,
    'invited_email', v_invitation.invited_email,
    'role', v_invitation.role,
    'status', v_invitation.status,
    'created_at', v_invitation.created_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.decide_budget_activation(org uuid, budget uuid, approve boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.budgets; result text;
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'You cannot archive or restore this record.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_budget(p_org_id uuid, p_budget_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_cash_advance(p_org_id uuid, p_advance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_adv public.cash_advances;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to delete cash advances.';
  end if;

  select * into v_adv
  from public.cash_advances
  where id = p_advance_id and organization_id = p_org_id;

  if v_adv.id is null then
    raise exception 'Cash advance not found.';
  end if;

  if v_adv.status != 'outstanding' then
    raise exception 'Cannot delete cash advance with linked liquidation records.';
  end if;

  delete from public.cash_advances where id = p_advance_id and organization_id = p_org_id;

  return jsonb_build_object(
    'id', p_advance_id,
    'action', 'deleted',
    'message', 'Cash advance was deleted successfully.'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_collection(p_org_id uuid, p_collection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_collection(p_org_id uuid, p_collection_id uuid, confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare collection_title text;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
 if not exists(select 1 from public.organization_members where organization_id=p_org_id and profile_id=auth.uid()
 and status='active' and role in ('owner','organization_admin','treasurer')) then
  raise exception 'You cannot delete this collection.' using errcode='42501';
 end if;
 select title into collection_title from public.collections where id=p_collection_id and organization_id=p_org_id for update;
 if not found or confirmation is distinct from collection_title then
  raise exception 'Enter the exact collection name.' using errcode='23514';
 end if;
 return public.delete_collection(p_org_id,p_collection_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_expense(p_org_id uuid, p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_expense public.expenses;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_liquidation(p_org_id uuid, p_liquidation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_liq public.liquidations;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_liq
  from public.liquidations
  where id = p_liquidation_id and organization_id = p_org_id;

  if v_liq.id is null then
    raise exception 'Liquidation record not found.';
  end if;

  if v_liq.status = 'approved' then
    raise exception 'Cannot delete approved liquidation records.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to cancel liquidation submissions.';
  end if;

  -- Reset cash advance status back to outstanding
  update public.cash_advances
  set status = 'outstanding', updated_at = now()
  where id = v_liq.cash_advance_id;

  delete from public.liquidations where id = p_liquidation_id and organization_id = p_org_id;

  return jsonb_build_object(
    'id', p_liquidation_id,
    'action', 'deleted',
    'message', 'Liquidation draft was cancelled and cash advance status restored to outstanding.'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_organization(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org public.organizations%rowtype;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  select * into org from public.organizations where id = p_org_id for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id = p_org_id
      and profile_id = auth.uid() and role = 'owner' and status = 'active'
  ) then
    raise exception 'Only an organization owner can close this organization.' using errcode = '42501';
  end if;
  if exists(select 1 from public.advance_accounting where organization_id = p_org_id
    and (unsettled > 0 or discrepancy > 0)) then
    raise exception 'Settle outstanding cash advances before closing the organization.' using errcode = '23514';
  end if;
  update public.organization_directory_members set email = null, phone = null
    where organization_id = p_org_id and (email is not null or phone is not null);
  update public.user_preferences set default_organization_id = null where default_organization_id = p_org_id;
  insert into public.workspace_history_entitlements(organization_id,profile_id,closure_role)
    select organization_id,profile_id,role from public.organization_members
    where organization_id=p_org_id and status='active';
  update public.organization_members set status = 'left' where organization_id = p_org_id and status <> 'left';
  update public.organizations set closed_at = now(), closed_by = auth.uid(),
    retention_status = 'retained_pending_review', retention_review_at = now() + interval '1 year'
    where id = p_org_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(p_org_id,auth.uid(),'organization_closed',p_org_id,
      jsonb_build_object('retention_status','retained_pending_review'));
  return jsonb_build_object('success',true,'organization_id',p_org_id,'action','closed');
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_space(p_org_id uuid, p_space_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_has_records boolean;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin') then
    raise exception 'Unauthorized to delete spaces for this organization.';
  end if;

  -- Check if financial records or collections reference this space
  select exists (
    select 1 from public.collections where space_id = p_space_id
    union all
    select 1 from public.budgets where space_id = p_space_id
    union all
    select 1 from public.expenses where space_id = p_space_id
    union all
    select 1 from public.cash_advances where space_id = p_space_id
  ) into v_has_records;

  if v_has_records then
    -- Soft-archive space to maintain relational integrity
    update public.spaces set status = 'archived', updated_at = now()
    where id = p_space_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_space_id, 'action', 'archived', 'message', 'Space has linked financial records and was safely archived.');
  else
    delete from public.spaces where id = p_space_id and organization_id = p_org_id;
    return jsonb_build_object('id', p_space_id, 'action', 'deleted', 'message', 'Space was deleted successfully.');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_unused_cash_request(org uuid, request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.cash_advance_requests;
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'You cannot archive or restore this record.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.emit_due_payment_reminders(p_org_id uuid DEFAULT NULL::uuid, p_days_ahead integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
  v_inserted integer := 0;
  v_dedupe_key text;
  v_days integer := greatest(0, least(coalesce(p_days_ahead, 3), 30));
begin
  if auth.uid() is not null and not public.is_org_officer(p_org_id, auth.uid()) then
    raise exception 'Only workspace officers can trigger payment reminders.' using errcode = '42501';
  end if;
  for v_row in
    select
      o.id as obligation_id,
      o.organization_id,
      o.collection_id,
      o.amount_centavos,
      c.title as collection_title,
      c.due_date,
      m.profile_id as recipient_user_id
    from public.obligations o
    join public.collections c on c.id = o.collection_id
    join public.organization_members m on m.id = o.member_id
    where c.status = 'active'
      and c.due_date is not null
      and c.due_date <= (current_date + v_days)
      and o.status in ('pending', 'partially_paid')
      and o.amount_centavos > 0
      and m.status = 'active'
      and (p_org_id is null or o.organization_id = p_org_id)
  loop
    if public.should_notify_in_app(v_row.recipient_user_id, 'payment.due_reminder') then
      v_dedupe_key := format('due_reminder:%s:%s', v_row.obligation_id, current_date);
      insert into public.notifications (
        recipient_user_id,
        organization_id,
        actor_user_id,
        type,
        title,
        message,
        metadata,
        entity_type,
        entity_id,
        dedupe_key
      ) values (
        v_row.recipient_user_id,
        v_row.organization_id,
        null,
        'payment.due_reminder',
        case when v_row.due_date < current_date then 'Overdue contribution' else 'Contribution due soon' end,
        format('Your contribution for "%s" is due on %s.', left(v_row.collection_title, 100), v_row.due_date),
        jsonb_build_object(
          'collection_id', v_row.collection_id,
          'obligation_id', v_row.obligation_id,
          'due_date', v_row.due_date,
          'amount_centavos', v_row.amount_centavos
        ),
        'collection',
        v_row.collection_id,
        v_dedupe_key
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;

      if found then
        v_inserted := v_inserted + 1;
      end if;
    end if;
  end loop;

  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_collection_archives(org uuid, search text, page integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'You cannot archive or restore this record.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = org
    and profile_id = auth.uid() and status = 'active' and role in ('owner','organization_admin','treasurer','auditor')) then
    raise exception 'You cannot view collection archives.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(rows) order by archived_at desc nulls last, id), '[]'::jsonb) from (
    select c.id, c.title, c.archived_at, p.display_name as archived_by, s.name as space, public.collection_deletion_policy(c) as classification
    from public.collections c
    left join public.profiles p on p.id = c.archived_by
    left join public.spaces s on s.id = c.space_id and s.organization_id = org
    where c.organization_id = org and c.status = 'archived'
      and strpos(lower(c.title), lower(coalesce(search,''))) > 0
    order by c.archived_at desc nulls last, c.id limit 21 offset (greatest(page, 0)::bigint * 20)
  ) rows);
end;
$function$;

CREATE OR REPLACE FUNCTION public.manage_budget_amendment(org uuid, budget uuid, expected bigint, proposed bigint, explanation text, amendment uuid, decision text)
 RETURNS budget_amendments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  actor_role text;
  current_budget public.budgets;
  change public.budget_amendments;
  committed numeric;
  current_preset text;
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'You cannot archive or restore this record.' using errcode = '42501';
  end if;
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
    select approval_preset into current_preset from public.organizations where id=org for share;
    if current_preset = 'simple' and not exists (
      select 1 from public.budget_amendments where budget_id=budget and status='pending'
    ) then
      select coalesce(sum(amount_centavos),0) into committed from public.expenses
        where budget_id=budget and status in ('pending','verified');
      committed := committed + (select spent + accounting.committed from public.budget_accounting accounting where id=budget and organization_id=org);
      if proposed < committed then
        raise exception 'The proposed allocation is below existing commitments.' using errcode='23514';
      end if;
      insert into public.budget_amendments(budget_id,organization_id,previous_centavos,proposed_centavos,reason,proposed_by,status)
      values(budget,org,expected,proposed,trim(explanation),actor,'approved') returning * into change;
      update public.budgets set allocated_amount_centavos=proposed,updated_at=now() where id=budget;
      return change;
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
      where budget_id = budget and status in ('pending','verified');
    committed := committed + (select spent + accounting.committed from public.budget_accounting accounting where id=budget and organization_id=org);
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
$function$;

CREATE OR REPLACE FUNCTION public.manage_cash_advance_request(org uuid, request_id uuid, action text, draft jsonb)
 RETURNS cash_advance_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor public.organization_members;
 r public.cash_advance_requests;
 released jsonb;
 recipient uuid;
 release_period uuid;
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'You cannot archive or restore this record.' using errcode = '42501';
  end if;
 select * into actor from public.organization_members where organization_id=org and profile_id=auth.uid() and status='active';
 if not found then raise exception 'Organization access is required.' using errcode='42501'; end if;
 if action='create' and actor.role<>'auditor' then
   insert into public.cash_advance_requests(organization_id, requester, title, purpose, amount_centavos)
   values(org, actor.profile_id, trim(draft->>'title'), trim(draft->>'purpose'), (draft->>'amountCentavos')::bigint)
   returning * into r;
   return r;
 end if;
 select * into r from public.cash_advance_requests where id=request_id and organization_id=org for update;
 if not found then raise exception 'Request not found.' using errcode='P0002'; end if;
 if r.revision is distinct from (draft->>'revision')::integer then
   raise exception 'The request changed. Refresh and try again.' using errcode='40001';
 end if;
 if action='revise' and r.requester=actor.profile_id and r.status in ('pending','rejected') then
   update public.cash_advance_requests set title=trim(draft->>'title'), purpose=trim(draft->>'purpose'),
     amount_centavos=(draft->>'amountCentavos')::bigint, status='pending', revision=revision+1 where id=r.id returning * into r;
 elsif action in ('approve','reject') and r.status='pending' and actor.role in ('owner','organization_admin') and actor.profile_id<>r.requester then
   update public.cash_advance_requests set status=case when action='approve' then 'approved' else 'rejected' end,
     revision=revision+1 where id=r.id returning * into r;
 elsif action='release' and r.status='approved' and actor.role in ('owner','organization_admin','treasurer') then
   select id into recipient from public.organization_members where organization_id=org and profile_id=r.requester and status='active';
   if not found then raise exception 'The recipient must be an active workspace member.' using errcode='23514'; end if;
   release_period := (draft->>'periodId')::uuid;
   if release_period is not null then
     perform 1 from public.reporting_periods where id=release_period and organization_id=org for share;
     if not found then
       raise exception 'Choose a reporting period in this organization.' using errcode='23514';
     end if;
   end if;
   released := public.create_cash_advance(org,recipient,r.title,r.purpose,r.amount_centavos,draft->>'method',draft->>'reference',null,(draft->>'spaceId')::uuid,release_period);
   update public.cash_advance_requests set status='released', advance_id=(released->>'id')::uuid,
     revision=revision+1 where id=r.id returning * into r;
 else
   raise exception 'This action is unavailable for the request.' using errcode='42501';
 end if;
 return r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_expense_with_private_result(p_org_id uuid, p_expense_id uuid, p_decision text, p_notes text, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actual_revision integer;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = p_org_id
    and profile_id = auth.uid() and status = 'active') then
    raise exception 'Organization access is required.' using errcode = '42501';
  end if;
  select review_revision into actual_revision from public.expenses
    where id = p_expense_id and organization_id = p_org_id for update;
  if not found then
    raise exception 'Expense not found.' using errcode = 'P0002';
  end if;
  if actual_revision is distinct from p_expected_revision then
    raise exception 'This expense was revised. Refresh and review the latest version.' using errcode = '40001';
  end if;
  return public.review_expense_internal(p_org_id, p_expense_id, p_decision, p_notes);
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_liquidation_with_private_result(p_org_id uuid, p_liquidation_id uuid, p_decision text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_liquidation public.liquidations;
  v_advance public.cash_advances;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
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
  where id = p_liquidation_id and organization_id = p_org_id for update;

  if not found then
    raise exception 'Liquidation record not found.';
  end if;

  select * into v_advance
  from public.cash_advances
  where id = v_liquidation.cash_advance_id and organization_id = p_org_id for update;

  if v_liquidation.status <> 'submitted' or v_advance.status <> 'under_review' then
    raise exception 'Only submitted liquidations awaiting review can be reviewed.';
  end if;
  if v_liquidation.submitted_by = v_caller or exists (
    select 1 from public.organization_members where id = v_advance.accountable_person_id and profile_id = v_caller
  ) then
    raise exception 'A different officer must review this liquidation.';
  end if;
  if p_decision = 'rejected' and coalesce(length(trim(p_notes)), 0) < 3 then
    raise exception 'Provide a reason for rejection (at least 3 characters).';
  end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.set_approval_preset(org uuid, preset text, expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_org public.organizations;
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'You cannot archive or restore this record.' using errcode = '42501';
  end if;
 select * into current_org from public.organizations where id=org for update;
 if not found or current_org.closed_at is not null or not exists (
   select 1 from public.organization_members where organization_id=org and profile_id=auth.uid() and status='active' and role='owner'
 ) then raise exception 'Only an active organization owner can update the approval policy.' using errcode='42501'; end if;
 if preset is null or preset not in ('simple','balanced','strict') then
   raise exception 'Choose a valid approval policy.' using errcode='23514';
 end if;
 if current_org.approval_preset_version is distinct from expected_version then
   raise exception 'The policy changed. Refresh and review it again.' using errcode='40001';
 end if;
 if current_org.approval_preset <> preset then
   update public.organizations set approval_preset=preset, approval_preset_version=expected_version+1 where id=org;
   insert into public.audit_logs(organization_id, actor_id, action, entity_id, before_value, after_value)
   values(org, auth.uid(), 'approval_preset_changed', org,
     jsonb_build_object('preset',current_org.approval_preset,'version',expected_version),
     jsonb_build_object('preset',preset,'version',expected_version+1));
   expected_version := expected_version+1;
 end if;
 return jsonb_build_object('approval_preset',preset,'approval_preset_version',expected_version);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_collection_archived(org uuid, collection uuid, archive boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_collection public.collections;
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'You cannot archive or restore this record.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = org
    and profile_id = auth.uid() and status = 'active' and role in ('owner','organization_admin','treasurer')) then
    raise exception 'You cannot archive or restore collections.' using errcode = '42501';
  end if;
  select * into current_collection from public.collections where organization_id = org and id = collection for update;
  if not found then raise exception 'Collection not found.' using errcode = 'P0002'; end if;
  if archive = (current_collection.status = 'archived') then return current_collection.status; end if;
  update public.collections set status = case when archive then 'archived'
    else coalesce(current_collection.pre_archive_status, 'closed') end, updated_at = now()
    where id = collection returning status into current_collection.status;
  return current_collection.status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_expense_approval_policy(p_org_id uuid, p_policy text, p_treasurer boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org public.organizations;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
 if not exists(select 1 from public.organization_members where organization_id=p_org_id and profile_id=auth.uid() and status='active' and role='owner') then raise exception 'Only the owner can change financial approval policies.'; end if;
 if p_policy is null or p_policy not in ('standard','owner_admin_self','strict') or p_treasurer is null then raise exception 'Invalid approval settings.'; end if;
 perform 1 from public.organizations where id=p_org_id for update;
 update public.organizations set expense_approval_policy=p_policy,treasurer_expense_approval=p_treasurer,expense_policy_version=expense_policy_version+1 where id=p_org_id returning * into v_org;
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value) values(p_org_id,auth.uid(),'expense_policy_changed',p_org_id,to_jsonb(v_org));
 return to_jsonb(v_org);
end; $function$;

CREATE OR REPLACE FUNCTION public.set_financial_archive(org uuid, record_id uuid, kind text, archive boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_status text; table_name text;
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'You cannot archive or restore this record.' using errcode = '42501';
  end if;
 if archive is null or not exists(select 1 from public.organization_members
 where organization_id=org and profile_id=auth.uid() and status='active'
 and role in ('owner','organization_admin','treasurer')) then
  raise exception 'You cannot archive or restore this record.' using errcode='42501';
 end if;
 table_name := case kind when 'budget' then 'budgets' when 'expense' then 'expenses' end;
 if table_name is null then raise exception 'Invalid record type.' using errcode='23514'; end if;
 execute format('select status from public.%I where id=$1 and organization_id=$2 for update',table_name)
 into current_status using record_id,org;
 if current_status is null then raise exception 'Record not found.' using errcode='P0002'; end if;
 if archive and ((kind='expense' and current_status in ('pending','verified'))
 or (kind='budget' and (current_status='pending_approval' or exists(select 1 from public.budget_amendments where budget_id=record_id and status='pending')))) then
  raise exception 'Complete the pending review before archiving.' using errcode='23514';
 end if;
 execute format('update public.%I set archived_at=case when $3 then now() else null end where id=$1 and organization_id=$2 and (archived_at is not null) <> $3',table_name)
 using record_id,org,archive;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_member_expense_submission(p_org_id uuid, p_member_id uuid, p_allowed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
 if not exists(select 1 from public.organization_members where organization_id=p_org_id and profile_id=auth.uid() and status='active' and role='owner') then raise exception 'Only the owner can grant submission permission.'; end if;
 update public.organization_members set can_submit_expenses=p_allowed where id=p_member_id and organization_id=p_org_id and role in ('member','student') and status='active';
 if not found then raise exception 'Eligible member not found.'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.submit_liquidation(p_org_id uuid, p_cash_advance_id uuid, p_spent_centavos bigint, p_returned_centavos bigint, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_advance public.cash_advances;
  v_liquidation public.liquidations;
  v_balance bigint;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
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

  if v_role not in ('owner','organization_admin','treasurer') and not exists (
    select 1 from public.organization_members m
    where m.id=v_advance.accountable_person_id and m.organization_id=p_org_id
      and m.profile_id=v_caller and m.status='active'
  ) then
    raise exception 'Only the accountable member or a financial officer may submit liquidation.' using errcode='42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.transfer_organization_ownership(p_org_id uuid, p_target_member_id uuid, p_current_owner_role text DEFAULT 'organization_admin'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_caller_member_id uuid;
  v_target_profile_id uuid;
  v_target_role text;
  v_target_status text;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  if p_current_owner_role not in ('owner', 'organization_admin', 'member') then
    raise exception 'Invalid subsequent role for former owner.';
  end if;

  -- Check caller is an active owner
  select id, role into v_caller_member_id, v_caller_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_caller_role is null or v_caller_role != 'owner' then
    raise exception 'Unauthorized: Only an organization owner can transfer ownership.';
  end if;

  -- Check target member
  select profile_id, role, status into v_target_profile_id, v_target_role, v_target_status
  from public.organization_members
  where id = p_target_member_id and organization_id = p_org_id;

  if v_target_profile_id is null or v_target_status != 'active' then
    raise exception 'Target member must be an active member of this organization.';
  end if;

  if v_target_profile_id = v_caller then
    raise exception 'Cannot transfer ownership to yourself.';
  end if;

  -- Promote target member to owner
  update public.organization_members
  set role = 'owner'
  where id = p_target_member_id;

  -- Update caller's role
  update public.organization_members
  set role = p_current_owner_role
  where id = v_caller_member_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, actor_id, database_actor, action, entity_id, before_value, after_value
  ) values (
    p_org_id, v_caller, session_user, 'transfer_ownership', p_target_member_id,
    jsonb_build_object('from_profile', v_caller, 'to_profile', v_target_profile_id),
    jsonb_build_object('new_owner_role', 'owner', 'previous_owner_new_role', p_current_owner_role)
  );

  return jsonb_build_object(
    'success', true,
    'organization_id', p_org_id,
    'new_owner_member_id', p_target_member_id,
    'new_owner_profile_id', v_target_profile_id,
    'previous_owner_new_role', p_current_owner_role
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_budget(p_org_id uuid, p_budget_id uuid, p_name text, p_allocated_centavos bigint, p_description text DEFAULT NULL::text, p_space_id uuid DEFAULT NULL::uuid, p_period_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_budget public.budgets;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.update_cash_advance(p_org_id uuid, p_advance_id uuid, p_title text, p_purpose text, p_amount_centavos bigint, p_disbursement_method text, p_reference_number text DEFAULT NULL::text, p_budget_id uuid DEFAULT NULL::uuid, p_space_id uuid DEFAULT NULL::uuid, p_period_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_adv public.cash_advances;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to update cash advances.';
  end if;

  select * into v_adv
  from public.cash_advances
  where id = p_advance_id and organization_id = p_org_id;

  if v_adv.id is null then
    raise exception 'Cash advance not found.';
  end if;

  if v_adv.status != 'outstanding' then
    raise exception 'Cannot edit cash advance after liquidation has been submitted.';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Advance amount must be greater than zero.';
  end if;

  update public.cash_advances
  set title = trim(p_title),
      purpose = trim(p_purpose),
      amount_released_centavos = p_amount_centavos,
      disbursement_method = p_disbursement_method,
      reference_number = nullif(trim(p_reference_number), ''),
      budget_id = p_budget_id,
      space_id = p_space_id,
      reporting_period_id = p_period_id,
      updated_at = now()
  where id = p_advance_id and organization_id = p_org_id
  returning * into v_adv;

  return jsonb_build_object(
    'id', v_adv.id,
    'organization_id', v_adv.organization_id,
    'title', v_adv.title,
    'amount_released_centavos', v_adv.amount_released_centavos,
    'status', v_adv.status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_collection(p_org_id uuid, p_collection_id uuid, p_title text, p_description text DEFAULT NULL::text, p_target_centavos bigint DEFAULT 0, p_due_date date DEFAULT NULL::date, p_space_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_coll public.collections;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to update collections for this organization.';
  end if;

  if p_status not in ('active', 'closed', 'archived') then
    raise exception 'Invalid collection status. Must be active, closed, or archived.';
  end if;

  if p_target_centavos < 0 then
    raise exception 'Target collection amount must be non-negative.';
  end if;

  update public.collections
  set title = trim(p_title),
      description = nullif(trim(p_description), ''),
      target_amount_centavos = p_target_centavos,
      due_date = p_due_date,
      space_id = p_space_id,
      status = p_status,
      updated_at = now()
  where id = p_collection_id and organization_id = p_org_id
  returning * into v_coll;

  if v_coll.id is null then
    raise exception 'Collection not found.';
  end if;

  return jsonb_build_object(
    'id', v_coll.id,
    'organization_id', v_coll.organization_id,
    'title', v_coll.title,
    'target_amount_centavos', v_coll.target_amount_centavos,
    'due_date', v_coll.due_date,
    'status', v_coll.status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_expense(p_org_id uuid, p_expense_id uuid, p_title text, p_amount_centavos bigint, p_category text, p_incurred_date date, p_description text DEFAULT NULL::text, p_budget_id uuid DEFAULT NULL::uuid, p_space_id uuid DEFAULT NULL::uuid, p_period_id uuid DEFAULT NULL::uuid, p_receipt_url text DEFAULT NULL::text, p_vendor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_expense public.expenses;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
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

  if v_role is null or v_expense.submitted_by is distinct from v_caller
     or v_expense.status not in ('pending', 'verified', 'rejected') then
    raise exception 'Only the active submitter can revise an expense awaiting review or rejected.' using errcode = '42501';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  update public.expenses
  set status = 'pending',
      review_notes = null,
      title = trim(p_title),
      amount_centavos = p_amount_centavos,
      category = p_category,
      incurred_date = p_incurred_date,
      description = nullif(trim(p_description), ''),
      budget_id = p_budget_id,
      space_id = p_space_id,
      reporting_period_id = p_period_id,
      receipt_url = nullif(trim(p_receipt_url), ''),
      vendor_name = nullif(trim(p_vendor_name), ''),
      updated_at = now()
  where id = p_expense_id and organization_id = p_org_id
  returning * into v_expense;

  return jsonb_build_object(
    'id', v_expense.id,
    'organization_id', v_expense.organization_id,
    'title', v_expense.title,
    'amount_centavos', v_expense.amount_centavos,
    'status', v_expense.status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_space(p_org_id uuid, p_space_id uuid, p_name text, p_description text DEFAULT NULL::text, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_space public.spaces;
begin
  if not public.is_active_org_member(p_org_id, auth.uid()) then
    raise exception 'Only an active organization owner can close this organization.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin') then
    raise exception 'Unauthorized to update spaces for this organization.';
  end if;

  if p_status not in ('active', 'archived') then
    raise exception 'Invalid space status. Must be active or archived.';
  end if;

  update public.spaces
  set name = trim(p_name),
      description = nullif(trim(p_description), ''),
      status = p_status,
      updated_at = now()
  where id = p_space_id and organization_id = p_org_id
  returning * into v_space;

  if v_space.id is null then
    raise exception 'Space not found.';
  end if;

  return jsonb_build_object(
    'id', v_space.id,
    'organization_id', v_space.organization_id,
    'name', v_space.name,
    'description', v_space.description,
    'status', v_space.status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_financial_snapshot(org uuid, snapshot uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_active_org_member(org, auth.uid()) then
    raise exception 'Owner approval required.' using errcode = '42501';
  end if;
  perform 1 from public.organization_members
    where organization_id=org and profile_id=auth.uid() and status='active' and role='owner' for share;
  if not found then raise exception 'Owner approval required.' using errcode='42501'; end if;
  update public.published_financial_snapshots
    set withdrawn_at=now(), withdrawn_by=auth.uid()
    where id=snapshot and organization_id=org and withdrawn_at is null;
  return found;
end;
$function$;


revoke all on function public.emit_due_payment_reminders(uuid, integer) from public, anon;

