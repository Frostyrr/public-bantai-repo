-- Migration: 202611120008_audit_logs_and_reports.sql
-- Description: Phase 7 schema allowing authorized organization officers to read append-only audit logs via a security definer function.

revoke all on public.audit_logs from anon, authenticated;

-- Function to fetch audit logs with actor display names for authorized officers
create or replace function public.get_organization_audit_logs(
  p_org_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id bigint,
  organization_id uuid,
  actor_id uuid,
  actor_name text,
  action text,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  occurred_at timestamptz
) language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_org_officer(p_org_id, v_caller) then
    raise exception 'Unauthorized to inspect audit logs for this organization.';
  end if;

  return query
  select
    a.id,
    a.organization_id,
    a.actor_id,
    coalesce(p.display_name, 'System') as actor_name,
    a.action,
    a.entity_id,
    a.before_value,
    a.after_value,
    a.occurred_at
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  where a.organization_id = p_org_id
  order by a.occurred_at desc
  limit p_limit offset p_offset;
end;
$$;

grant execute on function public.get_organization_audit_logs(uuid, int, int) to authenticated;
