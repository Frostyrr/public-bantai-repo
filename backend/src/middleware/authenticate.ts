import type { RequestHandler } from "express";
import { env } from "../constants/env";
import { createServiceClient, createUserClient } from "../config/supabase";
import AppError from "../utils/AppError";

export function readBearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
}

const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export interface JwtClaimsSummary {
  hasValidStructure: boolean;
  isExpired: boolean;
  iatMs: number | null;
  sessionId?: string;
  supportsJwks?: boolean;
  aal?: unknown;
}

export function inspectJwtClaims(token: string): JwtClaimsSummary {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { hasValidStructure: false, isExpired: false, iatMs: null };
  }
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: unknown; kid?: unknown };
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      iat?: unknown;
      exp?: unknown;
      session_id?: unknown;
      aal?: unknown;
    };
    if (!header || typeof header.alg !== "string" || !payload || typeof payload !== "object") {
      return { hasValidStructure: false, isExpired: false, iatMs: null };
    }
    const iatMs = typeof payload.iat === "number" ? payload.iat * 1000 : null;
    const isExpired = typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
    const sessionId = typeof payload.session_id === "string" &&
      uuidPattern.test(payload.session_id)
      ? payload.session_id
      : undefined;
    const supportsJwks = (header.alg === "ES256" || header.alg === "RS256") &&
      typeof header.kid === "string" && header.kid.length > 0;
    return { hasValidStructure: true, isExpired, iatMs, sessionId, supportsJwks, aal: payload.aal };
  } catch {
    return { hasValidStructure: false, isExpired: false, iatMs: null };
  }
}

const expectedIssuer = new URL("/auth/v1", env.SUPABASE_URL).href;

const authenticateSession = (challengeOnly: boolean): RequestHandler => async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const accessToken = readBearerToken(req.headers.authorization);
  if (!accessToken) {
    res.status(401).json({ message: "Sign in to continue." });
    return;
  }
  try {
    const jwt = inspectJwtClaims(accessToken);
    // The profile endpoint returns identity-provider records from Auth.
    const isProfileRead = req.baseUrl.toLowerCase() === "/user" && req.path === "/" &&
      (req.method === "GET" || req.method === "HEAD");
    const useJwks = env.AUTH_JWKS_ENABLED === "true" && jwt.supportsJwks && !isProfileRead;
    const authStart = performance.now();
    const auth = createUserClient().auth;
    let user: NonNullable<Express.Request["auth"]>["user"] | undefined;
    let userId: string;

    if (useJwks) {
      const { data } = await auth.getClaims(accessToken);
      res.appendHeader("Server-Timing", `auth;dur=${(performance.now() - authStart).toFixed(1)}`);
      const claims = data?.claims;
      if (!claims || claims.iss !== expectedIssuer || claims.aud !== "authenticated" ||
          claims.role !== "authenticated" || typeof claims.sub !== "string" ||
          !uuidPattern.test(claims.sub) || !Number.isFinite(claims.exp) || jwt.isExpired ||
          (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > Date.now() / 1000))) {
        if (jwt.isExpired) res.locals.sessionExpiredOrRevoked = true;
        res.status(401).json({
          message: "Your session is invalid or expired.",
          ...(jwt.isExpired ? { code: "session_expired" } : {}),
        });
        return;
      }
      userId = claims.sub;
    } else {
      const { data, error } = await auth.getUser(accessToken);
      res.appendHeader("Server-Timing", `auth;dur=${(performance.now() - authStart).toFixed(1)}`);
      if (error || !data.user) {
        const errorMessage = typeof error?.message === "string" ? error.message : "";
        const isExpiredOrRevokedError =
          jwt.isExpired ||
          (jwt.hasValidStructure &&
            /expired|session_not_found|session.*not exist|refresh_token|user_not_found/i.test(errorMessage));
        if (isExpiredOrRevokedError) {
          (res.locals ??= {}).sessionExpiredOrRevoked = true;
        }
        res.status(401).json({
          message: "Your session is invalid or expired.",
          ...(isExpiredOrRevokedError ? { code: "session_expired" } : {}),
        });
        return;
      }
      if (!data.user.email_confirmed_at) {
        res.status(403).json({ message: "Verify your email before continuing." });
        return;
      }
      user = data.user;
      userId = user.id;
    }

    if (!jwt.sessionId) {
      res.status(401).json({ message: "Your session has ended. Please sign in again.", code: "session_revoked" });
      return;
    }

    const enforcement = createServiceClient();
    if (!enforcement) throw new AppError(503, "Session verification is temporarily unavailable.");
    const parameters = {
      p_session: jwt.sessionId,
      p_user: userId,
      // Both Auth paths authenticate this exact JWT before using its assurance claim.
      p_aal: jwt.aal === "aal2" ? "aal2" as const : "aal1" as const,
      p_activity: req.method === "POST" && req.baseUrl === "/user" && req.path === "/session/activity",
    };
    const sessionStart = performance.now();
    const { data: result, error: sessionError } = await enforcement.rpc(
      useJwks ? "bantai_check_verified_session" : "bantai_check_session",
      challengeOnly ? { p_session: parameters.p_session, p_user: parameters.p_user, p_activity: false } : parameters,
    );
    res.appendHeader("Server-Timing", `session;dur=${(performance.now() - sessionStart).toFixed(1)}`);
    const decision = useJwks ? result?.decision : result;
    if (sessionError || !["active", "idle", "absolute", "revoked", "logged_out", "locked", "suspended", "unverified", "mfa_required"].includes(decision)) {
      throw new AppError(503, "Session verification is temporarily unavailable.");
    }
    if (decision === "mfa_required") {
      res.status(403).json({ code: "mfa_required", message: "Verify your sign-in to continue." });
      return;
    }
    if (decision === "unverified") {
      res.status(403).json({ message: "Verify your email before continuing." });
      return;
    }
    if (decision === "suspended" || decision === "locked") {
      let retryAfterSeconds: number | undefined;
      if (decision === "locked") {
        try {
          const { data: profile, error } = await enforcement.from("profiles").select("locked_until").eq("id", userId).maybeSingle();
          const remaining = Math.ceil((Date.parse(profile?.locked_until ?? "") - Date.now()) / 1000);
          if (!error && Number.isFinite(remaining) && remaining > 0) {
            retryAfterSeconds = remaining;
            res.setHeader("Retry-After", String(remaining));
          }
        } catch { /* The existing lock decision still applies if timing cannot be read. */ }
      }
      res.status(403).json({
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        code: decision === "suspended" ? "account_suspended" : "account_locked",
        message: decision === "suspended"
          ? "Your account has been suspended by platform administration."
          : retryAfterSeconds ? `Your account is temporarily locked. Try again in ${retryAfterSeconds} seconds.` : "Your account is temporarily locked. Please try again later.",
      });
      return;
    }
    if (decision !== "active") {
      res.locals.sessionExpiredOrRevoked = true;
      const timedOut = decision === "idle" || decision === "absolute";
      res.status(401).json({
        code: timedOut ? "session_timed_out" : "session_revoked",
        message: timedOut ? "Your session timed out. Please sign in again." : "Your session has ended. Please sign in again.",
        ...(timedOut ? { reason: decision } : {}),
      });
      return;
    }

    if (req.method === "GET" && req.baseUrl === "/user" && req.path === "/session") {
      const { data: remaining } = await enforcement.rpc("bantai_session_idle_remaining", {
        p_session: jwt.sessionId,
        p_user: userId,
      });
      if (typeof remaining === "number") res.setHeader("X-Session-Idle-Remaining", String(remaining));
    }

    if (isProfileRead && req.method === "GET" && env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT) {
      const requestId = res.getHeader("X-Request-Id");
      void enforcement.rpc("bantai_record_login_success", {
        p_user: userId,
        p_session: jwt.sessionId,
        p_request_id: typeof requestId === "string" ? requestId : null,
      }).then(() => undefined, () => undefined);
    }

    req.auth = {
      user: user ?? { id: userId, user_metadata: result.user_metadata },
      accessToken,
      sessionId: jwt.sessionId,
      aal: parameters.p_aal,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const authenticate = authenticateSession(false);
export const authenticateForEmailChallenge = authenticateSession(true);
