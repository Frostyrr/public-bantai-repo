-- Migration: 202611140033_notifications_phase3_4.sql
-- Description: Phase 3 & 4 Notification Infrastructure:
--   - Targeted organization invitations (organization_invitations)
--   - Atomic triggers for cash advances, payments, obligations, and role updates
--   - Preference-aware in-app filtering (in_app_approvals / in_app_payments / in_app_invites)
--   - Scheduled due payment reminders (emit_due_payment_reminders)
--   - Transactional delivery outbox (notification_delivery_queue) for email/push workers
--   - Safe Supabase Realtime publication registration

begin;

-- 1. Enable Realtime for public.notifications when supabase_realtime exists (skipped in PGlite)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end if;
end;
$$;

-- 2. Helper: resolve whether a user accepts in-app notifications for a given event type
create or replace function public.should_notify_in_app(
  p_user_id uuid,
  p_type text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefs jsonb;
  v_pref_key text;
begin
  if p_user_id is null then
    return false;
  end if;

  if p_type like 'expense.%' or p_type like 'cash_advance.%' then
    v_pref_key := 'in_app_approvals';
  elsif p_type like 'payment.%' or p_type like 'collection.%' then
    v_pref_key := 'in_app_payments';
  elsif p_type like 'organization.invitation%' or p_type like 'member.%' then
    v_pref_key := 'in_app_invites';
  else
    return true;
  end if;

  select notifications into v_prefs
  from public.user_preferences
  where user_id = p_user_id;

  if v_prefs is null or not (v_prefs ? v_pref_key) then
    return true;
  end if;

  return coalesce((v_prefs ->> v_pref_key)::boolean, true);
end;
$$;

revoke all on function public.should_notify_in_app(uuid, text) from public, anon, authenticated;

-- 3. Helper: resolve email preference key for a notification type
create or replace function public.email_pref_key_for_type(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type like 'expense.%' or p_type like 'cash_advance.%' then 'email_approvals'
    when p_type like 'payment.%' or p_type like 'collection.%' then 'email_payments'
    when p_type like 'organization.invitation%' or p_type like 'member.%' then 'email_invites'
    else null
  end;
$$;

-- 4. Transactional delivery outbox for Phase 4 multi-channel (email/push) workers
create table if not exists public.notification_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email', 'push')),
  notification_type text not null,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text,
  scheduled_for timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notif_delivery_pending
  on public.notification_delivery_queue(status, scheduled_for)
  where status = 'pending';

create index if not exists idx_notif_delivery_recipient
  on public.notification_delivery_queue(recipient_user_id, created_at desc);

alter table public.notification_delivery_queue enable row level security;
revoke all on public.notification_delivery_queue from public, anon, authenticated;

-- Enqueue email delivery automatically when a notification is created and user has email pref enabled
create or replace function public.enqueue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pref_key text;
  v_prefs jsonb;
  v_email_enabled boolean := true;
begin
  v_pref_key := public.email_pref_key_for_type(new.type);
  if v_pref_key is null then
    return new;
  end if;

  select notifications into v_prefs
  from public.user_preferences
  where user_id = new.recipient_user_id;

  if v_prefs is not null and (v_prefs ? v_pref_key) then
    v_email_enabled := coalesce((v_prefs ->> v_pref_key)::boolean, true);
  end if;

  if v_email_enabled then
    insert into public.notification_delivery_queue (
      notification_id,
      recipient_user_id,
      channel,
      notification_type,
      title,
      message,
      metadata
    ) values (
      new.id,
      new.recipient_user_id,
      'email',
      new.type,
      new.title,
      new.message,
      new.metadata
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_enqueue_delivery on public.notifications;
create trigger notifications_enqueue_delivery
  after insert on public.notifications
  for each row
  execute function public.enqueue_notification_delivery();

-- 5. Targeted organization invitations table
create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invited_user_id uuid references auth.users(id) on delete cascade,
  invited_email text not null check (char_length(trim(invited_email)) between 3 and 320),
  role text not null default 'member' check (role in ('organization_admin', 'treasurer', 'auditor', 'member')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists idx_org_invitations_org
  on public.organization_invitations(organization_id, status, created_at desc);

create index if not exists idx_org_invitations_user
  on public.organization_invitations(invited_user_id, status)
  where invited_user_id is not null;

create unique index if not exists uidx_org_invitations_pending_email
  on public.organization_invitations(organization_id, lower(invited_email))
  where status = 'pending';

alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from public, anon, authenticated;
grant select on public.organization_invitations to authenticated;

create policy org_invitations_read on public.organization_invitations
  for select to authenticated
  using (
    invited_user_id = (select auth.uid())
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_invitations.organization_id
        and m.profile_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner', 'organization_admin')
    )
  );

-- RPC: create targeted organization invitation and notify existing user
create or replace function public.create_organization_invitation(
  p_org_id uuid,
  p_invited_email text,
  p_role text default 'member'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_invited_email, '')));
  v_org_name text;
  v_target_user_id uuid;
  v_invitation public.organization_invitations;
  v_dedupe_key text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'A valid email address is required.' using errcode = '22023';
  end if;

  if p_role not in ('organization_admin', 'treasurer', 'auditor', 'member') then
    raise exception 'Invalid invitation role.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org_id
      and m.profile_id = v_actor_id
      and m.status = 'active'
      and m.role in ('owner', 'organization_admin')
  ) then
    raise exception 'Only workspace owners or admins can invite members.' using errcode = '42501';
  end if;

  select name into v_org_name from public.organizations where id = p_org_id;
  if not found then
    raise exception 'Organization not found.' using errcode = 'P0002';
  end if;

  select id into v_target_user_id
  from auth.users
  where lower(email) = v_email
  limit 1;

  if v_target_user_id is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org_id
      and m.profile_id = v_target_user_id
      and m.status = 'active'
  ) then
    raise exception 'This user is already an active member of the workspace.' using errcode = '23505';
  end if;

  insert into public.organization_invitations (
    organization_id,
    invited_user_id,
    invited_email,
    role,
    invited_by
  ) values (
    p_org_id,
    v_target_user_id,
    v_email,
    p_role,
    v_actor_id
  )
  returning * into v_invitation;

  if v_target_user_id is not null and v_target_user_id <> v_actor_id then
    if public.should_notify_in_app(v_target_user_id, 'organization.invitation_created') then
      v_dedupe_key := format('org_invite:%s:%s', v_invitation.id, v_target_user_id);
      insert into public.notifications (
        recipient_user_id,
        organization_id,
        actor_user_id,
        type,
        title,
        message,
        metadata,
        entity_type,
        entity_id,
        dedupe_key
      ) values (
        v_target_user_id,
        null,
        v_actor_id,
        'organization.invitation_created',
        'Workspace invitation',
        format('You have been invited to join %s as %s.', coalesce(v_org_name, 'a workspace'), replace(p_role, '_', ' ')),
        jsonb_build_object(
          'organization_id', p_org_id,
          'organization_name', v_org_name,
          'invitation_id', v_invitation.id,
          'role', p_role
        ),
        'organization_invitation',
        v_invitation.id,
        v_dedupe_key
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_invitation.id,
    'organization_id', v_invitation.organization_id,
    'invited_user_id', v_invitation.invited_user_id,
    'invited_email', v_invitation.invited_email,
    'role', v_invitation.role,
    'status', v_invitation.status,
    'created_at', v_invitation.created_at
  );
end;
$$;

revoke all on function public.create_organization_invitation(uuid, text, text) from public, anon;
grant execute on function public.create_organization_invitation(uuid, text, text) to authenticated;

-- RPC: accept or decline a targeted organization invitation
create or replace function public.respond_organization_invitation(
  p_invitation_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_inv public.organization_invitations;
  v_next_status text := case when p_accept then 'accepted' else 'declined' end;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into v_inv
  from public.organization_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found.' using errcode = 'P0002';
  end if;

  if v_inv.invited_user_id is distinct from v_actor_id then
    raise exception 'You are not authorized to respond to this invitation.' using errcode = '42501';
  end if;

  if v_inv.status <> 'pending' then
    raise exception 'This invitation has already been responded to.' using errcode = '22023';
  end if;

  update public.organization_invitations
  set status = v_next_status,
      responded_at = now()
  where id = v_inv.id;

  if p_accept then
    insert into public.organization_members (organization_id, profile_id, role, status)
    values (v_inv.organization_id, v_actor_id, v_inv.role, 'active')
    on conflict (organization_id, profile_id)
    do update set
      role = excluded.role,
      status = 'active';
  end if;

  return jsonb_build_object(
    'id', v_inv.id,
    'organization_id', v_inv.organization_id,
    'status', v_next_status
  );
end;
$$;

revoke all on function public.respond_organization_invitation(uuid, boolean) from public, anon;
grant execute on function public.respond_organization_invitation(uuid, boolean) to authenticated;

-- 6. Trigger: Cash Advance Request submitted -> notify owners & admins
create or replace function public.notify_on_cash_advance_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient record;
  v_dedupe_key text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  for v_recipient in
    select m.profile_id
    from public.organization_members m
    where m.organization_id = new.organization_id
      and m.status = 'active'
      and m.role in ('owner', 'organization_admin')
      and m.profile_id <> new.requester
  loop
    if public.should_notify_in_app(v_recipient.profile_id, 'cash_advance.submitted') then
      v_dedupe_key := format('cash_advance_submitted:%s:%s', new.id, v_recipient.profile_id);
      insert into public.notifications (
        recipient_user_id,
        organization_id,
        actor_user_id,
        type,
        title,
        message,
        metadata,
        entity_type,
        entity_id,
        dedupe_key
      ) values (
        v_recipient.profile_id,
        new.organization_id,
        new.requester,
        'cash_advance.submitted',
        'Cash advance requested',
        format('A cash advance request "%s" was submitted for review.', left(new.title, 120)),
        jsonb_build_object(
          'cash_advance_request_id', new.id,
          'amount_centavos', new.amount_centavos,
          'status', new.status
        ),
        'cash_advance_request',
        new.id,
        v_dedupe_key
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists cash_advance_requests_notify_submitted on public.cash_advance_requests;
create trigger cash_advance_requests_notify_submitted
  after insert on public.cash_advance_requests
  for each row
  execute function public.notify_on_cash_advance_submitted();

-- 7. Trigger: Cash Advance Request reviewed/released -> notify requester
create or replace function public.notify_on_cash_advance_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_type text;
  v_title text;
  v_message text;
  v_dedupe_key text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status not in ('approved', 'rejected', 'released') then
    return new;
  end if;

  if v_actor_id is not null and v_actor_id = new.requester then
    return new;
  end if;

  if not public.is_active_org_member(new.organization_id, new.requester) then
    return new;
  end if;

  if new.status = 'approved' then
    v_type := 'cash_advance.approved';
    v_title := 'Cash advance approved';
    v_message := format('Your cash advance request "%s" was approved.', left(new.title, 120));
  elsif new.status = 'rejected' then
    v_type := 'cash_advance.rejected';
    v_title := 'Cash advance rejected';
    v_message := format('Your cash advance request "%s" was rejected.', left(new.title, 120));
  else
    v_type := 'cash_advance.released';
    v_title := 'Cash advance released';
    v_message := format('Funds for your cash advance "%s" have been released.', left(new.title, 120));
  end if;

  if public.should_notify_in_app(new.requester, v_type) then
    v_dedupe_key := format('cash_advance_%s:%s:rev%s:%s', new.status, new.id, new.revision, new.requester);
    insert into public.notifications (
      recipient_user_id,
      organization_id,
      actor_user_id,
      type,
      title,
      message,
      metadata,
      entity_type,
      entity_id,
      dedupe_key
    ) values (
      new.requester,
      new.organization_id,
      v_actor_id,
      v_type,
      v_title,
      v_message,
      jsonb_build_object(
        'cash_advance_request_id', new.id,
        'status', new.status,
        'amount_centavos', new.amount_centavos
      ),
      'cash_advance_request',
      new.id,
      v_dedupe_key
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists cash_advance_requests_notify_status on public.cash_advance_requests;
create trigger cash_advance_requests_notify_status
  after update of status on public.cash_advance_requests
  for each row
  execute function public.notify_on_cash_advance_status();

-- 8. Trigger: Collection Obligation assigned -> notify member
create or replace function public.notify_on_obligation_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_profile_id uuid;
  v_collection_title text;
  v_dedupe_key text;
begin
  if new.amount_centavos <= 0 or new.status = 'waived' then
    return new;
  end if;

  select m.profile_id into v_profile_id
  from public.organization_members m
  where m.id = new.member_id
    and m.organization_id = new.organization_id
    and m.status = 'active';

  if v_profile_id is null or (v_actor_id is not null and v_profile_id = v_actor_id) then
    return new;
  end if;

  if not public.should_notify_in_app(v_profile_id, 'collection.assigned') then
    return new;
  end if;

  select title into v_collection_title from public.collections where id = new.collection_id;
  v_dedupe_key := format('obligation_assigned:%s:%s', new.id, v_profile_id);

  insert into public.notifications (
    recipient_user_id,
    organization_id,
    actor_user_id,
    type,
    title,
    message,
    metadata,
    entity_type,
    entity_id,
    dedupe_key
  ) values (
    v_profile_id,
    new.organization_id,
    v_actor_id,
    'collection.assigned',
    'New contribution due',
    format('You have a new contribution due for "%s".', coalesce(left(v_collection_title, 120), 'a collection')),
    jsonb_build_object(
      'collection_id', new.collection_id,
      'obligation_id', new.id,
      'amount_centavos', new.amount_centavos
    ),
    'collection',
    new.collection_id,
    v_dedupe_key
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists obligations_notify_assigned on public.obligations;
create trigger obligations_notify_assigned
  after insert on public.obligations
  for each row
  execute function public.notify_on_obligation_assigned();

-- 9. Trigger: Payment recorded or reversed -> notify member
create or replace function public.notify_on_payment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_collection_title text;
  v_actor_id uuid;
  v_type text;
  v_title text;
  v_message text;
  v_dedupe_key text;
begin
  select m.profile_id into v_profile_id
  from public.obligations o
  join public.organization_members m on m.id = o.member_id
  where o.id = new.obligation_id
    and m.organization_id = new.organization_id
    and m.status = 'active';

  if v_profile_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'completed' then
    v_actor_id := new.recorded_by;
    if v_actor_id = v_profile_id then
      return new;
    end if;
    v_type := 'payment.recorded';
    v_title := 'Payment recorded';
    select title into v_collection_title from public.collections where id = new.collection_id;
    v_message := format('A payment (Receipt %s) was recorded for "%s".', new.receipt_number, coalesce(left(v_collection_title, 100), 'collection'));
    v_dedupe_key := format('payment_recorded:%s:%s', new.id, v_profile_id);
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status = 'reversed' then
    v_actor_id := new.reversed_by;
    if v_actor_id is not null and v_actor_id = v_profile_id then
      return new;
    end if;
    v_type := 'payment.reversed';
    v_title := 'Payment reversed';
    select title into v_collection_title from public.collections where id = new.collection_id;
    v_message := format('Payment receipt %s for "%s" was reversed.', new.receipt_number, coalesce(left(v_collection_title, 100), 'collection'));
    v_dedupe_key := format('payment_reversed:%s:%s', new.id, v_profile_id);
  else
    return new;
  end if;

  if not public.should_notify_in_app(v_profile_id, v_type) then
    return new;
  end if;

  insert into public.notifications (
    recipient_user_id,
    organization_id,
    actor_user_id,
    type,
    title,
    message,
    metadata,
    entity_type,
    entity_id,
    dedupe_key
  ) values (
    v_profile_id,
    new.organization_id,
    v_actor_id,
    v_type,
    v_title,
    v_message,
    jsonb_build_object(
      'payment_id', new.id,
      'collection_id', new.collection_id,
      'receipt_number', new.receipt_number,
      'amount_centavos', new.amount_centavos
    ),
    'collection',
    new.collection_id,
    v_dedupe_key
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists payments_notify_recorded on public.payments;
create trigger payments_notify_recorded
  after insert on public.payments
  for each row
  execute function public.notify_on_payment_event();

drop trigger if exists payments_notify_reversed on public.payments;
create trigger payments_notify_reversed
  after update of status on public.payments
  for each row
  execute function public.notify_on_payment_event();

-- 10. Trigger: Member role updated -> notify member
create or replace function public.notify_on_member_role_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_dedupe_key text;
begin
  if old.role is not distinct from new.role or new.status <> 'active' then
    return new;
  end if;

  if v_actor_id is not null and v_actor_id = new.profile_id then
    return new;
  end if;

  if not public.should_notify_in_app(new.profile_id, 'member.role_updated') then
    return new;
  end if;

  v_dedupe_key := format('member_role:%s:%s:%s', new.id, new.role, extract(epoch from now())::bigint);

  insert into public.notifications (
    recipient_user_id,
    organization_id,
    actor_user_id,
    type,
    title,
    message,
    metadata,
    entity_type,
    entity_id,
    dedupe_key
  ) values (
    new.profile_id,
    new.organization_id,
    v_actor_id,
    'member.role_updated',
    'Workspace role updated',
    format('Your workspace role was updated to %s.', replace(new.role, '_', ' ')),
    jsonb_build_object(
      'old_role', old.role,
      'new_role', new.role
    ),
    'organization_member',
    new.id,
    v_dedupe_key
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists org_members_notify_role_updated on public.organization_members;
create trigger org_members_notify_role_updated
  after update of role on public.organization_members
  for each row
  execute function public.notify_on_member_role_updated();

-- 11. Scheduled Due Payment Reminders RPC (Phase 4)
create or replace function public.emit_due_payment_reminders(
  p_org_id uuid default null,
  p_days_ahead integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_inserted integer := 0;
  v_dedupe_key text;
  v_days integer := greatest(0, least(coalesce(p_days_ahead, 3), 30));
begin
  for v_row in
    select
      o.id as obligation_id,
      o.organization_id,
      o.collection_id,
      o.amount_centavos,
      c.title as collection_title,
      c.due_date,
      m.profile_id as recipient_user_id
    from public.obligations o
    join public.collections c on c.id = o.collection_id
    join public.organization_members m on m.id = o.member_id
    where c.status = 'active'
      and c.due_date is not null
      and c.due_date <= (current_date + v_days)
      and o.status in ('pending', 'partially_paid')
      and o.amount_centavos > 0
      and m.status = 'active'
      and (p_org_id is null or o.organization_id = p_org_id)
  loop
    if public.should_notify_in_app(v_row.recipient_user_id, 'payment.due_reminder') then
      v_dedupe_key := format('due_reminder:%s:%s', v_row.obligation_id, current_date);
      insert into public.notifications (
        recipient_user_id,
        organization_id,
        actor_user_id,
        type,
        title,
        message,
        metadata,
        entity_type,
        entity_id,
        dedupe_key
      ) values (
        v_row.recipient_user_id,
        v_row.organization_id,
        null,
        'payment.due_reminder',
        case when v_row.due_date < current_date then 'Overdue contribution' else 'Contribution due soon' end,
        format('Your contribution for "%s" is due on %s.', left(v_row.collection_title, 100), v_row.due_date),
        jsonb_build_object(
          'collection_id', v_row.collection_id,
          'obligation_id', v_row.obligation_id,
          'due_date', v_row.due_date,
          'amount_centavos', v_row.amount_centavos
        ),
        'collection',
        v_row.collection_id,
        v_dedupe_key
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;

      if found then
        v_inserted := v_inserted + 1;
      end if;
    end if;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.emit_due_payment_reminders(uuid, integer) from public, anon, authenticated;

-- Authenticated wrapper for org admins/owners/treasurers to trigger reminders for their workspace
create or replace function public.trigger_workspace_due_reminders(
  p_org_id uuid,
  p_days_ahead integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'organization_admin', 'treasurer')
  ) then
    raise exception 'Only workspace officers can trigger payment reminders.' using errcode = '42501';
  end if;

  return public.emit_due_payment_reminders(p_org_id, p_days_ahead);
end;
$$;

revoke all on function public.trigger_workspace_due_reminders(uuid, integer) from public, anon;
grant execute on function public.trigger_workspace_due_reminders(uuid, integer) to authenticated;

commit;
