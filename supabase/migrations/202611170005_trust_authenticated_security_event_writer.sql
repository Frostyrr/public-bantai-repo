begin;

-- Authenticated REST clients could submit their own event classifications and metadata.
-- The server supplies an actor only after session verification. Remove the old RPC
-- instead of retaining an overload that can still be reached with a user token.
drop function public.record_authenticated_security_event(
  text, text, text, text, integer, text, text, uuid, jsonb, text, text, boolean, integer
);

create or replace function public.record_authenticated_security_event(
  p_actor_id uuid,
  p_category text,
  p_severity text,
  p_action text,
  p_outcome text,
  p_http_status integer default null,
  p_route text default null,
  p_request_id text default null,
  p_organization_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_event_source text default 'api',
  p_classification_reason text default null,
  p_enforcement_eligible boolean default false,
  p_dedup_window_seconds integer default 300
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := p_actor_id;
  v_is_operational boolean := (p_category = 'operational' or coalesce(p_http_status, 0) >= 500);
  v_class text := case when v_is_operational then 'operational' else 'security' end;
  v_category text := case when v_is_operational then 'operational' else p_category end;
  v_source text := case
    when p_event_source in ('api', 'auth', 'middleware', 'database', 'infrastructure') then p_event_source
    else 'api'
  end;
  v_sig text := md5(coalesce(v_category, '') || '|' || coalesce(p_action, '') || '|' || coalesce(p_http_status::text, '') || '|' || coalesce(p_route, ''));
  v_existing_id bigint;
  v_id bigint;
begin
  if v_actor is null then
    raise exception 'Verified actor required';
  end if;

  if v_is_operational and p_dedup_window_seconds > 0 then
    select id into v_existing_id
    from public.security_events
    where signature_hash = v_sig
      and event_class = 'operational'
      and last_occurred_at >= now() - make_interval(secs => p_dedup_window_seconds)
    order by last_occurred_at desc
    limit 1;

    if v_existing_id is not null then
      update public.security_events
      set
        occurrence_count = occurrence_count + 1,
        last_occurred_at = now(),
        severity = case when occurrence_count + 1 >= 5 then 'medium' else severity end,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'latest_request_id', p_request_id,
          'latest_requesting_user_id', v_actor
        )
      where id = v_existing_id;
      return v_existing_id;
    end if;
  end if;

  insert into public.security_events (
    category, event_class, event_source, severity, action,
    actor_id, requesting_user_id, organization_id,
    http_status, route, request_id, outcome,
    classification_reason, enforcement_eligible, signature_hash, metadata
  )
  values (
    v_category,
    v_class,
    v_source,
    p_severity,
    left(trim(p_action), 120),
    case when v_is_operational then null else v_actor end,
    v_actor,
    p_organization_id,
    p_http_status,
    left(p_route, 200),
    left(p_request_id, 64),
    p_outcome,
    p_classification_reason,
    case when v_is_operational then false else coalesce(p_enforcement_eligible, false) end,
    v_sig,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_authenticated_security_event(
  uuid, text, text, text, text, integer, text, text, uuid, jsonb, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function public.record_authenticated_security_event(
  uuid, text, text, text, text, integer, text, text, uuid, jsonb, text, text, boolean, integer
) to service_role;

commit;
