-- Run as postgres/actual migration owner in the confirmed production project's
-- SQL Editor. READ ONLY. Run separately from password_history_hosted_preflight.sql.
-- Share result grids, not credentials, user rows or stored function bodies.
begin read only;
set local lock_timeout='3s';
set local statement_timeout='15s';

select current_database(),current_user,version();

select signature,to_regprocedure(signature) is not null as present,
  pg_get_userbyid(p.proowner) as owner,
  pg_get_userbyid(p.proowner)=current_user as owned_by_migrator
from (values
  ('bantai_private.session_decision(uuid,uuid)'),
  ('public.bantai_sq_action(uuid,uuid,text,text,jsonb)'),
  ('public.consume_rate_limit(text,integer,integer)'),
  ('public.bantai_password_history(uuid,uuid,text,text,jsonb)'),
  ('bantai_private.commit_managed_password_history()')
) q(signature)
left join pg_proc p on p.oid=to_regprocedure(signature);

-- All actual overloads: compare rate-limit signature with the caller, rather
-- than interpreting an optional overload's absence as a missing service.
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in
 ('consume_rate_limit','bantai_sq_action','bantai_check_verified_session'))
 or (n.nspname='bantai_private' and p.proname='session_decision');

select n.nspname,c.relname,pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='bantai_private' and c.relkind='r'
order by c.relname;

-- A SQL Editor-managed project may legitimately have no CLI migration ledger.
-- Never create/repair one during read-only inspection or infer migrations applied.
do $$
declare ledger jsonb;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'Migration ledger absent: verify applied schema objects; do not replay baseline or create ledger during preflight';
  else
    execute 'select coalesce(jsonb_agg(version order by version),''[]''::jsonb) from supabase_migrations.schema_migrations' into ledger;
    raise notice 'Recorded migration versions: %',ledger;
  end if;
end $$;

-- Single final grid for SQL Editor screenshots/exports. No user/secret values.
select current_user as reviewing_role,
  to_regclass('supabase_migrations.schema_migrations') is not null as migration_ledger_present,
  (select jsonb_agg(jsonb_build_object('signature',q.signature,
    'present',p.oid is not null,'owner',pg_get_userbyid(p.proowner)))
   from (values
    ('bantai_private.session_decision(uuid,uuid)'),
    ('public.bantai_sq_action(uuid,uuid,text,text,jsonb)'),
    ('public.consume_rate_limit(text,integer,integer)'),
    ('public.bantai_password_history(uuid,uuid,text,text,jsonb)'),
    ('public.bantai_password_history_database_mode()')
   ) q(signature) left join pg_proc p on p.oid=to_regprocedure(q.signature)
  ) as dependency_summary;
rollback;
