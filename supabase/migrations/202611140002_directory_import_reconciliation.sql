begin;
alter table public.directory_import_batches add column payload_hash text;
alter table public.directory_import_batches add column row_results jsonb;
alter table public.directory_import_batches add column report_expires_at timestamptz;

create function public.preview_directory_import(target_org uuid, roster jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  item jsonb;
  code text;
  seen text[] := '{}';
  report jsonb := '[]';
  row_index integer := 1;
  reason text;
begin
  if not public.has_directory_capability(target_org, 'import') then
    raise exception 'Directory import is not permitted.' using errcode = '42501';
  end if;
  if jsonb_typeof(roster) is distinct from 'array' or jsonb_array_length(roster) not between 1 and 500
    or octet_length(roster::text) > 500000 then
    raise exception 'Provide a roster of up to 500 rows and 500 KB.' using errcode = '23514';
  end if;
  for item in select * from jsonb_array_elements(roster) loop
    row_index := row_index + 1;
    code := nullif(lower(btrim(item->>'member_code')), '');
    reason := case
      when code = any(seen) then 'duplicate_in_file'
      when exists(select 1 from public.organization_directory_members d
        where d.organization_id = target_org and lower(btrim(d.member_code)) = code) then 'identifier_exists'
      else 'new' end;
    if code is not null then seen := array_append(seen,code); end if;
    report := report || jsonb_build_array(jsonb_build_object('row',row_index,'status',reason));
  end loop;
  return report;
end;
$$;
revoke all on function public.preview_directory_import(uuid,jsonb) from public,anon;
grant execute on function public.preview_directory_import(uuid,jsonb) to authenticated;

create or replace function public.commit_directory_import(target_org uuid, request_key uuid, roster jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  batch public.directory_import_batches%rowtype;
  report jsonb;
  item jsonb;
  result_id uuid;
  row_index integer := 1;
  added integer := 0;
begin
  report := public.preview_directory_import(target_org,roster);
  perform pg_advisory_xact_lock(hashtextextended(target_org::text || request_key::text,0));
  select * into batch from public.directory_import_batches
    where organization_id = target_org and request_id = request_key;
  if found then
    if batch.actor_id <> auth.uid() or batch.payload_hash is distinct from md5(roster::text) then
      raise exception 'This request ID already belongs to another import.' using errcode = '23514';
    end if;
    return jsonb_build_object('inserted',batch.inserted_count,'skipped',batch.skipped_count,
      'rows',case when batch.report_expires_at > now() then batch.row_results else '[]'::jsonb end);
  end if;
  report := '[]';
  for item in select * from jsonb_array_elements(roster) loop
    row_index := row_index + 1;
    result_id := null;
    insert into public.organization_directory_members(organization_id,display_name,member_code,email,phone,attributes)
      values(target_org,btrim(item->>'display_name'),nullif(btrim(item->>'member_code'),''),
        nullif(btrim(item->>'email'),''),nullif(btrim(item->>'phone'),''),coalesce(item->'attributes','{}'))
      on conflict do nothing returning id into result_id;
    if result_id is not null then added := added + 1; end if;
    report := report || jsonb_build_array(jsonb_build_object('row',row_index,
      'status',case when result_id is null then 'skipped_duplicate' else 'inserted' end));
  end loop;
  insert into public.directory_import_batches(organization_id,request_id,actor_id,inserted_count,skipped_count,payload_hash,row_results,report_expires_at)
    values(target_org,request_key,auth.uid(),added,jsonb_array_length(roster)-added,md5(roster::text),report,now()+interval '7 days');
  return jsonb_build_object('inserted',added,'skipped',jsonb_array_length(roster)-added,'rows',report);
end;
$$;

create function public.cleanup_directory_import_reports()
returns void language sql security definer set search_path = '' as $$
  update public.directory_import_batches set row_results = null
    where report_expires_at <= now() and row_results is not null;
$$;
revoke all on function public.cleanup_directory_import_reports() from public,anon,authenticated;
do $$
begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.cleanup_directory_import_reports() to service_role;
  end if;
end;
$$;
do $$
begin
  if exists(select 1 from pg_namespace where nspname = 'cron') then
    execute $schedule$select cron.schedule('directory-import-retention','15 * * * *',
      'select public.cleanup_directory_import_reports()')$schedule$;
  end if;
end;
$$;
commit;
