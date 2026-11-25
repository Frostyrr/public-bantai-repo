begin;
-- Extends the existing assignment function; no member, obligation, payment or schema relationship is rewritten.
create function public.collection_dues_scope(target_org uuid,target_collection uuid,assignment_scope text,
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
revoke all on function public.collection_dues_scope(uuid,uuid,text,uuid[],uuid[],bigint,text,boolean,text) from public,anon;
grant execute on function public.collection_dues_scope(uuid,uuid,text,uuid[],uuid[],bigint,text,boolean,text) to authenticated;
commit;
