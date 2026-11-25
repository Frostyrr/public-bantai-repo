import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../constants/env";
import { createServiceClient } from "../config/supabase";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_TIMEOUT_MS = 5000;

export type TurnstileFailureCategory =
  | "missing_token"
  | "invalid_token_format"
  | "invalid_token"
  | "expired_or_reused_token"
  | "hostname_mismatch"
  | "action_mismatch"
  | "verification_unavailable"
  | "configuration_error"
  | "supabase_captcha_rejected";

export interface TurnstileVerificationResult {
  success: boolean;
  failureCategory?: TurnstileFailureCategory;
  errorCodes?: string[];
  hostname?: string;
  action?: string;
  challengeTs?: string;
}

export interface VerifyTurnstileOptions {
  token: unknown;
  remoteIp?: string | null;
  expectedAction?: string;
  expectedHostnames?: string[];
  secretKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Returns the normalized set of allowed hostnames for Turnstile token validation.
 */
export function getExpectedTurnstileHostnames(): string[] {
  const configured = (env.TURNSTILE_EXPECTED_HOSTNAMES ?? "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }

  const defaults = ["bantaispace.vercel.app", "localhost", "127.0.0.1"];
  try {
    const appHost = new URL(env.APP_ORIGIN).hostname.toLowerCase();
    if (appHost) defaults.push(appHost);
  } catch {
    // Ignore malformed APP_ORIGIN; defaults still apply
  }
  return Array.from(new Set(defaults));
}

function mapCloudflareErrorCodes(codes: string[]): TurnstileFailureCategory {
  if (codes.includes("timeout-or-duplicate")) return "expired_or_reused_token";
  if (codes.includes("missing-input-response")) return "missing_token";
  if (codes.includes("invalid-input-response")) return "invalid_token";
  if (codes.includes("missing-input-secret") || codes.includes("invalid-input-secret")) {
    return "configuration_error";
  }
  if (codes.includes("bad-request")) return "invalid_token_format";
  return "invalid_token";
}

/**
 * Verifies a Cloudflare Turnstile token against Cloudflare's Siteverify API.
 * Never logs raw tokens or secret keys.
 */
export async function verifyTurnstileToken({
  token,
  remoteIp,
  expectedAction,
  expectedHostnames = getExpectedTurnstileHostnames(),
  secretKey = env.TURNSTILE_SECRET_KEY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}: VerifyTurnstileOptions): Promise<TurnstileVerificationResult> {
  if (typeof token !== "string" || token.trim().length === 0) {
    return { success: false, failureCategory: "missing_token" };
  }

  const trimmedToken = token.trim();
  if (trimmedToken.length > 4096) {
    return { success: false, failureCategory: "invalid_token_format" };
  }

  if (!secretKey || secretKey.trim().length === 0) {
    return { success: false, failureCategory: "configuration_error" };
  }

  const body = new URLSearchParams({
    secret: secretKey.trim(),
    response: trimmedToken,
  });
  if (remoteIp && remoteIp.trim().length > 0) {
    body.set("remoteip", remoteIp.trim());
  }

  let response: globalThis.Response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { success: false, failureCategory: "verification_unavailable" };
  }

  if (!response.ok) {
    return { success: false, failureCategory: "verification_unavailable" };
  }

  let payload: {
    success?: boolean;
    "error-codes"?: string[];
    hostname?: string;
    action?: string;
    challenge_ts?: string;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { success: false, failureCategory: "verification_unavailable" };
  }

  const errorCodes = Array.isArray(payload["error-codes"]) ? payload["error-codes"] : [];
  if (!payload.success) {
    return {
      success: false,
      failureCategory: mapCloudflareErrorCodes(errorCodes),
      errorCodes,
    };
  }

  const actualHostname = typeof payload.hostname === "string" ? payload.hostname.trim().toLowerCase() : "";
  if (expectedHostnames.length > 0 && actualHostname) {
    const normalizedAllowed = expectedHostnames.map(h => h.trim().toLowerCase());
    // Allow Cloudflare's official dummy test hostname ("example.com") when using official test keys
    const isDummyTestKey = secretKey.trim().startsWith("1x00000000000000000000");
    if (!normalizedAllowed.includes(actualHostname) && !(isDummyTestKey && actualHostname === "example.com")) {
      return {
        success: false,
        failureCategory: "hostname_mismatch",
        hostname: actualHostname,
        action: payload.action,
      };
    }
  }

  if (expectedAction && typeof payload.action === "string" && payload.action !== expectedAction) {
    return {
      success: false,
      failureCategory: "action_mismatch",
      hostname: actualHostname || undefined,
      action: payload.action,
    };
  }

  return {
    success: true,
    hostname: actualHostname || undefined,
    action: payload.action,
    challengeTs: payload.challenge_ts,
  };
}

export interface RecordTurnstileSecurityEventInput {
  req: Request;
  route: string;
  failureCategory: TurnstileFailureCategory;
  httpStatus: number;
  expectedAction?: string;
  userId?: string | null;
  organizationId?: string | null;
}

/**
 * Records a Turnstile verification failure to Bantai's Admin Security Center
 * without logging raw tokens or classifying every failed challenge as a confirmed attack.
 */
export function recordTurnstileSecurityEvent({
  req,
  route,
  failureCategory,
  httpStatus,
  expectedAction,
  userId,
  organizationId,
}: RecordTurnstileSecurityEventInput): void {
  const requestId = req.header("x-request-id") || randomUUID();
  const severity =
    failureCategory === "hostname_mismatch" || failureCategory === "action_mismatch"
      ? "medium"
      : "low";

  console.warn(
    JSON.stringify({
      type: "turnstile_verification_failed",
      requestId,
      route,
      failureCategory,
      httpStatus,
      expectedAction: expectedAction ?? null,
      timestamp: new Date().toISOString(),
    })
  );

  if (process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT) {
    return;
  }

  const metadata = {
    method: req.method,
    failure_category: failureCategory,
    expected_action: expectedAction ?? null,
    user_id: userId ?? req.auth?.user.id ?? null,
  };

  const serviceClient = createServiceClient();
  if (!serviceClient) return;

  if (req.auth) {
    void serviceClient
      .rpc("record_authenticated_security_event", {
        p_actor_id: req.auth.user.id,
        p_category: "auth",
        p_severity: severity,
        p_action: "CAPTCHA_FAILED",
        p_outcome: "blocked",
        p_http_status: httpStatus,
        p_route: route,
        p_request_id: requestId,
        p_organization_id: organizationId ?? null,
        p_metadata: metadata,
        p_event_source: "turnstile_backend",
        p_classification_reason: `turnstile_${failureCategory}`,
        p_enforcement_eligible: false,
      })
      .then(
        () => undefined,
        () => undefined
      );
    return;
  }

  void serviceClient
    .rpc("record_edge_security_event", {
      p_source_ip: req.ip ?? null,
      p_category: "auth",
      p_severity: severity,
      p_action: "CAPTCHA_FAILED",
      p_outcome: "blocked",
      p_http_status: httpStatus,
      p_route: route,
      p_request_id: requestId,
      p_metadata: metadata,
    })
    .then(
      () => undefined,
      () => undefined
    );
}

export interface RequireTurnstileOptions {
  action?: string;
}

/**
 * Express middleware that enforces Cloudflare Turnstile Siteverify verification
 * on custom backend endpoints.
 */
export function requireTurnstile(options: RequireTurnstileOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const bodyToken =
      req.body && typeof req.body === "object" && "captchaToken" in req.body
        ? (req.body as Record<string, unknown>).captchaToken
        : undefined;
    const headerToken = req.header("x-turnstile-token");
    const token = bodyToken ?? headerToken;

    const result = await verifyTurnstileToken({
      token,
      remoteIp: req.ip ?? null,
      expectedAction: options.action,
    });

    if (!result.success) {
      const category = result.failureCategory ?? "invalid_token";
      const status =
        category === "verification_unavailable" || category === "configuration_error"
          ? 503
          : category === "hostname_mismatch" || category === "action_mismatch"
          ? 403
          : 400;

      recordTurnstileSecurityEvent({
        req,
        route: `${req.baseUrl || ""}${req.path || ""}` || "/",
        failureCategory: category,
        httpStatus: status,
        expectedAction: options.action,
      });

      const message =
        status === 503
          ? "Security verification is temporarily unavailable. Please try again."
          : "Security verification failed. Please complete the challenge and try again.";

      res.status(status).json({ message, code: category });
      return;
    }

    next();
  };
}
