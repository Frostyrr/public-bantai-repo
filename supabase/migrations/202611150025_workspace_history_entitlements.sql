begin;

create table public.workspace_history_entitlements (
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  closure_role text not null,
  captured_at timestamptz not null default transaction_timestamp(),
  primary key (organization_id,profile_id)
);
create table public.workspace_history_revocations (
  organization_id uuid not null,
  profile_id uuid not null,
  revoked_by uuid not null references public.profiles(id),
  revoked_at timestamptz not null default now(),
  primary key (organization_id,profile_id),
  foreign key (organization_id,profile_id)
    references public.workspace_history_entitlements(organization_id,profile_id)
);
alter table public.workspace_history_entitlements enable row level security;
alter table public.workspace_history_revocations enable row level security;
revoke all on public.workspace_history_entitlements,public.workspace_history_revocations
  from public,anon,authenticated;

create function public.revoke_workspace_history(org uuid, subject uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.workspace_history_entitlements e
    join public.organizations o on o.id=e.organization_id
    join public.profiles p on p.id=e.profile_id
    where e.organization_id=org and e.profile_id=auth.uid()
      and e.closure_role='owner' and o.closed_at is not null and p.suspended_at is null
      and not exists (select 1 from public.workspace_history_revocations r
        where r.organization_id=org and r.profile_id=e.profile_id)
  ) then raise exception 'Historical access administration is unavailable.' using errcode='42501'; end if;
  insert into public.workspace_history_revocations(organization_id,profile_id,revoked_by)
    select org, subject, auth.uid() from public.workspace_history_entitlements
    where organization_id=org and profile_id=subject on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.revoke_workspace_history(uuid,uuid) from public,anon;
grant execute on function public.revoke_workspace_history(uuid,uuid) to authenticated;

create or replace function public.delete_organization(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  org public.organizations%rowtype;
begin
  select * into org from public.organizations where id = p_org_id for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id = p_org_id
      and profile_id = auth.uid() and role = 'owner' and status = 'active'
  ) then
    raise exception 'Only an organization owner can close this organization.' using errcode = '42501';
  end if;
  if exists(select 1 from public.advance_accounting where organization_id = p_org_id
    and (unsettled > 0 or discrepancy > 0)) then
    raise exception 'Settle outstanding cash advances before closing the organization.' using errcode = '23514';
  end if;
  update public.organization_directory_members set email = null, phone = null
    where organization_id = p_org_id and (email is not null or phone is not null);
  update public.user_preferences set default_organization_id = null where default_organization_id = p_org_id;
  insert into public.workspace_history_entitlements(organization_id,profile_id,closure_role)
    select organization_id,profile_id,role from public.organization_members
    where organization_id=p_org_id and status='active';
  update public.organization_members set status = 'left' where organization_id = p_org_id and status <> 'left';
  update public.organizations set closed_at = now(), closed_by = auth.uid(),
    retention_status = 'retained_pending_review', retention_review_at = now() + interval '1 year'
    where id = p_org_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(p_org_id,auth.uid(),'organization_closed',p_org_id,
      jsonb_build_object('retention_status','retained_pending_review'));
  return jsonb_build_object('success',true,'organization_id',p_org_id,'action','closed');
end;
$$;
create function public.closed_transaction_history(
  org uuid, kind text, target uuid default null, space uuid default null,
  period uuid default null, budget uuid default null, filter_status text default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  member_role text;
begin
  select e.closure_role into member_role from public.workspace_history_entitlements e
  join public.organizations o on o.id=e.organization_id
  join public.profiles p on p.id=e.profile_id
  where e.organization_id=org and e.profile_id=auth.uid()
    and o.closed_at is not null and o.suspended_at is null and p.suspended_at is null
    and not exists (select 1 from public.workspace_history_revocations r
      where r.organization_id=org and r.profile_id=e.profile_id);
  if member_role is null then return '[]'::jsonb; end if;
  if kind='expense' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'organization_id',org, 'title',case when e.submitted_by=auth.uid() then e.title else 'Approved expense' end,
      'archived_at',e.archived_at,
      'category',e.category,'amount_centavos',e.amount_centavos,'currency',e.currency,
      'incurred_date',e.incurred_date,'status',e.status,'created_at',e.created_at
    ) || case when e.submitted_by=auth.uid() then jsonb_build_object(
      'submitted_by',e.submitted_by,'description',e.description,'space_id',e.space_id,
      'budget_id',e.budget_id,'reporting_period_id',e.reporting_period_id,'review_revision',e.review_revision
    ) else '{}'::jsonb end order by e.incurred_date desc,e.id),'[]')
    from public.expenses e where e.organization_id=org and (e.status='approved' or e.submitted_by=auth.uid())
      and (target is null or e.id=target)
      and (space is null or e.space_id=space) and (period is null or e.reporting_period_id=period)
      and (budget is null or e.budget_id=budget) and (filter_status is null or e.status=filter_status));
  elsif kind='advance' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'organization_id',org,'title',case when a.status='liquidated' then 'Settled advance' else 'Cash advance' end,'purpose','',
      'amount_released_centavos',a.amount_released_centavos,'currency',a.currency,
      'released_at',a.released_at,'created_at',a.created_at,'status',a.status,
      'liquidations',case when a.status='liquidated' then jsonb_build_array(jsonb_build_object(
        'status','approved','total_spent_centavos',v.spent,'total_returned_centavos',v.returned
      )) when l.id is not null then jsonb_build_array(jsonb_build_object(
        'status',l.status,'total_spent_centavos',l.total_spent_centavos,
        'total_returned_centavos',l.total_returned_centavos
      )) else '[]'::jsonb end
    ) order by a.released_at desc,a.id),'[]')
    from public.cash_advances a join public.advance_accounting v on v.id=a.id and v.organization_id=org
    left join public.liquidations l on l.organization_id=org and l.cash_advance_id=a.id
    where a.organization_id=org and (a.status='liquidated' or exists (
        select 1 from public.organization_members custodian
        where custodian.id=a.accountable_person_id and custodian.organization_id=org
          and custodian.profile_id=auth.uid()
      )) and (target is null or a.id=target)
      and (space is null or a.space_id=space) and (period is null or a.reporting_period_id=period)
      and (filter_status is null or a.status=filter_status));
  end if;
  raise exception 'Unknown transaction kind.' using errcode='22023';
end;
$$;
revoke all on function public.closed_transaction_history(uuid,text,uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.closed_transaction_history(uuid,text,uuid,uuid,uuid,uuid,text) to authenticated;
commit;
