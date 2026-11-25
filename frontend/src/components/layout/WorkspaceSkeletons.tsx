import type { ReactNode } from "react";
import FinancialQueryState, {
  FilterToolbarSkeleton,
  SpecularTableSkeleton,
} from "./FinancialQueryState";

function readSidebarCollapsedPreference(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("bantai_sidebar_collapsed") === "true";
  } catch {
    return false;
  }
}

export function ActivityFeedCardSkeleton({
  hasTags = true,
  hasDescription = true,
}: {
  hasTags?: boolean;
  hasDescription?: boolean;
}) {
  return (
    <div className="card-specular max-md:before:hidden max-md:after:hidden px-4 py-4 md:p-5 md:rounded-2xl md:border md:border-subtle md:bg-surface md:shadow-(--shadow-card) dark:md:shadow-none">
      <div className="flex items-start gap-3.5 md:gap-4">
        <div className="w-9 h-9 rounded-full bg-skeleton border border-subtle shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 sm:gap-2.5">
            <div className="h-3.5 w-44 max-w-[65%] rounded-sm bg-skeleton" />
            <div className="h-5 w-18 rounded-full bg-skeleton/80 shrink-0" />
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-4 w-52 max-w-[75%] rounded-sm bg-skeleton" />
              {hasTags && (
                <>
                  <div className="h-5 w-16 rounded-md bg-skeleton/70" />
                  <div className="h-5 w-20 rounded-md bg-skeleton/55" />
                </>
              )}
            </div>
            {hasDescription && (
              <div className="h-3.5 w-4/5 rounded-sm bg-skeleton/65" />
            )}
          </div>
          <div className="mt-3 pt-2.5 border-t border-subtle flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="h-3 w-20 rounded-sm bg-skeleton/65" />
              <div className="h-4 w-24 rounded-sm bg-skeleton" />
            </div>
            <div className="h-3.5 w-14 rounded-sm bg-skeleton/75 shrink-0" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function OverviewKpiSkeletonCard() {
  return (
    <div className="card-specular rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-4 flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between gap-1 mb-1.5 sm:mb-2">
          <div className="h-3.5 w-24 rounded-sm bg-skeleton" />
          <div className="h-4 w-4 rounded-sm bg-skeleton shrink-0" />
        </div>
        <div className="h-7 sm:h-8 w-28 rounded-md bg-skeleton mt-1" />
      </div>
      <div className="mt-2.5 h-3.5 w-28 rounded-sm bg-skeleton/70" />
    </div>
  );
}

export function WorkspaceSidebarSkeleton({ collapsed }: { collapsed?: boolean }) {
  const isCollapsed = collapsed ?? readSidebarCollapsedPreference();
  const groups = [
    [1, 2, 3],
    [1, 2, 3, 4, 5, 6],
    [1, 2, 3, 4],
  ];

  return (
    <aside
      aria-hidden="true"
      className={`hidden md:flex flex-col shrink-0 border-r border-subtle workspace-sidebar-surface relative z-20 min-h-0 select-none ${
        isCollapsed ? "w-[72px]" : "w-60"
      }`}
    >
      {!isCollapsed ? (
        <div className="px-2.5 pt-3 pb-1 flex items-center gap-1.5">
          <div className="h-8 flex-1 rounded-lg bg-canvas border border-subtle px-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-sm bg-skeleton" />
              <div className="h-3 w-14 rounded-sm bg-skeleton/70" />
            </div>
            <div className="h-4 w-8 rounded border border-subtle bg-surface" />
          </div>
          <div className="size-8 shrink-0 rounded-lg bg-skeleton/50" />
        </div>
      ) : (
        <div className="px-2.5 pt-3 pb-1 flex flex-col items-center">
          <div className="size-9 rounded-lg bg-skeleton/50" />
        </div>
      )}

      <nav className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2.5 py-2.5">
        {groups.map((items, groupIdx) => (
          <div key={groupIdx} className="space-y-0.5">
            {!isCollapsed ? (
              groupIdx === 0 ? (
                <div className="px-2.5 pb-1">
                  <div className="h-3 w-16 rounded-sm bg-skeleton/70" />
                </div>
              ) : (
                <div className="border-t border-subtle my-2.5 mx-2" />
              )
            ) : groupIdx === 0 ? (
              <div className="mx-auto mb-1 size-7 rounded-lg bg-skeleton/50" />
            ) : (
              <div className="border-t border-subtle my-2 mx-2" />
            )}

            {items.map((item) => (
              <div
                key={item}
                className={`flex items-center gap-3 rounded-lg ${
                  isCollapsed ? "w-10 h-10 mx-auto justify-center" : "h-8 px-2.5 py-1.5"
                } ${groupIdx === 0 && item === 1 ? "bg-selected-surface" : ""}`}
              >
                <div className="size-[18px] rounded-sm bg-skeleton shrink-0" />
                {!isCollapsed && (
                  <div
                    className="h-3.5 rounded-sm bg-skeleton/80"
                    style={{ width: `${56 + ((groupIdx * 13 + item * 17) % 44)}px` }}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div
        className={`flex shrink-0 border-t border-subtle p-2 ${
          collapsed ? "flex-col items-center gap-1" : "items-center gap-1"
        }`}
      >
        <div className="size-10 rounded-lg bg-skeleton/45" />
        <div className={`size-10 rounded-lg bg-skeleton/45 ${collapsed ? "" : "ml-auto"}`} />
        <div className="size-10 rounded-lg bg-skeleton/45" />
      </div>
    </aside>
  );
}

export function WorkspaceOverviewSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading workspace overview"
      className="page-shell workspace-page pb-16 space-y-5! skeleton-shimmer font-body"
    >
      {/* Hero Cover Banner Skeleton */}
      <div className="card-specular">
        <div className="hidden md:block h-[150px] md:h-[180px] xl:h-[210px] w-full bg-secondary-surface border-b border-subtle" />
        <div className="px-5 py-4 md:p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
              <div className="h-11 w-11 rounded-xl md:h-16 md:w-16 md:rounded-2xl bg-skeleton border border-subtle md:border-4 md:border-surface shrink-0" />
              <div className="min-w-0 space-y-2">
                <div className="h-7 w-48 sm:w-64 rounded-lg bg-skeleton" />
                <div className="h-7 w-40 rounded-full bg-elevated border border-subtle" />
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
              <div className="h-9 sm:h-8 w-10 sm:w-22 rounded-md bg-skeleton/45" />
              <div className="h-9 sm:h-8 w-10 sm:w-28 rounded-md bg-skeleton/45" />
            </div>
          </div>
        </div>
      </div>

      {/* 5-KPI Financial Pulse + 3-Column Overview Body */}
      <div className="@container">
        <div className="hidden @min-[1000px]:grid grid-cols-5 items-stretch gap-4 mb-4">
          {[0, 1, 2, 3, 4].map((idx) => (
            <div key={idx} className="col-span-1 flex flex-col">
              <OverviewKpiSkeletonCard />
            </div>
          ))}
        </div>

        <div className="@min-[1000px]:hidden grid grid-cols-2 items-stretch gap-2.5 mb-5">
          {[0, 1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className={`${idx === 0 ? "col-span-2" : "col-span-1"} flex flex-col`}
            >
              <OverviewKpiSkeletonCard />
            </div>
          ))}
        </div>

        {/* Mobile Bani Strip + Section Select */}
        <div className="mb-4 @min-[1000px]:hidden">
          <div className="card-specular rounded-2xl border border-subtle p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-xl bg-skeleton" />
                <div className="h-4 w-28 rounded-sm bg-skeleton" />
              </div>
              <div className="h-5 w-16 rounded-full bg-skeleton/80" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3.5 w-full rounded-sm bg-skeleton/70" />
              <div className="h-3.5 w-4/5 rounded-sm bg-skeleton/60" />
            </div>
          </div>
        </div>

        <div className="mb-4 @min-[1000px]:hidden">
          <div className="h-4 w-32 rounded-sm bg-skeleton mb-2" />
          <div className="h-[46px] w-full rounded-xl bg-surface border border-subtle" />
        </div>

        {/* Desktop 3-Column / Tablet 2-Column Grid */}
        <div className="flex flex-col @min-[1000px]:grid @min-[1000px]:grid-cols-[minmax(0,1fr)_296px] @min-[1200px]:grid-cols-[264px_minmax(0,1fr)_296px] gap-6 xl:gap-7 items-start">
          {/* Center Column: Financial Activity Stream */}
          <div className="order-2 @min-[1000px]:order-none @min-[1000px]:col-start-1 @min-[1200px]:col-start-2 @min-[1200px]:row-start-1 w-full min-w-0">
            <div className="rounded-2xl shadow-(--shadow-card) dark:shadow-none">
              <div className="flex flex-col gap-2 @min-[1000px]:gap-3 p-4 sm:p-5 rounded-t-2xl border border-subtle dark:border-white/[0.08] bg-surface dark:bg-[#08080A]">
                <div className="hidden items-center gap-2 @min-[1000px]:flex">
                  <div className="h-5 w-36 rounded-md bg-skeleton" />
                  <div className="h-5 w-16 rounded-full bg-skeleton/80" />
                </div>
                <div className="h-3.5 w-28 rounded-sm bg-skeleton/70 @min-[1000px]:hidden" />
                <div className="grid min-w-0 gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_8.5rem] sm:grid-cols-[minmax(0,1fr)_10.5rem] sm:gap-3">
                  <div className="h-11 rounded-lg border border-subtle bg-surface" />
                  <div className="h-11 rounded-lg border border-subtle bg-surface" />
                </div>
              </div>
              <div className="p-4 sm:p-5 space-y-3.5 rounded-b-2xl border-x border-b border-subtle dark:border-white/[0.08] bg-surface dark:bg-[#08080A]">
                <div className="divide-y divide-subtle md:divide-y-0 md:space-y-3.5">
                  {[0, 1, 2, 3].map((item) => (
                    <ActivityFeedCardSkeleton
                      key={item}
                      hasTags={item % 2 === 0}
                      hasDescription={item !== 2}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Left Rail: Bani Insights */}
          <div className="hidden @min-[1000px]:block @min-[1200px]:col-start-1 @min-[1200px]:row-start-1 w-full min-w-0">
            <div className="card-specular rounded-2xl border border-subtle p-4 md:p-5 md:min-h-[360px] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-xl bg-skeleton shrink-0" />
                    <div className="h-4 w-24 rounded-sm bg-skeleton" />
                  </div>
                  <div className="h-5 w-16 rounded-full bg-skeleton/80" />
                </div>
                <div className="mt-3.5 space-y-2">
                  <div className="h-3.5 w-full rounded-sm bg-skeleton/75" />
                  <div className="h-3.5 w-11/12 rounded-sm bg-skeleton/65" />
                  <div className="h-3.5 w-3/4 rounded-sm bg-skeleton/55" />
                </div>
                <div className="mt-4 space-y-2">
                  {[1, 2, 3].map((btn) => (
                    <div
                      key={btn}
                      className="h-9 w-full rounded-xl border border-subtle bg-secondary-surface"
                    />
                  ))}
                </div>
                <div className="mt-4 pt-3.5 border-t border-subtle space-y-2">
                  {[1, 2, 3].map((row) => (
                    <div key={row} className="flex items-center justify-between">
                      <div className="h-3 w-20 rounded-sm bg-skeleton/70" />
                      <div className="h-3 w-12 rounded-sm bg-skeleton/80" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 pt-3.5 border-t border-subtle flex items-center justify-between">
                <div className="h-3 w-24 rounded-sm bg-skeleton/65" />
                <div className="h-7 w-16 rounded-full bg-skeleton" />
              </div>
            </div>
          </div>

          {/* Right Rail: Operational Widgets */}
          <div className="hidden @min-[1000px]:block @min-[1000px]:col-start-2 @min-[1200px]:col-start-3 @min-[1200px]:row-start-1 min-w-0 w-full space-y-3">
            {[1, 2, 3, 4].map((widget) => (
              <div
                key={widget}
                className="card-specular rounded-2xl bg-surface border border-subtle p-4 shadow-(--shadow-card) dark:shadow-none"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-secondary-surface border border-subtle shrink-0" />
                    <div className="h-4 w-36 rounded-sm bg-skeleton" />
                  </div>
                  <div className="h-8 w-8 rounded-lg bg-skeleton/50 shrink-0" />
                </div>
                <div className="pt-3 space-y-2">
                  <div className="p-3 rounded-xl bg-secondary-surface border border-subtle space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-3.5 w-28 rounded-sm bg-skeleton" />
                      <div className="h-3.5 w-16 rounded-sm bg-skeleton/80" />
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-progress-track">
                      <div className="h-full w-1/2 rounded-full bg-skeleton" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SpacesGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading spaces"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse motion-reduce:animate-none"
    >
      {Array.from({ length: count }, (_, idx) => (
        <div
          key={idx}
          className="card-specular min-w-0 p-6 rounded-xl bg-surface border border-subtle flex flex-col justify-between shadow-xs dark:shadow-none"
        >
          <div className="pb-6">
            <div className="flex min-h-10 items-center justify-between gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle shrink-0" />
              <div className="flex items-center gap-2">
                <div className="h-5 w-16 rounded-full bg-skeleton" />
                <div className="h-7 w-7 rounded-lg bg-skeleton/65" />
              </div>
            </div>
            <div className="h-6 w-3/4 rounded-md bg-skeleton" />
            <div className="h-3.5 w-full rounded-sm bg-skeleton/70 mt-2.5" />
            <div className="h-3.5 w-2/3 rounded-sm bg-skeleton/55 mt-1.5" />
          </div>
          <div className="mt-auto pt-4 border-t border-subtle flex items-center justify-between gap-3">
            <div className="h-3.5 w-24 rounded-sm bg-skeleton/80" />
            <div className="h-3.5 w-16 rounded-sm bg-skeleton/65" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AuditLogsTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading audit trail"
      className="divide-y divide-subtle animate-pulse motion-reduce:animate-none"
    >
      <div className="h-11 bg-elevated border-b border-subtle px-6 flex items-center justify-between gap-4">
        <div className="h-3 w-20 rounded-sm bg-skeleton/80" />
        <div className="h-3 w-20 rounded-sm bg-skeleton/80 hidden sm:block" />
        <div className="h-3 w-20 rounded-sm bg-skeleton/80 hidden md:block" />
        <div className="h-3 w-28 rounded-sm bg-skeleton/80 hidden lg:block" />
        <div className="h-3 w-14 rounded-sm bg-skeleton/80" />
      </div>
      {Array.from({ length: rows }, (_, idx) => (
        <div key={idx} className="py-4 px-6 flex items-center justify-between gap-4">
          <div className="space-y-1.5 shrink-0">
            <div className="h-3.5 w-24 rounded-sm bg-skeleton" />
            <div className="h-3 w-16 rounded-sm bg-skeleton/65" />
          </div>
          <div className="h-6 w-28 rounded-full bg-skeleton/80 hidden sm:block shrink-0" />
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 rounded-full bg-skeleton" />
            <div className="space-y-1">
              <div className="h-3.5 w-24 rounded-sm bg-skeleton" />
              <div className="h-2.5 w-16 rounded-sm bg-skeleton/65" />
            </div>
          </div>
          <div className="hidden lg:block space-y-1.5 min-w-0 flex-1 max-w-[180px]">
            <div className="h-3.5 w-32 rounded-sm bg-skeleton" />
            <div className="h-3 w-16 rounded-sm bg-skeleton/65" />
          </div>
          <div className="h-4 w-20 rounded-sm bg-skeleton/80 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function CollectionDetailSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading collection details"
      className="page-shell workspace-page space-y-4! animate-pulse motion-reduce:animate-none font-body"
    >
      <div className="h-4 w-36 rounded-sm bg-skeleton" />

      <div className="card-specular p-4 sm:p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2.5 flex-1 min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="h-7 w-56 rounded-lg bg-skeleton" />
              <div className="h-5 w-16 rounded-full bg-skeleton/80" />
              <div className="h-5 w-24 rounded-full bg-skeleton/70" />
            </div>
            <div className="h-3.5 w-80 max-w-full rounded-sm bg-skeleton/70" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-24 rounded-lg bg-skeleton/80 border border-subtle" />
            <div className="h-8 w-32 rounded-lg bg-skeleton/80 border border-subtle" />
          </div>
        </div>
        <div className="mt-4 pt-3.5 border-t border-subtle space-y-2">
          <div className="flex items-center justify-between">
            <div className="h-3 w-24 rounded-sm bg-skeleton/75" />
            <div className="h-3 w-10 rounded-sm bg-skeleton" />
          </div>
          <div className="h-1.5 w-full rounded-full bg-progress-track">
            <div className="h-full w-2/5 rounded-full bg-skeleton" />
          </div>
        </div>
      </div>

      <div className="card-specular rounded-2xl border border-subtle bg-surface shadow-xs dark:shadow-none grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-subtle">
        {[1, 2, 3, 4, 5, 6].map((stat) => (
          <div key={stat} className="min-w-0 px-4 py-3.5 space-y-2">
            <div className="h-3 w-20 rounded-sm bg-skeleton/75" />
            <div className="h-5 w-24 rounded-md bg-skeleton" />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-6 border-b border-subtle pb-3">
        <div className="h-4 w-36 rounded-sm bg-skeleton" />
        <div className="h-4 w-28 rounded-sm bg-skeleton/70" />
      </div>

      <FilterToolbarSkeleton pills={2} />
      <SpecularTableSkeleton rows={5} cols={5} />
    </div>
  );
}

export function PageHeaderSkeleton({ hasAction = true }: { hasAction?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6 animate-pulse motion-reduce:animate-none">
      <div className="space-y-2.5 flex-1">
        <div className="h-5 w-28 rounded-full bg-skeleton/80" />
        <div className="h-8 w-56 rounded-lg bg-skeleton" />
        <div className="h-4 w-96 max-w-full rounded-sm bg-skeleton/70" />
      </div>
      {hasAction && (
        <div className="h-9 w-36 rounded-full bg-skeleton shrink-0 self-start sm:self-center" />
      )}
    </div>
  );
}

export function WorkspaceRouteSkeleton({ pathname }: { pathname: string }) {
  const clean = pathname.replace(/\/+$/, "");
  const segments = clean.split("/").filter(Boolean);
  const subRoute = segments[3] ?? "overview";
  const hasDetailId = Boolean(segments[4]);

  if (subRoute === "overview") {
    return <WorkspaceOverviewSkeleton />;
  }

  if (subRoute === "collections" && hasDetailId) {
    return <CollectionDetailSkeleton />;
  }

  if (subRoute === "spaces" && hasDetailId) {
    return (
      <div className="page-shell workspace-page space-y-5! animate-pulse motion-reduce:animate-none">
        <div className="h-4 w-44 rounded-sm bg-skeleton" />
        <FinancialQueryState variant="space-detail" kpiCount={4} showFilterToolbar={false} />
      </div>
    );
  }

  if (subRoute === "spaces") {
    return (
      <div className="page-shell workspace-page">
        <PageHeaderSkeleton />
        <FilterToolbarSkeleton pills={1} />
        <SpacesGridSkeleton count={6} />
      </div>
    );
  }

  if (subRoute === "collections" || subRoute === "budgets") {
    return (
      <div className="page-shell workspace-page">
        <PageHeaderSkeleton />
        <FinancialQueryState variant="cards" kpiCount={3} />
      </div>
    );
  }

  if (subRoute === "expenses" || subRoute === "liquidation") {
    return (
      <div className="page-shell workspace-page">
        <PageHeaderSkeleton />
        <FinancialQueryState variant="table" kpiCount={3} />
      </div>
    );
  }

  if (subRoute === "approvals") {
    return (
      <div className="page-shell workspace-page">
        <PageHeaderSkeleton hasAction={false} />
        <FinancialQueryState variant="approvals" kpiCount={3} showFilterToolbar={false} />
      </div>
    );
  }

  if (subRoute === "reports") {
    return (
      <div className="page-shell workspace-page">
        <PageHeaderSkeleton />
        <FinancialQueryState variant="reports" kpiCount={4} showFilterToolbar={false} />
      </div>
    );
  }

  if (subRoute === "contributions") {
    return (
      <div className="page-shell workspace-page">
        <PageHeaderSkeleton />
        <FinancialQueryState variant="contributions" kpiCount={3} showFilterToolbar={false} />
      </div>
    );
  }

  if (subRoute === "audit-logs") {
    return (
      <div className="page-shell workspace-page">
        <PageHeaderSkeleton />
        <FilterToolbarSkeleton pills={2} />
        <div className="table-specular bg-surface rounded-xl border border-subtle shadow-xs dark:shadow-none overflow-hidden">
          <AuditLogsTableSkeleton rows={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell workspace-page animate-pulse motion-reduce:animate-none">
      <PageHeaderSkeleton />
      <FilterToolbarSkeleton pills={1} />
      <SpecularTableSkeleton rows={5} cols={4} />
    </div>
  );
}

export function OrgCardSkeleton() {
  return (
    <div aria-hidden="true" className="card-specular rounded-2xl bg-surface border border-subtle flex flex-col justify-between hardware-sharp shadow-(--shadow-card) dark:shadow-none">
      <div>
        <div className="h-28 sm:h-32 w-full overflow-hidden rounded-t-2xl bg-secondary-surface border-b border-subtle relative">
          <div className="absolute top-3 right-3 w-20 h-6 rounded-full bg-surface/70 border border-subtle" />
        </div>
        <div className="px-5 sm:px-6 relative">
          <div className="-mt-8 sm:-mt-9 mb-3.5 flex items-end justify-between">
            <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-surface p-1 border-2 border-subtle shadow-md dark:shadow-xl shrink-0">
              <div className="w-full h-full rounded-xl bg-skeleton" />
            </div>
          </div>
          <div className="mb-4 flex items-start justify-between gap-2">
            <div className="h-7 w-44 max-w-[70%] rounded-lg bg-skeleton" />
            <div className="h-5 w-11 rounded-md bg-secondary-surface border border-subtle shrink-0" />
          </div>
          <div className="p-3 rounded-xl bg-secondary-surface border border-subtle flex items-center justify-between gap-2 mb-4">
            <div className="space-y-1.5 min-w-0">
              <div className="h-2.5 w-16 rounded-sm bg-skeleton/70" />
              <div className="h-3.5 w-24 rounded-sm bg-skeleton" />
            </div>
            <div className="h-9 w-18 shrink-0 rounded-full border border-subtle bg-surface" />
          </div>
        </div>
      </div>
      <div className="px-5 sm:px-6 pb-5 pt-3 border-t border-subtle flex items-center gap-2">
        <div className="h-9 w-full rounded-full bg-skeleton" />
      </div>
    </div>
  );
}

export function MyOrganizationsHeading({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 border-b border-subtle pb-6 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-[28px] leading-[1.2] tracking-[-0.02em] md:text-[30px]">
          <span className="text-display-gradient">My Organizations</span>
        </h1>
        <p className="mt-1 font-body text-sm font-normal text-secondary sm:text-base">
          Select an organization to open its financial workspace, or create a new one.
        </p>
      </div>
      {children}
    </div>
  );
}

export function MyOrganizationsGridSkeleton() {
  return (
    <main aria-busy="true" className="relative z-10 mx-auto w-full max-w-7xl flex-1 space-y-8 p-4 sm:p-8">
      <MyOrganizationsHeading>
        <div aria-hidden="true" className="flex flex-wrap items-center gap-2 skeleton-shimmer">
          {["w-20", "w-24", "w-24"].map((width, idx) => (
            <div key={idx} className={`h-[30px] ${width} rounded-full border border-subtle bg-surface px-3 py-1.5`}>
              <div className="h-full rounded bg-skeleton" />
            </div>
          ))}
        </div>
      </MyOrganizationsHeading>

      <div aria-hidden="true" className="flex flex-col justify-between gap-3 skeleton-shimmer lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex h-[42px] max-w-md flex-1 items-center gap-2.5 rounded-xl border border-subtle bg-surface px-3.5">
            <div className="size-4 shrink-0 rounded-sm bg-skeleton" />
            <div className="h-3.5 w-44 rounded-md bg-skeleton" />
          </div>
          <div className="inline-flex items-center gap-1 self-start rounded-xl border border-subtle bg-secondary-surface p-1 sm:self-auto">
            <div className="h-7 w-10 rounded-lg bg-selected-surface" />
            <div className="h-7 w-16 rounded-lg bg-skeleton/60" />
            <div className="h-7 w-16 rounded-lg bg-skeleton/60" />
          </div>
        </div>
        <div className="h-[30px] w-40 self-start rounded-xl border border-subtle bg-surface lg:self-auto" />
      </div>

      <div role="status" className="grid grid-cols-1 gap-6 skeleton-shimmer md:grid-cols-2 lg:grid-cols-3">
        <span className="sr-only">Loading organizations</span>
        {[1, 2, 3].map(item => <OrgCardSkeleton key={item} />)}
      </div>
    </main>
  );
}

export function PersonalPaymentsSkeleton() {
  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 space-y-8 relative z-10 animate-pulse motion-reduce:animate-none">
      <div className="h-4 w-36 rounded-sm bg-skeleton" />
      <PageHeaderSkeleton hasAction={false} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-5 sm:p-6 rounded-2xl bg-surface border border-subtle shadow-lg space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-28 rounded-sm bg-skeleton" />
              <div className="w-7 h-7 rounded-lg bg-skeleton" />
            </div>
            <div className="h-8 w-36 rounded-md bg-skeleton" />
            <div className="h-3 w-32 rounded-sm bg-skeleton/70" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-5 rounded-2xl bg-surface border border-subtle h-52 flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex justify-between">
                <div className="w-24 h-4 rounded-sm bg-skeleton" />
                <div className="w-16 h-4 rounded-full bg-skeleton" />
              </div>
              <div className="w-36 h-5 rounded-sm bg-skeleton/80" />
            </div>
            <div className="pt-3 border-t border-subtle/80 flex justify-between">
              <div className="w-16 h-4 rounded-sm bg-skeleton" />
              <div className="w-20 h-4 rounded-sm bg-skeleton" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}


export function PersonalWorkspaceRouteSkeleton({ pathname }: { pathname: string }) {
  const route = pathname.replace(/\/+$/, "");
  if (route === "/app/payments") return <PersonalPaymentsSkeleton />;
  if (route === "/app/settings") {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-8 motion-safe:animate-pulse">
        <div className="h-7 w-40 rounded-md bg-skeleton" />
        <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <div className="h-40 rounded-xl border border-subtle bg-surface" />
          <div className="h-64 rounded-xl border border-subtle bg-surface" />
        </div>
      </div>
    );
  }
  return <MyOrganizationsGridSkeleton />;
}
