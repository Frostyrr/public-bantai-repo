begin;

alter table public.obligations add column directory_member_id uuid;
alter table public.obligations add constraint obligations_directory_member_fkey
  foreign key (organization_id, directory_member_id)
  references public.organization_directory_members(organization_id, id) on delete restrict;
create index obligations_directory_member_idx
  on public.obligations(organization_id, directory_member_id)
  where directory_member_id is not null;

-- Copy identities from exact, organization-scoped historical membership references.
-- Fresh UUIDs keep directory records independent of workspace identities.
create temporary table directory_backfill_map on commit drop as
select distinct m.organization_id, m.id as membership_id, gen_random_uuid() as directory_id,
  coalesce(nullif(btrim(p.display_name), ''), 'Historical participant') as display_name
from public.organization_members m
join public.profiles p on p.id = m.profile_id
where exists (
  select 1 from public.obligations o join public.collections c
    on c.id = o.collection_id and c.organization_id = o.organization_id
  where o.member_id = m.id and o.organization_id = m.organization_id
);

insert into public.organization_directory_members (id, organization_id, display_name, status)
select directory_id, organization_id, left(display_name, 150), 'archived'
from directory_backfill_map;

update public.obligations o
set directory_member_id = b.directory_id
from directory_backfill_map b, public.collections c
where o.organization_id = b.organization_id and o.member_id = b.membership_id
  and c.id = o.collection_id and c.organization_id = o.organization_id;

create unique index obligations_collection_directory_member
  on public.obligations(collection_id, directory_member_id)
  where directory_member_id is not null;

create function public.directory_member_obligations(target_org uuid, target_member uuid, page_offset integer default 0)
returns table (
  obligation_id uuid, collection_title text, due_date date, currency text,
  assessed_centavos text, paid_centavos text, remaining_centavos text, overpaid_centavos text, status text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_directory_capability(target_org, 'financial_view') then
    raise exception 'Member finances are not accessible.' using errcode = '42501';
  end if;
  return query
    select o.id, c.title, c.due_date, c.currency::text, o.amount_centavos::text, totals.paid::text,
      (case when o.status = 'waived' then 0 else greatest(o.amount_centavos - totals.paid, 0) end)::text,
      greatest(totals.paid - o.amount_centavos, 0)::text, o.status
    from public.obligations o
    join public.collections c on c.id = o.collection_id and c.organization_id = o.organization_id
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
