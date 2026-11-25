begin;
create function public.directory_member_payments(target_org uuid, target_member uuid, page_offset integer default 0)
returns table (id uuid, collection_title text, currency text, amount_centavos text,
  receipt_number text, paid_at timestamptz, status text, reversed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_directory_capability(target_org, 'financial_view') then
    raise exception 'Member finances are not accessible.' using errcode = '42501';
  end if;
  return query
    select p.id, c.title, c.currency::text, p.amount_centavos::text,
      p.receipt_number, p.paid_at, p.status, p.reversed_at
    from public.obligations o
    join public.collections c on c.id = o.collection_id and c.organization_id = o.organization_id
    join public.payments p on p.obligation_id = o.id and p.collection_id = c.id and p.organization_id = o.organization_id
    where o.organization_id = target_org and o.directory_member_id = target_member
    order by p.paid_at desc, p.id
    limit 26 offset greatest(coalesce(page_offset, 0), 0);
end;
$$;
revoke all on function public.directory_member_payments(uuid, uuid, integer) from public, anon;
grant execute on function public.directory_member_payments(uuid, uuid, integer) to authenticated;
commit;
