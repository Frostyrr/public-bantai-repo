-- Only the remaining pre-installation checks. Run in production SQL Editor as
-- postgres. One JSON result. No DDL, user identities, passwords or verifiers.
begin read only;
set local lock_timeout='3s';
set local statement_timeout='15s';
select jsonb_build_object(
 'reviewing_role',current_user,
 'can_create_auth_trigger',has_table_privilege(current_user,'auth.users','TRIGGER'),
 'schema_access',(select jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'owner',pg_get_userbyid(n.nspowner),
   'migrator_usage',has_schema_privilege(current_user,n.oid,'USAGE'),
   'migrator_create',has_schema_privilege(current_user,n.oid,'CREATE')))
   from pg_namespace n where n.nspname in ('auth','public','bantai_private')),
 'native_auth_role',(select jsonb_build_object(
   'exists',true,
   'public_usage',has_schema_privilege(r.oid,'public','USAGE'),
   'auth_usage',has_schema_privilege(r.oid,'auth','USAGE'),
   'user_metadata_select',has_column_privilege(r.oid,'auth.users','raw_user_meta_data','SELECT'),
   'app_metadata_select',has_column_privilege(r.oid,'auth.users','raw_app_meta_data','SELECT'),
   'credential_update',has_column_privilege(r.oid,'auth.users','encrypted_password','UPDATE'))
   from pg_roles r where r.rolname='supabase_auth_admin'),
 'application_native_role_membership',(select jsonb_agg(jsonb_build_object(
   'role',r.rolname,'native_member',pg_has_role(r.oid,a.oid,'MEMBER')))
   from pg_roles r cross join pg_roles a
   where r.rolname in ('anon','authenticated','service_role') and a.rolname='supabase_auth_admin'),
 'auth_columns',(select jsonb_agg(jsonb_build_object(
   'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod)))
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_attribute a on a.attrelid=c.oid
   where n.nspname='auth' and a.attnum>0 and not a.attisdropped
    and ((c.relname='users' and a.attname in ('id','encrypted_password','raw_user_meta_data','raw_app_meta_data'))
     or (c.relname='sessions' and a.attname in ('id','user_id','aal'))
     or (c.relname='mfa_factors' and a.attname in ('user_id','status','factor_type'))
     or (c.relname='mfa_amr_claims' and a.attname in ('session_id','authentication_method')))),
 'existing_history_relations',(select coalesce(jsonb_agg(c.relname),'[]'::jsonb)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='bantai_private' and c.relname like 'password_history%'),
 'reserved_marker_count',(select count(*) from auth.users
   where raw_user_meta_data ? 'bantai_password_operation'),
 'question_trigger_owner',(select pg_get_userbyid(p.proowner) from pg_proc p
   where p.oid=to_regprocedure('bantai_private.enforce_security_question_password()')),
 'backup_readiness','Not discoverable from this SQL: return Dashboard backup timestamp and restore availability separately'
) as remaining_preflight;
rollback;
