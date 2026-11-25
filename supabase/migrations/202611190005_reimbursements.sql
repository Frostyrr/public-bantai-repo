begin;

-- Claims reuse the expense review, evidence and budget accounting machinery.
create table public.reimbursement_claims (
  expense_id uuid primary key references public.expenses(id) on delete cascade
);
create table public.reimbursement_payments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.reimbursement_claims(expense_id) on delete cascade,
  amount_centavos bigint not null check (amount_centavos > 0),
  paid_on date not null,
  method text not null,
  reference text,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text
);
create unique index reimbursement_one_payment on public.reimbursement_payments(expense_id) where voided_at is null;
alter table public.reimbursement_claims enable row level security;
alter table public.reimbursement_payments enable row level security;
revoke all on public.reimbursement_claims, public.reimbursement_payments from public, anon, authenticated;

create function public.submit_reimbursement(org uuid, request_id uuid, draft jsonb, files jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; claim uuid;
begin
  perform bantai_gateway.check_session();
  if length(coalesce(btrim(draft->>'title'),'')) not between 1 and 200
    or length(coalesce(btrim(draft->>'description'),'')) not between 1 and 1000
    or coalesce(draft->>'amountCentavos','') !~ '^[1-9][0-9]{0,11}$'
    or draft->>'incurredDate' is null or (draft->>'incurredDate')::date>current_date then
    raise exception 'Provide a purchase title, purpose, positive amount and valid date.' using errcode='23514';
  end if;
  if jsonb_typeof(files) is distinct from 'array' or jsonb_array_length(files) not between 1 and 3 then
    raise exception 'Attach at least one receipt.';
  end if;
  result := public.submit_expense_with_evidence(org,request_id,
    (draft - 'receiptUrl') || '{"reimbursement":true}'::jsonb,files);
  claim := (result->>'id')::uuid;
  perform 1 from public.expenses where id=claim and organization_id=org and submitted_by=auth.uid() for update;
  if not found then raise exception 'Claim unavailable.' using errcode='42501'; end if;
  if exists (select 1 from public.liquidation_expense_allocations where expense_id=claim)
    or exists (select 1 from public.expenses where id=claim and status<>'pending')
      and not exists (select 1 from public.reimbursement_claims where expense_id=claim) then
    raise exception 'This expense cannot become a reimbursement.';
  end if;
  insert into public.reimbursement_claims(expense_id) values(claim) on conflict do nothing;
  if found then
    insert into public.audit_logs(organization_id,actor_id,action,entity_id)
      values(org,auth.uid(),'reimbursement.submitted',claim);
  end if;
  return result;
end;
$$;

create function public.guard_reimbursement_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='approved' and exists(select 1 from public.reimbursement_claims where expense_id=old.id)
    and (new.status,new.amount_centavos,new.submitted_by,new.organization_id,new.budget_id,new.space_id,new.reporting_period_id,new.currency,new.incurred_date)
      is distinct from (old.status,old.amount_centavos,old.submitted_by,old.organization_id,old.budget_id,old.space_id,old.reporting_period_id,old.currency,old.incurred_date) then
    raise exception 'Approved reimbursement financial details are locked.';
  end if;
  return new;
end;
$$;
create trigger reimbursement_financial_lock before update on public.expenses
for each row execute function public.guard_reimbursement_review();

create function public.require_independent_reimbursement_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.entity_type='expense' and exists(
    select 1 from public.reimbursement_claims r join public.expenses e on e.id=r.expense_id
    where e.id=new.entity_id and e.organization_id=new.organization_id and e.submitted_by=new.officer_id
  ) then
    raise exception 'Another authorized officer must review this reimbursement.' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger reimbursement_independent_review before insert on public.approvals
for each row execute function public.require_independent_reimbursement_review();
revoke all on function public.require_independent_reimbursement_review() from public,anon,authenticated;

create function public.guard_reimbursement_liquidation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.expenses where id=new.expense_id for update;
  if exists(select 1 from public.reimbursement_claims where expense_id=new.expense_id) then
    raise exception 'A reimbursement cannot also be funded by a cash advance.';
  end if;
  return new;
end;
$$;
create trigger reimbursement_no_double_funding before insert or update on public.liquidation_expense_allocations
for each row execute function public.guard_reimbursement_liquidation();

create function public.list_reimbursements(org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform bantai_gateway.check_session();
  if not public.is_active_org_member(org,auth.uid()) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,'title',e.title,'amount',e.amount_centavos,'currency',e.currency,
      'status',e.status,'incurredDate',e.incurred_date,'claimant',e.submitted_by,
      'paymentId',p.id,'paidOn',p.paid_on,
      'claimantName',profile.display_name
    ) order by e.created_at desc),'[]'::jsonb)
    from public.reimbursement_claims r join public.expenses e on e.id=r.expense_id
    left join public.profiles profile on profile.id=e.submitted_by
    left join public.reimbursement_payments p on p.expense_id=e.id and p.voided_at is null
    where e.organization_id=org and (e.submitted_by=auth.uid() or public.can_read_private_financial_rows(org))
  );
end;
$$;

create function public.settle_reimbursement(org uuid, claim uuid, payment uuid,
  paid_on date, method text, reference text, void_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare expense public.expenses; existing public.reimbursement_payments; actor uuid:=auth.uid();
begin
  perform bantai_gateway.check_session();
  if not exists(select 1 from public.organization_members where organization_id=org
    and profile_id=actor and status='active' and role in ('owner','treasurer')) then
    raise exception 'Payment recording requires treasury access.' using errcode='42501';
  end if;
  select e.* into expense from public.expenses e join public.reimbursement_claims r on r.expense_id=e.id
    where e.id=claim and e.organization_id=org for update of e;
  if not found or expense.status<>'approved' then raise exception 'An approved claim is required.'; end if;
  select * into existing from public.reimbursement_payments where id=payment and expense_id=claim;
  if void_reason is not null then
    if not found or length(btrim(void_reason)) not between 3 and 500 then raise exception 'Provide a correction reason.'; end if;
    if existing.voided_at is not null then return; end if;
    update public.reimbursement_payments set voided_at=now(),voided_by=actor,
      void_reason=settle_reimbursement.void_reason where id=payment;
    insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
      values(org,actor,'reimbursement.payment_voided',claim,jsonb_build_object('paymentId',payment,'reason',void_reason));
    return;
  end if;
  if found and existing.voided_at is null and existing.paid_on=settle_reimbursement.paid_on
    and existing.method=settle_reimbursement.method and existing.reference is not distinct from nullif(btrim(reference),'') then return; end if;
  if payment is null or paid_on is null or paid_on<expense.incurred_date or paid_on>current_date
    or method is null or method not in ('cash','bank_transfer','e_wallet','other')
    or length(coalesce(reference,''))>150
    or (method<>'cash' and nullif(btrim(reference),'') is null) then
    raise exception 'Provide valid payment details.';
  end if;
  if exists(select 1 from public.reimbursement_payments where expense_id=claim and voided_at is null) then
    raise exception 'This claim is already paid.';
  end if;
  insert into public.reimbursement_payments(id,expense_id,amount_centavos,paid_on,method,reference,recorded_by)
    values(payment,claim,expense.amount_centavos,paid_on,method,nullif(btrim(reference),''),actor);
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,after_value)
    values(org,actor,'reimbursement.paid',claim,jsonb_build_object('paymentId',payment,'amountCentavos',expense.amount_centavos,'paidOn',paid_on));
end;
$$;

revoke all on function public.submit_reimbursement(uuid,uuid,jsonb,jsonb), public.list_reimbursements(uuid),
  public.settle_reimbursement(uuid,uuid,uuid,date,text,text,text) from public,anon;
grant execute on function public.submit_reimbursement(uuid,uuid,jsonb,jsonb), public.list_reimbursements(uuid),
  public.settle_reimbursement(uuid,uuid,uuid,date,text,text,text) to authenticated;
revoke all on function public.guard_reimbursement_review(),public.guard_reimbursement_liquidation() from public,anon,authenticated;
create or replace function public.workspace_financial_summary(org uuid, space uuid default null::uuid, period uuid default null::uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path = ''
as $function$
  select jsonb_build_object(
    'total_collected_centavos', c.total,
    'total_budget_allocated_centavos', b.total,
    'total_expenses_centavos', e.total-a.overlap+a.spent,
    'directly_paid_expenses_centavos', e.total-a.overlap-r.unpaid,
    'outstanding_reimbursements_centavos', r.unpaid,
    'advances_released_centavos', a.released,
    'advance_cash_returns_centavos', a.returned,
    'approved_liquidation_spending_centavos', a.spent,
    'unresolved_discrepancies_centavos', a.discrepancy,
    'written_off_discrepancies_centavos', a.loss,
    'provisional', a.provisional,
    'budget_assigned_expenses_centavos', e.total-a.overlap+a.spent-e.unallocated-a.unallocated,
    'unallocated_expenses_centavos', e.unallocated+a.unallocated,
    'total_outstanding_advances_centavos', a.unsettled,
    'reserve_balance_centavos', c.total-e.total+a.overlap-a.released+a.returned+r.unpaid
  )
  from (
    select coalesce(sum(t.total_collected_centavos::numeric),0) total
    from public.collection_financial_totals(org,null) t join public.collections c on c.id=t.collection_id
    where (space is null or c.space_id=space) and (period is null or c.reporting_period_id=period)
  ) c
  cross join (
    select coalesce(sum(allocated_amount_centavos),0) total from public.budgets
    where organization_id=org and status='active'
      and (space is null or space_id=space) and (period is null or reporting_period_id=period)
  ) b
  cross join (
    select coalesce(sum(amount_centavos),0) total,
      coalesce(sum(amount_centavos) filter(where budget_id is null),0) unallocated
    from public.expenses where organization_id=org and status='approved'
      and (space is null or space_id=space) and (period is null or reporting_period_id=period)
  ) e
  cross join (
    select coalesce(sum(overlap),0) overlap,coalesce(sum(spent),0) spent,
      coalesce(sum(released),0) released,coalesce(sum(returned),0) returned,
      coalesce(sum(discrepancy),0) discrepancy,coalesce(sum(loss),0) loss,
      coalesce(sum(unsettled),0) unsettled,coalesce(bool_or(provisional),false) provisional,
      coalesce(sum(case when budget_id is null then spent-attributed_from_unallocated else 0 end-unallocated_overlap),0) unallocated
    from public.advance_accounting where organization_id=org
      and (space is null or space_id=space) and (period is null or reporting_period_id=period)
  ) a
  cross join (
    select coalesce(sum(e.amount_centavos),0) unpaid
    from public.reimbursement_claims claim join public.expenses e on e.id=claim.expense_id
    where e.organization_id=org and e.status='approved'
      and (space is null or e.space_id=space) and (period is null or e.reporting_period_id=period)
      and not exists(select 1 from public.reimbursement_payments p where p.expense_id=e.id and p.voided_at is null)
  ) r
  where public.is_active_org_member(org,auth.uid())
$function$;
commit;
