begin;
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
  if member_role is null then return '[]'::jsonb; end if;
  if member_role in ('owner','treasurer') then return null; end if;
  if kind='expense' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'organization_id',org, 'title','Approved expense',
      'category',e.category,'amount_centavos',e.amount_centavos,'currency',e.currency,
      'incurred_date',e.incurred_date,'status',e.status,'created_at',e.created_at
    ) order by e.incurred_date desc,e.id),'[]')
    from public.expenses e where e.organization_id=org and e.status='approved'
      and e.archived_at is null and (target is null or e.id=target)
      and (space is null or e.space_id=space) and (period is null or e.reporting_period_id=period)
      and (budget is null or e.budget_id=budget) and (filter_status is null or e.status=filter_status));
  elsif kind='advance' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'organization_id',org,'title','Settled advance','purpose','',
      'amount_released_centavos',a.amount_released_centavos,'currency',a.currency,
      'released_at',a.released_at,'created_at',a.created_at,'status',a.status,
      'liquidations',jsonb_build_array(jsonb_build_object(
        'status','approved','total_spent_centavos',v.spent,'total_returned_centavos',v.returned
      ))
    ) order by a.released_at desc,a.id),'[]')
    from public.cash_advances a join public.advance_accounting v on v.id=a.id and v.organization_id=org
    where a.organization_id=org and a.status='liquidated' and (target is null or a.id=target)
      and (space is null or a.space_id=space) and (period is null or a.reporting_period_id=period)
      and (filter_status is null or a.status=filter_status));
  end if;
  raise exception 'Unknown transaction kind.' using errcode='22023';
end;
$$;
revoke all on function public.redacted_transaction_details(uuid,text,uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.redacted_transaction_details(uuid,text,uuid,uuid,uuid,uuid,text) to authenticated;
commit;
