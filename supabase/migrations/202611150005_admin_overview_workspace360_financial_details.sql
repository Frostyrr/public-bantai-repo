-- Platform attention summary, Workspace 360° view, and aggregate financial compliance RPCs.
begin;

create or replace function public.platform_admin_attention_summary(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_active_workspaces bigint;
  v_open_alerts bigint;
  v_suspended_accounts bigint;
  v_suspended_workspaces bigint;
  v_financial_exceptions bigint;
  v_activity_trend jsonb;
  v_attention_items jsonb := '[]'::jsonb;
  v_incidents jsonb;
  v_susp_users jsonb;
  v_susp_orgs jsonb;
  v_fin_items jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  select
    count(*) filter (where closed_at is null and suspended_at is null),
    count(*) filter (where suspended_at is not null)
  into v_active_workspaces, v_suspended_workspaces
  from public.organizations;

  select count(*) into v_open_alerts
  from public.security_incidents
  where status in ('open', 'investigating');

  select count(*) into v_suspended_accounts
  from public.profiles
  where suspended_at is not null;

  with budget_usage as (
    select
      b.organization_id,
      b.allocated_amount_centavos,
      coalesce((select sum(e.amount_centavos) from public.expenses e where e.budget_id = b.id and e.status = 'approved'), 0)
      + coalesce((select sum(ca.amount_released_centavos) from public.cash_advances ca where ca.budget_id = b.id and ca.status in ('outstanding', 'under_review', 'disputed')), 0) as committed_centavos
    from public.budgets b
    where b.status = 'active'
  ),
  org_flags as (
    select
      o.id,
      (select count(*) from budget_usage bu where bu.organization_id = o.id and bu.committed_centavos > bu.allocated_amount_centavos) as over_budget,
      (select count(*) from public.cash_advances ca where ca.organization_id = o.id and ca.status = 'disputed') as disputed_adv,
      (select count(*) from public.expenses e where e.organization_id = o.id and e.status in ('pending', 'verified')) as pending_exp,
      (select count(*) from public.payments p where p.organization_id = o.id and p.status = 'reversed') as rev_pay
    from public.organizations o
  )
  select count(*) into v_financial_exceptions
  from org_flags
  where over_budget > 0 or disputed_adv > 0 or pending_exp >= 5 or rev_pay >= 3;

  with audit_daily as (
    select date_trunc('day', occurred_at at time zone 'UTC') as d, count(*) as cnt
    from public.audit_logs
    where occurred_at >= v_since
    group by 1
  ),
  sec_daily as (
    select date_trunc('day', occurred_at at time zone 'UTC') as d, count(*) as cnt
    from public.security_events
    where occurred_at >= v_since
    group by 1
  ),
  all_days as (
    select generate_series(
      date_trunc('day', now() at time zone 'UTC') - make_interval(days => v_days - 1),
      date_trunc('day', now() at time zone 'UTC'),
      interval '1 day'
    ) as d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', to_char(ad.d, 'YYYY-MM-DD'),
    'audit_events', coalesce(au.cnt, 0),
    'security_events', coalesce(se.cnt, 0)
  ) order by ad.d), '[]'::jsonb)
  into v_activity_trend
  from all_days ad
  left join audit_daily au on au.d = ad.d
  left join sec_daily se on se.d = ad.d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'type', 'incident',
    'id', id::text,
    'title', title,
    'subtitle', 'Security incident (' || status || ')',
    'severity', severity
  )), '[]'::jsonb)
  into v_incidents
  from (
    select id, title, status, severity
    from public.security_incidents
    where status in ('open', 'investigating')
    order by detected_at desc
    limit 4
  ) sub;

  select coalesce(jsonb_agg(jsonb_build_object(
    'type', 'suspended_user',
    'id', id::text,
    'title', coalesce(display_name, 'Suspended Account'),
    'subtitle', coalesce(suspension_reason, 'Account restricted'),
    'severity', 'high'
  )), '[]'::jsonb)
  into v_susp_users
  from (
    select id, display_name, suspension_reason
    from public.profiles
    where suspended_at is not null
    order by suspended_at desc
    limit 2
  ) sub;

  select coalesce(jsonb_agg(jsonb_build_object(
    'type', 'suspended_workspace',
    'id', id::text,
    'title', name,
    'subtitle', coalesce(suspension_reason, 'Workspace suspended'),
    'severity', 'high'
  )), '[]'::jsonb)
  into v_susp_orgs
  from (
    select id, name, suspension_reason
    from public.organizations
    where suspended_at is not null
    order by suspended_at desc
    limit 2
  ) sub;

  with budget_usage as (
    select
      b.organization_id,
      b.allocated_amount_centavos,
      coalesce((select sum(e.amount_centavos) from public.expenses e where e.budget_id = b.id and e.status = 'approved'), 0)
      + coalesce((select sum(ca.amount_released_centavos) from public.cash_advances ca where ca.budget_id = b.id and ca.status in ('outstanding', 'under_review', 'disputed')), 0) as committed_centavos
    from public.budgets b
    where b.status = 'active'
  ),
  org_flags as (
    select
      o.id,
      o.name,
      (select count(*) from budget_usage bu where bu.organization_id = o.id and bu.committed_centavos > bu.allocated_amount_centavos) as over_budget,
      (select count(*) from public.cash_advances ca where ca.organization_id = o.id and ca.status = 'disputed') as disputed_adv
    from public.organizations o
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', 'financial_exception',
    'id', id::text,
    'title', name,
    'subtitle',
      case
        when over_budget > 0 and disputed_adv > 0 then over_budget || ' over-budget, ' || disputed_adv || ' disputed advance(s)'
        when over_budget > 0 then over_budget || ' over-budget allocation(s)'
        else disputed_adv || ' disputed cash advance(s)'
      end,
    'severity', case when over_budget > 0 then 'high' else 'medium' end
  )), '[]'::jsonb)
  into v_fin_items
  from (
    select id, name, over_budget, disputed_adv
    from org_flags
    where over_budget > 0 or disputed_adv > 0
    order by over_budget desc, disputed_adv desc
    limit 3
  ) sub;

  v_attention_items := v_incidents || v_fin_items || v_susp_users || v_susp_orgs;

  return jsonb_build_object(
    'window_days', v_days,
    'active_workspaces', v_active_workspaces,
    'open_security_alerts', v_open_alerts,
    'financial_exceptions_count', v_financial_exceptions,
    'suspended_accounts', v_suspended_accounts,
    'suspended_workspaces', v_suspended_workspaces,
    'activity_trend', v_activity_trend,
    'attention_items', v_attention_items
  );
end;
$$;

create or replace function public.platform_admin_workspace_360(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace jsonb;
  v_roles jsonb;
  v_financial jsonb;
  v_incidents jsonb;
  v_audits jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

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
      select count(*) from public.organization_members m
      where m.organization_id = o.id and m.status = 'active'
    ),
    'creator_id', owner_info.profile_id,
    'creator_name', owner_info.display_name,
    'creator_email', owner_info.email
  )
  into v_workspace
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
  where o.id = p_org_id;

  if v_workspace is null then
    raise exception 'Organization not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'count', cnt) order by cnt desc), '[]'::jsonb)
  into v_roles
  from (
    select role, count(*) as cnt
    from public.organization_members
    where organization_id = p_org_id and status = 'active'
    group by role
  ) sub;

  -- Privacy-preserving aggregate financial totals for this workspace only.
  select jsonb_build_object(
    'currency', (select currency from public.organizations where id = p_org_id),
    'collected_centavos', coalesce((select sum(amount_centavos) from public.payments where organization_id = p_org_id and status = 'completed'), 0),
    'budget_allocated_centavos', coalesce((select sum(allocated_amount_centavos) from public.budgets where organization_id = p_org_id and status = 'active'), 0),
    'approved_expenses_centavos', coalesce((select sum(amount_centavos) from public.expenses where organization_id = p_org_id and status = 'approved'), 0),
    'pending_approvals_count', (
      (select count(*) from public.expenses where organization_id = p_org_id and status in ('pending', 'verified'))
      + (select count(*) from public.cash_advances where organization_id = p_org_id and status = 'under_review')
    ),
    'open_advances_centavos', coalesce((select sum(amount_released_centavos) from public.cash_advances where organization_id = p_org_id and status in ('outstanding', 'under_review', 'disputed')), 0),
    'disputed_advances_count', (select count(*) from public.cash_advances where organization_id = p_org_id and status = 'disputed')
  )
  into v_financial;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', si.id,
    'title', si.title,
    'category', si.category,
    'severity', si.severity,
    'status', si.status,
    'detected_at', si.detected_at
  ) order by si.detected_at desc), '[]'::jsonb)
  into v_incidents
  from (
    select id, title, category, severity, status, detected_at
    from public.security_incidents
    where organization_id = p_org_id
    order by detected_at desc
    limit 10
  ) si;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'action', a.action,
    'actor_name', p.display_name,
    'occurred_at', a.occurred_at
  ) order by a.occurred_at desc), '[]'::jsonb)
  into v_audits
  from (
    select id, action, actor_id, occurred_at
    from public.audit_logs
    where organization_id = p_org_id
    order by occurred_at desc, id desc
    limit 12
  ) a
  left join public.profiles p on p.id = a.actor_id;

  return jsonb_build_object(
    'workspace', v_workspace,
    'role_distribution', v_roles,
    'financial_summary', v_financial,
    'incidents', v_incidents,
    'recent_audit_logs', v_audits
  );
end;
$$;

create or replace function public.platform_admin_financial_compliance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_budget_compliance jsonb;
  v_approval_breakdown jsonb;
  v_liquidation_aging jsonb;
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;

  with org_budgets as (
    select
      o.id as organization_id,
      o.name as organization_name,
      o.currency,
      coalesce((select sum(b.allocated_amount_centavos) from public.budgets b where b.organization_id = o.id and b.status = 'active'), 0) as allocated_centavos,
      coalesce((select sum(e.amount_centavos) from public.expenses e where e.organization_id = o.id and e.status = 'approved'), 0)
      + coalesce((select sum(ca.amount_released_centavos) from public.cash_advances ca where ca.organization_id = o.id and ca.status in ('outstanding', 'under_review', 'disputed')), 0) as committed_centavos
    from public.organizations o
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'organization_id', organization_id,
    'organization_name', organization_name,
    'currency', currency,
    'allocated_centavos', allocated_centavos,
    'committed_centavos', committed_centavos,
    'utilization_pct', case when allocated_centavos > 0 then round((committed_centavos::numeric / allocated_centavos::numeric) * 100, 1) else 0 end
  ) order by (case when allocated_centavos > 0 then committed_centavos::numeric / allocated_centavos::numeric else 0 end) desc), '[]'::jsonb)
  into v_budget_compliance
  from (
    select * from org_budgets where allocated_centavos > 0 or committed_centavos > 0 limit 10
  ) sub;

  select jsonb_build_object(
    'pending_count', count(*) filter (where status = 'pending'),
    'verified_count', count(*) filter (where status = 'verified'),
    'approved_count', count(*) filter (where status = 'approved'),
    'rejected_count', count(*) filter (where status = 'rejected')
  )
  into v_approval_breakdown
  from public.expenses;

  select jsonb_build_object(
    'bucket_0_7d', count(*) filter (where released_at >= now() - interval '7 days'),
    'bucket_8_30d', count(*) filter (where released_at < now() - interval '7 days' and released_at >= now() - interval '30 days'),
    'bucket_30d_plus', count(*) filter (where released_at < now() - interval '30 days'),
    'disputed_count', count(*) filter (where status = 'disputed')
  )
  into v_liquidation_aging
  from public.cash_advances
  where status in ('outstanding', 'under_review', 'disputed');

  return jsonb_build_object(
    'budget_compliance', v_budget_compliance,
    'approval_breakdown', v_approval_breakdown,
    'liquidation_aging', v_liquidation_aging
  );
end;
$$;

revoke all on function public.platform_admin_attention_summary(integer) from public, anon;
grant execute on function public.platform_admin_attention_summary(integer) to authenticated;

revoke all on function public.platform_admin_workspace_360(uuid) from public, anon;
grant execute on function public.platform_admin_workspace_360(uuid) to authenticated;

revoke all on function public.platform_admin_financial_compliance() from public, anon;
grant execute on function public.platform_admin_financial_compliance() to authenticated;

commit;
