begin;

create function public.audit_directory_field_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(organization_id, actor_id, action, entity_id, before_value, after_value)
  values (new.organization_id, auth.uid(), 'directory_field_definitions.' || lower(tg_op), new.organization_id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;
revoke all on function public.audit_directory_field_change() from public, anon, authenticated;
create trigger directory_field_audit
  after insert or update on public.directory_field_definitions
  for each row execute function public.audit_directory_field_change();
create trigger directory_group_audit
  after insert on public.directory_groups
  for each row execute function public.audit_record_change();

commit;
