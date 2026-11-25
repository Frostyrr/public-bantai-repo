begin;

-- No image bytes or Storage URLs are persisted here. Original evidence continues
-- through submit_expense_with_evidence. Results expire after 24h; events retain
-- only provenance/usage, under the existing organization lifecycle.
create table public.receipt_ai_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  model text not null check (model = 'qwen/qwen3.8-27b'),
  version text not null check (version = 'expenses-v1'),
  status text not null default 'running' check (status in ('running','success','error','expired')),
  result_data jsonb,
  warnings jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index receipt_ai_cache on public.receipt_ai_extractions(organization_id,actor_id,source_sha256,created_at desc);
create index receipt_ai_expiry on public.receipt_ai_extractions(expires_at) where result_data is not null;
create table public.receipt_ai_events (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.receipt_ai_extractions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (event in ('claimed','cache_hit','success','error','applied','expired')),
  expense_id uuid references public.expenses(id) on delete set null,
  evidence_id uuid references public.expense_evidence(id) on delete set null,
  applied_fields jsonb,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index receipt_ai_event_extraction on public.receipt_ai_events(extraction_id);
alter table public.receipt_ai_extractions enable row level security;
alter table public.receipt_ai_events enable row level security;
revoke all on public.receipt_ai_extractions, public.receipt_ai_events from public,anon,authenticated,service_role;

create function public.receipt_ai_access(org uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform bantai_gateway.check_session();
  if not public.is_active_org_member(org,auth.uid()) or not exists (
    select 1 from public.organization_members m where m.organization_id=org and m.profile_id=auth.uid()
    and m.status='active' and (m.role in ('owner','organization_admin','treasurer')
      or (m.role in ('member','student') and m.can_submit_expenses))
  ) then raise exception 'Expense submission access required.' using errcode='42501'; end if;
  return true;
end;
$$;
revoke all on function public.receipt_ai_access(uuid) from public,anon;
grant execute on function public.receipt_ai_access(uuid) to authenticated;

-- Service-only durable claim. Serializes all receipt admissions for a workspace:
-- no per-instance fallback, max 2 in flight/org and 1/actor, 5/min/actor,
-- 10/min/org, 100/day/org, and existing workspace kill-switch/quotas.
create function public.claim_receipt_ai(org uuid, actor uuid, source_hash text, model_name text, schema_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.receipt_ai_extractions; claimed uuid; q public.ai_workspace_quotas;
  daily_used bigint; monthly_used bigint; reserved bigint; pending bigint;
begin
  if not public.is_active_org_member(org,actor) or not exists (
    select 1 from public.organization_members m where m.organization_id=org and m.profile_id=actor and m.status='active'
    and (m.role in ('owner','organization_admin','treasurer') or (m.role in ('member','student') and m.can_submit_expenses))
  ) then raise exception 'Expense submission access required.' using errcode='42501'; end if;
  if source_hash !~ '^[0-9a-f]{64}$' or model_name <> 'qwen/qwen3.8-27b' or schema_version <> 'expenses-v1' then
    raise exception 'Invalid extraction claim.' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text, 91821));
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
  -- Abandoned attempts keep their token reservations until their accounting period
  -- ends: an unavailable provider may have consumed tokens without reporting usage.
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

create function public.finish_receipt_ai(extraction uuid, result jsonb, review_warnings jsonb,
  prompt_tokens integer, completion_tokens integer, total_tokens integer, latency_ms integer, provider_calls integer)
returns void language plpgsql security definer set search_path='' as $$
declare r public.receipt_ai_extractions;
begin
  select * into r from public.receipt_ai_extractions where id=extraction for update;
  if not found or r.status<>'running' then raise exception 'Extraction claim unavailable.' using errcode='23514'; end if;
  -- Share the admission lock so completion cannot create a gap in quota accounting.
  perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text,91821));
  update public.receipt_ai_extractions set status=case when result is null then 'error' else 'success' end,
    result_data=result,warnings=review_warnings where id=extraction;
  insert into public.receipt_ai_events(extraction_id,organization_id,actor_id,event,usage)
    values(extraction,r.organization_id,r.actor_id,case when result is null then 'error' else 'success' end,
      jsonb_build_object('providerCalls',greatest(0,provider_calls),'latencyMs',greatest(0,latency_ms),
        'reportedPromptTokens',greatest(0,prompt_tokens),'reportedCompletionTokens',greatest(0,completion_tokens),
        'chargedTokens',case when result is null and provider_calls>0 then greatest(65536,total_tokens) else greatest(0,total_tokens) end,
        'estimated',result is null and provider_calls>0));
  insert into public.ai_usage_logs(organization_id,user_id,model,prompt_tokens,completion_tokens,total_tokens,
    latency_ms,tool_calls_count,status,error_code,request_id)
    values(r.organization_id,r.actor_id,r.model,greatest(0,prompt_tokens),greatest(0,completion_tokens),
      case when result is null and provider_calls>0 then greatest(65536,total_tokens) else greatest(0,total_tokens) end,
      greatest(0,latency_ms),0,case when result is null then 'error' else 'success' end,
      case when result is null then 'receipt_extraction_failed' else null end,'receipt:'||extraction::text);
end;
$$;

-- User-token wrapper preserves the existing atomic submission and every approval,
-- budget, revision and audit trigger. Hash the actual submitted bytes in SQL;
-- filenames, indices and model-generated arguments cannot establish provenance.
create function public.submit_expense_with_ai_evidence(org uuid, request_id uuid, draft jsonb, files jsonb, links jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link jsonb; r public.receipt_ai_extractions; result jsonb; evidence uuid; expense uuid;
begin
  perform public.receipt_ai_access(org);
  if jsonb_typeof(links) is distinct from 'array' or jsonb_array_length(links) not between 1 and 3 then
    raise exception 'Invalid receipt links.' using errcode='23514'; end if;
  if jsonb_typeof(files) is distinct from 'array' or jsonb_array_length(files) not between 1 and 3
    or octet_length(files::text)>4200000 then
    raise exception 'Attach up to three files of 1 MB each.' using errcode='23514'; end if;
  -- A successful request remains replayable after result expiry. The original
  -- submission RPC compares the full payload, including both provenance digests.
  if exists(select 1 from public.expense_submission_requests prior_request where prior_request.organization_id=org
    and prior_request.actor_id=auth.uid() and prior_request.request_id=submit_expense_with_ai_evidence.request_id) then
    return public.submit_expense_with_evidence(org,request_id,draft||jsonb_build_object('receiptAiDigest',md5(links::text)),files);
  end if;
  for link in select * from jsonb_array_elements(links) loop
    select * into r from public.receipt_ai_extractions where id=(link->>'extractionId')::uuid
      and organization_id=org and actor_id=auth.uid() and status='success' and expires_at>now();
    if not found or not exists(select 1 from jsonb_array_elements(files) f
      where encode(sha256(decode(f->>'data','base64')),'hex')=r.source_sha256) then
      raise exception 'Receipt suggestions expired or do not match an attached receipt. Remove AI suggestions and submit manually.' using errcode='23514';
    end if;
    if jsonb_typeof(link->'appliedFields') is distinct from 'array' or jsonb_array_length(link->'appliedFields') not between 1 and 4
      or exists(select 1 from jsonb_array_elements_text(link->'appliedFields') f
        where f not in ('title','vendorName','incurredDate','amountCentavos')) then
      raise exception 'Invalid reviewed receipt fields.' using errcode='23514'; end if;
  end loop;
  result:=public.submit_expense_with_evidence(org,request_id,draft||jsonb_build_object('receiptAiDigest',md5(links::text)),files);
  expense:=(result->>'id')::uuid;
  for link in select * from jsonb_array_elements(links) loop
    select * into r from public.receipt_ai_extractions where id=(link->>'extractionId')::uuid;
    select id into evidence from public.expense_evidence e where e.expense_id=expense
      and encode(sha256(e.content),'hex')=r.source_sha256 order by id limit 1;
    if evidence is null then raise exception 'Matching receipt evidence is required.' using errcode='23514'; end if;
    if not exists(select 1 from public.receipt_ai_events e where e.extraction_id=r.id and e.expense_id=expense and e.event='applied') then
      insert into public.receipt_ai_events(extraction_id,organization_id,actor_id,event,expense_id,evidence_id,applied_fields)
        values(r.id,org,auth.uid(),'applied',expense,evidence,link->'appliedFields');
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function public.submit_expense_with_ai_evidence(uuid,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.submit_expense_with_ai_evidence(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;

create function public.expire_receipt_ai() returns integer
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  with expired as (
    update public.receipt_ai_extractions set result_data=null,warnings=null,status='expired'
    where expires_at<=now() and status<>'expired' returning id,organization_id,actor_id
  ) insert into public.receipt_ai_events(extraction_id,organization_id,actor_id,event)
    select id,organization_id,actor_id,'expired' from expired;
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.claim_receipt_ai(uuid,uuid,text,text,text),
  public.finish_receipt_ai(uuid,jsonb,jsonb,integer,integer,integer,integer,integer),public.expire_receipt_ai()
  from public,anon,authenticated;
grant execute on function public.claim_receipt_ai(uuid,uuid,text,text,text),
  public.finish_receipt_ai(uuid,jsonb,jsonb,integer,integer,integer,integer,integer),public.expire_receipt_ai() to service_role;

-- Optional on local engines; production deployment must schedule this if pg_cron
-- is unavailable. Expired results are never served even before cleanup runs.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('receipt-ai-expiry','*/15 * * * *','select public.expire_receipt_ai()');
  end if;
end; $$;
commit;
