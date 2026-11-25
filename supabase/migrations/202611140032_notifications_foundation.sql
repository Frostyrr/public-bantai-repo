begin;

-- Phase 1: Persistent, organization-aware notifications foundation
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid null references public.organizations(id) on delete cascade,
  actor_user_id uuid null references public.profiles(id) on delete set null,
  type text not null check (char_length(trim(type)) between 2 and 100),
  title text not null check (char_length(trim(title)) between 1 and 200),
  message text not null check (char_length(trim(message)) between 1 and 1000),
  metadata jsonb not null default '{}'::jsonb,
  entity_type text null check (entity_type is null or char_length(trim(entity_type)) between 1 and 80),
  entity_id uuid null,
  dedupe_key text null,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_created
  on public.notifications(recipient_user_id, created_at desc, id desc);

create index if not exists idx_notifications_recipient_unread
  on public.notifications(recipient_user_id, created_at desc)
  where read_at is null;

create index if not exists idx_notifications_org_recipient
  on public.notifications(organization_id, recipient_user_id, created_at desc)
  where organization_id is not null;

create unique index if not exists uidx_notifications_dedupe_key
  on public.notifications(dedupe_key)
  where dedupe_key is not null;

alter table public.notifications enable row level security;

revoke all on public.notifications from anon, authenticated;
grant select, update (read_at) on public.notifications to authenticated;

drop policy if exists notifications_select_recipient on public.notifications;
create policy notifications_select_recipient on public.notifications
  for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and (
      organization_id is null
      or public.is_active_org_member(organization_id, (select auth.uid()))
    )
  );

drop policy if exists notifications_update_recipient_read on public.notifications;
create policy notifications_update_recipient_read on public.notifications
  for update to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and (
      organization_id is null
      or public.is_active_org_member(organization_id, (select auth.uid()))
    )
  )
  with check (
    recipient_user_id = (select auth.uid())
    and (
      organization_id is null
      or public.is_active_org_member(organization_id, (select auth.uid()))
    )
  );

-- Trusted server-side notification emitter for application-level events
create or replace function public.emit_notifications(
  p_recipient_ids uuid[],
  p_organization_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_metadata jsonb default '{}'::jsonb,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_dedupe_prefix text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_recipient uuid;
  v_inserted integer := 0;
  v_dedupe text;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  if p_recipient_ids is null or coalesce(array_length(p_recipient_ids, 1), 0) = 0 then
    return 0;
  end if;

  if p_organization_id is not null then
    select role into v_caller_role
    from public.organization_members
    where organization_id = p_organization_id
      and profile_id = v_caller
      and status = 'active';

    if v_caller_role is null then
      raise exception 'Active organization membership is required.';
    end if;

    if p_type = 'organization.invitation_created' and v_caller_role not in ('owner', 'organization_admin') then
      raise exception 'Only owners and organization admins can emit invitation notifications.';
    end if;
  end if;

  foreach v_recipient in array p_recipient_ids loop
    continue when v_recipient is null or v_recipient = v_caller;

    -- Verify recipient exists
    continue when not exists (select 1 from public.profiles where id = v_recipient);

    -- For org-scoped operational events (other than invitation_created), require active membership
    if p_organization_id is not null and p_type <> 'organization.invitation_created' then
      continue when not public.is_active_org_member(p_organization_id, v_recipient);
    end if;

    v_dedupe := case
      when p_dedupe_prefix is not null and length(trim(p_dedupe_prefix)) > 0
      then trim(p_dedupe_prefix) || ':' || v_recipient::text
      else null
    end;

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
    )
    values (
      v_recipient,
      p_organization_id,
      v_caller,
      trim(p_type),
      left(trim(p_title), 200),
      left(trim(p_message), 1000),
      coalesce(p_metadata, '{}'::jsonb),
      p_entity_type,
      p_entity_id,
      v_dedupe
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.emit_notifications(uuid[], uuid, text, text, text, jsonb, text, uuid, text) from public;
grant execute on function public.emit_notifications(uuid[], uuid, text, text, text, jsonb, text, uuid, text) to authenticated;

-- Bulk mark-all-as-read helper for the authenticated recipient
create or replace function public.mark_all_notifications_read(p_org_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required.';
  end if;

  update public.notifications
  set read_at = now()
  where recipient_user_id = v_caller
    and read_at is null
    and (p_org_id is null or organization_id = p_org_id)
    and (organization_id is null or public.is_active_org_member(organization_id, v_caller));

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_all_notifications_read(uuid) from public;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- Atomic Event Trigger 1: Expense submitted -> notify eligible approvers
create or replace function public.notify_expense_submitted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_currency text := 'PHP';
  v_submitter_name text := 'A member';
  v_approver record;
begin
  if new.status not in ('pending', 'verified') then
    return new;
  end if;

  select coalesce(currency, 'PHP') into v_org_currency
  from public.organizations
  where id = new.organization_id;

  select coalesce(nullif(trim(display_name), ''), 'A member') into v_submitter_name
  from public.profiles
  where id = new.submitted_by;

  for v_approver in
    select profile_id
    from public.organization_members
    where organization_id = new.organization_id
      and status = 'active'
      and profile_id <> new.submitted_by
      and (
        role in ('owner', 'organization_admin')
        or (role = 'treasurer' and coalesce(new.treasurer_approval_snapshot, false))
      )
  loop
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
    )
    values (
      v_approver.profile_id,
      new.organization_id,
      new.submitted_by,
      'expense.submitted',
      'New expense awaiting review',
      format('%s submitted "%s" for review.', v_submitter_name, left(new.title, 120)),
      jsonb_build_object(
        'amount_centavos', new.amount_centavos,
        'currency', v_org_currency,
        'category', new.category,
        'submitter_id', new.submitted_by
      ),
      'expense',
      new.id,
      'expense_submitted:' || new.id::text || ':' || v_approver.profile_id::text
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end loop;

  return new;
exception when others then
  -- Never block or corrupt financial expense submission if notification formatting fails
  return new;
end;
$$;

drop trigger if exists expenses_notify_submitted on public.expenses;
create trigger expenses_notify_submitted
  after insert on public.expenses
  for each row
  execute function public.notify_expense_submitted();

-- Atomic Event Trigger 2: Expense approved or rejected -> notify submitter
create or replace function public.notify_expense_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_currency text := 'PHP';
  v_actor uuid := coalesce(auth.uid(), new.approved_by, new.verified_by);
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status not in ('approved', 'rejected') then
    return new;
  end if;

  -- Prevent self-notification (e.g. owner/admin self-approval)
  if new.submitted_by is null or (v_actor is not null and new.submitted_by = v_actor) then
    return new;
  end if;

  -- Only notify if submitter is still an active member of the organization
  if not public.is_active_org_member(new.organization_id, new.submitted_by) then
    return new;
  end if;

  select coalesce(currency, 'PHP') into v_org_currency
  from public.organizations
  where id = new.organization_id;

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
  )
  values (
    new.submitted_by,
    new.organization_id,
    v_actor,
    case when new.status = 'approved' then 'expense.approved' else 'expense.rejected' end,
    case when new.status = 'approved' then 'Expense approved' else 'Expense rejected' end,
    case
      when new.status = 'approved' then format('Your expense "%s" was approved.', left(new.title, 120))
      else format('Your expense "%s" was rejected.', left(new.title, 120))
    end,
    jsonb_build_object(
      'status', new.status,
      'amount_centavos', new.amount_centavos,
      'currency', v_org_currency,
      'review_revision', coalesce(new.review_revision, 1)
    ),
    'expense',
    new.id,
    'expense_reviewed:' || new.id::text || ':' || coalesce(new.review_revision, 1)::text || ':' || new.status || ':' || new.submitted_by::text
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
exception when others then
  -- Never block or corrupt financial review if notification formatting fails
  return new;
end;
$$;

drop trigger if exists expenses_notify_reviewed on public.expenses;
create trigger expenses_notify_reviewed
  after update of status on public.expenses
  for each row
  execute function public.notify_expense_reviewed();

commit;
