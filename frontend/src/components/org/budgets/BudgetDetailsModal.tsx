import React from "react";
import type { Budget } from "../../../lib/api";
import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
  InspectorSection,
} from "../../../components/ui/DetailInspector";

const formatMoney = (amount: number, currency: string) =>
  `${currency} ${(amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function BudgetDetailsModal({
  budget,
  currency,
  onClose,
  archiveBanner,
  onNavigate,
  footer,
}: {
  budget: Budget | null;
  currency: string;
  onClose: () => void;
  archiveBanner?: string;
  onNavigate?: (direction: "prev" | "next") => void;
  footer?: React.ReactNode;
}) {
  const remaining = budget
    ? budget.remaining_centavos ??
      budget.allocated_amount_centavos - (budget.spent_centavos || 0)
    : 0;

  return (
    <DetailInspector
      isOpen={Boolean(budget)}
      onClose={onClose}
      onNavigate={onNavigate}
      categoryLabel={
        archiveBanner ? "Archived Budget Details" : "Budget Details"
      }
      title={budget?.name ?? ""}
      subtitle={budget ? <Badge>{budget.status}</Badge> : undefined}
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
      {budget && (
        <>
          {archiveBanner && (
            <p className="rounded-xl bg-elevated border border-subtle p-3 text-xs text-secondary">
              {archiveBanner}
            </p>
          )}

          <InspectorSection title="Description">
            <p className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.02] p-3 text-xs text-secondary whitespace-pre-wrap">
              {budget.description || "No description provided."}
            </p>
          </InspectorSection>

          <InspectorGrid>
            <InspectorField label="Status" value={budget.status} />
            <InspectorField
              label="Allocation"
              value={formatMoney(budget.allocated_amount_centavos, currency)}
              mono
            />
            <InspectorField
              label="Spent"
              value={formatMoney(budget.spent_centavos || 0, currency)}
              mono
            />
            <InspectorField
              label="Remaining"
              value={formatMoney(remaining, currency)}
              mono
            />
            <InspectorField
              label="Project"
              value={budget.spaces?.name || "Unassigned"}
            />
            <InspectorField
              label="Period"
              value={budget.reporting_periods?.name || "All periods"}
            />
          </InspectorGrid>
        </>
      )}
    </DetailInspector>
  );
}
