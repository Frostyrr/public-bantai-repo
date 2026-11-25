begin;
create or replace function public.manage_cash_advance_request(org uuid, request_id uuid, action text, draft jsonb)
returns public.cash_advance_requests language plpgsql security definer set search_path='' as $$
declare
 actor public.organization_members;
 r public.cash_advance_requests;
 released jsonb;
 recipient uuid;
 release_period uuid;
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
   release_period := (draft->>'periodId')::uuid;
   if release_period is not null then
     perform 1 from public.reporting_periods where id=release_period and organization_id=org for share;
     if not found then
       raise exception 'Choose a reporting period in this organization.' using errcode='23514';
     end if;
   end if;
   released := public.create_cash_advance(org,recipient,r.title,r.purpose,r.amount_centavos,draft->>'method',draft->>'reference',null,(draft->>'spaceId')::uuid,release_period);
   update public.cash_advance_requests set status='released', advance_id=(released->>'id')::uuid,
     revision=revision+1 where id=r.id returning * into r;
 else
   raise exception 'This action is unavailable for the request.' using errcode='42501';
 end if;
 return r;
end;
$$;
commit;
