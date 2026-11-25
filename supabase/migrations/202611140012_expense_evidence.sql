begin;
create table public.expense_evidence (
 id uuid primary key default gen_random_uuid(),
 expense_id uuid not null references public.expenses(id) on delete cascade,
 filename text not null check(char_length(filename) between 1 and 150),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 content bytea not null check(octet_length(content) between 12 and 1048576)
);
create index expense_evidence_expense on public.expense_evidence(expense_id);
alter table public.expense_evidence enable row level security;
revoke all on public.expense_evidence from public,anon,authenticated;

create function public.submit_expense_with_evidence(org uuid, request_id uuid, draft jsonb, files jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; file jsonb; bytes bytea; mime text; expense uuid;
begin
 if jsonb_typeof(files) is distinct from 'array' or jsonb_array_length(files)>3 or octet_length(files::text)>4200000 then
  raise exception 'Attach up to three files of 1 MB each.' using errcode='23514';
 end if;
 result:=public.submit_reviewed_expense(org,request_id,draft||jsonb_build_object('evidenceDigest',md5(files::text)));
 expense:=(result->>'id')::uuid;
 if exists(select 1 from public.expense_evidence where expense_id=expense) then return result; end if;
 for file in select * from jsonb_array_elements(files) loop
  bytes:=decode(file->>'data','base64');
  mime:=file->>'mime';
  if not coalesce(case mime
   when 'image/jpeg' then substring(bytes from 1 for 3)=decode('ffd8ff','hex') and substring(bytes from octet_length(bytes)-1)=decode('ffd9','hex')
   when 'image/png' then substring(bytes from 1 for 8)=decode('89504e470d0a1a0a','hex') and substring(bytes from octet_length(bytes)-7)=decode('49454e44ae426082','hex')
   when 'image/webp' then substring(bytes from 1 for 4)=decode('52494646','hex') and substring(bytes from 9 for 4)=decode('57454250','hex')
   when 'application/pdf' then substring(bytes from 1 for 5)=decode('255044462d','hex') and position(decode('2525454f46','hex') in substring(bytes from greatest(1,octet_length(bytes)-1024)))>0
   else false end,false) then raise exception 'Unsupported receipt file content.' using errcode='23514'; end if;
  insert into public.expense_evidence(expense_id,filename,mime,content) values(expense,file->>'name',mime,bytes);
 end loop;
 return result;
end;
$$;

create function public.read_expense_evidence(org uuid, expense uuid, attachment uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.expenses e join public.organization_members m on m.organization_id=e.organization_id
  where e.id=expense and e.organization_id=org and m.profile_id=auth.uid() and m.status='active'
  and (e.submitted_by=auth.uid() or m.role in ('owner','organization_admin','treasurer','auditor'))) then
  raise exception 'Expense evidence is unavailable.' using errcode='42501';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.filename,'mime',a.mime)
  || case when attachment is null then '{}'::jsonb else jsonb_build_object('data',encode(a.content,'base64')) end order by a.id),'[]')
  from public.expense_evidence a where a.expense_id=expense and (attachment is null or a.id=attachment));
end;
$$;
revoke all on function public.submit_expense_with_evidence(uuid,uuid,jsonb,jsonb),public.read_expense_evidence(uuid,uuid,uuid) from public,anon;
grant execute on function public.submit_expense_with_evidence(uuid,uuid,jsonb,jsonb),public.read_expense_evidence(uuid,uuid,uuid) to authenticated;
commit;
