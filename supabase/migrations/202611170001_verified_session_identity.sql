-- For backend requests with a verified project JWT. Keep the Auth account
-- checks and the existing session policy in one database round trip.
create function public.bantai_check_verified_session(p_session uuid, p_user uuid, p_activity boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user auth.users;
  v_decision text;
begin
  select * into v_user from auth.users where id = p_user;
  if not found or v_user.deleted_at is not null or v_user.banned_until > now() then
    return jsonb_build_object('decision', 'revoked');
  end if;
  if v_user.email_confirmed_at is null then
    return jsonb_build_object('decision', 'unverified');
  end if;

  v_decision := public.bantai_check_session(p_session, p_user, p_activity);
  if v_decision is distinct from 'active' then
    return jsonb_build_object('decision', v_decision);
  end if;
  return jsonb_build_object(
    'decision', 'active',
    'user_metadata', coalesce(v_user.raw_user_meta_data, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.bantai_check_verified_session(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.bantai_check_verified_session(uuid, uuid, boolean) to service_role;
