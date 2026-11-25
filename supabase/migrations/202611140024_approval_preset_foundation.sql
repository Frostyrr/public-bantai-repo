begin;
alter table public.organizations
 add column approval_preset text not null default 'balanced' check (approval_preset in ('simple','balanced','strict')),
 add column approval_preset_version integer not null default 1;

create function public.set_approval_preset(org uuid, preset text, expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_org public.organizations;
begin
 select * into current_org from public.organizations where id=org for update;
 if not found or current_org.closed_at is not null or not exists (
   select 1 from public.organization_members where organization_id=org and profile_id=auth.uid() and status='active' and role='owner'
 ) then raise exception 'Only an active organization owner can update the approval policy.' using errcode='42501'; end if;
 if preset is null or preset not in ('simple','balanced','strict') then
   raise exception 'Choose a valid approval policy.' using errcode='23514';
 end if;
 if current_org.approval_preset_version is distinct from expected_version then
   raise exception 'The policy changed. Refresh and review it again.' using errcode='40001';
 end if;
 if current_org.approval_preset <> preset then
   update public.organizations set approval_preset=preset, approval_preset_version=expected_version+1 where id=org;
   insert into public.audit_logs(organization_id, actor_id, action, entity_id, before_value, after_value)
   values(org, auth.uid(), 'approval_preset_changed', org,
     jsonb_build_object('preset',current_org.approval_preset,'version',expected_version),
     jsonb_build_object('preset',preset,'version',expected_version+1));
   expected_version := expected_version+1;
 end if;
 return jsonb_build_object('approval_preset',preset,'approval_preset_version',expected_version);
end;
$$;
revoke all on function public.set_approval_preset(uuid,text,integer) from public,anon;
grant execute on function public.set_approval_preset(uuid,text,integer) to authenticated;
commit;
