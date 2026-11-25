begin;

create function public.workspace_financial_summary(org uuid, space uuid default null, period uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
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
  where exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = org and m.profile_id = auth.uid()
      and m.status = 'active' and o.closed_at is null
      and o.suspended_at is null and p.suspended_at is null
  )
$$;

create function public.workspace_budget_totals(org uuid, budgets uuid[])
returns table(id uuid, spent numeric, committed numeric, provisional boolean)
language sql stable security definer set search_path = '' as $$
  select a.id,a.spent,a.committed,a.provisional from public.budget_accounting a
  where a.organization_id=org and a.id=any(budgets)
    and exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = org and m.profile_id = auth.uid()
      and m.status = 'active' and o.closed_at is null
      and o.suspended_at is null and p.suspended_at is null
  )
$$;

revoke all on function public.workspace_financial_summary(uuid,uuid,uuid),
  public.workspace_budget_totals(uuid,uuid[]) from public,anon;
grant execute on function public.workspace_financial_summary(uuid,uuid,uuid),
  public.workspace_budget_totals(uuid,uuid[]) to authenticated;

create function public.redacted_transaction_details(
  org uuid, kind text, target uuid default null, space uuid default null,
  period uuid default null, budget uuid default null, filter_status text default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  member_role text;
begin
  select m.role into member_role from public.organization_members m
  where m.organization_id=org and m.profile_id=auth.uid() and m.status='active';
  if not exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = org and m.profile_id = auth.uid()
      and m.status = 'active' and o.closed_at is null
      and o.suspended_at is null and p.suspended_at is null
  ) or member_role is null then return '[]'::jsonb; end if;
  if member_role in ('owner','treasurer') then return null; end if;
  if kind='expense' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'organization_id',org, 'title',case when e.submitted_by=auth.uid() then e.title else 'Approved expense' end,
      'archived_at',e.archived_at,
      'category',e.category,'amount_centavos',e.amount_centavos,'currency',e.currency,
      'incurred_date',e.incurred_date,'status',e.status,'created_at',e.created_at
    ) || case when e.submitted_by=auth.uid() then jsonb_build_object(
      'submitted_by',e.submitted_by,'description',e.description,'space_id',e.space_id,
      'budget_id',e.budget_id,'reporting_period_id',e.reporting_period_id,'review_revision',e.review_revision
    ) else '{}'::jsonb end order by e.incurred_date desc,e.id),'[]')
    from public.expenses e where e.organization_id=org and (e.status='approved' or e.submitted_by=auth.uid())
      and (target is null or e.id=target)
      and (space is null or e.space_id=space) and (period is null or e.reporting_period_id=period)
      and (budget is null or e.budget_id=budget) and (filter_status is null or e.status=filter_status));
  elsif kind='advance' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'organization_id',org,'title',case when a.status='liquidated' then 'Settled advance' else 'Cash advance' end,'purpose','',
      'amount_released_centavos',a.amount_released_centavos,'currency',a.currency,
      'released_at',a.released_at,'created_at',a.created_at,'status',a.status,
      'liquidations',case when a.status='liquidated' then jsonb_build_array(jsonb_build_object(
        'status','approved','total_spent_centavos',v.spent,'total_returned_centavos',v.returned
      )) when l.id is not null then jsonb_build_array(jsonb_build_object(
        'status',l.status,'total_spent_centavos',l.total_spent_centavos,
        'total_returned_centavos',l.total_returned_centavos
      )) else '[]'::jsonb end
    ) order by a.released_at desc,a.id),'[]')
    from public.cash_advances a join public.advance_accounting v on v.id=a.id and v.organization_id=org
    left join public.liquidations l on l.organization_id=org and l.cash_advance_id=a.id
      and a.status <> 'liquidated'
    where a.organization_id=org and (a.status='liquidated' or exists (
        select 1 from public.organization_members custodian
        where custodian.id=a.accountable_person_id and custodian.organization_id=org
          and custodian.profile_id=auth.uid() and custodian.status='active'
      )) and (target is null or a.id=target)
      and (space is null or a.space_id=space) and (period is null or a.reporting_period_id=period)
      and (filter_status is null or a.status=filter_status));
  end if;
  raise exception 'Unknown transaction kind.' using errcode='22023';
end;
$$;

revoke all on function public.redacted_transaction_details(uuid,text,uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.redacted_transaction_details(uuid,text,uuid,uuid,uuid,uuid,text) to authenticated;
commit;