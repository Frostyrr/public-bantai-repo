begin;

-- Supabase Auth sends the native password-change notice. Preserve the event.
drop trigger enqueue_security_alert on public.security_events;
create trigger enqueue_security_alert after insert on public.security_events
for each row when (new.action in ('LOCKOUT_TIER_1','LOCKOUT_TIER_2','LOCKOUT_TIER_3'))
execute function bantai_private.enqueue_security_alert();

update public.notification_delivery_queue
set status = 'skipped', last_error = 'native_auth_notification', processed_at = now()
where notification_type = 'security.auth_alert' and message = 'PASSWORD_CHANGED'
  and status = 'pending';

create or replace function public.bantai_claim_security_alerts()
returns table(id uuid, attempt integer, actor uuid, email text, subject text, metadata jsonb)
language sql volatile security definer set search_path = ''
as $$
  with exhausted as (
    update public.notification_delivery_queue q set status = 'failed', last_error = 'delivery_unconfirmed'
    where q.notification_type = 'security.auth_alert' and q.status = 'processing'
      and q.scheduled_for <= now()
  ), eligible as (
    select q.id from public.notification_delivery_queue q
    where q.notification_type = 'security.auth_alert' and q.status = 'pending'
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

create or replace function public.bantai_finish_security_alert(p_id uuid, p_attempt integer, p_result text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid;
begin
  if p_result is null or p_result not in ('sent','retry','skipped','failed','unconfirmed') then return false; end if;
  update public.notification_delivery_queue q
  set status = case when p_result = 'retry' then
      case when q.attempts >= 5 then 'failed' else 'pending' end
      when p_result = 'unconfirmed' then 'failed' else p_result end,
    scheduled_for = now() + make_interval(mins => q.attempts * 5),
    processed_at = now(),
    last_error = case p_result when 'retry' then 'provider_rate_limited'
      when 'failed' then 'provider_rejected' when 'unconfirmed' then 'delivery_unconfirmed' end
  where q.id = p_id and q.notification_type = 'security.auth_alert'
    and q.status = 'processing' and q.attempts = p_attempt
  returning q.recipient_user_id into v_actor;
  if not found then return false; end if;
  if p_result = 'sent' then
    perform public.record_authenticated_security_event(
      v_actor, 'auth', 'low', 'ALERT_EMAIL_SENT', 'flagged', null, null, null, null,
      jsonb_build_object('delivery_id', p_id, 'delivery_state', 'provider_accepted'), 'infrastructure'
    );
  end if;
  return true;
end;
$$;

commit;
