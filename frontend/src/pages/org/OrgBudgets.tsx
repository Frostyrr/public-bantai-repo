import FormDraftControls from "../../components/ui/FormDraftControls";
import { useFormDraft, unavailableDraftSelection } from "../../hooks/useFormDraft";
import useFinancialQuery from "../../hooks/useFinancialQuery";
import { useSpaceRouteFilter } from "../../hooks/useSpaceRouteFilter";
import { useSearchParams } from "react-router-dom";
import CompactAmount from "../../components/ui/CompactAmount";
import Badge from "../../components/ui/Badge";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import BudgetDetailsModal from "../../components/org/budgets/BudgetDetailsModal";
import { useInspectorSelection } from "../../hooks/useInspectorSelection";
import RecordActions from "../../components/org/shared/RecordActions";
import BudgetAmendments from "../../components/org/budgets/BudgetAmendments";
import { isValidAmountInput, showFormErrors } from "../../lib/formValidation";
import { toast } from "../../lib/toast";
import { financialKey } from '../../utils/queryKeys';
import FinancialQueryState from '../../components/layout/FinancialQueryState';
import React, { useCallback, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PieChart,
  Plus,
  Search,
  Filter,
  AlertCircle,
  X,
  Layers,
  AlertTriangle,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import Modal from "../../components/ui/Modal";
import Pagination from "../../components/ui/Pagination";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  getSpaces,
  getReportingPeriods,
  type OrganizationDetails,
  type Membership,
  type Budget,
} from "../../lib/api";
import { getBudget } from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";

interface ContextType {
  activePeriodId: string;
  organization: OrganizationDetails;
  membership: Membership;
}

export default function OrgBudgets() {
  const [requestedSpace, setSelectedSpaceId] = useSpaceRouteFilter();
  const [params, setParams] = useSearchParams();
  const insightBudget = params.get("budget");
  const { orgId } = useParams<{ orgId: string }>();
  const { organization, membership, activePeriodId } = useOutletContext<ContextType>();
  const queryClient = useQueryClient();
  const effectiveOrgId = organization?.id || orgId;

  const [selectedStatus, setSelectedStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const selectedSpaceId = requestedSpace || "all";
  const [currentPage, setCurrentPage] = useState(1);
  const routeFilter = JSON.stringify([selectedSpaceId, insightBudget]);
  const [previousFilter, setPreviousFilter] = useState(routeFilter);
  if (previousFilter !== routeFilter) {
    setPreviousFilter(routeFilter);
    setCurrentPage(1);
  }
  const [pageSize, setPageSize] = useState(6);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [amendmentBudget, setAmendmentBudget] = useState<Budget | null>(null);
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [actionError, setActionError] = useState("");

  // Modal form states
  const [budgetName, setBudgetName] = useState("");
  const [allocatedInput, setAllocatedInput] = useState("");
  const [description, setDescription] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [budgetStatus, setBudgetStatus] = useState<"active" | "closed" | "archived">("active");

  const isOfficer =
    membership?.role === "owner" ||
    membership?.role === "organization_admin" ||
    membership?.role === "treasurer";

  // Data Queries
  const budgetsQuery = useFinancialQuery("budgets", effectiveOrgId, insightBudget ? { budgetId: insightBudget } : {
    spaceId: selectedSpaceId, periodId: activePeriodId,
  });

  const spacesQuery = useQuery({
    queryKey: ["organization-spaces", effectiveOrgId],
    queryFn: () => getSpaces(effectiveOrgId!),
    enabled: Boolean(effectiveOrgId),
  });

  const periodsQuery = useQuery({
    queryKey: ["organization-periods", effectiveOrgId],
    queryFn: () => getReportingPeriods(effectiveOrgId!),
    enabled: Boolean(effectiveOrgId),
  });

  const budgetVersion = (row: Budget) => JSON.stringify([row.name, row.allocated_amount_centavos, row.description, row.space_id, row.reporting_period_id, row.status, row.archived_at]);
  const draft = useFormDraft({
    orgId: effectiveOrgId ?? "", form: "budget", open: showCreateModal || showEditModal,
    recordId: showEditModal ? selectedBudget?.id : undefined,
    version: showEditModal && selectedBudget ? budgetVersion(selectedBudget) : "",
    values: { budgetName, allocatedInput, description, spaceId, budgetStatus: showEditModal ? budgetStatus : undefined, periodId: showEditModal ? undefined : periodId },
    verifyEdit: async (id, signal) => {
      const row = await getBudget(organization.id, id, signal);
      if (!isOfficer || ["pending_approval", "rejected", "archived"].includes(row.status) || row.archived_at) throw Error("This budget can no longer be edited.");
      return {
        version: budgetVersion(row),
        values: { budgetName: row.name, allocatedInput: (row.allocated_amount_centavos / 100).toFixed(2), description: row.description || "",
          spaceId: row.space_id || "", budgetStatus: row.status === "closed" ? "closed" as const : "active" as const, periodId: undefined },
        adopt: () => { setSelectedBudget(row); setPeriodId(row.reporting_period_id || ""); },
      };
    },
    restore: v => {
      setBudgetName(v.budgetName);
      setAllocatedInput(v.allocatedInput);
      setDescription(v.description);
      setSpaceId(v.spaceId);
      if (v.periodId !== undefined) setPeriodId(v.periodId);
      if (v.budgetStatus !== undefined) setBudgetStatus(v.budgetStatus);
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      allocatedCentavos: number;
      description?: string;
      spaceId?: string;
      periodId?: string;
    }) => createBudget(organization.id, payload),
    onMutate: draft.submission,
    onSuccess: async (budget, _variables, ticket) => {
      draft.complete(ticket);
      toast.success(budget.status === "pending_approval" ? "Budget submitted for approval" : "Budget created");
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: financialKey("budgets", organization.id, {  }) }),
      ]);
      setShowCreateModal(false);
      resetForm();
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      allocatedCentavos: number;
      description?: string;
      spaceId?: string;
      periodId?: string;
      status?: "active" | "closed" | "archived";
    }) => {
      if (!selectedBudget) throw new Error("No budget selected");
      return updateBudget(organization.id, selectedBudget.id, payload);
    },
    onMutate: draft.submission,
    onSuccess: async (_result, _variables, ticket) => {
      draft.complete(ticket);
      toast.success("Budget updated");
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: financialKey("budgets", organization.id, {  }) }),
      ]);
      setShowEditModal(false);
      setSelectedBudget(null);
      resetForm();
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!selectedBudget) throw new Error("No budget selected");
      return deleteBudget(organization.id, selectedBudget.id);
    },
    onSuccess: async () => {
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: financialKey("budgets", organization.id, {  }) }),
      ]);
      setShowDeleteModal(false);
      setSelectedBudget(null);
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const resetForm = () => {
    setBudgetName("");
    setAllocatedInput("");
    setDescription("");
    setSpaceId((spacesQuery.data ?? []).find(space => space.id === requestedSpace && space.status === "active")?.id ?? "");
    setPeriodId("");
    setBudgetStatus("active");
    setActionError("");
  };

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (draft.enabled && (draft.blocked || unavailableDraftSelection(spaceId, spacesQuery.data) || unavailableDraftSelection(periodId, periodsQuery.data))) {
      setActionError("Review the draft and choose an available space and reporting period.");
      return;
    }
    if (showFormErrors(e.currentTarget)) return;
    const allocatedVal = parseFloat(allocatedInput) || 0;
    if (allocatedVal < 0) {
      setActionError("Allocated amount cannot be negative.");
      return;
    }
    createMutation.mutate({
      name: budgetName.trim(),
      allocatedCentavos: Math.round(allocatedVal * 100),
      description: description.trim() || undefined,
      spaceId: spaceId || undefined,
      periodId: periodId || undefined,
    });
  };

  const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (draft.enabled && (draft.blocked || unavailableDraftSelection(spaceId, spacesQuery.data))) {
      setActionError("Review the draft and choose an available space.");
      return;
    }
    if (showFormErrors(e.currentTarget)) return;
    const allocatedVal = parseFloat(allocatedInput) || 0;
    if (allocatedVal < 0) {
      setActionError("Allocated amount cannot be negative.");
      return;
    }
    updateMutation.mutate({
      name: budgetName.trim(),
      allocatedCentavos: Math.round(allocatedVal * 100),
      description: description.trim() || undefined,
      spaceId: spaceId || undefined,
      periodId: periodId || undefined,
      status: budgetStatus,
    });
  };

  const openEditModal = (b: Budget) => {
    setSelectedBudget(b);
    setBudgetName(b.name);
    setAllocatedInput((b.allocated_amount_centavos / 100).toFixed(2));
    setDescription(b.description || "");
    setSpaceId(b.space_id || "");
    setPeriodId(b.reporting_period_id || "");
    setBudgetStatus(b.status === "closed" || b.status === "archived" ? b.status : "active");
    setActionError("");
    setShowEditModal(true);
  };

  const openDeleteModal = (b: Budget) => {
    setSelectedBudget(b);
    setActionError("");
    setShowDeleteModal(true);
  };

  const budgets = budgetsQuery.data ?? [];

  const filteredBudgets = insightBudget ? budgets.filter(b => b.id === insightBudget && !b.archived_at) :
    budgets.filter(b => !b.archived_at && (selectedStatus === "all" || (selectedStatus === "exceeded" ? (b.spent_centavos ?? 0) > b.allocated_amount_centavos : b.status === selectedStatus))).filter((b) =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (b.description && b.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const paginatedBudgets = filteredBudgets.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const getBudgetId = useCallback((b: Budget) => b.id, []);
  const {
    selectedItem: viewBudget,
    selectItem: setViewBudget,
    close: closeBudgetInspector,
    navigate: navigateBudget,
  } = useInspectorSelection(filteredBudgets, getBudgetId);

  const totalAllocatedCentavos = budgets.filter(b => b.status !== "pending_approval" && b.status !== "rejected").reduce(
    (sum, b) => sum + (b.allocated_amount_centavos || 0),
    0
  );
  const totalSpentCentavos = budgets.reduce(
    (sum, b) => sum + (b.spent_centavos || 0),
    0
  );
  const totalRemainingCentavos = Math.max(0, totalAllocatedCentavos - totalSpentCentavos);

  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <div data-tour="budgets-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="context" className="page-header-eyebrow">
              Spending Controls
            </Badge>
          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">Authorized Budgets</span>
          </h1>
          <p className="page-subtitle">
            Set authorized spending limits for initiatives, projects, or operating periods. Track burn rate in real time.
          </p>
        </div>

        {isOfficer && (
          <div data-tour="budgets-create" className="flex items-center gap-2.5 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                resetForm();
                setPeriodId(activePeriodId === "all" ? "" : activePeriodId);
                setShowCreateModal(true);
              }}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Create Budget
            </Button>
          </div>
        )}
      </div>

      {budgetsQuery.data === undefined ? (
        <FinancialQueryState queries={[budgetsQuery]} variant="cards" kpiCount={3} />
      ) : (
        <>
      {/* Aggregate Financial Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <span className="text-xs font-mono text-muted uppercase tracking-wider block mb-1">
            Total Allocated
          </span>
          <p className="metric-value text-primary">
            <CompactAmount centavos={totalAllocatedCentavos} currency={organization.currency} animate />
          </p>
          <span className="text-xs font-mono text-secondary mt-2 block">
            Across {budgets.length} authorized budgets
          </span>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <span className="text-xs font-mono text-muted uppercase tracking-wider block mb-1">
            Total Spent
          </span>
          <p className="metric-value text-primary">
            <CompactAmount centavos={totalSpentCentavos} currency={organization.currency} animate />
          </p>
          <span className="text-xs font-mono text-secondary mt-2 block">
            Approved expenditures
          </span>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <span className="text-xs font-mono text-muted uppercase tracking-wider block mb-1">
            Remaining Funds
          </span>
          <p className="metric-value text-primary">
            <CompactAmount centavos={totalRemainingCentavos} currency={organization.currency} animate />
          </p>
          <span className="text-xs font-mono text-secondary mt-2 block">
            Available headroom
          </span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div data-tour="budgets-filters" className="filter-toolbar">
        <div className="toolbar-search relative flex-1">
          <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            placeholder="Search budgets by name or description…"
            className="w-full bg-elevated border border-subtle rounded-full pl-10 pr-4 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors font-body"
          />
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={selectedSpaceId}
            onChange={(e) => { setSelectedSpaceId(e.target.value); setCurrentPage(1); }}
            variant="pill"
            selectSize="sm"
            icon={<Layers className="w-3.5 h-3.5 text-zinc-400" />}
            menuWidth="auto"
            options={[
              { value: "all", label: "All Projects" },
              ...(spacesQuery.data ?? []).map((s) => ({ value: s.id, label: s.name })),
            ]}
          />

          <Select
            value={selectedStatus}
            onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
            variant="pill"
            selectSize="sm"
            icon={<Filter className="w-3.5 h-3.5 text-zinc-400" />}
            menuWidth="auto"
            options={[
              { value: "all", label: "All Statuses" },
              { value: "active", label: "Active" },
              { value: "exceeded", label: "Exceeded" },
              { value: "closed", label: "Closed" },
              { value: "pending_approval", label: "Pending approval" },
              { value: "rejected", label: "Rejected" },
            ]}
          />
        </div>
      </div>

      {/* Error State */}
      {budgetsQuery.error && (
        <div role="alert" className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-sm">
          <p>{formatErrorMessage(budgetsQuery.error)}</p>
        </div>
      )}

      {/* Empty State */}
      {insightBudget && (
        <button type="button" className="text-xs text-secondary hover:text-primary underline underline-offset-4 cursor-pointer" onClick={() => setParams(previous => {
          const next = new URLSearchParams(previous);
          next.delete("budget");
          return next;
        })}>Show all budgets</button>
      )}
      {budgetsQuery.isSuccess && filteredBudgets.length === 0 && (
        <ModuleEmptyState>
          <div className="w-12 h-12 rounded-2xl bg-elevated border border-subtle flex items-center justify-center mb-4 text-secondary">
            <PieChart className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary mb-2 tracking-tight">
            No budgets created yet
          </h3>
          <p className="text-secondary text-xs sm:text-sm max-w-md mb-6 leading-relaxed">
            Create budget allocations to set spending ceilings for specific initiatives, committees, or operational needs.
          </p>
          {isOfficer && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                resetForm();
                setPeriodId(activePeriodId === "all" ? "" : activePeriodId);
              setShowCreateModal(true);
              }}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Create First Budget
            </Button>
          )}
        </ModuleEmptyState>
      )}

      {/* Budgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {paginatedBudgets.map((b) => {
          const allocated = b.allocated_amount_centavos;
          const spent = b.spent_centavos || 0;
          const committed = b.committed_centavos ?? 0;
          const remaining = b.remaining_centavos ?? (allocated - spent - committed);
          const utilizationPct = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;

          const isInspected = viewBudget?.id === b.id;

          return (
            <div
              key={b.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button, a")) return;
                setViewBudget(b);
              }}
              className={`card-specular-interactive min-w-0 p-6 rounded-xl bg-surface border card-interactive flex flex-col shadow-xs dark:shadow-none cursor-pointer transition-colors ${
                isInspected
                  ? "border-emerald-500/60 bg-selected-surface"
                  : "border-subtle"
              }`}
            >
              <div className="pb-6">
                <div className="flex min-h-10 items-center justify-between gap-2 mb-3">
                  <div className="flex min-w-0 items-center gap-2 flex-wrap">
                    <Badge >
                      {b.status || "ACTIVE"}
                    </Badge>
                    {b.spaces && (
                      <Badge variant="context" className="max-w-full" >
                        Project: {b.spaces.name}
                      </Badge>
                    )}
                    {b.reporting_periods && (
                      <Badge className="max-w-full" >
                        {b.reporting_periods.name}
                      </Badge>
                    )}
                  </div>

                  <RecordActions cardHeader title={b.name} onView={() => setViewBudget(b)}
                    onEdit={isOfficer && !["pending_approval", "rejected", "archived"].includes(b.status) ? () => openEditModal(b) : undefined}
                    archive={isOfficer && b.status !== "pending_approval" ? { org: organization.id, id: b.id, kind: "budget", archived: Boolean(b.archived_at) } : undefined}
                    onDelete={isOfficer && !spent && b.status !== "pending_approval" ? () => openDeleteModal(b) : undefined}
                    extra={isOfficer ? { label: "Amendments", onClick: () => setAmendmentBudget(b) } : undefined} />
                </div>

                <h3 title={b.name} className="line-clamp-2 wrap-anywhere text-xl font-heading font-medium text-primary tracking-tight">
                  {b.name}
                </h3>
                {b.description && (
                  <p className="text-xs text-secondary mt-2 line-clamp-2 wrap-anywhere leading-relaxed">
                    {b.description}
                  </p>
                )}

                {/* Burn Rate Progress Bar */}
                <div className="mt-5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-secondary">Budget Utilized</span>
                    <span className="font-mono text-primary font-medium">{utilizationPct}%</span>
                  </div>
                  <div className="w-full bg-progress-track h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        utilizationPct > 100
                          ? "bg-progress-fill dark:bg-rose-400"
                          : utilizationPct >= 80
                          ? "bg-progress-fill dark:bg-amber-400"
                          : "bg-progress-fill dark:bg-zinc-500"
                      }`}
                      style={{ width: `${Math.min(100, utilizationPct)}%` }}
                    />
                  </div>

                  <p className="text-xs text-secondary">
                    Committed <CompactAmount centavos={committed} currency={b.currency} />{b.provisional ? " · Provisional" : ""}
                  </p>
                  <div className="grid grid-cols-2 items-baseline gap-3 pt-1">
                    <div>
                      <span className="text-[11px] text-secondary block">Spent</span>
                      <span className="wrap-anywhere tabular-nums text-sm font-mono font-medium text-primary">
                        <CompactAmount centavos={spent} currency={b.currency} />
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-secondary block">Remaining capacity</span>
                      <span className="wrap-anywhere tabular-nums text-sm font-mono font-medium text-primary">
                        <CompactAmount centavos={remaining} currency={b.currency} />
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-subtle flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs text-secondary">
                <span className="font-mono">Allocated Limit:</span>
                <span className="ml-auto text-right wrap-anywhere tabular-nums font-mono font-medium text-primary">
                  <CompactAmount centavos={allocated} currency={b.currency} />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {filteredBudgets.length > 6 && (
        <div className="pt-2"><Pagination className="border-0! px-0!"
          currentPage={currentPage}
          totalItems={filteredBudgets.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          pageSizeOptions={[6, 12, 24]}
          onPageSizeChange={setPageSize}
          itemLabel="budgets"
        /></div>
      )}
        </>
      )}

      <BudgetDetailsModal
        budget={viewBudget}
        currency={organization.currency || "PHP"}
        onClose={closeBudgetInspector}
        onNavigate={navigateBudget}
      />
      {/* Create Budget Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        maxWidth="lg"
      >
        <button
          onClick={() => setShowCreateModal(false)}
          className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

            <div className="flex items-center gap-2 mb-2">
              <Badge >
                Spending Limit
              </Badge>
            </div>
            <h2 className="text-primary mb-1 section-title">
              Create Budget Allocation
            </h2>
            <p className="text-xs text-secondary mb-6 leading-relaxed">
              Define an authorized spending limit. Expenses linked to this budget cannot exceed this cap.
            </p>

            {actionError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <p>{actionError}</p>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <Input
                label="Budget Name"
                validationMessage={!budgetName.trim() ? "Enter a budget name." : undefined}
                placeholder="e.g. Stage Production & Audio"
                value={budgetName}
                onChange={(e) => setBudgetName(e.target.value)}
                required
              />

              <Input
                label={`Allocated Limit (${organization.currency})`}
                validationMessage={!isValidAmountInput(allocatedInput, 0) ? "Enter a nonnegative amount with up to two decimal places." : undefined}
                inputMode="decimal"
                placeholder="10000.00"
                value={allocatedInput}
                onChange={(e) => setAllocatedInput(e.target.value)}
                required
              />

              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  Description (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Scope or guidelines for authorized expenditures…"
                  rows={2}
                  className="w-full rounded-2xl bg-elevated border border-subtle p-3.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong font-body"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Link Project (Optional)"
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                  placeholder="No space (General Organization)"
                  options={[
                    { value: "", label: "No space (General Organization)" },
                    ...(spacesQuery.data ?? []).filter(s => s.status === "active" || s.id === spaceId).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />

                <Select
                  label="Reporting Period (Optional)"
                  value={periodId}
                  onChange={(e) => setPeriodId(e.target.value)}
                  placeholder="No period (All-time)"
                  options={[
                    { value: "", label: "No period (All-time)" },
                    ...(periodsQuery.data ?? []).map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </div>

              <FormDraftControls draft={draft} busy={createMutation.isPending || updateMutation.isPending} />

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-subtle">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={createMutation.isPending || !budgetName.trim()}
                >
                  {createMutation.isPending ? "Creating…" : "Save Allocation"}
                </Button>
              </div>
            </form>
      </Modal>

      {/* Edit Budget Modal */}
      <Modal
        isOpen={Boolean(showEditModal && selectedBudget)}
        onClose={() => {
          setShowEditModal(false);
          setSelectedBudget(null);
        }}
        maxWidth="lg"
      >
        {selectedBudget && (
          <>
            <button
              onClick={() => {
                setShowEditModal(false);
                setSelectedBudget(null);
              }}
              className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Badge >
                Modify Allocation
              </Badge>
            </div>
            <h2 className="text-primary mb-1 section-title">
              Edit Budget
            </h2>

            {actionError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <p>{actionError}</p>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <Input
                label="Budget Name"
                validationMessage={!budgetName.trim() ? "Enter a budget name." : undefined}
                value={budgetName}
                onChange={(e) => setBudgetName(e.target.value)}
                required
              />

              <Input
                readOnly
                label={`Authorized Allocation (${organization.currency})`}
                validationMessage={!isValidAmountInput(allocatedInput, 0) ? "Enter a nonnegative amount with up to two decimal places." : undefined}
                inputMode="decimal"
                value={allocatedInput}
                onChange={(e) => setAllocatedInput(e.target.value)}
                required
              />

              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-2xl bg-elevated border border-subtle p-3.5 text-sm text-primary focus:outline-none focus:border-strong font-body"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Link Project"
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                  options={[
                    { value: "", label: "No space (General Organization)" },
                    ...(spacesQuery.data ?? []).filter(s => s.status === "active" || s.id === spaceId).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />

                <Select
                  label="Status"
                  value={budgetStatus}
                  onChange={(e) => setBudgetStatus(e.target.value as "active" | "closed" | "archived")}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "closed", label: "Closed" },
                  ]}
                />
              </div>

              <FormDraftControls draft={draft} busy={createMutation.isPending || updateMutation.isPending} />

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-subtle">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={updateMutation.isPending || !budgetName.trim()}
                >
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          </>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(showDeleteModal && selectedBudget)}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedBudget(null);
        }}
        maxWidth="md"
        className="space-y-5"
      >
        {selectedBudget && (
          <>
            <button
              onClick={() => {
                setShowDeleteModal(false);
                setSelectedBudget(null);
              }}
              className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
                Delete "{selectedBudget.name}"?
              </h3>
              <p className="text-xs text-secondary mt-2 leading-relaxed">
                Only budgets without linked expenses or cash advances can be permanently deleted.
              </p>
            </div>

            <div className="space-y-2">


            </div>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs">
                {actionError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowDeleteModal(false);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => deleteMutation.mutate()}
                isLoading={deleteMutation.isPending}
                className="flex-1"
              >
                Confirm Delete
              </Button>
            </div>
          </>
        )}
      </Modal>
      {amendmentBudget && <BudgetAmendments org={organization.id} budget={amendmentBudget}
        ownerOrAdmin={membership.role === "owner" || membership.role === "organization_admin"}
        actor={membership.profile_id} onClose={() => setAmendmentBudget(null)} />}
    </div>
  );
}
