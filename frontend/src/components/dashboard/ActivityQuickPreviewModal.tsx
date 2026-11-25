import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  AlertCircle,
  ArrowUpRight,
  Banknote,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  Paperclip,
  PiggyBank,
  Receipt,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import DetailInspector from "../ui/DetailInspector";
import { ActorAvatar } from "../ui/ActorAvatar";
import { getStatusBadgeClasses } from "../../utils/semanticStatus";
import {
  getBudget,
  getCashAdvance,
  getCollection,
  getExpense,
  type Budget,
  type CashAdvance,
  type Collection,
  type Expense,
} from "../../lib/api";
import type { UnifiedActivityItem } from "./FinancialActivityFeed";

interface ActivityQuickPreviewModalProps {
  orgId: string;
  item: UnifiedActivityItem | null;
  onClose: () => void;
  onOpenReceipt?: (url: string, title: string) => void;
}

type DetailRecord =
  | { kind: "expense"; data: Expense }
  | { kind: "collection"; data: Collection }
  | { kind: "budget"; data: Budget }
  | { kind: "advance"; data: CashAdvance };

type PreviewErrorState =
  | { kind: "forbidden"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "network"; message: string };

const RECORD_TYPE_LABELS: Record<UnifiedActivityItem["type"], string> = {
  expense: "Expense Record",
  approval: "Approved Expense",
  collection: "Collection Record",
  budget: "Budget Record",
  advance: "Cash Advance",
};

const RECORD_TYPE_ICONS: Record<UnifiedActivityItem["type"], React.ReactNode> = {
  expense: <Receipt className="w-4 h-4" />,
  approval: <CheckCircle2 className="w-4 h-4" />,
  collection: <Wallet className="w-4 h-4" />,
  budget: <PiggyBank className="w-4 h-4" />,
  advance: <Banknote className="w-4 h-4" />,
};

const DISBURSEMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  check: "Check",
  gcash: "GCash",
  maya: "Maya",
  other: "Other",
};

function formatCurrency(centavos: number | null | undefined, currency: string): string {
  const safe = typeof centavos === "number" && Number.isFinite(centavos) ? centavos : 0;
  const code = currency || "PHP";
  const amount = (safe / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${code} ${amount}`;
}

function formatExactTimestamp(dateString?: string | null): string {
  if (!dateString) return "Timestamp unavailable";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "Timestamp unavailable";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateOnly(dateString?: string | null): string | null {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatStatusLabel(status?: string | null): string {
  if (!status) return "";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface FetchResultState {
  requestKey: string;
  detail: DetailRecord | null;
  error: PreviewErrorState | null;
}

async function fetchDetailRecord(
  orgId: string,
  target: UnifiedActivityItem,
  signal: AbortSignal
): Promise<DetailRecord> {
  if (target.type === "collection") {
    return { kind: "collection", data: await getCollection(orgId, target.recordId, signal) };
  }
  if (target.type === "budget") {
    return { kind: "budget", data: await getBudget(orgId, target.recordId, signal) };
  }
  if (target.type === "advance") {
    return { kind: "advance", data: await getCashAdvance(orgId, target.recordId, signal) };
  }
  return { kind: "expense", data: await getExpense(orgId, target.recordId, signal) };
}

export const ActivityQuickPreviewModal: React.FC<ActivityQuickPreviewModalProps> = ({
  orgId,
  item,
  onClose,
  onOpenReceipt,
}) => {
  const [retryCount, setRetryCount] = useState(0);
  const [fetchResult, setFetchResult] = useState<FetchResultState | null>(null);

  const activeRequestKey = item ? `${orgId}:${item.id}:${retryCount}` : null;

  useEffect(() => {
    if (!item || !activeRequestKey) return;

    const controller = new AbortController();
    fetchDetailRecord(orgId, item, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setFetchResult({ requestKey: activeRequestKey, detail: loaded, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted || axios.isCancel(err)) return;
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const errorState: PreviewErrorState =
          status === 403
            ? {
                kind: "forbidden",
                message: "You do not have permission to view the full details of this record.",
              }
            : status === 404
            ? {
                kind: "not_found",
                message: "This record is no longer available or may have been removed.",
              }
            : {
                kind: "network",
                message: "Unable to load full record details. Please check your connection and try again.",
              };
        setFetchResult({ requestKey: activeRequestKey, detail: null, error: errorState });
      });

    return () => {
      controller.abort();
    };
  }, [orgId, item, activeRequestKey]);

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
  };

  const isCurrent = Boolean(item) && fetchResult?.requestKey === activeRequestKey;
  const loading = Boolean(item) && !isCurrent;
  const detail = isCurrent ? fetchResult.detail : null;
  const error = isCurrent ? fetchResult.error : null;

  const resolvedTitle =
    detail?.kind === "budget"
      ? detail.data.name
      : detail
      ? detail.data.title
      : item?.title ?? "";

  const resolvedStatus = detail ? detail.data.status : item?.status;
  const resolvedCurrency =
    (detail ? detail.data.currency || item?.currency : item?.currency) || "PHP";

  const resolvedActor = (() => {
    if (!item) {
      return {
        name: null,
        avatar: null,
        actorType: "unavailable" as const,
        attributionLabel: "Recorded by",
      };
    }
    if (detail?.kind === "expense") {
      const name = detail.data.profiles?.display_name ?? item.actorName;
      const avatar = detail.data.profiles?.avatar_url ?? item.actorAvatar;
      return {
        name,
        avatar,
        actorType: name ? ("user" as const) : ("unavailable" as const),
        attributionLabel: "Submitted by",
      };
    }
    if (detail?.kind === "collection") {
      const name = detail.data.creator_profile?.display_name ?? item.actorName;
      const avatar = detail.data.creator_profile?.avatar_url ?? item.actorAvatar;
      return {
        name,
        avatar,
        actorType: name ? ("user" as const) : ("unavailable" as const),
        attributionLabel: "Created by",
      };
    }
    if (detail?.kind === "budget") {
      const name = detail.data.creator_profile?.display_name ?? item.actorName;
      const avatar = detail.data.creator_profile?.avatar_url ?? item.actorAvatar;
      return {
        name,
        avatar,
        actorType: name ? ("user" as const) : ("unavailable" as const),
        attributionLabel: "Allocated by",
      };
    }
    if (detail?.kind === "advance") {
      const name =
        detail.data.released_by_profile?.display_name ??
        detail.data.organization_members?.profiles?.display_name ??
        item.actorName;
      const avatar =
        detail.data.released_by_profile?.avatar_url ??
        detail.data.organization_members?.profiles?.avatar_url ??
        item.actorAvatar;
      return {
        name,
        avatar,
        actorType: name ? ("user" as const) : ("unavailable" as const),
        attributionLabel: detail.data.released_by_profile?.display_name ? "Released by" : item.attributionLabel,
      };
    }
    return {
      name: item.actorName,
      avatar: item.actorAvatar,
      actorType: item.actorType,
      attributionLabel: item.attributionLabel,
    };
  })();

  const liquidationRecord =
    detail?.kind === "advance"
      ? Array.isArray(detail.data.liquidations)
        ? detail.data.liquidations[0] ?? null
        : detail.data.liquidations ?? null
      : null;

  const description =
    detail?.kind === "advance"
      ? detail.data.purpose
      : detail?.data.description ?? item?.description;
  const spaceName = detail?.data.spaces?.name;
  const periodName = detail?.data.reporting_periods?.name;
  const dueDate =
    detail?.kind === "collection" ? formatDateOnly(detail.data.due_date) : null;
  const referenceNumber =
    detail?.kind === "advance" ? detail.data.reference_number : null;
  const reviewNotes =
    detail?.kind === "expense" ? detail.data.review_notes : null;
  const receiptUrl =
    detail?.kind === "expense" ? detail.data.receipt_url : item?.receiptUrl;

  return (
    <DetailInspector
      isOpen={Boolean(item)}
      onClose={onClose}
      categoryLabel={item ? RECORD_TYPE_LABELS[item.type] : "Activity Preview"}
      title={resolvedTitle}
      subtitle={
        item ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-secondary-surface border border-subtle text-primary">
              {RECORD_TYPE_ICONS[item.type]}
            </span>
            {resolvedStatus && (
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStatusBadgeClasses(
                  resolvedStatus
                )}`}
              >
                {formatStatusLabel(resolvedStatus)}
              </span>
            )}
          </span>
        ) : undefined
      }
      footer={
        item ? (
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full border border-subtle bg-secondary-surface dark:bg-elevated hover:bg-hover-surface text-xs font-medium text-secondary hover:text-primary transition-colors cursor-pointer"
            >
              Close
            </button>
            <Link
              to={item.linkTo}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-action text-action-fg hover:opacity-90 text-xs font-medium transition-opacity"
            >
              <span>Open Full Record</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : undefined
      }
    >
      {item && (
        <>
          <div>
          {/* Compact Creator & Timestamp Row */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-secondary">
            <div className="inline-flex items-center gap-2 min-w-0">
              <ActorAvatar
                name={resolvedActor.name}
                avatarUrl={resolvedActor.avatar}
                actorType={resolvedActor.actorType}
                size="xs"
              />
              <span className="truncate">
                {resolvedActor.attributionLabel}{" "}
                <strong className="font-semibold text-primary">
                  {resolvedActor.name || "Actor unavailable"}
                </strong>
              </span>
            </div>
            <span aria-hidden="true" className="text-muted">·</span>
            <span className="inline-flex items-center gap-1 text-secondary">
              <Calendar className="w-3.5 h-3.5 text-muted shrink-0" />
              <span>{formatExactTimestamp(item.occurredAt)}</span>
            </span>
          </div>

          {/* Inline Category / Context Tags + Unboxed Description */}
          {(item.category || spaceName || periodName || dueDate || referenceNumber) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {item.category && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary-surface text-secondary border border-subtle capitalize">
                  {item.category}
                </span>
              )}
              {spaceName && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary-surface text-secondary border border-subtle">
                  {spaceName}
                </span>
              )}
              {periodName && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary-surface text-secondary border border-subtle">
                  {periodName}
                </span>
              )}
              {dueDate && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary-surface text-secondary border border-subtle">
                  Due {dueDate}
                </span>
              )}
              {referenceNumber && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-secondary-surface text-secondary border border-subtle">
                  Ref: {referenceNumber}
                </span>
              )}
            </div>
          )}

          {description && (
            <p className="mt-3 text-sm text-secondary leading-relaxed whitespace-pre-wrap break-words">
              {description}
            </p>
          )}
        </div>

        {/* 3. Single Highlighted Financial Summary Card (or Loading / Error State) */}
        {loading ? (
          <div
            className="mt-5 p-4 md:p-5 rounded-xl bg-secondary-surface dark:bg-elevated border border-subtle space-y-4"
            aria-busy="true"
            aria-label="Loading full record details"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted">
                  {item.amountLabel}
                </p>
                {typeof item.amountCentavos === "number" && Number.isFinite(item.amountCentavos) ? (
                  <p className="text-xl md:text-2xl font-bold font-mono tabular-nums text-primary mt-0.5">
                    {formatCurrency(item.amountCentavos, resolvedCurrency)}
                  </p>
                ) : (
                  <div className="h-7 w-44 rounded-lg bg-skeleton animate-pulse mt-1.5" />
                )}
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Syncing details</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 mt-3 border-t border-subtle animate-pulse">
              <div className="space-y-1.5">
                <div className="h-3 w-20 rounded bg-skeleton" />
                <div className="h-4 w-28 rounded bg-skeleton" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 w-24 rounded bg-skeleton" />
                <div className="h-4 w-24 rounded bg-skeleton" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 w-20 rounded bg-skeleton" />
                <div className="h-4 w-32 rounded bg-skeleton" />
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="mt-5 rounded-xl border border-subtle bg-secondary-surface dark:bg-elevated p-5 text-center space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-surface border border-subtle flex items-center justify-center text-secondary">
              {error.kind === "forbidden" ? (
                <Lock className="w-5 h-5" />
              ) : error.kind === "not_found" ? (
                <ShieldAlert className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-primary">
                {error.kind === "forbidden"
                  ? "Access Restricted"
                  : error.kind === "not_found"
                  ? "Record Unavailable"
                  : "Unable to Load Details"}
              </h3>
              <p className="text-xs sm:text-sm text-secondary max-w-md mx-auto">
                {error.message}
              </p>
            </div>
            {error.kind === "network" && (
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-subtle bg-surface hover:bg-hover-surface text-xs font-medium text-primary transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <section
              aria-label="Financial Summary"
              className="mt-5 p-4 md:p-5 rounded-xl bg-secondary-surface dark:bg-elevated border border-subtle"
            >
              {detail?.kind === "budget" && (
                <>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted">
                      Allocated Budget
                    </p>
                    <p className="text-xl md:text-2xl font-bold font-mono tabular-nums text-primary mt-0.5">
                      {formatCurrency(detail.data.allocated_amount_centavos, resolvedCurrency)}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 mt-3 border-t border-subtle">
                    <div>
                      <p className="text-xs text-muted">Approved Spent</p>
                      <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                        {formatCurrency(detail.data.spent_centavos ?? 0, resolvedCurrency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Remaining Balance</p>
                      <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                        {formatCurrency(detail.data.remaining_centavos ?? 0, resolvedCurrency)}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {detail?.kind === "collection" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted">
                        Target Amount
                      </p>
                      <p className="text-xl md:text-2xl font-bold font-mono tabular-nums text-primary mt-0.5">
                        {formatCurrency(detail.data.target_amount_centavos, resolvedCurrency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted">
                        Total Collected
                      </p>
                      <p className="text-xl md:text-2xl font-bold font-mono tabular-nums text-primary mt-0.5">
                        {formatCurrency(detail.data.total_collected_centavos ?? 0, resolvedCurrency)}
                      </p>
                    </div>
                  </div>
                  {(detail.data.total_obligations_count !== undefined ||
                    detail.data.total_expected_centavos !== undefined) && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 mt-3 border-t border-subtle">
                      {detail.data.total_expected_centavos !== undefined && (
                        <div>
                          <p className="text-xs text-muted">Expected Total</p>
                          <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                            {formatCurrency(detail.data.total_expected_centavos, resolvedCurrency)}
                          </p>
                        </div>
                      )}
                      {detail.data.paid_obligations_count !== undefined && (
                        <div>
                          <p className="text-xs text-muted">Paid</p>
                          <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                            {detail.data.paid_obligations_count}
                          </p>
                        </div>
                      )}
                      {detail.data.partially_paid_count !== undefined && (
                        <div>
                          <p className="text-xs text-muted">Partial</p>
                          <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                            {detail.data.partially_paid_count}
                          </p>
                        </div>
                      )}
                      {detail.data.pending_count !== undefined && (
                        <div>
                          <p className="text-xs text-muted">Pending</p>
                          <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                            {detail.data.pending_count}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {detail?.kind === "expense" && (
                <>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted">
                      Expense Amount
                    </p>
                    <p className="text-xl md:text-2xl font-bold font-mono tabular-nums text-primary mt-0.5">
                      {formatCurrency(detail.data.amount_centavos, resolvedCurrency)}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 mt-3 border-t border-subtle">
                    <div>
                      <p className="text-xs text-muted">Incurred Date</p>
                      <p className="text-sm font-medium text-primary mt-0.5">
                        {formatDateOnly(detail.data.incurred_date) || "—"}
                      </p>
                    </div>
                    {detail.data.vendor_name && (
                      <div>
                        <p className="text-xs text-muted">Vendor / Payee</p>
                        <p className="text-sm font-medium text-primary mt-0.5 break-words">
                          {detail.data.vendor_name}
                        </p>
                      </div>
                    )}
                    {detail.data.budgets?.name && (
                      <div>
                        <p className="text-xs text-muted">Budget Source</p>
                        <p className="text-sm font-medium text-primary mt-0.5 break-words">
                          {detail.data.budgets.name}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {detail?.kind === "advance" && (
                <>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted">
                      Amount Released
                    </p>
                    <p className="text-xl md:text-2xl font-bold font-mono tabular-nums text-primary mt-0.5">
                      {formatCurrency(detail.data.amount_released_centavos, resolvedCurrency)}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 mt-3 border-t border-subtle">
                    <div>
                      <p className="text-xs text-muted">Custodian</p>
                      <p className="text-sm font-medium text-primary mt-0.5 break-words">
                        {detail.data.organization_members?.profiles?.display_name || "Unavailable"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Disbursement Method</p>
                      <p className="text-sm font-medium text-primary mt-0.5">
                        {DISBURSEMENT_LABELS[detail.data.disbursement_method] || detail.data.disbursement_method}
                      </p>
                    </div>
                    {detail.data.budgets?.name && (
                      <div>
                        <p className="text-xs text-muted">Budget Source</p>
                        <p className="text-sm font-medium text-primary mt-0.5 break-words">
                          {detail.data.budgets.name}
                        </p>
                      </div>
                    )}
                  </div>
                  {liquidationRecord && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 mt-3 border-t border-subtle">
                      <div>
                        <p className="text-xs text-muted">Total Spent</p>
                        <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                          {formatCurrency(liquidationRecord.total_spent_centavos, resolvedCurrency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Total Returned</p>
                        <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                          {formatCurrency(liquidationRecord.total_returned_centavos, resolvedCurrency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Outstanding Balance</p>
                        <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-0.5">
                          {formatCurrency(liquidationRecord.outstanding_balance_centavos, resolvedCurrency)}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Unboxed Secondary Context: Expense Reviewers / Review Notes / Receipt Link */}
            {((detail?.kind === "expense" && (detail.data.verifier_profile || detail.data.approver_profile)) ||
              reviewNotes ||
              (receiptUrl && /^https?:\/\//i.test(receiptUrl))) && (
              <div className="mt-4 space-y-2.5 text-xs text-secondary">
                {detail?.kind === "expense" && (detail.data.verifier_profile || detail.data.approver_profile) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {detail.data.verifier_profile && (
                      <div className="inline-flex items-center gap-1.5">
                        <ActorAvatar
                          name={detail.data.verifier_profile.display_name}
                          avatarUrl={detail.data.verifier_profile.avatar_url}
                          actorType={detail.data.verifier_profile.display_name ? "user" : "unavailable"}
                          size="xs"
                        />
                        <span>
                          Verified by{" "}
                          <strong className="font-medium text-primary">
                            {detail.data.verifier_profile.display_name || "Actor unavailable"}
                          </strong>
                        </span>
                      </div>
                    )}
                    {detail.data.approver_profile && (
                      <div className="inline-flex items-center gap-1.5">
                        <ActorAvatar
                          name={detail.data.approver_profile.display_name}
                          avatarUrl={detail.data.approver_profile.avatar_url}
                          actorType={detail.data.approver_profile.display_name ? "user" : "unavailable"}
                          size="xs"
                        />
                        <span>
                          Approved by{" "}
                          <strong className="font-medium text-primary">
                            {detail.data.approver_profile.display_name || "Actor unavailable"}
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {reviewNotes && (
                  <p className="text-xs text-secondary break-words">
                    <span className="font-medium text-primary">Review notes:</span> {reviewNotes}
                  </p>
                )}

                {receiptUrl && /^https?:\/\//i.test(receiptUrl) && (
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>Supporting Receipt</span>
                    </span>
                    {onOpenReceipt ? (
                      <button
                        type="button"
                        onClick={() => onOpenReceipt(receiptUrl, resolvedTitle)}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline cursor-pointer"
                      >
                        <span>View Receipt</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    ) : (
                      <a
                        href={receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        <span>Open Receipt</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        </>
      )}
    </DetailInspector>
  );
};

export default ActivityQuickPreviewModal;
