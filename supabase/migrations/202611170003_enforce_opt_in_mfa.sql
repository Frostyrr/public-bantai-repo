-- Check live factors so old AAL1 JWTs cannot bypass a newly verified factor.
create function public.bantai_mfa_required(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.mfa_factors f
    where f.user_id = p_user and f.status = 'verified'
  );
$$;
revoke all on function public.bantai_mfa_required(uuid) from public, anon, authenticated;
grant execute on function public.bantai_mfa_required(uuid) to service_role;

-- Overloads preserve compatibility with the API while the migration rolls out.
create function public.bantai_check_session(p_session uuid, p_user uuid, p_activity boolean, p_aal text)
returns text language sql volatile security definer set search_path = ''
as $$
  select case when p_aal is distinct from 'aal2' and public.bantai_mfa_required(p_user)
    then 'mfa_required'
    else public.bantai_check_session(p_session, p_user, p_activity)
  end;
$$;
revoke all on function public.bantai_check_session(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.bantai_check_session(uuid, uuid, boolean, text) to service_role;

create function public.bantai_check_verified_session(p_session uuid, p_user uuid, p_activity boolean, p_aal text)
returns jsonb language sql volatile security definer set search_path = ''
as $$
  select case when p_aal is distinct from 'aal2' and public.bantai_mfa_required(p_user)
    then jsonb_build_object('decision', 'mfa_required')
    else public.bantai_check_verified_session(p_session, p_user, p_activity)
  end;
$$;
revoke all on function public.bantai_check_verified_session(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.bantai_check_verified_session(uuid, uuid, boolean, text) to service_role;

create or replace function bantai_gateway.check_session()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_decision text;
begin
  if auth.role() is distinct from 'authenticated' then return; end if;
  if (auth.jwt()->>'aal') is distinct from 'aal2' and public.bantai_mfa_required(auth.uid()) then
    raise sqlstate 'PGRST' using
      message = '{"code":"mfa_required","message":"Enter a code from your authenticator app to continue."}',
      detail = '{"status":403,"headers":{"Cache-Control":"no-store"}}';
  end if;
  v_decision := bantai_private.session_decision(nullif(auth.jwt()->>'session_id', '')::uuid, auth.uid());
  if v_decision = 'active' then return; end if;
  if v_decision in ('idle', 'absolute') then
    raise sqlstate 'PGRST' using
      message = '{"code":"session_timed_out","message":"Your session timed out. Please sign in again."}',
      detail = '{"status":401,"headers":{"Cache-Control":"no-store"}}';
  end if;
  if v_decision in ('suspended', 'locked') then
    raise sqlstate 'PT403' using message = 'Account access is restricted.';
  end if;
  raise sqlstate 'PT401' using message = 'Your session has ended. Please sign in again.';
end;
$$;

notify pgrst, 'reload schema';

create or replace function public.bantai_storage_session_allowed()
returns boolean language sql volatile security definer set search_path = ''
as $$
  select ((auth.jwt()->>'aal') is not distinct from 'aal2' or not public.bantai_mfa_required(auth.uid()))
    and bantai_private.session_decision(nullif(auth.jwt()->>'session_id', '')::uuid, auth.uid()) = 'active';
$$;
