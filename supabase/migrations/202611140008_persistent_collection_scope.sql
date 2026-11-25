
begin;
alter table public.collections add unique (organization_id,id);
alter table public.collections add column member_scope text not null default 'legacy' check(member_scope in ('legacy','all','groups','selected'));
alter table public.collections add column frozen_member_ids uuid[];
create table public.collection_scope_groups (
 organization_id uuid not null, collection_id uuid not null, group_id uuid not null,
 primary key(organization_id,collection_id,group_id),
 foreign key(organization_id,collection_id) references public.collections(organization_id,id) on delete cascade,
 foreign key(organization_id,group_id) references public.directory_groups(organization_id,id) on delete restrict
);
create table public.collection_scope_members (
 organization_id uuid not null, collection_id uuid not null, member_id uuid not null,
 primary key(organization_id,collection_id,member_id),
 foreign key(organization_id,collection_id) references public.collections(organization_id,id) on delete cascade,
 foreign key(organization_id,member_id) references public.organization_directory_members(organization_id,id) on delete cascade
);
alter table public.collection_scope_groups enable row level security;
alter table public.collection_scope_members enable row level security;
revoke all on public.collection_scope_groups,public.collection_scope_members from public,anon,authenticated;

create function public.collection_scope_population(org uuid, scope text, groups uuid[], members uuid[])
returns table(id uuid) language sql stable set search_path='' as $$
 select d.id from public.organization_directory_members d
 where d.organization_id=org and d.status='active' and (
  scope='all' or (scope='selected' and d.id=any(members)) or (scope='groups' and exists(
   select 1 from public.directory_group_members g where g.organization_id=org and g.member_id=d.id and g.group_id=any(groups)
  ))
 );
$$;
create function public.collection_group_eligible_count(org uuid, groups uuid[])
returns bigint language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_org_officer(org,auth.uid()) then
  raise exception 'Collection scope management is unavailable.' using errcode='42501';
 end if;
 if cardinality(groups)>100 or exists(select 1 from unnest(groups) as requested(group_id)
  where not exists(select 1 from public.directory_groups g where g.organization_id=org and g.id=requested.group_id)) then
  raise exception 'Choose valid groups in this organization.' using errcode='23514';
 end if;
 return (select count(*) from public.collection_scope_population(org,'groups',groups,'{}'));
end;
$$;
revoke all on function public.collection_group_eligible_count(uuid,uuid[]) from public,anon;
grant execute on function public.collection_group_eligible_count(uuid,uuid[]) to authenticated;

create function public.collection_scope_live(org uuid, collection uuid, scope text)
returns table(id uuid) language sql stable set search_path='' as $$
 select * from public.collection_scope_population(org,scope,
 array(select g.group_id from public.collection_scope_groups g where g.organization_id=org and g.collection_id=collection),
 array(select m.member_id from public.collection_scope_members m where m.organization_id=org and m.collection_id=collection));
$$;
revoke all on function public.collection_scope_population(uuid,text,uuid[],uuid[]),public.collection_scope_live(uuid,uuid,text) from public,anon,authenticated;

create function public.freeze_collection_scope() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='active' and new.status<>'active' then
   lock table public.organization_directory_members,public.directory_group_members in share mode;
   new.frozen_member_ids:=array(select id from public.collection_scope_live(old.organization_id,old.id,old.member_scope));
 elsif new.status='active' then
   new.frozen_member_ids:=null;
 end if;
 return new;
end;
$$;
create trigger freeze_collection_scope before update of status on public.collections
for each row execute function public.freeze_collection_scope();

create index collections_frozen_member_ids on public.collections using gin(frozen_member_ids)
 where frozen_member_ids is not null;
create function public.protect_frozen_collection_member() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.collections where organization_id=old.organization_id and frozen_member_ids @> array[old.id]) then
  raise exception 'This member belongs to a closed or archived collection roster.' using errcode='23503';
 end if;
 return old;
end;
$$;
create trigger protect_frozen_collection_member before delete on public.organization_directory_members
 for each row execute function public.protect_frozen_collection_member();

create function public.collection_scope_settings(org uuid, collection uuid, scope text default null,
 groups uuid[] default '{}', members uuid[] default '{}', review_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.collections; prior uuid[]; proposed uuid[]; token text; result jsonb;
begin
 if not public.is_org_officer(org,auth.uid()) then raise exception 'Collection scope management is unavailable.' using errcode='42501'; end if;
 if review_token is not null then
  select * into c from public.collections where organization_id=org and id=collection for update;
  lock table public.organization_directory_members,public.directory_groups,public.directory_group_members in share mode;
 else
  select * into c from public.collections where organization_id=org and id=collection;
 end if;
 if not found or c.id is null then raise exception 'Collection not found.' using errcode='P0002'; end if;
 if scope is null then
  return jsonb_build_object('scope',c.member_scope,'status',c.status,
   'groupIds',array(select group_id from public.collection_scope_groups where organization_id=org and collection_id=collection),
   'members',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'display_name',d.display_name,'member_code',d.member_code,'attributes',d.attributes))
    from public.collection_scope_members m join public.organization_directory_members d on (d.organization_id,d.id)=(m.organization_id,m.member_id)
    where m.organization_id=org and m.collection_id=collection),'[]'));
 end if;
 if c.status<>'active' or scope not in ('all','groups','selected')
   or coalesce(cardinality(groups),0)>100 or coalesce(cardinality(members),0)>500
   or (scope='groups')<>(coalesce(cardinality(groups),0)>0)
   or (scope='selected')<>(coalesce(cardinality(members),0)>0)
   or exists(select 1 from unnest(groups) x where not exists(select 1 from public.directory_groups g where g.organization_id=org and g.id=x))
   or exists(select 1 from unnest(members) x where not exists(select 1 from public.organization_directory_members d where d.organization_id=org and d.id=x))
 then raise exception 'Choose valid groups or members in this active collection.' using errcode='23514'; end if;
 prior:=array(select id from public.collection_scope_live(org,collection,c.member_scope) order by id);
 proposed:=array(select id from public.collection_scope_population(org,scope,groups,members) order by id);
 token:=md5(jsonb_build_array(org,collection,c.member_scope,prior,scope,groups,members,proposed,
  array(select o.id from public.obligations o where o.organization_id=org and o.collection_id=collection order by o.id))::text);
 result:=jsonb_build_object('token',token,'eligible',cardinality(proposed),
  'added',(select count(*) from unnest(proposed) x where not(x=any(prior))),
  'removed',(select count(*) from unnest(prior) x where not(x=any(proposed)) and not exists(
   select 1 from public.obligations o where o.organization_id=org and o.collection_id=collection and o.directory_member_id=x)),
  'retainedAssessed',(select count(*) from public.obligations o where o.organization_id=org and o.collection_id=collection and not coalesce(o.directory_member_id=any(proposed),false)));
 if review_token is null then return result; end if;
 if review_token<>token then return result||jsonb_build_object('changed',true); end if;
 delete from public.collection_scope_groups where organization_id=org and collection_id=collection;
 delete from public.collection_scope_members where organization_id=org and collection_id=collection;
 insert into public.collection_scope_groups select distinct org,collection,x from unnest(groups) x;
 insert into public.collection_scope_members select distinct org,collection,x from unnest(members) x;
 update public.collections set member_scope=scope where organization_id=org and id=collection;
 return result;
end;
$$;
revoke all on function public.collection_scope_settings(uuid,uuid,text,uuid[],uuid[],text) from public,anon;
grant execute on function public.collection_scope_settings(uuid,uuid,text,uuid[],uuid[],text) to authenticated;

create function public.create_scoped_collection(p_org_id uuid,p_title text,p_description text,p_space_id uuid,p_period_id uuid,
 p_target_centavos bigint,p_due_date date,p_scope text,p_group_ids uuid[],p_member_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; preview jsonb; saved jsonb; collection uuid;
begin
 result:=public.create_collection(p_org_id,p_title,p_description,p_space_id,p_period_id,p_target_centavos,p_due_date);
 collection:=(result->>'id')::uuid;
 preview:=public.collection_scope_settings(p_org_id,collection,p_scope,p_group_ids,p_member_ids);
 saved:=public.collection_scope_settings(p_org_id,collection,p_scope,p_group_ids,p_member_ids,preview->>'token');
 if saved->>'changed'='true' then raise exception 'Directory membership changed. Review the scope and retry.' using errcode='23514'; end if;
 return result||jsonb_build_object('member_scope',p_scope);
end;
$$;
revoke all on function public.create_scoped_collection(uuid,text,text,uuid,uuid,bigint,date,text,uuid[],uuid[]) from public,anon;
grant execute on function public.create_scoped_collection(uuid,text,text,uuid,uuid,bigint,date,text,uuid[],uuid[]) to authenticated;

-- Preserve the existing obligation-only endpoints for reports and other callers.
create function public.collection_members_page(org uuid, collection uuid, page_offset integer, search_text text, filter_status text, target_obligation uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.collections; result jsonb;
begin
 if not public.has_directory_capability(org,'financial_view') then raise exception 'Member finances are not accessible.' using errcode='42501'; end if;
 select * into c from public.collections where organization_id=org and id=collection;
 if not found then raise exception 'Collection not found.' using errcode='P0002'; end if;
 with population as materialized (
  select id from public.collection_scope_live(org,collection,c.member_scope) where c.status='active'
  union all select unnest(c.frozen_member_ids) where c.status<>'active'
 ), roster as materialized (
  select o.id as obligation_id,o.directory_member_id,coalesce(o.directory_member_id,o.id) as row_id,
   o.member_id,o.amount_centavos,o.notes,o.status,not exists(select 1 from population s where s.id=o.directory_member_id) as outside_scope
  from public.obligations o where o.organization_id=org and o.collection_id=collection
  union all
  select null,d.id,d.id,null,null,null,'not_assessed',false
  from population s join public.organization_directory_members d on d.organization_id=org and d.id=s.id
  where not exists(select 1 from public.obligations o where o.organization_id=org and o.collection_id=collection and o.directory_member_id=d.id)
 ), page as materialized (
  select r.*,coalesce(d.display_name,p.display_name,'Historical participant') as name,
   case when d.id is not null then jsonb_build_object('id',d.id,'display_name',d.display_name,'status',d.status,'member_code',d.member_code,'attributes',d.attributes) end as organization_directory_members
  from roster r left join public.organization_directory_members d on d.organization_id=org and d.id=r.directory_member_id
   left join public.organization_members m on m.organization_id=org and m.id=r.member_id
   left join public.profiles p on p.id=m.profile_id
  where (target_obligation is null or r.obligation_id=target_obligation)
   and (filter_status='all' or filter_status=r.status or (filter_status='assessed' and r.obligation_id is not null))
   and (search_text='' or position(lower(search_text) in lower(coalesce(d.display_name,p.display_name,'')))>0
    or position(lower(search_text) in lower(coalesce(d.member_code,'')))>0
    or exists(select 1 from jsonb_each_text(coalesce(d.attributes,'{}')) a where position(lower(search_text) in lower(a.value))>0))
  order by name,row_id,obligation_id limit 26 offset greatest(page_offset,0)
 ), totals as (
  select * from public.directory_member_financial_rows(org,null,collection,array(select obligation_id from page where obligation_id is not null))
 )
 select jsonb_build_object('scope',c.member_scope,'total',(select count(*) from roster),
  'notAssessed',(select count(*) from roster where obligation_id is null),
  'rows',coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('id',p.row_id,'paid_centavos',t.paid_centavos::bigint,'remaining_centavos',t.remaining_centavos::bigint)
   order by p.name,p.row_id,p.obligation_id),'[]'))
 into result from page p left join totals t on t.obligation_id=p.obligation_id;
 return result;
end;
$$;
revoke all on function public.collection_members_page(uuid,uuid,integer,text,text,uuid) from public,anon;
grant execute on function public.collection_members_page(uuid,uuid,integer,text,text,uuid) to authenticated;
create or replace function public.collection_dues_scope(target_org uuid,target_collection uuid,assignment_scope text,
 group_ids uuid[] default '{}',member_ids uuid[] default '{}',assessed_centavos bigint default 0,
 assignment_notes text default null,apply_assignment boolean default false,expected_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare eligible uuid[]; fresh uuid[]; groups uuid[]; selected uuid[]; already integer;
 result jsonb; token text; assigned integer; selected_names jsonb; collection_currency text;
begin
 if not public.is_org_officer(target_org,auth.uid()) then raise exception 'You cannot assign collection dues.' using errcode='42501'; end if;
 if assignment_scope not in ('all','groups','selected') or assignment_scope is null
  or assessed_centavos is null or assessed_centavos not between 0 and 9007199254740991
  or char_length(assignment_notes)>500 or cardinality(group_ids)>100 or cardinality(member_ids)>500 then
   raise exception 'Provide a valid scope, amount and selection (500 selected members maximum).' using errcode='23514';
 end if;
 select coalesce(array_agg(distinct x order by x),'{}') into groups from unnest(group_ids) x;
 select coalesce(array_agg(distinct x order by x),'{}') into selected from unnest(member_ids) x;
 if (assignment_scope='groups' and cardinality(groups)=0) or (assignment_scope='selected' and cardinality(selected)=0)
 or (assignment_scope<>'groups' and cardinality(groups)>0) or (assignment_scope<>'selected' and cardinality(selected)>0)
 or array_position(groups,null) is not null or array_position(selected,null) is not null then
   raise exception 'Choose members or groups for the selected scope.' using errcode='23514';
 end if;
 if apply_assignment then
   select currency::text into collection_currency from public.collections where organization_id=target_org and id=target_collection and status='active' for update;
   if not found then raise exception 'Active collection not found.' using errcode='23514'; end if;
   -- Only confirmation locks eligibility. Preview remains a non-writing, non-blocking read.
   lock table public.organization_directory_members,public.directory_groups,public.directory_group_members in share mode;
 else
   select currency::text into collection_currency from public.collections where organization_id=target_org and id=target_collection and status='active';
   if not found then raise exception 'Active collection not found.' using errcode='23514'; end if;
 end if;
 if (select count(*) from public.directory_groups where organization_id=target_org and id=any(groups))<>cardinality(groups)
 or (select count(*) from public.organization_directory_members where organization_id=target_org and id=any(selected))<>cardinality(selected) then
   raise exception 'Selected members or groups do not belong to this organization.' using errcode='23514';
 end if;

 select coalesce(array_agg(d.id order by d.id),'{}') into eligible
 from public.organization_directory_members d where d.organization_id=target_org and d.status='active'
 and (exists(select 1 from public.collections c where c.organization_id=target_org and c.id=target_collection and c.member_scope='legacy')
  or d.id in (select s.id from public.collections c cross join lateral public.collection_scope_live(target_org,target_collection,c.member_scope) s
    where c.organization_id=target_org and c.id=target_collection))
 and (assignment_scope='all' or (assignment_scope='selected' and d.id=any(selected))
  or (assignment_scope='groups' and exists(select 1 from public.directory_group_members g where g.organization_id=target_org and g.member_id=d.id and g.group_id=any(groups))));
 select coalesce(array_agg(candidate.id order by candidate.id),'{}') into fresh from unnest(eligible) as candidate(id)
 where not exists(select 1 from public.obligations o where o.organization_id=target_org and o.collection_id=target_collection and o.directory_member_id=candidate.id);
 already:=cardinality(eligible)-cardinality(fresh);
 token:=md5(jsonb_build_object('organization',target_org,'collection',target_collection,'currency',collection_currency,'scope',assignment_scope,'groups',groups,'selected',selected,'eligible',eligible,'fresh',fresh,'amount',assessed_centavos,'notes',assignment_notes)::text);
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'alreadyAssigned',not(d.id=any(fresh)))),'[]') into selected_names
 from (select id,display_name from public.organization_directory_members where organization_id=target_org and id=any(eligible) order by display_name,id limit 500) d;
 result:=jsonb_build_object('currency',collection_currency,'scope',assignment_scope,'eligible',cardinality(eligible),'alreadyAssigned',already,
  'newAssignments',cardinality(fresh),'ineligibleSelected',case when assignment_scope='selected' then cardinality(selected)-cardinality(eligible) else 0 end,
  'amountCentavos',assessed_centavos::text,'totalCentavos',(cardinality(fresh)::numeric*assessed_centavos)::text,
  'limit',500,'canConfirm',cardinality(fresh) between 1 and 500,'token',token,'members',selected_names,
  'groupNames',coalesce((select jsonb_agg(name order by name,id) from public.directory_groups where organization_id=target_org and id=any(groups)),'[]'));
 if not apply_assignment then return result; end if;
 if expected_token is null or expected_token<>token then return result||jsonb_build_object('changed',true,'assigned',0); end if;
 if cardinality(fresh)=0 then raise exception 'No eligible new assignments remain.' using errcode='23514'; end if;
 if cardinality(fresh)>500 then raise exception 'This assessment exceeds the 500 new-member limit. Choose smaller groups or a selected subset.' using errcode='23514'; end if;
 assigned:=public.assign_directory_obligations(target_org,target_collection,fresh,assessed_centavos,assignment_notes);
 return result||jsonb_build_object('changed',false,'assigned',assigned);
end;
$$;
create or replace function public.assign_directory_obligations(target_org uuid, target_collection uuid,
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

  lock table public.organization_directory_members,public.directory_group_members in share mode;
  select count(*) into eligible from (
    select id from public.organization_directory_members where organization_id = target_org
      and id = any(target_members) and status = 'active'
      and (exists(select 1 from public.collections c where c.organization_id=target_org and c.id=target_collection and c.member_scope='legacy')
       or id in (select s.id from public.collections c cross join lateral public.collection_scope_live(target_org,target_collection,c.member_scope) s
         where c.organization_id=target_org and c.id=target_collection))
      order by id for update
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
create or replace function public.directory_member_delete_preview(target_org uuid, target_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare obligation_count bigint; group_count bigint; frozen_count bigint;
begin
  if not public.has_directory_capability(target_org,'edit') then
    raise exception 'You cannot manage directory members.' using errcode='42501';
  end if;
  if not exists(select 1 from public.organization_directory_members where organization_id=target_org and id=target_member) then
    raise exception 'Directory member not found.' using errcode='P0002';
  end if;
  select count(*) into obligation_count from public.obligations where organization_id=target_org and directory_member_id=target_member;
  select count(*) into group_count from public.directory_group_members where organization_id=target_org and member_id=target_member;
  select count(*) into frozen_count from public.collections where organization_id=target_org and frozen_member_ids @> array[target_member];
  return jsonb_build_object('canDelete',obligation_count=0 and frozen_count=0,'obligations',obligation_count,'groupMemberships',group_count) || case when frozen_count>0 then jsonb_build_object('frozenCollections',frozen_count) else '{}'::jsonb end;
end;
$$;
commit;
