-- Read-only rehearsal. Run in the SQL editor before designing the production backfill.
-- Output contains organization UUIDs and counts, with no names or contacts.
begin read only;

with payment_totals as (
  select obligation_id,
    count(*) as transactions,
    count(*) filter (where status = 'reversed') as reversals,
    coalesce(sum(amount_centavos) filter (where status = 'completed'), 0) as collected_centavos
  from public.payments
  group by obligation_id
)
select o.organization_id,
  count(distinct m.id) as identifiable_participants,
  count(*) as obligations,
  count(*) filter (where m.id is null or c.id is null) as obligations_requiring_review,
  sum(o.amount_centavos) as assessed_centavos,
  coalesce(sum(p.collected_centavos), 0) as collected_centavos,
  coalesce(sum(p.transactions), 0) as transactions,
  coalesce(sum(p.reversals), 0) as reversals
from public.obligations o
left join public.organization_members m
  on m.id = o.member_id and m.organization_id = o.organization_id
left join public.collections c
  on c.id = o.collection_id and c.organization_id = o.organization_id
left join payment_totals p on p.obligation_id = o.id
group by o.organization_id
order by o.organization_id;

select count(*) as payments_requiring_review
from public.payments p
left join public.obligations o
  on o.id = p.obligation_id and o.organization_id = p.organization_id and o.collection_id = p.collection_id
where o.id is null;

rollback;
