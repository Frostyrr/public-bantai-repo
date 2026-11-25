-- Account/workspace suspension controls, enriched directory health, and privacy-preserving aggregate financial oversight.
begin;

alter table public.profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references public.profiles(id) on delete set null,
  add column if not exists suspension_reason text;

alter table public.organizations
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references public.profiles(id) on delete set null,
  add column if not exists suspension_reason text;

create index if not exists profiles_suspended_idx on public.profiles(suspended_at) where suspended_at is not null;
create index if not exists organizations_suspended_idx on public.organizations(suspended_at) where suspended_at is not null;

-- Block mutations on platform-suspended organizations.
create or replace function public.guard_suspended_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suspended timestamptz;
  v_org_id uuid;
begin
  v_org_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  select suspended_at into v_suspended from public.organizations where id = v_org_id for share;
  if v_suspended is not null then
    raise exception 'This organization is currently suspended by platform administration.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_suspended_organization() from public, anon, authenticated;

do $$
declare tab text;
begin
  foreach tab in array array[
    'collections', 'obligations', 'payments', 'budgets', 'expenses',
    'cash_advances', 'liquidations', 'spaces', 'reporting_periods'
  ] loop
    execute format('drop trigger if exists suspended_organization_guard on public.%I', tab);
    execute format(
      'create trigger suspended_organization_guard before insert or update or delete on public.%I for each row execute function public.guard_suspended_organization()',
      tab
    );
  end loop;
end;
$$;

-- Platform admin: suspend or restore a user account (reason required for suspension, audited).
create or replace function public.platform_admin_set_user_suspension(
  p_target_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_target public.profiles;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_super_count bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  if p_target_user_id = v_actor then
    raise exception 'Cannot suspend your own account';
  end if;

  if p_suspended and (v_reason is null or length(v_reason) < 3) then
    raise exception 'Suspension reason of at least 3 characters is required';
  end if;

  select * into v_target
  from public.profiles
  where id = p_target_user_id
  for update;

  if not found then
    raise exception 'User profile not found';
  end if;

  if v_target.role in ('admin', 'super_admin') and not public.is_platform_admin(true) then
    raise exception 'Super administrator access required to suspend an administrator';
  end if;

  if p_suspended and v_target.role = 'super_admin' then
    select count(*) into v_super_count from public.profiles where role = 'super_admin' and suspended_at is null;
    if v_super_count <= 1 then
      raise exception 'Cannot suspend the last active super_admin';
    end if;
  end if;

  update public.profiles
  set
    suspended_at = case when p_suspended then now() else null end,
    suspended_by = case when p_suspended then v_actor else null end,
    suspension_reason = case when p_suspended then left(v_reason, 500) else null end
  where id = p_target_user_id;

  insert into public.audit_logs (organization_id, actor_id, action, entity_id, before_value, after_value)
  values (
    null,
    v_actor,
    case when p_suspended then 'platform_user_suspended' else 'platform_user_restored' end,
    p_target_user_id,
    jsonb_build_object('suspended_at', v_target.suspended_at, 'reason', v_target.suspension_reason),
    jsonb_build_object('suspended', p_suspended, 'reason', v_reason)
  );

  insert into public.security_events (category, severity, action, actor_id, http_status, outcome, metadata)
  values (
    'access_control',
    case when p_suspended then 'high' else 'low' end,
    case when p_suspended then 'platform_user_suspended' else 'platform_user_restored' end,
    v_actor,
    200,
    'flagged',
    jsonb_build_object('target_user_id', p_target_user_id, 'reason', v_reason)
  );

  return jsonb_build_object(
    'user_id', p_target_user_id,
    'suspended', p_suspended,
    'reason', v_reason
  );
end;
$$;

-- Platform admin: suspend or restore a workspace/organization (reason required, audited).
create or replace function public.platform_admin_set_org_suspension(
  p_org_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org public.organizations;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  if p_suspended and (v_reason is null or length(v_reason) < 3) then
    raise exception 'Suspension reason of at least 3 characters is required';
  end if;

  select * into v_org
  from public.organizations
  where id = p_org_id
  for update;

  if not found then
    raise exception 'Organization not found';
  end if;

  update public.organizations
  set
    suspended_at = case when p_suspended then now() else null end,
    suspended_by = case when p_suspended then v_actor else null end,
    suspension_reason = case when p_suspended then left(v_reason, 500) else null end
  where id = p_org_id;

  insert into public.audit_logs (organization_id, actor_id, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    v_actor,
    case when p_suspended then 'platform_org_suspended' else 'platform_org_restored' end,
    p_org_id,
    jsonb_build_object('suspended_at', v_org.suspended_at, 'reason', v_org.suspension_reason),
    jsonb_build_object('suspended', p_suspended, 'reason', v_reason)
  );

  insert into public.security_events (category, severity, action, actor_id, organization_id, http_status, outcome, metadata)
  values (
    'access_control',
    case when p_suspended then 'high' else 'low' end,
    case when p_suspended then 'platform_org_suspended' else 'platform_org_restored' end,
    v_actor,
    p_org_id,
    200,
    'flagged',
    jsonb_build_object('organization_name', v_org.name, 'reason', v_reason)
  );

  return jsonb_build_object(
    'organization_id', p_org_id,
    'suspended', p_suspended,
    'reason', v_reason
  );
end;
$$;

-- Enrich platform_admin_list_users with suspension status.
create or replace function public.platform_admin_list_users(
  p_search text default '',
  p_role text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := trim(coalesce(p_search, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_users jsonb;
  v_total bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select count(*)
  into v_total
  from public.profiles p
  left join auth.users u on u.id = p.id
  where (p_role is null or p.role = p_role)
    and (
      v_search = ''
      or coalesce(p.display_name, '') ilike '%' || v_search || '%'
      or coalesce(u.email, '') ilike '%' || v_search || '%'
      or p.id::text ilike v_search || '%'
    );

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_users
  from (
    select jsonb_build_object(
      'id', p.id,
      'email', u.email,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'role', p.role,
      'created_at', p.created_at,
      'suspended_at', p.suspended_at,
      'suspension_reason', p.suspension_reason,
      'organization_count', (
        select count(*)
        from public.organization_members m
        where m.profile_id = p.id and m.status = 'active'
      )
    ) as row_obj
    from public.profiles p
    left join auth.users u on u.id = p.id
    where (p_role is null or p.role = p_role)
      and (
        v_search = ''
        or coalesce(p.display_name, '') ilike '%' || v_search || '%'
        or coalesce(u.email, '') ilike '%' || v_search || '%'
        or p.id::text ilike v_search || '%'
      )
    order by p.created_at desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('users', v_users, 'total', v_total);
end;
$$;

-- Enrich platform_admin_list_organizations with suspension, closure, incident, and pending approval counts.
create or replace function public.platform_admin_list_organizations(
  p_search text default '',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := trim(coalesce(p_search, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_orgs jsonb;
  v_total bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select count(*)
  into v_total
  from public.organizations o
  where v_search = ''
     or o.name ilike '%' || v_search || '%'
     or o.id::text ilike v_search || '%';

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_orgs
  from (
    select jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'organization_type', o.organization_type,
      'currency', o.currency,
      'time_zone', o.time_zone,
      'created_at', o.created_at,
      'closed_at', o.closed_at,
      'suspended_at', o.suspended_at,
      'suspension_reason', o.suspension_reason,
      'active_member_count', (
        select count(*)
        from public.organization_members m
        where m.organization_id = o.id and m.status = 'active'
      ),
      'open_incidents_count', (
        select count(*)
        from public.security_incidents si
        where si.organization_id = o.id and si.status in ('open', 'investigating')
      ),
      'pending_approvals_count', (
        (select count(*) from public.expenses e where e.organization_id = o.id and e.status in ('pending', 'verified'))
        + (select count(*) from public.cash_advances ca where ca.organization_id = o.id and ca.status = 'under_review')
      ),
      'creator_id', owner_info.profile_id,
      'creator_name', owner_info.display_name,
      'creator_email', owner_info.email
    ) as row_obj
    from public.organizations o
    left join lateral (
      select m.profile_id, p.display_name, u.email
      from public.organization_members m
      join public.profiles p on p.id = m.profile_id
      left join auth.users u on u.id = m.profile_id
      where m.organization_id = o.id and m.status = 'active'
      order by case when m.role = 'owner' then 0 else 1 end, m.created_at asc
      limit 1
    ) owner_info on true
    where v_search = ''
       or o.name ilike '%' || v_search || '%'
       or o.id::text ilike v_search || '%'
    order by o.created_at desc
    limit v_limit
    offset v_offset
  ) sub;

  return jsonb_build_object('organizations', v_orgs, 'total', v_total);
end;
$$;

-- Privacy-preserving aggregate financial oversight grouped by currency (zero private line items).
create or replace function public.platform_admin_financial_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_by_currency jsonb;
  v_active_orgs bigint;
  v_suspended_orgs bigint;
  v_closed_orgs bigint;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select
    count(*) filter (where closed_at is null and suspended_at is null),
    count(*) filter (where suspended_at is not null),
    count(*) filter (where closed_at is not null)
  into v_active_orgs, v_suspended_orgs, v_closed_orgs
  from public.organizations;

  with currencies as (
    select distinct currency from public.organizations
    union select distinct currency from public.budgets
    union select distinct currency from public.expenses
    union select distinct currency from public.cash_advances
    union select distinct currency from public.collections
  ),
  pay_agg as (
    select c.currency, coalesce(sum(p.amount_centavos), 0) as collected
    from public.payments p
    join public.collections c on c.id = p.collection_id
    where p.status = 'completed'
    group by c.currency
  ),
  bud_agg as (
    select currency, coalesce(sum(allocated_amount_centavos), 0) as allocated
    from public.budgets
    where status = 'active'
    group by currency
  ),
  exp_agg as (
    select
      currency,
      coalesce(sum(amount_centavos) filter (where status = 'approved'), 0) as approved_expenses,
      count(*) filter (where status in ('pending', 'verified')) as pending_count,
      coalesce(sum(amount_centavos) filter (where status in ('pending', 'verified')), 0) as pending_centavos
    from public.expenses
    group by currency
  ),
  ca_agg as (
    select
      currency,
      count(*) filter (where status in ('outstanding', 'under_review', 'disputed')) as open_count,
      coalesce(sum(amount_released_centavos) filter (where status in ('outstanding', 'under_review', 'disputed')), 0) as open_centavos,
      count(*) filter (where status = 'disputed') as disputed_count
    from public.cash_advances
    group by currency
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'currency', cur.currency,
    'collected_centavos', coalesce(pa.collected, 0),
    'budget_allocated_centavos', coalesce(ba.allocated, 0),
    'approved_expenses_centavos', coalesce(ea.approved_expenses, 0),
    'pending_expenses_count', coalesce(ea.pending_count, 0),
    'pending_expenses_centavos', coalesce(ea.pending_centavos, 0),
    'open_advances_count', coalesce(ca.open_count, 0),
    'open_advances_centavos', coalesce(ca.open_centavos, 0),
    'disputed_advances_count', coalesce(ca.disputed_count, 0)
  ) order by cur.currency), '[]'::jsonb)
  into v_by_currency
  from currencies cur
  left join pay_agg pa on pa.currency = cur.currency
  left join bud_agg ba on ba.currency = cur.currency
  left join exp_agg ea on ea.currency = cur.currency
  left join ca_agg ca on ca.currency = cur.currency;

  return jsonb_build_object(
    'workspace_status', jsonb_build_object(
      'active', v_active_orgs,
      'suspended', v_suspended_orgs,
      'closed', v_closed_orgs
    ),
    'by_currency', v_by_currency
  );
end;
$$;

-- Deterministic workspace-level financial compliance & anomaly flags (counts only, no private line-item details).
create or replace function public.platform_admin_financial_anomalies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_anomalies jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  with budget_usage as (
    select
      b.organization_id,
      b.id as budget_id,
      b.allocated_amount_centavos,
      coalesce((
        select sum(e.amount_centavos) from public.expenses e
        where e.budget_id = b.id and e.status = 'approved'
      ), 0) + coalesce((
        select sum(ca.amount_released_centavos) from public.cash_advances ca
        where ca.budget_id = b.id and ca.status in ('outstanding', 'under_review', 'disputed')
      ), 0) as committed_centavos
    from public.budgets b
    where b.status = 'active'
  ),
  org_flags as (
    select
      o.id as organization_id,
      o.name as organization_name,
      o.currency,
      coalesce((select count(*) from budget_usage bu where bu.organization_id = o.id and bu.committed_centavos > bu.allocated_amount_centavos), 0) as over_budget_count,
      coalesce((select count(*) from public.cash_advances ca where ca.organization_id = o.id and ca.status = 'disputed'), 0) as disputed_advances_count,
      coalesce((select count(*) from public.expenses e where e.organization_id = o.id and e.status in ('pending', 'verified')), 0) as pending_expenses_count,
      coalesce((select count(*) from public.payments p where p.organization_id = o.id and p.status = 'reversed'), 0) as reversed_payments_count
    from public.organizations o
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'organization_id', organization_id,
    'organization_name', organization_name,
    'currency', currency,
    'over_budget_count', over_budget_count,
    'disputed_advances_count', disputed_advances_count,
    'pending_expenses_count', pending_expenses_count,
    'reversed_payments_count', reversed_payments_count
  ) order by (over_budget_count * 5 + disputed_advances_count * 4 + reversed_payments_count * 2 + pending_expenses_count) desc), '[]'::jsonb)
  into v_anomalies
  from org_flags
  where over_budget_count > 0
     or disputed_advances_count > 0
     or pending_expenses_count >= 5
     or reversed_payments_count >= 3;

  return jsonb_build_object('anomalies', v_anomalies);
end;
$$;

revoke all on function public.platform_admin_set_user_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.platform_admin_set_user_suspension(uuid, boolean, text) to authenticated;

revoke all on function public.platform_admin_set_org_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.platform_admin_set_org_suspension(uuid, boolean, text) to authenticated;

revoke all on function public.platform_admin_financial_overview() from public, anon;
grant execute on function public.platform_admin_financial_overview() to authenticated;

revoke all on function public.platform_admin_financial_anomalies() from public, anon;
grant execute on function public.platform_admin_financial_anomalies() to authenticated;

commit;
