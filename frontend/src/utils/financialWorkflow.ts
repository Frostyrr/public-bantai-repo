export function totalsByCurrency(obligations: Array<{ status: string; amount_centavos: number; paid_centavos?: number; remaining_centavos?: number; collections?: { currency?: string } | null }>) {
  const totals = new Map<string, { currency: string; outstanding: number; paid: number }>();
  for (const item of obligations) {
    const currency = item.collections?.currency || 'PHP';
    const total = totals.get(currency) || { currency, outstanding: 0, paid: 0 };
    total.paid += item.paid_centavos || 0;
    if (!['paid', 'waived'].includes(item.status)) total.outstanding += Math.max(0, item.remaining_centavos ?? item.amount_centavos - (item.paid_centavos || 0));
    totals.set(currency, total);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
export const needsExpenseReview = (expense: { status: string }) => ['pending', 'verified'].includes(expense.status);
export const needsLiquidationReview = (advance: { status: string }) => advance.status === 'under_review';
export const canManageFinances = (role: string) => ['owner', 'organization_admin', 'treasurer'].includes(role);
export const canReviewFinances = (role: string) => ['owner', 'organization_admin', 'treasurer', 'auditor'].includes(role);

type PolicyExpense = { status: string; submitted_by: string; approval_policy_snapshot?: string; treasurer_approval_snapshot?: boolean; review_revision?: number; approval_decisions?: { officer_id: string; decision: string; expense_revision: number | null }[] };
export function canReviewExpense(expense: PolicyExpense, actorId?: string | null, role?: string) {
  const policy = expense.approval_policy_snapshot || 'legacy';
  const authorized = role === 'owner' || role === 'organization_admin' || (role === 'treasurer' && (expense.treasurer_approval_snapshot ?? true)) || (role === 'auditor' && policy === 'legacy');
  const own = expense.submitted_by === actorId;
  const duplicate = expense.approval_decisions?.some(d => d.officer_id === actorId && d.decision === 'approved' && d.expense_revision === expense.review_revision);
  return Boolean(actorId) && authorized && needsExpenseReview(expense) && !duplicate && (!own || policy === 'owner_admin_self' && (role === 'owner' || role === 'organization_admin'));
}
export function canVerifyExpense(expense: { status: string; submitted_by: string; verified_by: string | null }) {
  return expense.status === 'pending' || (expense.status === 'verified' && (!expense.verified_by || expense.verified_by === expense.submitted_by));
}
export function canApproveExpense(expense: { status: string; submitted_by: string; verified_by: string | null; approval_policy_snapshot?: string }, actorId?: string | null) {
  if (actorId === expense.submitted_by && expense.approval_policy_snapshot === 'owner_admin_self') return ['pending', 'verified'].includes(expense.status);
  return expense.status === 'verified' && Boolean(expense.verified_by) && expense.verified_by !== expense.submitted_by;
}

export function canReviewAdvance(advance: { status: string; organization_members?: { profile_id: string } | null; liquidations?: { submitted_by: string; status: string }[] | { submitted_by: string; status: string } | null }, actorId: string | undefined, role: string) {
  const liquidation = Array.isArray(advance.liquidations) ? advance.liquidations.find(l => l.status === 'submitted') : advance.liquidations;
  return Boolean(actorId) && canReviewFinances(role) && needsLiquidationReview(advance) && liquidation?.status === 'submitted' && liquidation.submitted_by !== actorId && advance.organization_members?.profile_id !== actorId;
}
