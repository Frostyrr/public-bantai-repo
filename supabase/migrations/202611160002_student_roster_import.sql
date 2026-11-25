begin;

-- Existing ambiguous IDs remain available for officers to review.
create index directory_members_student_id_lookup
  on public.organization_directory_members (organization_id, lower(btrim(attributes->>'student_id')));

create or replace function public.preview_directory_import(target_org uuid, roster jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  item jsonb;
  code text;
  template_code text;
  identifier_key text;
  student_workspace boolean;
  student_matches integer;
  seen_template text[] := '{}';
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
  select organization_type is not distinct from 'student' into student_workspace
  from public.organizations where id = target_org;
  if student_workspace then
    identifier_key := 'student_id';
  else
    select key into identifier_key from public.directory_field_definitions where organization_id=target_org and active and display_order=10 and kind='text' order by key limit 1;
  end if;
  for item in select * from jsonb_array_elements(roster) loop
    row_index := row_index + 1;
    code := nullif(lower(btrim(item->>'member_code')), '');
    template_code := nullif(lower(btrim(item->'attributes'->>identifier_key)), '');
    student_matches := 0;
    if student_workspace and template_code is not null then
      select count(*) into student_matches
      from public.organization_directory_members d
      where d.organization_id = target_org
        and lower(btrim(d.attributes->>'student_id')) = template_code;
    end if;
    reason := case
      when student_matches > 1 then 'identifier_conflict'
      when code = any(seen) or template_code = any(seen_template) then 'duplicate_in_file'
      when exists(select 1 from public.organization_directory_members d
        where d.organization_id = target_org and (lower(btrim(d.member_code)) = code or lower(btrim(d.attributes->>identifier_key)) = template_code)) then 'identifier_exists'
      else 'new' end;
    if template_code is not null then seen_template := array_append(seen_template,template_code); end if;
    if code is not null then seen := array_append(seen,code); end if;
    report := report || jsonb_build_array(jsonb_build_object('row',row_index,'status',reason));
  end loop;
  return report;
end;
$$;
create or replace function public.commit_directory_import(target_org uuid, request_key uuid, roster jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  batch public.directory_import_batches%rowtype;
  report jsonb;
  reviewed jsonb;
  item jsonb;
  result_id uuid;
  row_index integer := 1;
  added integer := 0;
begin
  perform public.preview_directory_import(target_org,roster);
  -- Recheck the current roster once concurrent imports and directory writes have finished.
  lock table public.organization_directory_members in share row exclusive mode;
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
  reviewed := public.preview_directory_import(target_org,roster);
  report := '[]';
  for item in select * from jsonb_array_elements(roster) loop
    row_index := row_index + 1;
    result_id := null;
    if reviewed->(row_index-2)->>'status' = 'new' then
      insert into public.organization_directory_members(organization_id,display_name,member_code,email,phone,attributes)
        values(target_org,btrim(item->>'display_name'),nullif(btrim(item->>'member_code'),''),
          nullif(btrim(item->>'email'),''),nullif(btrim(item->>'phone'),''),coalesce(item->'attributes','{}'))
        on conflict do nothing returning id into result_id;
    end if;
    if result_id is not null then added := added + 1; end if;
    report := report || jsonb_build_array(jsonb_build_object('row',row_index,
      'status',case when result_id is not null then 'inserted'
        when reviewed->(row_index-2)->>'status' = 'identifier_conflict' then 'identifier_conflict'
        else 'skipped_duplicate' end));
  end loop;
  insert into public.directory_import_batches(organization_id,request_id,actor_id,inserted_count,skipped_count,payload_hash,row_results,report_expires_at)
    values(target_org,request_key,auth.uid(),added,jsonb_array_length(roster)-added,md5(roster::text),report,now()+interval '7 days');
  return jsonb_build_object('inserted',added,'skipped',jsonb_array_length(roster)-added,'rows',report);
end;
$$;
commit;
