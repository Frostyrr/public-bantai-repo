import { Router } from "express";
import { z } from "zod";
import { createRateLimiter } from "../../middleware/rateLimit";
import {
  getRecipientNotifications,
  getRecipientUnreadCount,
  inviteMemberByEmail,
  listPendingInvitations,
  markAllRecipientNotificationsRead,
  markRecipientNotificationRead,
  respondToInvitation,
  sendWorkspaceDueReminders,
} from "./notifications.service";

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).max(10000).optional().default(0),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  organizationId: z.string().uuid("Invalid organization ID.").optional(),
});

const unreadCountQuerySchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID.").optional(),
});

const notificationIdParamSchema = z.string().uuid("Invalid notification ID.");

const markAllBodySchema = z
  .object({
    organizationId: z.string().uuid("Invalid organization ID.").optional(),
  })
  .strict()
  .optional()
  .default({});

// GET /notifications - Paginated notifications for the authenticated user
router.get("/", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const query = listQuerySchema.parse(req.query);
    const result = await getRecipientNotifications(auth.accessToken, auth.user.id, query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /notifications/unread-count - Unread notification count for the authenticated user
router.get("/unread-count", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const query = unreadCountQuerySchema.parse(req.query);
    const unreadCount = await getRecipientUnreadCount(
      auth.accessToken,
      auth.user.id,
      query.organizationId,
    );
    res.json({ unreadCount });
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/:notificationId/read - Mark a single notification as read
router.patch("/:notificationId/read", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const notificationId = notificationIdParamSchema.parse(req.params.notificationId);
    const notification = await markRecipientNotificationRead(
      auth.accessToken,
      auth.user.id,
      notificationId,
    );

    if (!notification) {
      res.status(404).json({ message: "Notification not found." });
      return;
    }

    res.json({ notification });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/read-all - Mark all notifications (or org-scoped) as read
router.post("/read-all", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const body = markAllBodySchema.parse(req.body);
    const updatedCount = await markAllRecipientNotificationsRead(
      auth.accessToken,
      body.organizationId,
    );
    res.json({ updatedCount });
  } catch (err) {
    next(err);
  }
});

const organizationIdParamSchema = z.string().uuid("Invalid organization ID.");
const invitationIdParamSchema = z.string().uuid("Invalid invitation ID.");

const createInvitationBodySchema = z
  .object({
    email: z.string().trim().email("A valid email address is required."),
    role: z
      .enum(["organization_admin", "treasurer", "auditor", "member"])
      .optional()
      .default("member"),
  })
  .strict();

const respondInvitationBodySchema = z
  .object({
    accept: z.boolean(),
  })
  .strict();

const dueRemindersBodySchema = z
  .object({
    daysAhead: z.coerce.number().int().min(0).max(30).optional().default(3),
  })
  .strict()
  .optional()
  .default({ daysAhead: 3 });

// GET /notifications/invitations - Pending targeted invitations for the authenticated user
router.get("/invitations", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const invitations = await listPendingInvitations(auth.accessToken);
    res.json({ invitations });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/invitations/:invitationId/respond - Accept or decline an invitation
router.post("/invitations/:invitationId/respond", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const invitationId = invitationIdParamSchema.parse(req.params.invitationId);
    const body = respondInvitationBodySchema.parse(req.body);
    const invitation = await respondToInvitation(auth.accessToken, invitationId, body.accept);
    res.json({ invitation });
  } catch (err) {
    next(err);
  }
});

const invitationSendLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyPrefix: "workspace_invitations",
  message: "Too many invitations sent. Please wait a few minutes and try again.",
});

const dueRemindersLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "workspace_due_reminders",
  message: "Too many due reminder broadcasts. Please wait 15 minutes and try again.",
});

// POST /notifications/organizations/:organizationId/invitations - Send targeted workspace invitation
router.post("/organizations/:organizationId/invitations", invitationSendLimiter, async (req, res, next) => {
  try {
    const auth = req.auth!;
    const organizationId = organizationIdParamSchema.parse(req.params.organizationId);
    const body = createInvitationBodySchema.parse(req.body);
    const invitation = await inviteMemberByEmail(
      auth.accessToken,
      organizationId,
      body.email,
      body.role,
    );
    res.status(201).json({ invitation });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/organizations/:organizationId/reminders - Trigger due payment reminders
router.post("/organizations/:organizationId/reminders", dueRemindersLimiter, async (req, res, next) => {
  try {
    const auth = req.auth!;
    const organizationId = organizationIdParamSchema.parse(req.params.organizationId);
    const body = dueRemindersBodySchema.parse(req.body);
    const sentCount = await sendWorkspaceDueReminders(
      auth.accessToken,
      organizationId,
      body.daysAhead,
    );
    res.json({ sentCount });
  } catch (err) {
    next(err);
  }
});

export default router;
