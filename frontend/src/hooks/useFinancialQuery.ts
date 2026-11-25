import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import type { FinancialReadRequest } from "../config/apiClient";
import { ApiRequestError } from "../config/sessionRecovery";
import { getBudget, getBudgets, getCashAdvances, getCollections, getExpenses, getFinancialInsights, getFinancialSummary } from "../lib/api";
import type { FinancialKind, FinancialScope } from "../utils/financialCache";

type Filters = { periodId?: string; spaceId?: string; status?: string; budgetId?: string };
type FinancialData = {
  "financial-summary": Awaited<ReturnType<typeof getFinancialSummary>>;
  "financial-insights": Awaited<ReturnType<typeof getFinancialInsights>>;
  collections: Awaited<ReturnType<typeof getCollections>>;
  budgets: Awaited<ReturnType<typeof getBudgets>>;
  expenses: Awaited<ReturnType<typeof getExpenses>>;
  advances: Awaited<ReturnType<typeof getCashAdvances>>;
};

const read: { [K in FinancialKind]: (orgId: string, filters: Filters, request: FinancialReadRequest) => Promise<FinancialData[K]> } = {
  "financial-summary": getFinancialSummary,
  "financial-insights": (orgId, _filters, request) => getFinancialInsights(orgId, request),
  collections: getCollections,
  budgets: async (orgId, filters, request) => filters.budgetId
    ? [await getBudget(orgId, filters.budgetId, undefined, request)] : getBudgets(orgId, filters, request),
  expenses: getExpenses,
  advances: getCashAdvances,
};

export default function useFinancialQuery<K extends FinancialKind>(
  kind: K, orgId: string | undefined, filters: Filters = {}, enabled = true,
) {
  const context = useOutletContext<{ financialScope?: FinancialScope }>();
  const client = useQueryClient();
  const scope = context?.financialScope;
  const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== "all"));
  const query = useQuery<FinancialData[K]>({
    queryKey: [kind, orgId, scope, params],
    // Keep an in-flight read available when Overview and a detail page hand off observers.
    queryFn: async () => {
      if (!orgId || !scope) throw new ApiRequestError("Workspace access is unavailable.");
      try {
        return await read[kind](orgId, params, { expectedUserId: scope.userId });
      } catch (error) {
        if (client.getQueryData<{ id: string }>(["auth"])?.id === scope.userId &&
            error instanceof ApiRequestError && (error.status === 403 || error.status === 404)) {
          void client.invalidateQueries({ queryKey: ["organizations"], exact: true }, { cancelRefetch: false });
        }
        throw error;
      }
    },
    enabled: enabled && !!orgId && !!scope,
    staleTime: kind === "financial-insights" ? 60_000 : 30_000,
    refetchInterval: kind === "financial-insights" ? 180_000 : false,
  });

  // Failed revalidation may retain earlier data. Hide it when access is denied.
  if (query.error instanceof ApiRequestError && [401, 403, 404].includes(query.error.status ?? 0)) {
    return { ...query, data: undefined };
  }
  return query;
}
