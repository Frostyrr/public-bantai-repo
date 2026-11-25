begin;

create function public.audit_liquidation_accounting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(organization_id, actor_id, action, entity_id, after_value)
  values (new.organization_id, new.actor, tg_argv[0], new.liquidation_id, to_jsonb(new));
  return new;
end;
$$;
revoke all on function public.audit_liquidation_accounting() from public, anon, authenticated;
create trigger audit_reconciliation after insert on public.liquidation_reconciliations
  for each row execute function public.audit_liquidation_accounting('liquidation_reconciliation_confirmed');
create trigger audit_resolution after insert on public.liquidation_resolution_entries
  for each row execute function public.audit_liquidation_accounting('liquidation_resolution_recorded');

create or replace function public.delete_organization(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  org public.organizations%rowtype;
begin
  select * into org from public.organizations where id = p_org_id for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id = p_org_id
      and profile_id = auth.uid() and role = 'owner' and status = 'active'
  ) then
    raise exception 'Only an organization owner can close this organization.' using errcode = '42501';
  end if;
  if exists(select 1 from public.advance_accounting where organization_id = p_org_id
    and (unsettled > 0 or discrepancy > 0)) then
    raise exception 'Settle outstanding cash advances before closing the organization.' using errcode = '23514';
  end if;
  update public.organization_directory_members set email = null, phone = null
    where organization_id = p_org_id and (email is not null or phone is not null);
  update public.user_preferences set default_organization_id = null where default_organization_id = p_org_id;
  update public.organization_members set status = 'left' where organization_id = p_org_id and status <> 'left';
  update public.organizations set closed_at = now(), closed_by = auth.uid(),
    retention_status = 'retained_pending_review', retention_review_at = now() + interval '1 year'
    where id = p_org_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(p_org_id,auth.uid(),'organization_closed',p_org_id,
      jsonb_build_object('retention_status','retained_pending_review'));
  return jsonb_build_object('success',true,'organization_id',p_org_id,'action','closed');
end;
$$;
create or replace function public.check_org_deletability(
  p_org_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_unliquidated_count int := 0;
  v_unliquidated_centavos bigint := 0;
  v_is_deletable boolean := true;
  v_reasons text[] := array[]::text[];
  v_members_count int := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null then
    raise exception 'You are not an active member of this organization.';
  end if;

  if v_role != 'owner' then
    v_is_deletable := false;
    v_reasons := array_append(v_reasons, 'Only an organization owner can close this organization.');
  end if;

  -- Count unliquidated cash advances
  select count(*), coalesce(sum(unsettled + discrepancy), 0)
  into v_unliquidated_count, v_unliquidated_centavos
  from public.advance_accounting
  where organization_id = p_org_id
    and (unsettled > 0 or discrepancy > 0);

  if v_unliquidated_count > 0 then
    v_is_deletable := false;
    v_reasons := array_append(v_reasons, format('Cannot close organization with %s unsettled advance(s) or unresolved shortage(s) totaling %s centavos. All cash advances must be liquidated or settled first.', v_unliquidated_count, v_unliquidated_centavos));
  end if;

  select count(*) into v_members_count
  from public.organization_members
  where organization_id = p_org_id and status = 'active';

  return jsonb_build_object(
    'organization_id', p_org_id,
    'is_deletable', v_is_deletable,
    'unliquidated_count', v_unliquidated_count,
    'unliquidated_amount_centavos', v_unliquidated_centavos,
    'members_count', v_members_count,
    'reasons', v_reasons
  );
end;
$$;
commit;
