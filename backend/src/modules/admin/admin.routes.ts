import { Router } from "express";
import { z } from "zod";
import { createServiceClient, createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";
import { createRateLimiter } from "../../middleware/rateLimit";
import { quoteDirectoryCsvCell } from "../../utils/directoryCsv";
import {
  createPlatformIncident,
  enforcePlatformAction,
  getAdminAIOverview,
  getAdminFinancialTrends,
  getAdminOrg360Extended,
  getAdminSecurityHeatmapFiltered,
  getAdminUserDetails,
  getPlatformAttentionSummary,
  getPlatformFinancialCompliance,
  getPlatformFinancialOverview,
  getPlatformOverview,
  getPlatformSecurityOverview,
  getPlatformSessionTimeout,
  getPlatformThreatOverview,
  getPlatformWorkspace360,
  listAdminAIWorkspaces,
  listPlatformAuditLogs,
  listPlatformFinancialAnomalies,
  listPlatformIncidents,
  listPlatformOrganizations,
  listPlatformSecurityEvents,
  listPlatformUsers,
  pingPlatformDatabase,
  recordDataProtectionEvent,
  requirePlatformAdmin,
  setAdminWorkspaceAIQuota,
  setPlatformOrgSuspension,
  setPlatformSessionTimeout,
  getPlatformLoginLockout,
  setPlatformLoginLockout,
  setPlatformUserRole,
  setPlatformUserSuspension,
  updatePlatformIncident,
} from "./admin.repository";

const router = Router();

const platformRoleSchema = z.enum(["user", "admin", "super_admin"]);
const securityCategorySchema = z.enum(["auth", "access_control", "financial", "api_abuse", "data_protection", "operational"]);
const securityEventClassSchema = z.enum(["operational", "security", "audit"]);
const securitySeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const incidentStatusSchema = z.enum(["open", "investigating", "resolved", "false_positive"]);
const isoDateTimeSchema = z.string().datetime({ offset: true }).optional();

const adminMutationLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyPrefix: "platform-admin-mutation",
  message: "Too many administrative updates. Please wait a moment.",
});

router.post("/security/dashboard-entry", adminMutationLimiter, async (req, res) => {
  await requirePlatformAdmin(req.auth!.accessToken);
  const service = createServiceClient();
  if (!service) throw new AppError(503, "Dashboard audit is temporarily unavailable.");
  const requestId = res.getHeader("X-Request-Id");
  const { error } = await service.rpc("record_authenticated_security_event", {
    p_actor_id: req.auth!.user.id,
    p_category: "access_control",
    p_severity: "low",
    p_action: "ADMIN_VIEWED_DASHBOARD",
    p_outcome: "flagged",
    p_http_status: 204,
    p_route: "/admin/security/dashboard-entry",
    p_request_id: typeof requestId === "string" ? requestId : null,
  });
  if (error) throw new AppError(503, "Dashboard audit is temporarily unavailable.");
  res.sendStatus(204);
});

router.get("/overview", async (req, res, next) => {
  try {
    const [overview, dbHealth] = await Promise.all([
      getPlatformOverview(req.auth!.accessToken),
      pingPlatformDatabase(req.auth!.accessToken),
    ]);
    res.json({
      overview,
      health: {
        status: dbHealth.dbStatus === "ok" ? "ok" : "degraded",
        uptimeSeconds: Math.floor(process.uptime()),
        nodeEnv: process.env.NODE_ENV ?? "development",
        dbStatus: dbHealth.dbStatus,
        dbLatencyMs: dbHealth.dbLatencyMs,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/realtime-visitors", async (req, res, next) => {
  try {
    await requirePlatformAdmin(req.auth!.accessToken);
    res.json({
      realtime: {
        activeTotal: 0,
        activeAuthenticated: 0,
        activeAnonymous: 0,
        pageviews24h: 0,
        uniqueVisitors24h: 0,
        topPaths: [],
        source: "disabled",
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const query = z.object({
      q: z.string().trim().max(100).optional(),
      role: platformRoleSchema.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(25),
      offset: z.coerce.number().int().min(0).max(10000).optional().default(0),
    }).parse(req.query);
    const data = await listPlatformUsers(req.auth!.accessToken, {
      search: query.q,
      role: query.role,
      limit: query.limit,
      offset: query.offset,
    });
    const onlineSet = new Set<string>();
    const rawUsers = Array.isArray((data as { users?: unknown[] })?.users)
      ? ((data as { users: Array<{ id: string; username?: string | null }> }).users)
      : [];
    const userIds = rawUsers.map((u) => u.id).filter(Boolean);
    const usernameMap = new Map<string, string | null>();
    if (userIds.length > 0) {
      const { data: profiles } = await createUserClient(req.auth!.accessToken)
        .from("profiles")
        .select("id, username")
        .in("id", userIds);
      for (const profile of profiles ?? []) {
        if (profile?.id) {
          usernameMap.set(profile.id, (profile as { username?: string | null }).username ?? null);
        }
      }
    }
    res.json({
      ...(data as Record<string, unknown>),
      users: rawUsers.map((u) => ({
        ...u,
        username: usernameMap.get(u.id) ?? u.username ?? null,
        is_online: onlineSet.has(u.id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:userId/role", adminMutationLimiter, async (req, res, next) => {
  try {
    const targetUserId = z.string().uuid("Invalid user ID.").parse(req.params.userId);
    const { role } = z.object({ role: platformRoleSchema }).strict().parse(req.body);
    const result = await setPlatformUserRole(req.auth!.accessToken, targetUserId, role);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:userId/suspension", adminMutationLimiter, async (req, res, next) => {
  try {
    const targetUserId = z.string().uuid("Invalid user ID.").parse(req.params.userId);
    const { suspended, reason } = z.object({
      suspended: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    }).strict().parse(req.body);
    const result = await setPlatformUserSuspension(req.auth!.accessToken, targetUserId, suspended, reason);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

router.patch("/organizations/:organizationId/suspension", adminMutationLimiter, async (req, res, next) => {
  try {
    const orgId = z.string().uuid("Invalid organization ID.").parse(req.params.organizationId);
    const { suspended, reason } = z.object({
      suspended: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    }).strict().parse(req.body);
    const result = await setPlatformOrgSuspension(req.auth!.accessToken, orgId, suspended, reason);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

router.get("/financial/overview", async (req, res, next) => {
  try {
    const overview = await getPlatformFinancialOverview(req.auth!.accessToken);
    res.json({ overview });
  } catch (err) {
    next(err);
  }
});

router.get("/financial/anomalies", async (req, res, next) => {
  try {
    const data = await listPlatformFinancialAnomalies(req.auth!.accessToken);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/organizations", async (req, res, next) => {
  try {
    const query = z.object({
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(25),
      offset: z.coerce.number().int().min(0).max(10000).optional().default(0),
    }).parse(req.query);
    const data = await listPlatformOrganizations(req.auth!.accessToken, {
      search: query.q,
      limit: query.limit,
      offset: query.offset,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs", async (req, res, next) => {
  try {
    const query = z.object({
      action: z.string().trim().max(100).optional(),
      from: isoDateTimeSchema,
      to: isoDateTimeSchema,
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      offset: z.coerce.number().int().min(0).max(10000).optional().default(0),
    }).parse(req.query);
    const data = await listPlatformAuditLogs(req.auth!.accessToken, {
      action: query.action,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs/export", adminMutationLimiter, async (req, res, next) => {
  try {
    const query = z.object({
      action: z.string().trim().max(100).optional(),
      from: isoDateTimeSchema,
      to: isoDateTimeSchema,
    }).parse(req.query);

    const { logs } = await listPlatformAuditLogs(req.auth!.accessToken, {
      action: query.action,
      from: query.from,
      to: query.to,
      limit: 100,
      offset: 0,
    });

    res.attachment("platform-audit-logs.csv").type("text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    void recordDataProtectionEvent(
      req.auth!.user.id,
      "audit_logs_exported",
      "/admin/audit-logs/export",
      typeof res.getHeader("X-Request-Id") === "string" ? (res.getHeader("X-Request-Id") as string) : undefined,
      { rowCount: logs.length }
    );
    const lines = [
      ["ID", "Occurred At", "Action", "Actor Name", "Actor ID", "Organization", "Entity ID"].map(quoteDirectoryCsvCell).join(","),
      ...logs.map((l) =>
        [
          l.id,
          l.occurred_at,
          l.action,
          l.actor_name ?? "",
          l.actor_id ?? "",
          l.organization_name ?? "Platform",
          l.entity_id,
        ]
          .map(quoteDirectoryCsvCell)
          .join(",")
      ),
    ];
    res.send(lines.join("\r\n") + "\r\n");
  } catch (err) {
    next(err);
  }
});

router.get("/security/overview", async (req, res, next) => {
  try {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).optional().default(7) }).parse(req.query);
    const overview = await getPlatformSecurityOverview(req.auth!.accessToken, days);
    res.json({ overview });
  } catch (err) {
    next(err);
  }
});

router.get("/security/events", async (req, res, next) => {
  try {
    const query = z.object({
      category: securityCategorySchema.optional(),
      severity: securitySeveritySchema.optional(),
      eventClass: securityEventClassSchema.optional(),
      from: isoDateTimeSchema,
      to: isoDateTimeSchema,
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      offset: z.coerce.number().int().min(0).max(10000).optional().default(0),
    }).parse(req.query);
    const data = await listPlatformSecurityEvents(req.auth!.accessToken, query);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/security/events/export", adminMutationLimiter, async (req, res, next) => {
  try {
    const query = z.object({
      category: securityCategorySchema.optional(),
      severity: securitySeveritySchema.optional(),
      from: isoDateTimeSchema,
      to: isoDateTimeSchema,
    }).parse(req.query);

    const { events } = await listPlatformSecurityEvents(req.auth!.accessToken, {
      ...query,
      limit: 100,
      offset: 0,
    });

    res.attachment("platform-security-events.csv").type("text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    void recordDataProtectionEvent(
      req.auth!.user.id,
      "security_events_exported",
      "/admin/security/events/export",
      typeof res.getHeader("X-Request-Id") === "string" ? (res.getHeader("X-Request-Id") as string) : undefined,
      { rowCount: events.length }
    );
    const lines = [
      ["ID", "Occurred At", "Severity", "Category", "Action", "Outcome", "HTTP Status", "Route", "Actor Name", "Actor ID", "Organization", "Request ID"]
        .map(quoteDirectoryCsvCell)
        .join(","),
      ...events.map((ev) =>
        [
          ev.id,
          ev.occurred_at,
          ev.severity,
          ev.category,
          ev.action,
          ev.outcome,
          ev.http_status ?? "",
          ev.route ?? "",
          ev.actor_name ?? "",
          ev.actor_id ?? "",
          ev.organization_name ?? "Platform",
          ev.request_id ?? "",
        ]
          .map(quoteDirectoryCsvCell)
          .join(",")
      ),
    ];
    res.send(lines.join("\r\n") + "\r\n");
  } catch (err) {
    next(err);
  }
});

router.get("/security/incidents", async (req, res, next) => {
  try {
    const query = z.object({
      status: incidentStatusSchema.optional(),
      severity: securitySeveritySchema.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(25),
      offset: z.coerce.number().int().min(0).max(10000).optional().default(0),
    }).parse(req.query);
    const data = await listPlatformIncidents(req.auth!.accessToken, query);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post("/security/incidents", adminMutationLimiter, async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().trim().min(3).max(200),
      category: securityCategorySchema,
      severity: securitySeveritySchema,
      organizationId: z.string().uuid().optional(),
      eventIds: z.array(z.number().int().positive()).max(50).optional(),
      notes: z.string().trim().max(2000).optional(),
    }).strict().parse(req.body);
    const incident = await createPlatformIncident(req.auth!.accessToken, body);
    res.status(201).json({ incident });
  } catch (err) {
    next(err);
  }
});

router.patch("/security/incidents/:incidentId", adminMutationLimiter, async (req, res, next) => {
  try {
    const incidentId = z.string().uuid("Invalid incident ID.").parse(req.params.incidentId);
    const body = z.object({
      status: incidentStatusSchema,
      resolutionNotes: z.string().trim().max(2000).optional(),
      assignedTo: z.string().uuid().optional(),
    }).strict().parse(req.body);
    const incident = await updatePlatformIncident(req.auth!.accessToken, incidentId, body);
    res.json({ incident });
  } catch (err) {
    next(err);
  }
});

router.get("/attention-summary", async (req, res, next) => {
  try {
    const days = z.coerce.number().int().min(1).max(90).default(7).parse(req.query.days);
    const summary = await getPlatformAttentionSummary(req.auth!.accessToken, days);
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

router.get("/organizations/:organizationId/360", async (req, res, next) => {
  try {
    const organizationId = z.string().uuid("Invalid organization ID.").parse(req.params.organizationId);
    const workspace360 = await getPlatformWorkspace360(req.auth!.accessToken, organizationId);
    res.json({ workspace360 });
  } catch (err) {
    next(err);
  }
});

router.get("/financial/compliance", async (req, res, next) => {
  try {
    const compliance = await getPlatformFinancialCompliance(req.auth!.accessToken);
    res.json({ compliance });
  } catch (err) {
    next(err);
  }
});

router.get("/security/threats", async (req, res, next) => {
  try {
    const days = z.coerce.number().int().min(1).max(90).default(7).parse(req.query.days);
    const overview = await getPlatformThreatOverview(req.auth!.accessToken, days);
    res.json({ overview });
  } catch (err) {
    next(err);
  }
});

const enforcementActionSchema = z.enum([
  "monitor",
  "temp_ip_block",
  "temp_account_lock",
  "revoke_sessions",
  "suspend_account",
  "remove_restriction",
]);

router.post("/security/enforce", adminMutationLimiter, async (req, res, next) => {
  try {
    const body = z.object({
      actionType: enforcementActionSchema,
      reason: z.string().trim().min(3, "Enforcement reason must be at least 3 characters.").max(500),
      targetIp: z.string().trim().min(3).max(100).optional(),
      targetUserId: z.string().uuid("Invalid target user ID.").optional(),
      durationMinutes: z.coerce.number().int().min(5).max(43200).optional(),
    }).strict().parse(req.body);
    const result = await enforcePlatformAction(req.auth!.accessToken, body);
    res.status(201).json({ result });
  } catch (err) {
    next(err);
  }
});

router.get("/ai/overview", async (req, res, next) => {
  try {
    const query = z.object({
      days: z.coerce.number().int().min(1).max(90).default(7),
      tzOffsetMinutes: z.coerce.number().int().min(-720).max(840).default(0),
    }).parse(req.query);
    const overview = await getAdminAIOverview(req.auth!.accessToken, query.days, query.tzOffsetMinutes);
    res.json({ overview });
  } catch (err) {
    next(err);
  }
});

router.get("/ai/workspaces", async (req, res, next) => {
  try {
    const query = z.object({
      days: z.coerce.number().int().min(1).max(90).default(7),
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    const data = await listAdminAIWorkspaces(req.auth!.accessToken, query.days, query.q, query.limit);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.patch("/ai/workspaces/:organizationId/quota", adminMutationLimiter, async (req, res, next) => {
  try {
    const organizationId = z.string().uuid("Invalid Organization ID.").parse(req.params.organizationId);
    const body = z.object({
      aiEnabled: z.boolean(),
      dailyRequestLimit: z.coerce.number().int().min(0).max(100000),
      monthlyTokenLimit: z.coerce.number().int().min(0).max(500000000),
      reason: z.string().trim().min(3, "Reason must be at least 3 characters.").max(500),
    }).strict().parse(req.body);
    const quota = await setAdminWorkspaceAIQuota(req.auth!.accessToken, {
      organizationId,
      ...body,
    });
    res.json({ quota });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:userId/details", async (req, res, next) => {
  try {
    const userId = z.string().uuid("Invalid User ID.").parse(req.params.userId);
    const details = await getAdminUserDetails(req.auth!.accessToken, userId);
    res.json({ details });
  } catch (err) {
    next(err);
  }
});

router.get("/organizations/:organizationId/360/extended", async (req, res, next) => {
  try {
    const organizationId = z.string().uuid("Invalid Organization ID.").parse(req.params.organizationId);
    const days = z.coerce.number().int().min(1).max(90).default(30).parse(req.query.days);
    const extended = await getAdminOrg360Extended(req.auth!.accessToken, organizationId, days);
    res.json({ extended });
  } catch (err) {
    next(err);
  }
});

router.get("/financial/trends", async (req, res, next) => {
  try {
    const days = z.coerce.number().int().min(7).max(90).default(30).parse(req.query.days);
    const trends = await getAdminFinancialTrends(req.auth!.accessToken, days);
    res.json({ trends });
  } catch (err) {
    next(err);
  }
});

router.get("/security/heatmap", async (req, res, next) => {
  try {
    const query = z.object({
      days: z.coerce.number().int().min(1).max(90).default(7),
      startDate: isoDateTimeSchema,
      endDate: isoDateTimeSchema,
      tzOffsetMinutes: z.coerce.number().int().min(-720).max(840).default(0),
      eventType: z.string().trim().max(80).optional(),
    }).parse(req.query);
    const data = await getAdminSecurityHeatmapFiltered(req.auth!.accessToken, {
      days: query.days,
      startDate: query.startDate,
      endDate: query.endDate,
      tzOffsetMinutes: query.tzOffsetMinutes,
      eventType: query.eventType || undefined,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/settings/session-timeout", async (req, res, next) => {
  try {
    const setting = await getPlatformSessionTimeout(req.auth!.accessToken);
    res.json({ setting });
  } catch (err) {
    next(err);
  }
});

router.patch("/settings/session-timeout", adminMutationLimiter, async (req, res, next) => {
  try {
    const duration = z.number().int().refine((seconds) => seconds === 0 || (seconds >= 5 && seconds <= 2592000), {
      message: "Use 0 to disable a deadline, or enter 5 to 2592000 seconds.",
    });
    const body = z.object({
      idleSeconds: duration,
      absoluteSeconds: duration,
      superAdminExempt: z.boolean(),
      reason: z.string().trim().min(3).max(500),
    }).strict().parse(req.body);
    const setting = await setPlatformSessionTimeout(req.auth!.accessToken, body);
    res.json({ setting });
  } catch (err) {
    next(err);
  }
});

router.get("/settings/login-lockout", async (req, res, next) => {
  try {
    const setting = await getPlatformLoginLockout(req.auth!.accessToken);
    res.json({ setting });
  } catch (err) {
    next(err);
  }
});

router.patch("/settings/login-lockout", adminMutationLimiter, async (req, res, next) => {
  try {
    const seconds = (min: number) => z.number().int().min(min).max(86400);
    const count = z.number().int().min(3).max(1000);
    const { reason, ...policy } = z.object({
      account_failures_per_tier: z.number().int().min(1).max(20),
      account_tier_seconds: z.array(seconds(1)).min(1).max(10),
      ip_failure_threshold: count,
      ip_window_seconds: seconds(60),
      ip_block_seconds: seconds(30),
      edge_failure_threshold: count,
      edge_window_seconds: seconds(60),
      edge_block_seconds: seconds(30),
      reason: z.string().trim().min(3).max(500),
    }).strict().parse(req.body);
    const setting = await setPlatformLoginLockout(req.auth!.accessToken, policy, reason);
    res.json({ setting });
  } catch (err) {
    next(err);
  }
});

router.get("/settings/demo-exemption", async (req, res, next) => {
  try {
    const { data, error } = await createUserClient(req.auth!.accessToken).rpc("get_platform_demo_exemption");
    if (error) throw new AppError(403, "Demo exemption settings are unavailable or access is denied.");
    res.setHeader("Cache-Control", "no-store");
    res.json(data);
  } catch (error) { next(error); }
});
router.patch("/settings/demo-exemption", adminMutationLimiter, async (req, res, next) => {
  try {
    const input = z.object({ account_lockout: z.boolean(), ip_restriction: z.boolean(), minutes: z.number().int().min(5).max(120), reason: z.string().trim().min(3).max(500) }).strict().parse(req.body);
    const { data, error } = await createUserClient(req.auth!.accessToken).rpc("set_platform_demo_exemption", {
      p_account: input.account_lockout, p_ip: input.ip_restriction, p_minutes: input.minutes, p_reason: input.reason,
    });
    if (error) throw new AppError(403, "Could not update demo exemption settings.");
    res.setHeader("Cache-Control", "no-store");
    res.json(data);
  } catch (error) { next(error); }
});
export default router;
