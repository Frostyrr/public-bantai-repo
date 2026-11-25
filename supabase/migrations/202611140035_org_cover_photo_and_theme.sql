begin;

-- Persist organization cover photo and theme on the organization record so all members see the same branding across accounts and devices.
alter table public.organizations
  add column if not exists cover_image_url text check (cover_image_url is null or length(trim(cover_image_url)) between 1 and 500000),
  add column if not exists cover_theme text check (cover_theme is null or length(trim(cover_theme)) between 1 and 64);

create or replace function public.update_organization_cover(
  p_org_id uuid,
  p_cover_image_url text default null,
  p_cover_theme text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_old_image text;
  v_old_theme text;
  v_new_image text;
  v_new_theme text;
begin
  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = auth.uid() and status = 'active';

  if v_role not in ('owner', 'organization_admin') then
    raise exception 'Insufficient permissions to update workspace cover';
  end if;

  select cover_image_url, cover_theme
  into v_old_image, v_old_theme
  from public.organizations
  where id = p_org_id;

  v_new_image := nullif(trim(p_cover_image_url), '');
  v_new_theme := nullif(trim(p_cover_theme), '');

  update public.organizations
  set
    cover_image_url = v_new_image,
    cover_theme = v_new_theme
  where id = p_org_id;

  insert into public.audit_logs(organization_id, actor_id, database_actor, action, entity_id, before_value, after_value)
  values (
    p_org_id,
    auth.uid(),
    session_user,
    'update_organization_cover',
    p_org_id,
    jsonb_build_object('cover_image_url', v_old_image, 'cover_theme', v_old_theme),
    jsonb_build_object('cover_image_url', v_new_image, 'cover_theme', v_new_theme)
  );

  return jsonb_build_object(
    'success', true,
    'cover_image_url', v_new_image,
    'cover_theme', v_new_theme
  );
end;
$$;

revoke all on function public.update_organization_cover(uuid, text, text) from public, anon;
grant execute on function public.update_organization_cover(uuid, text, text) to authenticated;

commit;
