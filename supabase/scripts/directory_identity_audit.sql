-- READ ONLY. Run in Supabase SQL Editor. Replace the organization UUID below in each query if needed.
-- Names are evidence for display only, never identity matching criteria. No contacts or credentials are selected.
begin read only;

-- 1. Installed relationship definitions; stop if directory_member_id is absent.
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in ('public.obligations'::regclass,'public.payments'::regclass,
  'public.organization_directory_members'::regclass) order by table_name,conname;

-- 2. Independent workspace and directory counts. Archived rows must not count as eligible members.
with scope as (select '6df5babd-b3d8-4b6a-bd39-03adb779db47'::uuid as org)
select (select count(*) from public.organization_members m where m.organization_id=s.org and m.status='active') as workspace_users,
 (select count(*) from public.organization_directory_members d where d.organization_id=s.org and d.status='active') as eligible_directory_members,
 (select count(*) from public.organization_directory_members d where d.organization_id=s.org and d.status='archived') as archived_directory_records
from scope s;

-- 3. Every directory identity and its exact financial/workspace references (not name matching).
select d.id as directory_member_id,d.display_name,d.status,d.member_code,d.created_at,
 coalesce((select jsonb_agg(jsonb_build_object('key',f.key,'label',f.label,'value',d.attributes->f.key))
  from public.directory_field_definitions f where f.organization_id=d.organization_id and f.active), '[]') as active_fields,
 (select count(*) from public.obligations o where o.organization_id=d.organization_id and o.directory_member_id=d.id) as obligations,
 array(select distinct o.member_id from public.obligations o where o.organization_id=d.organization_id
  and o.directory_member_id=d.id and o.member_id is not null) as historical_workspace_membership_ids
from public.organization_directory_members d
where d.organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'::uuid order by d.created_at,d.id limit 200;

-- 4. Contributor identity and transaction chain for each obligation. Completed/reversed payments stay distinct.
select o.id as obligation_id,o.collection_id,c.title,o.amount_centavos,o.status,
 o.member_id as legacy_workspace_membership_id,m.profile_id as legacy_profile_id,
 p.display_name as legacy_profile_name,o.directory_member_id,d.display_name as directory_name,
 d.status as directory_status,d.member_code,
 (select count(*) from public.payments pay where pay.organization_id=o.organization_id
   and pay.collection_id=o.collection_id and pay.obligation_id=o.id) as payment_records,
 (select coalesce(sum(pay.amount_centavos),0) from public.payments pay where pay.organization_id=o.organization_id
   and pay.collection_id=o.collection_id and pay.obligation_id=o.id and pay.status='completed') as valid_paid_centavos,
 array(select pay.id from public.payments pay where pay.organization_id=o.organization_id
   and pay.collection_id=o.collection_id and pay.obligation_id=o.id order by pay.id) as payment_ids
from public.obligations o
join public.collections c on c.id=o.collection_id and c.organization_id=o.organization_id
left join public.organization_directory_members d on d.id=o.directory_member_id and d.organization_id=o.organization_id
left join public.organization_members m on m.id=o.member_id and m.organization_id=o.organization_id
left join public.profiles p on p.id=m.profile_id
where o.organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'::uuid
order by o.collection_id,o.created_at,o.id limit 200;

-- 5. Creation/change audit evidence. Backfill insertion alone is not proof of later human identity equivalence.
select a.id,a.action,a.actor_id,a.entity_id,a.after_value
from public.audit_logs a
where a.organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'::uuid
 and a.action like 'directory_member_%' order by a.id limit 200;
-- 6. Dependency inventory, including delete rules. Review any additional live dependencies before cleanup.
select conrelid::regclass as dependent_table,confrelid::regclass as referenced_table,
 conname,pg_get_constraintdef(oid) as definition
from pg_constraint where contype='f' and confrelid in ('public.organization_directory_members'::regclass,
 'public.obligations'::regclass,'public.payments'::regclass) order by dependent_table,conname;

-- 7. Runtime creators/triggers. Historical migration 008 is a one-time schema migration, not a login hook.
select p.oid::regprocedure as function_name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosrc ilike '%insert into public.organization_directory_members%';
select tgrelid::regclass as table_name,tgname,pg_get_triggerdef(oid) as definition
from pg_trigger where not tgisinternal and tgrelid in ('public.organizations'::regclass,
 'public.organization_members'::regclass,'public.organization_directory_members'::regclass);
rollback;
