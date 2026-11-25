begin;

-- References only: image bytes are never stored in Bani. Extraction JSON retains
-- its original 24h expiry. Historical chat replies follow existing chat retention.
create table public.bani_receipt_links (
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  extraction_id uuid not null references public.receipt_ai_extractions(id) on delete cascade,
  filename text not null check(char_length(filename) between 1 and 150),
  created_at timestamptz not null default now(),
  primary key(conversation_id,extraction_id)
);
alter table public.bani_receipt_links enable row level security;
revoke all on public.bani_receipt_links from public,anon,authenticated,service_role;

create function public.bani_receipt_context(org uuid, conversation uuid, extraction uuid default null, filename text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform bantai_gateway.check_session();
  if not public.is_active_org_member(org,auth.uid()) or not exists (
    select 1 from public.ai_conversations c join public.organization_members m
      on m.organization_id=c.organization_id and m.profile_id=c.created_by
    where c.id=conversation and c.organization_id=org and c.created_by=auth.uid()
      and m.status='active' and m.role=c.access_role
  ) then raise exception 'Conversation unavailable.' using errcode='42501'; end if;
  -- Preserve the shared extraction service's current permission boundary.
  if extraction is not null or exists(select 1 from public.bani_receipt_links l where l.conversation_id=conversation) then
    perform public.receipt_ai_access(org);
  end if;
  if extraction is not null then
    perform pg_advisory_xact_lock(hashtextextended(conversation::text,91822));
    if filename is null or char_length(filename) not between 1 and 150 or not exists (
      select 1 from public.receipt_ai_extractions r where r.id=extraction and r.organization_id=org
        and r.actor_id=auth.uid() and r.status='success' and r.expires_at>now() and r.result_data is not null
    ) then raise exception 'Receipt unavailable or expired. Attach the image again.' using errcode='42501'; end if;
    if not exists(select 1 from public.bani_receipt_links l where l.conversation_id=conversation and l.extraction_id=extraction)
      and (select count(*) from public.bani_receipt_links l join public.receipt_ai_extractions r on r.id=l.extraction_id
        where l.conversation_id=conversation and r.expires_at>now() and r.status='success')>=3 then
      raise exception 'This chat already has three active receipts. Start a new chat for another receipt.' using errcode='23514'; end if;
    insert into public.bani_receipt_links(conversation_id,extraction_id,filename) values(conversation,extraction,filename)
      on conflict(conversation_id,extraction_id) do nothing;
  end if;
  select jsonb_build_object(
    'receipts',coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',l.filename,'expiresAt',r.expires_at,
      'data',r.result_data,'warnings',r.warnings) order by l.created_at,r.id)
      filter(where r.status='success' and r.expires_at>now() and r.result_data is not null),'[]'::jsonb),
    'expiredCount',count(*) filter(where r.status<>'success' or r.expires_at<=now() or r.result_data is null)
  ) into result from public.bani_receipt_links l join public.receipt_ai_extractions r on r.id=l.extraction_id
    where l.conversation_id=conversation and r.organization_id=org and r.actor_id=auth.uid();
  return result;
end;
$$;
revoke all on function public.bani_receipt_context(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.bani_receipt_context(uuid,uuid,uuid,text) to authenticated;

-- Small streaming check: validate expiry using the database clock without
-- repeatedly returning receipt JSON while a reply is being delivered.
create function public.bani_receipt_stream_access(org uuid, conversation uuid, extractions uuid[])
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.receipt_ai_access(org);
  if extractions is null or cardinality(extractions)>3 then return false; end if;
  return exists(select 1 from public.ai_conversations c join public.organization_members m
    on m.organization_id=c.organization_id and m.profile_id=c.created_by
    where c.id=conversation and c.organization_id=org and c.created_by=auth.uid() and m.status='active' and m.role=c.access_role)
    and (select count(*) from public.bani_receipt_links l join public.receipt_ai_extractions r on r.id=l.extraction_id
      where l.conversation_id=conversation and r.organization_id=org and r.actor_id=auth.uid()
        and r.status='success' and r.expires_at>now() and r.result_data is not null and r.id=any(extractions))=cardinality(extractions);
end;
$$;
revoke all on function public.bani_receipt_stream_access(uuid,uuid,uuid[]) from public,anon,service_role;
grant execute on function public.bani_receipt_stream_access(uuid,uuid,uuid[]) to authenticated;
commit;
