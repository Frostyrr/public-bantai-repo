begin;

create or replace function public.collection_deletion_policy(c public.collections)
returns text language sql stable set search_path = '' as $$
  select case
    when c.retention_hold then 'protected'
    -- The creation receipt proves how many dues were assigned and at what amount.
    -- Initial obligations share the collection's transaction timestamp.
    when dues.initial_and_pending and not history.recorded and exists (
      select 1
      from public.collection_assessment_requests r
      where r.organization_id = c.organization_id
        and r.actor_id = c.created_by
        and r.result->>'id' = c.id::text
        and r.result->'assigned_obligations_count' = to_jsonb(dues.total)
        and r.result->'standard_dues_centavos' = to_jsonb(dues.min_amount)
        and dues.min_amount = dues.max_amount
    ) then 'immediate'
    when dues.has_open then 'protected'
    when dues.total > 0 or history.recorded then 'retention_review'
    else 'immediate'
  end
  from (
    select count(*) as total,
      bool_and(o.status = 'pending'
        and o.notes is not distinct from 'Initial collection assessment'
        and o.created_at = c.created_at
        and o.updated_at = o.created_at) as initial_and_pending,
      bool_or(o.status not in ('paid', 'waived')) as has_open,
      min(o.amount_centavos) as min_amount,
      max(o.amount_centavos) as max_amount
    from public.obligations o
    where o.collection_id = c.id
  ) dues
  cross join (
    select exists (select 1 from public.payments where collection_id = c.id)
      or exists (select 1 from public.approvals where organization_id = c.organization_id and entity_id = c.id)
      as recorded
  ) history;
$$;

create or replace function public.audit_collection_disposal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(organization_id, actor_id, action, entity_id, after_value)
  values(old.organization_id, auth.uid(), 'collections.delete', old.id,
    jsonb_build_object('classification', 'immediate', 'reason', 'Collection had no activity beyond setup'));
  return old;
end;
$$;

commit;
