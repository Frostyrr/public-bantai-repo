begin;
create or replace function public.read_expense_evidence(org uuid, expense uuid, attachment uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.expenses e join public.organization_members m on m.organization_id=e.organization_id
  where e.id=expense and e.organization_id=org and m.profile_id=auth.uid() and m.status='active'
  and (e.submitted_by=auth.uid() or m.role in ('owner','treasurer'))) then
  raise exception 'Expense evidence is unavailable.' using errcode='42501';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.filename,'mime',a.mime)
  || case when attachment is null then '{}'::jsonb else jsonb_build_object('data',encode(a.content,'base64')) end order by a.id),'[]')
  from public.expense_evidence a where a.expense_id=expense and (attachment is null or a.id=attachment));
end;
$$;
commit;
