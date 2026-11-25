begin;

-- 1. Ensure active-membership helper enforces workspace closure and user/workspace suspension (from 028).
create or replace function public.is_active_org_member(org_id uuid, user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = org_id
      and m.profile_id = user_id
      and m.status = 'active'
      and o.closed_at is null
      and o.suspended_at is null
      and p.suspended_at is null
  )
$$;

revoke all on function public.is_active_org_member(uuid, uuid) from public, anon;
grant execute on function public.is_active_org_member(uuid, uuid) to authenticated;

-- 2. Restore private-financial-row helper and restrictive RLS policies across all 7 financial tables (from 026).
create or replace function public.can_read_private_financial_rows(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = org
      and m.profile_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'treasurer')
      and o.closed_at is null
      and o.suspended_at is null
      and p.suspended_at is null
  )
$$;

revoke all on function public.can_read_private_financial_rows(uuid) from public, anon;
grant execute on function public.can_read_private_financial_rows(uuid) to authenticated;

do $$
declare
  target text;
begin
  foreach target in array array[
    'expenses',
    'cash_advances',
    'liquidations',
    'approvals',
    'liquidation_reconciliations',
    'liquidation_expense_allocations',
    'liquidation_resolution_entries'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = target
        and policyname = 'private_financial_rows'
    ) then
      execute format(
        'create policy private_financial_rows on public.%I as restrictive for select to authenticated using (public.can_read_private_financial_rows(organization_id))',
        target
      );
    end if;
  end loop;
end;
$$;

-- 3. Restrict direct SELECT on accounting views (from 026).
revoke select on public.advance_accounting, public.budget_accounting from public, anon, authenticated;

-- 4. Restore audit-log payload redaction for non-owner/non-treasurer officers (from 026 + 028).
create or replace function public.get_organization_audit_logs(
  p_org_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id bigint,
  organization_id uuid,
  actor_id uuid,
  actor_name text,
  action text,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  occurred_at timestamptz
) language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_active_org_member(p_org_id, v_caller) or not public.is_org_officer(p_org_id, v_caller) then
    raise exception 'Unauthorized to inspect audit logs for this organization.';
  end if;

  return query
  select
    a.id,
    a.organization_id,
    a.actor_id,
    coalesce(p.display_name, 'System') as actor_name,
    a.action,
    a.entity_id,
    case when public.can_read_private_financial_rows(p_org_id) then a.before_value end,
    case when public.can_read_private_financial_rows(p_org_id) then a.after_value end,
    a.occurred_at
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  where a.organization_id = p_org_id
  order by a.occurred_at desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_organization_audit_logs(uuid, int, int) from public, anon;
grant execute on function public.get_organization_audit_logs(uuid, int, int) to authenticated;

-- 5. Preserve the recovered liquidation join predicate (and a.status <> 'liquidated') in redacted_transaction_details.
create or replace function public.redacted_transaction_details(
  org uuid,
  kind text,
  target uuid default null,
  space uuid default null,
  period uuid default null,
  budget uuid default null,
  filter_status text default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  member_role text;
begin
  select m.role into member_role
  from public.organization_members m
  where m.organization_id = org
    and m.profile_id = auth.uid()
    and m.status = 'active';

  if not public.is_active_org_member(org, auth.uid()) or member_role is null then
    return '[]'::jsonb;
  end if;
  if member_role in ('owner', 'treasurer') then
    return null;
  end if;

  if kind = 'expense' then
    return (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'organization_id', org,
          'title', case when e.submitted_by = auth.uid() then e.title else 'Approved expense' end,
          'archived_at', e.archived_at,
          'category', e.category,
          'amount_centavos', e.amount_centavos,
          'currency', e.currency,
          'incurred_date', e.incurred_date,
          'status', e.status,
          'created_at', e.created_at
        ) || case
          when e.submitted_by = auth.uid() then jsonb_build_object(
            'submitted_by', e.submitted_by,
            'description', e.description,
            'space_id', e.space_id,
            'budget_id', e.budget_id,
            'reporting_period_id', e.reporting_period_id,
            'review_revision', e.review_revision
          )
          else '{}'::jsonb
        end
        order by e.incurred_date desc, e.id
      ), '[]')
      from public.expenses e
      where e.organization_id = org
        and (e.status = 'approved' or e.submitted_by = auth.uid())
        and (target is null or e.id = target)
        and (space is null or e.space_id = space)
        and (period is null or e.reporting_period_id = period)
        and (budget is null or e.budget_id = budget)
        and (filter_status is null or e.status = filter_status)
    );
  elsif kind = 'advance' then
    return (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'organization_id', org,
          'title', case when a.status = 'liquidated' then 'Settled advance' else 'Cash advance' end,
          'purpose', '',
          'amount_released_centavos', a.amount_released_centavos,
          'currency', a.currency,
          'released_at', a.released_at,
          'created_at', a.created_at,
          'status', a.status,
          'liquidations', case
            when a.status = 'liquidated' then jsonb_build_array(jsonb_build_object(
              'status', 'approved',
              'total_spent_centavos', v.spent,
              'total_returned_centavos', v.returned
            ))
            when l.id is not null then jsonb_build_array(jsonb_build_object(
              'status', l.status,
              'total_spent_centavos', l.total_spent_centavos,
              'total_returned_centavos', l.total_returned_centavos
            ))
            else '[]'::jsonb
          end
        )
        order by a.released_at desc, a.id
      ), '[]')
      from public.cash_advances a
      join public.advance_accounting v on v.id = a.id and v.organization_id = org
      left join public.liquidations l on l.organization_id = org and l.cash_advance_id = a.id
        and a.status <> 'liquidated'
      where a.organization_id = org
        and (
          a.status = 'liquidated'
          or exists (
            select 1 from public.organization_members custodian
            where custodian.id = a.accountable_person_id
              and custodian.organization_id = org
              and custodian.profile_id = auth.uid()
              and custodian.status = 'active'
          )
        )
        and (target is null or a.id = target)
        and (space is null or a.space_id = space)
        and (period is null or a.reporting_period_id = period)
        and (filter_status is null or a.status = filter_status)
    );
  end if;

  raise exception 'Unknown transaction kind.' using errcode = '22023';
end;
$$;

revoke all on function public.redacted_transaction_details(uuid, text, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.redacted_transaction_details(uuid, text, uuid, uuid, uuid, uuid, text) to authenticated;

-- 6. Ensure closed-workspace history entitlements exist (for post-recovery baseline) and preserve
--    and a.status <> 'liquidated' in closed_transaction_history.
do $$
begin
  if to_regclass('public.workspace_history_entitlements') is null then
    create table public.workspace_history_entitlements (
      organization_id uuid not null references public.organizations(id),
      profile_id uuid not null references public.profiles(id),
      closure_role text not null,
      captured_at timestamptz not null default transaction_timestamp(),
      primary key (organization_id, profile_id)
    );
    create table public.workspace_history_revocations (
      organization_id uuid not null,
      profile_id uuid not null,
      revoked_by uuid not null references public.profiles(id),
      revoked_at timestamptz not null default now(),
      primary key (organization_id, profile_id),
      foreign key (organization_id, profile_id)
        references public.workspace_history_entitlements(organization_id, profile_id)
    );
    alter table public.workspace_history_entitlements enable row level security;
    alter table public.workspace_history_revocations enable row level security;
    revoke all on public.workspace_history_entitlements, public.workspace_history_revocations
      from public, anon, authenticated;
  end if;
end;
$$;

create or replace function public.closed_transaction_history(
  org uuid,
  kind text,
  target uuid default null,
  space uuid default null,
  period uuid default null,
  budget uuid default null,
  filter_status text default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  member_role text;
begin
  select e.closure_role into member_role
  from public.workspace_history_entitlements e
  join public.organizations o on o.id = e.organization_id
  join public.profiles p on p.id = e.profile_id
  where e.organization_id = org
    and e.profile_id = auth.uid()
    and o.closed_at is not null
    and o.suspended_at is null
    and p.suspended_at is null
    and not exists (
      select 1 from public.workspace_history_revocations r
      where r.organization_id = org and r.profile_id = e.profile_id
    );

  if member_role is null then
    return '[]'::jsonb;
  end if;

  if kind = 'expense' then
    return (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'organization_id', org,
          'title', case when e.submitted_by = auth.uid() then e.title else 'Approved expense' end,
          'archived_at', e.archived_at,
          'category', e.category,
          'amount_centavos', e.amount_centavos,
          'currency', e.currency,
          'incurred_date', e.incurred_date,
          'status', e.status,
          'created_at', e.created_at
        ) || case
          when e.submitted_by = auth.uid() then jsonb_build_object(
            'submitted_by', e.submitted_by,
            'description', e.description,
            'space_id', e.space_id,
            'budget_id', e.budget_id,
            'reporting_period_id', e.reporting_period_id,
            'review_revision', e.review_revision
          )
          else '{}'::jsonb
        end
        order by e.incurred_date desc, e.id
      ), '[]')
      from public.expenses e
      where e.organization_id = org
        and (e.status = 'approved' or e.submitted_by = auth.uid())
        and (target is null or e.id = target)
        and (space is null or e.space_id = space)
        and (period is null or e.reporting_period_id = period)
        and (budget is null or e.budget_id = budget)
        and (filter_status is null or e.status = filter_status)
    );
  elsif kind = 'advance' then
    return (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'organization_id', org,
          'title', case when a.status = 'liquidated' then 'Settled advance' else 'Cash advance' end,
          'purpose', '',
          'amount_released_centavos', a.amount_released_centavos,
          'currency', a.currency,
          'released_at', a.released_at,
          'created_at', a.created_at,
          'status', a.status,
          'liquidations', case
            when a.status = 'liquidated' then jsonb_build_array(jsonb_build_object(
              'status', 'approved',
              'total_spent_centavos', v.spent,
              'total_returned_centavos', v.returned
            ))
            when l.id is not null then jsonb_build_array(jsonb_build_object(
              'status', l.status,
              'total_spent_centavos', l.total_spent_centavos,
              'total_returned_centavos', l.total_returned_centavos
            ))
            else '[]'::jsonb
          end
        )
        order by a.released_at desc, a.id
      ), '[]')
      from public.cash_advances a
      join public.advance_accounting v on v.id = a.id and v.organization_id = org
      left join public.liquidations l on l.organization_id = org and l.cash_advance_id = a.id
        and a.status <> 'liquidated'
      where a.organization_id = org
        and (
          a.status = 'liquidated'
          or exists (
            select 1 from public.organization_members custodian
            where custodian.id = a.accountable_person_id
              and custodian.organization_id = org
              and custodian.profile_id = auth.uid()
          )
        )
        and (target is null or a.id = target)
        and (space is null or a.space_id = space)
        and (period is null or a.reporting_period_id = period)
        and (filter_status is null or a.status = filter_status)
    );
  end if;

  raise exception 'Unknown transaction kind.' using errcode = '22023';
end;
$$;

revoke all on function public.closed_transaction_history(uuid, text, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.closed_transaction_history(uuid, text, uuid, uuid, uuid, uuid, text) to authenticated;

-- 7. Audit and revoke unintended anon/PUBLIC EXECUTE privileges on all non-trigger SECURITY DEFINER RPCs
--    except the explicitly anonymous-callable endpoints.
do $$
declare
  fn record;
  sig text;
  is_internal boolean;
begin
  for fn in
    select p.oid, p.oid::regprocedure::text as proc_sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef = true
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    sig := fn.proc_sig;
    if sig in (
      'check_source_restriction(text)',
      'consume_rate_limit(text,integer,integer)',
      'record_edge_security_event(text,text,text,text,text,integer,text,text,jsonb)',
      'read_published_financial_snapshot(uuid)'
    ) then
      continue;
    end if;

    is_internal := sig in (
      'review_expense_with_private_result(uuid,uuid,text,text,integer)',
      'review_liquidation_with_private_result(uuid,uuid,text,text)',
      'pending_expense_storage_copies(integer)',
      'confirm_expense_storage_copy(uuid,text,text)',
      'review_expense_internal(uuid,uuid,text,text,integer)',
      'lock_liquidation_accounting(uuid,uuid)',
      'create_organization_with_owner(text,text,uuid)',
      'delete_collection(uuid,uuid)'
    );

    execute format('revoke all on function public.%s from public, anon', sig);
    if not is_internal then
      execute format('grant execute on function public.%s to authenticated', sig);
    end if;
  end loop;
end;
$$;

commit;
