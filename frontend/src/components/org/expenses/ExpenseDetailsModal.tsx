import React from "react";
import Badge from "../../../components/ui/Badge";
import type { Expense } from "../../../lib/api";
import Button from "../../../components/ui/Button";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
  InspectorSection,
} from "../../../components/ui/DetailInspector";
import ExpenseReviewInfo from "./ExpenseReviewInfo";

export default function ExpenseDetailsModal({
  expense,
  onClose,
  archiveBanner,
  onNavigate,
  footer,
}: {
  expense: Expense | null;
  onClose: () => void;
  archiveBanner?: string;
  onNavigate?: (direction: "prev" | "next") => void;
  footer?: React.ReactNode;
}) {
  return (
    <DetailInspector
      isOpen={Boolean(expense)}
      onClose={onClose}
      onNavigate={onNavigate}
      categoryLabel={
        expense?.archived_at
          ? "Expense Details · Archived"
          : "Expense Details"
      }
      title={expense?.title ?? ""}
      subtitle={expense ? <Badge>{expense.status}</Badge> : undefined}
      footer={
        footer ?? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        )
      }
    >
      {expense && (
        <>
          {archiveBanner && (
            <p className="rounded-xl bg-elevated border border-subtle p-3 text-xs text-secondary">
              {archiveBanner}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.02] p-4">
            <div className="space-y-0.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                Amount
              </p>
              <span className="select-text financial-value text-base text-primary">
                {expense.currency}{" "}
                {(expense.amount_centavos / 100).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="text-right space-y-0.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                Submitted
              </p>
              <p className="text-xs text-secondary">
                {new Date(expense.created_at).toLocaleString()}
              </p>
            </div>
          </div>

          <ExpenseReviewInfo expense={expense} />

          <InspectorGrid>
            <InspectorField
              label="Project"
              value={expense.spaces?.name || "Unassigned"}
            />
            <InspectorField
              label="Reporting period"
              value={expense.reporting_periods?.name || "All periods"}
            />
            {expense.verified_at && (
              <InspectorField
                label="Verified"
                value={new Date(expense.verified_at).toLocaleString()}
              />
            )}
            {expense.approved_at && (
              <InspectorField
                label="Approved"
                value={new Date(expense.approved_at).toLocaleString()}
              />
            )}
          </InspectorGrid>

          {expense.review_notes && (
            <InspectorSection title="Review notes">
              <p className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.02] p-3 text-xs whitespace-pre-wrap break-words text-primary">
                {expense.review_notes}
              </p>
            </InspectorSection>
          )}
        </>
      )}
    </DetailInspector>
  );
}
