import assert from "node:assert/strict";
import { test } from "node:test";
import { getLoginRestriction } from "../src/config/loginRestriction";
import { ApiRequestError } from "../src/config/sessionRecovery";

test("account and IP restriction responses carry a specific login notice and survive router state serialization", () => {
  for (const [code, status, title] of [
    ['account_locked', 403, 'Account temporarily locked'],
    ['account_suspended', 403, 'Account suspended'],
    ['ip_restricted', 429, 'IP restricted'],
    ['login_restricted', 429, 'Sign-in temporarily locked'],
  ] as const) {
    const notice = getLoginRestriction({ response: { status, data: { code }, headers: { 'retry-after': '45' } } });
    assert.ok(notice);
    assert.equal(notice.title, title);
    assert.deepEqual(getLoginRestriction(JSON.parse(JSON.stringify(notice))), notice);
    if (code !== 'account_suspended') assert.equal(notice.retryAfterSeconds, 45);
  }
});

test("MFA, ordinary authorization failures, rate limits, and network errors do not redirect as lockouts", () => {
  for (const error of [
    new ApiRequestError('Verify your sign-in.', { status: 403, code: 'mfa_required' }),
    new ApiRequestError('Access denied.', { status: 403 }),
    new ApiRequestError('Too many requests.', { status: 429 }),
    new ApiRequestError('Network unavailable.', { isNetworkError: true }),
    new ApiRequestError('Temporary error.', { status: 503, code: 'account_locked' }),
  ]) assert.equal(getLoginRestriction(error), null);
});
