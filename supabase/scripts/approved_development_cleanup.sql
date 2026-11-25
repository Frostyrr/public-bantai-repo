-- USER APPROVED: exact five-row deletion manifest in docs/development-cleanup-approval.md.
-- FIRST run development_cleanup_backup.sql and save its complete JSON output outside the database.
-- Run this whole file in Supabase SQL Editor only after saving that backup. Requires privileged SQL Editor access.
-- Any changed identity/dependency/baseline aborts the transaction. Never disable triggers or FK constraints.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Briefly exclude concurrent writes so the dependency preview cannot race cleanup.
lock table public.organizations,public.organization_members,public.organization_directory_members,
 public.directory_group_members,public.collections,public.obligations,public.payments,
 public.receipt_counters,public.audit_logs in share row exclusive mode;

create temporary table cleanup_protected_snapshot on commit drop as
select 'organizations'::text as kind,to_jsonb(t) as row from public.organizations t where id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'workspace',to_jsonb(t) from public.organization_members t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'directory',to_jsonb(t) from public.organization_directory_members t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' and id not in ('b586b9cd-5a0c-455c-af3a-1169e2395580','b79111c6-6e1d-4a22-ae0b-ecb5157c7253')
union all select 'collections',to_jsonb(t) from public.collections t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'obligations',to_jsonb(t) from public.obligations t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' and id not in ('50ebaf1e-c265-4b9b-abcd-b76393d9d758','79c8fbe3-1b9d-4dbb-ba94-07ae0104afb7')
union all select 'payments',to_jsonb(t) from public.payments t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' and id<>'70c48bfe-7daf-4b27-b0b1-be4a7ef12dde'
union all select 'receipt_counters',to_jsonb(t) from public.receipt_counters t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'groups',to_jsonb(t) from public.directory_group_members t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'audit',to_jsonb(t) from public.audit_logs t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47';

do $$
declare
 org constant uuid:='6df5babd-b3d8-4b6a-bd39-03adb779db47';
 coll constant uuid:='e87919ff-4d37-4aaf-a018-33c3f7a42fc7';
 members constant uuid[]:=array['b586b9cd-5a0c-455c-af3a-1169e2395580'::uuid,'b79111c6-6e1d-4a22-ae0b-ecb5157c7253'::uuid];
 dues constant uuid[]:=array['50ebaf1e-c265-4b9b-abcd-b76393d9d758'::uuid,'79c8fbe3-1b9d-4dbb-ba94-07ae0104afb7'::uuid];
 n integer;
begin
 if (select count(*) from public.organizations where id=org)<>1
 or (select count(*) from public.collections where id=coll and organization_id=org and status='active')<>1 then
   raise exception 'Organization/collection no longer matches the approved scope.';
 end if;
 if (select count(*) from public.organization_directory_members where organization_id=org and id=any(members) and status='archived')<>2
 or (select count(*) from public.organization_directory_members where organization_id=org)<>3
 or not exists(select 1 from public.organization_directory_members where id='300b3655-b3dd-4a5f-b99a-f3d46e0d49f8' and organization_id=org and status='active') then
   raise exception 'Directory baseline changed; stop for review.';
 end if;
 if (select count(*) from public.organization_members where organization_id=org and status='active' and
  (id,profile_id,role) in (
   ('354e570b-d05d-4b07-bddd-ba483c918944'::uuid,'301b1414-cf13-4e49-b08b-f261632c6832'::uuid,'owner'),
   ('32d17bba-0b65-4578-8030-61663094141f'::uuid,'23cacb27-4952-4a36-9bd5-efbf2595963e'::uuid,'treasurer'),
   ('e15b31a8-4239-4fc2-9e4c-f16247b0d345'::uuid,'428aece2-77e3-46a4-9d67-a7990f80263c'::uuid,'member')))<>3
 or (select count(*) from public.organization_members where organization_id=org)<>3 then
   raise exception 'Workspace baseline changed; stop for review.';
 end if;
 if (select count(*) from public.obligations where organization_id=org and collection_id=coll)<>2
 or (select count(*) from public.obligations where directory_member_id=any(members))<>2
 or not exists(select 1 from public.obligations where id=dues[1] and organization_id=org and collection_id=coll and directory_member_id=members[1] and member_id='354e570b-d05d-4b07-bddd-ba483c918944' and amount_centavos=25000 and status='paid')
 or not exists(select 1 from public.obligations where id=dues[2] and organization_id=org and collection_id=coll and directory_member_id=members[2] and member_id='32d17bba-0b65-4578-8030-61663094141f' and amount_centavos=25000 and status='pending') then
   raise exception 'Obligation identities or amounts changed; stop for review.';
 end if;
 if (select count(*) from public.payments where obligation_id=any(dues))<>1
 or (select count(*) from public.payments where organization_id=org and collection_id=coll)<>1
 or not exists(select 1 from public.payments where id='70c48bfe-7daf-4b27-b0b1-be4a7ef12dde' and organization_id=org and collection_id=coll
   and obligation_id=dues[1] and amount_centavos=25000 and status='completed' and receipt_number='RCP-2026-0001'
   and recorded_by='301b1414-cf13-4e49-b08b-f261632c6832' and reversed_at is null and reversed_by is null and reversal_reason is null)
 or exists(select 1 from public.directory_group_members where member_id=any(members)) then
   raise exception 'Payment/receipt/group dependencies changed; stop for review.';
 end if;
 -- Refuse new FK edges not included in the reviewed live dependency inventory.
 if exists(select 1 from pg_constraint where contype='f' and confrelid in ('public.organization_directory_members'::regclass,'public.obligations'::regclass,'public.payments'::regclass)
   and not ((conrelid='public.payments'::regclass and conname='payments_obligation_id_fkey')
    or (conrelid='public.obligations'::regclass and conname='obligations_directory_member_fkey')
    or (conrelid='public.directory_group_members'::regclass and conname='directory_group_members_organization_id_member_id_fkey'))) then
   raise exception 'Unreviewed foreign-key dependency; stop for review.';
 end if;
 if not exists(select 1 from public.receipt_counters where organization_id=org and fiscal_year=2026 and last_number=1) then
   raise exception 'Receipt counter baseline changed; stop for review.';
 end if;
 -- Explicit dependency order: never use obligation CASCADE to delete payments implicitly.
 delete from public.payments where id='70c48bfe-7daf-4b27-b0b1-be4a7ef12dde' and organization_id=org and collection_id=coll and obligation_id=dues[1];
 get diagnostics n=row_count; if n<>1 then raise exception 'Expected exactly one deleted payment.'; end if;
 if exists(select 1 from public.payments where obligation_id=any(dues)) then raise exception 'Unexpected remaining payment dependency.'; end if;
 delete from public.obligations where id=any(dues) and organization_id=org and collection_id=coll and directory_member_id=any(members);
 get diagnostics n=row_count; if n<>2 then raise exception 'Expected exactly two deleted obligations.'; end if;
 delete from public.organization_directory_members where id=any(members) and organization_id=org and status='archived';
 get diagnostics n=row_count; if n<>2 then raise exception 'Expected exactly two deleted archived members.'; end if;
 if exists(select 1 from public.obligations where organization_id=org and collection_id=coll)
 or exists(select 1 from public.payments where organization_id=org and collection_id=coll) then raise exception 'Collection was not emptied as approved.'; end if;
 -- Audit remains historical evidence; add a minimal record of the approved purge.
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
 values(org,auth.uid(),'development_test_cleanup',coll,jsonb_build_object('obligation_ids',dues,'directory_member_ids',members,'payment_id','70c48bfe-7daf-4b27-b0b1-be4a7ef12dde','user_approved',true));
end $$;

create temporary table cleanup_after_snapshot on commit drop as
select 'organizations'::text as kind,to_jsonb(t) as row from public.organizations t where id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'workspace',to_jsonb(t) from public.organization_members t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'directory',to_jsonb(t) from public.organization_directory_members t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'collections',to_jsonb(t) from public.collections t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'obligations',to_jsonb(t) from public.obligations t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'payments',to_jsonb(t) from public.payments t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'receipt_counters',to_jsonb(t) from public.receipt_counters t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'groups',to_jsonb(t) from public.directory_group_members t where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'
union all select 'audit',to_jsonb(t) from public.audit_logs t where id in(select (row->>'id')::bigint from cleanup_protected_snapshot where kind='audit');

do $$ begin
 if exists(select * from cleanup_protected_snapshot except all select * from cleanup_after_snapshot)
 or exists(select * from cleanup_after_snapshot except all select * from cleanup_protected_snapshot) then
   raise exception 'Protected records changed; transaction cancelled.';
 end if;
 if exists(select 1 from public.payments p left join public.obligations o on o.id=p.obligation_id and o.organization_id=p.organization_id and o.collection_id=p.collection_id
   where p.organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' and o.id is null) then raise exception 'Orphan payment detected.'; end if;
end $$;

-- All financial totals are derived; no balance reset is performed.
commit;

-- Final result is after COMMIT so SQL Editor returns one readable verification row.
select jsonb_build_object('organization_id','6df5babd-b3d8-4b6a-bd39-03adb779db47',
 'collection_id','e87919ff-4d37-4aaf-a018-33c3f7a42fc7','deleted_payments',1,'deleted_obligations',2,'deleted_archived_directory_members',2,
 'remaining_collection_obligations',(select count(*) from public.obligations where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' and collection_id='e87919ff-4d37-4aaf-a018-33c3f7a42fc7'),
 'remaining_collection_payments',(select count(*) from public.payments where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' and collection_id='e87919ff-4d37-4aaf-a018-33c3f7a42fc7'),
 'assessed_centavos',(select coalesce(sum(amount_centavos),0)::text from public.obligations where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' and collection_id='e87919ff-4d37-4aaf-a018-33c3f7a42fc7'),
 'valid_paid_centavos',(select coalesce(sum(amount_centavos),0)::text from public.payments where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47' and collection_id='e87919ff-4d37-4aaf-a018-33c3f7a42fc7' and status='completed'),
 'remaining_directory_members',(select count(*) from public.organization_directory_members where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'),
 'workspace_members_preserved',(select count(*) from public.organization_members where organization_id='6df5babd-b3d8-4b6a-bd39-03adb779db47'),
 'protected_records_unchanged_at_commit',true) as cleanup_result;
