begin;

-- Reuse the private extraction/usage ledger and its 24h cleanup. A versioned,
-- question-specific namespace prevents general image findings from entering the
-- reviewed receipt/expense path. No original images are stored.
alter table public.receipt_ai_extractions drop constraint receipt_ai_extractions_version_check;
alter table public.receipt_ai_extractions add constraint receipt_ai_extractions_version_check
  check(version='expenses-v1' or version ~ '^bani-image-v1:[0-9a-f]{64}$');

create or replace function public.claim_receipt_ai(org uuid, actor uuid, source_hash text, model_name text, schema_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.receipt_ai_extractions; claimed uuid; q public.ai_workspace_quotas;
  daily_used bigint; monthly_used bigint; reserved bigint; pending bigint;
begin
  if not public.is_active_org_member(org,actor) then
    raise exception 'Active workspace access required.' using errcode='42501'; end if;
  if source_hash is null or source_hash !~ '^[0-9a-f]{64}$' or model_name is distinct from 'qwen/qwen3.8-27b'
    or schema_version is null or (schema_version<>'expenses-v1' and schema_version !~ '^bani-image-v1:[0-9a-f]{64}$') then
    raise exception 'Invalid extraction claim.' using errcode='23514'; end if;
  -- Personal image analysis does not grant any financial read/write permission.
  -- The original receipt endpoint retains its existing submission capability gate.
  if schema_version='expenses-v1' and not exists (
    select 1 from public.organization_members m where m.organization_id=org and m.profile_id=actor and m.status='active'
    and (m.role in ('owner','organization_admin','treasurer') or (m.role in ('member','student') and m.can_submit_expenses))
  ) then raise exception 'Expense submission access required.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,91821));
  select * into q from public.ai_workspace_quotas where organization_id=org;
  if q.ai_enabled is false then return jsonb_build_object('state','disabled'); end if;
  select * into previous from public.receipt_ai_extractions r
    where r.organization_id=org and r.actor_id=actor and r.source_sha256=source_hash
      and r.model=model_name and r.version=schema_version and r.status='success' and r.expires_at>now()
    order by r.created_at desc limit 1;
  if found then
    insert into public.receipt_ai_events(extraction_id,organization_id,actor_id,event) values(previous.id,org,actor,'cache_hit');
    return jsonb_build_object('state','cached','id',previous.id,'data',previous.result_data,'warnings',previous.warnings,'expiresAt',previous.expires_at);
  end if;
  select count(*) into pending from public.receipt_ai_extractions r
    where r.organization_id=org and r.status='running' and r.created_at>now()-interval '60 seconds';
  if pending>=2 or exists(select 1 from public.receipt_ai_extractions r where r.organization_id=org and r.actor_id=actor
    and r.status='running' and r.created_at>now()-interval '60 seconds') then return jsonb_build_object('state','busy'); end if;
  if (select count(*) from public.receipt_ai_extractions r where r.organization_id=org and r.created_at>now()-interval '1 minute')>=10
    or (select count(*) from public.receipt_ai_extractions r where r.organization_id=org and r.actor_id=actor and r.created_at>now()-interval '1 minute')>=5
    or (select count(*) from public.receipt_ai_extractions r where r.organization_id=org and r.created_at>=date_trunc('day',now()))>=100
    then return jsonb_build_object('state','limited'); end if;
  select count(*) into daily_used from public.ai_usage_logs l where l.organization_id=org
    and l.created_at>=date_trunc('day',now()) and l.status in ('success','error','aborted');
  select count(*) into pending from public.receipt_ai_extractions r where r.organization_id=org
    and r.created_at>=date_trunc('day',now()) and r.status='running';
  select coalesce(sum(l.total_tokens),0) into monthly_used from public.ai_usage_logs l
    where l.organization_id=org and l.created_at>=date_trunc('month',now());
  select count(*)*65536 into reserved from public.receipt_ai_extractions r where r.organization_id=org
    and r.created_at>=date_trunc('month',now()) and not exists (
      select 1 from public.ai_usage_logs l where l.request_id='receipt:'||r.id::text);
  if (coalesce(q.daily_request_limit,200)>0 and daily_used+pending>=coalesce(q.daily_request_limit,200))
    or (coalesce(q.monthly_token_limit,2000000)>0 and monthly_used+reserved+65536>coalesce(q.monthly_token_limit,2000000))
    then return jsonb_build_object('state','limited'); end if;
  insert into public.receipt_ai_extractions(organization_id,actor_id,source_sha256,model,version)
    values(org,actor,source_hash,model_name,schema_version) returning id into claimed;
  insert into public.receipt_ai_events(extraction_id,organization_id,actor_id,event) values(claimed,org,actor,'claimed');
  return jsonb_build_object('state','claimed','id',claimed,'expiresAt',now()+interval '24 hours');
end;
$$;

create function public.guard_specialized_receipt_analysis() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='receipt_ai_events' then
    if new.event<>'applied' then return new; end if;
  end if;
  if not exists(select 1 from public.receipt_ai_extractions r where r.id=new.extraction_id and r.version='expenses-v1') then
    raise exception 'A reviewed receipt extraction is required.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_specialized_receipt_analysis() from public,anon,authenticated,service_role;
create trigger specialized_receipt_application before insert on public.receipt_ai_events
  for each row execute function public.guard_specialized_receipt_analysis();
create trigger specialized_receipt_conversation before insert on public.bani_receipt_links
  for each row execute function public.guard_specialized_receipt_analysis();

create table public.bani_image_links(
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  analysis_id uuid not null references public.receipt_ai_extractions(id) on delete cascade,
  filename text not null check(char_length(filename) between 1 and 150),
  created_at timestamptz not null default now(),
  primary key(conversation_id,analysis_id)
);
alter table public.bani_image_links enable row level security;
revoke all on public.bani_image_links from public,anon,authenticated,service_role;

create function public.bani_image_access(org uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform bantai_gateway.check_session();
  if not public.is_active_org_member(org,auth.uid()) then
    raise exception 'Active workspace access required.' using errcode='42501'; end if;
  return true;
end;
$$;
create function public.bani_image_context(org uuid, conversation uuid, analysis uuid default null, filename text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.bani_image_access(org);
  if not exists(select 1 from public.ai_conversations c join public.organization_members m
    on m.organization_id=c.organization_id and m.profile_id=c.created_by
    where c.id=conversation and c.organization_id=org and c.created_by=auth.uid() and m.status='active' and m.role=c.access_role)
    then raise exception 'Conversation unavailable.' using errcode='42501'; end if;
  if analysis is not null then
    perform pg_advisory_xact_lock(hashtextextended(conversation::text,91822));
    if filename is null or char_length(filename) not between 1 and 150 or not exists(
      select 1 from public.receipt_ai_extractions r where r.id=analysis and r.organization_id=org and r.actor_id=auth.uid()
        and r.version ~ '^bani-image-v1:[0-9a-f]{64}$' and r.status='success' and r.expires_at>now() and r.result_data is not null
    ) then raise exception 'Image unavailable or expired. Attach it again.' using errcode='42501'; end if;
    if not exists(select 1 from public.bani_image_links l where l.conversation_id=conversation and l.analysis_id=analysis)
      and (select count(*) from public.bani_image_links l join public.receipt_ai_extractions r on r.id=l.analysis_id
        where l.conversation_id=conversation and r.status='success' and r.expires_at>now())>=3
      then raise exception 'Start a new chat to analyze another image.' using errcode='23514'; end if;
    insert into public.bani_image_links(conversation_id,analysis_id,filename) values(conversation,analysis,filename)
      on conflict(conversation_id,analysis_id) do nothing;
  end if;
  select jsonb_build_object('images',coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',l.filename,'expiresAt',r.expires_at,
      'data',r.result_data,'warnings',r.warnings) order by l.created_at,r.id)
      filter(where r.status='success' and r.expires_at>now() and r.result_data is not null),'[]'::jsonb),
    'expiredCount',count(*) filter(where r.status<>'success' or r.expires_at<=now() or r.result_data is null))
    into result from public.bani_image_links l join public.receipt_ai_extractions r on r.id=l.analysis_id
      where l.conversation_id=conversation and r.organization_id=org and r.actor_id=auth.uid();
  return result;
end;
$$;
create function public.bani_image_stream_access(org uuid, conversation uuid, analyses uuid[])
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.bani_image_access(org);
  if analyses is null or cardinality(analyses)>3 then return false; end if;
  return exists(select 1 from public.ai_conversations c join public.organization_members m
    on m.organization_id=c.organization_id and m.profile_id=c.created_by
    where c.id=conversation and c.organization_id=org and c.created_by=auth.uid() and m.status='active' and m.role=c.access_role)
    and (select count(*) from public.bani_image_links l join public.receipt_ai_extractions r on r.id=l.analysis_id
      where l.conversation_id=conversation and r.organization_id=org and r.actor_id=auth.uid()
        and r.version ~ '^bani-image-v1:[0-9a-f]{64}$' and r.status='success' and r.expires_at>now()
        and r.result_data is not null and r.id=any(analyses))=cardinality(analyses);
end;
$$;
revoke all on function public.bani_image_access(uuid),public.bani_image_context(uuid,uuid,uuid,text),
  public.bani_image_stream_access(uuid,uuid,uuid[]) from public,anon,service_role;
grant execute on function public.bani_image_access(uuid),public.bani_image_context(uuid,uuid,uuid,text),
  public.bani_image_stream_access(uuid,uuid,uuid[]) to authenticated;
commit;
