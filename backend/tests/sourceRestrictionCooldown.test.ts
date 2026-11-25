import { PGlite } from "@electric-sql/pglite";
import { EventEmitter } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { createEnforceSourceRestriction, createRequestTiming } from "../src/middleware/requestTiming";

async function createMigratedDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);

  await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
  const dir = path.resolve(__dirname, "../../supabase/migrations");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(dir, file), "utf8"));
  }
  return db;
}

function createPGliteRpcClient(db: PGlite, recordedCalls: Array<{ fn: string; params: Record<string, unknown> }>) {
  return (_accessToken?: string) =>
    ({
      rpc: async (fn: string, params: Record<string, unknown>) => {
        recordedCalls.push({ fn, params });
        try {
          if (fn === "check_source_restriction") {
            const res = await db.query<{ data: unknown }>(
              "select public.check_source_restriction($1) as data",
              [params.p_source_ip],
            );
            return { data: res.rows[0]?.data ?? null, error: null };
          }
          if (fn === "record_edge_security_event") {
            const res = await db.query<{ data: unknown }>(
              "select public.record_edge_security_event($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) as data",
              [
                params.p_source_ip ?? null,
                params.p_category,
                params.p_severity,
                params.p_action,
                params.p_outcome,
                params.p_http_status,
                params.p_route,
                params.p_request_id,
                JSON.stringify(params.p_metadata ?? {}),
              ],
            );
            return { data: res.rows[0]?.data ?? null, error: null };
          }
          if (fn === "record_authenticated_security_event") {
            const res = await db.query<{ data: unknown }>(
              "select public.record_authenticated_security_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13) as data",
              [
                params.p_actor_id,
                params.p_category,
                params.p_severity,
                params.p_action,
                params.p_outcome,
                params.p_http_status,
                params.p_route,
                params.p_request_id,
                params.p_organization_id ?? null,
                JSON.stringify(params.p_metadata ?? {}),
                params.p_event_source ?? "api",
                params.p_classification_reason ?? null,
                params.p_enforcement_eligible ?? false,
              ],
            );
            return { data: res.rows[0]?.data ?? null, error: null };
          }
          return { data: null, error: new Error(`Unexpected RPC: ${fn}`) };
        } catch (error) {
          return { data: null, error };
        }
      },
    }) as never;
}

async function runMiddlewareChain(
  requestTimingMw: ReturnType<typeof createRequestTiming>,
  enforceMw: ReturnType<typeof createEnforceSourceRestriction>,
  options: { ip: string; path: string; method?: string; accessToken?: string },
  handler?: (req: Request, res: Response) => void,
) {
  const headers: Record<string, string> = {};
  const resEmitter = new EventEmitter();
  let statusCode = 200;
  let body: unknown = null;
  let nextCalled = false;

  const req = {
    ip: options.ip,
    path: options.path,
    baseUrl: "",
    method: options.method ?? "GET",
    header: () => undefined,
    auth: options.accessToken ? { accessToken: options.accessToken } : undefined,
  } as unknown as Request;

  const res = Object.assign(resEmitter, {
    statusCode: 200,
    locals: {} as Record<string, unknown>,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    appendHeader() {
      return this;
    },
    writeHead(...args: unknown[]) {
      return args;
    },
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      this.emit("finish");
      return this;
    },
  }) as unknown as Response;

  await new Promise<void>((resolve) => {
    requestTimingMw(req, res, () => {
      Promise.resolve(
        enforceMw(req, res, () => {
          nextCalled = true;
          if (handler) {
            handler(req, res);
          } else {
            res.status(200).json({ ok: true });
          }
        }),
      ).finally(resolve);
    });
  });

  // Allow any void microtask RPCs in res.on("finish") to settle
  await new Promise((resolve) => setTimeout(resolve, 25));

  return { statusCode, body, headers, nextCalled, locals: res.locals };
}

test("SEC-429: repeated active-restriction 429 responses do not extend cooldown expiry, while independent events still record", async () => {
  const db = await createMigratedDb();
  const attackerIp = "203.0.113.77";
  const otherIp = "203.0.113.88";
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const createClient = createPGliteRpcClient(db, rpcCalls);

  const enforceMw = createEnforceSourceRestriction({
    createClient,
    shouldEnforce: () => true,
  });
  const timingMw = createRequestTiming({
    createClient,
    createServiceClient: createClient,
    shouldRecordEvents: () => true,
  });

  try {
    // 1. Trigger automated 15m restriction via 10 independent failed edge events
    for (let i = 0; i < 10; i++) {
      await db.query(
        "select public.record_edge_security_event($1, 'auth', 'low', 'unauthorized_auth_attempt', 'denied', 401, '/api/auth/login', $2, '{}'::jsonb)",
        [attackerIp, `seed-req-${i}`],
      );
    }

    const initialRestriction = (
      await db.query<{ status: string; expires_at: string; attempts_count: number }>(
        "select status, expires_at::text, attempts_count from public.source_restrictions where source_ip = $1",
        [attackerIp],
      )
    ).rows[0];
    assert.equal(initialRestriction.status, "restricted");
    assert.equal(initialRestriction.attempts_count, 10);

    // 2. Repeated blocked requests (unauthenticated + authenticated) must return 429 and NOT renew expires_at
    rpcCalls.length = 0;
    const blocked1 = await runMiddlewareChain(timingMw, enforceMw, { ip: attackerIp, path: "/api/orgs" });
    const blocked2 = await runMiddlewareChain(timingMw, enforceMw, {
      ip: attackerIp,
      path: "/api/orgs",
      accessToken: "synthetic-token",
    });

    for (const res of [blocked1, blocked2]) {
      assert.equal(res.statusCode, 429);
      assert.equal((res.body as { code?: string }).code, "ip_restricted");
      assert.equal(res.nextCalled, false);
      assert.equal(res.locals.sourceRestrictionBlocked, true);
      assert.ok(Number(res.headers["Retry-After"]) >= 1);
    }

    const recordedDuringBlocks = rpcCalls.filter(
      (c) => c.fn === "record_edge_security_event" || c.fn === "record_authenticated_security_event",
    );
    assert.equal(recordedDuringBlocks.length, 0);

    const afterBlockedRestriction = (
      await db.query<{ expires_at: string; attempts_count: number }>(
        "select expires_at::text, attempts_count from public.source_restrictions where source_ip = $1",
        [attackerIp],
      )
    ).rows[0];
    assert.equal(afterBlockedRestriction.expires_at, initialRestriction.expires_at);
    assert.equal(afterBlockedRestriction.attempts_count, initialRestriction.attempts_count);

    // 3. Once restriction expires, requests are allowed through again
    await db.query(
      "update public.source_restrictions set expires_at = now() - interval '1 second' where source_ip = $1",
      [attackerIp],
    );
    const afterExpiry = await runMiddlewareChain(timingMw, enforceMw, { ip: attackerIp, path: "/api/orgs" });
    assert.equal(afterExpiry.statusCode, 200);
    assert.equal(afterExpiry.nextCalled, true);
    assert.equal(afterExpiry.locals.sourceRestrictionBlocked, undefined);

    // 4. Independent 429 (e.g. route rate limiter) and 403 from an unrestricted IP still record security events
    rpcCalls.length = 0;
    const independent429 = await runMiddlewareChain(
      timingMw,
      enforceMw,
      { ip: otherIp, path: "/api/auth/login", method: "POST" },
      (_req, res) => {
        res.status(429).json({ message: "Rate limit exceeded" });
      },
    );
    assert.equal(independent429.statusCode, 429);
    assert.equal(independent429.nextCalled, true);

    const independent403 = await runMiddlewareChain(
      timingMw,
      enforceMw,
      { ip: otherIp, path: "/api/organizations/00000000-0000-4000-8000-000000000001/expenses" },
      (_req, res) => {
        res.status(403).json({ message: "Forbidden" });
      },
    );
    assert.equal(independent403.statusCode, 403);
    assert.equal(independent403.nextCalled, true);

    const recordedIndependent = rpcCalls.filter((c) => c.fn === "record_edge_security_event");
    assert.equal(recordedIndependent.length, 2);

    const otherEvents = (
      await db.query<{ http_status: number; action: string }>(
        "select http_status, action from public.security_events where source_ip = $1 order by occurred_at asc",
        [otherIp],
      )
    ).rows;
    assert.deepEqual(otherEvents, [
      { http_status: 429, action: "rate_limit_exceeded" },
      { http_status: 403, action: "financial_access_denied" },
    ]);
  } finally {
    await db.close();
  }
});
