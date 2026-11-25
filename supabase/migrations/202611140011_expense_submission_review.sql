begin;
create table public.expense_submission_requests (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid not null,
 request_id uuid not null,
 payload jsonb not null,
 result jsonb not null,
 primary key(organization_id,actor_id,request_id)
);
alter table public.expense_submission_requests enable row level security;
revoke all on public.expense_submission_requests from public,anon,authenticated;

create function public.submit_reviewed_expense(org uuid, request_id uuid, draft jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior public.expense_submission_requests; result jsonb; linked public.budgets;
begin
 if actor is null or not public.is_active_org_member(org,actor) then
  raise exception 'Expense submission is unavailable.' using errcode='42501';
 end if;
 if request_id is null then raise exception 'A submission request ID is required.' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||actor::text||request_id::text,0));
 select * into prior from public.expense_submission_requests r
 where r.organization_id=org and r.actor_id=actor and r.request_id=submit_reviewed_expense.request_id;
 if found then
  if prior.payload<>draft then raise exception 'This submission was already used for different expense details.' using errcode='23514'; end if;
  return prior.result;
 end if;
 if draft->>'budgetId' is not null then
  select * into linked from public.budgets where id=(draft->>'budgetId')::uuid and organization_id=org for share;
  if not found or linked.status<>'active'
   or (linked.space_id is not null and draft->>'spaceId' is not null and linked.space_id<>(draft->>'spaceId')::uuid)
   or (linked.reporting_period_id is not null and draft->>'periodId' is not null and linked.reporting_period_id<>(draft->>'periodId')::uuid)
  then raise exception 'Choose an active budget for this space and reporting period.' using errcode='23514'; end if;
 end if;
 if (draft->>'spaceId' is not null and not exists(select 1 from public.spaces where organization_id=org and id=(draft->>'spaceId')::uuid))
 or (draft->>'periodId' is not null and not exists(select 1 from public.reporting_periods where organization_id=org and id=(draft->>'periodId')::uuid))
 then raise exception 'Choose a space and reporting period from this organization.' using errcode='23514'; end if;
 result:=public.submit_expense(org,draft->>'title',(draft->>'amountCentavos')::bigint,draft->>'category',
 (draft->>'incurredDate')::date,draft->>'description',(draft->>'budgetId')::uuid,(draft->>'spaceId')::uuid,
 (draft->>'periodId')::uuid,draft->>'receiptUrl',draft->>'vendorName');
 insert into public.expense_submission_requests values(org,actor,request_id,draft,result);
 return result;
end;
$$;
revoke all on function public.submit_reviewed_expense(uuid,uuid,jsonb) from public,anon;
grant execute on function public.submit_reviewed_expense(uuid,uuid,jsonb) to authenticated;
commit;
