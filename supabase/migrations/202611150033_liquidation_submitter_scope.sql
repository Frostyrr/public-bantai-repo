begin;
create or replace function public.submit_liquidation(
  p_org_id uuid,
  p_cash_advance_id uuid,
  p_spent_centavos bigint,
  p_returned_centavos bigint,
  p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_advance public.cash_advances;
  v_liquidation public.liquidations;
  v_balance bigint;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null then
    raise exception 'Unauthorized to submit liquidation.';
  end if;

  select * into v_advance
  from public.cash_advances
  where id = p_cash_advance_id and organization_id = p_org_id;

  if not found then
    raise exception 'Cash advance record not found.';
  end if;

  if v_role not in ('owner','organization_admin','treasurer') and not exists (
    select 1 from public.organization_members m
    where m.id=v_advance.accountable_person_id and m.organization_id=p_org_id
      and m.profile_id=v_caller and m.status='active'
  ) then
    raise exception 'Only the accountable member or a financial officer may submit liquidation.' using errcode='42501';
  end if;

  if v_advance.status = 'liquidated' then
    raise exception 'Cash advance is already liquidated.';
  end if;

  if p_spent_centavos < 0 or p_returned_centavos < 0 then
    raise exception 'Spent and returned amounts must be non-negative.';
  end if;

  -- Formula: Unreconciled Balance = Released - Spent - Returned
  v_balance := v_advance.amount_released_centavos - p_spent_centavos - p_returned_centavos;

  insert into public.liquidations (
    organization_id,
    cash_advance_id,
    total_spent_centavos,
    total_returned_centavos,
    outstanding_balance_centavos,
    reconciliation_notes,
    status,
    submitted_by
  ) values (
    p_org_id,
    p_cash_advance_id,
    p_spent_centavos,
    p_returned_centavos,
    v_balance,
    p_notes,
    'submitted',
    v_caller
  )
  on conflict (cash_advance_id)
  do update set
    total_spent_centavos = excluded.total_spent_centavos,
    total_returned_centavos = excluded.total_returned_centavos,
    outstanding_balance_centavos = excluded.outstanding_balance_centavos,
    reconciliation_notes = excluded.reconciliation_notes,
    status = 'submitted',
    submitted_at = now(),
    submitted_by = v_caller,
    updated_at = now()
  returning * into v_liquidation;

  -- Update advance status to 'under_review'
  update public.cash_advances
  set status = 'under_review', updated_at = now()
  where id = p_cash_advance_id;

  return jsonb_build_object(
    'id', v_liquidation.id,
    'cash_advance_id', v_liquidation.cash_advance_id,
    'total_spent_centavos', v_liquidation.total_spent_centavos,
    'total_returned_centavos', v_liquidation.total_returned_centavos,
    'outstanding_balance_centavos', v_liquidation.outstanding_balance_centavos,
    'status', v_liquidation.status
  );
end;
$$;
revoke all on function public.submit_liquidation(uuid,uuid,bigint,bigint,text) from public,anon;
commit;
