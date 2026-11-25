-- READ ONLY: one SELECT, no deletes, no changes to identities or financial records.
-- Confirm the organization UUID; optional collection_id narrows the financial inspection.
-- Return the inspection JSON for review. Nothing here approves or automatically selects rows for deletion.
with scope as (
 select '6df5babd-b3d8-4b6a-bd39-03adb779db47'::uuid as organization_id,
   null::uuid as collection_id
), scoped_obligations as (
 select o.* from public.obligations o,scope s where o.organization_id=s.organization_id
   and (s.collection_id is null or o.collection_id=s.collection_id)
), displayed_obligations as (
 select * from scoped_obligations order by collection_id,created_at,id limit 200
), related_payments as (
 select p.* from public.payments p where p.obligation_id in(select id from displayed_obligations)
), relevant_ids as (
 select id from displayed_obligations union select directory_member_id from displayed_obligations where directory_member_id is not null
 union select id from related_payments
)
select jsonb_build_object(
 'organization',(select jsonb_build_object('id',o.id,'name',o.name) from public.organizations o where o.id=s.organization_id),
 'selected_collection_id',s.collection_id,
 'workspace_users_to_preserve',(select coalesce(jsonb_agg(jsonb_build_object('membership_id',m.id,'profile_id',m.profile_id,'role',m.role,'status',m.status)),'[]') from public.organization_members m where m.organization_id=s.organization_id),
 'directory_members',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'status',d.status,'member_code',d.member_code,
   'total_obligations',(select count(*) from public.obligations o where o.organization_id=d.organization_id and o.directory_member_id=d.id))), '[]')
   from (select * from public.organization_directory_members where organization_id=s.organization_id order by created_at,id limit 200) d),
 'directory_member_count',(select count(*) from public.organization_directory_members where organization_id=s.organization_id),
 'obligation_count',(select count(*) from scoped_obligations),
 'obligation_output_truncated',(select count(*)>200 from scoped_obligations),
 'obligations',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'organization_id',o.organization_id,'collection_id',o.collection_id,
   'collection_name',c.title,'amount_centavos',o.amount_centavos::text,'status',o.status,
   'directory_member_id',o.directory_member_id,'directory_name',d.display_name,'directory_status',d.status,
   'legacy_workspace_membership_id',o.member_id,'legacy_profile_id',m.profile_id,
   'legacy_profile_name',pr.display_name,'created_at',o.created_at)), '[]')
   from displayed_obligations o
   left join public.collections c on c.id=o.collection_id and c.organization_id=o.organization_id
   left join public.organization_directory_members d on d.id=o.directory_member_id and d.organization_id=o.organization_id
   left join public.organization_members m on m.id=o.member_id and m.organization_id=o.organization_id
   left join public.profiles pr on pr.id=m.profile_id),
 'payments_and_receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'organization_id',p.organization_id,
   'collection_id',p.collection_id,'obligation_id',p.obligation_id,'amount_centavos',p.amount_centavos::text,
   'status',p.status,'receipt_number',p.receipt_number,'paid_at',p.paid_at,'recorded_by',p.recorded_by,
   'reversed_at',p.reversed_at,'reversed_by',p.reversed_by,'reversal_reason',p.reversal_reason)), '[]') from related_payments p),
 'group_associations',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from public.directory_group_members g where g.organization_id=s.organization_id
   and g.member_id in(select directory_member_id from displayed_obligations)),
 'related_audits_to_preserve',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'entity_id',a.entity_id,'actor_id',a.actor_id)), '[]')
   from public.audit_logs a where a.organization_id=s.organization_id and a.entity_id in(select id from relevant_ids)),
 'receipt_counters_to_preserve',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.receipt_counters r where r.organization_id=s.organization_id),
 'collection_baselines',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,
   'obligations',(select count(*) from public.obligations o where o.organization_id=s.organization_id and o.collection_id=c.id),
   'assessed_centavos',(select coalesce(sum(o.amount_centavos),0)::text from public.obligations o where o.organization_id=s.organization_id and o.collection_id=c.id),
   'payment_count',(select count(*) from public.payments p where p.organization_id=s.organization_id and p.collection_id=c.id),
   'valid_payments_centavos',(select coalesce(sum(p.amount_centavos),0)::text from public.payments p where p.organization_id=s.organization_id and p.collection_id=c.id and p.status='completed'))),'[]')
   from public.collections c where c.organization_id=s.organization_id and (s.collection_id is null or c.id=s.collection_id)),
 'incoming_foreign_keys',(select coalesce(jsonb_agg(jsonb_build_object('dependent_table',conrelid::regclass::text,
   'referenced_table',confrelid::regclass::text,'constraint',conname,'definition',pg_get_constraintdef(oid))),'[]')
   from pg_constraint where contype='f' and confrelid in('public.organization_directory_members'::regclass,'public.obligations'::regclass,'public.payments'::regclass))
) as inspection from scope s;
