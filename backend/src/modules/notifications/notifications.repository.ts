import { createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";

export interface NotificationRecord {
  id: string;
  recipient_user_id: string;
  organization_id: string | null;
  actor_user_id: string | null;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface ListNotificationsOptions {
  limit: number;
  offset: number;
  unreadOnly?: boolean;
  organizationId?: string;
}

export interface PaginatedNotifications {
  items: NotificationRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const NOTIFICATION_COLUMNS =
  "id, recipient_user_id, organization_id, actor_user_id, type, title, message, metadata, entity_type, entity_id, read_at, created_at";

export async function listNotifications(
  accessToken: string,
  userId: string,
  options: ListNotificationsOptions,
): Promise<PaginatedNotifications> {
  const client = createUserClient(accessToken);
  const { limit, offset, unreadOnly, organizationId } = options;

  let query = client
    .from("notifications")
    .select(NOTIFICATION_COLUMNS, { count: "exact" })
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (unreadOnly) {
    query = query.is("read_at", null);
  }
  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new AppError(500, "Unable to load notifications.");
  }

  const items = (data ?? []) as NotificationRecord[];
  const total = count ?? items.length;
  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
}

export async function getUnreadNotificationCount(
  accessToken: string,
  userId: string,
  organizationId?: string,
): Promise<number> {
  const client = createUserClient(accessToken);
  let query = client
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", userId)
    .is("read_at", null);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { count, error } = await query;
  if (error) {
    throw new AppError(500, "Unable to count unread notifications.");
  }
  return count ?? 0;
}

export async function markNotificationAsRead(
  accessToken: string,
  userId: string,
  notificationId: string,
): Promise<NotificationRecord | null> {
  const client = createUserClient(accessToken);
  const now = new Date().toISOString();

  // First check if notification exists for this recipient (and active org membership via RLS)
  const { data: existing, error: lookupError } = await client
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("id", notificationId)
    .eq("recipient_user_id", userId)
    .maybeSingle();

  if (lookupError) {
    throw new AppError(500, "Unable to look up notification.");
  }
  if (!existing) {
    return null;
  }
  if (existing.read_at) {
    return existing as NotificationRecord;
  }

  const { data, error } = await client
    .from("notifications")
    .update({ read_at: now })
    .eq("id", notificationId)
    .eq("recipient_user_id", userId)
    .select(NOTIFICATION_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new AppError(500, "Unable to mark notification as read.");
  }
  return (data as NotificationRecord | null) ?? null;
}

export async function markAllNotificationsAsRead(
  accessToken: string,
  organizationId?: string,
): Promise<number> {
  const client = createUserClient(accessToken);
  const { data, error } = await client.rpc("mark_all_notifications_read", {
    p_org_id: organizationId ?? null,
  });

  if (error) {
    throw new AppError(500, "Unable to mark notifications as read.");
  }
  return typeof data === "number" ? data : 0;
}

export async function resolveActiveOrgApprovers(
  accessToken: string,
  organizationId: string,
  includeTreasurers: boolean,
  excludeUserId?: string,
): Promise<string[]> {
  const client = createUserClient(accessToken);
  const allowedRoles = includeTreasurers
    ? ["owner", "organization_admin", "treasurer"]
    : ["owner", "organization_admin"];

  const { data, error } = await client
    .from("organization_members")
    .select("profile_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", allowedRoles);

  if (error || !data) {
    return [];
  }

  return Array.from(
    new Set(
      data
        .map((row: { profile_id: string }) => row.profile_id)
        .filter((id) => Boolean(id) && id !== excludeUserId),
    ),
  );
}

export interface EmitNotificationsParams {
  recipientIds: string[];
  organizationId: string | null;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  entityType?: string | null;
  entityId?: string | null;
  dedupePrefix?: string | null;
}

export async function emitNotificationsRpc(
  accessToken: string,
  params: EmitNotificationsParams,
): Promise<number> {
  const client = createUserClient(accessToken);
  const { data, error } = await client.rpc("emit_notifications", {
    p_recipient_ids: params.recipientIds,
    p_organization_id: params.organizationId,
    p_type: params.type,
    p_title: params.title,
    p_message: params.message,
    p_metadata: params.metadata ?? {},
    p_entity_type: params.entityType ?? null,
    p_entity_id: params.entityId ?? null,
    p_dedupe_prefix: params.dedupePrefix ?? null,
  });

  if (error) {
    throw new AppError(
      error.code === "42501" ? 403 : 400,
      error.message || "Unable to emit notifications.",
    );
  }
  return typeof data === "number" ? data : 0;
}

export interface OrganizationInvitationRecord {
  id: string;
  organization_id: string;
  invited_user_id: string | null;
  invited_email: string;
  role: string;
  status: string;
  created_at: string;
  responded_at?: string | null;
}

export async function createOrganizationInvitationRpc(
  accessToken: string,
  organizationId: string,
  invitedEmail: string,
  role: string,
): Promise<OrganizationInvitationRecord> {
  const client = createUserClient(accessToken);
  const { data, error } = await client.rpc("create_organization_invitation", {
    p_org_id: organizationId,
    p_invited_email: invitedEmail,
    p_role: role,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400;
    throw new AppError(status, error.message || "Unable to send invitation.");
  }

  return data as OrganizationInvitationRecord;
}

export async function respondOrganizationInvitationRpc(
  accessToken: string,
  invitationId: string,
  accept: boolean,
): Promise<{ id: string; organization_id: string; status: string }> {
  const client = createUserClient(accessToken);
  const { data, error } = await client.rpc("respond_organization_invitation", {
    p_invitation_id: invitationId,
    p_accept: accept,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    throw new AppError(status, error.message || "Unable to respond to invitation.");
  }

  return data as { id: string; organization_id: string; status: string };
}

export interface PendingInvitation {
  id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  created_at: string;
}

export async function listMyPendingInvitations(accessToken: string): Promise<PendingInvitation[]> {
  const { data, error } = await createUserClient(accessToken).rpc("list_my_pending_organization_invitations");
  if (error) throw new AppError(500, "Unable to load invitations.");
  return (data ?? []) as PendingInvitation[];
}

export async function triggerWorkspaceDueRemindersRpc(
  accessToken: string,
  organizationId: string,
  daysAhead: number,
): Promise<number> {
  const client = createUserClient(accessToken);
  const { data, error } = await client.rpc("trigger_workspace_due_reminders", {
    p_org_id: organizationId,
    p_days_ahead: daysAhead,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    throw new AppError(status, error.message || "Unable to trigger payment reminders.");
  }

  return typeof data === "number" ? data : 0;
}
