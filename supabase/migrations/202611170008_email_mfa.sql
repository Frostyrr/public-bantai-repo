begin;

create table bantai_private.email_mfa (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enrolled_email text,
  pending_email text,
  trusted_totp_factors uuid[] not null default '{}',
  session_id uuid,
  digest text,
  sent_at timestamptz,
  expires_at timestamptz,
  attempts smallint not null default 0,
  send_times timestamptz[] not null default '{}'
);
create table bantai_private.email_mfa_proofs (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table bantai_private.email_mfa enable row level security;
alter table bantai_private.email_mfa_proofs enable row level security;

create function public.bantai_email_mfa_enabled(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from bantai_private.email_mfa where user_id = p_user and enrolled_email is not null)
$$;

create function bantai_private.mfa_allows(p_user uuid, p_session uuid, p_aal text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case when public.bantai_email_mfa_enabled(p_user) then
    exists(select 1 from bantai_private.email_mfa_proofs where user_id = p_user and session_id = p_session)
    or (p_aal is not distinct from 'aal2' and exists(
      select 1 from auth.sessions s
      join auth.mfa_factors f on f.id = s.factor_id and f.user_id = s.user_id
      join bantai_private.email_mfa e on e.user_id = s.user_id
      where s.id = p_session and s.user_id = p_user
        and f.status = 'verified' and f.id = any(e.trusted_totp_factors)
    ))
  else p_aal is not distinct from 'aal2' or not public.bantai_mfa_required(p_user)
  end
$$;

create function public.bantai_disable_email_mfa(p_user uuid, p_session uuid, p_aal text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from bantai_private.email_mfa where user_id = p_user for update;
  if bantai_private.session_decision(p_session, p_user) is distinct from 'active'
     or not bantai_private.mfa_allows(p_user, p_session, p_aal) then return false; end if;
  delete from bantai_private.email_mfa_proofs where user_id = p_user;
  update bantai_private.email_mfa set enrolled_email = null,
    pending_email = null, digest = null, trusted_totp_factors = '{}'::uuid[]
    where user_id = p_user;
  return true;
end;
$$;

-- Newly enrolled authenticators become alternatives only from a session that
-- already satisfies Bantai MFA. A new native AAL2 token alone is insufficient.
create function public.bantai_trust_email_mfa_totp(p_user uuid, p_session uuid, p_aal text, p_factor uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from bantai_private.email_mfa where user_id = p_user for update;
  if bantai_private.session_decision(p_session, p_user) is distinct from 'active'
     or not bantai_private.mfa_allows(p_user, p_session, p_aal) then return false; end if;
  if not public.bantai_email_mfa_enabled(p_user) then return true; end if;
  if not exists(select 1 from auth.mfa_factors where id = p_factor and user_id = p_user
                and factor_type = 'totp' and status = 'verified') then return false; end if;
  update bantai_private.email_mfa
  set trusted_totp_factors = array_append(trusted_totp_factors, p_factor)
  where user_id = p_user and not (p_factor = any(trusted_totp_factors));
  return true;
end;
$$;

create function public.bantai_issue_email_mfa(p_user uuid, p_session uuid, p_digest text, p_enroll boolean, p_aal text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_state bantai_private.email_mfa;
  v_now timestamptz;
  v_sends timestamptz[];
  v_email text;
begin
  if p_enroll then
    insert into bantai_private.email_mfa(user_id) values (p_user) on conflict do nothing;
  end if;
  select * into v_state from bantai_private.email_mfa where user_id = p_user for update;
  v_now := clock_timestamp();
  if p_digest is null or bantai_private.session_decision(p_session, p_user) is distinct from 'active'
     or exists(select 1 from bantai_private.email_mfa_proofs where session_id = p_session)
  then return null; end if;
  if p_enroll then
    if v_state.enrolled_email is not null or not bantai_private.mfa_allows(p_user, p_session, p_aal)
    then return null; end if;
    select email into v_email from auth.users where id = p_user and email_confirmed_at is not null;
  else
    v_email := v_state.enrolled_email;
  end if;
  if v_email is null then return null; end if;
  select array(select t from unnest(v_state.send_times) as t where t > v_now - interval '15 minutes') into v_sends;
  if v_state.sent_at > v_now - interval '60 seconds' or cardinality(v_sends) >= 4
  then return null; end if;
  update bantai_private.email_mfa set session_id = p_session, digest = p_digest,
    pending_email = case when p_enroll then v_email else null end,
    sent_at = v_now, expires_at = v_now + interval '5 minutes', attempts = 0,
    send_times = array_append(v_sends, v_now)
  where user_id = p_user;
  return v_email;
end;
$$;

create function public.bantai_verify_email_mfa(p_user uuid, p_session uuid, p_digest text, p_enroll boolean, p_aal text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_state bantai_private.email_mfa;
begin
  select * into v_state from bantai_private.email_mfa where user_id = p_user for update;
  if v_state.session_id is distinct from p_session
     or p_enroll is distinct from (v_state.pending_email is not null)
     or v_state.digest is null or v_state.expires_at <= clock_timestamp()
     or bantai_private.session_decision(p_session, p_user) is distinct from 'active'
  then return false; end if;
  if p_enroll then
    if not bantai_private.mfa_allows(p_user, p_session, p_aal)
       or not exists(select 1 from auth.users where id = p_user
                     and email = v_state.pending_email and email_confirmed_at is not null)
    then return false; end if;
  elsif v_state.enrolled_email is null then
    return false;
  end if;
  if v_state.digest is distinct from p_digest then
    update bantai_private.email_mfa set attempts = attempts + 1,
      digest = case when attempts >= 2 then null else digest end where user_id = p_user;
    return false;
  end if;
  update bantai_private.email_mfa set digest = null, pending_email = null,
    enrolled_email = case when p_enroll then v_state.pending_email else enrolled_email end,
    trusted_totp_factors = case when p_enroll then
      array(select id from auth.mfa_factors where user_id = p_user and status = 'verified' and factor_type = 'totp')
      else trusted_totp_factors end
    where user_id = p_user;
  insert into bantai_private.email_mfa_proofs(session_id, user_id) values (p_session, p_user)
    on conflict do nothing;
  return true;
end;
$$;

revoke all on function bantai_private.mfa_allows(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bantai_email_mfa_enabled(uuid),
  public.bantai_disable_email_mfa(uuid, uuid, text), public.bantai_trust_email_mfa_totp(uuid, uuid, text, uuid),
  public.bantai_issue_email_mfa(uuid, uuid, text, boolean, text), public.bantai_verify_email_mfa(uuid, uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.bantai_email_mfa_enabled(uuid),
  public.bantai_disable_email_mfa(uuid, uuid, text), public.bantai_trust_email_mfa_totp(uuid, uuid, text, uuid),
  public.bantai_issue_email_mfa(uuid, uuid, text, boolean, text), public.bantai_verify_email_mfa(uuid, uuid, text, boolean, text)
  to service_role;

create or replace function public.bantai_check_session(p_session uuid, p_user uuid, p_activity boolean, p_aal text)
returns text language sql volatile security definer set search_path = ''
as $$
  select case when not bantai_private.mfa_allows(p_user, p_session, p_aal)
    then 'mfa_required'
    else public.bantai_check_session(p_session, p_user, p_activity)
  end;
$$;
revoke all on function public.bantai_check_session(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.bantai_check_session(uuid, uuid, boolean, text) to service_role;

create or replace function public.bantai_check_verified_session(p_session uuid, p_user uuid, p_activity boolean, p_aal text)
returns jsonb language sql volatile security definer set search_path = ''
as $$
  select case when not bantai_private.mfa_allows(p_user, p_session, p_aal)
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
  if not bantai_private.mfa_allows(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid, auth.jwt()->>'aal') then
    raise sqlstate 'PGRST' using
      message = '{"code":"mfa_required","message":"Verify your sign-in to continue."}',
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
  select bantai_private.mfa_allows(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid, auth.jwt()->>'aal')
    and bantai_private.session_decision(nullif(auth.jwt()->>'session_id', '')::uuid, auth.uid()) = 'active';
$$;

commit;
