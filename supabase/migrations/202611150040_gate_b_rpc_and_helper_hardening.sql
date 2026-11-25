-- Phase 4A Batch 3: Gate B RPC & Authorization Helper Hardening
-- 1. Enforce profile suspension and organization closure/suspension in core auth helpers.
-- 2. Fix NULL NOT IN role bypasses in workspace settings/invite/branding RPCs.
-- 3. Add SET search_path = '' and active/non-suspended checks to 5 financial SECURITY DEFINER RPCs.
-- 4. Fix check_ai_workspace_quota column reference (profile_id via is_active_org_member) and tighten record_ai_usage_log / emit_notifications / check_org_deletability / has_directory_capability.

-- ============================================================================
-- 1. Core Authorization Helpers
-- ============================================================================

create or replace function public.is_org_officer(org_id uuid, user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = org_id
      and m.profile_id = user_id
      and m.status = 'active'
      and m.role in ('owner', 'organization_admin', 'treasurer')
      and o.closed_at is null
      and o.suspended_at is null
      and p.suspended_at is null
  );
$$;

create or replace function public.is_org_admin(org_id uuid, user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = org_id
      and m.profile_id = user_id
      and m.status = 'active'
      and m.role in ('owner', 'organization_admin')
      and o.closed_at is null
      and o.suspended_at is null
      and p.suspended_at is null
  );
$$;

create or replace function public.is_org_comember(target_profile_id uuid, viewer_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m1
    join public.organization_members m2 on m1.organization_id = m2.organization_id
    join public.organizations o on o.id = m1.organization_id
    join public.profiles p on p.id = m1.profile_id
    where m1.profile_id = viewer_user_id
      and m1.status = 'active'
      and m2.profile_id = target_profile_id
      and m2.status = 'active'
      and o.closed_at is null
      and o.suspended_at is null
      and p.suspended_at is null
  );
$$;

create or replace function public.is_platform_admin(required_super boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.suspended_at is null
      and (
        (required_super and p.role = 'super_admin')
        or (not required_super and p.role in ('admin', 'super_admin'))
      )
  );
$$;

create or replace function public.has_directory_capability(target_org uuid, capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.profile_id
    left join public.directory_capability_grants g
      on g.organization_id = m.organization_id
     and g.profile_id = m.profile_id
     and g.capability = $2
    where m.organization_id = target_org
      and m.profile_id = (select auth.uid())
      and m.status = 'active'
      and o.closed_at is null
      and o.suspended_at is null
      and p.suspended_at is null
      and case $2
        when 'view' then m.role in ('owner', 'organization_admin', 'treasurer')
        when 'edit' then m.role in ('owner', 'organization_admin') or (m.role = 'treasurer' and g.capability is not null)
        when 'import' then m.role in ('owner', 'organization_admin') or (m.role = 'treasurer' and g.capability is not null)
        when 'export' then m.role = 'owner' or (m.role in ('organization_admin', 'treasurer') and g.capability is not null)
        when 'financial_view' then m.role in ('owner', 'organization_admin', 'treasurer') or (m.role = 'auditor' and g.capability is not null)
        when 'record_payment' then m.role in ('owner', 'organization_admin', 'treasurer')
        else false
      end
  );
$$;

-- ============================================================================
-- 2. Fix NULL NOT IN Role Bypasses & Suspension Checks in Workspace RPCs
-- ============================================================================

create or replace function public.regenerate_invite_code(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_code text;
  v_old_code text;
begin
  if not public.is_org_admin(p_org_id, auth.uid()) then
    raise exception 'Insufficient permissions to regenerate invite code' using errcode = '42501';
  end if;

  select invite_code into v_old_code from public.organizations where id = p_org_id;
  v_new_code := lower(substr(md5(p_org_id::text || clock_timestamp()::text || random()::text), 1, 8));

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
    jsonb_build_object('invite_code', v_old_code),
    jsonb_build_object('invite_code', v_new_code)
  );

  return jsonb_build_object('invite_code', v_new_code);
end;
$$;

create or replace function public.update_organization(p_org_id uuid, p_name text, p_currency text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_name text;
  v_old_currency text;
  v_clean_name text;
  v_clean_currency text;
begin
  if not public.is_org_admin(p_org_id, auth.uid()) then
    raise exception 'Insufficient permissions to update workspace settings' using errcode = '42501';
  end if;

  v_clean_name := trim(p_name);
  if length(v_clean_name) < 1 or length(v_clean_name) > 150 then
    raise exception 'Organization name must be between 1 and 150 characters';
  end if;

  select name, currency into v_old_name, v_old_currency from public.organizations where id = p_org_id;

  v_clean_currency := upper(trim(coalesce(p_currency, v_old_currency)));
  if length(v_clean_currency) != 3 then
    raise exception 'Currency must be a 3-letter code';
  end if;

  update public.organizations
  set name = v_clean_name,
      currency = v_clean_currency
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'update_organization',
    p_org_id,
    jsonb_build_object('name', v_old_name, 'currency', v_old_currency),
    jsonb_build_object('name', v_clean_name, 'currency', v_clean_currency)
  );

  return jsonb_build_object(
    'id', p_org_id,
    'name', v_clean_name,
    'currency', v_clean_currency
  );
end;
$$;

create or replace function public.update_organization_profile(p_org_id uuid, p_name text, p_currency text, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_name text;
  v_old_description text;
  v_old_currency text;
  v_clean_name text;
  v_clean_currency text;
begin
  if not public.is_org_admin(p_org_id, auth.uid()) then
    raise exception 'Insufficient permissions to update workspace settings' using errcode = '42501';
  end if;

  v_clean_name := trim(p_name);
  if length(v_clean_name) < 1 or length(v_clean_name) > 150 then
    raise exception 'Organization name must be between 1 and 150 characters';
  end if;

  select name, currency, description into v_old_name, v_old_currency, v_old_description from public.organizations where id = p_org_id for update;

  v_clean_currency := upper(trim(coalesce(p_currency, v_old_currency)));
  if length(v_clean_currency) != 3 then
    raise exception 'Currency must be a 3-letter code';
  end if;

  update public.organizations
  set name = v_clean_name,
      currency = v_clean_currency,
      description = nullif(trim(p_description), '')
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'update_organization',
    p_org_id,
    jsonb_build_object('name', v_old_name, 'currency', v_old_currency, 'description', v_old_description),
    jsonb_build_object('name', v_clean_name, 'currency', v_clean_currency, 'description', nullif(trim(p_description), ''))
  );

  return jsonb_build_object(
    'id', p_org_id,
    'name', v_clean_name,
    'currency', v_clean_currency
  );
end;
$$;

create or replace function public.update_organization_cover(p_org_id uuid, p_cover_image_url text default null, p_cover_theme text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_image text;
  v_old_theme text;
  v_new_image text;
  v_new_theme text;
begin
  if not public.is_org_admin(p_org_id, auth.uid()) then
    raise exception 'Insufficient permissions to update workspace cover' using errcode = '42501';
  end if;

  select cover_image_url, cover_theme
  into v_old_image, v_old_theme
  from public.organizations
  where id = p_org_id;

  v_new_image := nullif(trim(p_cover_image_url), '');
  v_new_theme := nullif(trim(p_cover_theme), '');

  update public.organizations
  set
    cover_image_url = v_new_image,
    cover_theme = v_new_theme
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'update_organization_cover',
    p_org_id,
    jsonb_build_object('cover_image_url', v_old_image, 'cover_theme', v_old_theme),
    jsonb_build_object('cover_image_url', v_new_image, 'cover_theme', v_new_theme)
  );

  return jsonb_build_object(
    'success', true,
    'cover_image_url', v_new_image,
    'cover_theme', v_new_theme
  );
end;
$$;

create or replace function public.update_organization_logo(p_org_id uuid, p_logo_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_logo text;
begin
  if not public.is_org_admin(p_org_id, auth.uid()) then
    raise exception 'Insufficient permissions to update workspace logo' using errcode = '42501';
  end if;

  select logo_url into v_old_logo from public.organizations where id = p_org_id;

  update public.organizations
  set logo_url = nullif(trim(p_logo_url), '')
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'update_organization_logo',
    p_org_id,
    jsonb_build_object('logo_url', v_old_logo),
    jsonb_build_object('logo_url', nullif(trim(p_logo_url), ''))
  );

  return jsonb_build_object('success', true, 'logo_url', nullif(trim(p_logo_url), ''));
end;
$$;

-- ============================================================================
-- 3. Notifications, Org Deletability, and AI Quota / Telemetry Hardening
-- ============================================================================

create or replace function public.emit_notifications(
  p_recipient_ids uuid[],
  p_organization_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_metadata jsonb default '{}'::jsonb,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_dedupe_prefix text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_recipient uuid;
  v_inserted integer := 0;
  v_dedupe text;
begin
  if v_caller is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = v_caller and p.suspended_at is null
  ) then
    raise exception 'Active account required.' using errcode = '42501';
  end if;

  if p_organization_id is not null then
    if not public.is_active_org_member(p_organization_id, v_caller) then
      raise exception 'Active organization membership is required.' using errcode = '42501';
    end if;

    select role into v_caller_role
    from public.organization_members
    where organization_id = p_organization_id
      and profile_id = v_caller
      and status = 'active';

    if p_type = 'organization.invitation_created' and v_caller_role not in ('owner', 'organization_admin') then
      raise exception 'Only owners and organization admins can emit invitation notifications.' using errcode = '42501';
    end if;
  end if;

  if p_recipient_ids is null or coalesce(array_length(p_recipient_ids, 1), 0) = 0 then
    return 0;
  end if;

  foreach v_recipient in array p_recipient_ids loop
    continue when v_recipient is null or v_recipient = v_caller;
    continue when not exists (select 1 from public.profiles where id = v_recipient);

    if p_organization_id is not null and p_type <> 'organization.invitation_created' then
      continue when not public.is_active_org_member(p_organization_id, v_recipient);
    end if;

    v_dedupe := case
      when p_dedupe_prefix is not null and length(trim(p_dedupe_prefix)) > 0
      then trim(p_dedupe_prefix) || ':' || v_recipient::text
      else null
    end;

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
    )
    values (
      v_recipient,
      p_organization_id,
      v_caller,
      trim(p_type),
      left(trim(p_title), 200),
      left(trim(p_message), 1000),
      coalesce(p_metadata, '{}'::jsonb),
      p_entity_type,
      p_entity_id,
      v_dedupe
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

create or replace function public.check_org_deletability(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_unliquidated_count int := 0;
  v_unliquidated_centavos bigint := 0;
  v_is_deletable boolean := true;
  v_reasons text[] := array[]::text[];
  v_members_count int := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_active_org_member(p_org_id, v_caller) then
    raise exception 'You are not an active member of this organization.' using errcode = '42501';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role != 'owner' then
    raise exception 'Only an organization owner can check organization closure eligibility.' using errcode = '42501';
  end if;

  select count(*), coalesce(sum(unsettled + discrepancy), 0)
  into v_unliquidated_count, v_unliquidated_centavos
  from public.advance_accounting
  where organization_id = p_org_id
    and (unsettled > 0 or discrepancy > 0);

  if v_unliquidated_count > 0 then
    v_is_deletable := false;
    v_reasons := array_append(v_reasons, format('Cannot close organization with %s unsettled advance(s) or unresolved shortage(s) totaling %s centavos. All cash advances must be liquidated or settled first.', v_unliquidated_count, v_unliquidated_centavos));
  end if;

  select count(*) into v_members_count
  from public.organization_members
  where organization_id = p_org_id and status = 'active';

  return jsonb_build_object(
    'organization_id', p_org_id,
    'is_deletable', v_is_deletable,
    'unliquidated_count', v_unliquidated_count,
    'unliquidated_amount_centavos', v_unliquidated_centavos,
    'members_count', v_members_count,
    'reasons', v_reasons
  );
end;
$$;

create or replace function public.check_ai_workspace_quota(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ai_enabled boolean := true;
  v_daily_limit integer := 200;
  v_monthly_limit bigint := 2000000;
  v_daily_requests bigint := 0;
  v_monthly_tokens bigint := 0;
  v_allowed boolean := true;
  v_reason text := null;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.is_active_org_member(p_organization_id, v_user_id) then
    raise exception 'Organization membership required' using errcode = '42501';
  end if;

  select
    q.ai_enabled,
    q.daily_request_limit,
    q.monthly_token_limit
  into v_ai_enabled, v_daily_limit, v_monthly_limit
  from public.ai_workspace_quotas q
  where q.organization_id = p_organization_id;

  v_ai_enabled := coalesce(v_ai_enabled, true);
  v_daily_limit := coalesce(v_daily_limit, 200);
  v_monthly_limit := coalesce(v_monthly_limit, 2000000);

  select count(*)
  into v_daily_requests
  from public.ai_usage_logs l
  where l.organization_id = p_organization_id
    and l.created_at >= date_trunc('day', now())
    and l.status in ('success', 'error', 'aborted');

  select coalesce(sum(l.total_tokens), 0)
  into v_monthly_tokens
  from public.ai_usage_logs l
  where l.organization_id = p_organization_id
    and l.created_at >= date_trunc('month', now());

  if not v_ai_enabled then
    v_allowed := false;
    v_reason := 'ai_disabled';
  elsif v_daily_limit > 0 and v_daily_requests >= v_daily_limit then
    v_allowed := false;
    v_reason := 'daily_request_limit_exceeded';
  elsif v_monthly_limit > 0 and v_monthly_tokens >= v_monthly_limit then
    v_allowed := false;
    v_reason := 'monthly_token_limit_exceeded';
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'ai_enabled', v_ai_enabled,
    'daily_requests_used', v_daily_requests,
    'daily_request_limit', v_daily_limit,
    'monthly_tokens_used', v_monthly_tokens,
    'monthly_token_limit', v_monthly_limit
  );
end;
$$;

create or replace function public.trigger_workspace_due_reminders(p_org_id uuid, p_days_ahead integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_officer(p_org_id, auth.uid()) then
    raise exception 'Only workspace officers can trigger payment reminders.' using errcode = '42501';
  end if;

  return public.emit_due_payment_reminders(p_org_id, p_days_ahead);
end;
$$;

-- ============================================================================
-- 4. Pin SET search_path = '' & Active/Non-Suspended Checks on 5 Financial RPCs
-- ============================================================================

create or replace function public.create_budget(
  p_org_id uuid,
  p_name text,
  p_allocated_centavos bigint,
  p_description text default null,
  p_space_id uuid default null,
  p_period_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org_currency char(3);
  v_budget public.budgets;
begin
  if v_caller is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_org_officer(p_org_id, v_caller) then
    raise exception 'Unauthorized to create budgets for this organization.' using errcode = '42501';
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org_currency char(3);
  v_advance public.cash_advances;
begin
  if v_caller is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_org_officer(p_org_id, v_caller) then
    raise exception 'Unauthorized to release cash advances.' using errcode = '42501';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Advance amount must be greater than zero.';
  end if;

  if not exists (
    select 1 from public.organization_members
    where id = p_accountable_person_id and organization_id = p_org_id and status = 'active'
  ) then
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org_currency char(3);
  v_collection public.collections;
  v_assigned_count int := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_org_officer(p_org_id, v_caller) then
    raise exception 'Unauthorized to create collections for this organization.' using errcode = '42501';
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

  if p_assign_all then
    raise exception 'Create the collection first, then assign dues from the member directory.' using errcode = '23514';
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

create or replace function public.reverse_payment(p_org_id uuid, p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_payment public.payments;
begin
  if v_caller is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_org_officer(p_org_id, v_caller) then
    raise exception 'Unauthorized to reverse payments.' using errcode = '42501';
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org_currency char(3);
  v_expense public.expenses;
begin
  if v_caller is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_active_org_member(p_org_id, v_caller) then
    raise exception 'Unauthorized to submit expenses for this organization.' using errcode = '42501';
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
