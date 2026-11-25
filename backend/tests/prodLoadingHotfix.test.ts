import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import cors from "cors";
import express from "express";
import { inspectJwtClaims } from "../src/middleware/authenticate";
import {
  classifySecurityEvent,
  createEnforceSourceRestriction,
  createRequestTiming,
} from "../src/middleware/requestTiming";

const ALLOWED_ORIGIN = "https://bantaispace.vercel.app";

function buildFakeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.fake-signature`;
}

function createHarness(options?: {
  onAuthenticateCheck?: (req: express.Request, res: express.Response) => boolean;
}) {
  const edgeEvents: Array<{
    sourceIp: string | null;
    category: string;
    action: string;
    status: number;
    route: string;
    method: string;
  }> = [];
  const restrictedIps = new Map<string, string>();
  let checkSourceRestrictionCalls = 0;

  const mockAnonClient = {
    rpc: async (fn: string, params?: Record<string, unknown>) => {
      if (fn === "check_source_restriction") {
        checkSourceRestrictionCalls += 1;
        const sourceIp = String(params?.p_source_ip ?? "");
        const expiresAt = restrictedIps.get(sourceIp);
        if (expiresAt) {
          return {
            data: { restricted: true, reason: "auto_edge_threshold", expires_at: expiresAt },
            error: null,
          };
        }
        return { data: { restricted: false }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const mockServiceClient = {
    rpc: (fn: string, params?: Record<string, unknown>) => {
      if (fn === "record_edge_security_event") {
        const sourceIp = (params?.p_source_ip as string | null) ?? null;
        const status = Number(params?.p_http_status ?? 0);
        const category = String(params?.p_category ?? "");
        edgeEvents.push({
          sourceIp,
          category,
          action: String(params?.p_action ?? ""),
          status,
          route: String(params?.p_route ?? ""),
          method: String((params?.p_metadata as { method?: string } | undefined)?.method ?? ""),
        });
        if (sourceIp && category !== "operational" && status < 500) {
          const countForIp = edgeEvents.filter(
            (event) => event.sourceIp === sourceIp && event.category !== "operational" && event.status < 500
          ).length;
          if (countForIp >= 10) {
            restrictedIps.set(sourceIp, new Date(Date.now() + 15 * 60 * 1000).toISOString());
          }
        }
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(
    cors({
      origin: ALLOWED_ORIGIN,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      exposedHeaders: ["Server-Timing", "X-Request-Id", "Retry-After"],
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-Request-Id",
        "X-Turnstile-Token",
      ],
    })
  );
  app.use(
    createRequestTiming({
      createServiceClient: () => mockServiceClient as never,
      shouldRecordEvents: () => true,
    })
  );
  app.use(
    createEnforceSourceRestriction({
      createClient: () => mockAnonClient as never,
      shouldEnforce: () => true,
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.post("/analytics/heartbeat", (_req, res) => {
    res.status(204).end();
  });
  app.post("/auth/login", (_req, res) => {
    res.status(401).json({ message: "Invalid login credentials." });
  });

  const requireTestAuth: express.RequestHandler = (req, res, next) => {
    if (options?.onAuthenticateCheck && options.onAuthenticateCheck(req, res)) {
      return;
    }
    const authHeader = req.header("authorization") ?? "";
    const token = authHeader.replace(/^Bearer /i, "");
    if (!token) {
      res.status(401).json({ message: "Sign in to continue." });
      return;
    }
    const claims = inspectJwtClaims(token);
    if (claims.isExpired) {
      (res.locals ??= {}).sessionExpiredOrRevoked = true;
      res.status(401).json({ message: "Your session is invalid or expired.", code: "session_expired" });
      return;
    }
    if (req.header("x-simulate-revoked") === "true" && claims.hasValidStructure) {
      (res.locals ??= {}).sessionExpiredOrRevoked = true;
      res.status(401).json({ message: "Your session has been revoked.", code: "session_revoked" });
      return;
    }
    if (token.startsWith("stale-") || token.startsWith("forged-")) {
      res.status(401).json({ message: "Your session is invalid or expired." });
      return;
    }
    if (token === "member-no-admin" && req.path.startsWith("/admin")) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
  };

  app.get("/user", requireTestAuth, (_req, res) => {
    res.json({ id: "user-1" });
  });
  app.get("/organizations", requireTestAuth, (_req, res) => {
    res.json([]);
  });
  app.get("/admin/users", requireTestAuth, (_req, res) => {
    res.json([]);
  });
  app.post("/organizations", requireTestAuth, (_req, res) => {
    res.status(201).json({ ok: true });
  });

  return {
    app,
    edgeEvents,
    restrictedIps,
    getCheckSourceRestrictionCalls: () => checkSourceRestrictionCalls,
  };
}

async function withServer(
  app: express.Express,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("HOTFIX-01: classifySecurityEvent ignores heartbeats and expired sessions while keeping attack classifications", () => {
  assert.equal(classifySecurityEvent(401, "/analytics/heartbeat"), null);
  assert.equal(classifySecurityEvent(429, "/analytics/heartbeat"), null);
  assert.equal(
    classifySecurityEvent(401, "/user", {
      method: "GET",
      hasBearerToken: true,
      sessionExpiredOrRevoked: true,
    }),
    null
  );

  const passiveStaleGet = classifySecurityEvent(401, "/organizations", {
    method: "GET",
    hasBearerToken: true,
    sessionExpiredOrRevoked: false,
  });
  assert.equal(passiveStaleGet?.enforcementEligible, false);

  const loginFailureEvenWithHeader = classifySecurityEvent(401, "/auth/login", {
    method: "POST",
    hasBearerToken: true,
    sessionExpiredOrRevoked: true,
  });
  assert.equal(loginFailureEvenWithHeader?.enforcementEligible, true);

  const tokenlessProbe = classifySecurityEvent(401, "/organizations", {
    method: "GET",
    hasBearerToken: false,
    sessionExpiredOrRevoked: false,
  });
  assert.equal(tokenlessProbe?.enforcementEligible, true);
});

test("HOTFIX-02: OPTIONS preflights and /analytics/heartbeat bypass restriction lookups and 429 responses retain CORS headers", async () => {
  const harness = createHarness();
  harness.restrictedIps.set("203.0.113.10", new Date(Date.now() + 10 * 60 * 1000).toISOString());

  await withServer(harness.app, async (baseUrl) => {
    const preflight = await fetch(`${baseUrl}/user`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "X-Forwarded-For": "203.0.113.10",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,x-turnstile-token",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(harness.getCheckSourceRestrictionCalls(), 0);

    const heartbeat = await fetch(`${baseUrl}/analytics/heartbeat`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10",
      },
      body: JSON.stringify({ visitorId: "visitor-12345", path: "/app" }),
    });
    assert.equal(heartbeat.status, 204);
    assert.equal(heartbeat.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(harness.getCheckSourceRestrictionCalls(), 0);
    assert.equal(harness.edgeEvents.length, 0);

    const blockedGet = await fetch(`${baseUrl}/user`, {
      method: "GET",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "X-Forwarded-For": "203.0.113.10",
      },
    });
    assert.equal(blockedGet.status, 429);
    assert.equal(blockedGet.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.ok((blockedGet.headers.get("access-control-expose-headers") || "").includes("Retry-After"));
    assert.ok(Number(blockedGet.headers.get("retry-after")) >= 1);
    assert.equal(blockedGet.headers.get("cache-control"), "no-store");
    assert.equal(harness.edgeEvents.length, 0);
  });
});

test("HOTFIX-03: expired and revoked session 401s and parallel same-token GET 401s do not ban an IP", async () => {
  const harness = createHarness();
  const expiredJwt = buildFakeJwt({
    sub: "user-1",
    iat: Math.floor(Date.now() / 1000) - 7200,
    exp: Math.floor(Date.now() / 1000) - 60,
  });
  const activeStructureJwt = buildFakeJwt({
    sub: "user-1",
    iat: Math.floor(Date.now() / 1000) - 120,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  await withServer(harness.app, async (baseUrl) => {
    for (let i = 0; i < 15; i += 1) {
      const res = await fetch(`${baseUrl}/user`, {
        headers: {
          "X-Forwarded-For": "198.51.100.11",
          Authorization: `Bearer ${expiredJwt}`,
        },
      });
      assert.equal(res.status, 401);
    }

    for (let i = 0; i < 15; i += 1) {
      const res = await fetch(`${baseUrl}/organizations`, {
        headers: {
          "X-Forwarded-For": "198.51.100.11",
          Authorization: `Bearer ${activeStructureJwt}`,
          "x-simulate-revoked": "true",
        },
      });
      assert.equal(res.status, 401);
    }

    await new Promise((r) => setTimeout(r, 25));
    assert.equal(harness.edgeEvents.length, 0);
    assert.equal(harness.restrictedIps.has("198.51.100.11"), false);

    // 12 parallel GET requests using the exact same unrecognized stale token deduplicate cleanly.
    const staleResponses = await Promise.all(
      Array.from({ length: 12 }, (_, idx) =>
        fetch(`${baseUrl}/${idx % 2 === 0 ? "user" : "organizations"}`, {
          headers: {
            "X-Forwarded-For": "198.51.100.12",
            Authorization: "Bearer stale-mobile-token-abc",
          },
        })
      )
    );
    for (const res of staleResponses) {
      assert.equal(res.status, 401);
    }
    await new Promise((r) => setTimeout(r, 25));
    const eventsForIp = harness.edgeEvents.filter((e) => e.sourceIp === "198.51.100.12");
    assert.equal(eventsForIp.length, 1);
    assert.equal(harness.restrictedIps.has("198.51.100.12"), false);
  });
});

test("HOTFIX-04: credential brute force, distinct forged tokens, and tokenless enumeration still trigger IP bans", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    // 1. Credential stuffing against POST /auth/login
    for (let i = 0; i < 10; i += 1) {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.50",
        },
        body: JSON.stringify({ email: "victim@example.com", password: "wrong" }),
      });
      assert.equal(res.status, 401);
    }
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(harness.restrictedIps.has("203.0.113.50"), true);
    const blockedAfterLoginAttack = await fetch(`${baseUrl}/user`, {
      headers: { Origin: ALLOWED_ORIGIN, "X-Forwarded-For": "203.0.113.50" },
    });
    assert.equal(blockedAfterLoginAttack.status, 429);
    assert.equal(blockedAfterLoginAttack.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);

    // 2. Distinct forged tokens on GET /user
    for (let i = 0; i < 10; i += 1) {
      const res = await fetch(`${baseUrl}/user`, {
        headers: {
          "X-Forwarded-For": "203.0.113.51",
          Authorization: `Bearer forged-token-${i}`,
        },
      });
      assert.equal(res.status, 401);
    }
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(harness.restrictedIps.has("203.0.113.51"), true);

    // 3. Tokenless unauthenticated probes on GET /organizations
    for (let i = 0; i < 10; i += 1) {
      const res = await fetch(`${baseUrl}/organizations`, {
        headers: { "X-Forwarded-For": "203.0.113.52" },
      });
      assert.equal(res.status, 401);
    }
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(harness.restrictedIps.has("203.0.113.52"), true);
  });
});
