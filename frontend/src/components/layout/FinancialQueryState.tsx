import { formatErrorMessage } from "../../utils/formatError";

export interface QueryState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

export type FinancialSkeletonVariant =
  | "cards"
  | "table"
  | "approvals"
  | "reports"
  | "space-detail"
  | "space-detail-body"
  | "contributions"
  | "compact";

export interface FinancialQueryStateProps {
  queries?: QueryState[];
  isLoading?: boolean;
  variant?: FinancialSkeletonVariant;
  kpiCount?: 0 | 3 | 4;
  showFilterToolbar?: boolean;
}

export function KpiCardsSkeletonRow({ count = 3 }: { count?: 0 | 3 | 4 }) {
  if (count === 0) return null;
  const gridClass =
    count === 3
      ? "grid grid-cols-1 sm:grid-cols-3 gap-4"
      : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4";

  return (
    <div className={gridClass}>
      {Array.from({ length: count }, (_, idx) => (
        <div
          key={idx}
          className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none flex flex-col justify-between min-h-[116px]"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="h-3 w-24 rounded-sm bg-skeleton" />
            <div className="h-4 w-4 rounded-sm bg-skeleton shrink-0" />
          </div>
          <div className="h-7 w-32 rounded-md bg-skeleton mt-2" />
          <div className="h-3 w-28 rounded-sm bg-skeleton/75 mt-2.5" />
        </div>
      ))}
    </div>
  );
}

export function FilterToolbarSkeleton({ pills = 2 }: { pills?: number }) {
  return (
    <div className="filter-toolbar" aria-hidden="true">
      <div className="toolbar-search relative flex-1">
        <div className="h-9 w-full rounded-full bg-surface border border-subtle px-4 flex items-center gap-2.5">
          <div className="h-4 w-4 rounded-sm bg-skeleton shrink-0" />
          <div className="h-3.5 w-44 rounded-md bg-skeleton" />
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {Array.from({ length: pills }, (_, idx) => (
          <div
            key={idx}
            className="h-9 w-28 rounded-full bg-surface border border-subtle"
          />
        ))}
      </div>
    </div>
  );
}

export function SpecularCardsGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: count }, (_, idx) => (
        <div
          key={idx}
          className="card-specular min-w-0 p-6 rounded-xl bg-surface border border-subtle flex flex-col justify-between shadow-xs dark:shadow-none"
        >
          <div className="pb-6">
            <div className="flex min-h-10 items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <div className="h-5 w-16 rounded-full bg-skeleton" />
                <div className="h-5 w-20 rounded-full bg-skeleton/70" />
              </div>
              <div className="h-7 w-7 rounded-lg bg-skeleton/70 shrink-0" />
            </div>

            <div className="h-6 w-3/4 rounded-lg bg-skeleton" />
            <div className="h-3.5 w-full rounded-sm bg-skeleton/70 mt-2.5" />

            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-3 w-24 rounded-sm bg-skeleton/80" />
                <div className="h-3 w-8 rounded-sm bg-skeleton" />
              </div>
              <div className="w-full bg-progress-track h-1.5 rounded-full overflow-hidden">
                <div className="h-full w-2/5 rounded-full bg-skeleton" />
              </div>
              <div className="grid grid-cols-2 items-baseline gap-3 pt-1">
                <div className="space-y-1.5">
                  <div className="h-2.5 w-14 rounded-sm bg-skeleton/70" />
                  <div className="h-4 w-24 rounded-sm bg-skeleton" />
                </div>
                <div className="space-y-1.5 flex flex-col items-end">
                  <div className="h-2.5 w-14 rounded-sm bg-skeleton/70" />
                  <div className="h-4 w-20 rounded-sm bg-skeleton" />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-subtle flex items-center justify-between gap-3">
            <div className="h-3.5 w-24 rounded-sm bg-skeleton/80" />
            <div className="h-3.5 w-28 rounded-sm bg-skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SpecularTableSkeleton({
  rows = 6,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="table-specular rounded-xl bg-surface border border-subtle overflow-hidden shadow-xs dark:shadow-none">
      <div className="h-11 bg-elevated border-b border-subtle px-6 flex items-center justify-between gap-4">
        {Array.from({ length: cols }, (_, idx) => (
          <div
            key={idx}
            className={`h-3 rounded-sm bg-skeleton/80 ${
              idx === 0 ? "w-28" : idx === cols - 1 ? "w-16" : "w-20 hidden sm:block"
            }`}
          />
        ))}
      </div>
      <div className="divide-y divide-subtle">
        {Array.from({ length: rows }, (_, rowIdx) => (
          <div
            key={rowIdx}
            className="px-6 py-4 flex items-center justify-between gap-4"
          >
            <div className="space-y-1.5 min-w-0 flex-1 max-w-[220px]">
              <div className="h-4 w-40 max-w-full rounded-sm bg-skeleton" />
              <div className="h-3 w-24 rounded-sm bg-skeleton/65" />
            </div>
            {cols >= 3 && (
              <div className="h-5 w-20 rounded-full bg-skeleton/80 hidden sm:block shrink-0" />
            )}
            {cols >= 4 && (
              <div className="h-4 w-24 rounded-sm bg-skeleton hidden md:block shrink-0" />
            )}
            {cols >= 5 && (
              <div className="h-5 w-18 rounded-full bg-skeleton/75 hidden lg:block shrink-0" />
            )}
            <div className="h-4 w-20 rounded-sm bg-skeleton shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FinancialQueryState({
  queries = [],
  variant = "cards",
  kpiCount,
  showFilterToolbar,
}: FinancialQueryStateProps) {
  const failed = queries.find((q) => q.isError);
  if (failed) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-700 dark:text-red-200"
      >
        <p>{formatErrorMessage(failed.error)}</p>
        <button
          className="mt-3 underline cursor-pointer text-red-700 dark:text-red-300 hover:text-primary"
          onClick={() => queries.filter((q) => q.isError).forEach((q) => void q.refetch())}
        >
          Try again
        </button>
      </div>
    );
  }

  const resolvedKpiCount =
    kpiCount !== undefined
      ? kpiCount
      : variant === "reports" || variant === "space-detail" || variant === "space-detail-body"
        ? 4
        : variant === "compact"
          ? 0
          : 3;

  const shouldShowToolbar =
    showFilterToolbar !== undefined
      ? showFilterToolbar
      : variant === "cards" || variant === "table";

  if (variant === "compact") {
    return (
      <div
        role="status"
        aria-label="Loading contribution summary"
        className="space-y-4 animate-pulse motion-reduce:animate-none"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-skeleton border border-subtle shrink-0" />
            <div className="space-y-1.5">
              <div className="h-4 w-36 rounded-sm bg-skeleton" />
              <div className="h-3 w-48 rounded-sm bg-skeleton/70" />
            </div>
          </div>
          <div className="h-3.5 w-16 rounded-sm bg-skeleton" />
        </div>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="p-3 rounded-2xl bg-elevated border border-subtle flex items-center justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="h-3 w-24 rounded-sm bg-skeleton" />
                <div className="h-3.5 w-20 rounded-sm bg-skeleton/80" />
              </div>
              <div className="h-4 w-20 rounded-sm bg-skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-6 animate-pulse motion-reduce:animate-none font-body"
      role="status"
      aria-label="Loading financial records"
    >
      {variant === "space-detail" && (
        <div className="card-specular p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2 max-w-xl flex-1">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-48 rounded-lg bg-skeleton" />
                <div className="h-5 w-16 rounded-full bg-skeleton/80" />
              </div>
              <div className="h-3.5 w-72 max-w-full rounded-sm bg-skeleton/70" />
            </div>
            <div className="h-8 w-24 rounded-lg bg-skeleton/80 border border-subtle shrink-0" />
          </div>
        </div>
      )}

      {variant === "space-detail-body" || variant === "space-detail" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="kpi-card min-w-0 rounded-2xl border border-subtle bg-surface p-5 shadow-xs dark:shadow-none"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="h-3 w-20 rounded-sm bg-skeleton" />
                <div className="h-4 w-4 rounded-sm bg-skeleton shrink-0" />
              </div>
              <div className="h-7 w-28 rounded-md bg-skeleton mt-3" />
            </div>
          ))}
        </div>
      ) : (
        <KpiCardsSkeletonRow count={resolvedKpiCount} />
      )}

      {shouldShowToolbar && <FilterToolbarSkeleton pills={2} />}

      {variant === "cards" && <SpecularCardsGridSkeleton count={6} />}

      {variant === "table" && <SpecularTableSkeleton rows={6} cols={6} />}

      {variant === "approvals" && (
        <>
          <div className="flex items-center gap-6 border-b border-subtle pb-3">
            <div className="h-4 w-24 rounded-sm bg-skeleton" />
            <div className="h-4 w-24 rounded-sm bg-skeleton/70" />
            <div className="h-4 w-28 rounded-sm bg-skeleton/70" />
          </div>
          <div className="space-y-4">
            <div className="h-5 w-48 rounded-md bg-skeleton" />
            <div className="table-specular divide-y divide-subtle rounded-xl bg-surface border border-subtle overflow-hidden shadow-xs dark:shadow-none">
              {[1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-20 rounded-full bg-skeleton" />
                      <div className="h-5 w-20 rounded-full bg-skeleton/70" />
                      <div className="h-3.5 w-28 rounded-sm bg-skeleton/60" />
                    </div>
                    <div className="h-5 w-60 max-w-full rounded-md bg-skeleton" />
                    <div className="h-3.5 w-72 max-w-full rounded-sm bg-skeleton/70" />
                  </div>
                  <div className="flex sm:flex-col items-end justify-between gap-3 shrink-0">
                    <div className="h-6 w-28 rounded-md bg-skeleton" />
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-24 rounded-full bg-skeleton/80" />
                      <div className="h-8 w-20 rounded-full bg-skeleton" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {variant === "contributions" && (
        <>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="h-5 w-52 rounded-md bg-skeleton" />
              <div className="h-3.5 w-24 rounded-sm bg-skeleton/80" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((card) => (
                <div
                  key={card}
                  className="card-specular p-5 rounded-2xl sm:rounded-xl bg-surface border border-subtle flex flex-col justify-between shadow-xs dark:shadow-none"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="h-5 w-24 rounded-full bg-skeleton/80" />
                      <div className="h-5 w-16 rounded-full bg-skeleton" />
                    </div>
                    <div className="h-6 w-3/4 rounded-md bg-skeleton mt-2" />
                    <div className="h-3.5 w-28 rounded-sm bg-skeleton/70 mt-2" />
                    <div className="mt-4 pt-3 border-t border-subtle flex items-baseline justify-between">
                      <div className="space-y-1">
                        <div className="h-2.5 w-14 rounded-sm bg-skeleton/70" />
                        <div className="h-4 w-20 rounded-sm bg-skeleton" />
                      </div>
                      <div className="space-y-1 flex flex-col items-end">
                        <div className="h-2.5 w-16 rounded-sm bg-skeleton/70" />
                        <div className="h-5 w-24 rounded-sm bg-skeleton" />
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-subtle">
                    <div className="h-3.5 w-32 rounded-sm bg-skeleton/80" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 pt-6 border-t border-subtle">
            <div className="flex items-center justify-between">
              <div className="h-5 w-52 rounded-md bg-skeleton" />
              <div className="h-3.5 w-20 rounded-sm bg-skeleton/80" />
            </div>
            <SpecularTableSkeleton rows={3} cols={5} />
          </div>
        </>
      )}

      {variant === "reports" && (
        <>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="h-5 w-56 rounded-md bg-skeleton" />
              <div className="h-3.5 w-20 rounded-sm bg-skeleton/80" />
            </div>
            <SpecularTableSkeleton rows={4} cols={5} />
          </div>
          <div className="space-y-4">
            <div className="h-5 w-48 rounded-md bg-skeleton" />
            <div className="card-specular grid gap-3 px-4 py-4 sm:grid-cols-3 bg-surface border border-subtle rounded-xl">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3.5 w-28 rounded-sm bg-skeleton/80" />
                  <div className="h-5 w-24 rounded-sm bg-skeleton" />
                </div>
              ))}
            </div>
            <SpecularTableSkeleton rows={3} cols={2} />
          </div>
        </>
      )}

      {(variant === "space-detail" || variant === "space-detail-body") && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-3">
            <div className="flex items-center gap-4">
              {[1, 2, 3, 4].map((t) => (
                <div key={t} className="h-4 w-24 rounded-sm bg-skeleton/80" />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-16 rounded-lg bg-skeleton/80" />
              <div className="h-4 w-28 rounded-sm bg-skeleton/70" />
            </div>
          </div>
          <SpecularCardsGridSkeleton count={3} />
        </>
      )}
    </div>
  );
}
