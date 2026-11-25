begin;

create function public.collection_members_page(org uuid, collection uuid, page_offset integer, search_text text, filter_status text, target_obligation uuid, amounts jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.collections; result jsonb;
  assessed_min bigint := (amounts->>'assessedMin')::bigint;
  assessed_max bigint := (amounts->>'assessedMax')::bigint;
  paid_min bigint := (amounts->>'paidMin')::bigint;
  paid_max bigint := (amounts->>'paidMax')::bigint;
  balance_min bigint := (amounts->>'balanceMin')::bigint;
  balance_max bigint := (amounts->>'balanceMax')::bigint;
  assessment_missing boolean := coalesce((amounts->>'noAssessment')::boolean, false);
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
 ), candidates as materialized (
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
 ), totals as materialized (
  select * from public.directory_member_financial_rows(org,null,collection,
    array(select obligation_id from candidates where obligation_id is not null))
 ), matched as materialized (
  select p.*, t.paid_centavos::bigint as paid_centavos, t.remaining_centavos::bigint as remaining_centavos
  from candidates p left join totals t on t.obligation_id=p.obligation_id
  where (not assessment_missing or p.obligation_id is null)
    and (assessed_min is null or p.amount_centavos >= assessed_min)
    and (assessed_max is null or p.amount_centavos <= assessed_max)
    and (paid_min is null or t.paid_centavos::bigint >= paid_min)
    and (paid_max is null or t.paid_centavos::bigint <= paid_max)
    and (balance_min is null or t.remaining_centavos::bigint >= balance_min)
    and (balance_max is null or t.remaining_centavos::bigint <= balance_max)
 ), page as (
  select * from matched order by name,row_id,obligation_id
    limit 26 offset greatest(page_offset,0)
 )
 select jsonb_build_object('scope',c.member_scope,'total',(select count(*) from roster),
  'notAssessed',(select count(*) from roster where obligation_id is null),
  'rows',coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('id',p.row_id)
    order by p.name,p.row_id,p.obligation_id),'[]'))
 into result from page p;
 return result;
end;
$$;
revoke all on function public.collection_members_page(uuid,uuid,integer,text,text,uuid,jsonb) from public,anon;
grant execute on function public.collection_members_page(uuid,uuid,integer,text,text,uuid,jsonb) to authenticated;

commit;
