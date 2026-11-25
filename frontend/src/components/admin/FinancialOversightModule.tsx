import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Landmark, Search, ShieldAlert, TrendingUp, Wallet, X } from "lucide-react";
import {
  getPlatformFinancialTrends,
  type PlatformFinancialAnomaly,
  type PlatformFinancialCompliance,
  type PlatformFinancialOverview,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import CompactAmount from "../ui/CompactAmount";
import SecurityTrendLineChart from "./SecurityTrendLineChart";

interface FinancialOversightModuleProps {
  overview: PlatformFinancialOverview | undefined;
  anomalies: PlatformFinancialAnomaly[];
  compliance?: PlatformFinancialCompliance;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onOpenFinancialAudit: () => void;
  activeTab?: "overview" | "compliance" | "anomalies";
}

function formatCentavos(centavos: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "PHP",
      minimumFractionDigits: 2,
    }).format(centavos / 100);
  } catch {
    return `${currency} ${(centavos / 100).toFixed(2)}`;
  }
}

export default function FinancialOversightModule({
  overview,
  anomalies,
  compliance,
  isLoading,
  isError,
  error,
  onRetry,
  onOpenFinancialAudit,
  activeTab = "overview",
}: FinancialOversightModuleProps) {
  const [selectedAnomaly, setSelectedAnomaly] = useState<PlatformFinancialAnomaly | null>(null);
  const [anomalySearch, setAnomalySearch] = useState("");
  const trendsQuery = useQuery({
    queryKey: ["admin-financial-trends", 30],
    queryFn: () => getPlatformFinancialTrends(30),
  });

  return (
    <div className="space-y-6">
      {isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
          <span>{formatErrorMessage(error)}</span>
          <button
            type="button"
            onClick={onRetry}
            className="font-medium underline cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Privacy Boundary Notice */}
      <div className="admin-card px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-secondary">
          <Landmark className="w-4 h-4 text-action shrink-0" />
          <span>
            Privacy-preserving aggregate view: displays currency-grouped totals and deterministic compliance flags without exposing private workspace line items.
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenFinancialAudit}
          className="text-action font-medium hover:underline cursor-pointer shrink-0 self-start sm:self-auto"
        >
          View Financial Audit Logs →
        </button>
      </div>

      {/* Aggregate Totals by Currency */}
      {activeTab === "overview" && (
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-primary flex items-center gap-2">
            <Wallet className="w-4 h-4 text-action" />
            Platform Aggregate Financial Summary
          </h2>
          <p className="text-xs text-secondary">
            Authoritative ledger totals grouped by currency across {overview?.workspace_status.active ?? 0} active,{" "}
            {overview?.workspace_status.suspended ?? 0} suspended, and {overview?.workspace_status.closed ?? 0} closed workspaces.
          </p>
        </div>

        {isLoading ? (
          <div className="admin-card p-6 text-center text-xs text-secondary">
            Loading aggregate financial metrics...
          </div>
        ) : overview?.by_currency.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {overview.by_currency.map((row) => (
              <div
                key={row.currency}
                className="admin-card p-5 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-subtle pb-3">
                  <span className="font-mono text-xs uppercase tracking-wider text-primary font-semibold">
                    {row.currency} Ledger Totals
                  </span>
                  {row.disputed_advances_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-mono text-rose-400">
                      {row.disputed_advances_count} disputed advance{row.disputed_advances_count === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border border-subtle bg-elevated/40 p-3">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted">Collected</p>
                    <p className="text-base font-heading font-semibold tabular-nums text-emerald-400 mt-1">
                      <CompactAmount centavos={row.collected_centavos} currency={row.currency} />
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-elevated/40 p-3">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted">Active Budgets</p>
                    <p className="text-base font-heading font-semibold tabular-nums text-primary mt-1">
                      <CompactAmount centavos={row.budget_allocated_centavos} currency={row.currency} />
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-elevated/40 p-3">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted">Approved Expenses</p>
                    <p className="text-base font-heading font-semibold tabular-nums text-primary mt-1">
                      <CompactAmount centavos={row.approved_expenses_centavos} currency={row.currency} />
                    </p>
                    <p className="text-[11px] font-mono text-muted mt-0.5">
                      {row.pending_expenses_count} pending (<CompactAmount centavos={row.pending_expenses_centavos} currency={row.currency} />)
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-elevated/40 p-3">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted">Open Advances</p>
                    <p className="text-base font-heading font-semibold tabular-nums text-amber-400 mt-1">
                      <CompactAmount centavos={row.open_advances_centavos} currency={row.currency} />
                    </p>
                    <p className="text-[11px] font-mono text-muted mt-0.5">
                      {row.open_advances_count} active · {row.disputed_advances_count} disputed
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-card p-6 text-center text-xs text-secondary">
            No financial records found across workspaces.
          </div>
        )}
      </section>
      )}

      {/* Deterministic Compliance & Anomaly Flags */}
      {activeTab === "anomalies" && (
      <section className="admin-table-shell overflow-hidden">
        <div className="px-5 py-4 border-b border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-primary flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Deterministic Compliance & Anomaly Flags
            </h2>
            <p className="text-xs text-secondary">
              Workspaces with over-budget commitments, disputed cash advances, high pending approval backlogs (≥5), or repeated payment reversals (≥3).
            </p>
          </div>
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={anomalySearch}
              onChange={(e) => setAnomalySearch(e.target.value)}
              placeholder="Search workspace or currency..."
              aria-label="Search financial anomalies"
              className="w-full h-8 pl-8 pr-7 rounded-lg bg-[#09090b] border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent"
            />
            {anomalySearch && (
              <button
                type="button"
                onClick={() => setAnomalySearch("")}
                aria-label="Clear anomaly search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3 font-medium">Workspace</th>
                <th className="px-4 py-3 font-medium">Over-Budget</th>
                <th className="px-4 py-3 font-medium">Disputed Advances</th>
                <th className="px-4 py-3 font-medium">Pending Expenses</th>
                <th className="px-4 py-3 font-medium">Reversed Payments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {(() => {
                const needle = anomalySearch.trim().toLowerCase();
                const filteredAnomalies = anomalies.filter((item) => {
                  if (!needle) return true;
                  return [item.organization_name, item.organization_id, item.currency].some((val) =>
                    (val ?? "").toLowerCase().includes(needle)
                  );
                });
                if (!filteredAnomalies.length) {
                  return (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-secondary">
                        {needle
                          ? "No anomalous workspaces match your search."
                          : "No workspace financial anomalies detected across the platform."}
                      </td>
                    </tr>
                  );
                }
                return filteredAnomalies.map((item) => (
                  <tr
                    key={item.organization_id}
                    onClick={() => setSelectedAnomaly(item)}
                    className="hover:bg-hover-surface/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-primary">{item.organization_name}</div>
                      <div className="font-mono text-[11px] text-muted">
                        {item.currency} · {item.organization_id}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {item.over_budget_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-rose-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {item.over_budget_count}
                        </span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {item.disputed_advances_count > 0 ? (
                        <span className="text-rose-400 font-medium">{item.disputed_advances_count}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-amber-400">
                      {item.pending_expenses_count}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-secondary">
                      {item.reversed_payments_count}
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {/* Budget Compliance, Approval Monitoring & Liquidation Aging */}
      {activeTab === "compliance" && compliance && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Budget Compliance Horizontal Bars */}
          <div className="lg:col-span-6 admin-card p-5 space-y-4">
            <div>
              <h2 className="text-sm font-medium text-primary">Budget Compliance by Workspace</h2>
              <p className="text-xs text-secondary">
                Active budget utilization (approved expenses + open cash advances vs. allocated caps).
              </p>
            </div>
            {compliance.budget_compliance.length ? (
              <div className="space-y-3">
                {compliance.budget_compliance.slice(0, 6).map((b) => {
                  const pct = Math.max(0, b.utilization_pct);
                  const barWidth = Math.min(100, pct);
                  const barColor =
                    pct > 100
                      ? "bg-rose-500"
                      : pct >= 80
                        ? "bg-amber-500"
                        : "bg-emerald-500";
                  const textColor =
                    pct > 100
                      ? "text-rose-400"
                      : pct >= 80
                        ? "text-amber-400"
                        : "text-emerald-400";
                  return (
                    <div key={`${b.organization_id}-${b.currency}`} className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-primary truncate">{b.organization_name}</span>
                        <span className={`font-mono tabular-nums shrink-0 ${textColor}`}>
                          {pct}% ({formatCentavos(b.committed_centavos, b.currency)} /{" "}
                          {formatCentavos(b.allocated_centavos, b.currency)})
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-elevated overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-secondary py-4 text-center">No active budgets configured.</p>
            )}
          </div>

          {/* Approval Monitoring & Liquidation Aging */}
          <div className="lg:col-span-6 flex flex-col gap-5">
            <div className="admin-card p-5 space-y-4">
              <div>
                <h2 className="text-sm font-medium text-primary">Approval Pipeline Breakdown</h2>
                <p className="text-xs text-secondary">
                  Distribution of expense submissions across verification & approval stages.
                </p>
              </div>
              {(() => {
                const { pending_count, verified_count, approved_count, rejected_count } =
                  compliance.approval_breakdown;
                const total = pending_count + verified_count + approved_count + rejected_count;
                const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
                return (
                  <div className="space-y-3">
                    <div className="h-3 rounded-full bg-elevated overflow-hidden flex">
                      {approved_count > 0 && (
                        <div className="bg-emerald-500 h-full" style={{ width: `${pct(approved_count)}%` }} title={`Approved: ${approved_count}`} />
                      )}
                      {verified_count > 0 && (
                        <div className="bg-sky-500 h-full" style={{ width: `${pct(verified_count)}%` }} title={`Verified: ${verified_count}`} />
                      )}
                      {pending_count > 0 && (
                        <div className="bg-amber-500 h-full" style={{ width: `${pct(pending_count)}%` }} title={`Pending: ${pending_count}`} />
                      )}
                      {rejected_count > 0 && (
                        <div className="bg-rose-500 h-full" style={{ width: `${pct(rejected_count)}%` }} title={`Rejected: ${rejected_count}`} />
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
                        <p className="text-[10px] font-mono uppercase text-muted">Pending</p>
                        <p className="text-sm font-semibold tabular-nums text-amber-400">{pending_count}</p>
                      </div>
                      <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
                        <p className="text-[10px] font-mono uppercase text-muted">Verified</p>
                        <p className="text-sm font-semibold tabular-nums text-sky-400">{verified_count}</p>
                      </div>
                      <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
                        <p className="text-[10px] font-mono uppercase text-muted">Approved</p>
                        <p className="text-sm font-semibold tabular-nums text-emerald-400">{approved_count}</p>
                      </div>
                      <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
                        <p className="text-[10px] font-mono uppercase text-muted">Rejected</p>
                        <p className="text-sm font-semibold tabular-nums text-rose-400">{rejected_count}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="admin-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium text-primary flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400" />
                    Liquidation Aging Buckets
                  </h2>
                  <p className="text-xs text-secondary">
                    Open cash advances grouped by release age and dispute status.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                  <p className="text-[10px] font-mono uppercase text-muted">0–7 Days</p>
                  <p className="text-base font-semibold tabular-nums text-emerald-400 mt-0.5">
                    {compliance.liquidation_aging.bucket_0_7d}
                  </p>
                </div>
                <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                  <p className="text-[10px] font-mono uppercase text-muted">8–30 Days</p>
                  <p className="text-base font-semibold tabular-nums text-amber-400 mt-0.5">
                    {compliance.liquidation_aging.bucket_8_30d}
                  </p>
                </div>
                <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                  <p className="text-[10px] font-mono uppercase text-muted">30+ Days</p>
                  <p className="text-base font-semibold tabular-nums text-rose-400 mt-0.5">
                    {compliance.liquidation_aging.bucket_30d_plus}
                  </p>
                </div>
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
                  <p className="text-[10px] font-mono uppercase text-rose-300">Disputed</p>
                  <p className="text-base font-semibold tabular-nums text-rose-400 mt-0.5">
                    {compliance.liquidation_aging.disputed_count}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Cross-Workspace Transaction Monitoring Trend */}
      {activeTab === "overview" && (
      <section className="admin-card p-5 space-y-3">
          <div>
            <h2 className="text-sm font-medium text-primary flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-action" />
              Cross-Workspace Transaction Activity (30d)
            </h2>
          <p className="text-xs text-secondary">
            Daily confirmed payment transactions vs. approved expense disbursements across all workspaces.
          </p>
        </div>
        <SecurityTrendLineChart
          data={(trendsQuery.data?.trends.series ?? []).map((pt) => ({
            day: pt.date,
            total: pt.payment_count,
            high_critical: pt.expense_count,
          }))}
          height={175}
          primaryLabel="Confirmed Payments"
          secondaryLabel="Approved Expenses"
          primaryColor="#10b981"
          secondaryColor="#f59e0b"
          emptyMessage="No financial transactions recorded in the last 30 days."
        />
      </section>
      )}

      {/* Exception Detail Modal */}
      {selectedAnomaly && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md admin-card p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                  Financial Exception Summary
                </p>
                <h3 className="text-sm font-heading font-semibold text-primary">
                  {selectedAnomaly.organization_name}
                </h3>
                <p className="text-[11px] font-mono text-muted">
                  {selectedAnomaly.currency} · {selectedAnomaly.organization_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAnomaly(null)}
                className="p-1 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl border border-subtle bg-elevated/40 p-3">
                <p className="text-[10px] font-mono uppercase text-muted">Over-Budget</p>
                <p className="text-base font-semibold tabular-nums text-rose-400 mt-0.5">
                  {selectedAnomaly.over_budget_count}
                </p>
              </div>
              <div className="rounded-xl border border-subtle bg-elevated/40 p-3">
                <p className="text-[10px] font-mono uppercase text-muted">Disputed Advances</p>
                <p className="text-base font-semibold tabular-nums text-rose-400 mt-0.5">
                  {selectedAnomaly.disputed_advances_count}
                </p>
              </div>
              <div className="rounded-xl border border-subtle bg-elevated/40 p-3">
                <p className="text-[10px] font-mono uppercase text-muted">Pending Expenses</p>
                <p className="text-base font-semibold tabular-nums text-amber-400 mt-0.5">
                  {selectedAnomaly.pending_expenses_count}
                </p>
              </div>
              <div className="rounded-xl border border-subtle bg-elevated/40 p-3">
                <p className="text-[10px] font-mono uppercase text-muted">Reversed Payments</p>
                <p className="text-base font-semibold tabular-nums text-secondary mt-0.5">
                  {selectedAnomaly.reversed_payments_count}
                </p>
              </div>
            </div>

            <p className="text-[11px] text-secondary">
              Private workspace line items are omitted to preserve tenant financial privacy. Use Financial Audit Logs to review governance actions.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedAnomaly(null)}
                className="px-3 py-1.5 rounded-xl border border-subtle text-xs text-secondary hover:text-primary cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedAnomaly(null);
                  onOpenFinancialAudit();
                }}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white cursor-pointer"
              >
                View Financial Audit Logs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
