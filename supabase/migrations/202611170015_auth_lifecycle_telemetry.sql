begin;

create function bantai_private.record_auth_lifecycle()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists(select 1 from public.profiles where id = new.id) then return new; end if;
  if tg_op = 'INSERT' then
    perform public.record_authenticated_security_event(
      new.id, 'auth', 'low', 'REGISTERED', 'flagged', null,
      null, null, null, '{}'::jsonb, 'auth'
    );
    if new.email_confirmed_at is not null then
      perform public.record_authenticated_security_event(
        new.id, 'auth', 'low', 'ACCOUNT_VERIFIED', 'flagged', null,
        null, null, null, '{}'::jsonb, 'auth'
      );
    end if;
    return new;
  end if;
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.record_authenticated_security_event(
      new.id, 'auth', 'low', 'ACCOUNT_VERIFIED', 'flagged', null,
      null, null, null, '{}'::jsonb, 'auth'
    );
  end if;
  if new.recovery_sent_at is not null and new.recovery_sent_at is distinct from old.recovery_sent_at then
    perform public.record_authenticated_security_event(
      new.id, 'auth', 'low', 'RESET_REQUESTED', 'flagged', null,
      null, null, null, '{}'::jsonb, 'auth'
    );
  end if;
  return new;
end;
$$;
revoke all on function bantai_private.record_auth_lifecycle() from public, anon, authenticated;

-- PostgreSQL runs same-kind triggers alphabetically. Run after auth_user_profile.
create trigger monitor_auth_registration after insert on auth.users
for each row execute function bantai_private.record_auth_lifecycle();
create trigger monitor_auth_lifecycle after update of email_confirmed_at, recovery_sent_at on auth.users
for each row execute function bantai_private.record_auth_lifecycle();

commit;
