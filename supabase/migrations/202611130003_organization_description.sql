begin;
alter table public.organizations add column description text check (char_length(description) <= 300);
create or replace function public.update_organization_profile(
  p_org_id uuid,
  p_name text,
  p_currency text, p_description text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_old_name text;
  v_old_description text;
  v_old_currency text;
  v_clean_name text;
  v_clean_currency text;
begin
  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = auth.uid() and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin') then
    raise exception 'Insufficient permissions to update workspace settings';
  end if;

  v_clean_name := trim(p_name);
  if length(v_clean_name) < 1 or length(v_clean_name) > 150 then
    raise exception 'Organization name must be between 1 and 150 characters';
  end if;

  select name, currency, description into v_old_name, v_old_currency, v_old_description from public.organizations where id = p_org_id for update;

  v_clean_currency := upper(trim(coalesce(p_currency, v_old_currency)));
  if length(v_clean_currency) != 3 then
    raise exception 'Currency must be a 3-letter code';
  end if;

  update public.organizations
  set name = v_clean_name,
      currency = v_clean_currency, description = nullif(trim(p_description), '')
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'update_organization',
    p_org_id,
    jsonb_build_object('name', v_old_name, 'currency', v_old_currency, 'description', v_old_description),
    jsonb_build_object('name', v_clean_name, 'currency', v_clean_currency, 'description', nullif(trim(p_description), ''))
  );

  return jsonb_build_object(
    'id', p_org_id,
    'name', v_clean_name,
    'currency', v_clean_currency
  );
end;
$$;

revoke all on function public.update_organization_profile(uuid, text, text, text) from public, anon;
grant execute on function public.update_organization_profile(uuid, text, text, text) to authenticated;

commit;
