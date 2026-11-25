-- Run in the configured Supabase project's SQL Editor. Export the single result.
BEGIN READ ONLY;
WITH relations AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity,
         c.relforcerowsecurity, c.relacl, c.relowner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','private','auth','storage','supabase_migrations')
    AND c.relkind IN ('r','p','v','m','S','f')
), routines AS (
  SELECT p.oid, n.nspname, p.proname, p.proacl, p.proowner, p.prosecdef,
         p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p','w')
)
SELECT jsonb_build_object(
  'postgres_version', current_setting('server_version'),
  'migration_ledger', to_regclass('supabase_migrations.schema_migrations'),
  'extensions', (SELECT jsonb_agg(to_jsonb(e) - 'oid') FROM pg_extension e),
  'schemas', (SELECT jsonb_agg(jsonb_build_object(
    'name', nspname, 'owner', pg_get_userbyid(nspowner), 'acl', nspacl))
    FROM pg_namespace WHERE nspname IN ('public','private','auth','storage')),
  'default_grants', (SELECT jsonb_agg(to_jsonb(d) || jsonb_build_object(
    'owner', pg_get_userbyid(d.defaclrole), 'schema', n.nspname))
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),
  'enums', (SELECT jsonb_agg(jsonb_build_object('schema', n.nspname,
    'name', t.typname, 'label', e.enumlabel, 'order', e.enumsortorder)
    ORDER BY n.nspname,t.typname,e.enumsortorder)
    FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    JOIN pg_namespace n ON n.oid=t.typnamespace),
  'relations', (SELECT jsonb_agg(jsonb_build_object(
    'schema', r.nspname, 'name', r.relname, 'kind', r.relkind,
    'owner', pg_get_userbyid(r.relowner), 'acl', r.relacl,
    'rls', r.relrowsecurity, 'force_rls', r.relforcerowsecurity,
    'view', CASE WHEN r.relkind IN ('v','m') THEN pg_get_viewdef(r.oid) END,
    'columns', (SELECT jsonb_agg(jsonb_build_object(
      'name', a.attname, 'type', format_type(a.atttypid,a.atttypmod),
      'not_null', a.attnotnull, 'identity', a.attidentity,
      'generated', a.attgenerated, 'acl', a.attacl,
      'default', pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d
      ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints', (SELECT jsonb_agg(pg_get_constraintdef(c.oid))
      FROM pg_constraint c WHERE c.conrelid=r.oid),
    'indexes', (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid))
      FROM pg_index i WHERE i.indrelid=r.oid),
    'triggers', (SELECT jsonb_agg(jsonb_build_object(
      'definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled))
      FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),
    'policies', (SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p
      WHERE p.schemaname=r.nspname AND p.tablename=r.relname))
    ORDER BY r.nspname,r.relname) FROM relations r),
  'functions', (SELECT jsonb_agg(jsonb_build_object(
    'schema', f.nspname, 'name', f.proname,
    'arguments', pg_get_function_identity_arguments(f.oid),
    'owner', pg_get_userbyid(f.proowner), 'acl', f.proacl,
    'security_definer', f.prosecdef, 'settings', f.proconfig,
    'anon_execute', has_function_privilege('anon',f.oid,'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated',f.oid,'EXECUTE'),
    'definition', pg_get_functiondef(f.oid))
    ORDER BY f.nspname,f.proname,pg_get_function_identity_arguments(f.oid))
    FROM routines f)
) AS recovery_schema;
ROLLBACK;
