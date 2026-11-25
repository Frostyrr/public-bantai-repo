begin;

create or replace function public.guard_closed_organization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source uuid;
  destination uuid;
  parent record;
begin
  if tg_op <> 'INSERT' then source := old.organization_id; end if;
  if tg_op <> 'DELETE' then destination := new.organization_id; end if;
  for parent in select id, closed_at from public.organizations
    where id in (source, destination) order by id for share
  loop
    if parent.closed_at is not null then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Serialize new assignments with updates to the space's status.
create function public.guard_space_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.space_id is null then return new; end if;
  if tg_op = 'UPDATE' and (new.space_id, new.organization_id)
    is not distinct from (old.space_id, old.organization_id) then return new; end if;
  perform 1 from public.spaces
    where id = new.space_id and organization_id = new.organization_id and status = 'active'
    for share;
  if not found then
    raise exception 'Choose an active space in this organization.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_space_assignment() from public, anon, authenticated;

do $$
declare target text;
begin
  foreach target in array array['collections','budgets','expenses','cash_advances'] loop
    execute format('create trigger active_space_assignment before insert or update of space_id, organization_id on public.%I
      for each row execute function public.guard_space_assignment()', target);
  end loop;

  foreach target in array array[
    'approvals','budget_amendments','collection_assessment_failures','collection_assessment_requests',
    'collection_scope_groups','collection_scope_members','directory_import_batches','expense_submission_requests',
    'liquidation_expense_allocations','liquidation_reconciliations','liquidation_resolution_entries',
    'organization_invitations','receipt_counters'
  ] loop
    execute format('create trigger closed_organization_guard before insert or update or delete on public.%I
      for each row execute function public.guard_closed_organization()', target);
  end loop;
end;
$$;

create function public.guard_closed_organization_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.closed_at is not null then
    if tg_op = 'DELETE' then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
    -- Platform suspension metadata has a separate authorization and audit path.
    if (to_jsonb(new) - array['suspended_at','suspended_by','suspension_reason'])
      is distinct from (to_jsonb(old) - array['suspended_at','suspended_by','suspension_reason']) then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_closed_organization_record() from public, anon, authenticated;
create trigger closed_organization_record before update or delete on public.organizations
  for each row execute function public.guard_closed_organization_record();

create function public.guard_closed_indirect_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source uuid;
  destination uuid;
  parent record;
begin
  if tg_table_name = 'ai_messages' then
    if tg_op <> 'INSERT' then
      select organization_id into source from public.ai_conversations where id=old.conversation_id;
    end if;
    if tg_op <> 'DELETE' then
      select organization_id into destination from public.ai_conversations where id=new.conversation_id;
    end if;
  else
    if tg_op <> 'INSERT' then
      select organization_id into source from public.expenses where id=old.expense_id;
    end if;
    if tg_op <> 'DELETE' then
      select organization_id into destination from public.expenses where id=new.expense_id;
    end if;
  end if;
  for parent in select closed_at from public.organizations
    where id in (source, destination) order by id for share
  loop
    if parent.closed_at is not null then
      raise exception 'This organization is closed.' using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_closed_indirect_record() from public, anon, authenticated;
create trigger closed_conversation_message before insert or update or delete on public.ai_messages
  for each row execute function public.guard_closed_indirect_record();
create trigger closed_expense_evidence before insert or update or delete on public.expense_evidence
  for each row execute function public.guard_closed_indirect_record();

commit;
