begin;

-- These feature-branch migrations have not been rolled out. Never discard an
-- enrolled inbox if a development database already exercised the prior version.
do $$
begin
  if exists(select 1 from bantai_private.email_mfa
            where enrolled_email is not null or pending_email is not null) then
    raise exception 'Existing email MFA addresses require an encrypted data migration first';
  end if;
end;
$$;

alter table bantai_private.email_mfa rename column enrolled_email to enrolled_email_ciphertext;
alter table bantai_private.email_mfa rename column pending_email to pending_email_ciphertext;

drop function public.bantai_issue_email_mfa(uuid, uuid, text, boolean, text);
drop function public.bantai_verify_email_mfa(uuid, uuid, text, boolean, text);

create function public.bantai_email_mfa_pending_address(p_user uuid, p_session uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select pending_email_ciphertext from bantai_private.email_mfa
  where user_id = p_user and session_id = p_session and digest is not null
$$;

create or replace function public.bantai_email_mfa_enabled(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from bantai_private.email_mfa where user_id = p_user and enrolled_email_ciphertext is not null)
$$;

create or replace function public.bantai_disable_email_mfa(p_user uuid, p_session uuid, p_aal text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from bantai_private.email_mfa where user_id = p_user for update;
  if bantai_private.session_decision(p_session, p_user) is distinct from 'active'
     or not bantai_private.mfa_allows(p_user, p_session, p_aal) then return false; end if;
  delete from bantai_private.email_mfa_proofs where user_id = p_user;
  update bantai_private.email_mfa set enrolled_email_ciphertext = null,
    pending_email_ciphertext = null, digest = null, trusted_totp_factors = '{}'::uuid[]
    where user_id = p_user;
  return true;
end;
$$;

create function public.bantai_issue_email_mfa(p_user uuid, p_session uuid, p_digest text, p_enroll boolean, p_aal text,
  p_ciphertext text, p_email_hash text)
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
    if v_state.enrolled_email_ciphertext is not null or not bantai_private.mfa_allows(p_user, p_session, p_aal)
    then return null; end if;
    if p_ciphertext is null or not exists(
      select 1 from auth.users where id = p_user and email_confirmed_at is not null
        and encode(sha256(convert_to(email, 'UTF8')), 'hex') = p_email_hash
    ) then return null; end if;
    v_email := p_ciphertext;
  else
    v_email := v_state.enrolled_email_ciphertext;
  end if;
  if v_email is null then return null; end if;
  select array(select t from unnest(v_state.send_times) as t where t > v_now - interval '15 minutes') into v_sends;
  if v_state.sent_at > v_now - interval '60 seconds' or cardinality(v_sends) >= 4
  then return null; end if;
  update bantai_private.email_mfa set session_id = p_session, digest = p_digest,
    pending_email_ciphertext = case when p_enroll then v_email else null end,
    sent_at = v_now, expires_at = v_now + interval '5 minutes', attempts = 0,
    send_times = array_append(v_sends, v_now)
  where user_id = p_user;
  return v_email;
end;
$$;

create function public.bantai_verify_email_mfa(p_user uuid, p_session uuid, p_digest text, p_enroll boolean, p_aal text,
  p_ciphertext text, p_email_hash text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_state bantai_private.email_mfa;
begin
  select * into v_state from bantai_private.email_mfa where user_id = p_user for update;
  if v_state.session_id is distinct from p_session
     or p_enroll is distinct from (v_state.pending_email_ciphertext is not null)
     or v_state.digest is null or v_state.expires_at <= clock_timestamp()
     or bantai_private.session_decision(p_session, p_user) is distinct from 'active'
  then return false; end if;
  if p_enroll then
    if v_state.pending_email_ciphertext is distinct from p_ciphertext
       or not bantai_private.mfa_allows(p_user, p_session, p_aal)
       or not exists(select 1 from auth.users where id = p_user
                     and encode(sha256(convert_to(email, 'UTF8')), 'hex') = p_email_hash
                     and email_confirmed_at is not null)
    then return false; end if;
  elsif v_state.enrolled_email_ciphertext is null then
    return false;
  end if;
  if v_state.digest is distinct from p_digest then
    update bantai_private.email_mfa set attempts = attempts + 1,
      digest = case when attempts >= 2 then null else digest end where user_id = p_user;
    return false;
  end if;
  update bantai_private.email_mfa set digest = null, pending_email_ciphertext = null,
    enrolled_email_ciphertext = case when p_enroll then v_state.pending_email_ciphertext else enrolled_email_ciphertext end,
    trusted_totp_factors = case when p_enroll then
      array(select id from auth.mfa_factors where user_id = p_user and status = 'verified' and factor_type = 'totp')
      else trusted_totp_factors end
    where user_id = p_user;
  insert into bantai_private.email_mfa_proofs(session_id, user_id) values (p_session, p_user)
    on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.bantai_email_mfa_pending_address(uuid, uuid),
  public.bantai_issue_email_mfa(uuid, uuid, text, boolean, text, text, text),
  public.bantai_verify_email_mfa(uuid, uuid, text, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bantai_email_mfa_pending_address(uuid, uuid),
  public.bantai_issue_email_mfa(uuid, uuid, text, boolean, text, text, text),
  public.bantai_verify_email_mfa(uuid, uuid, text, boolean, text, text, text)
  to service_role;

commit;
