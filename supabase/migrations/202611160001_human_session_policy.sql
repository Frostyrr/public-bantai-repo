begin;

create schema if not exists bantai_private;
revoke all on schema bantai_private from public, anon, authenticated;

create table bantai_private.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signed_in_at timestamptz not null,
  last_activity_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('idle', 'absolute', 'revoked', 'logged_out')),
  check ((ended_at is null) = (end_reason is null))
);
create index bantai_sessions_by_user on bantai_private.sessions (user_id);
create index bantai_sessions_open on bantai_private.sessions (id) where ended_at is null;
revoke all on bantai_private.sessions from public, anon, authenticated;

-- Existing sessions have no activity history. Allow one idle window from cutover;
-- their absolute clock still starts at the original Supabase sign-in.
lock table auth.sessions in share row exclusive mode;
insert into bantai_private.sessions (id, user_id, signed_in_at, last_activity_at)
select id, user_id, created_at, greatest(created_at, statement_timestamp())
from auth.sessions;

update public.platform_settings
set value = jsonb_build_object(
  'idle_seconds', 0,
  'absolute_seconds', coalesce((value->>'timeout_seconds')::integer, (value->>'timeout_minutes')::integer * 60, 86400),
  'super_admin_exempt', true
)
where key = 'session_timeout';

-- Tests may replace this function in a disposable database. Clients cannot set the clock.
create function bantai_private.session_now()
returns timestamptz language sql volatile set search_path = ''
as $$ select clock_timestamp() $$;

-- Return the first terminal event. Disabled deadlines are represented by NULL.
create function bantai_private.session_end(
  tracked bantai_private.sessions,
  policy jsonb,
  platform_role text,
  revoked_at timestamptz,
  native_end_at timestamptz,
  checked_at timestamptz
)
returns table (ended_at timestamptz, reason text)
language sql immutable set search_path = ''
as $$
  select candidate.deadline, candidate.reason
  from (values
    (tracked.ended_at, tracked.end_reason, 0),
    (case when revoked_at > tracked.signed_in_at then revoked_at end, 'revoked', 1),
    (native_end_at, 'logged_out', 2),
    (case when not (coalesce(platform_role = 'super_admin', false) and (policy->>'super_admin_exempt')::boolean)
       then tracked.signed_in_at + make_interval(secs => nullif((policy->>'absolute_seconds')::integer, 0)) end, 'absolute', 3),
    (case when not (coalesce(platform_role = 'super_admin', false) and (policy->>'super_admin_exempt')::boolean)
       then tracked.last_activity_at + make_interval(secs => nullif((policy->>'idle_seconds')::integer, 0)) end, 'idle', 4)
  ) as candidate(deadline, reason, precedence)
  where candidate.deadline <= checked_at
  order by candidate.deadline, candidate.precedence
  limit 1
$$;

create function bantai_private.seal_ended_sessions(checked_at timestamptz, target_user uuid default null)
returns void language sql set search_path = ''
as $$
  update bantai_private.sessions current_session
  set ended_at = ended.ended_at, end_reason = ended.reason
  from bantai_private.sessions s
  join auth.sessions live on live.id = s.id
  left join public.profiles p on p.id = s.user_id
  join public.platform_settings settings on settings.key = 'session_timeout'
  cross join lateral bantai_private.session_end(
    s, settings.value, p.role, p.sessions_revoked_at, live.not_after, checked_at
  ) ended
  where current_session.id = s.id
    and current_session.ended_at is null
    and (target_user is null or s.user_id = target_user)
$$;

-- Serialize policy and role changes with activity writes. Seal expired sessions
-- before a longer policy or an exemption could make them appear valid again.
create function bantai_private.track_profile_session_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(1145130580, 1);
  perform bantai_private.seal_ended_sessions(bantai_private.session_now(), new.id);
  return new;
end;
$$;

create trigger bantai_session_profile_before
before update of role, sessions_revoked_at on public.profiles
for each row when (old.role is distinct from new.role or old.sessions_revoked_at is distinct from new.sessions_revoked_at)
execute function bantai_private.track_profile_session_change();

create trigger bantai_session_profile_after
after update of role, sessions_revoked_at on public.profiles
for each row when (old.role is distinct from new.role or old.sessions_revoked_at is distinct from new.sessions_revoked_at)
execute function bantai_private.track_profile_session_change();

create function bantai_private.track_auth_session()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz;
  v_session bantai_private.sessions;
  v_ended record;
begin
  perform pg_advisory_xact_lock_shared(1145130580, 1);
  if tg_op = 'INSERT' then
    insert into bantai_private.sessions (id, user_id, signed_in_at, last_activity_at)
    values (new.id, new.user_id, new.created_at, new.created_at);
    return new;
  end if;

  select * into v_session from bantai_private.sessions where id = old.id for update;
  if found and v_session.ended_at is null then
    v_now := bantai_private.session_now();
    select e.* into v_ended
    from public.platform_settings settings
    left join public.profiles p on p.id = old.user_id
    cross join lateral bantai_private.session_end(
      v_session, settings.value, p.role, p.sessions_revoked_at, old.not_after, v_now
    ) e
    where settings.key = 'session_timeout';
    update bantai_private.sessions
    set ended_at = coalesce(v_ended.ended_at, v_now),
        end_reason = coalesce(v_ended.reason, 'logged_out')
    where id = old.id;
  end if;
  return old;
end;
$$;

create trigger bantai_track_auth_sign_in after insert on auth.sessions
for each row execute function bantai_private.track_auth_session();
create trigger bantai_track_auth_sign_out before delete on auth.sessions
for each row execute function bantai_private.track_auth_session();

-- Express calls this RPC with its service credential only after Auth has verified
-- the bearer token. Acquire the per-session lock before reading the clock.
create function public.bantai_check_session(p_session uuid, p_user uuid, p_activity boolean)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_session bantai_private.sessions;
  v_live auth.sessions;
  v_profile public.profiles;
  v_policy jsonb;
  v_ended record;
  v_now timestamptz;
begin
  perform pg_advisory_xact_lock_shared(1145130580, 1);
  select * into v_session from bantai_private.sessions where id = p_session and user_id = p_user for update;
  if not found then return 'revoked'; end if;
  v_now := bantai_private.session_now();
  select * into v_profile from public.profiles where id = p_user;
  if v_profile.suspended_at is not null then return 'suspended'; end if;
  if v_profile.locked_until > v_now then return 'locked'; end if;
  if v_session.end_reason is not null then return v_session.end_reason; end if;

  select * into v_live from auth.sessions where id = p_session and user_id = p_user;
  if not found then return 'revoked'; end if;

  select value into strict v_policy from public.platform_settings where key = 'session_timeout';
  select * into v_ended from bantai_private.session_end(
    v_session, v_policy, v_profile.role, v_profile.sessions_revoked_at, v_live.not_after, v_now
  );
  if found then
    update bantai_private.sessions
    set ended_at = v_ended.ended_at, end_reason = v_ended.reason
    where id = p_session;
    return v_ended.reason;
  end if;

  if p_activity then
    update bantai_private.sessions
    set last_activity_at = greatest(last_activity_at, v_now)
    where id = p_session;
  end if;
  return 'active';
end;
$$;
revoke all on function public.bantai_check_session(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.bantai_check_session(uuid, uuid, boolean) to service_role;

-- Read-only check for PostgREST pre-request and authenticated Storage RLS.
-- No writes can survive the rollback of a rejected PostgREST request.
create function bantai_private.session_decision(target_session uuid, target_user uuid)
returns text language sql volatile security definer set search_path = ''
as $$
  with checked as materialized (select bantai_private.session_now() as at)
  select coalesce((
    select case
      when p.suspended_at is not null then 'suspended'
      when p.locked_until > checked.at then 'locked'
      when s.end_reason is not null then s.end_reason
      when live.id is null then 'revoked'
      else coalesce(ended.reason, 'active')
    end
    from bantai_private.sessions s
    left join auth.sessions live on live.id = s.id and live.user_id = s.user_id
    left join public.profiles p on p.id = s.user_id
    join public.platform_settings settings on settings.key = 'session_timeout'
    cross join checked
    left join lateral bantai_private.session_end(
      s, settings.value, p.role, p.sessions_revoked_at, live.not_after, checked.at
    ) ended on true
    where s.id = target_session and s.user_id = target_user
  ), 'revoked')
$$;

-- Keep the PostgREST hook callable by its request roles but outside API schemas.
create schema bantai_gateway;
revoke all on schema bantai_gateway from public;
grant usage on schema bantai_gateway to anon, authenticated, service_role;

create function bantai_gateway.check_session()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_decision text;
begin
  if auth.role() is distinct from 'authenticated' then return; end if;
  v_decision := bantai_private.session_decision(nullif(auth.jwt()->>'session_id', '')::uuid, auth.uid());
  if v_decision = 'active' then return; end if;
  if v_decision in ('idle', 'absolute') then
    -- PostgREST supports custom response bodies with a distinct code and HTTP status.
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
revoke all on function bantai_gateway.check_session() from public;
grant execute on function bantai_gateway.check_session() to anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from pg_db_role_setting s
    cross join lateral unnest(s.setconfig) config
    where s.setrole in (0, 'authenticator'::regrole)
      and s.setdatabase in (0, (select oid from pg_database where datname = current_database()))
      and config like 'pgrst.db_pre_request=%'
      and config <> 'pgrst.db_pre_request=bantai_gateway.check_session'
  ) then
    raise exception 'Compose the existing PostgREST pre-request hook with bantai_gateway.check_session before deploying.';
  end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request to 'bantai_gateway.check_session';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Enable this function as the Custom Access Token Hook on the Auth server.
-- Token issuance never records activity. Fresh sign-ins create their own sessions.
create function public.bantai_session_token_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_decision text;
begin
  if event->>'authentication_method' = 'token_refresh'
    and event->'claims'->>'role' = 'authenticated'
    and not coalesce((event->'claims'->>'is_anonymous')::boolean, false) then
    v_decision := bantai_private.session_decision(
      nullif(event->'claims'->>'session_id', '')::uuid, (event->>'user_id')::uuid
    );
    if v_decision in ('idle', 'absolute') then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 401, 'message', 'Your session timed out. Please sign in again.'
      ));
    end if;
    if v_decision in ('revoked', 'logged_out') then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 401, 'message', 'Your session has ended. Please sign in again.'
      ));
    end if;
    if v_decision in ('suspended', 'locked') then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'Account access is restricted.'
      ));
    end if;
  end if;
  return jsonb_build_object('claims', event->'claims');
end;
$$;
revoke all on function public.bantai_session_token_hook(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.bantai_session_token_hook(jsonb) to supabase_auth_admin;

create function public.bantai_storage_session_allowed()
returns boolean language sql volatile security definer set search_path = ''
as $$ select bantai_private.session_decision(nullif(auth.jwt()->>'session_id', '')::uuid, auth.uid()) = 'active' $$;
revoke all on function public.bantai_storage_session_allowed() from public, anon;
grant execute on function public.bantai_storage_session_allowed() to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    create policy bantai_live_session on storage.objects as restrictive for all to authenticated
      using ((select public.bantai_storage_session_allowed()))
      with check ((select public.bantai_storage_session_allowed()));
  end if;
  if to_regclass('storage.buckets') is not null then
    create policy bantai_live_session on storage.buckets as restrictive for all to authenticated
      using ((select public.bantai_storage_session_allowed()))
      with check ((select public.bantai_storage_session_allowed()));
  end if;
  -- Notifications are now served by guarded Express polling. No Bantai row
  -- payload should be emitted to an open Postgres Changes subscription.
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
             and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime drop table public.notifications;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
             and schemaname in ('public', 'storage')) then
    raise exception 'Remove or migrate the additional Realtime publications before deploying the session policy.';
  end if;
end;
$$;

create or replace function public.get_platform_session_timeout()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin(false) then
    raise exception 'Platform administrator access required';
  end if;
  return (
    select value || jsonb_build_object('updated_reason', updated_reason, 'updated_at', updated_at)
    from public.platform_settings where key = 'session_timeout'
  );
end;
$$;

drop function public.admin_set_session_timeout(integer, text, integer);
create function public.admin_set_session_timeout(
  p_idle_seconds integer, p_absolute_seconds integer, p_super_admin_exempt boolean, p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz;
begin
  perform pg_advisory_xact_lock(1145130580, 1);
  if not public.is_platform_admin(true) then
    raise exception 'Super administrator access required';
  end if;
  if p_idle_seconds is null or p_absolute_seconds is null or p_super_admin_exempt is null
    or (p_idle_seconds <> 0 and p_idle_seconds not between 5 and 2592000)
    or (p_absolute_seconds <> 0 and p_absolute_seconds not between 5 and 2592000) then
    raise exception 'Invalid session policy. Each duration must be 0 or between 5 seconds and 30 days.';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'Invalid reason. A documented reason of 3 to 500 characters is required.';
  end if;

  v_now := bantai_private.session_now();
  perform bantai_private.seal_ended_sessions(v_now);
  select value into strict v_before from public.platform_settings where key = 'session_timeout';
  v_after := jsonb_build_object('idle_seconds', p_idle_seconds, 'absolute_seconds', p_absolute_seconds,
    'super_admin_exempt', p_super_admin_exempt);
  update public.platform_settings
  set value = v_after, updated_by = v_actor, updated_reason = v_reason, updated_at = v_now
  where key = 'session_timeout';
  perform bantai_private.seal_ended_sessions(v_now);

  insert into public.audit_logs (organization_id, actor_id, action, entity_id, before_value, after_value)
  values (null, v_actor, 'platform_session_timeout_updated', v_actor, v_before,
    v_after || jsonb_build_object('reason', v_reason));
  return v_after || jsonb_build_object('updated_reason', v_reason, 'updated_at', v_now);
end;
$$;
revoke all on function public.admin_set_session_timeout(integer, integer, boolean, text) from public, anon;
grant execute on function public.admin_set_session_timeout(integer, integer, boolean, text) to authenticated;

create function bantai_private.account_session_status(target_user uuid, checked_at timestamptz)
returns text language sql stable set search_path = ''
as $$
  with sessions as (
    select
      live.id is not null and ended.reason is null and s.ended_at is null
        and p.suspended_at is null and coalesce(p.locked_until <= checked_at, true) as valid,
      coalesce(s.ended_at, ended.ended_at, s.signed_in_at) as ended_at,
      coalesce(s.end_reason, ended.reason) as reason
    from bantai_private.sessions s
    left join auth.sessions live on live.id = s.id
    left join public.profiles p on p.id = s.user_id
    join public.platform_settings settings on settings.key = 'session_timeout'
    left join lateral bantai_private.session_end(
      s, settings.value, p.role, p.sessions_revoked_at, live.not_after, checked_at
    ) ended on true
    where s.user_id = target_user
  )
  select case
    when exists (select 1 from sessions where valid) then 'logged_in'
    when (select reason from sessions order by ended_at desc, (reason in ('idle', 'absolute')) asc nulls first limit 1)
      in ('idle', 'absolute') then 'timed_out'
    else 'logged_out'
  end
$$;

-- Keep the existing directory authorization, search, pagination and shape.
alter function public.platform_admin_list_users(text, text, integer, integer)
  rename to platform_admin_list_users_without_sessions;
revoke all on function public.platform_admin_list_users_without_sessions(text, text, integer, integer)
  from public, anon, authenticated;

create function public.platform_admin_list_users(
  p_search text default '', p_role text default null, p_limit integer default 25, p_offset integer default 0
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_now timestamptz := bantai_private.session_now();
begin
  v_result := public.platform_admin_list_users_without_sessions(p_search, p_role, p_limit, p_offset);
  return jsonb_set(v_result, '{users}', (
    select coalesce(jsonb_agg(user_row || jsonb_build_object(
      'session_status', bantai_private.account_session_status((user_row->>'id')::uuid, v_now)
    ) order by row_number), '[]'::jsonb)
    from jsonb_array_elements(v_result->'users') with ordinality as users(user_row, row_number)
  ));
end;
$$;
revoke all on function public.platform_admin_list_users(text, text, integer, integer) from public, anon;
grant execute on function public.platform_admin_list_users(text, text, integer, integer) to authenticated;

commit;
