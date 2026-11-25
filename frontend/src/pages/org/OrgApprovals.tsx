import useFinancialQuery from "../../hooks/useFinancialQuery";
import AnimatedNumber from "../../components/ui/AnimatedNumber";
import Badge from "../../components/ui/Badge";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import API from "../../config/apiClient";
import Button from "../../components/ui/Button";
import { toast } from "../../lib/toast";
import ExpenseReviewInfo from "../../components/org/expenses/ExpenseReviewInfo";
import { formatCategoryLabel } from "../../utils/formatCategoryLabel";
import { canReviewExpense, canVerifyExpense, canApproveExpense, canReviewAdvance, needsExpenseReview } from '../../utils/financialWorkflow';
import FinancialQueryState from '../../components/layout/FinancialQueryState';
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  AlertCircle,
  ChevronDown,
  RotateCcw,
  Clock,
  CheckCircle2,
} from "lucide-react";
import Pagination from "../../components/ui/Pagination";
import InfoTooltip from "../../components/ui/InfoTooltip";
import {
  reviewExpense,
  reviewLiquidation,
  type OrganizationDetails,
  type Membership,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";

interface ContextType {
  organization: OrganizationDetails;
  membership: Membership;
}

function formatMoney(centavos: number, currency = "PHP") {
  const amount = (centavos / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

export default function OrgApprovals() {
  const { organization, membership } = useOutletContext<ContextType>();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"all" | "expenses" | "liquidations">("all");
  const [actionError, setActionError] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [expensesPage, setExpensesPage] = useState(1);
  const [expensesPageSize, setExpensesPageSize] = useState(6);
  const [liquidationsPage, setLiquidationsPage] = useState(1);
  const [liquidationsPageSize, setLiquidationsPageSize] = useState(6);

  const isOfficer =
    membership?.role === "owner" ||
    membership?.role === "organization_admin" ||
    membership?.role === "treasurer" ||
    membership?.role === "auditor";

  const expensesQuery = useFinancialQuery("expenses", organization.id);
  const advancesQuery = useFinancialQuery("advances", organization.id);
  const budgetQueue = useFinancialQuery("budgets", organization.id, {}, isOfficer);

  const activation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      API.post(`/organizations/${organization.id}/budgets/${id}/activation`, { approve }),
    onSuccess: (_, { approve }) => {
      toast.success(approve ? "Budget activated" : "Budget rejected");
      void queryClient.invalidateQueries({ queryKey: ["budgets", organization.id] });
      void Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]);
    },
  });
  const pendingBudgets = budgetQueue.data?.filter(budget => budget.status === "pending_approval") ?? [];

  // Mutations
  const reviewExpenseMutation = useMutation({
    mutationFn: (payload: { expenseId: string; expectedRevision: number; decision: "verified" | "approved" | "rejected"; notes?: string }) =>
      reviewExpense(organization.id, payload.expenseId, { decision: payload.decision, expectedRevision: payload.expectedRevision, notes: payload.notes }),
    onSuccess: async (_result, action) => {
      toast.success(action.decision === "approved" ? "Approval recorded" : action.decision === "rejected" ? "Expense rejected" : "Expense verified");
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: ["expenses", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["budgets", organization.id] }),
      ]);
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const reviewLiquidationMutation = useMutation({
    mutationFn: (payload: { liquidationId: string; decision: "approved" | "rejected"; notes?: string }) =>
      reviewLiquidation(organization.id, payload.liquidationId, { decision: payload.decision, notes: payload.notes }),
    onSuccess: async () => {
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: ["advances", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["budgets", organization.id] }),
      ]);
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const pendingExpenses = (expensesQuery.data ?? []).filter(
    e => needsExpenseReview(e)
  );

  const pendingAdvances = (advancesQuery.data ?? []).filter(
    a => canReviewAdvance(a, membership.profile_id, membership.role)
  );

  const paginatedExpenses = pendingExpenses.slice(
    (expensesPage - 1) * expensesPageSize,
    expensesPage * expensesPageSize
  );

  const paginatedAdvances = pendingAdvances.slice(
    (liquidationsPage - 1) * liquidationsPageSize,
    liquidationsPage * liquidationsPageSize
  );

  const totalPendingCount = pendingExpenses.length + pendingAdvances.length + pendingBudgets.length;


  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="context" className="page-header-eyebrow">
              Officer Reviews
            </Badge>
            <InfoTooltip
              content="Your review queue covers all reporting periods, so outstanding work is never hidden."
              side="bottom"
            />
          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">Approvals</span>
          </h1>
          <p className="page-subtitle">
            Review expense submissions, reimbursement claims, and liquidation reports.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <p>{actionError}</p>
        </div>
      )}

      {expensesQuery.data === undefined || advancesQuery.data === undefined ? (
        <FinancialQueryState
          queries={[expensesQuery, advancesQuery]}
          variant="approvals"
          kpiCount={3}
          showFilterToolbar={false}
        />
      ) : (
        <>
      {/* Overview Metric Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Total Pending</span>
            <Clock className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary">{expensesQuery.data !== undefined && advancesQuery.data !== undefined ? <AnimatedNumber value={totalPendingCount} /> : '—'}</p>
          <p className="text-xs text-secondary mt-1">Awaiting officer action</p>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Pending Expenses</span>
            <ShieldCheck className="w-4 h-4 text-secondary" />
          </div>
          <p className="metric-value text-secondary">{expensesQuery.data !== undefined ? <AnimatedNumber value={pendingExpenses.length} /> : '—'}</p>
          <p className="text-xs text-secondary mt-1">Receipt reimbursement claims</p>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Pending Liquidations</span>
            <RotateCcw className="w-4 h-4 text-secondary" />
          </div>
          <p className="metric-value text-secondary">{advancesQuery.data !== undefined ? <AnimatedNumber value={pendingAdvances.length} /> : '—'}</p>
          <p className="text-xs text-secondary mt-1">Cash advances under reconciliation</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-subtle">
        <button
          onClick={() => {
            setActiveTab("all");
            setExpensesPage(1);
            setLiquidationsPage(1);
          }}
          className={`pb-3 text-sm font-medium transition-colors relative cursor-pointer ${
            activeTab === "all" ? "text-primary" : "text-secondary hover:text-primary"
          }`}
        >
          <span>All Pending ({totalPendingCount})</span>
          {activeTab === "all" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-white rounded-full" />}
        </button>

        <button
          onClick={() => {
            setActiveTab("expenses");
            setExpensesPage(1);
          }}
          className={`pb-3 text-sm font-medium transition-colors relative cursor-pointer ${
            activeTab === "expenses" ? "text-primary" : "text-secondary hover:text-primary"
          }`}
        >
          <span>Expenses ({pendingExpenses.length})</span>
          {activeTab === "expenses" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-white rounded-full" />}
        </button>

        <button
          onClick={() => {
            setActiveTab("liquidations");
            setLiquidationsPage(1);
          }}
          className={`pb-3 text-sm font-medium transition-colors relative cursor-pointer ${
            activeTab === "liquidations" ? "text-primary" : "text-secondary hover:text-primary"
          }`}
        >
          <span>Liquidations ({pendingAdvances.length})</span>
          {activeTab === "liquidations" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-white rounded-full" />}
        </button>
      </div>

      {/* Queue Empty State */}
      {expensesQuery.data !== undefined && advancesQuery.data !== undefined && budgetQueue.isSuccess && totalPendingCount === 0 && (
        <ModuleEmptyState>
          <div className="w-12 h-12 rounded-2xl bg-elevated border border-subtle flex items-center justify-center mb-3 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary mb-1 tracking-tight">
            All reviews completed
          </h3>
          <p className="text-secondary text-xs sm:text-sm max-w-sm leading-relaxed">
            There are currently no expenses or cash advance liquidations awaiting officer review.
          </p>
        </ModuleEmptyState>
      )}

      {/* SECTION: EXPENSE APPROVALS */}
      {activeTab === "all" && isOfficer && (pendingBudgets.length > 0 || budgetQueue.isError) && <section className="space-y-3">
        <h2 className="font-semibold text-primary section-title">Budget activation</h2>
        {budgetQueue.isError && <p role="alert">Could not load budget activation requests.</p>}
        {activation.isError && <p role="alert" className="text-rose-700 dark:text-rose-300">{formatErrorMessage(activation.error)}</p>}
        {pendingBudgets.map(budget => <div key={budget.id} className="card-specular-interactive flex flex-wrap items-center justify-between gap-3 rounded-xl border border-subtle bg-surface p-4">
          <div><p className="text-primary">{budget.name}</p><p className="text-sm text-secondary">{formatMoney(budget.allocated_amount_centavos, budget.currency)}</p></div>
          {["owner", "organization_admin"].includes(membership.role ?? "") && membership.profile_id && budget.created_by !== membership.profile_id &&
            <div className="flex gap-2">
              <Button disabled={activation.isPending} onClick={() => activation.mutate({ id: budget.id, approve: true })}>Approve</Button>
              <Button variant="outline" disabled={activation.isPending} onClick={() => activation.mutate({ id: budget.id, approve: false })}>Reject</Button>
            </div>}
        </div>)}
      </section>}

      {(activeTab === "all" || activeTab === "expenses") && pendingExpenses.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-heading font-medium text-primary tracking-tight">
            Expenses Awaiting Review
          </h3>
          <div className="table-specular divide-y divide-[var(--border-subtle)] rounded-xl bg-surface border border-subtle overflow-hidden shadow-xs dark:shadow-none">
            {paginatedExpenses.map((exp) => {
              const canReview = canReviewExpense(exp, membership.profile_id, membership.role);
              const canApprove = canApproveExpense(exp, membership.profile_id);
              const isSubmitter = exp.submitted_by === membership.profile_id;
              const reviewNote = reviewNotes[exp.id] ?? "";
              const approvalCount = exp.approval_decisions?.filter(
                decision => decision.decision === "approved" && decision.expense_revision === exp.review_revision
              ).length ?? 0;
              const treasurerExcluded = membership.role === "treasurer" && exp.treasurer_approval_snapshot === false;

              return (
                <details key={exp.id} className="group/expense">
                  <summary className="block cursor-pointer list-none px-4 py-4 transition-colors hover:bg-elevated/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current motion-reduce:transition-none sm:px-6 [&::-webkit-details-marker]:hidden">
                    <span className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <span className="min-w-0 break-words text-base font-semibold text-primary">{exp.title}</span>
                      <span className="break-words text-lg font-semibold tabular-nums text-primary">{formatMoney(exp.amount_centavos, exp.currency)}</span>
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-secondary">
                      <Badge>{exp.status}</Badge>
                      <span>{formatCategoryLabel(exp.category)}</span>
                      <span>Incurred {exp.incurred_date}</span>
                      {exp.profiles?.display_name && <span className="min-w-0 break-words">Submitted by {exp.profiles.display_name}</span>}
                    </span>
                    <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="flex flex-wrap gap-x-3 gap-y-1 text-secondary">
                        <span>{approvalCount} of {exp.required_approvals || 1} approvals</span>
                        {treasurerExcluded && <span>Treasurer approval disabled by policy</span>}
                        {!canReview && !treasurerExcluded && <span>No action available to you</span>}
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                        <span className="group-open/expense:hidden">{canReview ? "Review expense" : "View details"}</span>
                        <span className="hidden group-open/expense:inline">Hide details</span>
                        <ChevronDown aria-hidden="true" className="size-4 group-open/expense:rotate-180" />
                      </span>
                    </span>
                  </summary>

                  <div className={`grid items-start gap-5 border-t border-subtle px-4 py-4 sm:px-6 ${canReview ? "lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.75fr)]" : ""}`}>
                    <div className="min-w-0 space-y-2 text-sm text-secondary">
                      <ExpenseReviewInfo expense={exp} actorId={membership.profile_id} inApprovalQueue />
                      {exp.verified_at && <p>Verified: {new Date(exp.verified_at).toLocaleString()}</p>}
                      {exp.review_notes && <p className="whitespace-pre-wrap break-words">Review notes: {exp.review_notes}</p>}
                    </div>
                    {canReview && (
                      <div className="min-w-0 space-y-3 rounded-xl border border-subtle bg-elevated/60 p-3 sm:p-4">
                        <label className="block space-y-1.5 text-sm text-primary">
                          <span>{isSubmitter ? "Self-approval justification" : "Review note"}</span>
                          <textarea
                            rows={2}
                            aria-describedby={`review-note-hint-${exp.id}`}
                            className="block w-full rounded-lg border border-subtle bg-surface p-2.5 text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                            value={reviewNote}
                            onChange={e => setReviewNotes(notes => ({ ...notes, [exp.id]: e.target.value }))}
                          />
                        </label>
                        <p id={`review-note-hint-${exp.id}`} className="text-xs text-secondary">
                          {isSubmitter ? "Required to self-approve." : "Required to reject."}
                          {!isSubmitter && !canApprove && " Verify the receipt before approving."}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {!isSubmitter && canVerifyExpense(exp) && (
                            <Button
                              size="sm" variant="outline" className="min-h-11"
                              disabled={reviewExpenseMutation.isPending}
                              onClick={() => reviewExpenseMutation.mutate({
                                expenseId: exp.id,
                                expectedRevision: exp.review_revision ?? 1,
                                decision: "verified",
                              })}
                            >
                              Verify Receipt
                            </Button>
                          )}
                          <Button
                            size="sm" className="min-h-11"
                            disabled={reviewExpenseMutation.isPending || !canApprove || (isSubmitter && reviewNote.trim().length < 3)}
                            onClick={() => reviewExpenseMutation.mutate({
                              expenseId: exp.id,
                              expectedRevision: exp.review_revision ?? 1,
                              decision: "approved",
                              notes: reviewNotes[exp.id],
                            })}
                          >
                            {isSubmitter ? "Self-approve" : "Approve"}
                          </Button>
                          <Button
                            size="sm" variant="danger" className="min-h-11"
                            disabled={reviewExpenseMutation.isPending || isSubmitter || reviewNote.trim().length < 3}
                            onClick={() => reviewExpenseMutation.mutate({
                              expenseId: exp.id,
                              expectedRevision: exp.review_revision ?? 1,
                              decision: "rejected",
                              notes: reviewNotes[exp.id],
                            })}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}

            <Pagination
              currentPage={expensesPage}
              totalItems={pendingExpenses.length}
              pageSize={expensesPageSize}
              onPageChange={setExpensesPage}
              pageSizeOptions={[6, 12, 24]}
              onPageSizeChange={setExpensesPageSize}
              itemLabel="pending expenses"
            />
          </div>
        </div>
      )}

      {/* SECTION: LIQUIDATION APPROVALS */}
      {(activeTab === "all" || activeTab === "liquidations") && pendingAdvances.length > 0 && (
        <div className="space-y-4 pt-4">
          <h3 className="text-lg font-heading font-medium text-primary tracking-tight">
            Advance Liquidations Under Review
          </h3>
          <div className="table-specular divide-y divide-[var(--border-subtle)] rounded-xl bg-surface border border-subtle overflow-hidden shadow-xs dark:shadow-none">
            {paginatedAdvances.map((adv) => {
              const liq = Array.isArray(adv.liquidations) ? adv.liquidations[0] : adv.liquidations;
              const personName =
                adv.organization_members?.profiles?.display_name || "Accountable Member";

              return (
                <div
                  key={adv.id}
                  className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-elevated/60 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge >
                        CASH ADVANCE
                      </Badge>
                      <Badge >
                        UNDER RECONCILIATION
                      </Badge>
                    </div>
                    <h4 className="text-lg font-medium text-primary tracking-tight">{adv.title}</h4>
                    <p className="text-xs text-secondary">
                      Accountable Person: <strong className="text-primary">{personName}</strong>
                    </p>
                    <p className="text-xs text-secondary">{adv.purpose}</p>

                    {liq && <textarea aria-label={`Review notes for ${adv.title}`} placeholder="Reason required to reject; explain any discrepancy" className="w-full rounded-xl bg-elevated border border-subtle text-primary placeholder:text-muted p-3 text-sm focus:outline-none focus:border-strong" value={reviewNotes[adv.id] || ''} onChange={e => setReviewNotes({ ...reviewNotes, [adv.id]: e.target.value })} />}
                    {liq && (
                      <div className="pt-2 flex items-center gap-4 text-xs font-mono">
                        <span className="text-secondary">
                          Spent: <strong className="text-primary">{formatMoney(liq.total_spent_centavos, adv.currency)}</strong>
                        </span>
                        <span className="text-secondary">
                          Returned: <strong className="text-emerald-700 dark:text-emerald-400">{formatMoney(liq.total_returned_centavos, adv.currency)}</strong>
                        </span>
                        <span className="text-secondary">
                          Balance: <strong className="text-amber-700 dark:text-amber-400">{formatMoney(liq.outstanding_balance_centavos, adv.currency)}</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex sm:flex-col items-end justify-between sm:justify-center gap-3 shrink-0">
                    <p className="text-xl font-mono font-medium text-primary">
                      Released: {formatMoney(adv.amount_released_centavos, adv.currency)}
                    </p>

                    {isOfficer && liq && liq.submitted_by !== membership.profile_id && adv.organization_members?.profile_id !== membership.profile_id && (
                      <div className="flex items-center gap-2">
                        <button disabled={reviewLiquidationMutation.isPending || (liq.outstanding_balance_centavos !== 0 && (reviewNotes[adv.id]?.trim().length ?? 0) < 3)}
                          onClick={() =>
                            reviewLiquidationMutation.mutate({
                              liquidationId: liq.id,
                              decision: "approved",
                              notes: reviewNotes[adv.id],
                            })
                          }
                          className="px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors cursor-pointer"
                        >
                          Approve Liquidation
                        </button>
                        <button disabled={reviewLiquidationMutation.isPending || (reviewNotes[adv.id]?.trim().length ?? 0) < 3}
                          onClick={() =>
                            reviewLiquidationMutation.mutate({
                              liquidationId: liq.id,
                              decision: "rejected",
                              notes: reviewNotes[adv.id],
                            })
                          }
                          className="px-3 py-1.5 rounded-full bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-medium transition-colors cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <Pagination
              currentPage={liquidationsPage}
              totalItems={pendingAdvances.length}
              pageSize={liquidationsPageSize}
              onPageChange={setLiquidationsPage}
              pageSizeOptions={[6, 12, 24]}
              onPageSizeChange={setLiquidationsPageSize}
              itemLabel="pending liquidations"
            />
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
