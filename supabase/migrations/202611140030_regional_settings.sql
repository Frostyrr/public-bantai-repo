begin;

create or replace function public.update_organization_regional_settings(
  p_org_id uuid,
  p_currency text default null,
  p_time_zone text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old_currency text;
  v_old_time_zone text;
  v_clean_currency text;
  v_clean_time_zone text;
begin
  if not public.is_org_admin(p_org_id, auth.uid()) then
    raise exception 'Only workspace owners and administrators can update regional settings.' using errcode = '42501';
  end if;

  select currency::text, time_zone
  into v_old_currency, v_old_time_zone
  from public.organizations
  where id = p_org_id;

  if not found then
    raise exception 'Organization not found.' using errcode = 'P0002';
  end if;

  if p_currency is null and p_time_zone is null then
    raise exception 'Provide at least one regional setting to update.' using errcode = '22023';
  end if;

  v_clean_currency := case
    when p_currency is not null then upper(trim(p_currency))
    else v_old_currency
  end;

  if length(v_clean_currency) <> 3 then
    raise exception 'Currency must be a 3-letter code.' using errcode = '23514';
  end if;

  if p_time_zone is not null then
    v_clean_time_zone := trim(p_time_zone);
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_clean_time_zone)
      or (position('/' in v_clean_time_zone) = 0 and v_clean_time_zone <> 'UTC') then
      raise exception 'Choose a valid IANA time zone.' using errcode = '23514';
    end if;
  else
    v_clean_time_zone := v_old_time_zone;
  end if;

  update public.organizations
  set currency = v_clean_currency,
      time_zone = v_clean_time_zone
  where id = p_org_id;

  if v_clean_currency is distinct from v_old_currency or v_clean_time_zone is distinct from v_old_time_zone then
    insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
    values (
      p_org_id,
      auth.uid(),
      session_user,
      'organization_regional_settings_updated',
      p_org_id,
      jsonb_build_object('currency', v_old_currency, 'time_zone', v_old_time_zone),
      jsonb_build_object('currency', v_clean_currency, 'time_zone', v_clean_time_zone)
    );
  end if;

  return jsonb_build_object(
    'id', p_org_id,
    'currency', v_clean_currency,
    'time_zone', v_clean_time_zone
  );
end;
$$;

revoke all on function public.update_organization_regional_settings(uuid, text, text) from public, anon;
grant execute on function public.update_organization_regional_settings(uuid, text, text) to authenticated;

create or replace function public.set_initial_organization_time_zone(
  p_org_id uuid,
  p_time_zone text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_clean text := trim(coalesce(p_time_zone, ''));
  v_current text;
begin
  if not public.is_org_admin(p_org_id, auth.uid()) then
    raise exception 'Only workspace owners and administrators can set the organization time zone.' using errcode = '42501';
  end if;

  if v_clean = '' or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_clean)
    or (position('/' in v_clean) = 0 and v_clean <> 'UTC') then
    raise exception 'Choose a valid IANA time zone.' using errcode = '23514';
  end if;

  update public.organizations
  set time_zone = v_clean
  where id = p_org_id
    and time_zone is null;

  select time_zone into v_current
  from public.organizations
  where id = p_org_id;

  return v_current;
end;
$$;

revoke all on function public.set_initial_organization_time_zone(uuid, text) from public, anon;
grant execute on function public.set_initial_organization_time_zone(uuid, text) to authenticated;

commit;
