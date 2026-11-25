-- Migration: 202611130001_ask_bantai_conversations.sql
-- Description: Ask Bantai AI Assistant conversation history, message persistence, and owner-isolated RLS.
begin;

-- 1. AI Conversations Table
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New Conversation' check (length(trim(title)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_conversations_org_owner
  on public.ai_conversations (organization_id, created_by, updated_at desc);

-- 2. AI Messages Table
create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null default '',
  tool_calls jsonb,
  tool_results jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_messages_conversation_time
  on public.ai_messages (conversation_id, created_at asc);

-- 3. Enable Row-Level Security
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- 4. Revoke and Grant Permissions
revoke all on public.ai_conversations, public.ai_messages from anon, authenticated;
grant select, insert, update, delete on public.ai_conversations, public.ai_messages to authenticated;

-- 5. RLS Policies: Conversations are private to their creator and strictly scoped to active org members
create policy ai_conversations_owner_select on public.ai_conversations
  for select to authenticated
  using (
    created_by = (select auth.uid()) and
    public.is_active_org_member(organization_id, (select auth.uid()))
  );

create policy ai_conversations_owner_insert on public.ai_conversations
  for insert to authenticated
  with check (
    created_by = (select auth.uid()) and
    public.is_active_org_member(organization_id, (select auth.uid()))
  );

create policy ai_conversations_owner_update on public.ai_conversations
  for update to authenticated
  using (
    created_by = (select auth.uid()) and
    public.is_active_org_member(organization_id, (select auth.uid()))
  )
  with check (
    created_by = (select auth.uid()) and
    public.is_active_org_member(organization_id, (select auth.uid()))
  );

create policy ai_conversations_owner_delete on public.ai_conversations
  for delete to authenticated
  using (
    created_by = (select auth.uid()) and
    public.is_active_org_member(organization_id, (select auth.uid()))
  );

-- 6. RLS Policies: Messages are only readable and writable by the conversation owner
create policy ai_messages_owner_select on public.ai_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.created_by = (select auth.uid())
        and public.is_active_org_member(c.organization_id, (select auth.uid()))
    )
  );

create policy ai_messages_owner_insert on public.ai_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.created_by = (select auth.uid())
        and public.is_active_org_member(c.organization_id, (select auth.uid()))
    )
  );

create policy ai_messages_owner_delete on public.ai_messages
  for delete to authenticated
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.created_by = (select auth.uid())
        and public.is_active_org_member(c.organization_id, (select auth.uid()))
    )
  );

commit;
