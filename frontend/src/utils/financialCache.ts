import type { QueryClient } from "@tanstack/react-query";

export type FinancialKind = "financial-summary" | "financial-insights" | "collections" | "budgets" | "expenses" | "advances";

export interface FinancialScope {
  readonly userId: string;
  readonly role: string;
  readonly membershipId?: string;
  readonly canSubmitExpenses?: boolean;
}

const affectedLists: Partial<Record<string, readonly FinancialKind[]>> = {
  collections: ["collections"],
  payments: ["collections"],
  budgets: ["budgets", "expenses", "advances"],
  expenses: ["expenses", "budgets"],
  advances: ["advances", "budgets"],
  "advance-requests": ["advances", "budgets"],
  liquidations: ["advances", "budgets", "expenses"],
  "financial-archive": ["budgets", "expenses", "advances"],
};

const readOnlyActions = new Set(["preview", "creation-review", "group-eligible-count"]);

export function isFinancialScope(value: unknown): value is FinancialScope {
  return !!value && typeof value === "object" && "userId" in value && "role" in value;
}

/** Mark the shared views stale even when the write was made outside a React mutation. */
export function invalidateFinancialWrite(client: QueryClient, method?: string, url?: string) {
  if (!url || !method || !["post", "put", "patch", "delete"].includes(method.toLowerCase())) return;
  const [, orgId, resource, ...segments] = url.split("?")[0].split("/").filter(Boolean);
  if (!url.startsWith("/organizations/") || !orgId || !resource) return;
  const lists = Object.hasOwn(affectedLists, resource) ? affectedLists[resource] : undefined;
  if (!lists || readOnlyActions.has(segments.at(-1) ?? "")) return;
  const kinds = new Set<unknown>(["financial-summary", "financial-insights", ...lists]);
  const affected = ({ queryKey }: { queryKey: readonly unknown[] }) =>
    kinds.has(queryKey[0]) && queryKey[1] === orgId && isFinancialScope(queryKey[2]);

  // A read started before the write must not make the new cache entry look fresh.
  void client.cancelQueries({ predicate: affected, fetchStatus: "fetching" });
  void client.invalidateQueries({ predicate: affected, refetchType: "none" });
  // Let existing mutation handlers start their own refresh before joining active reads.
  window.setTimeout(() => {
    void client.refetchQueries({
      type: "active",
      predicate: query => affected(query) && query.state.isInvalidated,
    }, { cancelRefetch: false });
  }, 0);
}
