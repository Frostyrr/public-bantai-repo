begin;
alter table public.collections
 add column standard_dues_centavos bigint check(standard_dues_centavos between 1 and 9007199254740991),
 add column auto_assess_new_members boolean not null default false,
 add constraint auto_assess_requires_amount check(not auto_assess_new_members or standard_dues_centavos is not null);

create function public.collection_creation_review(org uuid, scope text, groups uuid[], members uuid[], amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare eligible uuid[];
begin
 if not public.is_org_officer(org,auth.uid()) then raise exception 'Collection creation is not permitted.' using errcode='42501'; end if;
 if amount is null or amount not between 1 and 9007199254740991 or scope is null or scope not in ('all','groups','selected')
 or cardinality(groups)>100 or cardinality(members)>500
 or (scope='groups')<>(coalesce(cardinality(groups),0)>0)
 or (scope='selected')<>(coalesce(cardinality(members),0)>0)
 or exists(select 1 from unnest(groups) x where not exists(select 1 from public.directory_groups g where g.organization_id=org and g.id=x))
 or exists(select 1 from unnest(members) x where not exists(select 1 from public.organization_directory_members d where d.organization_id=org and d.id=x))
 then raise exception 'Choose a valid scope and positive contribution amount.' using errcode='23514'; end if;
 eligible:=array(select id from public.collection_scope_population(org,scope,groups,members) order by id);
 return jsonb_build_object('eligible',cardinality(eligible),'totalCentavos',(cardinality(eligible)::numeric*amount)::text,
 'token',md5(jsonb_build_array(org,scope,groups,members,amount,eligible)::text));
end;
$$;

create table public.collection_assessment_requests (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 request_id uuid not null, actor_id uuid not null, payload jsonb not null, result jsonb not null,
 primary key(organization_id,request_id)
);
alter table public.collection_assessment_requests enable row level security;
revoke all on public.collection_assessment_requests from public,anon,authenticated;

create function public.create_assessed_collection(org uuid, title text, description text, space uuid, period uuid,
 target bigint, due date, scope text, groups uuid[], members uuid[], amount bigint, automatic boolean, review_token text, request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare review jsonb; result jsonb; collection_id uuid; eligible uuid[]; saved public.collection_assessment_requests;
 payload jsonb := jsonb_build_array(title,description,space,period,target,due,scope,groups,members,amount,automatic);
begin
 if not public.is_org_officer(org,auth.uid()) then raise exception 'Collection creation is not permitted.' using errcode='42501'; end if;
 if request_id is null or review_token is null or automatic is null then raise exception 'Review this collection before creating it.' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||request_id::text,0));
 select * into saved from public.collection_assessment_requests r where r.organization_id=org and r.request_id=create_assessed_collection.request_id;
 if found then
  if saved.actor_id<>auth.uid() or saved.payload<>payload then raise exception 'Creation request already used.' using errcode='23514'; end if;
  return saved.result;
 end if;
 lock table public.organization_directory_members,public.directory_groups,public.directory_group_members in share mode;
 review:=public.collection_creation_review(org,scope,groups,members,amount);
 if review->>'token'<>review_token then return review||jsonb_build_object('changed',true); end if;
 if (review->>'eligible')::integer>500 then raise exception 'Choose a scope with at most 500 eligible members.' using errcode='23514'; end if;
 if (space is not null and not exists(select 1 from public.spaces s where s.organization_id=org and s.id=space))
 or (period is not null and not exists(select 1 from public.reporting_periods p where p.organization_id=org and p.id=period))
 then raise exception 'Choose a space and period from this organization.' using errcode='23514'; end if;
 result:=public.create_scoped_collection(org,title,description,space,period,target,due,scope,groups,members);
 collection_id:=(result->>'id')::uuid;
 eligible:=array(select id from public.collection_scope_population(org,scope,groups,members));
 if cardinality(eligible)>0 then
  perform public.assign_directory_obligations(org,collection_id,eligible,amount,'Initial collection assessment');
 end if;
 update public.collections set standard_dues_centavos=amount,auto_assess_new_members=automatic where id=collection_id and organization_id=org;
 result:=result||jsonb_build_object('assigned_obligations_count',cardinality(eligible),'standard_dues_centavos',amount,'auto_assess_new_members',automatic);
 insert into public.collection_assessment_requests values(org,request_id,auth.uid(),payload,result);
 return result;
end;
$$;

create function public.reconcile_collection_assessment(org uuid, collection uuid, member uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.collections; inserted integer;
begin
 select * into c from public.collections where organization_id=org and id=collection for update nowait;
 if not found or c.status<>'active' or not c.auto_assess_new_members then return 0; end if;
 insert into public.obligations(organization_id,collection_id,directory_member_id,amount_centavos,status,notes)
 select org,collection,p.id,c.standard_dues_centavos,'pending','Automatic collection assessment'
 from public.collection_scope_live(org,collection,c.member_scope) p
 where member is null or p.id=member
 on conflict do nothing;
 get diagnostics inserted = row_count;
 return inserted;
end;
$$;
revoke all on function public.reconcile_collection_assessment(uuid,uuid,uuid) from public,anon,authenticated;

create table public.collection_assessment_failures (
 organization_id uuid not null, collection_id uuid not null, failed_at timestamptz not null default now(),
 primary key(organization_id,collection_id),
 foreign key(organization_id,collection_id) references public.collections(organization_id,id) on delete cascade
);
alter table public.collection_assessment_failures enable row level security;
revoke all on public.collection_assessment_failures from public,anon,authenticated;

create function public.on_collection_eligibility_change() returns trigger language plpgsql security definer set search_path='' as $$
declare c record; person uuid; changed_collection uuid;
begin
 if tg_table_name='collections' then
  changed_collection:=new.id;
  if new.status<>'active' or not new.auto_assess_new_members then return new; end if;
  -- Changing only the rate or enabling the policy applies to future eligibility.
  if new.member_scope='legacy' then return new; end if;
 else
  if tg_table_name='organization_directory_members' then person:=new.id; else person:=new.member_id; end if;
 end if;
 for c in select id from public.collections where organization_id=new.organization_id and status='active' and auto_assess_new_members
   order by id loop
  if changed_collection is not null and c.id<>changed_collection then continue; end if;
  begin
   perform public.reconcile_collection_assessment(new.organization_id,c.id,person);
  exception when others then
   insert into public.collection_assessment_failures(organization_id,collection_id) values(new.organization_id,c.id)
   on conflict(organization_id,collection_id) do update set failed_at=now();
  end;
 end loop;
 return new;
end;
$$;
create trigger assess_new_directory_member after insert on public.organization_directory_members
 for each row when (new.status='active') execute function public.on_collection_eligibility_change();
create trigger assess_restored_directory_member after update of status on public.organization_directory_members
 for each row when (old.status is distinct from new.status and new.status='active') execute function public.on_collection_eligibility_change();
create trigger assess_new_group_member after insert on public.directory_group_members
 for each row execute function public.on_collection_eligibility_change();
create trigger assess_changed_collection_scope after update of member_scope,status on public.collections
 for each row execute function public.on_collection_eligibility_change();

create function public.collection_assessment_policy(org uuid, collection uuid, amount bigint default null,
 automatic boolean default null, retry boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.collections; assessed integer := 0;
begin
 if not public.is_org_officer(org,auth.uid()) then raise exception 'Collection assessment settings are unavailable.' using errcode='42501'; end if;
 select * into c from public.collections where organization_id=org and id=collection for update;
 if not found then raise exception 'Collection not found.' using errcode='P0002'; end if;
 if amount is not null or automatic is not null or retry then
  if c.status<>'active' then raise exception 'Reopen the collection before changing assessment settings.' using errcode='23514'; end if;
  if automatic is true and c.member_scope='legacy' then
   raise exception 'Save a member scope before enabling automatic assessment.' using errcode='23514';
  end if;
  if amount is not null then
   update public.collections set standard_dues_centavos=amount,auto_assess_new_members=coalesce(automatic,false)
    where organization_id=org and id=collection returning * into c;
  end if;
  if retry and c.auto_assess_new_members then
   assessed:=public.reconcile_collection_assessment(org,collection);
   delete from public.collection_assessment_failures where organization_id=org and collection_id=collection;
  end if;
 end if;
 return jsonb_build_object('amount',c.standard_dues_centavos,'automatic',c.auto_assess_new_members,'status',c.status,
 'assessed',assessed,'failed',exists(select 1 from public.collection_assessment_failures where organization_id=org and collection_id=collection));
end;
$$;
revoke all on function public.collection_creation_review(uuid,text,uuid[],uuid[],bigint),
 public.create_assessed_collection(uuid,text,text,uuid,uuid,bigint,date,text,uuid[],uuid[],bigint,boolean,text,uuid),
 public.collection_assessment_policy(uuid,uuid,bigint,boolean,boolean) from public,anon;
grant execute on function public.collection_creation_review(uuid,text,uuid[],uuid[],bigint),
 public.create_assessed_collection(uuid,text,text,uuid,uuid,bigint,date,text,uuid[],uuid[],bigint,boolean,text,uuid),
 public.collection_assessment_policy(uuid,uuid,bigint,boolean,boolean) to authenticated;
commit;
