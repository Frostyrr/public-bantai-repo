begin;

-- Read-only integration: no identities, obligations, payments or receipts are rewritten.
create function public.directory_member_financial_rows(target_org uuid, target_member uuid, target_collection uuid default null, target_obligations uuid[] default null)
returns table (
  obligation_id uuid, collection_id uuid, collection_title text, due_date date, currency text,
  assessed_centavos text, paid_centavos text, remaining_centavos text, overpaid_centavos text, status text, overdue boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_directory_capability(target_org, 'financial_view') then
    raise exception 'Member finances are not accessible.' using errcode = '42501';
  end if;
  return query
    select o.id, c.id, c.title, c.due_date, c.currency::text, o.amount_centavos::text, totals.paid::text,
      (case when o.status = 'waived' then 0 else greatest(o.amount_centavos - totals.paid, 0) end)::text,
      greatest(totals.paid - o.amount_centavos, 0)::text, o.status,
      coalesce(c.due_date < (now() at time zone org.time_zone)::date
        and o.status <> 'waived' and o.amount_centavos > totals.paid, false)
    from public.obligations o
    join public.collections c on c.id = o.collection_id and c.organization_id = o.organization_id
    join public.organizations org on org.id = o.organization_id
    cross join lateral (
      select coalesce(sum(p.amount_centavos), 0) as paid from public.payments p
      where p.obligation_id = o.id and p.organization_id = o.organization_id
        and p.collection_id = o.collection_id and p.status = 'completed'
    ) totals
    where o.organization_id = target_org and (target_member is null or o.directory_member_id = target_member)
      and (target_collection is null or o.collection_id = target_collection)
      and (target_obligations is null or o.id = any(target_obligations))
    order by o.created_at desc, o.id
    ;
end;
$$;

revoke all on function public.directory_member_financial_rows(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;

-- Reuse the same calculation for paginated history and the complete member summary.
drop function public.directory_member_obligations(uuid, uuid, integer);
create function public.directory_member_obligations(target_org uuid, target_member uuid, page_offset integer default 0)
returns table (obligation_id uuid, collection_id uuid, collection_title text, due_date date, currency text,
  assessed_centavos text, paid_centavos text, remaining_centavos text, overpaid_centavos text, status text, overdue boolean)
language sql stable security definer set search_path = '' as $$
  select * from public.directory_member_financial_rows(target_org, target_member) where target_member is not null
  limit 26 offset greatest(coalesce(page_offset, 0), 0);
$$;
revoke all on function public.directory_member_obligations(uuid, uuid, integer) from public, anon;
grant execute on function public.directory_member_obligations(uuid, uuid, integer) to authenticated;

create function public.directory_member_financial_summary(target_org uuid, target_member uuid)
returns table (currency text, obligation_count bigint, assessed_centavos text, paid_centavos text,
  remaining_centavos text, overpaid_centavos text)
language sql stable security definer set search_path = '' as $$
  select r.currency, count(*), sum(r.assessed_centavos::numeric)::text,
    sum(r.paid_centavos::numeric)::text, sum(r.remaining_centavos::numeric)::text,
    sum(r.overpaid_centavos::numeric)::text
  from public.directory_member_financial_rows(target_org, target_member) r where target_member is not null group by r.currency;
$$;
revoke all on function public.directory_member_financial_summary(uuid, uuid) from public, anon;
grant execute on function public.directory_member_financial_summary(uuid, uuid) to authenticated;
create function public.collection_obligation_financials(target_org uuid, target_collection uuid, target_obligations uuid[] default null)
returns table (obligation_id uuid, paid_centavos text, remaining_centavos text)
language sql stable security definer set search_path = '' as $$
  select r.obligation_id, r.paid_centavos, r.remaining_centavos
  from public.directory_member_financial_rows(target_org, null, target_collection, target_obligations) r;
$$;
revoke all on function public.collection_obligation_financials(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.collection_obligation_financials(uuid, uuid, uuid[]) to authenticated;

-- Page identities before loading member joins or calculating payments. Preserve legacy names.
create function public.collection_roster_page(target_org uuid, target_collection uuid,
  page_offset integer default 0, search_text text default '', payment_status text default 'all', target_obligation uuid default null)
returns table (id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_directory_capability(target_org, 'financial_view') then
    raise exception 'Member finances are not accessible.' using errcode = '42501';
  end if;
  return query select o.id from public.obligations o
    left join public.organization_directory_members d on d.organization_id=o.organization_id and d.id=o.directory_member_id
    left join public.organization_members m on m.organization_id=o.organization_id and m.id=o.member_id
    left join public.profiles p on p.id=m.profile_id
    where o.organization_id=target_org and o.collection_id=target_collection
      and (payment_status='all' or o.status=payment_status)
      and (target_obligation is null or o.id=target_obligation)
      and (coalesce(search_text,'')='' or position(lower(search_text) in lower(coalesce(d.display_name,p.display_name,'')))>0
        or exists (select 1 from jsonb_each_text(coalesce(d.attributes,'{}'::jsonb)) a where position(lower(search_text) in lower(a.value))>0)
        or position(lower(search_text) in lower(coalesce(d.member_code,'')))>0)
    order by o.created_at,o.id limit 26 offset greatest(coalesce(page_offset,0),0);
end;
$$;
revoke all on function public.collection_roster_page(uuid, uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.collection_roster_page(uuid, uuid, integer, text, text, uuid) to authenticated;
commit;
