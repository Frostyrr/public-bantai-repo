import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  WorkspaceAccessErrorCard,
  resolveWorkspaceAccessState,
} from "../src/components/layout/WorkspaceAccessState";
import {
  ApiRequestError,
  createSessionRecoveryState,
  extractApiErrorDetails,
  resolveAuthenticatedUser,
  resolveSafeSession,
  type MinimalAuthClient,
} from "../src/config/sessionRecovery";

test("FRONTEND-01: resolveSafeSession deduplicates concurrent calls and resets after completion", async () => {
  const state = createSessionRecoveryState();
  let getSessionCount = 0;
  let signOutCount = 0;

  const auth: MinimalAuthClient = {
    getSession: async () => {
      getSessionCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        data: { session: { access_token: `token-${getSessionCount}` } },
        error: null,
      };
    },
    signOut: async () => {
      signOutCount += 1;
      return { error: null };
    },
  };

  const results = await Promise.all(
    Array.from({ length: 5 }, () => resolveSafeSession(auth, { state }))
  );
  assert.equal(getSessionCount, 1);
  assert.equal(signOutCount, 0);
  for (const session of results) {
    assert.equal(session?.access_token, "token-1");
  }

  const next = await resolveSafeSession(auth, { state });
  assert.equal(getSessionCount, 2);
  assert.equal(next?.access_token, "token-2");
});

test("FRONTEND-02: resolveSafeSession enforces bounded timeout without signing out", async () => {
  const state = createSessionRecoveryState();
  let signOutCount = 0;

  const auth: MinimalAuthClient = {
    getSession: () => new Promise(() => undefined),
    signOut: async () => {
      signOutCount += 1;
      return { error: null };
    },
  };

  await assert.rejects(
    () => resolveSafeSession(auth, { state, timeoutMs: 25 }),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.isTimeout, true);
      assert.equal(error.isNetworkError, true);
      assert.match(error.message, /Timed out/i);
      return true;
    }
  );
  assert.equal(signOutCount, 0);
});

test("FRONTEND-03: invalid refresh token clears local session while transient refresh error preserves session", async () => {
  const stateA = createSessionRecoveryState();
  const signOutCallsA: Array<{ scope?: string } | undefined> = [];
  const invalidRefreshAuth: MinimalAuthClient = {
    getSession: async () => ({
      data: { session: null },
      error: new Error("Invalid Refresh Token: Refresh Token Not Found"),
    }),
    signOut: async (options) => {
      signOutCallsA.push(options);
      return { error: null };
    },
  };

  const clearedSession = await resolveSafeSession(invalidRefreshAuth, { state: stateA });
  assert.equal(clearedSession, null);
  assert.equal(signOutCallsA.length, 1);
  assert.deepEqual(signOutCallsA[0], { scope: "local" });

  const stateB = createSessionRecoveryState();
  let signOutCountB = 0;
  const transientErrorAuth: MinimalAuthClient = {
    getSession: async () => ({
      data: { session: null },
      error: new Error("Failed to fetch"),
    }),
    signOut: async () => {
      signOutCountB += 1;
      return { error: null };
    },
  };

  await assert.rejects(() => resolveSafeSession(transientErrorAuth, { state: stateB }), /Failed to fetch/);
  assert.equal(signOutCountB, 0);
});

test("FRONTEND-04: resolveAuthenticatedUser clears confirmed 401s and preserves session on 429, 503, and network failures", async () => {
  const createAuth = (onSignOut: () => void): MinimalAuthClient => ({
    getSession: async () => ({
      data: { session: { access_token: "cached-token" } },
      error: null,
    }),
    signOut: async () => {
      onSignOut();
      return { error: null };
    },
  });

  // Confirmed 401 clears local session and resolves null cleanly.
  let signOutsOn401 = 0;
  const userOn401 = await resolveAuthenticatedUser({
    auth: createAuth(() => {
      signOutsOn401 += 1;
    }),
    state: createSessionRecoveryState(),
    fetchUser: async () => {
      throw extractApiErrorDetails({
        isAxiosError: true,
        response: {
          status: 401,
          data: { message: "Your session is invalid or expired.", code: "session_expired" },
        },
      });
    },
  });
  assert.equal(userOn401, null);
  assert.equal(signOutsOn401, 1);

  // 429 rate-limit / IP restriction preserves session and exposes Retry-After.
  let signOutsOn429 = 0;
  await assert.rejects(
    () =>
      resolveAuthenticatedUser({
        auth: createAuth(() => {
          signOutsOn429 += 1;
        }),
        state: createSessionRecoveryState(),
        fetchUser: async () => {
          throw extractApiErrorDetails({
            isAxiosError: true,
            response: {
              status: 429,
              headers: { "retry-after": "120" },
              data: { message: "Too many failed or unauthorized requests from this network." },
            },
          });
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiRequestError);
      assert.equal(err.status, 429);
      assert.equal(err.retryAfterSeconds, 120);
      assert.match(err.message, /Too many failed/);
      return true;
    }
  );
  assert.equal(signOutsOn429, 0);

  // 503 backend failure and network errors never sign out.
  let signOutsOn503 = 0;
  await assert.rejects(
    () =>
      resolveAuthenticatedUser({
        auth: createAuth(() => {
          signOutsOn503 += 1;
        }),
        state: createSessionRecoveryState(),
        fetchUser: async () => {
          throw extractApiErrorDetails({
            isAxiosError: true,
            response: { status: 503, data: {} },
          });
        },
      }),
    (err: unknown) => err instanceof ApiRequestError && err.status === 503
  );
  assert.equal(signOutsOn503, 0);

  let signOutsOnNetwork = 0;
  await assert.rejects(
    () =>
      resolveAuthenticatedUser({
        auth: createAuth(() => {
          signOutsOnNetwork += 1;
        }),
        state: createSessionRecoveryState(),
        fetchUser: async () => {
          throw extractApiErrorDetails({ isAxiosError: true, message: "Network Error" });
        },
      }),
    (err: unknown) =>
      err instanceof ApiRequestError &&
      err.isNetworkError === true &&
      /Could not reach the server/i.test(err.message)
  );
  assert.equal(signOutsOnNetwork, 0);
});

test("FRONTEND-05: OrganizationLayout access state renders retryable query errors without falsely reporting lost membership", () => {
  assert.equal(
    resolveWorkspaceAccessState({
      isPending: true,
      isError: false,
      hasMembership: false,
    }),
    "loading"
  );
  assert.equal(
    resolveWorkspaceAccessState({
      isPending: false,
      isError: true,
      isFetching: true,
      hasMembership: false,
    }),
    "loading"
  );
  assert.equal(
    resolveWorkspaceAccessState({
      isPending: false,
      isError: true,
      isFetching: false,
      hasMembership: false,
    }),
    "error"
  );
  assert.equal(
    resolveWorkspaceAccessState({
      isPending: false,
      isError: false,
      isFetching: false,
      hasMembership: false,
    }),
    "inaccessible"
  );
  assert.equal(
    resolveWorkspaceAccessState({
      isPending: false,
      isError: true,
      isFetching: false,
      hasMembership: true,
    }),
    "ready"
  );

  const errorMarkup = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      undefined,
      createElement(WorkspaceAccessErrorCard, {
        mode: "error",
        error: new ApiRequestError("Could not reach the server. Please try again.", {
          isNetworkError: true,
        }),
        onRetry: () => undefined,
      })
    )
  );
  assert.match(errorMarkup, /Unable to Load Workspace/);
  assert.match(errorMarkup, /role="alert"/);
  assert.match(errorMarkup, /Could not reach the server\. Please try again\./);
  assert.match(errorMarkup, /Try again/);
  assert.match(errorMarkup, /Return to Organizations/);
  assert.doesNotMatch(errorMarkup, /Workspace Not Accessible|not an active member/);

  const inaccessibleMarkup = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      undefined,
      createElement(WorkspaceAccessErrorCard, {
        mode: "inaccessible",
      })
    )
  );
  assert.match(inaccessibleMarkup, /Workspace Not Accessible/);
  assert.match(inaccessibleMarkup, /not an active member/);
  assert.match(inaccessibleMarkup, /Return to Organizations/);
  assert.doesNotMatch(inaccessibleMarkup, /Try again/);
});
