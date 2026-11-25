begin;
create or replace function public.guard_closed_organization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source uuid;
  destination uuid;
  parent record;
begin
  if exists (select 1 from public.profiles where id=auth.uid() and suspended_at is not null) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;
  if tg_op <> 'INSERT' then source := old.organization_id; end if;
  if tg_op <> 'DELETE' then destination := new.organization_id; end if;
  for parent in select id, closed_at from public.organizations
    where id in (source, destination) order by id for share
  loop
    if parent.closed_at is not null then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.lock_liquidation_accounting(org uuid, settlement uuid)
returns public.liquidations language plpgsql security definer set search_path = '' as $$
declare record public.liquidations;
begin
  if not public.is_active_org_member(org,auth.uid()) or not exists (select 1 from public.organization_members where organization_id=org
    and profile_id=auth.uid() and status='active' and role in ('owner','organization_admin')) then
    raise exception 'Owner or admin authorization required.' using errcode='42501';
  end if;
  select * into record from public.liquidations where id=settlement and organization_id=org for update;
  if not found or record.status <> 'approved' then
    raise exception 'An approved liquidation in this organization is required.' using errcode='23514';
  end if;
  perform 1 from public.organizations where id=org and closed_at is null for share;
  if not found then raise exception 'This organization is closed.' using errcode='23514'; end if;
  return record;
end $$;
commit;
