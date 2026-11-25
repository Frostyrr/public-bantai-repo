begin;

-- =============================================================================
-- Migration 044: Replace ineffective current_user check in
-- reconcile_collection_assessment with caller-aware GUC / JWT / officer guard
-- while preserving REVOKE ALL FROM PUBLIC, anon, authenticated.
-- =============================================================================

create or replace function public.reconcile_collection_assessment(org uuid, collection uuid, member uuid default null::uuid)
 returns integer
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  c public.collections;
  inserted integer;
  caller_role text;
begin
  if pg_trigger_depth() = 0 then
    caller_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('role', true), ''),
      'none'
    );

    if caller_role in ('anon', 'authenticated') or auth.uid() is not null then
      if auth.uid() is null
        or not public.is_active_org_member(org, auth.uid())
        or not public.is_org_officer(org, auth.uid())
      then
        raise exception 'Unauthorized to reconcile collection assessment.' using errcode = '42501';
      end if;
    end if;
  end if;

  select * into c from public.collections where organization_id = org and id = collection for update nowait;
  if not found or c.status <> 'active' or not c.auto_assess_new_members then return 0; end if;

  insert into public.obligations(organization_id, collection_id, directory_member_id, amount_centavos, status, notes)
  select org, collection, p.id, c.standard_dues_centavos, 'pending', 'Automatic collection assessment'
  from public.collection_scope_live(org, collection, c.member_scope) p
  where member is null or p.id = member
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$function$;

revoke all on function public.reconcile_collection_assessment(uuid, uuid, uuid) from public, anon, authenticated;

commit;
