import { isValidAmountInput } from "../../lib/formValidation";
import FormDraftControls from "../../components/ui/FormDraftControls";
import { useFormDraft, unavailableDraftSelection } from "../../hooks/useFormDraft";
import useFinancialQuery from "../../hooks/useFinancialQuery";
import LiquidationAccounting from "../../components/org/expenses/LiquidationAccounting";
import { useSearchParams as useSpaceSearchParams } from "react-router-dom";
import RecordActions from "../../components/org/shared/RecordActions";
import AnimatedNumber from "../../components/ui/AnimatedNumber";
import CompactAmount from "../../components/ui/CompactAmount";
import Badge from "../../components/ui/Badge";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import CashAdvanceRequests from "../../components/org/expenses/CashAdvanceRequests";
import FinancialQueryState from '../../components/layout/FinancialQueryState';
import { canReviewAdvance } from '../../utils/financialWorkflow';
import React, { useCallback, useState } from "react";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
  InspectorSection,
} from "../../components/ui/DetailInspector";
import { useInspectorSelection } from "../../hooks/useInspectorSelection";
import { useOutletContext, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {

  Plus,
  AlertCircle,
  X,
  DollarSign,
  CheckCircle2,
  User,
  ShieldAlert,
  AlertTriangle,
  Search,
  Filter,
  FileCheck,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import Modal from "../../components/ui/Modal";
import Pagination from "../../components/ui/Pagination";
import InfoTooltip from "../../components/ui/InfoTooltip";
import {
  getSpaces,
  createCashAdvance,
  updateCashAdvance,
  deleteLiquidation,
  submitLiquidation,
  getOrganizationMembers,
  type CashAdvance,
  type OrganizationDetails,
  type Membership,
} from "../../lib/api";
import { getCashAdvance } from "../../lib/api";
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

export default function OrgLiquidation() {
  const [spaceParams] = useSpaceSearchParams();
  const requestedSpace = spaceParams.get("space") ?? "";
  const { orgId } = useParams<{ orgId: string }>();
  const { organization, membership } = useOutletContext<ContextType>();
  const { activePeriodId } = useOutletContext<{ activePeriodId: string }>();
  const queryClient = useQueryClient();
  const effectiveOrgId = organization?.id || orgId;

  const [showCreateAdvanceModal, setShowCreateAdvanceModal] = useState(false);
  const [showSubmitLiquidationModal, setShowSubmitLiquidationModal] = useState(false);
  const [selectedAdvance, setSelectedAdvance] = useState<CashAdvance | null>(null);
  const [actionError, setActionError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [ledgerView, setLedgerView] = useState<"ledger" | "requests">("ledger");
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Create Advance Form
  const [accountablePersonId, setAccountablePersonId] = useState("");
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [disbursementMethod, setDisbursementMethod] = useState<CashAdvance["disbursement_method"]>("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [budgetId, setBudgetId] = useState("");

  // Submit Liquidation Form
  const [spentInput, setSpentInput] = useState("");
  const [returnedInput, setReturnedInput] = useState("");
  const [reconciliationNotes, setReconciliationNotes] = useState("");

  // Edit Advance State
  const [showEditAdvanceModal, setShowEditAdvanceModal] = useState(false);
  const [advanceToEdit, setAdvanceToEdit] = useState<CashAdvance | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [editAmountInput, setEditAmountInput] = useState("");
  const [editDisbursementMethod, setEditDisbursementMethod] = useState<CashAdvance["disbursement_method"]>("cash");
  const [editReferenceNumber, setEditReferenceNumber] = useState("");
  const [editBudgetId, setEditBudgetId] = useState("");


  // Cancel Liquidation State
  const [showCancelLiquidationModal, setShowCancelLiquidationModal] = useState(false);
  const [liquidationToCancel, setLiquidationToCancel] = useState<{ id: string; advanceTitle: string } | null>(null);

  const isOfficer =
    membership?.role === "owner" ||
    membership?.role === "organization_admin" ||
    membership?.role === "treasurer" ||
    membership?.role === "auditor";

  // Data Queries
  const spacesQuery = useQuery({
    queryKey: ["organization-spaces", effectiveOrgId],
    queryFn: () => getSpaces(effectiveOrgId!),
    enabled: Boolean(effectiveOrgId && requestedSpace),
  });
  const assignedSpace = spacesQuery.data?.find(space => space.id === requestedSpace && space.status === "active");
  const advancesQuery = useFinancialQuery("advances", effectiveOrgId);

  const membersQuery = useQuery({
    queryKey: ["organization-members", effectiveOrgId],
    queryFn: () => getOrganizationMembers(effectiveOrgId!),
    enabled: Boolean(effectiveOrgId),
  });

  const budgetsQuery = useFinancialQuery("budgets", effectiveOrgId);

  const advanceVersion = (row: CashAdvance) => JSON.stringify([row.title, row.purpose, row.amount_released_centavos, row.disbursement_method, row.budget_id, row.status]);
  const createDraft = useFormDraft({
    orgId: effectiveOrgId ?? "", form: "advance-ledger", open: showCreateAdvanceModal,
    contextId: requestedSpace ? JSON.stringify([requestedSpace, activePeriodId]) : undefined,
    values: { accountablePersonId, title, purpose, amountInput, disbursementMethod, budgetId },
    restore: v => {
      setAccountablePersonId(v.accountablePersonId);
      setTitle(v.title);
      setPurpose(v.purpose);
      setAmountInput(v.amountInput);
      setDisbursementMethod(v.disbursementMethod);
      setBudgetId(v.budgetId);
    },
  });

  const editDraft = useFormDraft({
    orgId: effectiveOrgId ?? "", form: "advance-ledger", open: showEditAdvanceModal,
    recordId: advanceToEdit?.id, version: advanceToEdit ? advanceVersion(advanceToEdit) : "",
    values: { title: editTitle, purpose: editPurpose },
    verifyEdit: async (id, signal) => {
      const row = await getCashAdvance(organization.id, id, signal);
      if (!isOfficer || !["outstanding", "disputed"].includes(row.status)) throw Error("This advance can no longer be edited.");
      return {
        version: advanceVersion(row),
        values: { title: row.title, purpose: row.purpose },
        adopt: () => {
          setAdvanceToEdit(row);
          setEditAmountInput((row.amount_released_centavos / 100).toFixed(2));
          setEditDisbursementMethod(row.disbursement_method);
          setEditBudgetId(row.budget_id || "");
          setEditReferenceNumber(row.reference_number || "");
        },
      };
    },
    restore: v => {
      setEditTitle(v.title);
      setEditPurpose(v.purpose);
    },
  });

  // Mutations
  const createAdvanceMutation = useMutation({
    mutationFn: (payload: {
      accountablePersonId: string;
      title: string;
      purpose: string;
      amountCentavos: number;
      disbursementMethod: CashAdvance["disbursement_method"];
      referenceNumber?: string;
      budgetId?: string;
      spaceId?: string;
      periodId?: string;
    }) => createCashAdvance(organization.id, payload),
    onMutate: createDraft.submission,
    onSuccess: async (_result, _variables, ticket) => {
      createDraft.complete(ticket);
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: ["advances", organization.id] }),
      ]);
      setShowCreateAdvanceModal(false);
      resetAdvanceForm();
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const submitLiquidationMutation = useMutation({
    mutationFn: (payload: {
      cashAdvanceId: string;
      spentCentavos: number;
      returnedCentavos: number;
      notes?: string;
    }) => submitLiquidation(organization.id, payload),
    onSuccess: async () => {
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: ["advances", organization.id] }),
      ]);
      setShowSubmitLiquidationModal(false);
      setSelectedAdvance(null);
      setSpentInput("");
      setReturnedInput("");
      setReconciliationNotes("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });



  const updateAdvanceMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      purpose: string;
      amountCentavos: number;
      disbursementMethod: CashAdvance["disbursement_method"];
      referenceNumber?: string;
      budgetId?: string;
    }) => updateCashAdvance(organization.id, advanceToEdit!.id, payload),
    onMutate: editDraft.submission,
    onSuccess: async (_result, _variables, ticket) => {
      editDraft.complete(ticket);
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: ["advances", organization.id] }),
      ]);
      setShowEditAdvanceModal(false);
      setAdvanceToEdit(null);
      setActionError("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });


  const cancelLiquidationMutation = useMutation({
    mutationFn: () => deleteLiquidation(organization.id, liquidationToCancel!.id),
    onSuccess: async () => {
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", organization.id] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", organization.id] })]),
        queryClient.invalidateQueries({ queryKey: ["advances", organization.id] }),
      ]);
      setShowCancelLiquidationModal(false);
      setLiquidationToCancel(null);
      setActionError("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const openEditAdvanceModal = (adv: CashAdvance) => {
    setAdvanceToEdit(adv);
    setEditTitle(adv.title);
    setEditPurpose(adv.purpose);
    setEditAmountInput((adv.amount_released_centavos / 100).toFixed(2));
    setEditDisbursementMethod(adv.disbursement_method);
    setEditReferenceNumber(adv.reference_number || "");
    setEditBudgetId(adv.budget_id || "");
    setActionError("");
    setShowEditAdvanceModal(true);
  };

  const handleEditAdvanceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editDraft.blocked) {
      setActionError("Review the draft before saving.");
      return;
    }
    if (!advanceToEdit || !editTitle.trim() || !editPurpose.trim()) return;
    const amountVal = parseFloat(editAmountInput) || 0;
    if (amountVal <= 0) {
      setActionError("Amount must be greater than zero.");
      return;
    }
    updateAdvanceMutation.mutate({
      title: editTitle.trim(),
      purpose: editPurpose.trim(),
      amountCentavos: Math.round(amountVal * 100),
      disbursementMethod: editDisbursementMethod,
      referenceNumber: editReferenceNumber.trim() || undefined,
      budgetId: editBudgetId || undefined,
    });
  };


  const openCancelLiquidationModal = (liquidationId: string, advanceTitle: string) => {
    setLiquidationToCancel({ id: liquidationId, advanceTitle });
    setActionError("");
    setShowCancelLiquidationModal(true);
  };

  const resetAdvanceForm = () => {
    setAccountablePersonId("");
    setTitle("");
    setPurpose("");
    setAmountInput("");
    setDisbursementMethod("cash");
    setReferenceNumber("");
    setBudgetId("");
    setActionError("");
  };

  const handleCreateAdvanceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (createDraft.enabled && (createDraft.blocked || unavailableDraftSelection(accountablePersonId, membersQuery.data) || unavailableDraftSelection(budgetId, budgetsQuery.data?.filter(row => !row.archived_at && row.status === "active")))) {
      setActionError("Review the draft and choose an available accountable person and budget.");
      return;
    }
    if (!accountablePersonId || !title.trim() || !purpose.trim()) return;
    if (!isValidAmountInput(amountInput, 0.01)) { setActionError("Enter a positive amount with up to two decimal places."); return; }
    if (requestedSpace && !assignedSpace) {
      setActionError("Choose an active space before releasing an advance from this view.");
      return;
    }
    const amountVal = parseFloat(amountInput) || 0;
    if (amountVal <= 0) {
      setActionError("Amount must be greater than zero.");
      return;
    }

    createAdvanceMutation.mutate({
      accountablePersonId,
      title: title.trim(),
      purpose: purpose.trim(),
      amountCentavos: Math.round(amountVal * 100),
      disbursementMethod,
      referenceNumber: referenceNumber.trim() || undefined,
      budgetId: budgetId || undefined,
      spaceId: assignedSpace?.id,
      periodId: requestedSpace && activePeriodId !== "all" ? activePeriodId : undefined,
    });
  };

  const handleSubmitLiquidationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdvance) return;
    const spentVal = parseFloat(spentInput) || 0;
    const returnedVal = parseFloat(returnedInput) || 0;

    submitLiquidationMutation.mutate({
      cashAdvanceId: selectedAdvance.id,
      spentCentavos: Math.round(spentVal * 100),
      returnedCentavos: Math.round(returnedVal * 100),
      notes: reconciliationNotes.trim() || undefined,
    });
  };

  const advances = advancesQuery.data ?? [];

  const totalReleasedCentavos = advances.reduce(
    (sum, a) => sum + a.amount_released_centavos,
    0
  );

  const outstandingAdvances = advances.filter(
    (a) => ["outstanding", "under_review", "disputed"].includes(a.status)
  );

  const totalOutstandingCentavos = outstandingAdvances.reduce(
    (sum, a) => sum + a.amount_released_centavos,
    0
  );

  const liquidatedAdvances = advances.filter((a) => a.status === "liquidated");

  const filteredAdvances = advances.filter((adv) => {
    if (requestedSpace && (adv.space_id !== requestedSpace || (activePeriodId !== "all" && adv.reporting_period_id !== activePeriodId))) return false;
    const personName =
      adv.organization_members?.profiles?.display_name || "Accountable Member";
    const matchesSearch =
      adv.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (adv.purpose && adv.purpose.toLowerCase().includes(searchQuery.toLowerCase())) ||
      personName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (adv.reference_number && adv.reference_number.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === "all" || adv.status === statusFilter;
    return matchesSearch && matchesStatus && (methodFilter === "all" || adv.disbursement_method === methodFilter);
  });

  const paginatedAdvances = filteredAdvances.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const getAdvanceId = useCallback((adv: CashAdvance) => adv.id, []);
  const {
    selectedItem: viewAdvance,
    selectItem: setViewAdvance,
    close: closeAdvanceInspector,
    navigate: navigateAdvance,
  } = useInspectorSelection(filteredAdvances, getAdvanceId);

  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <div data-tour="advances-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="context" className="page-header-eyebrow">
              Cash Advances
            </Badge>

          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">Cash Advances</span>
          </h1>
          <p className="page-subtitle">
            Release funds upfront to members, review expense liquidations, and track returned change.
                        <InfoTooltip
              content="All reporting periods. Liquidation means accounting for an advance with spending records and returned funds. Disputed advances remain outstanding until resolved. Unreconciled balance = cash released minus accepted expenses and returned funds."
              side="bottom"
            />
          </p>
        </div>

        {isOfficer && (
          <Button
            data-tour="advances-create"
            variant="primary"
            size="sm"
            onClick={() => {
              resetAdvanceForm();
              setShowCreateAdvanceModal(true);
            }}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Release Cash Advance
          </Button>
        )}
      </div>

      {actionError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <p>{actionError}</p>
        </div>
      )}

      {advancesQuery.data === undefined ? (
        <FinancialQueryState queries={[advancesQuery]} variant="table" kpiCount={3} />
      ) : (
        <>
      {/* Aggregate Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Total Released</span>
            <DollarSign className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary">
            <CompactAmount centavos={totalReleasedCentavos} currency={organization.currency} animate />
          </p>
          <p className="text-xs text-secondary mt-1">{advances.length} advances issued</p>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Outstanding at Risk</span>
            <ShieldAlert className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary">
            <CompactAmount centavos={totalOutstandingCentavos} currency={organization.currency} animate />
          </p>
          <p className="text-xs text-secondary mt-1">{outstandingAdvances.length} unreconciled advances</p>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Fully Liquidated</span>
            <CheckCircle2 className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary">
            <AnimatedNumber value={liquidatedAdvances.length} /> / <AnimatedNumber value={advances.length} />
          </p>
          <p className="text-xs text-secondary mt-1">Reconciliation ratified</p>
        </div>
      </div>

      <CashAdvanceRequests spaceId={requestedSpace || undefined} periodId={activePeriodId === "all" ? undefined : activePeriodId} view={ledgerView} onViewChange={setLedgerView} org={organization.id} actor={membership.profile_id} role={membership.role ?? ""} currency={organization.currency ?? "PHP"} />
      {ledgerView === "ledger" && <>
      {/* Empty State */}
      {!advancesQuery.isPending && advances.length === 0 && (
        <ModuleEmptyState>
          <div className="w-12 h-12 rounded-2xl bg-elevated border border-subtle flex items-center justify-center mb-3 text-secondary">
            <FileCheck className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary mb-1 tracking-tight">
            No cash releases on record
          </h3>
          <p className="text-zinc-400 text-xs sm:text-sm max-w-sm leading-relaxed mb-6">
            Release cash advances to accountable team members for event floats, catering, or operational purchases.
          </p>
          {isOfficer && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                resetAdvanceForm();
                setShowCreateAdvanceModal(true);
              }}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Release First Advance
            </Button>
          )}
        </ModuleEmptyState>
      )}

      {/* Filter & Search Bar */}
      {advances.length > 0 && (
        <div data-tour="advances-filters" className="filter-toolbar">
          <div className="toolbar-search relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by title, person, or reference..."
              className="w-full bg-surface border border-subtle rounded-full pl-10 pr-4 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors"
            />
          </div>

          <Select ariaLabel="Disbursement method" value={methodFilter} onChange={event => { setMethodFilter(event.target.value); setCurrentPage(1); }}
            variant="pill" selectSize="sm" menuWidth="auto"
            options={[{ value: "all", label: "All Methods" }, { value: "cash", label: "Cash" }, { value: "bank_transfer", label: "Transfer" }, { value: "check", label: "Check" }, { value: "gcash", label: "GCash" }, { value: "maya", label: "Maya" }, { value: "other", label: "Other" }]} />
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            variant="pill"
            selectSize="sm"
            icon={<Filter className="w-3.5 h-3.5 text-zinc-400" />}
            menuWidth="auto"
            options={[
              { value: "all", label: "All Statuses" },
              { value: "outstanding", label: "Outstanding" },
              { value: "under_review", label: "Under Review" },
              { value: "liquidated", label: "Liquidated" },
              { value: "disputed", label: "Disputed" },
            ]}
          />
        </div>
      )}

      {/* Filtered Empty State */}
      {!advancesQuery.isPending && advances.length > 0 && filteredAdvances.length === 0 && (
        <div className="card-specular p-12 text-center rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <p className="text-sm text-zinc-400">
            No cash advances match your search or filter criteria.
          </p>
        </div>
      )}

      {/* Advances Table */}
      {filteredAdvances.length > 0 && (
        <div className="table-specular rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-subtle bg-elevated text-[11px] font-mono uppercase tracking-wider text-secondary">
                  <th className="py-4 px-6">Advance / Initiative</th>
                  <th className="py-4 px-6">Accountable Person</th>
                  <th className="py-4 px-6 text-right">Released Amount</th>
                  <th className="py-4 px-6">Method &amp; Ref</th>
                  <th className="py-4 px-6 text-center">Status</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle text-sm">
                {paginatedAdvances.map((adv) => {
                  const personName =
                    adv.organization_members?.profiles?.display_name || "Accountable Member";
                  const liq = Array.isArray(adv.liquidations) ? adv.liquidations[0] : adv.liquidations;

                  const isSelected = viewAdvance?.id === adv.id;

                  return (
                    <tr
                      key={adv.id}
                      tabIndex={0}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button, a")) return;
                        setViewAdvance(adv);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setViewAdvance(adv);
                        }
                      }}
                      className={`transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/30 ${
                        isSelected ? "bg-selected-surface" : "hover:bg-elevated"
                      }`}
                    >
                      <td className="py-4 px-6">
                        <div className="font-medium text-primary">{adv.title}</div>
                        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{adv.purpose}</p>
                      </td>
                      <td className="py-4 px-6">
                        <div className="font-medium text-primary flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-zinc-400" />
                          <span>{personName}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right font-mono font-medium text-primary">
                        {formatMoney(adv.amount_released_centavos, adv.currency)}
                      </td>
                      <td className="py-4 px-6">
                        <Badge >
                          {adv.disbursement_method?.replace("_", " ") ?? "Unavailable"}
                        </Badge>
                        {adv.reference_number && (
                          <p className="text-xs font-mono text-zinc-400 mt-1">Ref: {adv.reference_number}</p>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <Badge >
                          {adv.status.replace("_", " ").toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-4 px-6 text-right whitespace-nowrap">
                        {(adv.status === "outstanding" || adv.status === "disputed") ? (
                          <div className="inline-flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8! rounded-lg! border-subtle! bg-elevated! px-3! py-0! text-xs! font-medium text-primary hover:bg-surface"
                              onClick={() => {
                                setSelectedAdvance(adv);
                                setSpentInput("");
                                setReturnedInput("");
                                setReconciliationNotes("");
                                setActionError("");
                                setShowSubmitLiquidationModal(true);
                              }}
                            >
                              Liquidate
                            </Button>

                          </div>
                        ) : adv.status === "under_review" && liq ? (
                          <div className="flex items-center justify-end gap-2">
                            {canReviewAdvance(adv, membership.profile_id, membership.role) && <Button size="sm" to={`/app/org/${organization.id}/approvals`}>Review in inbox</Button>}
                            <button
                              type="button"
                              onClick={() => openCancelLiquidationModal(liq.id, adv.title)}
                              className="px-2.5 py-1 rounded-full bg-elevated hover:bg-surface text-secondary hover:text-rose-600 dark:hover:text-rose-400 border border-subtle text-xs font-medium transition-colors cursor-pointer"
                              title="Cancel submitted liquidation draft"
                            >
                              Withdraw Draft
                            </button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="h-8! rounded-lg! px-3! py-0! text-xs!" onClick={() => setViewAdvance(adv)}>View Liquidation</Button>
                        )}
                        <RecordActions title={adv.title} onView={() => setViewAdvance(adv)}
                          onEdit={isOfficer && ["outstanding", "disputed"].includes(adv.status) ? () => openEditAdvanceModal(adv) : undefined} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={currentPage}
            totalItems={filteredAdvances.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            pageSizeOptions={[10, 25, 50]}
            onPageSizeChange={setPageSize}
            itemLabel="cash advances"
          />
        </div>
      )}

      {/* MODAL 1: RELEASE CASH ADVANCE */}
      </>}
        </>
      )}

      <DetailInspector
        isOpen={Boolean(viewAdvance)}
        onClose={closeAdvanceInspector}
        onNavigate={navigateAdvance}
        categoryLabel="Cash Advance Details"
        title={viewAdvance?.title ?? ""}
        subtitle={
          viewAdvance ? (
            <Badge>{viewAdvance.status.replaceAll("_", " ")}</Badge>
          ) : undefined
        }
        footer={
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={closeAdvanceInspector}
            >
              Close
            </Button>
          </div>
        }
      >
        {viewAdvance && (
          <>
            {viewAdvance.purpose && (
              <InspectorSection title="Purpose">
                <p className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.02] p-3 text-xs text-secondary whitespace-pre-wrap">
                  {viewAdvance.purpose}
                </p>
              </InspectorSection>
            )}

            <InspectorGrid>
              <InspectorField
                label="Released"
                value={formatMoney(
                  viewAdvance.amount_released_centavos,
                  viewAdvance.currency
                )}
                mono
              />
              <InspectorField
                label="Method"
                value={
                  viewAdvance.disbursement_method?.replaceAll("_", " ") ??
                  "Unavailable"
                }
              />
              <InspectorField
                label="Project"
                value={viewAdvance.spaces?.name ?? "Unassigned"}
              />
              <InspectorField
                label="Reporting period"
                value={viewAdvance.reporting_periods?.name ?? "Unassigned"}
              />
              <InspectorField
                label="Reference"
                value={viewAdvance.reference_number || "Not specified"}
                className="col-span-2"
              />
            </InspectorGrid>

            {(() => {
              const liquidation = Array.isArray(viewAdvance.liquidations)
                ? viewAdvance.liquidations[0]
                : viewAdvance.liquidations;
              return (
                liquidation && (
                  <>
                    <InspectorSection title="Liquidation Summary">
                      <InspectorGrid columns={3}>
                        <InspectorField
                          label="Spent"
                          value={formatMoney(
                            liquidation.total_spent_centavos,
                            viewAdvance.currency
                          )}
                          mono
                        />
                        <InspectorField
                          label="Returned"
                          value={formatMoney(
                            liquidation.total_returned_centavos,
                            viewAdvance.currency
                          )}
                          mono
                        />
                        <InspectorField
                          label="Outstanding"
                          value={
                            liquidation.outstanding_balance_centavos == null
                              ? "Unavailable"
                              : formatMoney(
                                  liquidation.outstanding_balance_centavos,
                                  viewAdvance.currency
                                )
                          }
                          mono
                        />
                      </InspectorGrid>
                    </InspectorSection>
                    {liquidation.status === "approved" && liquidation.id && (
                      <LiquidationAccounting
                        key={liquidation.id}
                        advance={viewAdvance}
                        liquidation={liquidation}
                        canManage={
                          membership.role === "owner" ||
                          membership.role === "organization_admin"
                        }
                      />
                    )}
                  </>
                )
              );
            })()}
          </>
        )}
      </DetailInspector>

      <Modal
        isOpen={showCreateAdvanceModal}
        onClose={() => setShowCreateAdvanceModal(false)}
        maxWidth="lg"
      >
        <button
          onClick={() => setShowCreateAdvanceModal(false)}
          className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

            <div className="flex items-center gap-2 mb-2">
              <Badge >
                Fund Release
              </Badge>
            </div>
            <h2 className="text-primary mb-1 section-title">
              Release Cash Advance
            </h2>
            <p className="text-xs text-secondary mb-6">
              Disburse organizational funds to an accountable member for authorized expenditures.
            </p>

            <form onSubmit={handleCreateAdvanceSubmit} className="space-y-4">
          {requestedSpace && (
            <p className="text-sm text-secondary">
              {assignedSpace ? `Linked project: ${assignedSpace.name}` : "An active project is required to release an advance from this view."}
            </p>
          )}
              <Select
                label="Accountable Member"
                value={accountablePersonId}
                onChange={(e) => setAccountablePersonId(e.target.value)}
                required
                placeholder="Select accountable recipient…"
                options={(membersQuery.data ?? []).map((m) => ({
                  value: m.id,
                  label: `${m.profiles?.display_name || "Member"} (${m.role})`,
                }))}
              />

              <Input
                label="Initiative / Advance Title"
                placeholder="e.g. Science Fair Food Stall Float"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={`Amount Released (${organization.currency})`}
                  inputMode="decimal"
                  placeholder="5000.00"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  required
                />

                <Select
                  label="Disbursement Method"
                  value={disbursementMethod}
                  onChange={(e) => setDisbursementMethod(e.target.value as CashAdvance["disbursement_method"])}
                  options={[
                    { value: "cash", label: "Cash (Physical Cash Handover)" },
                    { value: "gcash", label: "GCash (E-Wallet Transfer)" },
                    { value: "maya", label: "Maya (E-Wallet Transfer)" },
                    { value: "bank_transfer", label: "Bank Transfer" },
                    { value: "check", label: "Check" },
                    { value: "other", label: "Other" },
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Reference Number / Check # (Optional)"
                  placeholder="e.g. TR-998822 or Check # 104"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                />

                <Select
                  label="Link Authorized Budget (Optional)"
                  value={budgetId}
                  onChange={(e) => setBudgetId(e.target.value)}
                  placeholder="No budget linked"
                  options={[
                    { value: "", label: "No budget linked" },
                    ...(budgetsQuery.data ?? []).filter(budget => !budget.archived_at && budget.status === "active").map((b) => ({
                      value: b.id,
                      label: `${b.name} (Remaining: ${formatMoney(b.remaining_centavos ?? b.allocated_amount_centavos, b.currency)})`,
                    })),
                  ]}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Purpose / Intended Use
                </label>
                <textarea
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Describe specifically what items will be purchased with this advance…"
                  rows={2}
                  className="w-full rounded-2xl bg-elevated border border-subtle p-3.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong"
                  required
                />
              </div>

              <FormDraftControls draft={createDraft} busy={createAdvanceMutation.isPending} />

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-subtle">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateAdvanceModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={createAdvanceMutation.isPending || !title.trim() || !accountablePersonId}
                >
                  {createAdvanceMutation.isPending ? "Releasing…" : "Authorize Release"}
                </Button>
              </div>
            </form>
      </Modal>

      {/* MODAL 2: SUBMIT LIQUIDATION */}
      <Modal
        isOpen={Boolean(showSubmitLiquidationModal && selectedAdvance)}
        onClose={() => setShowSubmitLiquidationModal(false)}
        maxWidth="lg"
      >
        {selectedAdvance && (
          <>
            <button
              onClick={() => setShowSubmitLiquidationModal(false)}
              className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Badge >
                Reconciliation
              </Badge>
            </div>
            <h2 className="text-primary mb-1 section-title">
              Submit Liquidation
            </h2>
            <p className="text-xs text-secondary mb-5">
              Reconciling advance: <strong className="text-primary">{selectedAdvance.title}</strong> (Released:{" "}
              <strong className="text-secondary font-mono">
                {formatMoney(selectedAdvance.amount_released_centavos, selectedAdvance.currency)}
              </strong>)
            </p>

            <form onSubmit={handleSubmitLiquidationSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={`Total Amount Spent (${selectedAdvance.currency})`}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={spentInput}
                  onChange={(e) => setSpentInput(e.target.value)}
                  required
                />

                <Input
                  label={`Excess Cash Returned (${selectedAdvance.currency})`}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={returnedInput}
                  onChange={(e) => setReturnedInput(e.target.value)}
                  required
                />
              </div>

              {/* Dynamic Balance Calculation */}
              <div className="p-4 rounded-2xl bg-elevated border border-subtle text-xs font-mono space-y-1">
                <div className="flex justify-between text-secondary">
                  <span>Released:</span>
                  <span>{formatMoney(selectedAdvance.amount_released_centavos, selectedAdvance.currency)}</span>
                </div>
                <div className="flex justify-between text-secondary">
                  <span>Spent:</span>
                  <span>-{formatMoney(Math.round((parseFloat(spentInput) || 0) * 100), selectedAdvance.currency)}</span>
                </div>
                <div className="flex justify-between text-secondary">
                  <span>Returned:</span>
                  <span>-{formatMoney(Math.round((parseFloat(returnedInput) || 0) * 100), selectedAdvance.currency)}</span>
                </div>
                <div className="flex justify-between border-t border-subtle pt-1 font-semibold">
                  <span className="text-primary">Unreconciled Discrepancy:</span>
                  <span
                    className={
                      Math.round(
                        selectedAdvance.amount_released_centavos -
                          (parseFloat(spentInput) || 0) * 100 -
                          (parseFloat(returnedInput) || 0) * 100
                      ) === 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }
                  >
                    {formatMoney(
                      selectedAdvance.amount_released_centavos -
                        Math.round((parseFloat(spentInput) || 0) * 100) -
                        Math.round((parseFloat(returnedInput) || 0) * 100),
                      selectedAdvance.currency
                    )}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Reconciliation Notes &amp; Itemization
                </label>
                <textarea
                  value={reconciliationNotes}
                  onChange={(e) => setReconciliationNotes(e.target.value)}
                  placeholder="Summary of receipts attached and explanation for any discrepancy…"
                  rows={3}
                  className="w-full rounded-2xl bg-elevated border border-subtle p-3.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-subtle">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSubmitLiquidationModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={submitLiquidationMutation.isPending}
                >
                  {submitLiquidationMutation.isPending ? "Submitting…" : "Submit Liquidation"}
                </Button>
              </div>
            </form>
          </>
        )}
      </Modal>

      {/* MODAL 3: EDIT CASH ADVANCE */}
      <Modal
        isOpen={Boolean(showEditAdvanceModal && advanceToEdit)}
        onClose={() => {
          setShowEditAdvanceModal(false);
          setAdvanceToEdit(null);
        }}
        maxWidth="lg"
      >
        {advanceToEdit && (
          <>
            <button
              onClick={() => {
                setShowEditAdvanceModal(false);
                setAdvanceToEdit(null);
              }}
              className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Badge >
                Modify Advance
              </Badge>
            </div>
            <h2 className="text-primary mb-1 section-title">
              Edit Cash Advance Description
            </h2>
            <p className="text-xs text-secondary mb-6">
              Update advance details, disbursement info, or linked budget allocation.
            </p>

            {actionError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <p>{actionError}</p>
              </div>
            )}

            <form onSubmit={handleEditAdvanceSubmit} className="space-y-4">
              <Input
                label="Initiative / Advance Title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
              />

              <Input
                label="Stated Purpose"
                value={editPurpose}
                onChange={(e) => setEditPurpose(e.target.value)}
                required
              />

              <p className="text-xs text-zinc-400">Disbursement details are locked after funds are released.</p>

              <FormDraftControls draft={editDraft} busy={updateAdvanceMutation.isPending} />

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-subtle">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEditAdvanceModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={updateAdvanceMutation.isPending || !editTitle.trim() || !editPurpose.trim()}
                >
                  {updateAdvanceMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          </>
        )}
      </Modal>


      {/* MODAL 5: CANCEL LIQUIDATION DRAFT */}
      <Modal
        isOpen={Boolean(showCancelLiquidationModal && liquidationToCancel)}
        onClose={() => {
          setShowCancelLiquidationModal(false);
          setLiquidationToCancel(null);
        }}
        maxWidth="md"
        className="space-y-5"
      >
        {liquidationToCancel && (
          <>
            <button
              onClick={() => {
                setShowCancelLiquidationModal(false);
                setLiquidationToCancel(null);
              }}
              className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
                Withdraw Liquidation Draft?
              </h3>
              <p className="text-xs text-secondary mt-2 leading-relaxed">
                Withdrawing this submitted liquidation for "{liquidationToCancel.advanceTitle}" will return the advance back to <strong className="text-amber-700 dark:text-amber-400">outstanding</strong> status so you can adjust figures or re-submit receipts.
              </p>
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
                onClick={() => setShowCancelLiquidationModal(false)}
                className="flex-1"
              >
                Keep Under Review
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => cancelLiquidationMutation.mutate()}
                isLoading={cancelLiquidationMutation.isPending}
                className="flex-1"
              >
                Withdraw Draft
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
