begin;
create function public.can_read_private_financial_rows(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.organization_members m
    join public.organizations o on o.id=m.organization_id
    join public.profiles p on p.id=m.profile_id
    where m.organization_id=org and m.profile_id=auth.uid() and m.status='active'
      and m.role in ('owner','treasurer') and o.closed_at is null
      and o.suspended_at is null and p.suspended_at is null
  )
$$;
revoke all on function public.can_read_private_financial_rows(uuid) from public,anon;
grant execute on function public.can_read_private_financial_rows(uuid) to authenticated;

do $$
declare target text;
begin
  foreach target in array array[
    'expenses','cash_advances','liquidations','approvals','liquidation_reconciliations',
    'liquidation_expense_allocations','liquidation_resolution_entries'
  ] loop
    execute format('create policy private_financial_rows on public.%I as restrictive for select to authenticated
      using (public.can_read_private_financial_rows(organization_id))',target);
  end loop;
end;
$$;

revoke select on public.advance_accounting,public.budget_accounting from authenticated;

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

  if not public.is_org_officer(p_org_id, v_caller) then
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

revoke all on function public.get_organization_audit_logs(uuid,int,int) from public,anon;
commit;
