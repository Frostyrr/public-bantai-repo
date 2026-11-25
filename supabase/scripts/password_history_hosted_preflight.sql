-- READ-ONLY preparation/postflight. Run only on an explicitly designated target.
-- Does not read credential/verifier values, identities or request bodies.
-- Inspect every result; this is evidence collection, not automatic approval.
begin read only;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

select current_database() as database_name, current_user as reviewing_role,
  current_setting('server_version') as postgres_version;

select n.nspname as schema_name, pg_get_userbyid(n.nspowner) as owner,
  r.rolname, has_schema_privilege(r.oid,n.oid,'USAGE') as usage_allowed,
  has_schema_privilege(r.oid,n.oid,'CREATE') as create_allowed
from pg_namespace n cross join pg_roles r
where n.nspname in ('auth','bantai_private','public')
  and r.rolname in ('anon','authenticated','service_role','supabase_auth_admin')
order by n.nspname,r.rolname;

select c.relname as auth_relation, a.attname as column_name,
  format_type(a.atttypid,a.atttypmod) as data_type
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_attribute a on a.attrelid=c.oid
where n.nspname='auth' and a.attnum>0 and not a.attisdropped
  and ((c.relname='users' and a.attname in ('id','encrypted_password','raw_user_meta_data','raw_app_meta_data'))
    or (c.relname='sessions' and a.attname in ('id','user_id','aal'))
    or (c.relname='mfa_factors' and a.attname in ('user_id','status','factor_type'))
    or (c.relname='mfa_amr_claims' and a.attname in ('session_id','authentication_method')))
order by c.relname,a.attnum;

select has_table_privilege(current_user,'auth.users','TRIGGER') as can_create_auth_trigger;

-- Metadata checks only: never select a credential/hash value.
select r.rolname,
  has_column_privilege(r.oid,'auth.users','raw_user_meta_data','SELECT') as can_read_auth_user_metadata,
  has_column_privilege(r.oid,'auth.users','raw_app_meta_data','SELECT') as can_read_auth_app_metadata,
  has_column_privilege(r.oid,'auth.users','encrypted_password','UPDATE') as can_write_auth_credential
from pg_roles r where r.rolname='supabase_auth_admin';
select actor.rolname,pg_has_role(actor.oid,native.oid,'MEMBER') as member_of_native_auth_role
from pg_roles actor cross join pg_roles native
where actor.rolname in ('anon','authenticated','service_role') and native.rolname='supabase_auth_admin';

select signature, to_regprocedure(signature) is not null as exists
from (values
  ('bantai_private.session_decision(uuid,uuid)'),
  ('public.bantai_sq_action(uuid,uuid,text,text,jsonb)'),
  ('public.bantai_password_history(uuid,uuid,text,text,jsonb)'),
  ('public.bantai_password_history_rollout()'),
  ('bantai_private.set_password_history_mode(text,text)'),
  ('bantai_private.drain_password_history_operations(text)'),
  ('public.bantai_password_history_database_mode()'),
  ('public.bantai_complete_managed_password(uuid)')
) required(signature);

select n.nspname as schema_name,p.proname,pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,p.proconfig,
  r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') as execute_allowed
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r
where ((n.nspname='public' and p.proname in ('bantai_password_history','bantai_password_history_rollout','bantai_password_history_database_mode','bantai_complete_managed_password','consume_rate_limit','bantai_sq_action'))
    or (n.nspname='bantai_private' and p.proname in ('commit_managed_password_history','admit_password_history_operation','password_history_core','password_history_question_core','set_password_history_mode','drain_password_history_operations')))
  and r.rolname in ('anon','authenticated','service_role','supabase_auth_admin')
order by n.nspname,p.proname,r.rolname;

select c.relname,pg_get_userbyid(c.relowner) as owner,
  c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced,
  r.rolname,has_table_privilege(r.oid,c.oid,'SELECT') as can_select,
  has_table_privilege(r.oid,c.oid,'INSERT') as can_insert,
  has_table_privilege(r.oid,c.oid,'UPDATE') as can_update,
  has_table_privilege(r.oid,c.oid,'DELETE') as can_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join pg_roles r
where n.nspname='bantai_private' and c.relkind='r' and c.relname like 'password_history%'
  and r.rolname in ('anon','authenticated','service_role')
order by c.relname,r.rolname;

select schemaname,tablename,policyname,roles,cmd
from pg_policies where schemaname='bantai_private' and tablename like 'password_history%';

select t.tgrelid::regclass as table_name,t.tgname,t.tgenabled,t.tgdeferrable,t.tginitdeferred,
  pg_get_triggerdef(t.oid) as definition
from pg_trigger t where t.tgrelid in ('auth.users'::regclass,to_regclass('bantai_private.password_history_operations')) and not t.tgisinternal
order by t.tgname;

select c.relname,con.conname,pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='bantai_private' and c.relname like 'password_history%'
order by c.relname,con.conname;

select tablename,indexname,indexdef from pg_indexes
where schemaname='bantai_private' and tablename like 'password_history%'
order by tablename,indexname;

-- These aggregates are safe to share; no user IDs or secret fields are emitted.
do $$
declare pending_count bigint; terminal_count bigint; marker_count bigint; ledger_count bigint; rollout_state jsonb; tracked_count bigint; physical_gate text;
begin
  if to_regprocedure('public.bantai_password_history_database_mode()') is not null then
    execute 'select public.bantai_password_history_database_mode()' into physical_gate;
    raise notice 'Authoritative database gate: % (application flags do not change it)',physical_gate;
  else
    raise notice 'Native-availability gate 006 absent; do not claim inactive Auth isolation';
  end if;
  if to_regclass('bantai_private.password_history_rollout') is not null then
    execute 'select jsonb_build_object(''mode'',mode,''epoch'',epoch,''changed_at'',changed_at) from bantai_private.password_history_rollout where singleton' into rollout_state;
    raise notice 'Rollout control: %',rollout_state;
  else
    raise notice 'V2 rollout control absent: do not promote the v2 backend';
  end if;
  if to_regclass('bantai_private.password_history_state') is not null then
    execute 'select count(*) from bantai_private.password_history_state where version>0' into tracked_count;
    raise notice 'Previously tracked accounts: % (nonzero makes migration 005 start frozen)',tracked_count;
  end if;
  if to_regclass('bantai_private.password_history_operations') is not null then
    execute 'select count(*) filter(where status=''pending''), count(*) filter(where status<>''pending'') from bantai_private.password_history_operations'
      into pending_count,terminal_count;
    raise notice 'Managed operations: pending=%, terminal=%',pending_count,terminal_count;
  else
    raise notice 'History operation table absent (expected only before migration)';
  end if;
  select count(*) into marker_count from auth.users
    where raw_user_meta_data ? 'bantai_password_operation';
  raise notice 'Reserved metadata key present on % accounts; investigate any nonzero count',marker_count;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select count(*) from supabase_migrations.schema_migrations where version=''202611180004'''
      into ledger_count;
    raise notice 'Migration ledger entries for 202611180004: %',ledger_count;
    execute 'select count(*) from supabase_migrations.schema_migrations where version=''202611180005''' into ledger_count;
    raise notice 'Migration ledger entries for 202611180005: %',ledger_count;
    execute 'select count(*) from supabase_migrations.schema_migrations where version=''202611180006''' into ledger_count;
    raise notice 'Migration ledger entries for 202611180006: %',ledger_count;
  else
    raise notice 'Migration ledger absent; confirm approved ledger convention';
  end if;
end $$;

rollback;
