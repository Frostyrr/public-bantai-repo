begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Wrappers and the existing trigger must retain one reviewed definer owner.
-- Abort before DDL rather than fixing hosted privilege drift with broad grants.
do $$
begin
  if exists(select 1 from pg_proc where oid in (
    'public.bantai_password_history(uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.bantai_sq_action(uuid,uuid,text,text,jsonb)'::regprocedure,
    'bantai_private.commit_managed_password_history()'::regprocedure)
    and proowner<>current_user::regrole)
  then raise exception 'Apply rollout control as the same owner of the existing history and question functions'; end if;
end $$;
-- Shared admission control; environment flags alone never release this gate.
create table bantai_private.password_history_rollout (
  singleton boolean primary key default true check(singleton),
  mode text not null check(mode in ('legacy','managed','frozen')),
  epoch bigint not null default 0,
  changed_at timestamptz not null default clock_timestamp()
);
insert into bantai_private.password_history_rollout(singleton,mode,epoch)
select true,case when exists(select 1 from bantai_private.password_history_operations where status='pending')
  or exists(select 1 from bantai_private.password_history_state where version>0) then 'frozen' else 'legacy' end,
  1;
create table bantai_private.password_history_rollout_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  operator name not null default session_user,
  old_mode text not null,new_mode text not null,epoch bigint not null,reason text not null,
  event text not null default 'mode' check(event in ('mode','drain'))
);
alter table bantai_private.password_history_rollout enable row level security;
alter table bantai_private.password_history_rollout_audit enable row level security;
revoke all on bantai_private.password_history_rollout,bantai_private.password_history_rollout_audit from public,anon,authenticated,service_role;
alter table bantai_private.password_history_operations add column rollout_epoch bigint not null default 0;
-- Also guard inserts from an old already-running function body, rather than
-- relying only on new public wrappers or a deployment's local flags.
create function bantai_private.admit_password_history_operation() returns trigger
language plpgsql security definer set search_path='' as $$
declare admission bantai_private.password_history_rollout;
begin
  select * into strict admission from bantai_private.password_history_rollout where singleton for share;
  if admission.mode<>'managed' then raise exception 'Password admission is paused'; end if;
  new.rollout_epoch:=admission.epoch;
  return new;
end $$;
revoke all on function bantai_private.admit_password_history_operation() from public,anon,authenticated,service_role;
create trigger admit_password_history_operation before insert on bantai_private.password_history_operations
  for each row execute function bantai_private.admit_password_history_operation();
alter function public.bantai_password_history(uuid,uuid,text,text,jsonb) set schema bantai_private;
alter function bantai_private.bantai_password_history(uuid,uuid,text,text,jsonb) rename to password_history_core;
alter function public.bantai_sq_action(uuid,uuid,text,text,jsonb) set schema bantai_private;
alter function bantai_private.bantai_sq_action(uuid,uuid,text,text,jsonb) rename to password_history_question_core;
revoke all on function bantai_private.password_history_core(uuid,uuid,text,text,jsonb),bantai_private.password_history_question_core(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create or replace function bantai_private.password_history_core(p_user uuid,p_session uuid,p_aal text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare a bantai_private.password_history_authorizations;
  op bantai_private.password_history_operations;
  c bantai_private.password_history_challenges; state bantai_private.password_history_state; v bigint;
begin
  if not exists(select 1 from auth.sessions where id=p_session and user_id=p_user)
    or bantai_private.session_decision(p_session,p_user) is distinct from 'active'
  then raise exception 'Session verification required'; end if;
  if p_action='issue_reset' then
    -- Called only after the server has consumed a native recovery OTP.
    insert into bantai_private.password_history_authorizations(id,user_id,session_id,purpose,digest)
      values((p_data->>'id')::uuid,p_user,p_session,'reset',p_data->>'digest');
    return '{"ok":true}';
  end if;
  if p_action='send' then
    perform pg_advisory_xact_lock(hashtextextended(p_user::text,9182));
    select * into c from bantai_private.password_history_challenges where user_id=p_user for update;
    if c.sent_at>clock_timestamp()-interval '60 seconds' then return '{"limited":true}'; end if;
    insert into bantai_private.password_history_challenges(user_id,session_id,digest) values(p_user,p_session,p_data->>'digest')
      on conflict(user_id) do update set session_id=excluded.session_id,digest=excluded.digest,
        attempts=0,sent_at=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes';
    return '{"ok":true}';
  elsif p_action='confirm' then
    select * into c from bantai_private.password_history_challenges where user_id=p_user for update;
    if c.user_id is null or c.session_id<>p_session or c.expires_at<=clock_timestamp() or c.attempts>=5 then return '{"ok":false}'; end if;
    update bantai_private.password_history_challenges set attempts=attempts+1 where user_id=p_user;
    if c.digest is distinct from p_data->>'codeDigest' then return '{"ok":false}'; end if;
    delete from bantai_private.password_history_challenges where user_id=p_user;
    insert into bantai_private.password_history_authorizations(id,user_id,session_id,purpose,digest)
      values((p_data->>'id')::uuid,p_user,p_session,'change',p_data->>'digest');
    return '{"ok":true}';
  end if;
  if p_action='status' then
    return jsonb_build_object('version',coalesce((select version from bantai_private.password_history_state where user_id=p_user),0),
      'tracked', (select count(*) from bantai_private.password_history where user_id=p_user),
      'stale',coalesce((select stale from bantai_private.password_history_state where user_id=p_user),false),
      'coverageGap',coalesce((select coverage_gap from bantai_private.password_history_state where user_id=p_user),0),
      'epoch',coalesce((select credential_epoch from bantai_private.password_history_state where user_id=p_user),0),
      'pending',exists(select 1 from bantai_private.password_history_operations where user_id=p_user and status='pending'));
  end if;
  select * into a from bantai_private.password_history_authorizations where id=(p_data->>'authorizationId')::uuid;
  if a.user_id is distinct from p_user or a.session_id is distinct from p_session
    or a.digest is distinct from p_data->>'authorizationDigest' or a.expires_at<=clock_timestamp()
  then raise exception 'Fresh purpose-bound verification required'; end if;
  if p_action='proof' then return jsonb_build_object('purpose',a.purpose,
    'reconciled',a.reconciled_epoch is not distinct from (select credential_epoch from bantai_private.password_history_state where user_id=p_user)); end if;
  if exists(select 1 from auth.mfa_factors where user_id=p_user and status='verified' and factor_type='totp') and p_aal is distinct from 'aal2'
    then raise exception 'Verify your authenticator first'; end if;
  if p_action='snapshot' then
    if a.consumed then raise exception 'Authorization already used'; end if;
    return jsonb_build_object('version',coalesce((select version from bantai_private.password_history_state where user_id=p_user),0),
      'tracked',coalesce((select tracked_count from bantai_private.password_history_state where user_id=p_user),0),
      'epoch',coalesce((select credential_epoch from bantai_private.password_history_state where user_id=p_user),0),
      'stale',coalesce((select stale from bantai_private.password_history_state where user_id=p_user),false),
      'verifiers',coalesce((select jsonb_agg(h.verifier order by h.version desc) from bantai_private.password_history h where user_id=p_user),'[]'::jsonb));
  end if;
  -- Match native Auth lock ordering: user credential row before managed state.
  -- Cancellation waits for an in-flight Auth transaction, then revokes its token.
  perform 1 from auth.users where id=p_user for no key update;
  insert into bantai_private.password_history_state(user_id) values(p_user) on conflict do nothing;
  select * into state from bantai_private.password_history_state where user_id=p_user for update;
  v:=state.version;
  if p_action='stage' then
    select * into a from bantai_private.password_history_authorizations where id=a.id for update;
    if a.consumed or a.expires_at<=clock_timestamp() then raise exception 'Fresh verification required'; end if;
    if v<>(p_data->>'version')::bigint then raise exception 'History changed; try again'; end if;
    if state.credential_epoch is distinct from (p_data->>'epoch')::bigint then raise exception 'Credential changed; use verified recovery'; end if;
    if state.stale and (a.purpose<>'reset' or a.reconciled_epoch is distinct from state.credential_epoch) then raise exception 'Reconcile external credential changes through verified recovery'; end if;
    if a.purpose='change' and v=0 and not exists(select 1 from auth.mfa_amr_claims where session_id=p_session and authentication_method='password') then raise exception 'Use verified recovery to initialize history for this session'; end if;
    if exists(select 1 from bantai_private.password_history_operations where user_id=p_user and status='pending') then raise exception 'Reconcile the pending password change first'; end if;
    if a.purpose='change' and exists(select 1 from bantai_private.security_questions where user_id=p_user) then raise exception 'Use question-protected recovery'; end if;
    if a.purpose='reset' then
      perform bantai_private.password_history_question_core(p_user,p_session,p_aal,'ticket',jsonb_build_object('digest',md5(p_data->>'questionTicket')));
    end if;
    insert into bantai_private.password_history_operations(id,user_id,session_id,authorization_id,version,epoch,digest,candidate,seed,question_ticket)
      values((p_data->>'operationId')::uuid,p_user,p_session,a.id,v,state.credential_epoch,p_data->>'operationDigest',p_data->>'candidate',
        case when v=0 then p_data->>'seed' else null end,case when a.purpose='reset' then p_data->>'questionTicket' else null end);
    update bantai_private.password_history_authorizations set consumed=true where id=a.id;
    return '{"ok":true}';
  elsif p_action in ('outcome','cancel','reconcile') then
    if p_action='reconcile' then
      if a.purpose<>'reset' or a.consumed then raise exception 'Fresh recovery verification required'; end if;
      -- Consume any required question proof before acknowledging credential drift.
      perform bantai_private.password_history_question_core(p_user,p_session,p_aal,'ticket',jsonb_build_object('digest',md5('reconcile-'||a.id::text)));
      update bantai_private.password_history_authorizations set reconciled_epoch=state.credential_epoch where id=a.id;
      -- History, its sequence and the coverage gap are deliberately retained.
    end if;
    select * into op from bantai_private.password_history_operations where user_id=p_user
      and (id=nullif(p_data->>'operationId','')::uuid or (not(p_data ? 'operationId') and status='pending'))
      order by created_at desc limit 1 for update;
    if op.id is null then return '{"status":"none"}'; end if;
    if p_action in ('cancel','reconcile') and op.status='pending' then
      if a.purpose<>'reset' and op.authorization_id<>a.id then raise exception 'Fresh recovery verification required'; end if;
      if p_action='cancel' and a.purpose='reset' and op.authorization_id<>a.id then
        perform bantai_private.password_history_question_core(p_user,p_session,p_aal,'ticket',jsonb_build_object('digest',md5('cancel-'||a.id::text)));
      end if;
      update bantai_private.password_history_operations set status='cancelled',candidate=null,seed=null,question_ticket=null where id=op.id;
      -- No credential write committed. A still-fresh grant may retry after the
      -- original operation is fenced; successful grants remain one-use.
      update bantai_private.password_history_authorizations set consumed=false where id=op.authorization_id and id=a.id;
      return '{"status":"cancelled"}';
    end if;
    return jsonb_build_object('status',op.status);
  end if;
  raise exception 'Unsupported password history action';
end $$;

create function public.bantai_password_history_rollout() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('mode',mode,'epoch',epoch,'protocol',2) from bantai_private.password_history_rollout where singleton
$$;
revoke all on function public.bantai_password_history_rollout() from public,anon,authenticated;
grant execute on function public.bantai_password_history_rollout() to service_role;

-- Operator-only transitions. No HTTP endpoint, JWT or service key can mutate mode.
create function bantai_private.set_password_history_mode(target text,reason text) returns jsonb
language plpgsql set search_path='' as $$
declare prior bantai_private.password_history_rollout; next_epoch bigint;
begin
 if target not in ('legacy','managed','frozen') or length(trim(reason))<8 then raise exception 'Mode and audit reason required'; end if;
 select * into strict prior from bantai_private.password_history_rollout where singleton for update;
 if target<>'frozen' and prior.mode<>'frozen' then raise exception 'Freeze before changing admission'; end if;
 if target<>'frozen' and exists(select 1 from bantai_private.password_history_operations where status='pending') then raise exception 'Reconcile pending operations first'; end if;
 next_epoch:=prior.epoch+case when target='frozen' then 1 else 0 end;
 -- Fence old legacy Admin requests, including after returning to legacy mode.
 delete from bantai_private.security_question_password_tickets;
 update bantai_private.password_history_rollout set mode=target,epoch=next_epoch,changed_at=clock_timestamp() where singleton;
 insert into bantai_private.password_history_rollout_audit(old_mode,new_mode,epoch,reason) values(prior.mode,target,next_epoch,reason);
 return jsonb_build_object('mode',target,'epoch',next_epoch,'pending',(select count(*) from bantai_private.password_history_operations where status='pending'));
end $$;
revoke all on function bantai_private.set_password_history_mode(text,text) from public,anon,authenticated,service_role;

-- Verified operator drain for inactive users: only already-fenced operations,
-- never credential writes, history deletion, or reactivation of old grants.
create function bantai_private.drain_password_history_operations(reason text) returns jsonb
language plpgsql set search_path='' as $$
declare admission bantai_private.password_history_rollout; cancelled bigint;
begin
 if reason is null or length(trim(reason))<8 then raise exception 'Audit reason required'; end if;
 select * into strict admission from bantai_private.password_history_rollout where singleton for update;
 if admission.mode<>'frozen' then raise exception 'Freeze before draining'; end if;
 if exists(select 1 from bantai_private.password_history_operations where status='pending' and rollout_epoch>=admission.epoch)
 then raise exception 'Cannot verify fencing for all pending operations'; end if;
 update bantai_private.password_history_operations set status='cancelled',candidate=null,seed=null,question_ticket=null
   where status='pending' and rollout_epoch<admission.epoch;
 get diagnostics cancelled=row_count;
 insert into bantai_private.password_history_rollout_audit(old_mode,new_mode,epoch,reason,event)
   values('frozen','frozen',admission.epoch,reason,'drain');
 return jsonb_build_object('mode','frozen','epoch',admission.epoch,'cancelled',cancelled,
   'pending',(select count(*) from bantai_private.password_history_operations where status='pending'));
end $$;
revoke all on function bantai_private.drain_password_history_operations(text) from public,anon,authenticated,service_role;

create function public.bantai_sq_action(p_user uuid,p_session uuid,p_aal text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare rollout_mode text;
begin
 if p_action='ticket' then
   perform 1 from auth.users where id=p_user for no key update;
   select mode into strict rollout_mode from bantai_private.password_history_rollout where singleton for share;
   if rollout_mode<>'legacy' then raise exception 'Legacy password completion is paused'; end if;
 end if;
 return bantai_private.password_history_question_core(p_user,p_session,p_aal,p_action,p_data);
end $$;
revoke all on function public.bantai_sq_action(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bantai_sq_action(uuid,uuid,text,text,jsonb) to service_role;

create function public.bantai_password_history(p_user uuid,p_session uuid,p_aal text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare rollout bantai_private.password_history_rollout; result jsonb;
begin
 if p_action='stage' then
   -- Native writes already hold this row: keep user -> control lock order.
   perform 1 from auth.users where id=p_user for no key update;
   select * into strict rollout from bantai_private.password_history_rollout where singleton for share;
   if rollout.mode<>'managed' then raise exception 'Password admission is paused'; end if;
 end if;
 result:=bantai_private.password_history_core(p_user,p_session,p_aal,p_action,p_data);
 return result;
end $$;
revoke all on function public.bantai_password_history(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bantai_password_history(uuid,uuid,text,text,jsonb) to service_role;
create or replace function bantai_private.commit_managed_password_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare marker text; op bantai_private.password_history_operations; state bantai_private.password_history_state; v bigint; rollout bantai_private.password_history_rollout;
begin
  select * into strict rollout from bantai_private.password_history_rollout where singleton for share;
  select raw_user_meta_data->>'bantai_password_operation' into marker from auth.users where id=new.id;
  if marker is null then
    if rollout.mode<>'legacy' and exists(select 1 from auth.users where id=new.id and raw_app_meta_data->>'bantai_sq_ticket' is not null) then
      raise exception 'Legacy password completion is paused';
    end if;
    -- Preserve native writes and credential maintenance. Do not turn an
    -- application-scoped feature into a partial global credential gate.
    -- Representation changes are conservative drift signals, not proof that a
    -- distinct password was selected. Never inspect or retain the native hash.
    update bantai_private.password_history_state set stale=true,
      credential_epoch=credential_epoch+1,coverage_gap=4 where user_id=new.id and version>0;
    return null;
  end if;
  select * into op from bantai_private.password_history_operations where user_id=new.id and digest=md5(marker) for update;
  if op.rollout_epoch is distinct from rollout.epoch then raise exception 'Password operation fenced by rollout'; end if;
  if op.id is null or op.status<>'pending' or op.expires_at<=clock_timestamp() then raise exception 'Password operation expired or cancelled'; end if;
  if not exists(select 1 from auth.sessions where id=op.session_id and user_id=new.id)
    or bantai_private.session_decision(op.session_id,new.id) is distinct from 'active' then raise exception 'Password operation session ended'; end if;
  select * into state from bantai_private.password_history_state where user_id=new.id for update;
  v:=state.version;
  if state.credential_epoch is distinct from op.epoch then raise exception 'External credential change requires reconciliation'; end if;
  if v is distinct from op.version then raise exception 'Password operation version changed'; end if;
  if v=0 and op.seed is not null then insert into bantai_private.password_history values(new.id,0,op.seed); end if;
  insert into bantai_private.password_history values(new.id,v+1,op.candidate);
  delete from bantai_private.password_history where user_id=new.id and version<v-2;
  update bantai_private.password_history_state set version=v+1,stale=false,coverage_gap=greatest(0,coverage_gap-1),
    tracked_count=least(4,tracked_count+1+case when v=0 and op.seed is not null then 1 else 0 end) where user_id=new.id;
  update bantai_private.password_history_operations set status='committed',candidate=null,seed=null,question_ticket=null where id=op.id;
  -- Supply the existing question gate's server-only ticket only after a valid
  -- history operation. Native user updates still perform MFA/nonce checks.
  update auth.users set raw_user_meta_data=raw_user_meta_data-'bantai_password_operation',
    raw_app_meta_data=case when op.question_ticket is not null then coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('bantai_sq_ticket',op.question_ticket) else raw_app_meta_data end
    where id=new.id;
  return null;
end $$;
-- Recheck after acquiring the operation table's DDL lock, catching v1 stages
-- that committed while this migration was waiting for that lock.
update bantai_private.password_history_rollout set mode='frozen'
where exists(select 1 from bantai_private.password_history_operations where status='pending')
   or exists(select 1 from bantai_private.password_history_state where version>0);
notify pgrst, 'reload schema';
commit;
