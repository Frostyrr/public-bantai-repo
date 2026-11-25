begin;

-- Existing rows can retain both their historical workspace reference and directory reference.
alter table public.obligations alter column member_id drop not null;
alter table public.obligations add constraint obligation_has_participant
  check (member_id is not null or directory_member_id is not null);

-- Directory-only rows contain individual finances. Existing personal and report reads
-- continue to use the historical workspace relationship.
drop policy obligations_org_read on public.obligations;
create policy obligations_org_read on public.obligations for select to authenticated using (
  case when member_id is null then public.has_directory_capability(organization_id, 'financial_view')
       else public.is_active_org_member(organization_id, (select auth.uid())) end
);
drop policy payments_org_read on public.payments;
create policy payments_org_read on public.payments for select to authenticated using (
  exists (select 1 from public.obligations o where o.id = obligation_id
    and o.organization_id = payments.organization_id and o.collection_id = payments.collection_id)
);

-- Separate write entry point. Keep execution private until the compatible collection
-- roster and aggregate reporting paths are in place.
create function public.assign_directory_obligations(target_org uuid, target_collection uuid,
  target_members uuid[], assessed_centavos bigint, assignment_notes text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  eligible integer;
begin
  if not public.is_org_officer(target_org, auth.uid()) then
    raise exception 'You cannot assign collection obligations.' using errcode = '42501';
  end if;
  if coalesce(cardinality(target_members), 0) not between 1 and 500
    or assessed_centavos is null or assessed_centavos not between 0 and 9007199254740991
    or char_length(assignment_notes) > 500 then
    raise exception 'Provide valid members, amount, and notes.' using errcode = '23514';
  end if;

  perform 1 from public.collections where organization_id = target_org
    and id = target_collection and status = 'active' for update;
  if not found then
    raise exception 'Active collection not found.' using errcode = '23514';
  end if;

  select count(*) into eligible from (
    select id from public.organization_directory_members where organization_id = target_org
      and id = any(target_members) and status = 'active' order by id for update
  ) active_members;
  if eligible <> cardinality(target_members) then
    raise exception 'The selected members changed. Review the selection and try again.' using errcode = '23514';
  end if;

  insert into public.obligations (organization_id, collection_id, directory_member_id, amount_centavos, notes, status)
    select target_org, target_collection, id, assessed_centavos, assignment_notes,
      case when assessed_centavos = 0 then 'paid' else 'pending' end
    from unnest(target_members) as members(id);
  return eligible;
end;
$$;
revoke all on function public.assign_directory_obligations(uuid, uuid, uuid[], bigint, text) from public, anon, authenticated;
commit;
