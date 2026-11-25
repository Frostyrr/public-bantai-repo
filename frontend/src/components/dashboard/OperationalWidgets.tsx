import PersistentWidget from "./PersistentWidget";
import { Link } from "react-router-dom";
import {
  Receipt,
  Plus,
  Clock,
  PieChart,
  FileCheck,
  ShieldCheck,
} from "lucide-react";
import Button from "../ui/Button";
import CompactAmount from "../ui/CompactAmount";
import {
  type Collection,
  type Budget,
  type Expense,
  type CashAdvance,
} from "../../lib/api";
import { canManageFinances } from "../../utils/financialWorkflow";

interface OperationalWidgetsProps {
  mobileSection: string;
  orgId: string;
  currency: string;
  userRole: string;
  activeCollections: Collection[];
  budgets: Budget[];
  expenses: Expense[];
  pendingAdvances: CashAdvance[];
  pendingExpensesCount: number;
  pendingLiquidationsCount: number;
  isCollectionsLoading?: boolean;
  isAdvancesLoading?: boolean;
  isBudgetsLoading?: boolean;
  isApprovalsLoading?: boolean;
}

/**
 * WIDGET 1: Active Collections & Dues
 */
export function ActiveCollectionsWidget({
  orgId,
  userRole,
  activeCollections,
  isLoading = false,
}: {
  orgId: string;
  userRole: string;
  activeCollections: Collection[];
  isLoading?: boolean;
}) {
  return (
    <PersistentWidget
      orgId={orgId}
      name="collections"
      title="Active Collections & Dues"
      icon={<Receipt className="w-4 h-4" />}
      headerContent={
        <h3 className="text-base font-heading font-medium text-primary tracking-tight">
          <Link
            to={`/app/org/${orgId}/collections`}
            onClick={(event) => event.stopPropagation()}
            className="hover:text-secondary transition-colors rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
          >
            Active Collections &amp; Dues
          </Link>
        </h3>
      }
    >
      <div className="pt-3">

      {isLoading ? (
        <div
          role="status"
          aria-label="Loading active collections"
          className="space-y-2.5 animate-pulse motion-reduce:animate-none"
        >
          {[1, 2].map((item) => (
            <div
              key={item}
              className="p-3.5 rounded-xl bg-secondary-surface border border-subtle flex flex-col gap-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="h-4 w-32 rounded-sm bg-skeleton" />
                  <div className="h-3 w-20 rounded-sm bg-skeleton/70" />
                </div>
                <div className="h-4 w-18 rounded-sm bg-skeleton shrink-0" />
              </div>
              <div>
                <div className="w-full bg-progress-track rounded-full h-1.5 overflow-hidden">
                  <div className="bg-skeleton h-full w-1/2 rounded-full" />
                </div>
                <div className="mt-2 h-3 w-20 rounded-sm bg-skeleton/70" />
              </div>
            </div>
          ))}
        </div>
      ) : activeCollections.length === 0 ? (
        <div className="p-6 text-center space-y-2.5 rounded-xl bg-secondary-surface border border-subtle">
          <div className="w-9 h-9 rounded-lg bg-surface border border-subtle flex items-center justify-center text-muted mx-auto">
            <Receipt className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-heading font-medium text-primary">No active collections</p>
            <p className="text-xs text-muted mt-0.5">
              Launch a dues campaign to start collecting funds.
            </p>
          </div>
          {canManageFinances(userRole) && (
            <Button
              variant="outline"
              size="sm"
              to={`/app/org/${orgId}/collections`}
              icon={<Plus className="w-3 h-3" />}
            >
              New Collection
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {activeCollections.slice(0, 3).map((c) => {
            const collected = c.total_collected_centavos ?? 0;
            const target = c.target_amount_centavos || c.total_expected_centavos || 0;
            const pct = target > 0 ? Math.min(100, Math.round((collected / target) * 100)) : 0;

            return (
              <Link
                key={c.id}
                to={`/app/org/${orgId}/collections/${c.id}`}
                className="p-3.5 rounded-xl bg-secondary-surface border border-subtle hover:border-strong flex flex-col gap-2.5 transition-all block group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-primary group-hover:text-secondary transition-colors truncate">
                        {c.title}
                      </span>
                      {c.spaces?.name && (
                        <span className="text-sm font-mono text-secondary bg-surface border border-subtle px-1.5 py-0.2 rounded">
                          {c.spaces.name}
                        </span>
                      )}
                    </div>
                    {c.due_date && (
                      <div className="flex items-center gap-1 text-xs text-secondary mt-0.5">
                        <Clock className="w-2.5 h-2.5 text-muted" />
                        <span>Due {new Date(c.due_date).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono tabular-nums font-medium text-primary">
                      <CompactAmount centavos={collected} currency={c.currency} />
                    </div>

                  </div>
                </div>

                {/* Progress Bar & Details */}
                <div>
                  <div className={`${target > 0 ? "block" : "hidden"} w-full bg-progress-track rounded-full h-1.5 overflow-hidden`}>
                    <div
                      className="bg-action h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <p className="mt-2 text-xs text-secondary">{target > 0 ? `${pct}% collected` : 'No target set'}</p>
                </div>

              </Link>
            );
          })}
        </div>
      )}
      </div>
    </PersistentWidget>
  );
}

/**
 * WIDGET 2: Cash Advances & Float
 */
export function CashAdvancesWidget({
  orgId,
  pendingAdvances,
  isLoading = false,
}: {
  orgId: string;
  currency: string;
  pendingAdvances: CashAdvance[];
  isLoading?: boolean;
}) {
  return (
    <PersistentWidget
      orgId={orgId}
      name="advances"
      title="Cash Advances & Float"
      icon={<FileCheck className="w-4 h-4" />}
      headerContent={
        <h3 className="text-base font-heading font-medium text-primary tracking-tight">
          <Link
            to={`/app/org/${orgId}/liquidation`}
            onClick={(event) => event.stopPropagation()}
            className="hover:text-secondary transition-colors rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
          >
            Cash Advances &amp; Float
          </Link>
        </h3>
      }
    >
      <div className="pt-3">
        {isLoading ? (
          <div
            role="status"
            aria-label="Loading cash advances"
            className="space-y-2 animate-pulse motion-reduce:animate-none"
          >
            {[1, 2].map((item) => (
              <div
                key={item}
                className="rounded-xl border border-subtle bg-secondary-surface p-3 space-y-2"
              >
                <div className="h-4 w-36 rounded-sm bg-skeleton" />
                <div className="flex justify-between gap-2">
                  <div className="h-3.5 w-20 rounded-sm bg-skeleton/80" />
                  <div className="h-3.5 w-18 rounded-sm bg-skeleton/70" />
                </div>
              </div>
            ))}
          </div>
        ) : pendingAdvances.length === 0 ? <p className="text-sm text-secondary">No outstanding advances.</p> : <div className="space-y-2">{pendingAdvances.slice(0,2).map(a=><Link key={a.id} to={`/app/org/${orgId}/liquidation`} className="block rounded-xl border border-subtle bg-secondary-surface p-3 hover:border-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"><p className="text-sm font-medium text-primary break-words">{a.title}</p><div className="mt-2 flex flex-wrap justify-between gap-2 text-sm"><span className="font-mono tabular-nums text-secondary"><CompactAmount centavos={a.amount_released_centavos} currency={a.currency} /></span><span className="text-sem-warning-fg">{a.status === 'under_review' ? 'Under review' : a.status === 'disputed' ? 'Disputed' : 'Outstanding'}</span></div></Link>)}</div>}
      </div>
    </PersistentWidget>
  );
}

/**
 * WIDGET 3: Budget Utilization
 */
export function BudgetUtilizationWidget({
  orgId,
  budgets,
  isLoading = false,
}: {
  orgId: string;
  currency: string;
  budgets: Budget[];
  expenses: Expense[];
  isLoading?: boolean;
}) {
  const activeBudgets = budgets.filter((b) => b.status === "active");
  return (
    <PersistentWidget
      orgId={orgId}
      name="budgets"
      title="Budget Utilization"
      icon={<PieChart className="w-4 h-4" />}
      headerContent={
        <h3 className="text-base font-heading font-medium text-primary tracking-tight">
          <Link
            to={`/app/org/${orgId}/budgets`}
            onClick={(event) => event.stopPropagation()}
            className="hover:text-secondary transition-colors rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
          >
            Budget Utilization
          </Link>
        </h3>
      }
    >
      <div className="pt-3">
        {isLoading ? (
          <div
            role="status"
            aria-label="Loading budget utilization"
            className="space-y-3 animate-pulse motion-reduce:animate-none"
          >
            {[1, 2].map((item) => (
              <div
                key={item}
                className="rounded-xl border border-subtle bg-secondary-surface p-3 space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="h-4 w-32 rounded-sm bg-skeleton" />
                  <div className="h-3.5 w-14 rounded-sm bg-skeleton/80" />
                </div>
                <div className="h-1.5 rounded-full bg-progress-track overflow-hidden">
                  <div className="h-full w-2/5 rounded-full bg-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : activeBudgets.length === 0 ? <p className="text-sm text-secondary">No active budgets.</p> : <div className="space-y-3">{activeBudgets.slice(0,2).map(b=>{const pct=b.allocated_amount_centavos > 0 ? Math.min(100,Math.round(((b.spent_centavos || 0)/b.allocated_amount_centavos)*100)) : 0;return <Link key={b.id} to={`/app/org/${orgId}/budgets`} className="block rounded-xl border border-subtle bg-secondary-surface p-3 hover:border-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"><div className="flex items-start justify-between gap-3 text-sm"><span className="font-medium text-primary break-words">{b.name}</span><span className="shrink-0 font-mono tabular-nums text-secondary">{pct}% used</span></div><div className="mt-3 h-1.5 rounded-full bg-progress-track overflow-hidden"><div className={`h-full rounded-full ${pct >= 90 ? "bg-progress-fill dark:bg-sem-warning-fg" : "bg-progress-fill"}`} style={{width:`${pct}%`}} /></div></Link>;})}</div>}
      </div>
    </PersistentWidget>
  );
}

/**
 * WIDGET 4: Pending Approvals Queue (Role-Gated)
 */
export function PendingApprovalsWidget({
  orgId,
  pendingExpensesCount,
  pendingLiquidationsCount,
  isLoading = false,
}: {
  orgId: string;
  pendingExpensesCount: number;
  pendingLiquidationsCount: number;
  isLoading?: boolean;
}) {
  const totalPending = pendingExpensesCount + pendingLiquidationsCount;

  return (
    <PersistentWidget
      orgId={orgId}
      name="approvals"
      title="Actionable Review Queue"
      icon={<ShieldCheck className="w-4 h-4" />}
      headerContent={
        <h3 className="text-base font-heading font-medium text-primary tracking-tight">
          <Link
            to={`/app/org/${orgId}/approvals`}
            onClick={(event) => event.stopPropagation()}
            className="hover:text-secondary transition-colors rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
          >
            Actionable Review Queue
          </Link>
        </h3>
      }
    >
      <div className="pt-3">
        {isLoading ? (
          <div
            role="status"
            aria-label="Loading pending approvals"
            className="rounded-xl border border-subtle bg-secondary-surface p-3 animate-pulse motion-reduce:animate-none"
          >
            <div className="h-4 w-44 rounded-sm bg-skeleton" />
          </div>
        ) : (
          <Link to={`/app/org/${orgId}/approvals`} className="block rounded-xl p-3 text-sm text-secondary hover:bg-elevated hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong">{totalPending === 0 ? 'No reviews awaiting your action.' : `${totalPending} review${totalPending === 1 ? '' : 's'} awaiting your action`}</Link>
        )}
      </div>
    </PersistentWidget>
  );
}

/**
 * Combined Left Column Container
 */
export default function OperationalWidgets({
  mobileSection,
  orgId,
  currency,
  userRole,
  activeCollections,
  budgets,
  expenses,
  pendingAdvances,
  pendingExpensesCount,
  pendingLiquidationsCount,
  isCollectionsLoading = false,
  isAdvancesLoading = false,
  isBudgetsLoading = false,
  isApprovalsLoading = false,
}: OperationalWidgetsProps) {
  const isReviewer = canManageFinances(userRole) || userRole === "auditor";

  return (
    <div className="flex flex-col gap-3">
      {/* Widget 1: Collections */}
      <div className={mobileSection === "collections" ? "" : "hidden @min-[1000px]:block"}>
        <ActiveCollectionsWidget
        orgId={orgId}
        userRole={userRole}
        activeCollections={activeCollections}
        isLoading={isCollectionsLoading}
      />
      </div>

      {/* Widget 2: Cash Advances & Float */}
      <div className={mobileSection === "advances" ? "" : "hidden @min-[1000px]:block"}>
        <CashAdvancesWidget
        orgId={orgId}
        currency={currency}
        pendingAdvances={pendingAdvances}
        isLoading={isAdvancesLoading}
      />
      </div>

      {/* Widget 3: Budget Utilization */}
      <div className={mobileSection === "budgets" ? "" : "hidden @min-[1000px]:block"}>
        <BudgetUtilizationWidget
        orgId={orgId}
        currency={currency}
        budgets={budgets}
        expenses={expenses}
        isLoading={isBudgetsLoading}
      />
      </div>

      {/* Widget 4: Pending Approvals (For Officers/Reviewers) */}
      {isReviewer && (
        <div className={mobileSection === "reviews" ? "" : "hidden @min-[1000px]:block"}>
        <PendingApprovalsWidget
          orgId={orgId}
          pendingExpensesCount={pendingExpensesCount}
          pendingLiquidationsCount={pendingLiquidationsCount}
          isLoading={isApprovalsLoading}
        />
      </div>
      )}
    </div>
  );
}
