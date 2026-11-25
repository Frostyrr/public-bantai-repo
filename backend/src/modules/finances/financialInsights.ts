import { getFinancialSummary, listBudgets } from "./finances.repository";

type Budget = { id: string; name: string; status: string; archived_at?: string | null; spent_centavos: number; allocated_amount_centavos: number };
export const insightRoles = new Set(["owner", "organization_admin", "treasurer"]);

export function evaluateInsights(orgId: string, reserve: number, budgets: Budget[], evaluatedAt: string, threshold = 80) {
  const root = `/app/org/${orgId}`;
  const make = (type: string, priority: "high" | "medium", title: string, description: string, label: string, path: string, key = orgId) => ({
    id: `${type}:${key}`, type, priority, title, description, organizationId: orgId,
    action: { label, href: root + path }, evaluatedAt,
  });
  const exceeded = [];
  const near = [];
  const seen = new Set<string>();
  for (const budget of budgets) {
    if (seen.has(budget.id) || budget.status !== "active" || budget.archived_at ||
        !Number.isSafeInteger(budget.spent_centavos) || !Number.isSafeInteger(budget.allocated_amount_centavos) ||
        budget.allocated_amount_centavos < 0 || budget.spent_centavos < 0) continue;
    seen.add(budget.id);
    const spent = BigInt(budget.spent_centavos);
    const limit = BigInt(budget.allocated_amount_centavos);
    if (spent > limit) exceeded.push({ budget, excess: budget.spent_centavos - budget.allocated_amount_centavos });
    else if (limit > 0n && spent * 100n >= limit * BigInt(threshold)) {
      near.push({ budget, percent: Number(spent * 100n / limit) });
    }
  }
  exceeded.sort((a, b) => b.excess - a.excess || a.budget.id.localeCompare(b.budget.id));
  near.sort((a, b) => b.percent - a.percent || a.budget.id.localeCompare(b.budget.id));
  const results = [];
  if (Number.isSafeInteger(reserve) && reserve < 0) {
    results.push(make("negative_reserve", "high", "Your treasury reserve needs attention.", "Your recorded reserve is negative. Review the financial report for contributing activity.", "Review finances", "/reports"));
  }
  for (const { budget } of exceeded.slice(0, 3)) {
    results.push(make("budget_exceeded", "high", "A budget has exceeded its allocation.", `${budget.name}: approved expenses exceed the authorized allocation.`, "Review budget", `/budgets?budget=${encodeURIComponent(budget.id)}`, budget.id));
  }
  if (near[0]) {
    const { budget, percent } = near[0];
    results.push(make("budget_nearing_limit", "medium", "A budget is approaching its limit.", `${budget.name}: approved expenses have reached ${percent}% of the allocation.`, "Review budget", `/budgets?budget=${encodeURIComponent(budget.id)}`, budget.id));
  }
  return results.slice(0, 3);
}

export async function getFinancialInsights(token: string, organizationId: string) {
  const [summary, budgets] = await Promise.all([getFinancialSummary(token, organizationId), listBudgets(token, organizationId)]);
  const evaluatedAt = new Date().toISOString();
  return { insights: evaluateInsights(organizationId, summary.reserve_balance_centavos, budgets, evaluatedAt), evaluatedAt };
}

export async function resolveInsight(token: string, orgId: string, id: string) {
  const [type, source] = id.split(":");
  if (type === "negative_reserve") {
    if (source !== orgId) return null;
    const summary = await getFinancialSummary(token, orgId);
    return { type, active: summary.reserve_balance_centavos < 0, ...summary };
  }

  const budget = (await listBudgets(token, orgId)).find(item => item.id === source);
  if (!budget || budget.archived_at || budget.status !== "active") return null;
  const [current] = evaluateInsights(orgId, 0, [budget], "");
  return {
    type,
    active: current?.type === type,
    budgetId: budget.id,
    currency: budget.currency,
    allocatedCentavos: budget.allocated_amount_centavos,
    approvedExpenseCentavos: budget.spent_centavos,
  };
}
