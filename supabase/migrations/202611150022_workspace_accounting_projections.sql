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
  where public.is_active_org_member(org,auth.uid())
$$;

create function public.workspace_budget_totals(org uuid, budgets uuid[])
returns table(id uuid, spent numeric, committed numeric, provisional boolean)
language sql stable security definer set search_path = '' as $$
  select a.id,a.spent,a.committed,a.provisional from public.budget_accounting a
  where a.organization_id=org and a.id=any(budgets)
    and public.is_active_org_member(org,auth.uid())
$$;

revoke all on function public.workspace_financial_summary(uuid,uuid,uuid),
  public.workspace_budget_totals(uuid,uuid[]) from public,anon;
grant execute on function public.workspace_financial_summary(uuid,uuid,uuid),
  public.workspace_budget_totals(uuid,uuid[]) to authenticated;
commit;
