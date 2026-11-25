begin;

create function public.collection_financial_totals(target_org uuid, target_collection uuid default null)
returns table (
  collection_id uuid, total_obligations_count bigint, paid_obligations_count bigint,
  partially_paid_count bigint, pending_count bigint, total_expected_centavos text, total_collected_centavos text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_org_member(target_org, auth.uid()) then
    raise exception 'Collection totals are not accessible.' using errcode = '42501';
  end if;
  return query
    select c.id, coalesce(o.total, 0), coalesce(o.paid, 0), coalesce(o.partial, 0),
      coalesce(o.pending, 0), coalesce(o.assessed, 0)::text, coalesce(p.collected, 0)::text
    from public.collections c
    left join (
      select x.collection_id, count(*) as total, count(*) filter (where x.status = 'paid') as paid,
        count(*) filter (where x.status = 'partially_paid') as partial,
        count(*) filter (where x.status = 'pending') as pending, sum(x.amount_centavos) as assessed
      from public.obligations x where x.organization_id = target_org
        and (target_collection is null or x.collection_id = target_collection)
      group by x.collection_id
    ) o on o.collection_id = c.id
    left join (
      select y.collection_id, sum(y.amount_centavos) as collected
      from public.payments y where y.organization_id = target_org and y.status = 'completed'
        and (target_collection is null or y.collection_id = target_collection)
      group by y.collection_id
    ) p on p.collection_id = c.id
    where c.organization_id = target_org and (target_collection is null or c.id = target_collection);
end;
$$;
revoke all on function public.collection_financial_totals(uuid, uuid) from public, anon;
grant execute on function public.collection_financial_totals(uuid, uuid) to authenticated;
grant execute on function public.assign_directory_obligations(uuid, uuid, uuid[], bigint, text) to authenticated;

create or replace function public.create_collection(
  p_org_id uuid,
  p_title text,
  p_description text default null,
  p_space_id uuid default null,
  p_period_id uuid default null,
  p_target_centavos bigint default 0,
  p_due_date date default null,
  p_default_obligation_centavos bigint default 0,
  p_assign_all boolean default false
)
returns jsonb language plpgsql security definer as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_org_currency char(3);
  v_collection public.collections;
  v_assigned_count int := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  -- Caller must be active owner, organization_admin, or treasurer
  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to create collections for this organization.';
  end if;

  select currency into v_org_currency from public.organizations where id = p_org_id;
  if v_org_currency is null then
    v_org_currency := 'PHP';
  end if;

  insert into public.collections (
    organization_id,
    space_id,
    reporting_period_id,
    title,
    description,
    currency,
    target_amount_centavos,
    due_date,
    created_by
  ) values (
    p_org_id,
    p_space_id,
    p_period_id,
    trim(p_title),
    p_description,
    v_org_currency,
    coalesce(p_target_centavos, 0),
    p_due_date,
    v_caller
  ) returning * into v_collection;

  -- Batch assign default obligation to all active members if requested
  if p_assign_all then
    raise exception 'Create the collection first, then assign dues from the member directory.' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'id', v_collection.id,
    'organization_id', v_collection.organization_id,
    'space_id', v_collection.space_id,
    'reporting_period_id', v_collection.reporting_period_id,
    'title', v_collection.title,
    'description', v_collection.description,
    'currency', v_collection.currency,
    'target_amount_centavos', v_collection.target_amount_centavos,
    'due_date', v_collection.due_date,
    'status', v_collection.status,
    'created_at', v_collection.created_at,
    'assigned_obligations_count', v_assigned_count
  );
end;
$$;

revoke execute on function public.assign_member_obligation(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;

commit;
