begin;
alter table public.directory_field_definitions
 add column display_order integer not null default 1000,
 add column template_version integer,
 add column import_aliases text[] not null default '{}',
 add column default_visible boolean not null default false;

create function public.directory_template_fields(org_type text)
returns table(key text,label text,kind text,options text[],display_order integer,aliases text[])
language sql immutable set search_path='' as $$
 select v.key,v.label,v.kind,v.options,v.position,v.aliases
 from (values
 ('student','student_id','Student ID','text','{}'::text[],10,array['Student Number']),
 ('student','college','College','text','{}',30,'{}'),
 ('student','program','Program','text','{}',40,array['Course']),
 ('student','year_level','Year Level','text','{}',50,array['Year']),
 ('student','section','Section','text','{}',60,array['Block']),
 ('workplace','employee_id','Employee ID','text','{}',10,array['Employee Number']),
 ('workplace','department','Department','text','{}',30,'{}'),
 ('workplace','job_title','Position','text','{}',40,array['Job Title']),
 ('workplace','employment_status','Employment Status','select',array['Active','On leave','Inactive'],50,'{}'),
 ('club','membership_type','Membership Type','text','{}',30,'{}'),
 ('club','join_date','Join Date','date','{}',40,'{}'),
 ('nonprofit','volunteer_role','Volunteer Role','text','{}',30,'{}'),
 ('nonprofit','join_date','Join Date','date','{}',40,'{}')
 ) v(type,key,label,kind,options,position,aliases) where v.type=org_type;
$$;

-- Preserve existing definitions, including explicitly inactive fields and custom types.
update public.directory_field_definitions d
set display_order=t.display_order,template_version=1,import_aliases=t.aliases,default_visible=true
from public.organizations o cross join lateral public.directory_template_fields(o.organization_type) t
where d.organization_id=o.id and d.key=t.key;
insert into public.directory_field_definitions(organization_id,key,label,kind,options,display_order,template_version,import_aliases,default_visible)
select o.id,t.key,t.label,t.kind,t.options,t.display_order,1,t.aliases,true
from public.organizations o cross join lateral public.directory_template_fields(o.organization_type) t
on conflict(organization_id,key) do nothing;
create or replace function public.create_typed_organization(org_name text, org_currency text, org_type text, request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  org_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if org_type is null or org_type not in ('student','workplace','club','nonprofit','other') or request_id is null then
    raise exception 'Choose an organization type and provide a request ID.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || request_id::text, 0));
  select r.organization_id into org_id from public.organization_creation_requests r
    where r.actor_id = auth.uid() and r.request_id = create_typed_organization.request_id;
  if found then
    if not exists (
      select 1 from public.organization_creation_requests r
      where r.actor_id = auth.uid() and r.request_id = create_typed_organization.request_id
        and r.requested_name = btrim(org_name) and r.requested_currency = upper(btrim(org_currency))
        and r.requested_type = org_type
    ) then
      raise exception 'This request ID was already used for different organization details.' using errcode = '23514';
    end if;
    select jsonb_build_object('id',o.id,'name',o.name,'currency',o.currency,'organization_type',o.organization_type,'role','owner')
      into result from public.organizations o where o.id = org_id;
    return result;
  end if;
  result := public.create_organization_with_owner(org_name, org_currency);
  org_id := (result->>'id')::uuid;
  update public.organizations set organization_type = org_type where id = org_id;
  insert into public.directory_field_definitions(organization_id,key,label,kind,options,display_order,template_version,import_aliases,default_visible)
    select org_id,t.key,t.label,t.kind,t.options,t.display_order,1,t.aliases,true
    from public.directory_template_fields(org_type) t on conflict do nothing;
  insert into public.organization_creation_requests values(auth.uid(),request_id,org_id,btrim(org_name),upper(btrim(org_currency)),org_type);
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(org_id,auth.uid(),'organization_type_initialized',org_id,jsonb_build_object('organization_type',org_type));
  return result || jsonb_build_object('organization_type',org_type);
end;
$$;
create or replace function public.change_directory_field_set(
  target_org uuid, expected_fields jsonb, replacement jsonb, remove_key text, confirm_value_loss boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_fields jsonb;
  removed_keys text[];
begin
  if not public.has_directory_capability(target_org, 'edit') then
    raise exception 'You cannot change directory fields.' using errcode = '42501';
  end if;
  if (replacement is null) = (remove_key is null) then
    raise exception 'Choose a replacement or a field to remove.' using errcode = '23514';
  end if;

  lock table public.organization_directory_members in share row exclusive mode;
  lock table public.directory_field_definitions in share row exclusive mode;
  select coalesce(jsonb_agg(jsonb_build_object('key',d.key,'label',d.label,'kind',d.kind,'options',d.options) order by d.key), '[]') into current_fields
    from public.directory_field_definitions d where d.organization_id = target_org and d.active;
  if current_fields is distinct from (
    select coalesce(jsonb_agg(jsonb_build_object('key',item->'key','label',item->'label','kind',item->'kind','options',item->'options') order by item->>'key'), '[]') from jsonb_array_elements(expected_fields) item
  ) then
    raise exception 'The field list changed. Review the latest fields and try again.' using errcode = '40001';
  end if;

  if replacement is not null then
    if jsonb_typeof(replacement) <> 'array' or jsonb_array_length(replacement) > 500 then
      raise exception 'Choose a valid template.' using errcode = '23514';
    end if;
    select coalesce(array_agg(d.key), '{}') into removed_keys
    from public.directory_field_definitions d
    where d.organization_id = target_org and not exists (
      select 1 from jsonb_to_recordset(replacement) as r(key text, kind text, options text[])
      where r.key = d.key and r.kind = d.kind and r.options = d.options
    );
  else
    if not exists (select 1 from public.directory_field_definitions where organization_id = target_org and key = remove_key) then
      raise exception 'Directory field not found.' using errcode = 'P0002';
    end if;
    removed_keys := array[remove_key];
  end if;

  update public.directory_field_definitions set active = false
    where organization_id = target_org and key = any(removed_keys);

  if replacement is not null then
    insert into public.directory_field_definitions (organization_id, key, label, kind, options)
      select target_org, r.key, r.label, r.kind, r.options
      from jsonb_to_recordset(replacement) as r(key text, label text, kind text, options text[])
      on conflict (organization_id, key) do update set label = excluded.label, active = true
      where directory_field_definitions.kind = excluded.kind
        and directory_field_definitions.options = excluded.options;
    if exists (
      select 1 from jsonb_to_recordset(replacement) as r(key text, kind text, options text[])
      join public.directory_field_definitions d on d.organization_id = target_org and d.key = r.key
      where d.kind <> r.kind or d.options <> r.options
    ) then
      raise exception 'A retained field uses a different type or choices. Use a new field key.' using errcode = '23514';
    end if;
  end if;
end;
$$;
create or replace function public.preview_directory_import(target_org uuid, roster jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  item jsonb;
  code text;
  template_code text;
  identifier_key text;
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
  select key into identifier_key from public.directory_field_definitions where organization_id=target_org and active and display_order=10 and kind='text' order by key limit 1;
  for item in select * from jsonb_array_elements(roster) loop
    row_index := row_index + 1;
    code := nullif(lower(btrim(item->>'member_code')), '');
    template_code := nullif(lower(btrim(item->'attributes'->>identifier_key)), '');
    reason := case
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
  report := public.preview_directory_import(target_org,roster);
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
      'status',case when result_id is null then 'skipped_duplicate' else 'inserted' end));
  end loop;
  insert into public.directory_import_batches(organization_id,request_id,actor_id,inserted_count,skipped_count,payload_hash,row_results,report_expires_at)
    values(target_org,request_key,auth.uid(),added,jsonb_array_length(roster)-added,md5(roster::text),report,now()+interval '7 days');
  return jsonb_build_object('inserted',added,'skipped',jsonb_array_length(roster)-added,'rows',report);
end;
$$;
commit;
