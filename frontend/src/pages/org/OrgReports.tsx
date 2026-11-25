import useFinancialQuery from "../../hooks/useFinancialQuery";
import { useState } from "react";
import Select from "../../components/ui/Select";
import { formatCategoryLabel } from "../../utils/formatCategoryLabel";
import FinancialQueryState from '../../components/layout/FinancialQueryState';
import PeriodScope from '../../components/layout/PeriodScope';
import { useOutletContext } from "react-router-dom";
import {
  Printer,
  TrendingUp,
  TrendingDown,
  DollarSign,
} from "lucide-react";
import Button from "../../components/ui/Button";
import CompactAmount from "../../components/ui/CompactAmount";
import {
  type OrganizationDetails,
  type Membership,
} from "../../lib/api";

interface ContextType {
  activePeriodId: string;
  reportingPeriods?: { id: string; name: string }[];
  organization: OrganizationDetails;
  membership: Membership;
}

function formatMoney(centavos: number, currency = "PHP") {
  const amount = (centavos / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

export default function OrgReports() {
  const { organization, activePeriodId, reportingPeriods } = useOutletContext<ContextType>();
  const [printDensity, setPrintDensity] = useState("standard");
  const periodId = activePeriodId === "all" ? undefined : activePeriodId;
  const periodName = periodId
    ? reportingPeriods?.find(period => period.id === periodId)?.name ?? "Selected period"
    : "All periods";
  const currency = organization?.currency ?? "PHP";

  const summaryQuery = useFinancialQuery("financial-summary", organization.id, { periodId });
  const allTimeSummaryQuery = useFinancialQuery("financial-summary", organization.id, {}, !!periodId);
  const collectionsQuery = useFinancialQuery("collections", organization.id, { periodId });
  const budgetsQuery = useFinancialQuery("budgets", organization.id, { periodId });
  const expensesQuery = useFinancialQuery("expenses", organization.id, { periodId });

  const summary = summaryQuery.data;
  const allTimeSummary = periodId ? allTimeSummaryQuery.data : summary;
  const collections = collectionsQuery.data ?? [];
  const budgets = budgetsQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];

  // Category breakdown for approved expenses
  const categorySpendingMap: Record<string, number> = {};
  expenses
    .filter((e) => e.status === "approved")
    .forEach((e) => {
      categorySpendingMap[e.category] = (categorySpendingMap[e.category] || 0) + e.amount_centavos;
    });

  const categories = Object.entries(categorySpendingMap);

  const pageQueries = [
    summaryQuery, collectionsQuery, budgetsQuery, expensesQuery,
    ...(periodId ? [allTimeSummaryQuery] : []),
  ];
  const reportReady = pageQueries.every(query => query.data !== undefined && !query.isError);
  const canPrint = reportReady && pageQueries.every(query => !query.isFetching);

  return (
    <div data-print-density={printDensity} className="transparency-report page-shell workspace-page print:p-0">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-subtle pb-5 print:border-b-2 print:border-black">
        <div>
          <h1 className="page-title">
            <span className="text-display-gradient">Financial Transparency Report</span>
          </h1>
          <p className="page-subtitle">
            Organization: <strong className="text-primary print:text-black">{organization.name}</strong> | Generated on {new Date().toLocaleDateString()}
          </p>
          <p className="text-sm text-secondary print:text-black">Reporting period: {periodName}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 lg:justify-end shrink-0 print:hidden">
          <PeriodScope />
          <Select
            ariaLabel="PDF layout"
            variant="pill"
            selectSize="sm"
            className="w-auto shrink-0"
            buttonClassName="h-9! min-h-9! px-3.5! text-xs!"
            value={printDensity}
            onChange={event => setPrintDensity(event.target.value)}
            options={[
              { value: "standard", label: "PDF: Standard" },
              { value: "compact", label: "PDF: Compact" },
            ]}
          />
          <Button
            variant="primary"
            size="sm"
            className="h-9! px-4! text-xs! shrink-0"
            disabled={!canPrint}
            onClick={() => { if (canPrint) window.print(); }}
            icon={<Printer className="w-3.5 h-3.5" />}
          >
            Print / Save PDF
          </Button>
        </div>
      </div>

      {!reportReady ? (
        <FinancialQueryState queries={pageQueries} variant="reports" kpiCount={4} showFilterToolbar={false} />
      ) : (
        <>
      {summary?.provisional && <p className="text-sm text-secondary">Provisional reporting-period totals. Some approved liquidations still need reconciliation or receipt confirmation.</p>}
      {periodId && allTimeSummary?.provisional && (
        <p className="text-sm text-secondary">The all-time reserve is provisional. Some approved liquidations still need reconciliation or receipt confirmation.</p>
      )}
      {!!summary?.unresolved_discrepancies_centavos && (
        <p className="text-sm text-secondary">Unresolved liquidation shortages: {formatMoney(summary.unresolved_discrepancies_centavos, currency)}</p>
      )}

      {/* EXECUTIVE SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:grid-cols-4">
        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none print:border-zinc-300 print:bg-white">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label print:text-zinc-600">Total Collected</span>
            <TrendingUp className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary print:text-black">
            <CompactAmount centavos={summary?.total_collected_centavos ?? 0} currency={currency} />
          </p>
          <p className="text-xs text-secondary mt-1 print:text-zinc-700">{periodName} · recorded collections</p>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none print:border-zinc-300 print:bg-white">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label print:text-zinc-600">Total Expenses</span>
            <TrendingDown className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary print:text-black">
            <CompactAmount centavos={summary?.total_expenses_centavos ?? 0} currency={currency} />
          </p>
          <p className="text-xs text-secondary mt-1 print:text-zinc-700">{periodName} · recognized spending</p>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none print:border-zinc-300 print:bg-white">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label print:text-zinc-600">Outstanding Floats</span>
            <DollarSign className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary print:text-zinc-700">
            <CompactAmount centavos={allTimeSummary?.total_outstanding_advances_centavos ?? 0} currency={currency} />
          </p>
          <p className="text-xs text-secondary mt-1 print:text-zinc-500">All time · unreconciled advances</p>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none print:border-zinc-300 print:bg-white">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label print:text-zinc-600">Net Reserve Balance</span>
          </div>
          <p className="metric-value text-primary print:text-zinc-700">
            <CompactAmount centavos={allTimeSummary?.reserve_balance_centavos ?? 0} currency={currency} />
          </p>
          <p className="text-xs text-secondary mt-1 print:text-zinc-700">
            All time · {(allTimeSummary?.reserve_balance_centavos ?? 0) < 0 ? "negative recorded reserve" : "recorded balance"}
          </p>
          {allTimeSummary?.outstanding_reimbursements_centavos !== undefined && (
            <p className="text-xs text-secondary mt-2">
              Reimbursements awaiting payment · <CompactAmount centavos={allTimeSummary.outstanding_reimbursements_centavos} currency={currency} />
            </p>
          )}
        </div>
      </div>

      {/* SECTION 1: CAMPAIGN COLLECTION PERFORMANCE */}
      <div className="space-y-4 print:space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-primary print:text-black section-title">
            Collection Campaign Performance
          </h2>
          <span className="text-xs font-mono text-secondary print:text-zinc-600">
            {collections.length} campaigns
          </span>
        </div>

        <div className="table-specular rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none overflow-hidden print:border-zinc-300 print:bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-subtle bg-elevated text-[11px] font-mono uppercase tracking-wider text-secondary print:text-zinc-600 print:border-zinc-300">
                  <th className="py-3 px-6">Campaign</th>
                  <th className="py-3 px-6 text-right">Target</th>
                  <th className="py-3 px-6 text-right">Collected</th>
                  <th className="py-3 px-6 text-center">Collection Rate</th>
                  <th className="py-3 px-6 text-right">Assessed Dues Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle text-sm print:divide-zinc-200">
                {collections.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted text-xs">
                      {periodId ? "No collection campaigns in this period." : "No collection campaigns recorded."}
                    </td>
                  </tr>
                ) : (
                  collections.map((c) => {
                    const coll = c.total_collected_centavos || 0;
                    const tar = c.target_amount_centavos || 0;
                    const rate = tar > 0 ? Math.min(100, Math.round((coll / tar) * 100)) : 0;
                    const assessed = c.total_obligations_count;
                    const paid = c.paid_obligations_count;
                    let settlement = "Settlement totals unavailable";
                    if (assessed === 0) settlement = "No dues assessed";
                    else if (assessed != null && paid != null) {
                      settlement = paid === assessed ? "All assessed dues paid" : `${paid} of ${assessed} paid`;
                    }
                    return (
                      <tr key={c.id}>
                        <td className="py-3 px-6 font-medium text-primary print:text-black">
                          {c.title}
                        </td>
                        <td className="py-3 px-6 text-right font-mono text-secondary print:text-black">
                          {formatMoney(tar, c.currency)}
                        </td>
                        <td className="py-3 px-6 text-right font-mono text-primary print:text-black">
                          {formatMoney(coll, c.currency)}
                        </td>
                        <td className="py-3 px-6 text-center font-mono text-primary print:text-black">
                          {rate}%
                        </td>
                        <td className="py-3 px-6 text-right font-mono text-secondary print:text-black">
                          {settlement}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* SECTION 2: EXPENDITURES BY CATEGORY */}
      <div className="space-y-4 print:space-y-2">
        <h2 className="text-primary print:text-black section-title">
          Expenditure breakdown
        </h2>
        <p className="text-sm text-secondary print:text-zinc-700">
          Directly paid expenses reflect cash paid. Recognized expenditure includes approved reimbursements awaiting payment and approved liquidation spending.
        </p>
        <dl className="card-specular grid gap-3 px-4 py-4 text-sm sm:grid-cols-3 bg-surface border border-subtle rounded-xl shadow-xs dark:shadow-none">
          {[
            ["Directly paid expenses", summary?.directly_paid_expenses_centavos ?? 0],
            ["Approved liquidation spending", summary?.approved_liquidation_spending_centavos ?? 0],
            ["Total recognized expenditure", summary?.total_expenses_centavos ?? 0],
          ].map(([label, amount]) => (
            <div key={label as string}>
              <dt className="text-secondary">{label as string}</dt>
              <dd className="mt-1 tabular-nums text-primary font-medium"><CompactAmount centavos={Number(amount)} currency={currency} /></dd>
            </div>
          ))}
        </dl>
        <div className="table-specular overflow-hidden rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none print:border-zinc-300">
          <p className="p-3 text-xs text-secondary">Expense records by category, before advance-funded allocations are deducted.</p>
          {categories.length === 0 ? <p className="p-4 text-sm text-secondary">No approved expenses recorded yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="bg-elevated text-secondary print:text-black">
                <tr><th scope="col" className="p-3">Category</th><th scope="col" className="p-3 text-right">Amount</th></tr>
              </thead>
              <tbody>{categories.map(([category, amount]) => (
                <tr key={category} className="border-t border-subtle print:border-zinc-300">
                  <th scope="row" className="p-3 font-medium capitalize text-primary">{formatCategoryLabel(category)}</th>
                  <td className="p-3 text-right tabular-nums text-primary">{formatMoney(amount, currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {/* SECTION 3: BUDGET ALLOCATION UTILIZATION */}
      <div className="space-y-4 print:space-y-2">
        <h2 className="text-primary print:text-black section-title">
          Budget Spending Limits &amp; Utilization
        </h2>
        <div className="table-specular rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none overflow-hidden print:border-zinc-300 print:bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-subtle bg-elevated text-[11px] font-mono uppercase tracking-wider text-secondary print:text-zinc-600 print:border-zinc-300">
                  <th className="py-3 px-6">Budget Allocation</th>
                  <th className="py-3 px-6 text-right">Allocated Limit</th>
                  <th className="py-3 px-6 text-right">Spent</th>
                  <th className="py-3 px-6 text-right">Committed</th>
                  <th className="py-3 px-6 text-right">Remaining Capacity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle text-sm print:divide-zinc-200">
                {budgets.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted text-xs">
                      No budgets allocated.
                    </td>
                  </tr>
                ) : (
                  budgets.map((b) => (
                    <tr key={b.id}>
                      <td className="py-3 px-6 font-medium text-primary print:text-black">{b.name}{b.provisional ? " (provisional)" : ""}</td>
                      <td className="py-3 px-6 text-right font-mono text-secondary print:text-black">
                        {formatMoney(b.allocated_amount_centavos, b.currency)}
                      </td>
                      <td className="py-3 px-6 text-right font-mono text-primary print:text-black">
                        {formatMoney(b.spent_centavos || 0, b.currency)}
                      </td>
                      <td className="py-3 px-6 text-right font-mono text-primary print:text-black">
                        {formatMoney(b.committed_centavos ?? 0, b.currency)}
                      </td>
                      <td className="py-3 px-6 text-right font-mono text-primary print:text-black">
                        {formatMoney(b.remaining_centavos ?? b.allocated_amount_centavos, b.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <footer className="p-4 rounded-2xl bg-elevated border border-subtle text-xs text-secondary font-mono print:border-0 print:p-0 print:text-zinc-700">
        <span>Generated from records entered in Bantai.</span>
      </footer>
        </>
      )}
    </div>
  );
}
