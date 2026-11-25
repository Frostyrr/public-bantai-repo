begin;

-- Invitees may see a workspace name from their invitation before they can read
-- the workspace itself. Keep the ordinary notification and workspace RLS intact.
create or replace function public.list_my_pending_organization_invitations()
returns table (id uuid, organization_id uuid, organization_name text, role text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.organization_id, o.name, i.role, i.created_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.invited_user_id = (select auth.uid())
    and i.status = 'pending'
    and o.closed_at is null and o.suspended_at is null
  order by i.created_at desc, i.id desc
$$;
revoke all on function public.list_my_pending_organization_invitations() from public, anon;
grant execute on function public.list_my_pending_organization_invitations() to authenticated;

create or replace function public.respond_organization_invitation(
  p_invitation_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_inv public.organization_invitations;
  v_next_status text := case when p_accept then 'accepted' else 'declined' end;
begin
  if v_actor_id is null or p_accept is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into v_inv
  from public.organization_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found.' using errcode = 'P0002';
  end if;

  if v_inv.invited_user_id is distinct from v_actor_id then
    raise exception 'You are not authorized to respond to this invitation.' using errcode = '42501';
  end if;

  if v_inv.status <> 'pending' then
    raise exception 'This invitation has already been responded to.' using errcode = '22023';
  end if;

  if p_accept then
    perform 1 from public.organizations
    where id = v_inv.organization_id and closed_at is null and suspended_at is null
    for share;
    if not found then
      raise exception 'This workspace is unavailable.' using errcode = '42501';
    end if;

    insert into public.organization_members (organization_id, profile_id, role, status)
    values (v_inv.organization_id, v_actor_id, v_inv.role, 'active')
    on conflict (organization_id, profile_id) do nothing;

    perform 1 from public.organization_members
    where organization_id = v_inv.organization_id and profile_id = v_actor_id and status = 'active'
    for update;
    if not found then
      raise exception 'Your workspace membership is restricted.' using errcode = '42501';
    end if;
  end if;

  update public.organization_invitations
  set status = v_next_status, responded_at = now()
  where id = v_inv.id;

  update public.notifications
  set read_at = now()
  where recipient_user_id = v_actor_id and (organization_id is null or organization_id = v_inv.organization_id)
    and type = 'organization.invitation_created' and entity_id = v_inv.id and read_at is null;

  return jsonb_build_object(
    'id', v_inv.id,
    'organization_id', v_inv.organization_id,
    'status', v_next_status
  );
end;
$$;

revoke all on function public.respond_organization_invitation(uuid, boolean) from public, anon;
grant execute on function public.respond_organization_invitation(uuid, boolean) to authenticated;


commit;
