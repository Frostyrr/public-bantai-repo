import { useEffect, useState, type ReactNode } from 'react';
import FinancialQueryState from './FinancialQueryState';
import { OverviewKpiSkeletonCard } from './WorkspaceSkeletons';

type Query = {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => unknown;
};

export default function QuerySection({
  queries,
  fallback,
  children,
}: {
  queries: Query[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const failed = queries.filter(q => q.isError);
  const refreshing = queries.some(q => q.isFetching);
  const loading = queries.some(q => q.data === undefined) && !failed.length;
  const [delayedLoading, setDelayedLoading] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setDelayedLoading(true), 120);
    return () => {
      window.clearTimeout(timer);
      setDelayedLoading(false);
    };
  }, [loading]);

  const showSkeleton = loading && delayedLoading;

  if (queries.some(q => q.data === undefined)) {
    if (failed.length) return <FinancialQueryState queries={failed} />;
    return (
      <div
        role="status"
        aria-label="Loading section"
        className={`h-full transition-opacity duration-150 motion-reduce:transition-none ${
          showSkeleton ? 'opacity-100 skeleton-shimmer' : 'opacity-0'
        }`}
      >
        {fallback ?? <OverviewKpiSkeletonCard />}
      </div>
    );
  }

  // Refresh cached values silently; show feedback only when a refresh fails.
  return (
    <div className="min-w-0 flex-1 flex flex-col [&>*:last-child]:flex-1 animate-content-in" aria-busy={refreshing}>
      {failed.length ? (
        <div role="status" className="text-xs text-sem-warning-fg mb-2">
          Refresh failed. Showing previously loaded data.{' '}
          <button className="underline disabled:opacity-50" disabled={refreshing} onClick={() => failed.forEach(q => void q.refetch())}>
            Retry
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
