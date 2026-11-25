begin;

-- Fixed projections deliberately exclude free text, which can contain private
-- names, references, or receipt links. Expand after a reviewed public field exists.
create function public.member_expense_transactions(org uuid)
returns table(id uuid, incurred_date date, amount_centavos bigint, category text, status text)
language sql stable security definer set search_path = '' as $$
  select e.id,e.incurred_date,e.amount_centavos,e.category::text,e.status::text
  from public.expenses e
  where e.organization_id=org and e.status='approved'
    and public.is_active_org_member(org,auth.uid())
$$;

create function public.member_advance_transactions(org uuid)
returns table(id uuid, released_at timestamptz, amount_centavos bigint, status text,
  approved_spending_centavos bigint, cash_returned_centavos bigint)
language sql stable security definer set search_path = '' as $$
  select a.id,a.released_at,a.amount_released_centavos,'liquidated'::text,v.spent::bigint,v.returned::bigint
  from public.cash_advances a join public.advance_accounting v on v.id=a.id and v.organization_id=a.organization_id
  where a.organization_id=org and a.status='liquidated'
    and public.is_active_org_member(org,auth.uid())
$$;

create function public.member_ledger_totals(org uuid)
returns table(collected_centavos numeric, recognized_spending_centavos numeric,
  reserve_centavos numeric, unsettled_advances_centavos numeric, provisional boolean)
language sql stable security definer set search_path = '' as $$
  select c.total,e.total-a.overlap+a.spent,c.total-e.total+a.overlap-a.released+a.returned,
    a.unsettled,a.provisional
  from (
    select coalesce(sum(total_collected_centavos::numeric),0) total
    from public.collection_financial_totals(org,null)
  ) c
  cross join (
    select coalesce(sum(amount_centavos),0) total
    from public.expenses where organization_id=org and status='approved'
  ) e
  cross join (
    select coalesce(sum(overlap),0) overlap,coalesce(sum(spent),0) spent,
      coalesce(sum(released),0) released,coalesce(sum(returned),0) returned,
      coalesce(sum(unsettled),0) unsettled,coalesce(bool_or(provisional),false) provisional
    from public.advance_accounting where organization_id=org
  ) a
  where public.is_active_org_member(org,auth.uid())
$$;

revoke all on function public.member_expense_transactions(uuid),
  public.member_advance_transactions(uuid), public.member_ledger_totals(uuid) from public,anon;
grant execute on function public.member_expense_transactions(uuid),
  public.member_advance_transactions(uuid), public.member_ledger_totals(uuid) to authenticated;

commit;
