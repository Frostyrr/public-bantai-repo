import FormDraftControls from "../../components/ui/FormDraftControls";
import {
  useFormDraft,
  unavailableDraftSelection,
} from "../../hooks/useFormDraft";
import useFinancialQuery from "../../hooks/useFinancialQuery";
import { useSpaceRouteFilter } from "../../hooks/useSpaceRouteFilter";
import { formatCategoryLabel } from "../../utils/formatCategoryLabel";
import AnimatedNumber from "../../components/ui/AnimatedNumber";
import CompactAmount from "../../components/ui/CompactAmount";
import Badge from "../../components/ui/Badge";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import RecordActions from "../../components/org/shared/RecordActions";
import ExpenseDetailsModal from "../../components/org/expenses/ExpenseDetailsModal";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
  InspectorSection,
} from "../../components/ui/DetailInspector";
import { useInspectorSelection } from "../../hooks/useInspectorSelection";
import { toast } from "../../lib/toast";
import ReceiptPreview from "../../components/org/expenses/ReceiptPreview";
import { encodeReceipt } from "../../utils/encodeFile";
import WizardDialog from "../../components/ui/WizardDialog";
import { parseDuesAmount } from "../../utils/duesAssignment";
import ExpenseReviewInfo from "../../components/org/expenses/ExpenseReviewInfo";
import { financialKey } from "../../utils/queryKeys";
import FinancialQueryState from "../../components/layout/FinancialQueryState";
import {
  canReviewExpense,
  canVerifyExpense,
  canApproveExpense,
} from "../../utils/financialWorkflow";
import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useRef,
} from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  X,
  ShieldCheck,
  AlertTriangle,
  Upload,
  FileText,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import DatePicker from "../../components/ui/DatePicker";
import Modal from "../../components/ui/Modal";
import Pagination from "../../components/ui/Pagination";
import {
  submitExpense,
  updateExpense,
  deleteExpense,
  reviewExpense,
  getSpaces,
  getReportingPeriods,
  type Expense,
  type OrganizationDetails,
  type Membership,
} from "../../lib/api";
import { getExpense } from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";

interface ContextType {
  financialScope?: { userId: string };
  activePeriodId: string;
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

const CATEGORIES: Array<{ key: Expense["category"]; label: string }> = [
  { key: "operational", label: "Operational" },
  { key: "supplies", label: "Supplies & Materials" },
  { key: "events", label: "Events & Logistics" },
  { key: "travel", label: "Travel & Transport" },
  { key: "food", label: "Food & Catering" },
  { key: "equipment", label: "Equipment & Rentals" },
  { key: "services", label: "Professional Services" },
  { key: "other", label: "Other Expenditures" },
];
const receiptFileKeys = new WeakMap<File, string>();

export default function OrgExpenses() {
  const [requestedSpace, setFilterSpace] = useSpaceRouteFilter();
  const location = useLocation();
  const navigate = useNavigate();
  const { organization, membership, activePeriodId } =
    useOutletContext<ContextType>();
  const canOpenExpenseForm =
    ["owner", "organization_admin", "treasurer"].includes(membership.role) ||
    (["member", "student"].includes(membership.role) &&
      membership.can_submit_expenses === true);
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const filterSpace = requestedSpace || "all";
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [previousSpace, setPreviousSpace] = useState(filterSpace);
  if (previousSpace !== filterSpace) {
    setPreviousSpace(filterSpace);
    setCurrentPage(1);
  }
  const [pageSize, setPageSize] = useState(10);
  const [dateTouched, setDateTouched] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();
  const [reattachReceipts, setReattachReceipts] = useState(false);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [receiptOrganization, setReceiptOrganization] = useState(
    organization.id,
  );
  if (receiptOrganization !== organization.id) {
    setReceiptOrganization(organization.id);
    setReceiptFiles([]);
  }
  const encodingReceipts = useRef(false);
  const [preparingReceipts, setPreparingReceipts] = useState(false);
  const addReceiptFiles = (files: FileList | null) => {
    if (!files || encodingReceipts.current || submitMutation.isPending) return;
    const selected = Array.from(files);
    if (
      receiptFiles.length + selected.length > 3 ||
      selected.some(
        (file) =>
          file.size < 12 ||
          file.size > 1048576 ||
          file.name.length > 150 ||
          ![
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
          ].includes(file.type),
      )
    ) {
      setActionError(
        "Choose up to three JPEG, PNG, WebP, or PDF files, each up to 1 MB.",
      );
      return;
    }
    setActionError("");
    selected.forEach((file) => receiptFileKeys.set(file, crypto.randomUUID()));
    setReceiptFiles([...receiptFiles, ...selected]);
    setReattachReceipts(false);
  };
  const submissionRequest = useRef<{ draft: string; id: string } | null>(null);
  const [expenseStep, setExpenseStep] = useState(1);
  const [additionalDetails, setAdditionalDetails] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionError, setActionError] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<Expense | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  // Submit Expense Form
  const [title, setTitle] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [category, setCategory] = useState<Expense["category"]>("supplies");
  const [incurredDate, setIncurredDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [vendorName, setVendorName] = useState("");

  const isOfficer =
    membership?.role === "owner" ||
    membership?.role === "organization_admin" ||
    membership?.role === "treasurer" ||
    membership?.role === "auditor";

  // Data Queries
  const expensesQuery = useFinancialQuery("expenses", organization.id, {
    periodId: activePeriodId,
    status: selectedStatus,
  });
  const budgetsQuery = useFinancialQuery("budgets", organization.id);

  const spacesQuery = useQuery({
    queryKey: ["organization-spaces", organization.id],
    queryFn: () => getSpaces(organization.id),
    enabled: Boolean(organization.id),
  });

  const periodsQuery = useQuery({
    queryKey: ["organization-periods", organization.id],
    queryFn: () => getReportingPeriods(organization.id),
    enabled: Boolean(organization.id),
  });

  // Mutations
  const eligibleBudgets = (budgetsQuery.data ?? []).filter(
    (budget) =>
      budget.status === "active" &&
      !budget.archived_at &&
      (!spaceId || !budget.space_id || budget.space_id === spaceId) &&
      (!periodId ||
        !budget.reporting_period_id ||
        budget.reporting_period_id === periodId),
  );
  const selectedBudget = eligibleBudgets.find(
    (budget) => budget.id === budgetId,
  );
  const budgetRemaining = selectedBudget?.remaining_centavos;
  const expenseCents = parseDuesAmount(amountInput);

  const expenseVersion = (row: Expense) =>
    JSON.stringify([
      row.review_revision,
      row.status,
      row.title,
      row.amount_centavos,
      row.category,
      row.incurred_date,
      row.description,
      row.budget_id,
      row.space_id,
      row.reporting_period_id,
      row.vendor_name,
    ]);
  const hadReceipts = reattachReceipts || receiptFiles.length > 0;
  const draft = useFormDraft({
    orgId: organization.id,
    form: "expense",
    open: showSubmitModal,
    recordId: expenseToEdit?.id,
    version: expenseToEdit ? expenseVersion(expenseToEdit) : "",
    values: {
      title,
      amountInput,
      category,
      incurredDate,
      description,
      budgetId,
      spaceId,
      periodId,
      vendorName,
      hadReceipts,
    },
    verifyEdit: async (id, signal) => {
      const row = await getExpense(organization.id, id, signal);
      if (
        row.submitted_by !== membership.profile_id ||
        !["pending", "verified", "rejected"].includes(row.status)
      )
        throw Error("This expense can no longer be edited.");
      return {
        version: expenseVersion(row),
        values: {
          title: row.title,
          amountInput: (row.amount_centavos / 100).toFixed(2),
          category: row.category,
          incurredDate: row.incurred_date,
          description: row.description || "",
          budgetId: row.budget_id || "",
          spaceId: row.space_id || "",
          periodId: row.reporting_period_id || "",
          vendorName: row.vendor_name || "",
          hadReceipts: false,
        },
        adopt: () => {
          setExpenseToEdit(row);
          setReceiptUrl(row.receipt_url || "");
        },
      };
    },
    restore: (v) => {
      setTitle(v.title);
      setAmountInput(v.amountInput);
      setCategory(v.category);
      setIncurredDate(v.incurredDate);
      setDescription(v.description);
      setBudgetId(v.budgetId);
      setSpaceId(v.spaceId);
      setPeriodId(v.periodId);
      setVendorName(v.vendorName);
      setReattachReceipts(v.hadReceipts);
      setReceiptFiles([]);
      setExpenseStep(1);
    },
  });

  const submitMutation = useMutation({
    mutationFn: (payload: {
      requestId?: string;
      receiptExtractions?: { extractionId: string; appliedFields: string[] }[];
      files?: { name: string; mime: string; data: string }[];
      title: string;
      amountCentavos: number;
      category: Expense["category"];
      incurredDate: string;
      description?: string;
      budgetId?: string;
      spaceId?: string;
      periodId?: string;
      receiptUrl?: string;
      vendorName?: string;
    }) =>
      submitExpense(
        organization.id,
        payload,
        payload.files?.length
          ? ({ progress }) => {
              if (progress !== undefined)
                setUploadProgress(Math.round(progress * 100));
            }
          : undefined,
      ),
    onMutate: draft.submission,
    onSuccess: async (_result, _variables, ticket) => {
      draft.complete(ticket);
      toast.success("Expense submitted");
      void Promise.all([
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["financial-summary", organization.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["financial-insights", organization.id],
          }),
        ]),
        queryClient.invalidateQueries({
          queryKey: financialKey("expenses", organization.id, {}),
        }),
      ]);
      setShowSubmitModal(false);
      resetForm();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (payload: {
      expenseId: string;
      expectedRevision: number;
      decision: "verified" | "approved" | "rejected";
      notes?: string;
    }) =>
      reviewExpense(organization.id, payload.expenseId, {
        decision: payload.decision,
        expectedRevision: payload.expectedRevision,
        notes: payload.notes,
      }),
    onSuccess: async (_result, action) => {
      toast.success(
        action.decision === "approved"
          ? "Approval recorded"
          : action.decision === "rejected"
            ? "Expense rejected"
            : "Expense verified",
      );
      void Promise.all([
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["financial-summary", organization.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["financial-insights", organization.id],
          }),
        ]),
        queryClient.invalidateQueries({
          queryKey: financialKey("expenses", organization.id, {}),
        }),
        queryClient.invalidateQueries({
          queryKey: financialKey("budgets", organization.id, {}),
        }),
      ]);
      setShowReviewModal(false);
      setSelectedExpense(null);
      setReviewNotes("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      amountCentavos: number;
      category: Expense["category"];
      incurredDate: string;
      description?: string;
      budgetId?: string;
      spaceId?: string;
      periodId?: string;
      receiptUrl?: string;
      vendorName?: string;
    }) => {
      if (!expenseToEdit) throw new Error("No expense selected for edit");
      return updateExpense(organization.id, expenseToEdit.id, payload);
    },
    onMutate: draft.submission,
    onSuccess: async (_result, _variables, ticket) => {
      draft.complete(ticket);
      void Promise.all([
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["financial-summary", organization.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["financial-insights", organization.id],
          }),
        ]),
        queryClient.invalidateQueries({
          queryKey: financialKey("expenses", organization.id, {}),
        }),
        queryClient.invalidateQueries({
          queryKey: financialKey("budgets", organization.id, {}),
        }),
      ]);
      toast.success("Expense resubmitted for review");
      setShowSubmitModal(false);
      setExpenseToEdit(null);
      resetForm();
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!expenseToDelete) throw new Error("No expense selected for deletion");
      return deleteExpense(organization.id, expenseToDelete.id);
    },
    onSuccess: async () => {
      void Promise.all([
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["financial-summary", organization.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["financial-insights", organization.id],
          }),
        ]),
        queryClient.invalidateQueries({
          queryKey: financialKey("expenses", organization.id, {}),
        }),
        queryClient.invalidateQueries({
          queryKey: financialKey("budgets", organization.id, {}),
        }),
      ]);
      setShowDeleteModal(false);
      setExpenseToDelete(null);
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const openEditModal = (exp: Expense) => {
    resetForm();
    setExpenseToEdit(exp);
    setTitle(exp.title);
    setAmountInput((exp.amount_centavos / 100).toFixed(2));
    setCategory(exp.category);
    setIncurredDate(exp.incurred_date);
    setDescription(exp.description || "");
    setBudgetId(exp.budget_id || "");
    setSpaceId(exp.space_id || "");
    setPeriodId(exp.reporting_period_id || "");
    setReceiptUrl(exp.receipt_url || "");
    setVendorName(exp.vendor_name || "");
    setActionError("");
    setShowSubmitModal(true);
  };

  const openDeleteModal = (exp: Expense) => {
    setExpenseToDelete(exp);
    setActionError("");
    setShowDeleteModal(true);
  };

  const resetForm = () => {
    setExpenseToEdit(null);
    setReceiptFiles([]);
    setReattachReceipts(false);
    setDateTouched(false);
    submissionRequest.current = null;
    setExpenseStep(1);
    setAdditionalDetails(false);
    setTitle("");
    setAmountInput("");
    setCategory("supplies");
    setIncurredDate(new Date().toISOString().slice(0, 10));
    setDescription("");
    setBudgetId("");
    setSpaceId(
      (spacesQuery.data ?? []).find(
        (space) => space.id === requestedSpace && space.status === "active",
      )?.id ?? "",
    );
    setPeriodId("");
    setReceiptUrl("");
    setVendorName("");
    setActionError("");
  };

  const openNewExpense = () => {
    if (!canOpenExpenseForm || showSubmitModal || submitMutation.isPending)
      return;
    resetForm();
    setPeriodId(activePeriodId === "all" ? "" : activePeriodId);
    setShowSubmitModal(true);
  };
  const openRoutedForm = useEffectEvent(openNewExpense);
  useEffect(() => {
    if (
      import.meta.env.VITE_BANI_SMART_NAVIGATION !== "true" ||
      location.state?.baniForm !== "new_expense"
    )
      return;
    const frame = requestAnimationFrame(() => {
      openRoutedForm();
      void navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: null },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [location, navigate]);

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      draft.enabled &&
      (draft.blocked ||
        unavailableDraftSelection(spaceId, spacesQuery.data) ||
        unavailableDraftSelection(periodId, periodsQuery.data))
    ) {
      setActionError(
        "Review the draft and choose an available space and reporting period.",
      );
      return;
    }
    if (
      submitMutation.isPending ||
      updateMutation.isPending ||
      encodingReceipts.current
    )
      return;
    const cents = parseDuesAmount(amountInput);
    if (!incurredDate) {
      setDateTouched(true);
      document.getElementById("expense-incurred-date")?.focus();
      return;
    }
    if (title.trim().length < 2 || title.trim().length > 150 || !cents) {
      setActionError(
        "Enter an expense title, a positive amount with up to two decimal places, and the incurred date.",
      );
      return;
    }
    if (description.trim().length > 1000) {
      setAdditionalDetails(true);
      setActionError("Keep the expense notes within 1,000 characters.");
      return;
    }
    if (budgetId && !selectedBudget) {
      setActionError(
        "Choose an active budget for this space and period, or clear the budget selection.",
      );
      return;
    }
    setActionError("");
    if (expenseStep === 1) {
      setExpenseStep(2);
      return;
    }

    const payload = {
      title: title.trim(),
      amountCentavos: cents,
      category,
      incurredDate,
      description: description.trim() || undefined,
      budgetId: budgetId || undefined,
      spaceId: spaceId || undefined,
      periodId: periodId || undefined,
      receiptUrl: receiptUrl.trim() || undefined,
      vendorName: vendorName.trim() || undefined,
    };
    if (expenseToEdit) {
      updateMutation.mutate(payload);
      return;
    }
    encodingReceipts.current = true;
    setPreparingReceipts(true);
    try {
      const files = await Promise.all(receiptFiles.map(encodeReceipt));
      const draft = JSON.stringify({ ...payload, files });
      if (submissionRequest.current?.draft !== draft)
        submissionRequest.current = { draft, id: crypto.randomUUID() };
      await submitMutation.mutateAsync({
        ...payload,
        files,
        requestId: submissionRequest.current.id,
      });
    } catch (error) {
      setActionError(formatErrorMessage(error));
      toast.error("Could not submit expense", {
        id: "expense-submission-error",
        duration: 7000,
        description: "Review your expense and receipts, then try again.",
      });
    } finally {
      encodingReceipts.current = false;
      setPreparingReceipts(false);
      setUploadProgress(undefined);
    }
  };

  const handleReviewAction = (
    decision: "verified" | "approved" | "rejected",
  ) => {
    if (!selectedExpense) return;
    reviewMutation.mutate({
      expenseId: selectedExpense.id,
      expectedRevision: selectedExpense.review_revision ?? 1,
      decision,
      notes: reviewNotes.trim() || undefined,
    });
  };

  const expenses = expensesQuery.data ?? [];

  const filteredExpenses = expenses.filter((e) => {
    if (e.archived_at || (filterSpace !== "all" && e.space_id !== filterSpace))
      return false;
    const matchesSearch =
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.vendor_name &&
        e.vendor_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.description &&
        e.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCat =
      selectedCategory === "all" || e.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const paginatedExpenses = filteredExpenses.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const getExpenseId = useCallback((e: Expense) => e.id, []);
  const {
    selectedItem: viewExpense,
    selectItem: setViewExpense,
    close: closeExpenseInspector,
    navigate: navigateExpense,
  } = useInspectorSelection(filteredExpenses, getExpenseId);

  const totalApprovedCentavos = expenses
    .filter((e) => e.status === "approved")
    .reduce((sum, e) => sum + e.amount_centavos, 0);

  const pendingReviewCount = expenses.filter(
    (e) => e.status === "pending" || e.status === "verified",
  ).length;

  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <div
        data-tour="expenses-header"
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6"
      >
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="context" className="page-header-eyebrow">
              Expenses
            </Badge>
          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">Expenses</span>
          </h1>
          <p className="page-subtitle">
            Record expenses with receipts and categories. Approvals are
            automatically checked against your budgets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-tour="expenses-create"
            variant="primary"
            size="sm"
            disabled={!canOpenExpenseForm}
            onClick={openNewExpense}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Submit Expense
          </Button>
        </div>
      </div>

      {expensesQuery.data === undefined ? (
        <FinancialQueryState
          queries={[expensesQuery]}
          variant="table"
          kpiCount={3}
        />
      ) : (
        <>
          {/* Aggregate Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
              <div className="flex items-center justify-between text-secondary mb-2">
                <span className="field-label">Approved Expenses</span>
                <CheckCircle2 className="w-4 h-4 text-muted" />
              </div>
              <p className="metric-value text-primary">
                <CompactAmount
                  centavos={totalApprovedCentavos}
                  currency={organization.currency}
                  animate
                />
              </p>
              <p className="text-xs text-secondary mt-1">
                Authorized disbursements
              </p>
            </div>

            <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
              <div className="flex items-center justify-between text-secondary mb-2">
                <span className="field-label">Pending Review</span>
                <ShieldCheck className="w-4 h-4 text-muted" />
              </div>
              <p className="metric-value text-primary">
                <AnimatedNumber value={pendingReviewCount} />
              </p>
              <p className="text-xs text-secondary mt-1">
                Awaiting verification or approval
              </p>
            </div>

            <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
              <div className="flex items-center justify-between text-secondary mb-2">
                <span className="field-label">Total Claims</span>
                <CreditCard className="w-4 h-4 text-secondary" />
              </div>
              <p className="metric-value text-primary">
                <AnimatedNumber value={expenses.length} />
              </p>
              <p className="text-xs text-secondary mt-1">
                Submitted in this organization
              </p>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div data-tour="expenses-filters" className="filter-toolbar">
            <div className="toolbar-search relative flex-1">
              <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by title, vendor, or notes…"
                className="w-full bg-elevated border border-subtle rounded-full pl-10 pr-4 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors"
              />
            </div>

            <div className="flex items-center gap-3">
              <Select
                ariaLabel="Project"
                value={filterSpace}
                onChange={(event) => {
                  setFilterSpace(event.target.value);
                  setCurrentPage(1);
                }}
                variant="pill"
                selectSize="sm"
                menuWidth="auto"
                options={[
                  { value: "all", label: "All Projects" },
                  ...(spacesQuery.data ?? []).map((space) => ({
                    value: space.id,
                    label: space.name,
                  })),
                ]}
              />
              <Select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setCurrentPage(1);
                }}
                variant="pill"
                selectSize="sm"
                icon={<Filter className="w-3.5 h-3.5 text-zinc-400" />}
                menuWidth="auto"
                options={[
                  { value: "all", label: "All Categories" },
                  ...CATEGORIES.map((c) => ({
                    value: c.key,
                    label: formatCategoryLabel(c.key),
                  })),
                ]}
              />

              <Select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  setCurrentPage(1);
                }}
                variant="pill"
                selectSize="sm"
                menuWidth="auto"
                options={[
                  { value: "all", label: "All Statuses" },
                  { value: "pending", label: "Pending" },
                  { value: "verified", label: "Verified" },
                  { value: "approved", label: "Approved" },
                  { value: "rejected", label: "Rejected" },
                ]}
              />
            </div>
          </div>

          {/* Error State */}

          {expensesQuery.error && (
            <div
              role="alert"
              className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-sm"
            >
              <p>{formatErrorMessage(expensesQuery.error)}</p>
            </div>
          )}

          {/* Empty State */}
          {expensesQuery.isSuccess && filteredExpenses.length === 0 && (
            <ModuleEmptyState>
              <div className="w-12 h-12 rounded-2xl bg-elevated border border-subtle flex items-center justify-center mb-4 text-secondary">
                <CreditCard className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-heading font-medium text-primary mb-2 tracking-tight">
                No expenses recorded
              </h3>
              <p className="text-secondary text-xs sm:text-sm max-w-md mb-6 leading-relaxed">
                Submit expenses with receipts, associate them with authorized
                budgets, and follow two-officer approval procedures.
              </p>
              <Button
                variant="primary"
                size="sm"
                disabled={!canOpenExpenseForm}
                onClick={openNewExpense}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                Submit First Expense
              </Button>
            </ModuleEmptyState>
          )}

          <ExpenseDetailsModal
            expense={showReviewModal ? null : viewExpense}
            onClose={closeExpenseInspector}
            onNavigate={navigateExpense}
          />

          {/* Expenses Table */}
          {filteredExpenses.length > 0 && (
            <div className="table-specular rounded-xl bg-surface border border-subtle overflow-hidden shadow-xs dark:shadow-none">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-subtle bg-elevated text-[11px] font-mono uppercase tracking-wider text-muted">
                      <th className="py-4 px-6">Expense Title</th>
                      <th className="py-4 px-6">Category</th>
                      <th className="py-4 px-6 text-right">Amount</th>
                      <th className="py-4 px-6">Date</th>
                      <th className="py-4 px-6">Budget Allocation</th>
                      <th className="py-4 px-6 text-center">Status</th>
                      <th className="py-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                    {paginatedExpenses.map((exp) => {
                      const isSelected =
                        (showReviewModal && selectedExpense?.id === exp.id) ||
                        (!showReviewModal && viewExpense?.id === exp.id);
                      return (
                        <tr
                          key={exp.id}
                          tabIndex={0}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("button, a"))
                              return;
                            setShowReviewModal(false);
                            setViewExpense(exp);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setShowReviewModal(false);
                              setViewExpense(exp);
                            }
                          }}
                          className={`transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/30 ${
                            isSelected
                              ? "bg-selected-surface"
                              : "hover:bg-elevated/60"
                          }`}
                        >
                          <td className="py-4 px-6">
                            <div className="font-medium text-primary">
                              {exp.title}
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <Badge variant="neutral" className="capitalize">
                              {formatCategoryLabel(exp.category)}
                            </Badge>
                          </td>
                          <td className="py-4 px-6 text-right font-mono font-medium text-primary">
                            {formatMoney(exp.amount_centavos, exp.currency)}
                          </td>
                          <td className="py-4 px-6 text-xs text-secondary font-mono">
                            {exp.incurred_date}
                          </td>
                          <td className="py-4 px-6 text-xs">
                            {exp.budgets ? (
                              <span className="font-mono text-secondary">
                                {exp.budgets.name}
                              </span>
                            ) : (
                              <span className="text-muted font-mono">
                                Unallocated
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-6 text-center">
                            <Badge>{exp.status.toUpperCase()}</Badge>
                          </td>
                          <td className="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                            <RecordActions
                              title={exp.title}
                              onView={() => setViewExpense(exp)}
                              onEdit={
                                exp.submitted_by === membership.profile_id &&
                                ["pending", "verified", "rejected"].includes(
                                  exp.status,
                                )
                                  ? () => openEditModal(exp)
                                  : undefined
                              }
                              archive={
                                [
                                  "owner",
                                  "organization_admin",
                                  "treasurer",
                                ].includes(membership.role) &&
                                !["pending", "verified"].includes(exp.status)
                                  ? {
                                      org: organization.id,
                                      id: exp.id,
                                      kind: "expense",
                                      archived: false,
                                    }
                                  : undefined
                              }
                              onDelete={
                                ((isOfficer && membership.role !== "auditor") ||
                                  exp.submitted_by === membership.profile_id) &&
                                ["pending", "cancelled"].includes(exp.status) &&
                                (exp.review_revision ?? 1) === 1 &&
                                !exp.approval_decisions?.length
                                  ? () => openDeleteModal(exp)
                                  : undefined
                              }
                              extra={
                                canReviewExpense(
                                  exp,
                                  membership.profile_id,
                                  membership.role,
                                )
                                  ? {
                                      label: "Review",
                                      onClick: () => {
                                        closeExpenseInspector();
                                        setSelectedExpense(exp);
                                        setReviewNotes("");
                                        setActionError("");
                                        setShowReviewModal(true);
                                      },
                                    }
                                  : undefined
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pagination
                currentPage={currentPage}
                totalItems={filteredExpenses.length}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                pageSizeOptions={[10, 25, 50]}
                onPageSizeChange={setPageSize}
                itemLabel="expenses"
              />
            </div>
          )}
        </>
      )}

      {/* MODAL 1: SUBMIT EXPENSE */}
      <WizardDialog
        isOpen={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        title={expenseToEdit ? "Revise Expense" : "Submit Expense"}
        steps={["Expense Details", "Evidence & Review"]}
        step={expenseStep}
        formId="submit-expense-form"
        onSubmit={handleSubmitExpense}
        busy={
          submitMutation.isPending ||
          updateMutation.isPending ||
          preparingReceipts
        }
        footer={
          <>
            <Button
              variant="outline"
              disabled={
                submitMutation.isPending ||
                updateMutation.isPending ||
                preparingReceipts
              }
              onClick={() => {
                setActionError("");
                if (expenseStep === 1) setShowSubmitModal(false);
                else setExpenseStep(1);
              }}
            >
              {expenseStep === 1 ? "Cancel" : "Back"}
            </Button>
            <Button
              type="submit"
              form="submit-expense-form"
              isLoading={
                submitMutation.isPending ||
                updateMutation.isPending ||
                preparingReceipts
              }
            >
              {expenseStep === 1
                ? "Next"
                : expenseToEdit
                  ? "Resubmit for Review"
                  : "Submit for Review"}
            </Button>
          </>
        }
      >
        {reattachReceipts && !receiptFiles.length && (
          <p role="status" className="text-xs text-secondary">
            Reattach any receipt files you selected before closing the form.
          </p>
        )}
        <fieldset
          disabled={
            submitMutation.isPending ||
            updateMutation.isPending ||
            preparingReceipts
          }
          className="min-w-0 space-y-4"
        >
          {expenseToEdit?.status === "rejected" &&
            expenseToEdit.review_notes && (
              <p className="text-sm text-secondary">
                Rejection reason: {expenseToEdit.review_notes}
              </p>
            )}
          {actionError && (
            <p
              role="alert"
              className="rounded-xl border border-rose-500/20 p-3 text-sm text-rose-700 dark:text-rose-300"
            >
              {actionError}
            </p>
          )}
          {expenseStep === 1 ? (
            <>
              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary">
                    Receipt Quick-Fill (Optional)
                  </h4>
                  {receiptFiles.length > 0 && (
                    <span className="text-xs text-muted">
                      {receiptFiles.length}/3 attached
                    </span>
                  )}
                </div>
                {expenseToEdit ? (
                  <p className="rounded-xl border border-subtle bg-elevated px-3 py-2.5 text-sm text-secondary">
                    Existing receipt files remain attached.
                  </p>
                ) : (
                  <>
                    <label
                      htmlFor="expense-receipts"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        addReceiptFiles(event.dataTransfer.files);
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-strong bg-elevated/40 px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-elevated/80"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-subtle bg-surface text-secondary">
                        <Upload size={17} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-primary">
                          Drop receipt or invoice, or click to browse
                        </span>
                        <span className="block text-xs text-secondary">
                          Up to 3 files, 1 MB each · JPG, PNG, WebP
                          (AI-readable), or PDF
                        </span>
                      </span>
                      <input
                        id="expense-receipts"
                        className="sr-only"
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) => {
                          addReceiptFiles(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>

                    {receiptFiles.map((file) => {
                      const removeFile = () => {
                        setReceiptFiles((existing) =>
                          existing.filter((item) => item !== file),
                        );
                      };
                      return (
                        <div
                          key={`${organization.id}:${receiptFileKeys.get(file)}`}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-subtle bg-elevated/70 p-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-subtle bg-surface text-secondary">
                              {file.type.startsWith("image/") ? (
                                <ReceiptPreview file={file} name={file.name} />
                              ) : (
                                <FileText size={16} aria-hidden="true" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p
                                className="truncate text-sm font-medium text-primary"
                                title={file.name}
                              >
                                {file.name}
                              </p>
                              <p className="text-xs text-secondary">
                                {(file.size / 1024).toFixed(0)} KB · Attached
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={removeFile}
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </>
                )}

                {preparingReceipts && (
                  <div className="space-y-1 text-xs text-secondary">
                    <p role="status">
                      {!submitMutation.isPending
                        ? "Preparing submission…"
                        : uploadProgress === 100 || !receiptFiles.length
                          ? "Saving expense…"
                          : "Uploading receipts…"}
                    </p>
                    {submitMutation.isPending &&
                      receiptFiles.length > 0 &&
                      uploadProgress !== 100 && (
                        <progress
                          aria-label="Receipt upload progress"
                          max={100}
                          value={uploadProgress}
                          className="w-full"
                        />
                      )}
                  </div>
                )}
              </section>

              <div className="border-t border-subtle pt-4 space-y-4">
                <p className="text-sm text-zinc-400">
                  Record a purchase and submit it for review.
                </p>
                <Input
                  label="Expense Title"
                  validationMessage={
                    title.trim().length < 2 || title.trim().length > 150
                      ? "Enter an expense title of 2–150 characters."
                      : undefined
                  }
                  placeholder="e.g. Sound equipment rental"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label={`Amount (${organization.currency})`}
                    validationMessage={
                      !expenseCents
                        ? "Enter a positive amount with up to two decimal places."
                        : undefined
                    }
                    inputMode="decimal"
                    placeholder="2500.00"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    required
                  />

                  <DatePicker
                    id="expense-incurred-date"
                    label="Date Incurred"
                    error={
                      dateTouched && !incurredDate
                        ? "Select the date this expense occurred."
                        : undefined
                    }
                    value={incurredDate}
                    onChange={setIncurredDate}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Category"
                    required
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as Expense["category"])
                    }
                    options={CATEGORIES.map((c) => ({
                      value: c.key,
                      label: formatCategoryLabel(c.key),
                    }))}
                  />

                  <Input
                    label="Vendor / Payee (Optional)"
                    placeholder="e.g. Ace Hardware"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Select
                    label="Charge to Budget (Optional but Recommended)"
                    value={budgetId}
                    disabled={budgetsQuery.isPending || budgetsQuery.isError}
                    onChange={(e) => setBudgetId(e.target.value)}
                    placeholder="Select a budget (optional)"
                    options={[
                      { value: "", label: "No budget / Unallocated" },
                      ...eligibleBudgets.map((b) => ({
                        value: b.id,
                        label: `${b.name} (Remaining: ${formatMoney(b.remaining_centavos ?? b.allocated_amount_centavos, b.currency)})`,
                      })),
                    ]}
                  />
                  <p className="text-xs text-zinc-400">
                    {budgetsQuery.isPending
                      ? "Loading budgets…"
                      : budgetsQuery.isError
                        ? "Budgets could not be loaded. You can still submit an unallocated expense."
                        : "Select the budget that will cover this expense, if applicable."}
                  </p>
                  {selectedBudget &&
                    budgetRemaining !== undefined &&
                    expenseCents !== null && (
                      <div className="space-y-1 text-xs text-zinc-400 pt-1">
                        <p>
                          Available budget ·{" "}
                          {formatMoney(
                            budgetRemaining,
                            selectedBudget.currency,
                          )}
                        </p>
                        <p className="text-secondary">
                          Estimated remaining ·{" "}
                          {formatMoney(
                            budgetRemaining - expenseCents,
                            selectedBudget.currency,
                          )}
                        </p>
                        {expenseCents > budgetRemaining && (
                          <p
                            role="status"
                            className="text-amber-700 dark:text-amber-400"
                          >
                            This expense exceeds the available budget. Existing
                            approval rules still apply.
                          </p>
                        )}
                      </div>
                    )}
                </div>

                <details
                  open={additionalDetails}
                  onToggle={(event) =>
                    setAdditionalDetails(event.currentTarget.open)
                  }
                  className="space-y-4 border-t border-subtle pt-3"
                >
                  <summary className="cursor-pointer text-sm font-medium text-primary">
                    Additional Details
                  </summary>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="Project (Optional)"
                      value={spaceId}
                      onChange={(e) => setSpaceId(e.target.value)}
                      placeholder="No Project (General Org)"
                      options={[
                        { value: "", label: "No Project (General Org)" },
                        ...(spacesQuery.data ?? [])
                          .filter(
                            (s) => s.status === "active" || s.id === spaceId,
                          )
                          .map((s) => ({ value: s.id, label: s.name })),
                      ]}
                    />

                    <Select
                      label="Reporting Period (Optional)"
                      value={periodId}
                      onChange={(e) => setPeriodId(e.target.value)}
                      placeholder="No Period (General)"
                      options={[
                        { value: "", label: "No Period (General)" },
                        ...(periodsQuery.data ?? []).map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1.5">
                      Notes / Description (Optional)
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Additional context or justification for this purchase…"
                      rows={2}
                      className="w-full rounded-2xl bg-elevated border border-subtle p-3.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong"
                    />
                  </div>
                </details>
              </div>
            </>
          ) : (
            <>
              <section className="space-y-4 rounded-2xl border border-subtle bg-elevated p-4">
                <div className="flex items-start justify-between gap-4 border-b border-subtle pb-3">
                  <div className="min-w-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                      Expense Summary
                    </span>
                    <h4 className="mt-0.5 break-words text-base font-semibold text-primary">
                      {title}
                    </h4>
                  </div>
                  <p className="shrink-0 text-lg font-semibold tabular-nums text-primary">
                    {formatMoney(
                      expenseCents ?? 0,
                      organization.currency ?? "PHP",
                    )}
                  </p>
                </div>

                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-secondary">Category</dt>
                    <dd className="font-medium text-primary">
                      {CATEGORIES.find((item) => item.key === category)
                        ?.label ?? formatCategoryLabel(category)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-secondary">Date Incurred</dt>
                    <dd className="font-medium text-primary">{incurredDate}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-secondary">Vendor / Payee</dt>
                    <dd className="font-medium text-primary">
                      {vendorName.trim() || "Not specified"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-secondary">Budget</dt>
                    <dd className="font-medium text-primary">
                      {selectedBudget?.name ?? "No linked budget"}
                    </dd>
                  </div>
                  {description.trim() && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-secondary">Notes</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-primary">
                        {description.trim()}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>

              <section className="space-y-2.5 rounded-2xl border border-subtle bg-elevated/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary">
                    Supporting Evidence
                  </h4>
                  <span className="text-xs text-secondary">
                    {expenseToEdit
                      ? "Existing files kept"
                      : receiptFiles.length
                        ? `${receiptFiles.length} file${receiptFiles.length === 1 ? "" : "s"}`
                        : receiptUrl.trim()
                          ? "Reference provided"
                          : "None attached"}
                  </span>
                </div>
                {expenseToEdit ? (
                  <p className="text-xs text-secondary">
                    Existing receipt files remain attached.
                  </p>
                ) : receiptFiles.length > 0 ? (
                  <div className="space-y-2">
                    {receiptFiles.map((file) => (
                      <div
                        key={`${organization.id}:review:${receiptFileKeys.get(file)}`}
                        className="flex items-center gap-3 rounded-xl border border-subtle bg-surface p-2.5"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-elevated text-secondary">
                          {file.type.startsWith("image/") ? (
                            <ReceiptPreview file={file} name={file.name} />
                          ) : (
                            <FileText size={16} aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-medium text-primary"
                            title={file.name}
                          >
                            {file.name}
                          </p>
                          <p className="text-xs text-secondary">
                            {(file.size / 1024).toFixed(0)} KB
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-secondary">
                    No receipt files attached. You can go back to attach one if
                    needed.
                  </p>
                )}
              </section>

              <p className="text-xs text-secondary">
                Status after submission:{" "}
                <span className="font-medium text-primary">Pending Review</span>
              </p>
            </>
          )}
          <FormDraftControls
            draft={draft}
            busy={
              submitMutation.isPending ||
              updateMutation.isPending ||
              preparingReceipts
            }
          />
        </fieldset>
      </WizardDialog>

      {/* INSPECTOR 2: OFFICER REVIEW (VERIFY / APPROVE / REJECT) */}
      <DetailInspector
        isOpen={Boolean(showReviewModal && selectedExpense)}
        onClose={() => setShowReviewModal(false)}
        categoryLabel="Officer Review"
        title={selectedExpense?.title ?? ""}
        subtitle={
          selectedExpense ? <Badge>{selectedExpense.status}</Badge> : undefined
        }
        footer={
          selectedExpense ? (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleReviewAction("verified")}
                disabled={
                  reviewMutation.isPending ||
                  !canReviewExpense(
                    selectedExpense,
                    membership.profile_id,
                    membership.role,
                  ) ||
                  selectedExpense.submitted_by === membership.profile_id ||
                  !canVerifyExpense(selectedExpense)
                }
                className="px-3 py-2 rounded-full bg-elevated hover:bg-surface border border-subtle text-secondary hover:text-primary text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              >
                Verify
              </button>
              <button
                type="button"
                onClick={() => handleReviewAction("approved")}
                disabled={
                  reviewMutation.isPending ||
                  !canReviewExpense(
                    selectedExpense,
                    membership.profile_id,
                    membership.role,
                  ) ||
                  !canApproveExpense(selectedExpense, membership.profile_id) ||
                  (selectedExpense.submitted_by === membership.profile_id &&
                    reviewNotes.trim().length < 3)
                }
                className="px-3 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              >
                {selectedExpense.submitted_by === membership.profile_id
                  ? "Self-approve"
                  : "Approve"}
              </button>
              <button
                type="button"
                onClick={() => handleReviewAction("rejected")}
                disabled={
                  reviewMutation.isPending ||
                  selectedExpense.submitted_by === membership.profile_id ||
                  !canReviewExpense(
                    selectedExpense,
                    membership.profile_id,
                    membership.role,
                  ) ||
                  reviewNotes.trim().length < 3
                }
                className="px-3 py-2 rounded-full bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              >
                Reject
              </button>
            </div>
          ) : undefined
        }
      >
        {selectedExpense && (
          <>
            <InspectorGrid>
              <InspectorField
                label="Amount"
                value={formatMoney(
                  selectedExpense.amount_centavos,
                  selectedExpense.currency,
                )}
                mono
              />
              <InspectorField
                label="Date"
                value={selectedExpense.incurred_date}
                mono
              />
            </InspectorGrid>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <p>{actionError}</p>
              </div>
            )}

            <ExpenseReviewInfo
              expense={selectedExpense}
              actorId={membership.profile_id}
            />

            <InspectorSection title="Review notes (required for self-approval or rejection)">
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Verification rationale or discrepancy details…"
                rows={4}
                className="w-full rounded-xl bg-elevated border border-subtle p-3.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong"
              />
            </InspectorSection>
          </>
        )}
      </DetailInspector>

      {/* MODAL 4: DELETE EXPENSE CONFIRMATION */}
      <Modal
        isOpen={Boolean(showDeleteModal && expenseToDelete)}
        onClose={() => {
          setShowDeleteModal(false);
          setExpenseToDelete(null);
        }}
        maxWidth="md"
        className="space-y-5"
      >
        {expenseToDelete && (
          <>
            <button
              onClick={() => {
                setShowDeleteModal(false);
                setExpenseToDelete(null);
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
                Delete "{expenseToDelete.title}"?
              </h3>
              <p className="text-xs text-secondary mt-2 leading-relaxed">
                This will delete this expense record (
                {formatMoney(
                  expenseToDelete.amount_centavos,
                  expenseToDelete.currency,
                )}
                ). This action cannot be undone.
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
                onClick={() => setShowDeleteModal(false)}
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
    </div>
  );
}
