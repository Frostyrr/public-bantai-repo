import {
  createOrganizationInvitationRpc,
  emitNotificationsRpc,
  getUnreadNotificationCount,
  listMyPendingInvitations,
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  resolveActiveOrgApprovers,
  respondOrganizationInvitationRpc,
  triggerWorkspaceDueRemindersRpc,
  type ListNotificationsOptions,
  type NotificationRecord,
  type OrganizationInvitationRecord,
  type PaginatedNotifications,
} from "./notifications.repository";

export type NotificationType =
  | "expense.submitted"
  | "expense.approved"
  | "expense.rejected"
  | "cash_advance.submitted"
  | "cash_advance.approved"
  | "cash_advance.rejected"
  | "cash_advance.released"
  | "collection.assigned"
  | "payment.recorded"
  | "payment.reversed"
  | "payment.due_reminder"
  | "member.role_updated"
  | "organization.invitation_created";

export interface CreateNotificationsInput {
  recipientIds: string[];
  actorUserId: string;
  organizationId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  entityType?: string | null;
  entityId?: string | null;
  dedupePrefix?: string | null;
}

export interface NotificationRepositoryPort {
  emitNotificationsRpc: typeof emitNotificationsRpc;
  resolveActiveOrgApprovers: typeof resolveActiveOrgApprovers;
}

const defaultPort: NotificationRepositoryPort = {
  emitNotificationsRpc,
  resolveActiveOrgApprovers,
};

/**
 * Emits trusted notifications for one or more recipients while:
 * - filtering out self-notifications (actorUserId) and duplicate recipient IDs
 * - enforcing server-side membership/role authorization via PostgreSQL RPC
 * - failing safely so non-atomic callers never corrupt completed business transactions
 */
export async function createNotifications(
  accessToken: string,
  input: CreateNotificationsInput,
  port: NotificationRepositoryPort = defaultPort,
): Promise<{ created: number; error?: string }> {
  const recipients = Array.from(
    new Set(
      input.recipientIds.filter(
        (id) => typeof id === "string" && id.length > 0 && id !== input.actorUserId,
      ),
    ),
  );

  if (recipients.length === 0) {
    return { created: 0 };
  }

  try {
    const created = await port.emitNotificationsRpc(accessToken, {
      recipientIds: recipients,
      organizationId: input.organizationId,
      type: input.type,
      title: input.title.trim().slice(0, 200),
      message: input.message.trim().slice(0, 1000),
      metadata: input.metadata ?? {},
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dedupePrefix: input.dedupePrefix ?? null,
    });
    return { created };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Notification delivery failed.";
    console.warn("[notifications] Best-effort notification emit failed:", message);
    return { created: 0, error: message };
  }
}

/**
 * Resolves eligible expense approvers for an organization, excluding the actor.
 */
export async function resolveEligibleApprovers(
  accessToken: string,
  organizationId: string,
  includeTreasurers: boolean,
  excludeUserId?: string,
  port: NotificationRepositoryPort = defaultPort,
): Promise<string[]> {
  return port.resolveActiveOrgApprovers(
    accessToken,
    organizationId,
    includeTreasurers,
    excludeUserId,
  );
}

/**
 * Helper for user-targeted organization invitations when an invited user's account already exists.
 * Note: Bantai currently uses shared invite codes (`POST /organizations/join`); this handler
 * is ready to be called by a future user-targeted invitation endpoint.
 */
export async function notifyOrganizationInvitationCreated(
  accessToken: string,
  params: {
    actorUserId: string;
    organizationId: string;
    organizationName: string;
    invitedUserId: string | null | undefined;
    invitationId: string;
    invitedRole?: string;
  },
  port: NotificationRepositoryPort = defaultPort,
): Promise<{ created: number; error?: string }> {
  if (!params.invitedUserId || params.invitedUserId === params.actorUserId) {
    return { created: 0 };
  }

  return createNotifications(
    accessToken,
    {
      recipientIds: [params.invitedUserId],
      actorUserId: params.actorUserId,
      organizationId: params.organizationId,
      type: "organization.invitation_created",
      title: "Organization invitation",
      message: `You were invited to join ${params.organizationName}.`,
      metadata: {
        organization_name: params.organizationName,
        ...(params.invitedRole ? { role: params.invitedRole } : {}),
      },
      entityType: "organization_invitation",
      entityId: params.invitationId,
      dedupePrefix: `org_invite:${params.invitationId}`,
    },
    port,
  );
}

export async function getRecipientNotifications(
  accessToken: string,
  userId: string,
  options: ListNotificationsOptions,
): Promise<PaginatedNotifications> {
  return listNotifications(accessToken, userId, options);
}

export async function getRecipientUnreadCount(
  accessToken: string,
  userId: string,
  organizationId?: string,
): Promise<number> {
  return getUnreadNotificationCount(accessToken, userId, organizationId);
}

export async function markRecipientNotificationRead(
  accessToken: string,
  userId: string,
  notificationId: string,
): Promise<NotificationRecord | null> {
  return markNotificationAsRead(accessToken, userId, notificationId);
}

export async function markAllRecipientNotificationsRead(
  accessToken: string,
  organizationId?: string,
): Promise<number> {
  return markAllNotificationsAsRead(accessToken, organizationId);
}

export async function inviteMemberByEmail(
  accessToken: string,
  organizationId: string,
  email: string,
  role: string,
): Promise<OrganizationInvitationRecord> {
  return createOrganizationInvitationRpc(accessToken, organizationId, email, role);
}

export async function respondToInvitation(
  accessToken: string,
  invitationId: string,
  accept: boolean,
): Promise<{ id: string; organization_id: string; status: string }> {
  return respondOrganizationInvitationRpc(accessToken, invitationId, accept);
}

export async function listPendingInvitations(accessToken: string) {
  return listMyPendingInvitations(accessToken);
}

export async function sendWorkspaceDueReminders(
  accessToken: string,
  organizationId: string,
  daysAhead: number,
): Promise<number> {
  return triggerWorkspaceDueRemindersRpc(accessToken, organizationId, daysAhead);
}
