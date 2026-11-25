import { createHash, randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { createServiceClient, createUserClient } from "../config/supabase";
import { inspectJwtClaims, readBearerToken } from "./authenticate";
import { isAllowlistedIp } from "../utils/ipAllowlist";

const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PASSIVE_BEARER_401_DEDUPE_WINDOW_MS = 60_000;
const MAX_PASSIVE_BEARER_DEDUPE_ENTRIES = 2000;

export interface SecurityEventContext {
  method?: string;
  hasBearerToken?: boolean;
  sessionExpiredOrRevoked?: boolean;
}

function normalizeRoutePath(path: string): string {
  const withoutQuery = path.split("?")[0] || "/";
  return withoutQuery.replace(/\/+$/, "") || "/";
}

function isAnalyticsHeartbeatPath(path: string): boolean {
  return normalizeRoutePath(path) === "/analytics/heartbeat";
}

function isSkippedRestrictionRequest(req: {
  method?: string;
  baseUrl?: string;
  path?: string;
  originalUrl?: string;
}): boolean {
  if (req.method?.toUpperCase() === "OPTIONS") {
    return true;
  }
  const combined = `${req.baseUrl || ""}${req.path || ""}` || req.originalUrl || "/";
  const normalized = normalizeRoutePath(combined);
  return (
    normalized === "/health" ||
    normalized === "/analytics/heartbeat" ||
    normalized === "/auth/username-availability" ||
    normalized === "/auth/password-history/status" ||
    normalized === "/auth/turnstile/verify"
  );
}

function hashTokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function shouldDeduplicatePassiveBearer401(
  seenAt: Map<string, number>,
  dedupeKey: string,
  nowMs: number
): boolean {
  const previous = seenAt.get(dedupeKey);
  if (previous !== undefined && nowMs - previous < PASSIVE_BEARER_401_DEDUPE_WINDOW_MS) {
    return true;
  }
  if (seenAt.size >= MAX_PASSIVE_BEARER_DEDUPE_ENTRIES) {
    for (const [key, timestamp] of seenAt) {
      if (nowMs - timestamp >= PASSIVE_BEARER_401_DEDUPE_WINDOW_MS) {
        seenAt.delete(key);
      }
    }
    if (seenAt.size >= MAX_PASSIVE_BEARER_DEDUPE_ENTRIES) {
      const oldestKey = seenAt.keys().next().value;
      if (oldestKey !== undefined) {
        seenAt.delete(oldestKey);
      }
    }
  }
  seenAt.set(dedupeKey, nowMs);
  return false;
}

export function classifySecurityEvent(
  status: number,
  path: string,
  context?: SecurityEventContext
) {
  const normalizedPath = normalizeRoutePath(path);
  if (normalizedPath === "/analytics/heartbeat") {
    return null;
  }
  if (status >= 500) {
    return {
      category: "operational",
      eventSource: status === 503 ? "database" : "api",
      severity: status === 503 ? "low" : "medium",
      action: status === 503 ? "service_unavailable_503" : "server_error_5xx",
      outcome: "failed",
      enforcementEligible: false,
      classificationReason: "Backend or dependency service failure; excluded from user abuse attribution",
    };
  }
  if (status === 429) {
    return {
      category: "api_abuse",
      eventSource: "middleware",
      severity: "medium",
      action: "rate_limit_exceeded",
      outcome: "blocked",
      // Throttling is a consequence, not evidence of abuse; never counts toward IP blocks.
      enforcementEligible: false,
      classificationReason: "Request rate limit threshold exceeded",
    };
  }
  if (status === 401) {
    const isAuthCredentialPath = normalizedPath === "/auth/login" || normalizedPath.startsWith("/auth/");
    if (!isAuthCredentialPath && context?.sessionExpiredOrRevoked) {
      return null;
    }
    const method = (context?.method ?? "GET").toUpperCase();
    if (!isAuthCredentialPath && (method === "GET" || method === "HEAD") && context?.hasBearerToken) {
      return {
        category: "auth",
        eventSource: "auth",
        severity: "low",
        action: "unauthorized_auth_attempt",
        outcome: "denied",
        enforcementEligible: false,
        classificationReason: "Stale or unaccepted bearer token on passive read request",
      };
    }
    return {
      category: "auth",
      eventSource: "auth",
      severity: "low",
      action: "unauthorized_auth_attempt",
      outcome: "denied",
      enforcementEligible: true,
      classificationReason: "Missing, invalid, or revoked authentication token",
    };
  }
  if (status === 403) {
    if (path.includes("/expenses") || path.includes("/budgets") || path.includes("/collections") || path.includes("/cash-advances")) {
      return {
        category: "financial",
        eventSource: "middleware",
        severity: "medium",
        action: "financial_access_denied",
        outcome: "denied",
        enforcementEligible: true,
        classificationReason: "Unauthorized access attempt to financial resource",
      };
    }
    if (path.includes("/admin")) {
      return {
        category: "access_control",
        eventSource: "middleware",
        severity: "high",
        action: normalizedPath === "/admin/security/dashboard-entry" ? "ADMIN_ACCESS_DENIED" : "admin_access_denied",
        outcome: "denied",
        enforcementEligible: true,
        classificationReason: "Unauthorized access attempt to platform admin endpoint",
      };
    }
    return {
      category: "access_control",
      eventSource: "middleware",
      severity: "low",
      action: "forbidden_access_attempt",
      outcome: "denied",
      enforcementEligible: true,
      classificationReason: "Forbidden workspace or resource access attempt",
    };
  }
  return null;
}

export interface SecurityMiddlewareDeps {
  createClient?: typeof createUserClient;
  createServiceClient?: typeof createServiceClient;
  shouldEnforce?: () => boolean;
  shouldRecordEvents?: () => boolean;
}

const defaultShouldRun = () => process.env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT;

/**
 * Checks durable source IP restrictions and progressive brute-force delays
 * before protected route handlers execute.
 */
export function createEnforceSourceRestriction(deps: SecurityMiddlewareDeps = {}): RequestHandler {
  const getClient = deps.createClient ?? createUserClient;
  const shouldEnforce = deps.shouldEnforce ?? defaultShouldRun;

  return async (req, res, next) => {
    if (!shouldEnforce() || isSkippedRestrictionRequest(req)) {
      next();
      return;
    }
    const sourceIp = req.ip;
    if (!sourceIp || isAllowlistedIp(sourceIp)) {
      next();
      return;
    }
    try {
      const { data, error } = await getClient().rpc("check_source_restriction", {
        p_source_ip: sourceIp,
      });
      if (!error && data && typeof data === "object") {
        const check = data as { restricted?: boolean; reason?: string; expires_at?: string | null; delay_ms?: number };
        if (check.restricted) {
          // A typed identifier is never enough: verify the bearer with Auth before
          // checking the live role, expiry, session and MFA proof in the database.
          try {
          const bearer = readBearerToken(req.headers?.authorization);
          if (bearer) {
            const claims = inspectJwtClaims(bearer);
            if (claims.hasValidStructure && !claims.isExpired && claims.sessionId) {
              const client = getClient(bearer);
              const { data: identity, error: identityError } = await client.auth.getUser(bearer);
              if (!identityError && identity.user) {
                const { data: exempt, error: exemptionError } = await client.rpc("bantai_demo_ip_exempt", {
                  p_session: claims.sessionId, p_aal: claims.aal === "aal2" ? "aal2" : "aal1",
                });
                if (!exemptionError && exempt === true) { next(); return; }
              }
            }
          }
          } catch {
            // An exemption lookup failure never overrides a known IP block.
          }
          (res.locals ??= {}).sourceRestrictionBlocked = true;
          const retryAfter = check.expires_at
            ? Math.max(1, Math.ceil((Date.parse(check.expires_at) - Date.now()) / 1000))
            : 900;
          res.setHeader("Retry-After", String(retryAfter));
          res.setHeader("Cache-Control", "no-store");
          res.status(429).json({
            code: "ip_restricted",
            retryAfterSeconds: retryAfter,
            message: `Too many failed or unauthorized requests from this network. Retry in ${retryAfter} seconds.`,
          });
          return;
        }
        if (typeof check.delay_ms === "number" && check.delay_ms > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(2000, check.delay_ms!)));
        }
      }
    } catch {
      // Non-fatal: fail open if restriction check is unavailable
    }
    next();
  };
}

export const enforceSourceRestriction: RequestHandler = createEnforceSourceRestriction();

// No tokens, query strings, or payloads are logged.
export function createRequestTiming(deps: SecurityMiddlewareDeps = {}): RequestHandler {
  const getServiceClient = deps.createServiceClient ?? createServiceClient;
  const shouldRecordEvents = deps.shouldRecordEvents ?? defaultShouldRun;
  const passiveBearer401SeenAt = new Map<string, number>();

  return (req, res, next) => {
    const start = performance.now();
    const incomingId = req.header("x-request-id");
    const requestId = incomingId && SAFE_REQUEST_ID_RE.test(incomingId) ? incomingId : randomUUID();
    res.setHeader("X-Request-Id", requestId);

    const writeHead = res.writeHead;
    res.writeHead = function (...args: Parameters<typeof writeHead>) {
      res.appendHeader("Server-Timing", `app;dur=${(performance.now() - start).toFixed(1)}`);
      return writeHead.apply(res, args);
    } as typeof writeHead;

    res.on("finish", () => {
      if (req.method.toUpperCase() === "OPTIONS") {
        return;
      }
      const routePath = `${req.baseUrl || ""}${req.path || ""}` || "/";
      if (isAnalyticsHeartbeatPath(routePath)) {
        return;
      }
      const status = res.statusCode;
      if (status === 401 || status === 403 || status === 429 || status >= 500) {
        const durationMs = Number((performance.now() - start).toFixed(1));
        console.warn(
          JSON.stringify({
            type: "security_http_event",
            requestId,
            method: req.method,
            path: routePath,
            status,
            durationMs,
          })
        );

        // Requests rejected solely by an active source restriction must not re-record
        // a 429 security event, which would extend source_restrictions.expires_at.
        if (res.locals?.sourceRestrictionBlocked || res.locals?.credentialFailureRecorded || isAllowlistedIp(req.ip)) {
          return;
        }

        const bearerToken = readBearerToken(req.header("authorization") ?? undefined);
        const jwtClaims = bearerToken ? inspectJwtClaims(bearerToken) : null;
        const sessionExpiredOrRevoked =
          Boolean(res.locals?.sessionExpiredOrRevoked) || Boolean(jwtClaims?.isExpired);
        const classified = classifySecurityEvent(status, routePath, {
          method: req.method,
          hasBearerToken: Boolean(bearerToken),
          sessionExpiredOrRevoked,
        });
        if (!classified || !shouldRecordEvents()) {
          return;
        }

        if (status === 401 && !classified.enforcementEligible && bearerToken) {
          const dedupeKey = `${req.ip || "unknown"}:${hashTokenKey(bearerToken)}`;
          if (shouldDeduplicatePassiveBearer401(passiveBearer401SeenAt, dedupeKey, Date.now())) {
            return;
          }
        }

        const orgMatch = routePath.match(UUID_RE);
        const serviceClient = getServiceClient();
        if (!serviceClient) return;
        if (req.auth) {
          void serviceClient
            .rpc("record_authenticated_security_event", {
              p_actor_id: req.auth.user.id,
              p_category: classified.category,
              p_severity: classified.severity,
              p_action: classified.action,
              p_outcome: classified.outcome,
              p_http_status: status,
              p_route: routePath,
              p_request_id: requestId,
              p_organization_id: orgMatch ? orgMatch[0] : null,
              p_metadata: { method: req.method },
              p_event_source: classified.eventSource,
              p_classification_reason: classified.classificationReason,
              p_enforcement_eligible: classified.enforcementEligible,
            })
            .then(
              () => undefined,
              () => undefined
            );
        } else {
          void serviceClient
            .rpc("record_edge_security_event", {
              p_source_ip: req.ip ?? null,
              p_category: classified.category,
              p_severity: classified.severity,
              p_action: classified.action,
              p_outcome: classified.outcome,
              p_http_status: status,
              p_route: routePath,
              p_request_id: requestId,
              p_metadata: { method: req.method },
            })
            .then(
              () => undefined,
              () => undefined
            );
        }
      }
    });

    next();
  };
}

export const requestTiming: RequestHandler = createRequestTiming();
