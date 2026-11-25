import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import {
  getExpectedTurnstileHostnames,
  requireTurnstile,
  verifyTurnstileToken,
} from "../src/services/turnstile";

const CF_TEST_SECRET_PASS = "1x0000000000000000000000000000000AA";
const CF_TEST_SECRET_FAIL = "2x0000000000000000000000000000000AA";
const CF_TEST_TOKEN_PASS = "XXXX.DUMMY.TOKEN.XXXX";

function mockJsonFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

test("TURNSTILE-01: rejects missing, blank, or oversized tokens before contacting Cloudflare", async () => {
  let called = false;
  const spyFetch = (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch;

  const missing = await verifyTurnstileToken({
    token: undefined,
    secretKey: CF_TEST_SECRET_PASS,
    fetchImpl: spyFetch,
  });
  assert.equal(missing.success, false);
  assert.equal(missing.failureCategory, "missing_token");

  const blank = await verifyTurnstileToken({
    token: "   ",
    secretKey: CF_TEST_SECRET_PASS,
    fetchImpl: spyFetch,
  });
  assert.equal(blank.success, false);
  assert.equal(blank.failureCategory, "missing_token");

  const oversized = await verifyTurnstileToken({
    token: "a".repeat(5000),
    secretKey: CF_TEST_SECRET_PASS,
    fetchImpl: spyFetch,
  });
  assert.equal(oversized.success, false);
  assert.equal(oversized.failureCategory, "invalid_token_format");
  assert.equal(called, false);
});

test("TURNSTILE-02: fails securely with configuration_error when secret key is missing", async () => {
  const result = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: "",
  });
  assert.equal(result.success, false);
  assert.equal(result.failureCategory, "configuration_error");
});

test("TURNSTILE-03: accepts valid token for expected hostname and action (including official test dummy hostname)", async () => {
  const prodOk = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: "real-secret-key",
    expectedHostnames: ["bantaispace.vercel.app", "localhost"],
    expectedAction: "login",
    fetchImpl: mockJsonFetch(200, {
      success: true,
      hostname: "bantaispace.vercel.app",
      action: "login",
      challenge_ts: "2026-11-15T00:00:00Z",
    }),
  });
  assert.equal(prodOk.success, true);
  assert.equal(prodOk.hostname, "bantaispace.vercel.app");

  const dummyOk = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: CF_TEST_SECRET_PASS,
    expectedHostnames: ["bantaispace.vercel.app", "localhost"],
    fetchImpl: mockJsonFetch(200, {
      success: true,
      hostname: "example.com",
    }),
  });
  assert.equal(dummyOk.success, true);
});

test("TURNSTILE-04: rejects expired/reused and invalid tokens", async () => {
  const reused = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: CF_TEST_SECRET_PASS,
    fetchImpl: mockJsonFetch(200, {
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    }),
  });
  assert.equal(reused.success, false);
  assert.equal(reused.failureCategory, "expired_or_reused_token");

  const invalid = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: CF_TEST_SECRET_FAIL,
    fetchImpl: mockJsonFetch(200, {
      success: false,
      "error-codes": ["invalid-input-response"],
    }),
  });
  assert.equal(invalid.success, false);
  assert.equal(invalid.failureCategory, "invalid_token");
});

test("TURNSTILE-05: rejects hostname mismatch and action mismatch", async () => {
  const badHost = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: "real-secret-key",
    expectedHostnames: ["bantaispace.vercel.app", "localhost"],
    fetchImpl: mockJsonFetch(200, {
      success: true,
      hostname: "evil.example.org",
      action: "login",
    }),
  });
  assert.equal(badHost.success, false);
  assert.equal(badHost.failureCategory, "hostname_mismatch");

  const badAction = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: "real-secret-key",
    expectedHostnames: ["bantaispace.vercel.app"],
    expectedAction: "login",
    fetchImpl: mockJsonFetch(200, {
      success: true,
      hostname: "bantaispace.vercel.app",
      action: "register",
    }),
  });
  assert.equal(badAction.success, false);
  assert.equal(badAction.failureCategory, "action_mismatch");
});

test("TURNSTILE-06: handles Cloudflare service errors and network timeouts safely", async () => {
  const http500 = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: CF_TEST_SECRET_PASS,
    fetchImpl: mockJsonFetch(500, { error: "upstream" }),
  });
  assert.equal(http500.success, false);
  assert.equal(http500.failureCategory, "verification_unavailable");

  const networkErr = await verifyTurnstileToken({
    token: CF_TEST_TOKEN_PASS,
    secretKey: CF_TEST_SECRET_PASS,
    fetchImpl: (async () => {
      throw new Error("ETIMEDOUT");
    }) as typeof fetch,
  });
  assert.equal(networkErr.success, false);
  assert.equal(networkErr.failureCategory, "verification_unavailable");
});

test("TURNSTILE-07: requireTurnstile middleware blocks missing token with 400 and does not call next", async () => {
  const middleware = requireTurnstile({ action: "login" });
  let nextCalled = false;
  let statusCode = 0;
  let jsonBody: unknown = null;

  const req = {
    body: {},
    header: (name: string) => (name.toLowerCase() === "x-request-id" ? "req-test-1" : undefined),
    ip: "127.0.0.1",
    method: "POST",
    baseUrl: "",
    path: "/auth/turnstile/verify",
  } as unknown as Request;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      jsonBody = payload;
      return this;
    },
  } as unknown as Response;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 400);
  assert.deepEqual(jsonBody, {
    message: "Security verification failed. Please complete the challenge and try again.",
    code: "missing_token",
  });
});

test("TURNSTILE-08: default expected hostnames include production and localhost", () => {
  const hosts = getExpectedTurnstileHostnames();
  assert.equal(hosts.includes("bantaispace.vercel.app"), true);
  assert.equal(hosts.includes("localhost"), true);
  assert.equal(hosts.includes("127.0.0.1"), true);
});
