import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { focusManager, onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import queryClient from "../src/config/queryClient";
import { ApiRequestError } from "../src/config/sessionRecovery";

test("pending MFA keeps its challenge mounted across tab focus and reconnect, then refetches after verification", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryDefaults(['auth'], queryClient.getQueryDefaults(['auth']));
  let requests = 0;
  let verified = false;
  const observer = new QueryObserver(client, {
    queryKey: ['auth'],
    queryFn: async () => {
      requests++;
      if (!verified) throw new ApiRequestError("Verify your identity.", { status: 403, code: "mfa_required" });
      return { id: 'user-1' };
    },
  });
  const statuses: string[] = [];
  client.mount();
  const unsubscribe = observer.subscribe(result => statuses.push(result.status));
  try {
    await setImmediate();
    const error = observer.getCurrentResult().error;
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.code, 'mfa_required');
    statuses.length = 0;

    // The error has no user data. A background retry would move back to pending,
    // causing AppContainer to unmount the verification form and lose its state.
    for (let i = 0; i < 3; i++) {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await setImmediate();
    }
    assert.equal(requests, 1);
    assert.equal(observer.getCurrentResult().status, 'error');
    assert.deepEqual(statuses, []);

    verified = true;
    const result = await observer.refetch();
    assert.equal(requests, 2);
    assert.equal(result.status, 'success');
    assert.deepEqual(result.data, { id: 'user-1' });
  } finally {
    unsubscribe();
    client.unmount();
    client.clear();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  }
});

test("auth still refreshes on focus and reconnect for ordinary failures and stale signed-in data", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryDefaults(['auth'], queryClient.getQueryDefaults(['auth']));
  let requests = 0;
  const observer = new QueryObserver(client, {
    queryKey: ['auth'],
    staleTime: 0,
    queryFn: async () => {
      requests++;
      if (requests === 1) throw new ApiRequestError("Temporarily unavailable.", { status: 503 });
      return { id: 'user-1' };
    },
  });
  client.mount();
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await setImmediate();
    assert.equal(observer.getCurrentResult().status, 'error');
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await setImmediate();
    assert.equal(requests, 2);
    assert.equal(observer.getCurrentResult().status, 'success');

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await setImmediate();
    assert.equal(requests, 3);
    assert.equal(observer.getCurrentResult().status, 'success');
  } finally {
    unsubscribe();
    client.unmount();
    client.clear();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  }
});
