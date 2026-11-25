begin;

drop function if exists public.set_organization_type(uuid, text);

create or replace function public.set_organization_type(
  target_org uuid,
  org_type text,
  sync_directory_fields boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_admin(target_org, auth.uid()) then
    raise exception 'You cannot change organization type.' using errcode = '42501';
  end if;
  if org_type is null or org_type not in ('student', 'workplace', 'club', 'nonprofit', 'other') then
    raise exception 'Choose a valid organization type.' using errcode = '23514';
  end if;

  update public.organizations
  set organization_type = org_type
  where id = target_org;

  if coalesce(sync_directory_fields, false) then
    insert into public.directory_field_definitions (
      organization_id, key, label, kind, options, display_order,
      template_version, import_aliases, default_visible, active
    )
    select
      target_org, t.key, t.label, t.kind, t.options, t.display_order,
      1, t.aliases, true, true
    from public.directory_template_fields(org_type) t
    on conflict (organization_id, key) do update
      set active = true,
          default_visible = true
      where public.directory_field_definitions.active = false;
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, entity_id, after_value)
  values (
    target_org,
    auth.uid(),
    'organization_type_changed',
    target_org,
    jsonb_build_object('organization_type', org_type, 'sync_directory_fields', coalesce(sync_directory_fields, false))
  );
end;
$$;

revoke all on function public.set_organization_type(uuid, text, boolean) from public, anon;
grant execute on function public.set_organization_type(uuid, text, boolean) to authenticated;

commit;
