select p.oid::regprocedure as signature,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ';'), '') as function_settings,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
order by p.oid::regprocedure::text;

select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema in ('public','storage') and grantee in ('authenticated','anon')
order by table_schema, table_name, grantee, privilege_type;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public','storage')
order by schemaname, tablename, policyname;
