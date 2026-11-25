begin;

create or replace function public.record_ai_usage_log(
  p_organization_id uuid,
  p_conversation_id uuid default null,
  p_model text default 'unknown',
  p_prompt_tokens integer default 0,
  p_completion_tokens integer default 0,
  p_total_tokens integer default 0,
  p_latency_ms integer default 0,
  p_tool_calls_count integer default 0,
  p_status text default 'success',
  p_error_code text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_request_id text := left(nullif(trim(coalesce(p_request_id, '')), ''), 120);
  v_status text := case
    when p_status in ('success', 'error', 'aborted', 'rate_limited') then p_status
    else 'error'
  end;
begin
  if v_user_id is null then
    return null;
  end if;

  if not public.is_active_org_member(p_organization_id, v_user_id) then
    return null;
  end if;

  if p_conversation_id is not null and not exists (
    select 1
    from public.ai_conversations c
    join public.organization_members om
      on om.organization_id = c.organization_id and om.profile_id = v_user_id
    where c.id = p_conversation_id
      and c.organization_id = p_organization_id
      and c.created_by = v_user_id
      and om.status = 'active'
      and om.role = c.access_role
  ) then
    return null;
  end if;

  if v_request_id is not null then
    select id into v_id
    from public.ai_usage_logs
    where request_id = v_request_id
      and organization_id = p_organization_id
      and user_id = v_user_id
      and conversation_id is not distinct from p_conversation_id
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.ai_usage_logs (
    organization_id,
    user_id,
    conversation_id,
    model,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    latency_ms,
    tool_calls_count,
    status,
    error_code,
    request_id
  ) values (
    p_organization_id,
    v_user_id,
    p_conversation_id,
    left(coalesce(nullif(trim(p_model), ''), 'unknown'), 120),
    greatest(0, coalesce(p_prompt_tokens, 0)),
    greatest(0, coalesce(p_completion_tokens, 0)),
    greatest(0, coalesce(p_total_tokens, greatest(0, coalesce(p_prompt_tokens, 0)) + greatest(0, coalesce(p_completion_tokens, 0)))),
    greatest(0, coalesce(p_latency_ms, 0)),
    greatest(0, coalesce(p_tool_calls_count, 0)),
    v_status,
    left(nullif(trim(coalesce(p_error_code, '')), ''), 120),
    v_request_id
  )
  on conflict (request_id) where request_id is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text, text) from public, anon;
grant execute on function public.record_ai_usage_log(uuid, uuid, text, integer, integer, integer, integer, integer, text, text, text) to authenticated;

commit;
