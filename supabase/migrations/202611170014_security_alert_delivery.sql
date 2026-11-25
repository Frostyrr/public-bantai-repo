begin;

-- Queue only authoritative transitions. The existing general notification worker
-- can continue to treat its own types separately.
create function bantai_private.enqueue_security_alert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.actor_id is not null then
    insert into public.notification_delivery_queue
      (recipient_user_id, channel, notification_type, title, message, metadata)
    values (new.actor_id, 'email', 'security.auth_alert',
      case when new.action = 'PASSWORD_CHANGED' then 'Your Bantai password was changed'
        else 'Failed sign-in attempts on your Bantai account' end,
      new.action,
      jsonb_build_object('occurred_at', new.occurred_at, 'failures', new.metadata->'failures'));
  end if;
  return new;
end;
$$;

create trigger enqueue_security_alert after insert on public.security_events
for each row when (new.action in ('LOCKOUT_TIER_1','LOCKOUT_TIER_2','LOCKOUT_TIER_3','PASSWORD_CHANGED'))
execute function bantai_private.enqueue_security_alert();

-- Auth owns the password write, including the native recovery API. Never copy
-- the password hash into an event, queue row, or custom password store.
create function bantai_private.record_password_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists(select 1 from public.profiles where id = new.id) then
    perform public.record_authenticated_security_event(
      new.id, 'auth', 'low', 'PASSWORD_CHANGED', 'flagged', null,
      null, null, null, '{}'::jsonb, 'auth'
    );
  end if;
  return new;
end;
$$;
create trigger monitor_password_changed after update of encrypted_password on auth.users
for each row when (old.encrypted_password is not null and old.encrypted_password <> ''
  and new.encrypted_password is not null and new.encrypted_password <> ''
  and old.encrypted_password is distinct from new.encrypted_password)
execute function bantai_private.record_password_changed();

create function public.bantai_claim_security_alerts()
returns table(id uuid, attempt integer, actor uuid, email text, subject text, metadata jsonb)
language sql volatile security definer set search_path = ''
as $$
  with exhausted as (
    update public.notification_delivery_queue q set status = 'failed', last_error = 'delivery_unconfirmed'
    where q.notification_type = 'security.auth_alert' and q.status = 'processing'
      and q.scheduled_for <= now() and q.attempts >= 5
  ), eligible as (
    select q.id from public.notification_delivery_queue q
    where q.notification_type = 'security.auth_alert' and q.status in ('pending','processing')
      and q.scheduled_for <= now() and q.attempts < 5
    order by q.scheduled_for, q.id limit 10 for update skip locked
  ), claimed as (
    update public.notification_delivery_queue q
    set status = 'processing', attempts = q.attempts + 1, scheduled_for = now() + interval '2 minutes'
    from eligible where q.id = eligible.id
    returning q.*
  )
  select c.id, c.attempts, c.recipient_user_id,
    case when u.email_confirmed_at is not null then u.email end, c.title, c.metadata
  from claimed c join auth.users u on u.id = c.recipient_user_id
$$;

create function public.bantai_finish_security_alert(p_id uuid, p_attempt integer, p_result text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid;
begin
  if p_result is null or p_result not in ('sent','retry','skipped') then return false; end if;
  update public.notification_delivery_queue q
  set status = case when p_result = 'retry' then
      case when q.attempts >= 5 then 'failed' else 'pending' end
      else p_result end,
    scheduled_for = now() + make_interval(mins => q.attempts * 5),
    processed_at = now(),
    last_error = case when p_result = 'retry' then 'delivery_unconfirmed' end
  where q.id = p_id and q.notification_type = 'security.auth_alert'
    and q.status = 'processing' and q.attempts = p_attempt
  returning q.recipient_user_id into v_actor;
  if not found then return false; end if;
  if p_result = 'sent' then
    perform public.record_authenticated_security_event(
      v_actor, 'auth', 'low', 'ALERT_EMAIL_SENT', 'flagged', null, null, null, null,
      jsonb_build_object('delivery_id', p_id), 'infrastructure'
    );
  end if;
  return true;
end;
$$;

revoke all on function bantai_private.enqueue_security_alert(), bantai_private.record_password_changed(),
  public.bantai_claim_security_alerts(), public.bantai_finish_security_alert(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.bantai_claim_security_alerts(), public.bantai_finish_security_alert(uuid, integer, text)
  to service_role;

commit;
