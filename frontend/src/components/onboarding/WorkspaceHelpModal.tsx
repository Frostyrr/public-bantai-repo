import { CheckCircle2, Compass, ListChecks, Play, RotateCcw } from "lucide-react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import useOrgOnboarding from "../../hooks/useOrgOnboarding";
import { useOrgTour } from "./TourContext";
import type { OnboardingTourId } from "../../lib/api";
import type { GuideId } from "./tours";

interface WorkspaceHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string | undefined;
  role?: string;
}

const GUIDE_ITEMS: Array<{
  id: OnboardingTourId;
  title: string;
  description: string;
}> = [
  {
    id: "org_overview",
    title: "Organization Introduction",
    description: "Where to navigate, read the financial overview, ask Bani, and follow workspace activity.",
  },
  {
    id: "org_projects",
    title: "Projects Introduction",
    description: "How optional Projects group collections, budgets, expenses, and cash advances.",
  },
];

const MODULE_GUIDE_ITEMS: Array<{
  id: GuideId;
  title: string;
  description: string;
  roles?: string[];
}> = [
  {
    id: "org_collections",
    title: "Collections & Dues",
    description: "Launch collections, assess member dues, and filter by Project.",
  },
  {
    id: "org_budgets",
    title: "Budgets",
    description: "Set spending limits and track utilization across periods and Projects.",
  },
  {
    id: "org_expenses",
    title: "Expenses",
    description: "Submit itemized expense claims with receipts and budget assignments.",
  },
  {
    id: "org_advances",
    title: "Cash Advances",
    description: "Release advances and reconcile liquidations.",
  },
  {
    id: "org_directory",
    title: "Member Directory",
    description: "Manage the organization roster, bulk imports, and exports.",
    roles: ["owner", "organization_admin", "treasurer"],
  },
];

export default function WorkspaceHelpModal({
  isOpen,
  onClose,
  orgId,
  role,
}: WorkspaceHelpModalProps) {
  const { data: onboarding, setChecklistDismissed } = useOrgOnboarding(orgId, Boolean(orgId && isOpen));
  const { startTour } = useOrgTour();
  const effectiveRole = role ?? onboarding?.role;

  const handleStartTour = (tourId: GuideId) => {
    onClose();
    startTour(tourId, { manual: true });
  };

  const visibleModuleGuides = MODULE_GUIDE_ITEMS.filter(
    (item) => !item.roles || (effectiveRole ? item.roles.includes(effectiveRole) : false),
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="md"
      labelledBy="workspace-help-title"
    >
      <h2 id="workspace-help-title" className="modal-title mb-4">
        Workspace Help &amp; Guides
      </h2>

      {orgId && (
        <section className="mb-5 space-y-2.5" aria-label="Guided tours and setup">
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted">
            Guided Tours &amp; Setup
          </h3>

          <div className="space-y-2">
            {GUIDE_ITEMS.map((guide) => {
              const status = onboarding?.tours[guide.id]?.status ?? "not_started";
              const isCompleted = status === "completed";
              return (
                <div
                  key={guide.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-secondary-surface p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Compass className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <strong className="text-xs font-medium text-primary">
                        {guide.title}
                      </strong>
                      {isCompleted && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sem-success-bg px-2 py-0.5 text-[10px] font-medium text-sem-success-fg">
                          <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
                          Done
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-secondary">
                      {guide.description}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartTour(guide.id)}
                    className="shrink-0 min-h-8 px-2.5 text-[11px]"
                    icon={
                      isCompleted || status === "dismissed" ? (
                        <RotateCcw className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )
                    }
                  >
                    {isCompleted || status === "dismissed" ? "Replay" : "Start"}
                  </Button>
                </div>
              );
            })}

            {onboarding?.checklist.eligible && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-secondary-surface p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <strong className="text-xs font-medium text-primary">
                      Organization Setup Checklist
                    </strong>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-secondary">
                    {onboarding.checklist.dismissed
                      ? "Checklist is currently hidden from Bani Insights."
                      : `${onboarding.checklist.essentialCompleted}/${onboarding.checklist.essentialTotal} essential steps completed.`}
                  </p>
                </div>

                {onboarding.checklist.dismissed ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void setChecklistDismissed(false);
                      onClose();
                    }}
                    className="shrink-0 min-h-8 px-2.5 text-[11px]"
                  >
                    Reopen
                  </Button>
                ) : (
                  <span className="shrink-0 text-[11px] font-medium text-sem-success-fg">
                    Visible
                  </span>
                )}
              </div>
            )}
          </div>

          <h3 className="pt-2 text-[11px] font-mono uppercase tracking-wider text-muted">
            Module Guides (On-Demand)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visibleModuleGuides.map((guide) => (
              <button
                key={guide.id}
                type="button"
                onClick={() => handleStartTour(guide.id)}
                className="flex flex-col items-start justify-between gap-1 rounded-xl border border-subtle bg-secondary-surface p-3 text-left transition-colors hover:border-strong hover:bg-hover-surface focus-visible:outline-2 focus-visible:outline-strong cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Play className="h-3 w-3 text-muted shrink-0" aria-hidden="true" />
                  {guide.title}
                </span>
                <span className="text-[11px] leading-snug text-secondary">
                  {guide.description}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2.5" aria-label="Calculation and ledger rules">
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted">
          Calculation &amp; Ledger Rules
        </h3>
        <div className="space-y-2.5 text-xs text-secondary font-body leading-relaxed">
          <div className="p-3 rounded-xl bg-secondary-surface border border-subtle space-y-1">
            <strong className="text-primary block text-xs font-medium">
              Organization Reserves
            </strong>
            <p className="text-[11px] text-secondary">
              Reserve balances and outstanding cash advances remain
              organization-wide across all fiscal cycles.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-secondary-surface border border-subtle space-y-1">
            <strong className="text-primary block text-xs font-medium">
              Collection &amp; Budget Figures
            </strong>
            <p className="text-[11px] text-secondary">
              Totals include the full historical transaction ledger
              for all records assigned to the active reporting period
              scope.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-secondary-surface border border-subtle space-y-1">
            <strong className="text-primary block text-xs font-medium">
              Reporting Periods
            </strong>
            <p className="text-[11px] text-secondary">
              Records are grouped by their assigned reporting period
              rather than raw transaction dates, allowing clean
              academic and fiscal term boundaries.
            </p>
          </div>
        </div>
      </section>
    </Modal>
  );
}
