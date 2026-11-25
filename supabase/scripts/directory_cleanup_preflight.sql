-- READ-ONLY, EMPTY BY DEFAULT. Populate ONLY reviewed candidate directory UUIDs, never names.
-- Run directory_identity_audit.sql first. Export this JSON result as a local backup/approval manifest.
-- This is NOT cleanup authorization and performs no deletions. Inspect incoming FKs from the identity audit too.
begin read only;
with scope as (
 select '6df5babd-b3d8-4b6a-bd39-03adb779db47'::uuid as org,
   array[]::uuid[] as candidate_directory_ids -- e.g. array['EXACT_UUID_1'::uuid,'EXACT_UUID_2'::uuid]
), members as (
 select d.* from public.organization_directory_members d,scope s where d.organization_id=s.org and d.id=any(s.candidate_directory_ids)
), dues as (
 select o.* from public.obligations o,scope s where o.organization_id=s.org and o.directory_member_id in(select id from members)
), transactions as (
 select p.* from public.payments p,scope s where p.organization_id=s.org
   and exists(select 1 from dues o where o.id=p.obligation_id and o.collection_id=p.collection_id)
), memberships as (
 select g.* from public.directory_group_members g,scope s where g.organization_id=s.org and g.member_id in(select id from members)
), related_audits as (
 select a.* from public.audit_logs a,scope s where a.organization_id=s.org and a.entity_id in
   (select id from members union all select id from dues union all select id from transactions)
)
select jsonb_build_object(
 'organization_id',s.org,
 'requested_member_ids',to_jsonb(s.candidate_directory_ids),
 'matched_member_count',(select count(*) from members),
 'directory_members',coalesce((select jsonb_agg(to_jsonb(m)) from members m),'[]'),
 'obligations',coalesce((select jsonb_agg(to_jsonb(o)) from dues o),'[]'),
 'payments_including_reversals_and_receipts',coalesce((select jsonb_agg(to_jsonb(p)) from transactions p),'[]'),
 'group_memberships',coalesce((select jsonb_agg(to_jsonb(g)) from memberships g),'[]'),
 'related_audit_records_to_retain',coalesce((select jsonb_agg(to_jsonb(a)) from related_audits a),'[]'),
 'affected_collections_to_retain',coalesce((select jsonb_agg(to_jsonb(c)) from public.collections c where c.organization_id=s.org and c.id in(select collection_id from dues)),'[]'),
 'receipt_counters_to_retain',coalesce((select jsonb_agg(to_jsonb(r)) from public.receipt_counters r where r.organization_id=s.org),'[]'),
 'workspace_membership_ids_to_retain',array(select m.id from public.organization_members m where m.organization_id=s.org),
 'unrelated_member_ids_to_retain',array(select d.id from public.organization_directory_members d where d.organization_id=s.org and not(d.id=any(s.candidate_directory_ids))),
 'unrelated_obligation_ids_to_retain',array(select o.id from public.obligations o where o.organization_id=s.org and o.id not in(select id from dues)),
 'unrelated_payment_ids_to_retain',array(select p.id from public.payments p where p.organization_id=s.org and p.id not in(select id from transactions))
) as cleanup_preview_and_backup from scope s;
rollback;
