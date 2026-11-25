begin;
create table public.cash_advance_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 requester uuid not null references public.profiles(id),
 title text not null check (char_length(trim(title)) between 2 and 150),
 purpose text not null check (char_length(trim(purpose)) between 1 and 1000),
 amount_centavos bigint not null check (amount_centavos between 1 and 9007199254740991),
 status text not null default 'pending' check (status in ('pending','approved','rejected','released')),
 revision integer not null default 1,
 advance_id uuid unique references public.cash_advances(id),
 created_at timestamptz not null default now()
);
alter table public.cash_advance_requests enable row level security;
revoke all on public.cash_advance_requests from public, anon, authenticated;
grant select on public.cash_advance_requests to authenticated;
create policy cash_request_read on public.cash_advance_requests for select to authenticated using (
 exists (select 1 from public.organization_members m where m.organization_id=cash_advance_requests.organization_id
 and m.profile_id=auth.uid() and m.status='active'
 and (cash_advance_requests.requester=auth.uid() or m.role in ('owner','organization_admin','treasurer','auditor')))
);
create trigger closed_organization_guard before insert or update or delete on public.cash_advance_requests
for each row execute function public.guard_closed_organization();
create trigger cash_advance_requests_audit after insert or update on public.cash_advance_requests
for each row execute function public.audit_record_change();

create function public.manage_cash_advance_request(org uuid, request_id uuid, action text, draft jsonb)
returns public.cash_advance_requests language plpgsql security definer set search_path='' as $$
declare
 actor public.organization_members;
 r public.cash_advance_requests;
 released jsonb;
 recipient uuid;
begin
 select * into actor from public.organization_members where organization_id=org and profile_id=auth.uid() and status='active';
 if not found then raise exception 'Organization access is required.' using errcode='42501'; end if;
 if action='create' and actor.role<>'auditor' then
   insert into public.cash_advance_requests(organization_id, requester, title, purpose, amount_centavos)
   values(org, actor.profile_id, trim(draft->>'title'), trim(draft->>'purpose'), (draft->>'amountCentavos')::bigint)
   returning * into r;
   return r;
 end if;
 select * into r from public.cash_advance_requests where id=request_id and organization_id=org for update;
 if not found then raise exception 'Request not found.' using errcode='P0002'; end if;
 if r.revision is distinct from (draft->>'revision')::integer then
   raise exception 'The request changed. Refresh and try again.' using errcode='40001';
 end if;
 if action='revise' and r.requester=actor.profile_id and r.status in ('pending','rejected') then
   update public.cash_advance_requests set title=trim(draft->>'title'), purpose=trim(draft->>'purpose'),
     amount_centavos=(draft->>'amountCentavos')::bigint, status='pending', revision=revision+1 where id=r.id returning * into r;
 elsif action in ('approve','reject') and r.status='pending' and actor.role in ('owner','organization_admin') and actor.profile_id<>r.requester then
   update public.cash_advance_requests set status=case when action='approve' then 'approved' else 'rejected' end,
     revision=revision+1 where id=r.id returning * into r;
 elsif action='release' and r.status='approved' and actor.role in ('owner','organization_admin','treasurer') then
   select id into recipient from public.organization_members where organization_id=org and profile_id=r.requester and status='active';
   if not found then raise exception 'The recipient must be an active workspace member.' using errcode='23514'; end if;
   released := public.create_cash_advance(org,recipient,r.title,r.purpose,r.amount_centavos,draft->>'method',draft->>'reference');
   update public.cash_advance_requests set status='released', advance_id=(released->>'id')::uuid,
     revision=revision+1 where id=r.id returning * into r;
 else
   raise exception 'This action is unavailable for the request.' using errcode='42501';
 end if;
 return r;
end;
$$;
revoke all on function public.manage_cash_advance_request(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.manage_cash_advance_request(uuid,uuid,text,jsonb) to authenticated;
commit;
