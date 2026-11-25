begin;
alter table public.organizations add column time_zone text;
create function public.set_organization_time_zone(target_org uuid, zone text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_org_admin(target_org, auth.uid()) then
    raise exception 'You cannot change the organization time zone.' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = zone)
    or (position('/' in zone) = 0 and zone <> 'UTC') then
    raise exception 'Choose a valid IANA time zone.' using errcode = '23514';
  end if;
  update public.organizations set time_zone = zone where id = target_org;
  insert into public.audit_logs(organization_id, actor_id, action, entity_id, after_value)
  values (target_org, auth.uid(), 'organization_time_zone_changed', target_org, jsonb_build_object('time_zone', zone));
end;
$$;
revoke all on function public.set_organization_time_zone(uuid, text) from public, anon;
grant execute on function public.set_organization_time_zone(uuid, text) to authenticated;
drop function public.directory_member_obligations(uuid, uuid, integer);
create function public.directory_member_obligations(target_org uuid, target_member uuid, page_offset integer default 0)
returns table (
  obligation_id uuid, collection_title text, due_date date, currency text,
  assessed_centavos text, paid_centavos text, remaining_centavos text, overpaid_centavos text, status text, overdue boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_directory_capability(target_org, 'financial_view') then
    raise exception 'Member finances are not accessible.' using errcode = '42501';
  end if;
  return query
    select o.id, c.title, c.due_date, c.currency::text, o.amount_centavos::text, totals.paid::text,
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
    where o.organization_id = target_org and o.directory_member_id = target_member
    order by o.created_at desc, o.id
    limit 26 offset greatest(coalesce(page_offset, 0), 0);
end;
$$;
revoke all on function public.directory_member_obligations(uuid, uuid, integer) from public, anon;
grant execute on function public.directory_member_obligations(uuid, uuid, integer) to authenticated;

commit;
