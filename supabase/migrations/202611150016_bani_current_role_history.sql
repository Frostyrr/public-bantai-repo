begin;

-- Legacy conversations have no trustworthy record of the permission used to
-- generate their content. Retain them in place and fail closed on retrieval.
alter table public.ai_conversations add column access_role text;

create function public.guard_bani_conversation_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select m.role into new.access_role from public.organization_members m
      where m.organization_id=new.organization_id and m.profile_id=new.created_by and m.status='active';
  elsif (old.organization_id, old.created_by, old.access_role)
      is distinct from (new.organization_id, new.created_by, new.access_role) then
    raise exception 'Conversation authorization cannot be changed.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_bani_conversation_scope() from public, anon, authenticated;
create trigger bani_conversation_scope before insert or update on public.ai_conversations
  for each row execute function public.guard_bani_conversation_scope();

create policy bani_current_role_scope on public.ai_conversations
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id=ai_conversations.organization_id and m.profile_id=auth.uid()
      and m.status='active' and m.role=ai_conversations.access_role
  ))
  with check (exists (
    select 1 from public.organization_members m
    where m.organization_id=ai_conversations.organization_id and m.profile_id=auth.uid()
      and m.status='active' and m.role=ai_conversations.access_role
  ));

commit;
