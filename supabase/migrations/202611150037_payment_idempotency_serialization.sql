begin;
create or replace function public.record_payment(
  p_org_id uuid,
  p_obligation_id uuid,
  p_amount_centavos bigint,
  p_payment_method text,
  p_reference_number text default null,
  p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_obligation record;
  v_existing public.payments;
  v_receipt_no text;
  v_payment public.payments;
  v_key text;
begin
  if not public.is_active_org_member(p_org_id, v_caller) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;

  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  v_key := coalesce(nullif(trim(p_idempotency_key), ''), gen_random_uuid()::text);

  -- Serialize the replay lookup and insert for a key until commit or rollback.
  -- The hash scopes the lock to the organization and key. A collision only waits.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('record_payment:' || p_org_id::text || ':' || v_key, 0)
  );

  -- A caller may have lost access while waiting for a concurrent payment.
  if not public.is_active_org_member(p_org_id, v_caller) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id and profile_id = v_caller and status = 'active';

  if v_role is null or v_role not in ('owner', 'organization_admin', 'treasurer') then
    raise exception 'Unauthorized to record payments.';
  end if;

  if p_amount_centavos <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  select * into v_existing
  from public.payments
  where organization_id = p_org_id and idempotency_key = v_key;

  if found then
    if row(v_existing.obligation_id, v_existing.amount_centavos,
           v_existing.payment_method, v_existing.reference_number)
       is distinct from row(p_obligation_id, p_amount_centavos,
                            p_payment_method, p_reference_number) then
      raise exception 'This payment key was already used with different payment details.'
        using errcode = 'PT409';
    end if;

    return jsonb_build_object(
      'id', v_existing.id,
      'obligation_id', v_existing.obligation_id,
      'collection_id', v_existing.collection_id,
      'amount_centavos', v_existing.amount_centavos,
      'payment_method', v_existing.payment_method,
      'reference_number', v_existing.reference_number,
      'receipt_number', v_existing.receipt_number,
      'idempotency_key', v_existing.idempotency_key,
      'status', v_existing.status,
      'paid_at', v_existing.paid_at,
      'is_duplicate_replay', true
    );
  end if;

  -- Validate obligation belongs to this org
  select o.id, o.collection_id, o.amount_centavos, o.status
  into v_obligation
  from public.obligations o
  where o.id = p_obligation_id and o.organization_id = p_org_id;

  if not found then
    raise exception 'Obligation not found in this organization.';
  end if;

  -- Generate sequential receipt number
  v_receipt_no := public.generate_receipt_number(p_org_id);

  insert into public.payments (
    organization_id,
    collection_id,
    obligation_id,
    amount_centavos,
    payment_method,
    reference_number,
    receipt_number,
    idempotency_key,
    recorded_by,
    paid_at
  ) values (
    p_org_id,
    v_obligation.collection_id,
    v_obligation.id,
    p_amount_centavos,
    p_payment_method,
    p_reference_number,
    v_receipt_no,
    v_key,
    v_caller,
    now()
  ) returning * into v_payment;

  return jsonb_build_object(
    'id', v_payment.id,
    'obligation_id', v_payment.obligation_id,
    'collection_id', v_payment.collection_id,
    'amount_centavos', v_payment.amount_centavos,
    'payment_method', v_payment.payment_method,
    'reference_number', v_payment.reference_number,
    'receipt_number', v_payment.receipt_number,
    'idempotency_key', v_payment.idempotency_key,
    'status', v_payment.status,
    'paid_at', v_payment.paid_at,
    'is_duplicate_replay', false
  );
end;
$$;
revoke all on function public.record_payment(uuid,uuid,bigint,text,text,text) from public,anon;
commit;
