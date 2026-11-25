import { createServiceClient, createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";

export type PlatformRole = "user" | "admin" | "super_admin";
export type SecurityCategory =
  | "auth"
  | "access_control"
  | "financial"
  | "api_abuse"
  | "data_protection"
  | "operational";
export type SecurityEventClass = "operational" | "security" | "audit";
export type SecuritySeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "resolved" | "false_positive";

function mapAdminRpcError(
  error: { message?: string; code?: string } | null,
  fallback: string,
  rpcName?: string,
): AppError {
  const msg = error?.message ?? "";
  if (msg.includes("Platform administrator access required") || msg.includes("Super administrator access required")) {
    return new AppError(403, msg);
  }
  if (
    msg.includes("Cannot demote the last super_admin") ||
    msg.includes("Cannot suspend") ||
    msg.includes("Suspension reason") ||
    msg.includes("Invalid")
  ) {
    return new AppError(400, msg);
  }
  if (
    msg.includes("User profile not found") ||
    msg.includes("Organization not found") ||
    msg.includes("Security incident not found")
  ) {
    return new AppError(404, msg);
  }
  console.error("[admin.rpc.503]", {
    rpc: rpcName ?? "unknown",
    code: error?.code ?? "unknown",
    message: msg.slice(0, 200),
  });
  return new AppError(503, fallback);
}

export async function getPlatformOverview(accessToken: string) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_overview");
  if (error) throw mapAdminRpcError(error, "Platform overview is temporarily unavailable.");
  return data;
}

export async function requirePlatformAdmin(accessToken: string) {
  const { data, error } = await createUserClient(accessToken).rpc("is_platform_admin", {
    required_super: false,
  });
  if (error) throw mapAdminRpcError(error, "Platform access verification is temporarily unavailable.", "is_platform_admin");
  if (data !== true) throw new AppError(403, "Platform administrator access required");
}

export async function pingPlatformDatabase(accessToken: string): Promise<{
  dbStatus: "ok" | "degraded";
  dbLatencyMs: number;
}> {
  const start = performance.now();
  const { error } = await createUserClient(accessToken).rpc("platform_admin_health_ping");
  const dbLatencyMs = Number((performance.now() - start).toFixed(1));
  if (error) {
    return { dbStatus: "degraded", dbLatencyMs };
  }
  return { dbStatus: "ok", dbLatencyMs };
}

export async function recordDataProtectionEvent(
  actorId: string,
  action: string,
  route: string,
  requestId: string | undefined,
  metadata: Record<string, unknown> = {}
) {
  if (process.env.NODE_ENV === "test") return;
  try {
    await createServiceClient()?.rpc("record_authenticated_security_event", {
      p_actor_id: actorId,
      p_category: "data_protection",
      p_severity: "low",
      p_action: action,
      p_outcome: "flagged",
      p_http_status: 200,
      p_route: route,
      p_request_id: requestId ?? null,
      p_organization_id: null,
      p_metadata: metadata,
    });
  } catch {
    // Best-effort telemetry; never block export response
  }
}

export async function listPlatformUsers(
  accessToken: string,
  params: { search?: string; role?: PlatformRole; limit?: number; offset?: number }
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_list_users", {
    p_search: params.search ?? "",
    p_role: params.role ?? null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });
  if (error) throw mapAdminRpcError(error, "User directory is temporarily unavailable.");
  return data;
}

export async function setPlatformUserRole(
  accessToken: string,
  targetUserId: string,
  newRole: PlatformRole
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_set_user_role", {
    p_target_user_id: targetUserId,
    p_new_role: newRole,
  });
  if (error) throw mapAdminRpcError(error, "Could not update platform role.");
  return data;
}

export async function listPlatformOrganizations(
  accessToken: string,
  params: { search?: string; limit?: number; offset?: number }
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_list_organizations", {
    p_search: params.search ?? "",
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });
  if (error) throw mapAdminRpcError(error, "Organizations list is temporarily unavailable.");
  return data;
}

export async function listPlatformAuditLogs(
  accessToken: string,
  params: { action?: string; from?: string; to?: string; limit?: number; offset?: number }
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_list_audit_logs", {
    p_action: params.action ?? "",
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) throw mapAdminRpcError(error, "Audit logs are temporarily unavailable.");
  return data as {
    logs: Array<{
      id: number;
      organization_id: string | null;
      organization_name: string | null;
      actor_id: string | null;
      actor_name: string | null;
      action: string;
      entity_id: string;
      before_value: Record<string, unknown> | null;
      after_value: Record<string, unknown> | null;
      occurred_at: string;
    }>;
    total: number;
  };
}

export async function getPlatformSecurityOverview(accessToken: string, days = 7) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_security_overview", {
    p_days: days,
  });
  if (error) throw mapAdminRpcError(error, "Security overview is temporarily unavailable.");
  return data;
}

export async function listPlatformSecurityEvents(
  accessToken: string,
  params: {
    category?: SecurityCategory;
    severity?: SecuritySeverity;
    eventClass?: SecurityEventClass;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_list_security_events", {
    p_category: params.category ?? null,
    p_severity: params.severity ?? null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
    p_event_class: params.eventClass ?? null,
  });
  if (error) throw mapAdminRpcError(error, "Security events are temporarily unavailable.", "platform_admin_list_security_events");
  return data as {
    events: Array<{
      id: number;
      occurred_at: string;
      category: SecurityCategory;
      severity: SecuritySeverity;
      action: string;
      actor_id: string | null;
      actor_name: string | null;
      organization_id: string | null;
      organization_name: string | null;
      http_status: number | null;
      route: string | null;
      request_id: string | null;
      outcome: string;
    }>;
    total: number;
  };
}

export async function listPlatformIncidents(
  accessToken: string,
  params: { status?: IncidentStatus; severity?: SecuritySeverity; limit?: number; offset?: number }
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_list_incidents", {
    p_status: params.status ?? null,
    p_severity: params.severity ?? null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });
  if (error) throw mapAdminRpcError(error, "Security incidents are temporarily unavailable.");
  return data;
}

export async function createPlatformIncident(
  accessToken: string,
  payload: {
    title: string;
    category: SecurityCategory;
    severity: SecuritySeverity;
    organizationId?: string;
    eventIds?: number[];
    notes?: string;
  }
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_create_incident", {
    p_title: payload.title,
    p_category: payload.category,
    p_severity: payload.severity,
    p_organization_id: payload.organizationId ?? null,
    p_event_ids: payload.eventIds ?? [],
    p_notes: payload.notes ?? null,
  });
  if (error) throw mapAdminRpcError(error, "Could not create security incident.");
  return data;
}

export async function updatePlatformIncident(
  accessToken: string,
  incidentId: string,
  payload: { status: IncidentStatus; resolutionNotes?: string; assignedTo?: string }
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_update_incident", {
    p_incident_id: incidentId,
    p_status: payload.status,
    p_resolution_notes: payload.resolutionNotes ?? null,
    p_assigned_to: payload.assignedTo ?? null,
  });
  if (error) throw mapAdminRpcError(error, "Could not update security incident.");
  return data;
}

export async function setPlatformUserSuspension(
  accessToken: string,
  targetUserId: string,
  suspended: boolean,
  reason?: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_set_user_suspension", {
    p_target_user_id: targetUserId,
    p_suspended: suspended,
    p_reason: reason ?? null,
  });
  if (error) throw mapAdminRpcError(error, "Could not update user suspension status.");
  return data;
}

export async function setPlatformOrgSuspension(
  accessToken: string,
  orgId: string,
  suspended: boolean,
  reason?: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_set_org_suspension", {
    p_org_id: orgId,
    p_suspended: suspended,
    p_reason: reason ?? null,
  });
  if (error) throw mapAdminRpcError(error, "Could not update organization suspension status.");
  return data;
}

export async function getPlatformFinancialOverview(accessToken: string) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_financial_overview");
  if (error) throw mapAdminRpcError(error, "Financial overview is temporarily unavailable.");
  return data;
}

export async function listPlatformFinancialAnomalies(accessToken: string) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_financial_anomalies");
  if (error) throw mapAdminRpcError(error, "Financial anomalies are temporarily unavailable.");
  return data;
}

export async function getPlatformAttentionSummary(accessToken: string, days: number) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_attention_summary", {
    p_days: days,
  });
  if (error) throw mapAdminRpcError(error, "Attention summary is temporarily unavailable.");
  return data;
}

export async function getPlatformWorkspace360(accessToken: string, organizationId: string) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_workspace_360", {
    p_org_id: organizationId,
  });
  if (error) throw mapAdminRpcError(error, "Workspace 360 details are temporarily unavailable.");
  return data;
}

export async function getPlatformFinancialCompliance(accessToken: string) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_financial_compliance");
  if (error) throw mapAdminRpcError(error, "Financial compliance details are temporarily unavailable.");
  return data;
}

export async function getPlatformThreatOverview(accessToken: string, days: number) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_threat_overview_with_flags", {
    p_days: days,
  });
  if (error) throw mapAdminRpcError(error, "Threat detection overview is temporarily unavailable.");
  return data;
}

export type EnforcementActionType =
  | "monitor"
  | "temp_ip_block"
  | "temp_account_lock"
  | "revoke_sessions"
  | "suspend_account"
  | "remove_restriction";

export async function enforcePlatformAction(
  accessToken: string,
  payload: {
    actionType: EnforcementActionType;
    reason: string;
    targetIp?: string;
    targetUserId?: string;
    durationMinutes?: number;
  },
) {
  const { data, error } = await createUserClient(accessToken).rpc("platform_admin_enforce_action", {
    p_action_type: payload.actionType,
    p_reason: payload.reason,
    p_target_ip: payload.targetIp ?? null,
    p_target_user_id: payload.targetUserId ?? null,
    p_duration_minutes: payload.durationMinutes ?? 60,
  });
  if (error) throw mapAdminRpcError(error, "Unable to apply enforcement action.");
  return data;
}

export async function getAdminAIOverview(accessToken: string, days: number, tzOffsetMinutes = 0) {
  const client = createUserClient(accessToken);
  let { data, error } = await client.rpc("admin_get_ai_overview", {
    p_days: days,
    p_tz_offset_minutes: tzOffsetMinutes,
  });
  if (error && (error.code === "PGRST202" || error.message?.includes("p_tz_offset_minutes"))) {
    ({ data, error } = await client.rpc("admin_get_ai_overview", {
      p_days: days,
    }));
  }
  if (error) throw mapAdminRpcError(error, "Bani AI telemetry is temporarily unavailable.");
  return data;
}

export async function listAdminAIWorkspaces(
  accessToken: string,
  days: number,
  search?: string,
  limit = 50,
) {
  const { data, error } = await createUserClient(accessToken).rpc("admin_list_ai_workspace_usage", {
    p_days: days,
    p_search: search ?? "",
    p_limit: limit,
  });
  if (error) throw mapAdminRpcError(error, "Workspace AI usage is temporarily unavailable.");
  return data;
}

export async function setAdminWorkspaceAIQuota(
  accessToken: string,
  payload: {
    organizationId: string;
    aiEnabled: boolean;
    dailyRequestLimit: number;
    monthlyTokenLimit: number;
    reason: string;
  },
) {
  const { data, error } = await createUserClient(accessToken).rpc("admin_set_workspace_ai_quota", {
    p_organization_id: payload.organizationId,
    p_ai_enabled: payload.aiEnabled,
    p_daily_request_limit: payload.dailyRequestLimit,
    p_monthly_token_limit: payload.monthlyTokenLimit,
    p_reason: payload.reason,
  });
  if (error) throw mapAdminRpcError(error, "Unable to update workspace AI quota.");
  return data;
}

export async function getAdminUserDetails(accessToken: string, userId: string) {
  const { data, error } = await createUserClient(accessToken).rpc("admin_get_user_details", {
    p_user_id: userId,
  });
  if (error) throw mapAdminRpcError(error, "User account history is temporarily unavailable.");
  return data;
}

export async function getAdminOrg360Extended(accessToken: string, organizationId: string, days: number) {
  const { data, error } = await createUserClient(accessToken).rpc("admin_get_org_360_extended", {
    p_organization_id: organizationId,
    p_days: days,
  });
  if (error) throw mapAdminRpcError(error, "Extended workspace activity is temporarily unavailable.");
  return data;
}

export async function getAdminFinancialTrends(accessToken: string, days: number) {
  const { data, error } = await createUserClient(accessToken).rpc("admin_get_financial_trends", {
    p_days: days,
  });
  if (error) throw mapAdminRpcError(error, "Financial trends are temporarily unavailable.");
  return data;
}

export async function getAdminSecurityHeatmapFiltered(
  accessToken: string,
  params: {
    days: number;
    startDate?: string;
    endDate?: string;
    tzOffsetMinutes: number;
    eventType?: string;
  },
) {
  const { data, error } = await createUserClient(accessToken).rpc("admin_get_security_heatmap_filtered", {
    p_days: params.days,
    p_start_date: params.startDate ?? null,
    p_end_date: params.endDate ?? null,
    p_tz_offset_minutes: params.tzOffsetMinutes,
    p_event_type: params.eventType ?? null,
  });
  if (error) throw mapAdminRpcError(error, "Security heatmap is temporarily unavailable.");
  return data;
}

export async function getPlatformSessionTimeout(accessToken: string) {
  const { data, error } = await createUserClient(accessToken).rpc("get_platform_session_timeout");
  if (error) throw mapAdminRpcError(error, "Session timeout policy is temporarily unavailable.");
  return data;
}

export async function setPlatformSessionTimeout(
  accessToken: string,
  policy: { idleSeconds: number; absoluteSeconds: number; superAdminExempt: boolean; reason: string },
) {
  const { data, error } = await createUserClient(accessToken).rpc("admin_set_session_timeout", {
    p_idle_seconds: policy.idleSeconds,
    p_absolute_seconds: policy.absoluteSeconds,
    p_super_admin_exempt: policy.superAdminExempt,
    p_reason: policy.reason,
  });
  if (error) throw mapAdminRpcError(error, "Unable to update session timeout policy.");
  return data;
}

export interface LoginLockoutPolicy {
  account_failures_per_tier: number;
  account_tier_seconds: number[];
  ip_failure_threshold: number;
  ip_window_seconds: number;
  ip_block_seconds: number;
  edge_failure_threshold: number;
  edge_window_seconds: number;
  edge_block_seconds: number;
}

export async function getPlatformLoginLockout(accessToken: string) {
  const { data, error } = await createUserClient(accessToken).rpc("get_platform_login_lockout");
  if (error) throw mapAdminRpcError(error, "Login lockout policy is temporarily unavailable.");
  return data;
}

export async function setPlatformLoginLockout(accessToken: string, policy: LoginLockoutPolicy, reason: string) {
  const { data, error } = await createUserClient(accessToken).rpc("admin_set_login_lockout", {
    p_policy: policy,
    p_reason: reason,
  });
  if (error) throw mapAdminRpcError(error, "Unable to update login lockout policy.");
  return data;
}
