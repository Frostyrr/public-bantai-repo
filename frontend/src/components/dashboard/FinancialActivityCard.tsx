import React from "react";
import { Eye } from "lucide-react";
import { ActorAvatar } from "../ui/ActorAvatar";
import { getStatusBadgeClasses } from "../../utils/semanticStatus";
import type { UnifiedActivityItem } from "./FinancialActivityFeed";

interface FinancialActivityCardProps {
  item: UnifiedActivityItem;
  onPreview: (item: UnifiedActivityItem) => void;
  staggerIndex?: number;
}

const RECORD_TYPE_PREFIX: Record<UnifiedActivityItem["type"], string> = {
  expense: "Expense record",
  approval: "Expense record",
  collection: "Collection record",
  budget: "Budget record",
  advance: "Cash advance",
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const ts = date.getTime();
  if (Number.isNaN(ts)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullCurrency(centavos: number, currency: string): string {
  const code = currency || "PHP";
  const amount = (centavos / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${code} ${amount}`;
}

function formatStatusLabel(status?: string | null): string {
  if (!status) return "";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const FinancialActivityCard: React.FC<FinancialActivityCardProps> = ({
  item,
  onPreview,
  staggerIndex,
}) => {
  const recordTypeLabel = RECORD_TYPE_PREFIX[item.type];
  const relativeTime = formatRelativeTime(item.occurredAt);

  const hasAmount = typeof item.amountCentavos === "number" && Number.isFinite(item.amountCentavos);

  return (
    <article
      onClick={() => onPreview(item)}
      style={
        staggerIndex !== undefined
          ? ({ "--stagger-index": staggerIndex } as React.CSSProperties)
          : undefined
      }
      className="animate-activity-stagger card-specular-interactive max-md:before:hidden max-md:after:hidden group px-4 py-4 md:p-5 md:rounded-2xl md:border md:border-subtle md:bg-surface md:shadow-(--shadow-card) dark:md:shadow-none hover:bg-hover-surface/60 md:hover:border-strong cursor-pointer"
    >
      <div className="flex items-start gap-3.5 md:gap-4">
        {/* Left Gutter: Actor Profile Picture / Fallback */}
        <ActorAvatar
          name={item.actorName}
          avatarUrl={item.actorAvatar}
          actorType={item.actorType}
          size="md"
          className="mt-0.5"
        />

        {/* Right Column: 3-Row Content Hierarchy */}
        <div className="flex-1 min-w-0">
          {/* Row 1: Compact Meta Header + Status Badge */}
          <div className="flex items-center justify-between gap-2 sm:gap-2.5">
            <span className="sm:hidden text-xs font-semibold text-primary min-w-0">
              {recordTypeLabel}
            </span>
            <p className="hidden sm:block min-w-0 text-xs truncate">
              <span className="font-semibold text-primary">{recordTypeLabel}</span>
              {item.actionText && (
                <>
                  <span aria-hidden="true" className="text-muted"> · </span>
                  <span className="text-secondary">{item.actionText}</span>
                </>
              )}
              {relativeTime && (
                <>
                  <span aria-hidden="true" className="text-muted"> · </span>
                  <span className="text-muted">{relativeTime}</span>
                </>
              )}
            </p>
            {item.status && (
              <span
                className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${getStatusBadgeClasses(
                  item.status
                )}`}
              >
                {formatStatusLabel(item.status)}
              </span>
            )}
          </div>
          {(item.actionText || relativeTime) && (
            <p className="sm:hidden mt-0.5 text-[11px] leading-snug text-secondary">
              {item.actionText}
              {item.actionText && relativeTime && (
                <span aria-hidden="true" className="text-muted"> · </span>
              )}
              {relativeTime && <span className="text-muted">{relativeTime}</span>}
            </p>
          )}

          {/* Row 2: Primary Title, Inline Tags & Optional Description */}
          <div className="mt-1 space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h4 className="text-[15px] md:text-base font-semibold text-primary leading-snug break-words">
                {item.title}
              </h4>
              {(item.category || (item.metadata && item.metadata.length > 0)) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.category && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-elevated text-secondary border border-subtle capitalize">
                      {item.category}
                    </span>
                  )}
                  {item.metadata?.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-elevated text-secondary border border-subtle"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {item.description && (
              <p className="text-xs md:text-sm text-secondary line-clamp-2 leading-relaxed">
                {item.description}
              </p>
            )}
          </div>

          {/* Row 3: Compact Amount & Quick Preview Action */}
          <div className="mt-3 pt-2.5 border-t border-subtle flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-xs text-muted shrink-0">{item.amountLabel}</span>
              {hasAmount && (
                <span className="text-sm font-mono font-semibold tabular-nums text-primary whitespace-nowrap">
                  {formatFullCurrency(item.amountCentavos!, item.currency)}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreview(item);
              }}
              aria-label={`Preview ${item.title}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary group-hover:text-primary hover:text-primary transition-colors cursor-pointer shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};

export default FinancialActivityCard;
