alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists encrypted_password text;
alter table auth.users add column if not exists raw_app_meta_data jsonb default '{}';
alter table auth.users add column if not exists recovery_sent_at timestamptz;
-- Supabase-managed objects needed by the session migration in PGlite suites.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end;
$$;
create role authenticator;
create role supabase_auth_admin;
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  factor_id uuid,
  not_after timestamptz
);
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  factor_type text not null default 'totp',
  user_id uuid not null references auth.users(id),
  status text not null
);
do $$
begin
  if to_regprocedure('auth.jwt()') is null then
    create function auth.jwt() returns jsonb language sql stable
      as 'select coalesce(nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb, ''{}''::jsonb)';
  end if;
  if to_regprocedure('auth.role()') is null then
    create function auth.role() returns text language sql stable as 'select auth.jwt()->>''role''';
  end if;
end;
$$;
