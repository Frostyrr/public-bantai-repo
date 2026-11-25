import { CheckCircle2, Info, Settings2, SlidersHorizontal, UserPlus, Users } from "lucide-react";
import Button from "../../ui/Button";
import Modal from "../../ui/Modal";
import type { AssessmentPolicy } from "./CollectionAssessmentSettings";

interface CollectionManageDuesModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionStatus: string;
  currency: string;
  totalMembers: number;
  notAssessedCount: number;
  paidCount: number;
  unpaidCount: number;
  assessmentPolicy?: AssessmentPolicy;
  onAssignUnassessed: () => void;
  onOpenScopeSettings: () => void;
  onOpenAssessmentSettings: () => void;
  onFilterUnassessed: () => void;
}

function formatAmount(centavos: number, currency: string) {
  return `${currency} ${(centavos / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function CollectionManageDuesModal({
  isOpen,
  onClose,
  collectionStatus,
  currency,
  totalMembers,
  notAssessedCount,
  paidCount,
  unpaidCount,
  assessmentPolicy,
  onAssignUnassessed,
  onOpenScopeSettings,
  onOpenAssessmentSettings,
  onFilterUnassessed,
}: CollectionManageDuesModalProps) {
  const assessedCount = Math.max(0, totalMembers - notAssessedCount);
  const isActive = collectionStatus === "active";

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="manage-dues-title" maxWidth="max-w-[640px]">
      <div className="space-y-5">
        <header className="border-b border-subtle pb-4">
          <h2 id="manage-dues-title" className="section-title font-semibold text-primary">
            {notAssessedCount > 0 ? "Assign Unassessed Members" : "Manage Dues"}
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Post-creation dues maintenance for this collection. Existing assessments and payment records are preserved.
          </p>
        </header>

        {/* Assessment Status Summary */}
        <section aria-label="Assessment status summary" className="rounded-xl border border-subtle bg-elevated p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">Assessment Status</span>
            {notAssessedCount === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sem-success-fg">
                <CheckCircle2 className="w-3.5 h-3.5" />
                All roster members assessed
              </span>
            ) : (
              <span className="text-xs font-medium text-sem-warning-fg">
                {notAssessedCount} {notAssessedCount === 1 ? "member" : "members"} awaiting assessment
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg border border-subtle bg-surface px-3 py-2">
              <dt className="text-xs text-secondary">Roster</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-primary">{totalMembers}</dd>
            </div>
            <div className="rounded-lg border border-subtle bg-surface px-3 py-2">
              <dt className="text-xs text-secondary">Assessed</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-primary">{assessedCount}</dd>
            </div>
            <div className="rounded-lg border border-subtle bg-surface px-3 py-2">
              <dt className="text-xs text-secondary">Unassessed</dt>
              <dd className={`mt-0.5 font-semibold tabular-nums ${notAssessedCount > 0 ? "text-sem-warning-fg" : "text-primary"}`}>
                {notAssessedCount}
              </dd>
            </div>
            <div className="rounded-lg border border-subtle bg-surface px-3 py-2">
              <dt className="text-xs text-secondary">Settled / Open</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-primary">
                {paidCount} / {unpaidCount}
              </dd>
            </div>
          </dl>

          {assessmentPolicy && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-3 text-xs text-secondary">
              <span>
                Standard rate:{" "}
                <strong className="font-medium text-primary">
                  {assessmentPolicy.amount !== null ? formatAmount(assessmentPolicy.amount, currency) : "Not configured"}
                </strong>
              </span>
              <span>
                Auto-assess new members:{" "}
                <strong className="font-medium text-primary">
                  {assessmentPolicy.automatic ? "Enabled" : "Off"}
                </strong>
              </span>
            </div>
          )}
        </section>

        {!isActive && (
          <div role="status" className="flex items-start gap-2.5 rounded-xl border border-subtle bg-elevated p-3.5 text-sm text-secondary">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-muted" />
            <span>
              This collection is currently <strong>{collectionStatus}</strong>. Reopen the collection to assign new dues or change scope and assessment settings.
            </span>
          </div>
        )}

        {/* Supported Post-Creation Operations */}
        <div className="space-y-2.5">
          {/* 1. Assign Unassessed Members */}
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 ${notAssessedCount > 0 && isActive ? "border-emerald-500/40 bg-emerald-500/5" : "border-subtle bg-surface"}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <UserPlus className="w-4 h-4 text-secondary shrink-0" />
                <span>Assign Unassessed Members</span>
              </div>
              <p className="mt-1 text-xs text-secondary">
                {notAssessedCount > 0
                  ? `Assign dues to the ${notAssessedCount} unassessed ${notAssessedCount === 1 ? "member" : "members"} or select eligible directory members.`
                  : "All current roster members are assessed. You can still assess newly added directory members."}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {notAssessedCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => { onFilterUnassessed(); onClose(); }}>
                  View in table
                </Button>
              )}
              <Button
                variant={notAssessedCount > 0 ? "primary" : "outline"}
                size="sm"
                disabled={!isActive}
                onClick={() => {
                  onClose();
                  onAssignUnassessed();
                }}
              >
                {notAssessedCount > 0 ? "Assign Dues" : "Assign Additional"}
              </Button>
            </div>
          </div>

          {/* 2. Manage Eligible Member Scope */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-subtle bg-surface p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Users className="w-4 h-4 text-secondary shrink-0" />
                <span>Eligible Member Scope</span>
              </div>
              <p className="mt-1 text-xs text-secondary">
                Add newly eligible members or update saved groups and member filters without affecting existing assessments.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!isActive}
              onClick={() => {
                onClose();
                onOpenScopeSettings();
              }}
            >
              Manage Scope
            </Button>
          </div>

          {/* 3. Assessment Policy */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-subtle bg-surface p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <SlidersHorizontal className="w-4 h-4 text-secondary shrink-0" />
                <span>Assessment Policy</span>
              </div>
              <p className="mt-1 text-xs text-secondary">
                Configure the standard dues amount for future assessments and automatic assessment for new eligible members.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!isActive || !assessmentPolicy}
              onClick={() => {
                onClose();
                onOpenAssessmentSettings();
              }}
            >
              Configure Policy
            </Button>
          </div>
        </div>

        {/* Honest Boundary Note on Existing Assessments */}
        <div className="flex items-start gap-2.5 rounded-xl border border-subtle bg-elevated/60 px-3.5 py-2.5 text-xs text-secondary">
          <Settings2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted" />
          <span>
            Existing member assessments and recorded payments are immutable to protect financial audit integrity. Adjusting unpaid assessment amounts is not supported in this version.
          </span>
        </div>

        <footer className="flex justify-end border-t border-subtle pt-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
