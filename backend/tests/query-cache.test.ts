import { authCacheAction } from '../../frontend/src/utils/authCache';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '../../frontend/node_modules/@tanstack/react-query';
import { financialKey } from '../../frontend/src/utils/queryKeys';

test('equivalent all-time dashboard consumers share a single request', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15000 } } });
  let requests = 0;
  const queryFn = async () => { requests++; await new Promise(r => setTimeout(r, 10)); return [1]; };
  await Promise.all([
    client.fetchQuery({ queryKey: financialKey('expenses', 'org', { periodId: 'all', status: 'all' }), queryFn }),
    client.fetchQuery({ queryKey: financialKey('expenses', 'org'), queryFn }),
  ]);
  await client.fetchQuery({ queryKey: financialKey('expenses', 'org'), queryFn });
  assert.equal(requests, 1);
  assert.notDeepEqual(financialKey('expenses', 'other'), financialKey('expenses', 'org'));
  assert.notDeepEqual(financialKey('expenses', 'org', { periodId: 'semester' }), financialKey('expenses', 'org'));
  client.clear();
});
test('prefix invalidation refreshes period variants only in the affected organization', async () => {
  const client = new QueryClient();
  const all = financialKey('expenses', 'org');
  const period = financialKey('expenses', 'org', { periodId: 'semester' });
  const other = financialKey('expenses', 'other');
  for (const key of [all, period, other]) client.setQueryData(key, [1]);
  await client.invalidateQueries({ queryKey: ['expenses', 'org'] });
  assert.equal(client.getQueryState(all)?.isInvalidated, true);
  assert.equal(client.getQueryState(period)?.isInvalidated, true);
  assert.equal(client.getQueryState(other)?.isInvalidated, false);
  client.clear();
});

test('auth cache survives repeated same-user sign-in and clears across identities', () => {
  assert.equal(authCacheAction('alice', 'alice', 'SIGNED_IN'), 'keep');
  assert.equal(authCacheAction('alice', 'alice', 'TOKEN_REFRESHED'), 'keep');
  assert.equal(authCacheAction('alice', 'bob', 'SIGNED_IN'), 'clear');
  assert.equal(authCacheAction('alice', null, 'SIGNED_OUT'), 'clear');
  assert.equal(authCacheAction('alice', 'alice', 'USER_UPDATED'), 'refresh-auth');
  assert.equal(authCacheAction(undefined, 'alice', 'INITIAL_SESSION'), 'keep');
});


test('budget list, overview and report filters reuse equivalent requests', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15000 } } });
  let requests = 0;
  const queryFn = async () => { requests++; return [1]; };
  for (const periodId of ['all', 'semester']) {
    await client.fetchQuery({ queryKey: financialKey('budgets', 'org', { spaceId: 'all', periodId }), queryFn });
    await client.fetchQuery({ queryKey: financialKey('budgets', 'org', { periodId }), queryFn });
  }
  assert.equal(requests, 2, 'one request per distinct reporting scope');
  await client.fetchQuery({ queryKey: financialKey('budgets', 'org', { periodId: 'semester', spaceId: 'department' }), queryFn });
  assert.equal(requests, 3, 'a different space must not reuse unfiltered data');
  client.clear();
});

test('shared freshness avoids early navigation refetch but invalidation still fetches', async () => {
  const { default: client } = await import('../../frontend/src/config/queryClient');
  let requests = 0;
  const queryFn = async () => { requests++; return [2]; };
  try {
    for (const kind of ['organizations', 'organization-members', 'organization-periods', 'organization-spaces']) {
      const queryKey = [kind, 'test-org'];
      client.setQueryData(queryKey, [1], { updatedAt: Date.now() - 45000 });
      await client.fetchQuery({ queryKey, queryFn });
    }
    for (const kind of ['auth', 'user-obligations']) {
      const queryKey = [kind];
      client.setQueryData(queryKey, [1], { updatedAt: Date.now() - 20000 });
      await client.fetchQuery({ queryKey, queryFn });
    }
    assert.equal(requests, 0);
    await client.invalidateQueries({ queryKey: ['user-obligations'] });
    await client.fetchQuery({ queryKey: ['user-obligations'], queryFn });
    assert.equal(requests, 1, 'writes invalidate even fresh data');
  } finally {
    client.clear();
  }
});
