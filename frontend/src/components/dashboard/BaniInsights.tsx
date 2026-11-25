import useFinancialQuery from "../../hooks/useFinancialQuery";
import baniIcon from "../../assets/Bani 4.png";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileSearch,
  HandCoins,
  PieChart,
  TrendingUp,
} from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import CompactAmount from "../ui/CompactAmount";
import OrgSetupChecklist from "../onboarding/OrgSetupChecklist";

export type BaniDraft = { text: string; insightId?: string; autoSend?: boolean };

export default function BaniInsights({ orgId, currency = "PHP", onAskBani }: {
  orgId: string; currency?: string; onAskBani: (draft?: BaniDraft) => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [index, setIndex] = useState(0);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const query = useFinancialQuery("financial-insights", orgId);
  const summaryQuery = useFinancialQuery("financial-summary", orgId);
  const items = query.data?.insights ?? [];
  const position = index % Math.max(1, items.length);
  const insight = items[position];
  const summary = summaryQuery.data;
  const isLoading = query.isPending || summaryQuery.isPending;
  const statusKey = query.isPending ? "loading"
    : query.isError && !query.data ? "error"
    : summary
      ? `brief:${summary.reserve_balance_centavos}:${summary.total_collected_centavos}:${summary.total_outstanding_advances_centavos}:${currency}`
      : "clear";
  const pagerClass = "grid size-6 cursor-pointer place-items-center rounded-md text-secondary hover:bg-hover-surface hover:text-primary focus-visible:outline-2";
  const actionClass = "inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-sm text-xs text-secondary hover:text-primary hover:underline focus-visible:outline-2";

  const cardClass = isDark
    ? "border-white/20 bg-[#0D0D11] bg-linear-to-b from-[#16161B] via-[#0D0D11] to-[#09090B] shadow-[0_0_36px_-18px_rgba(255,255,255,0.12),inset_0_1px_0_0_rgba(255,255,255,0.12)] before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-white/45 before:to-transparent"
    : "border-slate-300/80 bg-white bg-linear-to-b from-[#eaf0f8] via-[#f7f9fc] to-white shadow-[0_10px_26px_-16px_rgba(30,41,59,0.40)] before:pointer-events-none before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-white before:to-transparent";

  const statusBadgeClass = isDark
    ? "border-white/15 bg-white/[0.06] text-zinc-200"
    : insight
      ? "border-sem-warning-border bg-sem-warning-bg text-sem-warning-fg shadow-(--shadow-pill)"
      : "border-sem-success-border bg-sem-success-bg text-sem-success-fg shadow-(--shadow-pill)";

  const promptSurface = isDark
    ? "border-zinc-800/90 bg-zinc-950/90 text-zinc-300 hover:border-white/30 hover:text-white"
    : "border-slate-200 bg-white/90 text-slate-700 shadow-(--shadow-pill) hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950";

  const dividerBorder = isDark ? "border-zinc-800/80" : "border-subtle";

  return (
    <section
      aria-label="Bani Insights"
      className={`group/bani animate-stagger-item relative isolate min-w-0 md:min-h-[360px] flex flex-col justify-between overflow-hidden rounded-2xl border p-4 md:p-5 ${cardClass}`}
    >
      {isDark && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-32 bg-[radial-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 -left-12 -z-10 h-48 w-72 bg-[radial-gradient(55%_60%_at_30%_25%,rgba(255,255,255,0.045),rgba(228,228,231,0.015)_55%,transparent_100%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 -translate-x-full bg-linear-to-r from-transparent via-white/[0.04] to-transparent transition-transform duration-700 motion-reduce:hidden group-hover/bani:translate-x-full"
          />
        </>
      )}

      <div>
        <OrgSetupChecklist orgId={orgId} />
        <header className="flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-[15px] tracking-[-0.01em]">
            <span className="size-8 shrink-0 rounded-xl border border-subtle bg-zinc-900 p-1 dark:border-white/25 dark:bg-linear-to-b dark:from-zinc-800 dark:to-zinc-950 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.28),0_0_20px_-4px_rgba(255,255,255,0.2)]">
              <img src={baniIcon} alt="" className="size-full object-contain grayscale" />
            </span>
            <span className={isDark ? "text-display-gradient dark:bg-linear-to-b dark:from-white dark:via-zinc-200 dark:to-zinc-400" : "font-heading font-semibold text-slate-950"}>
              Bani Insights
            </span>
          </h2>
          {isLoading ? (
            <span
              aria-hidden="true"
              className="h-5 w-16 rounded-full bg-skeleton animate-pulse motion-reduce:animate-none shrink-0"
            />
          ) : query.isSuccess && (
            <span
              title="Status of current insight checks"
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClass}`}
            >
              {insight ? <AlertCircle className="size-3" aria-hidden="true" /> : <CheckCircle2 className="size-3" aria-hidden="true" />}
              {insight ? "Flagged" : "Verified"}
            </span>
          )}
        </header>

        <div className="mt-2.5 md:mt-3.5 flex items-start justify-between gap-1">
          {isLoading ? (
            <div
              role="status"
              aria-label="Checking the workspace ledger"
              className="min-w-0 flex-1 space-y-1.5 py-0.5 animate-pulse motion-reduce:animate-none"
            >
              <div className="h-3.5 w-full rounded-sm bg-skeleton/80" />
              <div className="h-3.5 w-4/5 rounded-sm bg-skeleton/65" />
            </div>
          ) : (
            <div
              key={insight?.id ?? statusKey}
              aria-live="polite"
              className={`animate-insight-swap min-w-0 flex-1 wrap-break-word text-xs sm:text-[13px] leading-relaxed tabular-nums ${isDark ? "text-zinc-300" : "text-secondary"}`}
            >
              {insight ? (
                <>
                  <p className="font-medium text-primary">{insight.title}</p>
                  <p className="mt-0.5">{insight.description}</p>
                </>
              ) : query.isPending ? (
                "Checking the workspace ledger…"
              ) : query.isError && !query.data ? (
                "Current checks are unavailable."
              ) : summary ? (
                <>
                  Reserves stand at{" "}
                  <CompactAmount
                    centavos={summary.reserve_balance_centavos}
                    currency={currency}
                    className="font-medium text-primary"
                  />{" "}
                  with{" "}
                  <CompactAmount
                    centavos={summary.total_collected_centavos}
                    currency={currency}
                    className="font-medium text-primary"
                  />{" "}
                  collected and{" "}
                  {summary.total_outstanding_advances_centavos > 0 ? (
                    <>
                      <CompactAmount
                        centavos={summary.total_outstanding_advances_centavos}
                        currency={currency}
                        className="font-medium text-primary"
                      />{" "}
                      in open advances
                    </>
                  ) : (
                    "zero open advances"
                  )}
                  .
                </>
              ) : (
                "No issues flagged by current checks."
              )}
            </div>
          )}
          {items.length > 1 && (
            <div className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted">
              <button type="button" aria-label="Previous insight" className={pagerClass} onClick={() => setIndex((position + items.length - 1) % items.length)}>
                <ChevronLeft className="size-3.5" aria-hidden="true" />
              </button>
              <span>{position + 1}/{items.length}</span>
              <button type="button" aria-label="Next insight" className={pagerClass} onClick={() => setIndex((position + 1) % items.length)}>
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div
          id="bani-insights-mobile-details"
          className={isMobileExpanded ? "block" : "hidden md:block"}
        >
          {/* Stacked full-width prompt triggers */}
          <div className="mt-4 space-y-2">
            {[
              {
                label: "Cash flow summary",
                text: "Summarize our recorded treasury cash flow, including collections, approved expenses, outstanding advances, and reserve.",
                Icon: TrendingUp,
              },
              {
                label: "Budget burn check",
                text: "Review our active budgets and flag any approaching or exceeding their allocations.",
                Icon: PieChart,
              },
              {
                label: "Recent activity audit",
                text: "Audit recent treasury activity, collections, expenses, and advances for any anomalies or pending items.",
                Icon: FileSearch,
              },
            ].map(({ label, text, Icon }) => (
              <button
                key={label}
                type="button"
                className={`group w-full flex cursor-pointer items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-strong ${promptSurface}`}
                onClick={() => onAskBani({ text, autoSend: true })}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 transition-colors ${isDark ? "text-zinc-400 group-hover:text-white" : "text-muted group-hover:text-primary"}`}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium">{label}</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
              </button>
            ))}
          </div>

          {/* Aligned ledger check status table */}
          <ul
            aria-label="Ledger check summary"
            className={`mt-4 pt-3.5 border-t space-y-2 text-[11px] ${dividerBorder}`}
          >
            {[
              {
                label: "Advances",
                statusLabel: summary && summary.total_outstanding_advances_centavos > 0 ? "Open" : "Clear",
                Icon: HandCoins,
              },
              {
                label: "Budgets",
                statusLabel: insight && !insight.id.startsWith("negative_reserve:") ? "Review" : "Healthy",
                Icon: PieChart,
              },
              {
                label: "Approvals",
                statusLabel: "Current",
                Icon: CheckSquare,
              },
            ].map(({ label, statusLabel, Icon }) => (
              <li key={label} className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-2 ${isDark ? "text-zinc-400" : "text-secondary"}`}>
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-zinc-500" : "text-muted"}`} aria-hidden="true" />
                  <span>{label}</span>
                </span>
                {isLoading ? (
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-14 rounded-sm bg-skeleton animate-pulse motion-reduce:animate-none"
                  />
                ) : (
                  <span className={`inline-flex items-center gap-1 font-medium ${isDark ? "text-zinc-300" : "text-primary"}`}>
                    <Check className={`w-3 h-3 shrink-0 ${isDark ? "text-zinc-400" : "text-secondary"}`} aria-hidden="true" />
                    <span>{statusLabel}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className={`mt-3 md:mt-5 pt-2.5 md:pt-3.5 border-t flex flex-wrap items-center justify-between gap-x-2 ${dividerBorder}`}>
        <button
          type="button"
          aria-expanded={isMobileExpanded}
          aria-controls="bani-insights-mobile-details"
          onClick={() => setIsMobileExpanded((prev) => !prev)}
          className={`md:hidden inline-flex items-center gap-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-strong rounded-sm ${isDark ? "text-zinc-400 hover:text-zinc-200" : "text-secondary hover:text-primary"}`}
        >
          {isMobileExpanded ? (
            <>
              <span>Hide details</span>
              <ChevronUp className="size-3.5" aria-hidden="true" />
            </>
          ) : (
            <>
              <span>Show prompts &amp; checks</span>
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </>
          )}
        </button>
        <span className={`hidden md:inline text-[11px] ${isDark ? "text-zinc-500" : "text-muted"}`}>
          {query.isSuccess ? "Ledger checks complete" : query.isError ? "Checks unavailable" : "Checks in progress"}
        </span>
        <div className="flex items-center gap-2">
          {insight && <Link to={insight.action.href} aria-label={insight.action.label} className={actionClass}>View</Link>}
          <button
            type="button"
            className={`inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-full text-xs font-medium transition-colors focus-visible:outline-2 ${isDark ? "text-white hover:text-zinc-300" : "bg-slate-900 px-2.5 text-white hover:bg-slate-700"}`}
            onClick={() => onAskBani(insight ? {
              insightId: insight.id,
              text: insight.id.startsWith("negative_reserve:")
                ? "Why is our treasury reserve negative? What should we review?"
                : "Explain the flagged budget condition and which records we should review.",
            } : undefined)}
          >
            Ask Bani <ArrowRight className="size-3" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}
