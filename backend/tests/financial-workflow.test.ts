import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalsByCurrency, canReviewExpense, canVerifyExpense, canApproveExpense, canReviewAdvance } from '../../frontend/src/utils/financialWorkflow';

test('personal totals preserve currency and ignore waived balances', () => {
  const result = totalsByCurrency([
    { status: 'pending', amount_centavos: 10000, paid_centavos: 2000, collections: { currency: 'PHP' } },
    { status: 'pending', amount_centavos: 500, collections: { currency: 'USD' } },
    { status: 'waived', amount_centavos: 900, collections: { currency: 'PHP' } },
    { status: 'paid', amount_centavos: 3000, paid_centavos: 3000, collections: { currency: 'PHP' } },
  ]);
  assert.deepEqual(result, [{ currency: 'PHP', outstanding: 8000, paid: 5000 }, { currency: 'USD', outstanding: 500, paid: 0 }]);
});
test('review eligibility distinguishes independent review from own work', () => {
  const expense = { status: 'pending', submitted_by: 'submitter', verified_by: null };
  assert.equal(canReviewExpense(expense, 'submitter', 'owner'), false);
  assert.equal(canReviewExpense(expense, undefined, 'owner'), false);
  assert.equal(canReviewExpense(expense, 'reviewer', 'member'), false);
  assert.equal(canReviewExpense(expense, 'reviewer', 'auditor'), true);
  assert.equal(canApproveExpense(expense), false);
  assert.equal(canVerifyExpense(expense), true);
  const verified = { ...expense, status: 'verified', verified_by: 'reviewer' };
  assert.equal(canApproveExpense(verified), true);
  assert.equal(canVerifyExpense(verified), false);
  const legacy = { ...verified, verified_by: 'submitter' };
  assert.equal(canApproveExpense(legacy), false);
  assert.equal(canVerifyExpense(legacy), true);
  assert.equal(canReviewExpense({ ...verified, status: 'approved' }, 'reviewer', 'auditor'), false);
});
test('cash advances enter the review queue only after independent submission', () => {
  const advance = { status: 'outstanding', organization_members: { profile_id: 'member' }, liquidations: { status: 'submitted', submitted_by: 'member' } };
  assert.equal(canReviewAdvance(advance, 'auditor', 'auditor'), false);
  assert.equal(canReviewAdvance({ ...advance, status: 'under_review' }, 'auditor', 'auditor'), true);
  assert.equal(canReviewAdvance({ ...advance, status: 'under_review' }, 'member', 'owner'), false);
});
