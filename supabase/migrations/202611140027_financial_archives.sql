begin;
alter table public.budgets add column archived_at timestamptz;
alter table public.expenses add column archived_at timestamptz;

create function public.set_financial_archive(org uuid, record_id uuid, kind text, archive boolean)
returns void language plpgsql security definer set search_path='' as $$
declare current_status text; table_name text;
begin
 if archive is null or not exists(select 1 from public.organization_members
 where organization_id=org and profile_id=auth.uid() and status='active'
 and role in ('owner','organization_admin','treasurer')) then
  raise exception 'You cannot archive or restore this record.' using errcode='42501';
 end if;
 table_name := case kind when 'budget' then 'budgets' when 'expense' then 'expenses' end;
 if table_name is null then raise exception 'Invalid record type.' using errcode='23514'; end if;
 execute format('select status from public.%I where id=$1 and organization_id=$2 for update',table_name)
 into current_status using record_id,org;
 if current_status is null then raise exception 'Record not found.' using errcode='P0002'; end if;
 if archive and ((kind='expense' and current_status in ('pending','verified'))
 or (kind='budget' and (current_status='pending_approval' or exists(select 1 from public.budget_amendments where budget_id=record_id and status='pending')))) then
  raise exception 'Complete the pending review before archiving.' using errcode='23514';
 end if;
 execute format('update public.%I set archived_at=case when $3 then now() else null end where id=$1 and organization_id=$2 and (archived_at is not null) <> $3',table_name)
 using record_id,org,archive;
end;
$$;
revoke all on function public.set_financial_archive(uuid,uuid,text,boolean) from public,anon;
grant execute on function public.set_financial_archive(uuid,uuid,text,boolean) to authenticated;

create function public.protect_archived_financial_record() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.archived_at is not null then
  if tg_op='DELETE' then raise exception 'Restore this record before deleting it.' using errcode='23514'; end if;
  if (to_jsonb(old)-'archived_at') is distinct from (to_jsonb(new)-'archived_at') then
   raise exception 'Restore this record before editing it.' using errcode='23514';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger protect_archived_budget before update or delete on public.budgets
for each row execute function public.protect_archived_financial_record();
create trigger protect_archived_expense before update or delete on public.expenses
for each row execute function public.protect_archived_financial_record();

create function public.delete_collection(p_org_id uuid,p_collection_id uuid,confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare collection_title text;
begin
 if not exists(select 1 from public.organization_members where organization_id=p_org_id and profile_id=auth.uid()
 and status='active' and role in ('owner','organization_admin','treasurer')) then
  raise exception 'You cannot delete this collection.' using errcode='42501';
 end if;
 select title into collection_title from public.collections where id=p_collection_id and organization_id=p_org_id for update;
 if not found or confirmation is distinct from collection_title then
  raise exception 'Enter the exact collection name.' using errcode='23514';
 end if;
 return public.delete_collection(p_org_id,p_collection_id);
end;
$$;
revoke execute on function public.delete_collection(uuid,uuid) from public,anon,authenticated;
revoke all on function public.delete_collection(uuid,uuid,text) from public,anon;
grant execute on function public.delete_collection(uuid,uuid,text) to authenticated;
create function public.guard_archived_budget_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare archived timestamptz;
begin
 if new.budget_id is null then return new; end if;
 if tg_op='UPDATE' and new.budget_id is not distinct from old.budget_id then return new; end if;
 select archived_at into archived from public.budgets where id=new.budget_id for share;
 if archived is not null then
  raise exception 'Choose a budget that is not archived.' using errcode='23514';
 end if;
 return new;
end;
$$;
create trigger archived_budget_expense_assignment before insert or update of budget_id on public.expenses
for each row execute function public.guard_archived_budget_assignment();
create trigger archived_budget_advance_assignment before insert or update of budget_id on public.cash_advances
for each row execute function public.guard_archived_budget_assignment();
create function public.guard_archived_budget_amendment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.budgets where id=new.budget_id and archived_at is not null) then
  raise exception 'Restore this budget before proposing or deciding amendments.' using errcode='23514';
 end if;
 return new;
end;
$$;
create trigger archived_budget_amendment before insert or update on public.budget_amendments
for each row execute function public.guard_archived_budget_amendment();
commit;
