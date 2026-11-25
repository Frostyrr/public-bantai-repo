import type { NextFunction, Request, Response } from "express";
import { createServiceClient } from "../config/supabase";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
  failClosed?: boolean;
}

export interface RateLimitDeps {
  createServiceClient?: typeof createServiceClient;
  isTestMode?: () => boolean;
  isProductionMode?: () => boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Durable per-identity / per-IP fixed-window rate limiter.
 * Uses Postgres `consume_rate_limit` via the server-only service_role client.
 * Production and callers opting into failClosed receive HTTP 503 when the
 * durable client/RPC is unavailable. Development retains its local fallback.
 * Tests may use in-memory buckets without invoking production enforcement.
 */
export function createRateLimiter({
  windowMs,
  max,
  keyPrefix,
  message = "Too many requests. Please wait a moment and try again.",
  failClosed = false,
}: RateLimitOptions, deps: RateLimitDeps = {}) {
  const buckets = new Map<string, Bucket>();
  const getServiceClient = deps.createServiceClient ?? createServiceClient;
  const isTestMode = deps.isTestMode ?? (() => process.env.NODE_ENV === "test" || Boolean(process.env.NODE_TEST_CONTEXT));
  const isProductionMode = deps.isProductionMode ?? (() => process.env.NODE_ENV === "production");

  const runLocalLimit = (req: Request, res: Response, next: NextFunction, key: string) => {
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
      }
    }

    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - 1)));
      next();
      return;
    }

    existing.count += 1;
    const remaining = Math.max(0, max - existing.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (existing.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ message });
      return;
    }

    next();
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const identity = req.auth?.user?.id ?? req.ip ?? "anonymous";
    const key = `${keyPrefix}:${identity}`;

    if (isTestMode() && !deps.createServiceClient) {
      runLocalLimit(req, res, next, key);
      return;
    }

    const failClosedOrFallback = (reason: string) => {
      if (failClosed || isProductionMode()) {
        res.setHeader("Retry-After", "30");
        res.status(503).json({ message: "Request limits are temporarily unavailable. Try later or continue manually." });
        return;
      }
      if (isProductionMode()) {
        console.warn(JSON.stringify({ type: "rate_limit_fallback", keyPrefix, reason }));
      }
      runLocalLimit(req, res, next, key);
    };

    void (async () => {
      try {
        const serviceClient = getServiceClient();
        if (!serviceClient) {
          failClosedOrFallback("missing_service_role_client");
          return;
        }
        const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
        const { data, error } = await serviceClient.rpc("consume_rate_limit", {
          p_bucket_key: key,
          p_window_seconds: windowSeconds,
          p_max_requests: max,
        });
        if (!error && data && typeof data === "object" && typeof data.allowed === "boolean") {
          const result = data as { allowed?: boolean; remaining?: number; retry_after_seconds?: number };
          res.setHeader("X-RateLimit-Limit", String(max));
          res.setHeader("X-RateLimit-Remaining", String(result.remaining ?? 0));
          if (result.allowed === false) {
            res.setHeader("Retry-After", String(result.retry_after_seconds ?? windowSeconds));
            res.status(429).json({ message });
            return;
          }
          next();
          return;
        }
        failClosedOrFallback(error ? "rpc_error" : "invalid_rpc_response");
      } catch {
        failClosedOrFallback("rpc_exception");
      }
    })();
  };
}
