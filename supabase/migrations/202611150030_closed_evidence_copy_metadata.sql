begin;
create or replace function public.guard_closed_indirect_record()
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
  if tg_table_name = 'expense_evidence' and tg_op = 'UPDATE' then
    if old.storage_verified_at is null and new.storage_verified_at is not null
      and (to_jsonb(old) - array['storage_path','storage_sha256','storage_verified_at'])
        = (to_jsonb(new) - array['storage_path','storage_sha256','storage_verified_at'])
      and new.storage_path = source::text||'/'||old.expense_id::text||'/'||old.id::text
      and new.storage_sha256 = encode(sha256(old.content),'hex') then
      return new;
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
commit;
