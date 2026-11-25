begin;
create or replace function bantai_private.password_history_question_core(p_user uuid, p_session uuid, p_aal text, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q bantai_private.security_questions; c bantai_private.security_question_challenges;
  ids integer[]; changed integer;
begin
  if not exists(select 1 from auth.sessions where id=p_session and user_id=p_user)
     or bantai_private.session_decision(p_session,p_user) is distinct from 'active'
     or (p_action in ('attempt','prove','ticket') and exists(select 1 from auth.mfa_factors where user_id=p_user and status='verified' and factor_type='totp') and p_aal is distinct from 'aal2')
  then raise exception 'Verification required'; end if;
  if p_action in ('send','confirm','authorize_totp','save','disable') and not exists(
    select 1 from auth.users where id=p_user and raw_app_meta_data->>'provider'='email'
  ) then raise exception 'Recovery questions are available to email-registered accounts only'; end if;
  -- Serialize changes and verification attempts for this account, across sessions.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 8731));
  delete from bantai_private.security_question_proofs where user_id=p_user and expires_at<=now();
  delete from bantai_private.security_question_password_tickets where user_id=p_user and expires_at<=now();
  select * into q from bantai_private.security_questions where user_id=p_user for update;
  if p_action='authorize_totp' then
    if p_aal is distinct from 'aal2' or not bantai_private.mfa_allows(p_user,p_session,p_aal)
    then raise exception 'Authenticator verification required'; end if;
    insert into bantai_private.security_question_proofs(user_id,session_id,kind) values(p_user,p_session,'manage')
      on conflict(user_id,session_id,kind) do update set expires_at=now()+interval '5 minutes';
    return '{"ok":true}';
  elsif p_action='status' then
    return jsonb_build_object('eligible',exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'provider'='email'),'enabled', q.user_id is not null, 'questions', coalesce(to_jsonb(q.questions),'[]'::jsonb));
  elsif p_action='send' then
    select * into c from bantai_private.security_question_challenges where user_id=p_user for update;
    if c.sent_at > now()-interval '60 seconds' then return jsonb_build_object('limited',true); end if;
    insert into bantai_private.security_question_challenges(user_id,session_id,digest)
      values(p_user,p_session,p_data->>'digest') on conflict(user_id) do update
      set session_id=excluded.session_id,digest=excluded.digest,sent_at=now(),expires_at=now()+interval '5 minutes',attempts=0;
    delete from bantai_private.security_question_proofs where user_id=p_user and kind='manage';
    return '{"ok":true}';
  elsif p_action='confirm' then
    select * into c from bantai_private.security_question_challenges where user_id=p_user for update;
    if c.user_id is null or c.session_id<>p_session or c.expires_at<=now() or c.attempts>=5 then return '{"ok":false}'; end if;
    update bantai_private.security_question_challenges set attempts=attempts+1 where user_id=p_user;
    if c.digest is distinct from p_data->>'digest' then return '{"ok":false}'; end if;
    delete from bantai_private.security_question_challenges where user_id=p_user;
    insert into bantai_private.security_question_proofs(user_id,session_id,kind) values(p_user,p_session,'manage')
      on conflict(user_id,session_id,kind) do update set expires_at=now()+interval '5 minutes';
    return '{"ok":true}';
  elsif p_action in ('save','disable') then
    delete from bantai_private.security_question_proofs where user_id=p_user and session_id=p_session and kind='manage' and expires_at>now();
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'Verify a fresh code first'; end if;
    if p_action='save' then
      select array_agg(v::integer) into ids from jsonb_array_elements_text(p_data->'questions') v;
      if cardinality(ids)<>3 or (select count(distinct v) from unnest(ids) v)<>3
        or exists(select 1 from unnest(ids) v where v<1 or v>8)
        or jsonb_array_length(p_data->'answers')<>3 then raise exception 'Choose three distinct questions'; end if;
      insert into bantai_private.security_questions(user_id,questions,answers) values(p_user,ids,p_data->'answers')
        on conflict(user_id) do update set questions=excluded.questions,answers=excluded.answers,revision=gen_random_uuid(),attempts=0,window_at=now();
    else
      delete from bantai_private.security_questions where user_id=p_user;
    end if;
    delete from bantai_private.security_question_proofs where user_id=p_user;
    delete from bantai_private.security_question_password_tickets where user_id=p_user;
    -- Queued change notice contains no question or answer data.
    insert into public.notification_delivery_queue(recipient_user_id,channel,notification_type,title,message,metadata)
      values(p_user,'email','security.auth_alert','Your Bantai recovery questions were changed',
        case when p_action='disable' then 'Recovery questions were disabled.' else 'Recovery questions were updated.' end,
        jsonb_build_object('occurred_at',now()));
    return '{"ok":true}';
  elsif p_action='attempt' then
    if q.user_id is null then return '{"enabled":false}'; end if;
    if q.window_at<=now()-interval '15 minutes' then
      update bantai_private.security_questions set attempts=0,window_at=now() where user_id=p_user;
      q.attempts=0;
    end if;
    if q.attempts>=5 then return '{"limited":true}'; end if;
    update bantai_private.security_questions set attempts=attempts+1 where user_id=p_user;
    return jsonb_build_object('enabled',true,'answers',q.answers,'revision',q.revision);
  elsif p_action='prove' then
    if q.user_id is null or q.revision::text is distinct from p_data->>'revision' then return '{"ok":false}'; end if;
    insert into bantai_private.security_question_proofs(user_id,session_id,kind,revision) values(p_user,p_session,'recovery',q.revision)
      on conflict(user_id,session_id,kind) do update set revision=excluded.revision,expires_at=now()+interval '5 minutes';
    return '{"ok":true}';
  elsif p_action='ticket' then
    if q.user_id is not null then
      delete from bantai_private.security_question_proofs where user_id=p_user and session_id=p_session
        and kind='recovery' and revision=q.revision and expires_at>now();
      get diagnostics changed=row_count;
      if changed<>1 then raise exception 'Answer your recovery questions first'; end if;
    end if;
    insert into bantai_private.security_question_password_tickets(user_id,digest) values(p_user,p_data->>'digest')
      on conflict(user_id) do update set digest=excluded.digest,expires_at=now()+interval '30 seconds';
    return '{"ok":true}';
  end if;
  raise exception 'Unsupported action';
end;
$$;

revoke all on function bantai_private.password_history_question_core(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
commit;
