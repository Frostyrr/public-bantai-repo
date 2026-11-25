import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import queryClient from "../src/config/queryClient";
import {
  ApiRequestError, clearConfirmedInvalidSession, createSessionRecoveryState,
  resolveAuthenticatedUser, resolveSafeSession, withSessionDeadline,
} from "../src/config/sessionRecovery";

test("a hung callback/session operation reaches a timeout instead of leaving the boot screen pending", async () => {
  await assert.rejects(
    withSessionDeadline(() => new Promise<never>(() => undefined), 20, 'Sign-in timed out.'),
    (error: unknown) => error instanceof ApiRequestError && error.code === 'session_check_timeout' && error.isTimeout,
  );
});

test("hung session cleanup is bounded and releases the deduplication state", async () => {
  const state = createSessionRecoveryState();
  let calls = 0;
  const auth = { signOut: () => { calls++; return new Promise<never>(() => undefined); } };
  const first = clearConfirmedInvalidSession(auth, state, 20);
  assert.equal(clearConfirmedInvalidSession(auth, state, 20), first);
  await first;
  assert.equal(calls, 1);
  assert.equal(state.inFlightSignOutPromise, null);
  await clearConfirmedInvalidSession({ signOut: async () => { calls++; } }, state, 20);
  assert.equal(calls, 2);
});

test("the account check is bounded even when a request interceptor or response cleanup hangs", async () => {
  let signOuts = 0;
  const state = createSessionRecoveryState();
  const auth = {
    getSession: async () => ({ data: { session: { access_token: 'fixture' } }, error: null }),
    signOut: async () => { signOuts++; },
  };
  await assert.rejects(resolveAuthenticatedUser({
    auth, state, userFetchTimeoutMs: 20,
    fetchUser: () => new Promise<never>(() => undefined),
  }), (error: unknown) => error instanceof ApiRequestError && error.isTimeout);
  assert.equal(signOuts, 0);
  assert.deepEqual(await resolveAuthenticatedUser({ auth, state, fetchUser: async () => ({ id: 'user' }) }), { id: 'user' });
});

test("auth queries run offline and finish instead of staying in a paused pending state", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryDefaults(['auth'], queryClient.getQueryDefaults(['auth']));
  onlineManager.setOnline(false);
  let requests = 0;
  const observer = new QueryObserver(client, {
    queryKey: ['auth'],
    queryFn: () => {
      requests++;
      return resolveSafeSession({
        getSession: () => new Promise<never>(() => undefined), signOut: async () => undefined,
      }, { state: createSessionRecoveryState(), timeoutMs: 20 });
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await setImmediate();
    assert.equal(requests, 1);
    assert.equal(observer.getCurrentResult().fetchStatus, 'fetching');
    await new Promise(resolve => setTimeout(resolve, 35));
    const result = observer.getCurrentResult();
    assert.equal(result.isPending, false);
    assert.equal(result.status, 'error');
    assert.ok(result.error instanceof ApiRequestError && result.error.isTimeout);
  } finally {
    unsubscribe();
    client.clear();
    onlineManager.setOnline(true);
  }
});
