begin;
alter table public.organizations add column organization_type text
  check (organization_type in ('student','workplace','club','nonprofit','other'));
create table public.organization_creation_requests (
  actor_id uuid not null references public.profiles(id),
  request_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_name text not null,
  requested_currency text not null,
  requested_type text not null,
  primary key(actor_id,request_id)
);
alter table public.organization_creation_requests enable row level security;
revoke all on public.organization_creation_requests from public, anon, authenticated;

create function public.create_typed_organization(org_name text, org_currency text, org_type text, request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  org_id uuid;
  labels text[];
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if org_type is null or org_type not in ('student','workplace','club','nonprofit','other') or request_id is null then
    raise exception 'Choose an organization type and provide a request ID.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || request_id::text, 0));
  select r.organization_id into org_id from public.organization_creation_requests r
    where r.actor_id = auth.uid() and r.request_id = create_typed_organization.request_id;
  if found then
    if not exists (
      select 1 from public.organization_creation_requests r
      where r.actor_id = auth.uid() and r.request_id = create_typed_organization.request_id
        and r.requested_name = btrim(org_name) and r.requested_currency = upper(btrim(org_currency))
        and r.requested_type = org_type
    ) then
      raise exception 'This request ID was already used for different organization details.' using errcode = '23514';
    end if;
    select jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'organization_type',o.organization_type,'role','owner')
      into result from public.organizations o where o.id = org_id;
    return result;
  end if;
  result := public.create_organization_with_owner(org_name, org_currency);
  org_id := (result->>'id')::uuid;
  update public.organizations set organization_type = org_type where id = org_id;
  labels := case org_type
    when 'student' then array['Student ID','College','Program','Year Level','Section']
    when 'workplace' then array['Employee ID','Department','Job Title','Employment Type']
    when 'club' then array['Membership ID','Membership Type','Chapter']
    when 'nonprofit' then array['Member ID','Team','Role']
    else array[]::text[] end;
  insert into public.directory_field_definitions(organization_id,key,label,kind,options)
    select org_id, replace(lower(label),' ','_'),label,'text','{}'::text[] from unnest(labels) label;
  insert into public.organization_creation_requests values(auth.uid(),request_id,org_id,btrim(org_name),upper(btrim(org_currency)),org_type);
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(org_id,auth.uid(),'organization_type_initialized',org_id,jsonb_build_object('organization_type',org_type));
  return result || jsonb_build_object('organization_type',org_type);
end;
$$;
revoke all on function public.create_typed_organization(text,text,text,uuid) from public, anon;
grant execute on function public.create_typed_organization(text,text,text,uuid) to authenticated;
revoke execute on function public.create_organization_with_owner(text,text) from authenticated;

create function public.set_organization_type(target_org uuid, org_type text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_org_admin(target_org,auth.uid()) then
    raise exception 'You cannot change organization type.' using errcode = '42501';
  end if;
  if org_type is null or org_type not in ('student','workplace','club','nonprofit','other') then
    raise exception 'Choose a valid organization type.' using errcode = '23514';
  end if;
  update public.organizations set organization_type = org_type where id = target_org;
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(target_org,auth.uid(),'organization_type_changed',target_org,jsonb_build_object('organization_type',org_type));
end;
$$;
revoke all on function public.set_organization_type(uuid,text) from public, anon;
grant execute on function public.set_organization_type(uuid,text) to authenticated;
commit;
