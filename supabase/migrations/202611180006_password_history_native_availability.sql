begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Flush old native/v2 writer transactions before installing the new dispatcher.
lock table auth.users in access exclusive mode;
do $$begin
 if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then
   raise exception 'Review the native Auth database role before migration'; end if;
 if not has_schema_privilege('supabase_auth_admin','public','USAGE') then
   raise exception 'Review native Auth public-schema access before migration'; end if;
 if exists(select 1 from pg_proc where oid in (
   'bantai_private.commit_managed_password_history()'::regprocedure,
   'bantai_private.set_password_history_mode(text,text)'::regprocedure,
   'public.bantai_password_history_rollout()'::regprocedure,
   'public.bantai_sq_action(uuid,uuid,text,text,jsonb)'::regprocedure,
   'public.bantai_password_history(uuid,uuid,text,text,jsonb)'::regprocedure,
   'bantai_private.password_history_core(uuid,uuid,text,text,jsonb)'::regprocedure,
   'bantai_private.password_history_question_core(uuid,uuid,text,text,jsonb)'::regprocedure,
   'bantai_private.admit_password_history_operation()'::regprocedure,
   'bantai_private.drain_password_history_operations(text)'::regprocedure)
   and proowner<>current_user::regrole) then
   raise exception 'Use the reviewed existing function owner'; end if;
end $$;

-- Pure owner-defined policy. Public execution reveals only nonsecret mode,
-- never private control data. Ordinary callers cannot change the function.
create function public.bantai_password_history_database_mode() returns text
language sql stable set search_path='' as $$select 'frozen'::text$$;
grant execute on function public.bantai_password_history_database_mode() to public;

-- Strict active worker: no catch-and-continue on any enforcement failure.
create function public.bantai_complete_managed_password(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare marker text; op bantai_private.password_history_operations;
 state bantai_private.password_history_state; v bigint;
 rollout bantai_private.password_history_rollout;
begin
 if public.bantai_password_history_database_mode()<>'managed' then raise exception 'Managed password completion is paused'; end if;
 select * into strict rollout from bantai_private.password_history_rollout where singleton for share;
 if rollout.mode<>'managed' then raise exception 'Managed gate state is inconsistent'; end if;
 select raw_user_meta_data->>'bantai_password_operation' into marker from auth.users where id=p_user;
 if marker is null then
   if exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'bantai_sq_ticket' is not null)
   then raise exception 'Legacy password completion is paused'; end if;
   -- Include version zero: an initial pending change also needs invalidation.
   update bantai_private.password_history_state set stale=true,
     credential_epoch=credential_epoch+1,coverage_gap=4 where user_id=p_user;
   return;
 end if;
 select * into op from bantai_private.password_history_operations where user_id=p_user and digest=md5(marker) for update;
 if op.rollout_epoch is distinct from rollout.epoch then raise exception 'Password operation fenced by rollout'; end if;
 if op.id is null or op.status<>'pending' or op.expires_at<=clock_timestamp() then raise exception 'Password operation expired or cancelled'; end if;
 if not exists(select 1 from auth.sessions where id=op.session_id and user_id=p_user)
   or bantai_private.session_decision(op.session_id,p_user) is distinct from 'active'
 then raise exception 'Password operation session ended'; end if;
 select * into state from bantai_private.password_history_state where user_id=p_user for update;
 v:=state.version;
 if state.credential_epoch is distinct from op.epoch then raise exception 'External credential change requires reconciliation'; end if;
 if v is distinct from op.version then raise exception 'Password operation version changed'; end if;
 if v=0 and op.seed is not null then insert into bantai_private.password_history values(p_user,0,op.seed); end if;
 insert into bantai_private.password_history values(p_user,v+1,op.candidate);
 delete from bantai_private.password_history where user_id=p_user and version<v-2;
 update bantai_private.password_history_state set version=v+1,stale=false,coverage_gap=greatest(0,coverage_gap-1),
   tracked_count=least(4,tracked_count+1+case when v=0 and op.seed is not null then 1 else 0 end) where user_id=p_user;
 update bantai_private.password_history_operations set status='committed',candidate=null,seed=null,question_ticket=null where id=op.id;
 update auth.users set raw_user_meta_data=raw_user_meta_data-'bantai_password_operation',
   raw_app_meta_data=case when op.question_ticket is not null then coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('bantai_sq_ticket',op.question_ticket) else raw_app_meta_data end
 where id=p_user;
end $$;
revoke all on function public.bantai_complete_managed_password(uuid) from public,anon,authenticated,service_role;
grant execute on function public.bantai_complete_managed_password(uuid) to supabase_auth_admin;

-- INVOKER uses the credential writer's existing Auth metadata SELECT permission.
-- Inactive paths have no private row types, control reads, or drift writes.
create or replace function bantai_private.commit_managed_password_history() returns trigger
language plpgsql security invoker set search_path='' as $$
declare policy text; marker text; legacy_ticket text;
begin
 policy:=public.bantai_password_history_database_mode();
 select raw_user_meta_data->>'bantai_password_operation',raw_app_meta_data->>'bantai_sq_ticket'
   into marker,legacy_ticket from auth.users where id=new.id;
 if policy in ('disabled','frozen') then
   if marker is not null then raise exception 'Managed password completion is paused'; end if;
   if policy='frozen' and legacy_ticket is not null then raise exception 'Legacy password completion is paused'; end if;
   return null;
 end if;
 if policy is distinct from 'managed' then raise exception 'Invalid password gate policy'; end if;
 perform public.bantai_complete_managed_password(new.id);
 return null;
end $$;

create or replace function public.bantai_password_history_rollout() returns jsonb
language plpgsql security definer set search_path='' as $$
declare policy text; admission record;
begin
 policy:=public.bantai_password_history_database_mode();
 if policy='disabled' then return jsonb_build_object('protocol',2,'mode','legacy','databaseGate',policy); end if;
 if policy='frozen' then return jsonb_build_object('protocol',2,'mode','frozen','databaseGate',policy); end if;
 if policy is distinct from 'managed' then raise exception 'Invalid gate policy'; end if;
 select * into strict admission from bantai_private.password_history_rollout where singleton;
 if admission.mode<>'managed' then raise exception 'Managed gate state is inconsistent'; end if;
 return jsonb_build_object('protocol',2,'mode','managed','epoch',admission.epoch,'databaseGate',policy);
end $$;

create or replace function public.bantai_sq_action(p_user uuid,p_session uuid,p_aal text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_action='ticket' then
   lock table auth.users in row exclusive mode;
   perform 1 from auth.users where id=p_user for no key update;
   if public.bantai_password_history_database_mode()<>'disabled' then raise exception 'Legacy password completion is paused'; end if;
 end if;
 return bantai_private.password_history_question_core(p_user,p_session,p_aal,p_action,p_data);
end $$;

create or replace function public.bantai_password_history(p_user uuid,p_session uuid,p_aal text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare admission record;
begin
 if p_action='stage' then
   perform 1 from auth.users where id=p_user for no key update;
   if public.bantai_password_history_database_mode()<>'managed' then raise exception 'Password admission is paused'; end if;
   select * into strict admission from bantai_private.password_history_rollout where singleton for share;
   if admission.mode<>'managed' then raise exception 'Managed gate state is inconsistent'; end if;
 end if;
 return bantai_private.password_history_core(p_user,p_session,p_aal,p_action,p_data);
end $$;

create or replace function bantai_private.admit_password_history_operation() returns trigger
language plpgsql security definer set search_path='' as $$
declare admission record;
begin
 if public.bantai_password_history_database_mode()<>'managed' then raise exception 'Password admission is paused'; end if;
 select * into strict admission from bantai_private.password_history_rollout where singleton for share;
 if admission.mode<>'managed' then raise exception 'Managed gate state is inconsistent'; end if;
 new.rollout_epoch:=admission.epoch;
 return new;
end $$;

-- Owner-only atomic policy transition. No application flag updates this policy.
create or replace function bantai_private.set_password_history_mode(target text,reason text) returns jsonb
language plpgsql set search_path='' as $$
declare prior record; policy text; next_epoch bigint;
begin
 if target is null or target not in ('legacy','managed','frozen') or reason is null or length(trim(reason))<8 then raise exception 'Mode and audit reason required'; end if;
 lock table auth.users in share row exclusive mode;
 select * into strict prior from bantai_private.password_history_rollout where singleton for update;
 if target<>'frozen' and prior.mode<>'frozen' then raise exception 'Freeze before changing admission'; end if;
 if target<>'frozen' and exists(select 1 from bantai_private.password_history_operations where status='pending') then raise exception 'Reconcile pending operations first'; end if;
 next_epoch:=prior.epoch+1;
 delete from bantai_private.security_question_password_tickets;
 if target='managed' then
   -- Inactive/frozen changes were deliberately not observed. Retain all known
   -- verifiers and require fresh recovery reconciliation before further use.
   update bantai_private.password_history_state set stale=true,credential_epoch=credential_epoch+1,coverage_gap=4 where version>0;
 end if;
 policy:=case target when 'legacy' then 'disabled' else target end;
 execute format('create or replace function public.bantai_password_history_database_mode() returns text language sql stable set search_path='''' as %L','select '||quote_literal(policy)||'::text');
 update bantai_private.password_history_rollout set mode=target,epoch=next_epoch,changed_at=clock_timestamp() where singleton;
 insert into bantai_private.password_history_rollout_audit(old_mode,new_mode,epoch,reason) values(prior.mode,target,next_epoch,reason);
 return jsonb_build_object('mode',target,'databaseGate',policy,'epoch',next_epoch,'pending',(select count(*) from bantai_private.password_history_operations where status='pending'));
end $$;

create or replace function bantai_private.drain_password_history_operations(reason text) returns jsonb
language plpgsql set search_path='' as $$
declare admission record; cancelled bigint;
begin
 if reason is null or length(trim(reason))<8 then raise exception 'Audit reason required'; end if;
 if public.bantai_password_history_database_mode()<>'frozen' then raise exception 'Freeze before draining'; end if;
 select * into strict admission from bantai_private.password_history_rollout where singleton for update;
 if admission.mode<>'frozen' then raise exception 'Frozen gate state is inconsistent'; end if;
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

-- Never activate enforcement during migration. Unknown/active state becomes
-- frozen; a genuinely inactive legacy state remains physically disabled.
do $$
declare prior_mode text; initial_policy text;
begin
 select mode into prior_mode from bantai_private.password_history_rollout where singleton;
 initial_policy:=case when prior_mode='legacy' and not exists(select 1 from bantai_private.password_history_operations where status='pending') then 'disabled' else 'frozen' end;
 if initial_policy='frozen' then
   update bantai_private.password_history_rollout set mode='frozen',epoch=epoch+1,changed_at=clock_timestamp() where singleton;
   delete from bantai_private.security_question_password_tickets;
 end if;
 execute format('create or replace function public.bantai_password_history_database_mode() returns text language sql stable set search_path='''' as %L','select '||quote_literal(initial_policy)||'::text');
end $$;
notify pgrst, 'reload schema';
commit;
