import Badge from "../ui/Badge";
import Select from "../ui/Select";
import { useState, useMemo } from "react";
import FinancialActivityCard from "./FinancialActivityCard";
import ActivityQuickPreviewModal from "./ActivityQuickPreviewModal";
import type { ActorKind } from "../ui/ActorAvatar";
import { ActivityFeedCardSkeleton } from "../layout/WorkspaceSkeletons";
import {
  Paperclip,
  Search,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  X,
  FileText,
} from "lucide-react";
import {
  type Expense,
  type Collection,
  type Budget,
  type CashAdvance,
  type AuditLog,
} from "../../lib/api";

export type ActivityFilterType =
  | "all"
  | "expenses"
  | "collections"
  | "budgets"
  | "advances"
  | "approvals";

export interface UnifiedActivityItem {
  id: string;
  recordId: string;
  type: "expense" | "collection" | "budget" | "advance" | "approval";
  actorId?: string | null;
  actorName: string | null;
  actorAvatar?: string | null;
  actorType: ActorKind;
  attributionLabel: string;
  actionText: string;
  occurredAt: string;
  title: string;
  description?: string | null;
  amountLabel: string;
  metadata?: string[];
  amountCentavos?: number | null;
  currency: string;
  category?: string | null;
  status?: string | null;
  receiptUrl?: string | null;
  linkTo: string;
  linkText: string;
}

type ActivitySource = {
  data: unknown;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => unknown;
};

interface FinancialActivityFeedProps {
  orgId: string;
  currency: string;
  expenses: Expense[];
  collections: Collection[];
  budgets: Budget[];
  advances: CashAdvance[];
  auditLogs?: AuditLog[];
  sources: Record<"expenses" | "collections" | "budgets" | "advances", ActivitySource>;
}

const PAGE_SIZE = 8;

function getPaginationRange(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 5) {
    return Array.from({ length: total }, (_, idx) => idx + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("ellipsis");
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (end < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export default function FinancialActivityFeed({
  orgId,
  currency,
  expenses,
  collections,
  budgets,
  advances,
  sources,
}: FinancialActivityFeedProps) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActivityFilterType>("all");
  const [page, setPage] = useState(1);
  const [selectedReceipt, setSelectedReceipt] = useState<{ url: string; title: string } | null>(null);
  const [previewItem, setPreviewItem] = useState<UnifiedActivityItem | null>(null);

  // Synthesize authoritative financial activity timeline
  const allActivity = useMemo(() => {
    const items: UnifiedActivityItem[] = [];

    // 1. Expenditures Activity
    expenses.forEach((e) => {
      const isApproved = e.status === "approved";
      const submitterName = e.profiles?.display_name ?? null;
      items.push({
        id: `expense-${e.id}`,
        recordId: e.id,
        type: isApproved ? "approval" : "expense",
        actorId: e.submitted_by ?? e.profiles?.id ?? null,
        actorName: submitterName,
        actorAvatar: e.profiles?.avatar_url ?? null,
        actorType: submitterName ? "user" : "unavailable",
        attributionLabel: "Submitted by",
        actionText: "Submitted an expense",
        occurredAt: e.created_at,
        title: e.title,
        description: e.description || (e.vendor_name ? `Vendor: ${e.vendor_name}` : null),
        amountLabel: "Expense amount",
        metadata: [e.budgets?.name, e.spaces?.name].filter((value): value is string => Boolean(value)),
        amountCentavos: e.amount_centavos,
        currency: e.currency || currency,
        category: e.category,
        status: e.status,
        receiptUrl: e.receipt_url,
        linkTo: `/app/org/${orgId}/expenses`,
        linkText: "View Expenditure",
      });
    });

    // 2. Collections Activity
    collections.forEach((c) => {
      const creatorName = c.creator_profile?.display_name ?? null;
      items.push({
        id: `collection-${c.id}`,
        recordId: c.id,
        type: "collection",
        actorId: c.created_by ?? c.creator_profile?.id ?? null,
        actorName: creatorName,
        actorAvatar: c.creator_profile?.avatar_url ?? null,
        actorType: creatorName ? "user" : "unavailable",
        attributionLabel: "Created by",
        actionText: "Created collection campaign",
        occurredAt: c.created_at,
        title: c.title,
        description: c.description || (c.due_date ? `Due ${new Date(c.due_date).toLocaleDateString()}` : null),
        amountLabel: c.target_amount_centavos > 0 ? "Collection target" : "Collected amount",
        metadata: [c.reporting_periods?.name, c.spaces?.name].filter((value): value is string => Boolean(value)),
        amountCentavos: c.target_amount_centavos > 0 ? c.target_amount_centavos : c.total_collected_centavos,
        currency: c.currency || currency,
        status: c.status,
        linkTo: `/app/org/${orgId}/collections/${c.id}`,
        linkText: "View Collection",
      });
    });

    // 3. Budgets Activity
    budgets.forEach((b) => {
      const creatorName = b.creator_profile?.display_name ?? null;
      items.push({
        id: `budget-${b.id}`,
        recordId: b.id,
        type: "budget",
        actorId: b.created_by ?? b.creator_profile?.id ?? null,
        actorName: creatorName,
        actorAvatar: b.creator_profile?.avatar_url ?? null,
        actorType: creatorName ? "user" : "unavailable",
        attributionLabel: "Allocated by",
        actionText: "Allocated spending limit",
        occurredAt: b.created_at,
        title: b.name,
        description: b.description,
        amountLabel: "Budget allocation",
        metadata: [b.reporting_periods?.name, b.spaces?.name].filter((value): value is string => Boolean(value)),
        amountCentavos: b.allocated_amount_centavos,
        currency: b.currency || currency,
        status: b.status,
        linkTo: `/app/org/${orgId}/budgets`,
        linkText: "Inspect Budget",
      });
    });

    // 4. Cash Advances & Liquidations Activity
    advances.forEach((a) => {
      const releaserName = a.released_by_profile?.display_name ?? null;
      const custodianName = a.organization_members?.profiles?.display_name ?? null;
      const actorName = releaserName ?? custodianName;
      const actorAvatar =
        a.released_by_profile?.avatar_url ??
        a.organization_members?.profiles?.avatar_url ??
        null;
      items.push({
        id: `advance-${a.id}`,
        recordId: a.id,
        type: "advance",
        actorId: a.released_by ?? a.organization_members?.profile_id ?? null,
        actorName,
        actorAvatar,
        actorType: actorName ? "user" : "unavailable",
        attributionLabel: releaserName ? "Released by" : "Custodian",
        actionText: "Released cash advance",
        occurredAt: a.released_at || a.created_at,
        title: a.title,
        description: a.purpose,
        amountLabel: "Advance amount",
        metadata: [a.budgets?.name, a.spaces?.name].filter((value): value is string => Boolean(value)),
        amountCentavos: a.amount_released_centavos,
        currency: a.currency || currency,
        status: a.status,
        linkTo: `/app/org/${orgId}/liquidation`,
        linkText: "View Advance Details",
      });
      const liquidation = Array.isArray(a.liquidations) ? a.liquidations[0] : a.liquidations;
      if (liquidation?.status === "approved" && liquidation.reviewed_at) {
        items.push({
          id: `liquidation-${liquidation.id}`,
          recordId: a.id,
          type: "advance",
          actorName: null,
          actorAvatar: null,
          actorType: "unavailable",
          attributionLabel: "Reviewed",
          actionText: "Approved liquidation",
          occurredAt: liquidation.reviewed_at,
          title: a.title,
          amountLabel: "Approved liquidation spending",
          amountCentavos: liquidation.total_spent_centavos,
          currency: a.currency || currency,
          status: liquidation.status,
          linkTo: `/app/org/${orgId}/liquidation`,
          linkText: "View Advance Details",
        });
      }
    });

    // Sort strictly chronological, newest first
    return items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [expenses, collections, budgets, advances, orgId, currency]);

  // Filter items based on active tab
  const categoryActivity = useMemo(() => {
    if (activeFilter === "all") return allActivity;
    if (activeFilter === "expenses") return allActivity.filter((i) => i.type === "expense");
    if (activeFilter === "collections") return allActivity.filter((i) => i.type === "collection");
    if (activeFilter === "budgets") return allActivity.filter((i) => i.type === "budget");
    if (activeFilter === "advances") return allActivity.filter((i) => i.type === "advance");
    if (activeFilter === "approvals") return allActivity.filter((i) => i.type === "approval" || i.status === "approved");
    return allActivity;
  }, [allActivity, activeFilter]);

  const term = search.trim().toLowerCase();
  const filteredActivity = term ? categoryActivity.filter(item =>
    [item.title, item.actorName, item.category, item.description, ...(item.metadata ?? [])]
      .some(value => value?.toLowerCase().includes(term))
  ) : categoryActivity;

  const relevantSources = activeFilter === "all" || activeFilter === "approvals"
    ? Object.values(sources)
    : [sources[activeFilter]];
  const missing = relevantSources.filter(source => source.data === undefined);
  const waiting = missing.some(source => source.isPending || source.isFetching);
  const failed = missing.filter(source => source.isError);
  const incomplete = missing.length > 0;
  const showSkeleton = waiting && missing.length === relevantSources.length;
  const countLabel = `${filteredActivity.length} ${incomplete ? "loaded " : ""}${filteredActivity.length === 1 ? "event" : "events"}`;
  const totalPages = Math.max(1, Math.ceil(filteredActivity.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const visibleActivity = filteredActivity.slice(startIndex, startIndex + PAGE_SIZE);
  const rangeStart = filteredActivity.length === 0 ? 0 : startIndex + 1;
  const rangeEnd = Math.min(startIndex + PAGE_SIZE, filteredActivity.length);
  const paginationItems = getPaginationRange(currentPage, totalPages);

  return (
    <section
      aria-label="Financial Activity"
      className="min-w-0 rounded-2xl shadow-(--shadow-card) dark:shadow-none"
    >
      {/* The strip masks the gap above the pinned filters. */}
      <div className="lg:sticky lg:-top-2 lg:z-20 bg-workspace-canvas">
        <div
          aria-hidden="true"
          className="hidden lg:block pointer-events-none absolute -top-16 -inset-x-px h-16 bg-inherit"
        />
        <div className="flex flex-col gap-2 @min-[1000px]:gap-3 p-4 sm:p-5 rounded-t-2xl border border-subtle dark:border-white/[0.08] bg-surface dark:bg-[#08080A]">
        <div>
          <div className="hidden items-center gap-2 @min-[1000px]:flex">
            <h3 className="text-base sm:text-lg font-heading font-medium text-primary tracking-tight">
              Financial Activity
            </h3>
            {showSkeleton ? (
              <span
                aria-hidden="true"
                className="h-5 w-16 rounded-full bg-skeleton animate-pulse motion-reduce:animate-none"
              />
            ) : (!incomplete || filteredActivity.length > 0) && (
              <Badge>
                {countLabel}
              </Badge>
            )}
          </div>
        </div>

        {showSkeleton ? (
          <div
            aria-hidden="true"
            className="h-4 w-28 rounded-sm bg-skeleton animate-pulse motion-reduce:animate-none @min-[1000px]:hidden"
          />
        ) : (!incomplete || filteredActivity.length > 0) && (
          <p className="text-xs text-secondary @min-[1000px]:hidden">
            {countLabel}
          </p>
        )}

        <div className="grid min-w-0 gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_8.5rem] sm:grid-cols-[minmax(0,1fr)_10.5rem] sm:gap-3">
          <div className="relative min-w-0">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" />
            <input aria-label="Search loaded activity" aria-describedby="activity-search-scope" value={search}
              onChange={event => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search activity..." className="h-11 w-full rounded-lg border border-subtle bg-surface pl-9 pr-10 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong" />
            {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); setPage(1); }}
              className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-lg text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"><X aria-hidden="true" size={16} /></button>}
          </div>
          <Select
            ariaLabel="Activity category"
            value={activeFilter}
            onValueChange={value => {
              setActiveFilter(value as ActivityFilterType);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All Activity" },
              { value: "expenses", label: "Expenses" },
              { value: "collections", label: "Collections" },
              { value: "budgets", label: "Budgets" },
              { value: "advances", label: "Advances" },
              { value: "approvals", label: "Approvals" },
            ]}
            align="right"
            className="min-w-0"
            buttonClassName="h-11"
          />
        </div>
        <p id="activity-search-scope" className={search.trim() ? "text-xs text-secondary" : "sr-only"}>Search covers records loaded in this overview.</p>
        </div>
      </div>

      {/* Feed Body (scrolls with main page viewport) */}
      <div className="p-4 sm:p-5 space-y-3.5 rounded-b-2xl border-x border-b border-subtle dark:border-white/[0.08] bg-surface dark:bg-[#08080A]">
        {/* Structured Activity Feed Cards (Google Classroom Style) */}
        {showSkeleton ? (
          <div
            role="status"
            aria-label="Loading financial activity"
            className="divide-y divide-subtle md:divide-y-0 md:space-y-3.5 animate-pulse motion-reduce:animate-none"
          >
            {[0, 1, 2, 3].map((idx) => (
              <ActivityFeedCardSkeleton
                key={idx}
                hasTags={idx % 2 === 0}
                hasDescription={idx !== 2}
              />
            ))}
          </div>
        ) : visibleActivity.length === 0 && !incomplete ? (
          <div className="p-10 text-center space-y-3 rounded-xl bg-elevated/30 dark:bg-white/[0.02] border border-subtle">
          <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-muted mx-auto">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <p className="text-base font-heading font-medium text-primary">{term ? "No matching activity" : "No activity recorded"}</p>
            <p className="text-xs text-muted mt-0.5 max-w-sm mx-auto">
              {term ? "No loaded activity matches your search." : activeFilter === "all"
                ? "Financial operations, expenditures, and dues collections will appear here chronologically."
                : `No events matching the "${activeFilter}" filter.`}
            </p>
          </div>
          {activeFilter !== "all" && (
            <button
              type="button"
              onClick={() => { setActiveFilter("all"); setPage(1); }}
              className="text-sm font-mono text-secondary hover:text-primary underline cursor-pointer"
            >
              Reset to All Activity
            </button>
          )}
        </div>
        ) : (
          <div className="divide-y divide-subtle md:divide-y-0 md:space-y-3.5">
          {visibleActivity.map((item, index) => (
            <FinancialActivityCard
              key={`${currentPage}-${activeFilter}-${term}-${item.id}`}
              item={item}
              staggerIndex={index}
              onPreview={setPreviewItem}
            />
          ))}

          {/* Page-Based Pagination */}
          {totalPages > 1 && (
            <nav
              aria-label="Activity pagination"
              className="pt-3 px-4 sm:px-0 flex flex-col sm:flex-row items-center justify-between gap-3"
            >
              <p className="text-xs font-mono tabular-nums text-muted">
                Showing {rangeStart}–{rangeEnd} of {filteredActivity.length}{incomplete ? " loaded" : ""}
              </p>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-subtle bg-surface px-3 text-xs font-medium text-secondary shadow-(--shadow-pill) dark:shadow-none transition-colors hover:border-strong hover:bg-hover-surface hover:text-primary disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Prev</span>
                </button>

                {paginationItems.map((entry, idx) =>
                  entry === "ellipsis" ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-1.5 text-xs text-muted select-none"
                      aria-hidden="true"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setPage(entry)}
                      aria-current={entry === currentPage ? "page" : undefined}
                      aria-label={`Page ${entry}`}
                      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2.5 text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                        entry === currentPage
                          ? "bg-action text-action-fg font-semibold shadow-(--shadow-pill) dark:shadow-none"
                          : "border border-subtle bg-surface text-secondary shadow-(--shadow-pill) dark:shadow-none hover:border-strong hover:bg-hover-surface hover:text-primary"
                      }`}
                    >
                      {entry}
                    </button>
                  ),
                )}

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  aria-label="Next page"
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-subtle bg-surface px-3 text-xs font-medium text-secondary shadow-(--shadow-pill) dark:shadow-none transition-colors hover:border-strong hover:bg-hover-surface hover:text-primary disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </nav>
          )}
          </div>
        )}
        {waiting && !showSkeleton && (
          <p role="status" className="px-2 py-1 text-xs text-secondary">Loading more activity…</p>
        )}
        {failed.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs text-secondary">
            <span role="status">Some activity is unavailable.</span>
            <button type="button" disabled={failed.every(source => source.isFetching)}
              onClick={() => failed.filter(source => !source.isFetching).forEach(source => void source.refetch())}
              className="cursor-pointer underline underline-offset-2 focus-visible:outline-2 disabled:opacity-50">
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Quick Preview Modal (Level 2 Progressive Disclosure) */}
      <ActivityQuickPreviewModal
        orgId={orgId}
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onOpenReceipt={(url, title) => setSelectedReceipt({ url, title })}
      />

      {/* Receipt Proof Viewer Modal */}
      {selectedReceipt && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div className="relative max-w-2xl w-full rounded-2xl bg-surface border border-subtle shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-muted" />
                <h4 className="text-sm font-medium text-primary truncate max-w-md">
                  {selectedReceipt.title} — Supporting Receipt Proof
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                aria-label="Close receipt preview"
                className="p-1 rounded-lg text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto rounded-xl bg-elevated flex items-center justify-center p-2 border border-subtle">
              <img
                src={/^https?:\/\//i.test(selectedReceipt.url) ? selectedReceipt.url : undefined}
                alt="Receipt proof"
                className="max-h-[60vh] w-auto object-contain rounded-lg shadow-md"
              />
            </div>

            <div className="flex items-center justify-between text-sm font-mono text-secondary pt-1">
              <span>Supporting document</span>
              {/^https?:\/\//i.test(selectedReceipt.url) && (
                <a
                  href={selectedReceipt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <span>Open in full tab</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
