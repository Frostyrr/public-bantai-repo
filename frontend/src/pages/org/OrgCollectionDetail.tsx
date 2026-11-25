import CollectionAmountFilter, { type CollectionAmountFilters } from "../../components/org/collections/CollectionAmountFilter";
import Badge from "../../components/ui/Badge";
import CompactAmount from "../../components/ui/CompactAmount";
import CollectionArchiveAction from "../../components/org/collections/CollectionArchiveAction";
import { toast } from "../../lib/toast";
import CollectionAssessmentSettings, { type AssessmentPolicy } from "../../components/org/collections/CollectionAssessmentSettings";
import API from "../../config/apiClient";
import CollectionExportDialog from "../../components/org/collections/CollectionExportDialog";
import CollectionScopeSettings from "../../components/org/collections/CollectionScopeSettings";
import CollectionDuesAssignment from "../../components/org/collections/CollectionDuesAssignment";
import CollectionManageDuesModal from "../../components/org/collections/CollectionManageDuesModal";
import React, { useDeferredValue, useEffect, useState } from "react";
import { useParams, useSearchParams, Link, useNavigate, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Search,
  Filter,
  DollarSign,
  Copy,
  Check,
  Printer,
  X,
  UserCheck,
  Edit2,
  Trash2,
  AlertTriangle,
  Download,
  SlidersHorizontal,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import DatePicker from "../../components/ui/DatePicker";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
} from "../../components/ui/DetailInspector";
import Modal from "../../components/ui/Modal";
import { CollectionDetailSkeleton } from "../../components/layout/WorkspaceSkeletons";
import {
  getCollection,
  getCollectionMembers,
  getPayments,
  getDirectoryAssignmentFilters,
  type DirectoryAssignmentMember,
  recordPayment,
  reversePayment,
  updateCollection,
  deleteCollection,
  getSpaces,
  getReportingPeriods,
  type OrganizationDetails,
  type Membership,
  type Obligation,
  type Payment,
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

export default function OrgCollectionDetail() {
  const { orgId, collectionId } = useParams<{ orgId: string; collectionId: string }>();
  const { organization, membership } = useOutletContext<ContextType>();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"obligations" | "payments">("obligations");
  const [searchMember, setSearchMember] = useState("");
  const rosterSearch = useDeferredValue(searchMember.trim());
  const [rosterPage, setRosterPage] = useState(0);
  const [routeSearch, setRouteSearch] = useSearchParams();
  const focusedObligation = routeSearch.get("obligation");
  const clearFocusedObligation = () => { const next = new URLSearchParams(routeSearch); next.delete("obligation"); setRouteSearch(next, {replace:true}); };
  const [amountFilters, setAmountFilters] = useState<CollectionAmountFilters>({});
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [copiedReceipt, setCopiedReceipt] = useState<string | null>(null);

  // Modals
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedObligation, setSelectedObligation] = useState<Obligation | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "gcash" | "maya" | "other">("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [completedPayment, setCompletedPayment] = useState<Payment | null>(null);

  const [showExport,setShowExport]=useState(false);
  const [showScope,setShowScope]=useState(false);
  const [preselectedMember,setPreselectedMember]=useState<DirectoryAssignmentMember>();
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showManageDuesModal, setShowManageDuesModal] = useState(false);

  const [showReverseModal, setShowReverseModal] = useState(false);
  const [paymentToReverse, setPaymentToReverse] = useState<Payment | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  const [actionError, setActionError] = useState("");

  const navigate = useNavigate();
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const isEditMode = editingCollectionId === collectionId;
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTargetInput, setEditTargetInput] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editSpaceId, setEditSpaceId] = useState("");
  const [editReportingPeriodId, setEditReportingPeriodId] = useState("");
  const [editStatus, setEditStatus] = useState<"active" | "closed" | "archived">("active");

  const isOfficer =
    membership?.role === "owner" ||
    membership?.role === "organization_admin" ||
    membership?.role === "treasurer";

  // Data Queries
  const collectionQuery = useQuery({
    queryKey: ["collection", orgId, collectionId],
    queryFn: () => getCollection(orgId!, collectionId!),
    enabled: Boolean(orgId && collectionId),
  });

  const obligationsQuery = useQuery({
    queryKey: ["obligations", orgId, collectionId, rosterPage, rosterSearch, statusFilter, focusedObligation, amountFilters],
    queryFn: ({signal}) => getCollectionMembers(orgId!, collectionId!, {page:rosterPage,q:rosterSearch,status:statusFilter,obligationId:focusedObligation ?? undefined, ...amountFilters},signal),
    enabled: Boolean(orgId && collectionId),
  });

  const [showAssessmentSettings,setShowAssessmentSettings] = useState(false);
  const assessmentPath = `/organizations/${orgId}/collections/${collectionId}/assessment-policy`;
  const assessment = useQuery({
    queryKey: ["collection-assessment-policy", orgId, collectionId],
    enabled: Boolean(orgId && collectionId && isOfficer),
    queryFn: async ({signal}) => (await API.get<AssessmentPolicy>(assessmentPath,{signal})).data,
  });
  const paymentsQuery = useQuery({
    queryKey: ["payments", orgId, collectionId],
    queryFn: () => getPayments(orgId!, { collectionId }),
    enabled: Boolean(orgId && collectionId),
  });

  const assignmentFilters = useQuery({
    queryKey: ["directory-assignment-filters", orgId],
    queryFn: ({ signal }) => getDirectoryAssignmentFilters(orgId!, signal),
    enabled: Boolean(orgId && isOfficer),
  });
  const primaryIdentifier = assignmentFilters.data?.fields.find(field => field.display_order === 10);
  const identifierLabel = primaryIdentifier?.label ?? "Member ID";
  const memberIdentifier = (member: DirectoryAssignmentMember) =>
    primaryIdentifier ? member.attributes[primaryIdentifier.key] : member.member_code;
  // Mutations
  const recordPaymentMutation = useMutation({
    mutationFn: (payload: {
      obligationId: string;
      amountCentavos: number;
      paymentMethod: "cash" | "bank_transfer" | "gcash" | "maya" | "other";
      referenceNumber?: string;
      idempotencyKey?: string;
    }) => recordPayment(orgId!, payload),
    onSuccess: async (payment) => {
      toast.success("Payment recorded");
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", orgId] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", orgId] })]),
        queryClient.invalidateQueries({ queryKey: ["directory-obligations"] }),
        queryClient.invalidateQueries({ queryKey: ["user-obligations"] }),
        queryClient.invalidateQueries({ queryKey: ["collections", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["collection", orgId, collectionId] }),
        queryClient.invalidateQueries({ queryKey: ["obligations", orgId, collectionId] }),
        queryClient.invalidateQueries({ queryKey: ["payments", orgId, collectionId] }),
      ]);
      setShowPaymentModal(false);
      setCompletedPayment(payment);
      setShowReceiptModal(true);
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const reversePaymentMutation = useMutation({
    mutationFn: (payload: { paymentId: string; reason: string }) =>
      reversePayment(orgId!, payload.paymentId, payload.reason),
    onSuccess: async () => {
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", orgId] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", orgId] })]),
        queryClient.invalidateQueries({ queryKey: ["directory-obligations"] }),
        queryClient.invalidateQueries({ queryKey: ["user-obligations"] }),
        queryClient.invalidateQueries({ queryKey: ["collections", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["collection", orgId, collectionId] }),
        queryClient.invalidateQueries({ queryKey: ["obligations", orgId, collectionId] }),
        queryClient.invalidateQueries({ queryKey: ["payments", orgId, collectionId] }),
      ]);
      setShowReverseModal(false);
      setPaymentToReverse(null);
      setReversalReason("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const spacesQuery = useQuery({
    queryKey: ["organization-spaces", orgId],
    queryFn: () => getSpaces(orgId!),
    enabled: Boolean(orgId && showEditModal),
  });

  const periodsQuery = useQuery({
    queryKey: ["organization-periods", orgId],
    queryFn: () => getReportingPeriods(orgId!),
    enabled: Boolean(orgId && showEditModal),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      description?: string;
      targetCentavos?: number;
      dueDate?: string;
      spaceId?: string;
      status?: "active" | "closed" | "archived";
    }) => updateCollection(orgId!, collectionId!, payload),
    onSuccess: async () => {
      toast.success("Collection updated");
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", orgId] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", orgId] })]),
        queryClient.invalidateQueries({ queryKey: ["directory-obligations"] }),
        queryClient.invalidateQueries({ queryKey: ["user-obligations"] }),
        queryClient.invalidateQueries({ queryKey: ["collections", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["collection", orgId, collectionId] }),
      ]);
      setShowEditModal(false);
      setActionError("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCollection(orgId!, collectionId!, deleteConfirmation),
    onSuccess: async (result) => {
      toast.success(result.action === "archived" ? "Collection archived" : "Collection deleted",
        result.action === "archived" ? { description: "The collection’s dues and payment history were preserved." } : undefined);
      void Promise.all([
        Promise.all([queryClient.invalidateQueries({ queryKey: ["financial-summary", orgId] }), queryClient.invalidateQueries({ queryKey: ["financial-insights", orgId] })]),
        queryClient.invalidateQueries({ queryKey: ["directory-obligations"] }),
        queryClient.invalidateQueries({ queryKey: ["user-obligations"] }),
        queryClient.invalidateQueries({ queryKey: ["collections", orgId] }),
      ]);
      void queryClient.invalidateQueries({ queryKey: ["collection-archives", orgId] });
      navigate(`/app/org/${orgId}/collections`);
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const openEditModal = () => {
    if (!collectionQuery.data) return;
    const c = collectionQuery.data;
    setEditTitle(c.title);
    setEditDescription(c.description || "");
    setEditTargetInput(c.target_amount_centavos ? (c.target_amount_centavos / 100).toFixed(2) : "");
    setEditDueDate(c.due_date || "");
    setEditSpaceId(c.space_id || "");
    setEditReportingPeriodId(c.reporting_period_id || "");
    setEditStatus(c.status as "active" | "closed" | "archived");
    setActionError("");
    setShowEditModal(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) {
      setActionError("Title is required.");
      return;
    }
    const targetVal = parseFloat(editTargetInput) || 0;
    updateMutation.mutate({
      title: editTitle.trim(),
      description: editDescription.trim() || undefined,
      targetCentavos: Math.round(targetVal * 100),
      dueDate: editDueDate || undefined,
      spaceId: editSpaceId || undefined,
      status: editStatus,
    });
  };

  const openPaymentModal = (obligation: Obligation) => {
    setSelectedObligation(obligation);
    const rem = (obligation.remaining_centavos ?? obligation.amount_centavos) / 100;
    setPaymentAmountInput(rem > 0 ? rem.toFixed(2) : "0.00");
    setPaymentMethod("cash");
    setReferenceNumber("");
    setIdempotencyKey(crypto.randomUUID());
    setActionError("");
    setShowPaymentModal(true);
  };

  const handleRecordPaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedObligation) return;
    const amountVal = parseFloat(paymentAmountInput) || 0;
    if (amountVal <= 0) {
      setActionError("Payment amount must be greater than zero.");
      return;
    }
    recordPaymentMutation.mutate({
      obligationId: selectedObligation.id,
      amountCentavos: Math.round(amountVal * 100),
      paymentMethod,
      referenceNumber: referenceNumber.trim() || undefined,
      idempotencyKey,
    });
  };

  const handleReverseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentToReverse || !reversalReason.trim()) return;
    reversePaymentMutation.mutate({
      paymentId: paymentToReverse.id,
      reason: reversalReason.trim(),
    });
  };

  const copyReceipt = (receipt: string) => {
    navigator.clipboard.writeText(receipt);
    setCopiedReceipt(receipt);
    setTimeout(() => setCopiedReceipt(null), 2000);
  };

  useEffect(() => {
    if (focusedObligation && obligationsQuery.isSuccess) document.getElementById(`obligation-${focusedObligation}`)?.scrollIntoView({ block: "center" });
  }, [focusedObligation, obligationsQuery.isSuccess]);
  const collection = collectionQuery.data;
  useEffect(() => {
    if (rosterPage > 0 && obligationsQuery.isSuccess && !obligationsQuery.isFetching && !obligationsQuery.data.rows.length) {
      const id = window.setTimeout(() => setRosterPage(page => Math.max(0, page - 1)), 0);
      return () => window.clearTimeout(id);
    }
  }, [rosterPage, obligationsQuery.isSuccess, obligationsQuery.isFetching, obligationsQuery.data]);

  const obligations = obligationsQuery.data?.rows ?? [];
  const payments = paymentsQuery.data ?? [];

  const filteredObligations = obligations;

  const target = collection?.target_amount_centavos || 0;
  const collected = collection?.total_collected_centavos || 0;
  const assigned = collection?.total_expected_centavos ?? 0;
  const progressBasis = target || assigned;
  const pct = progressBasis > 0 ? Math.min(100, Math.round((collected / progressBasis) * 100)) : 0;
  const remainingDues = Math.max(0, assigned - collected);
  const totalAssigned = collection?.total_obligations_count ?? 0;
  const paidAssigned = collection?.paid_obligations_count ?? 0;

  if (collectionQuery.isPending) {
    return <CollectionDetailSkeleton />;
  }

  if (collectionQuery.error || !collection) {
    return (
      <div className="p-8 font-body">
        <Link
          to={`/app/org/${orgId}/collections`}
          className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-primary mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Collections
        </Link>
        <div className="p-6 rounded-2xl bg-sem-error-bg border border-sem-error-border text-sem-error-fg text-sm">
          <p>{formatErrorMessage(collectionQuery.error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell workspace-page space-y-4!">
      {/* Back Link */}
      <div>
        <Link
          to={`/app/org/${orgId}/collections`}
          className="inline-flex items-center gap-2 text-xs font-mono text-secondary hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Collections</span>
        </Link>
      </div>

      {/* Compact Two-Part Collection Header Card */}
      <div className="card-specular p-4 sm:p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-heading text-xl font-medium tracking-tight">
                <span className="text-display-gradient">{collection.title}</span>
              </h1>
              {collection.status === "active" ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="context" className="page-header-eyebrow">
                  {collection.status}
                </Badge>
              )}
              {collection.spaces && (
                <Badge variant="context" className="page-header-eyebrow">
                  Project: {collection.spaces.name}
                </Badge>
              )}
              {collection.reporting_periods && (
                <Badge variant="context" className="page-header-eyebrow">
                  Period: {collection.reporting_periods.name}
                </Badge>
              )}
              {collection.due_date && (
                <Badge variant="context" className="page-header-eyebrow">
                  Due: {collection.due_date}
                </Badge>
              )}
            </div>

            {collection.description && (
              <p className="mt-1 text-xs text-secondary">
                {collection.description}
              </p>
            )}
            {collection.status === "archived" && (
              <p className="mt-1 text-xs text-secondary">Archived · Read only</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isOfficer && collection.status === "archived" && (
              <CollectionArchiveAction org={orgId!} id={collection.id} title={collection.title} archived />
            )}
            {isOfficer && collection.status !== "archived" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8! px-3! rounded-lg! text-xs! dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-white"
                  onClick={() => setEditingCollectionId(isEditMode ? null : collectionId ?? null)}
                  icon={isEditMode ? <Check className="w-3.5 h-3.5" /> : <Edit2 className="w-3.5 h-3.5" />}
                  aria-pressed={isEditMode}
                >
                  {isEditMode ? "Done Editing" : "Edit Mode"}
                </Button>
                <CollectionArchiveAction org={orgId!} id={collection.id} title={collection.title} archived={false} />
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8! px-3! rounded-lg! text-xs! dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-white"
              onClick={() => setShowExport(true)}
              icon={<Download className="w-3.5 h-3.5" />}
            >
              Export Collection
            </Button>
            {isOfficer && collection.status !== "archived" && isEditMode && (
              <>
                <Button variant="outline" size="sm" className="h-8! px-3! rounded-lg! text-xs!" onClick={() => setShowScope(true)}>
                  Member scope
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8! px-3! rounded-lg! text-xs!"
                  disabled={!assessment.data}
                  onClick={() => setShowAssessmentSettings(true)}
                >
                  Assessment settings
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8! px-3! rounded-lg! text-xs!"
                  onClick={openEditModal}
                  icon={<Edit2 className="w-3.5 h-3.5" />}
                >
                  Edit Campaign
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="h-8! px-3! rounded-lg! text-xs!"
                  onClick={() => {
                    setActionError("");
                    setDeleteConfirmation("");
                    setShowDeleteModal(true);
                  }}
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                >
                  Delete Collection
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Integrated Bottom Progress Bar */}
        <div className="mt-4 pt-3.5 border-t border-subtle dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-xs text-secondary">
              {target > 0 ? "Target progress" : "Assigned dues collected"}
            </span>
            <span className="text-xs font-medium text-primary tabular-nums">
              {progressBasis > 0 ? `${pct}%` : "No dues assigned"}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Collection progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-1.5 w-full rounded-full bg-progress-track overflow-hidden"
          >
            <div
              className="h-full bg-progress-fill rounded-full transition-all motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Unified Segmented 6-Metric Strip */}
      <dl
        aria-label="Collection statistics"
        className="card-specular rounded-2xl border border-subtle bg-surface shadow-xs dark:shadow-none grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-subtle dark:divide-white/[0.06]"
      >
        {(
          [
            {
              label: "Collected",
              value: <CompactAmount centavos={collected} currency={collection.currency} />,
              muted: false,
            },
            {
              label: "Assigned dues",
              value: <CompactAmount centavos={assigned} currency={collection.currency} />,
              muted: false,
            },
            {
              label: "Remaining dues",
              value: <CompactAmount centavos={remainingDues} currency={collection.currency} />,
              muted: false,
            },
            { label: "Paid obligations", value: `${paidAssigned} of ${totalAssigned}`, muted: false },
            {
              label: "Unpaid obligations",
              value: String((collection.pending_count ?? 0) + (collection.partially_paid_count ?? 0)),
              muted: false,
            },
            {
              label: "Collection target",
              value: target > 0 ? <CompactAmount centavos={target} currency={collection.currency} /> : "Not set",
              muted: target <= 0,
            },
          ] as Array<{ label: string; value: React.ReactNode; muted: boolean }>
        ).map((stat) => (
          <div key={stat.label} className="min-w-0 px-4 py-3.5">
            <dt className="text-[11px] font-medium text-secondary truncate">
              {stat.label}
            </dt>
            <dd
              className={`mt-1 text-base sm:text-lg font-semibold tabular-nums break-words ${
                stat.muted ? "text-muted" : "text-primary"
              }`}
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-subtle pb-2 sm:pb-0">
        <div
          role="tablist"
          aria-label="Collection views"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 min-w-0"
        >
          <button
            id="tab-obligations"
            type="button"
            role="tab"
            aria-selected={activeTab === "obligations"}
            aria-controls="panel-obligations"
            onClick={() => setActiveTab("obligations")}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                setActiveTab("payments");
                document.getElementById("tab-payments")?.focus();
              }
            }}
            className={`pb-3 text-sm font-medium transition-colors relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded-sm ${
              activeTab === "obligations"
                ? "text-primary"
                : "text-secondary hover:text-primary"
            }`}
          >
            <span>Collection Members</span>
            <Badge className="ml-2">
              {obligationsQuery.data?.total ?? collection.total_obligations_count}
            </Badge>
            {activeTab === "obligations" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-action rounded-full" />
            )}
          </button>

          <button
            id="tab-payments"
            type="button"
            role="tab"
            aria-selected={activeTab === "payments"}
            aria-controls="panel-payments"
            onClick={() => setActiveTab("payments")}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                setActiveTab("obligations");
                document.getElementById("tab-obligations")?.focus();
              }
            }}
            className={`pb-3 text-sm font-medium transition-colors relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded-sm ${
              activeTab === "payments"
                ? "text-primary"
                : "text-secondary hover:text-primary"
            }`}
          >
            <span>Payment & Receipt Ledger</span>
            <Badge className="ml-2">
              {payments.length}
            </Badge>
            {activeTab === "payments" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-action rounded-full" />
            )}
          </button>
        </div>

        {isOfficer && (
          <div className="flex items-center justify-end shrink-0 pb-1 sm:pb-2.5">
            {(() => {
              const notAssessedCount = obligationsQuery.data?.notAssessed ?? 0;
              const canManage = collection.status === "active";
              const label = notAssessedCount > 0 ? "Assign Unassessed Members" : "Manage Dues";
              const disabledReason =
                collection.status === "archived"
                  ? "Archived collections are read-only."
                  : "Reopen this collection to manage dues.";
              return (
                <Button
                  variant={canManage ? "primary" : "outline"}
                  size="sm"
                  className="h-8! px-3.5! rounded-full! text-xs! font-medium!"
                  disabled={!canManage}
                  title={!canManage ? disabledReason : undefined}
                  onClick={() => {
                    setActionError("");
                    setShowManageDuesModal(true);
                  }}
                  icon={
                    notAssessedCount > 0 ? (
                      <UserCheck className="w-3.5 h-3.5" />
                    ) : (
                      <SlidersHorizontal className="w-3.5 h-3.5 text-secondary" />
                    )
                  }
                >
                  {label}
                </Button>
              );
            })()}
          </div>
        )}
      </div>

      {/* TAB 1: MEMBER OBLIGATIONS ROSTER */}
      {activeTab === "obligations" && (
        <div id="panel-obligations" role="tabpanel" aria-labelledby="tab-obligations" className="space-y-5">
          {obligationsQuery.data && <p className="text-sm text-secondary">
            {obligationsQuery.data.total} roster members · {obligationsQuery.data.total-obligationsQuery.data.notAssessed} assessed · {obligationsQuery.data.notAssessed} not assessed
          </p>}
          {/* Search & Filter Bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative basis-full xl:min-w-48 xl:flex-1 xl:basis-0">
              <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchMember}
                onChange={(e) => { setSearchMember(e.target.value); setRosterPage(0); clearFocusedObligation(); }}
                maxLength={100} aria-label="Search collection members" placeholder="Search by full name or ID…"
                className="w-full bg-elevated border border-subtle rounded-full pl-10 pr-4 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors"
              />
            </div>

            {(["assessed", "paid", "balance"] as const).map(field => (
              <CollectionAmountFilter key={field} field={field} currency={collection.currency}
                bounds={{ min: amountFilters[`${field}Min`], max: amountFilters[`${field}Max`],
                  missing: field === "assessed" ? amountFilters.noAssessment : undefined }}
                onChange={bounds => {
                  setAmountFilters(current => ({ ...current, [`${field}Min`]: bounds.min, [`${field}Max`]: bounds.max,
                    ...(field === "assessed" ? { noAssessment: bounds.missing } : {}) }));
                  setRosterPage(0);
                  clearFocusedObligation();
                }} />
            ))}
            <Select
              ariaLabel="Status"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setRosterPage(0); clearFocusedObligation(); }}
              variant="pill"
              selectSize="sm"
              icon={<Filter className="w-3.5 h-3.5 text-secondary" />}
              menuWidth="auto"
              options={[
                { value: "all", label: "Status" },
                { value: "assessed", label: "Assessed" },
                { value: "not_assessed", label: "Not Assessed" },
                { value: "pending", label: "Unpaid" },
                { value: "partially_paid", label: "Partially Paid" },
                { value: "paid", label: "Paid in Full" },
                { value: "waived", label: "Waived" },
              ]}
            />
            {(searchMember || statusFilter !== "all" || Object.values(amountFilters).some(value => value !== undefined) || focusedObligation) &&
              <Button variant="ghost" size="sm" onClick={() => {
                setSearchMember(""); setStatusFilter("all"); setAmountFilters({}); setRosterPage(0); clearFocusedObligation();
              }}>Clear filters</Button>}
            <nav className="ml-auto flex items-center gap-2" aria-label="Collection roster pagination">
              <Button variant="outline" size="sm" disabled={rosterPage===0 || obligationsQuery.isFetching}
                onClick={() => setRosterPage(page => page-1)}>Previous</Button>
              <span className="whitespace-nowrap text-xs text-secondary" role="status">Page {rosterPage+1}</span>
              <Button variant="outline" size="sm" disabled={!obligationsQuery.data?.hasMore || obligationsQuery.isFetching}
                onClick={() => setRosterPage(page => page+1)}>Next</Button>
            </nav>
          </div>

          {/* Obligations Table */}
          <div className="min-w-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-subtle bg-elevated text-[11px] font-mono uppercase tracking-wider text-muted">
                    <th className="py-4 px-6">Full Name</th>
                    <th className="py-4 px-6">{identifierLabel}</th>
                    <th className="py-4 px-6 text-right">Assessed Dues</th>
                    <th className="py-4 px-6 text-right">Paid</th>
                    <th className="py-4 px-6 text-right">Balance</th>
                    <th className="py-4 px-6 text-center">Status</th>
                    {isOfficer && collection.status !== "archived" && <th className="py-4 px-6 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                  {obligationsQuery.isPending ? <tr><td colSpan={7} className="py-10 text-center text-secondary" role="status">Loading collection members…</td></tr>
                    : obligationsQuery.isError ? <tr><td colSpan={7} className="py-10 text-center text-sem-error-fg" role="alert">{formatErrorMessage(obligationsQuery.error)} <Button variant="ghost" onClick={() => void obligationsQuery.refetch()}>Try again</Button></td></tr>
                    : filteredObligations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-secondary text-sm">
                        No collection members match your filters.
                      </td>
                    </tr>
                  ) : (
                    filteredObligations.map((ob) => {
                      const memberName = ob.name;
                      const identifier = ob.organization_directory_members ? memberIdentifier(ob.organization_directory_members) : null;
                      const amount = ob.amount_centavos;
                      const paid = ob.paid_centavos || 0;
                      const balance = ob.remaining_centavos ?? (amount - paid);

                      return (
                        <tr key={ob.id} id={ob.obligation_id ? `obligation-${ob.obligation_id}` : undefined} className={`hover:bg-elevated/60 transition-colors ${focusedObligation && focusedObligation === ob.obligation_id ? "bg-sem-success-bg ring-1 ring-inset ring-emerald-500/40" : ""}`}>
                          <td className="py-4 px-6">
                            <div className="font-medium text-primary">{memberName}</div>
                            {ob.outside_scope && obligationsQuery.data?.scope!=="legacy" && <p className="mt-1 text-xs text-sem-warning-fg">Outside saved scope</p>}
                            {ob.member_id && <p className="mt-1 text-xs text-sem-warning-fg">Historical workspace reference</p>}
                            {ob.organization_directory_members?.status === "archived" && <p className="mt-1 text-xs text-secondary">Archived directory record · unavailable for new dues</p>}
                            {ob.notes && (
                              <p className="text-xs text-secondary mt-0.5">{ob.notes}</p>
                            )}
                          </td>
                          <td className="py-4 px-6">
                            <span className="break-all font-mono text-xs text-secondary">
                              {identifier != null && identifier !== "" ? String(identifier) : "—"}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right font-mono text-secondary">
                            {ob.obligation_id ? formatMoney(amount, collection.currency) : "—"}
                          </td>
                          <td className="py-4 px-6 text-right font-mono text-primary">
                            {ob.obligation_id ? formatMoney(paid, collection.currency) : "—"}
                          </td>
                          <td className="py-4 px-6 text-right font-mono font-medium">
                            <span
                              className={
                                balance > 0 ? "text-sem-warning-fg" : "text-secondary"
                              }
                            >
                              {ob.obligation_id ? formatMoney(balance, collection.currency) : "—"}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-center">
                            <Badge >
                              {ob.status === "not_assessed" ? "Not Assessed" : ob.status === "pending" ? "Unpaid" : ob.status === "partially_paid" ? "Partially Paid" : ob.status === "paid" ? "Paid" : "Waived"}
                            </Badge>
                          </td>
                          {isOfficer && collection.status !== "archived" && (
                            <td className="py-4 px-6 text-right">
                              {ob.status === "not_assessed" ? (
                                collection.status === "active" && ob.organization_directory_members && <Button size="sm" variant="outline"
                                  onClick={()=>{setPreselectedMember(ob.organization_directory_members!);setShowAssignModal(true);}}>Assign Dues</Button>
                              ) : ob.status !== "paid" && ob.status !== "waived" && ob.obligation_id ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => openPaymentModal({...ob,id:ob.obligation_id!,status:ob.status as Obligation["status"]})}
                                  icon={<DollarSign className="w-3 h-3" />}
                                >
                                  Record Payment
                                </Button>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-primary font-mono">
                                  <Check className="w-3.5 h-3.5" /> Settled
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PAYMENTS & RECEIPTS LEDGER */}
      {activeTab === "payments" && (
        <div id="panel-payments" role="tabpanel" aria-labelledby="tab-payments" className="space-y-5">
          <div className="table-specular rounded-xl bg-surface border border-subtle overflow-hidden shadow-xs dark:shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-subtle bg-elevated text-[11px] font-mono uppercase tracking-wider text-muted">
                    <th className="py-4 px-6">Receipt No.</th>
                    <th className="py-4 px-6">Contributor</th>
                    <th className="py-4 px-6 text-right">Amount Settled</th>
                    <th className="py-4 px-6">Method & Ref</th>
                    <th className="py-4 px-6">Timestamp</th>
                    <th className="py-4 px-6 text-center">Status</th>
                    {isOfficer && collection.status !== "archived" && <th className="py-4 px-6 text-right">Audit Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-secondary text-sm">
                        No payments recorded yet for this collection.
                      </td>
                    </tr>
                  ) : (
                    payments.map((p) => {
                      const memberName =
                        p.obligations?.organization_directory_members?.display_name || p.obligations?.organization_members?.profiles?.display_name ||
                        "Member";

                      return (
                        <tr
                          key={p.id}
                          className={`hover:bg-elevated/60 transition-colors ${
                            p.status === "reversed" ? "opacity-60 bg-sem-error-bg" : ""
                          }`}
                        >
                          <td className="py-4 px-6 font-mono text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-primary">
                                {p.receipt_number}
                              </span>
                              <button
                                onClick={() => copyReceipt(p.receipt_number)}
                                className="p-1 rounded text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
                                title="Copy receipt number"
                              >
                                {copiedReceipt === p.receipt_number ? (
                                  <Check className="w-3 h-3 text-sem-success-fg" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-4 px-6 font-medium text-primary">
                            {memberName}
                          </td>
                          <td className="py-4 px-6 text-right font-mono font-medium text-primary">
                            {formatMoney(p.amount_centavos, collection.currency)}
                          </td>
                          <td className="py-4 px-6">
                            <Badge >
                              {p.payment_method.replace("_", " ")}
                            </Badge>
                            {p.reference_number && (
                              <p className="text-xs font-mono text-secondary mt-1">
                                Ref: {p.reference_number}
                              </p>
                            )}
                          </td>
                          <td className="py-4 px-6 text-xs text-secondary font-mono">
                            {new Date(p.paid_at).toLocaleString()}
                          </td>
                          <td className="py-4 px-6 text-center">
                            {p.status === "completed" ? (
                              <Badge >
                                COMPLETED
                              </Badge>
                            ) : (
                              <div>
                                <Badge >
                                  REVERSED
                                </Badge>
                                {p.reversal_reason && (
                                  <p className="text-[11px] text-sem-error-fg mt-1">
                                    {p.reversal_reason}
                                  </p>
                                )}
                              </div>
                            )}
                          </td>
                          {isOfficer && collection.status !== "archived" && (
                            <td className="py-4 px-6 text-right">
                              {p.status === "completed" && (
                                <button
                                  onClick={() => {
                                    setPaymentToReverse(p);
                                    setReversalReason("");
                                    setActionError("");
                                    setShowReverseModal(true);
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-sem-error-fg hover:text-sem-error-fg hover:bg-sem-error-bg border border-sem-error-border transition-colors"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Reverse</span>
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: RECORD PAYMENT */}
      <Modal
        isOpen={Boolean(showPaymentModal && selectedObligation)}
        onClose={() => setShowPaymentModal(false)}
        maxWidth="lg"
      >
        {selectedObligation && (
          <>
            <button
              onClick={() => setShowPaymentModal(false)}
              className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Badge variant="context" >
                Official Settlement
              </Badge>
            </div>
            <h2 className="text-primary mb-1 section-title">
              Record Payment
            </h2>
            <p className="text-xs text-secondary mb-5">
              Contributor: <strong className="text-primary">{selectedObligation.organization_directory_members?.display_name || selectedObligation.organization_members?.profiles?.display_name || "Member"}</strong>
            </p>

            {/* Balance Card */}
            <div className="p-4 rounded-2xl bg-elevated border border-subtle mb-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-muted block">
                  Outstanding Balance
                </span>
                <span className="text-xl font-mono font-medium text-primary">
                  {formatMoney(
                    selectedObligation.remaining_centavos ?? selectedObligation.amount_centavos,
                    collection.currency
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const rem = (selectedObligation.remaining_centavos ?? selectedObligation.amount_centavos) / 100;
                  setPaymentAmountInput(rem.toFixed(2));
                }}
                className="px-3 py-1.5 rounded-full bg-surface hover:bg-elevated border border-subtle text-xs font-mono text-primary transition-colors cursor-pointer"
              >
                Full Balance
              </button>
            </div>

            {actionError && (
              <div className="mb-4 p-3 rounded-xl bg-sem-error-bg border border-sem-error-border text-sem-error-fg text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-sem-error-fg" />
                <p>{actionError}</p>
              </div>
            )}

            <form onSubmit={handleRecordPaymentSubmit} className="space-y-4">
              <Input
                label={`Amount to Settle (${collection.currency})`}
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={paymentAmountInput}
                onChange={(e) => setPaymentAmountInput(e.target.value)}
                required
              />

              <Select
                label="Payment Method"
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(
                    e.target.value as "cash" | "bank_transfer" | "gcash" | "maya" | "other"
                  )
                }
                options={[
                  { value: "cash", label: "Cash (Direct Physical Payment)" },
                  { value: "gcash", label: "GCash (Electronic Wallet)" },
                  { value: "maya", label: "Maya (Electronic Wallet)" },
                  { value: "bank_transfer", label: "Bank Transfer (Direct Deposit)" },
                  { value: "other", label: "Other Payment Method" },
                ]}
              />

              <Input
                label="Reference / Transaction Number (Optional)"
                placeholder="e.g. 1002349890 or Bank Deposit Slip #"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-subtle">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPaymentModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={recordPaymentMutation.isPending || !paymentAmountInput}
                >
                  {recordPaymentMutation.isPending ? "Issuing Receipt…" : "Confirm & Issue Receipt"}
                </Button>
              </div>
            </form>
          </>
        )}
      </Modal>

      {/* INSPECTOR 2: DIGITAL RECEIPT */}
      <DetailInspector
        isOpen={Boolean(showReceiptModal && completedPayment)}
        onClose={() => setShowReceiptModal(false)}
        categoryLabel="Official Electronic Receipt"
        title="Payment Settled"
        subtitle={
          completedPayment ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sem-success-bg border border-sem-success-border px-2 py-0.5 text-[10px] font-mono text-sem-success-fg">
              <CheckCircle2 className="w-3 h-3" />
              Recorded
            </span>
          ) : undefined
        }
        footer={
          completedPayment ? (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                icon={<Printer className="w-3.5 h-3.5" />}
                className="flex-1 rounded-full"
              >
                Print Receipt
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowReceiptModal(false)}
                className="flex-1 rounded-full"
              >
                Done
              </Button>
            </div>
          ) : undefined
        }
      >
        {completedPayment && (
          <>
            <div className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.02] p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                  Receipt No.
                </p>
                <p className="font-mono text-xs font-semibold text-primary truncate">
                  {completedPayment.receipt_number}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                  Amount Paid
                </p>
                <p className="font-mono text-sm font-semibold text-sem-success-fg">
                  {formatMoney(completedPayment.amount_centavos, collection.currency)}
                </p>
              </div>
            </div>

            <InspectorGrid>
              <InspectorField
                label="Organization"
                value={organization.name}
              />
              <InspectorField
                label="Method"
                value={
                  <span className="uppercase">
                    {completedPayment.payment_method}
                  </span>
                }
              />
              <InspectorField
                label="Campaign"
                value={collection.title}
                className="col-span-2"
              />
              {completedPayment.reference_number && (
                <InspectorField
                  label="Reference No."
                  value={completedPayment.reference_number}
                  mono
                  className="col-span-2"
                />
              )}
            </InspectorGrid>
          </>
        )}
      </DetailInspector>

      {assessment.data?.failed && <div role="status" className="text-sm text-sem-warning-fg">
        An automatic assessment needs attention. <Button variant="ghost" onClick={()=>setShowAssessmentSettings(true)}>Review</Button>
      </div>}
      {showAssessmentSettings && assessment.data && <CollectionAssessmentSettings path={assessmentPath} policy={assessment.data}
        currency={collection.currency} onClose={()=>setShowAssessmentSettings(false)} onSaved={()=>{
          void assessment.refetch();
          void queryClient.invalidateQueries({queryKey:["obligations",orgId,collectionId]});
          void queryClient.invalidateQueries({queryKey:["collection",orgId,collectionId]});
          void queryClient.invalidateQueries({queryKey:["collections",orgId]});
          void queryClient.invalidateQueries({queryKey:["directory-obligations"]});
          void Promise.all([queryClient.invalidateQueries({queryKey:["financial-summary",orgId]}), queryClient.invalidateQueries({queryKey:["financial-insights",orgId]})]);
        }}/>}
      {showExport && <CollectionExportDialog orgId={orgId!} collectionId={collectionId!} q={rosterSearch} amountFilters={amountFilters}
        status={statusFilter} obligationId={focusedObligation ?? undefined} onClose={() => setShowExport(false)} />}
      {showScope && <CollectionScopeSettings orgId={orgId!} collectionId={collectionId!} onClose={()=>setShowScope(false)}/>}
      {showManageDuesModal && (
        <CollectionManageDuesModal
          isOpen={showManageDuesModal}
          onClose={() => setShowManageDuesModal(false)}
          collectionStatus={collection.status}
          currency={collection.currency}
          totalMembers={obligationsQuery.data?.total ?? totalAssigned}
          notAssessedCount={obligationsQuery.data?.notAssessed ?? 0}
          paidCount={paidAssigned}
          unpaidCount={(collection.pending_count ?? 0) + (collection.partially_paid_count ?? 0)}
          assessmentPolicy={assessment.data}
          onAssignUnassessed={() => {
            setPreselectedMember(undefined);
            setShowAssignModal(true);
          }}
          onOpenScopeSettings={() => setShowScope(true)}
          onOpenAssessmentSettings={() => setShowAssessmentSettings(true)}
          onFilterUnassessed={() => {
            setActiveTab("obligations");
            setStatusFilter("not_assessed");
            setRosterPage(0);
            clearFocusedObligation();
          }}
        />
      )}
      {showAssignModal && <CollectionDuesAssignment standardAmount={assessment.data?.amount} initialMember={preselectedMember} orgId={orgId!} collectionId={collectionId!} currency={collection.currency} onClose={() => setShowAssignModal(false)} />}

      {/* MODAL 4: REVERSE PAYMENT */}
      <Modal
        isOpen={Boolean(showReverseModal && paymentToReverse)}
        onClose={() => setShowReverseModal(false)}
        maxWidth="lg"
        className="border-sem-error-border"
      >
        {paymentToReverse && (
          <>
            <button
              onClick={() => setShowReverseModal(false)}
              className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Badge >
                AUDITED ACTION
              </Badge>
            </div>
            <h2 className="text-primary mb-1 section-title">
              Reverse Payment
            </h2>
            <p className="text-xs text-secondary mb-5 leading-relaxed">
              Reversing receipt <strong className="text-primary font-mono">{paymentToReverse.receipt_number}</strong> for <strong className="text-primary font-mono">{formatMoney(paymentToReverse.amount_centavos, collection.currency)}</strong>. The member's balance will automatically be updated.
            </p>

            {actionError && (
              <div className="mb-4 p-3 rounded-xl bg-sem-error-bg border border-sem-error-border text-sem-error-fg text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-sem-error-fg" />
                <p>{actionError}</p>
              </div>
            )}

            <form onSubmit={handleReverseSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  Mandatory Reversal Reason
                </label>
                <textarea
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="Specify reason (e.g. Counterfeit bill, duplicate payment, transfer bounced)…"
                  rows={3}
                  className="w-full rounded-2xl bg-elevated border border-subtle p-3.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-rose-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-subtle">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReverseModal(false)}
                >
                  Cancel
                </Button>
                <button
                  type="submit"
                  disabled={reversePaymentMutation.isPending || reversalReason.trim().length < 3}
                  className="px-5 py-2.5 rounded-full bg-danger-action hover:bg-danger-action-hover text-white text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {reversePaymentMutation.isPending ? "Reversing…" : "Confirm Reversal"}
                </button>
              </div>
            </form>
          </>
        )}
      </Modal>

      {/* MODAL 5: EDIT COLLECTION */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        maxWidth="lg"
      >
        <button
          onClick={() => setShowEditModal(false)}
          className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <Badge >
            Modify Collection
          </Badge>
        </div>
        <h2 className="text-primary mb-1 section-title">
          Edit Campaign
        </h2>
        <p className="text-xs text-secondary mb-6">
          Update dues title, target amount, due date, status, or linked space.
        </p>

        {actionError && (
          <div className="mb-4 p-3 rounded-xl bg-sem-error-bg border border-sem-error-border text-sem-error-fg text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-sem-error-fg" />
            <p>{actionError}</p>
          </div>
        )}

        <form onSubmit={handleEditSubmit} className="space-y-4">
          <Input
            label="Campaign Title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={`Target Goal (${collection.currency})`}
              type="number"
              step="0.01"
              min="0"
              value={editTargetInput}
              onChange={(e) => setEditTargetInput(e.target.value)}
            />

            <DatePicker
              label="Due Date"
              value={editDueDate}
              onChange={setEditDueDate}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Assign to Project (Optional)"
              value={editSpaceId}
              onChange={(e) => setEditSpaceId(e.target.value)}
              options={[
                { value: "", label: "Organization-wide (General)" },
                ...(spacesQuery.data ?? []).filter(s => s.status === "active" || s.id === collection.space_id).map((s) => ({ value: s.id, label: s.name })),
              ]}
            />

            <Select
              label="Reporting Period (Optional)"
              value={editReportingPeriodId}
              onChange={(e) => setEditReportingPeriodId(e.target.value)}
              options={[
                { value: "", label: "No specific period" },
                ...(periodsQuery.data ?? []).map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>

          <Select
            label="Campaign Status"
            value={editStatus}
            onChange={(e) => setEditStatus(e.target.value as "active" | "closed" | "archived")}
            options={[
              { value: "active", label: "Active (Accepting payments)" },
              { value: "closed", label: "Closed (No new payments accepted)" },
            ]}
          />

          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Campaign Description
            </label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={2}
              className="w-full rounded-2xl bg-elevated border border-subtle p-3.5 text-sm text-primary focus:outline-none focus:border-strong font-body"
            />
          </div>

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
              disabled={updateMutation.isPending || !editTitle.trim()}
            >
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 6: DELETE / ARCHIVE COLLECTION */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        maxWidth="md"
        className="space-y-5"
      >
        <button
          onClick={() => setShowDeleteModal(false)}
          className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 rounded-2xl bg-sem-error-bg border border-sem-error-border flex items-center justify-center text-sem-error-fg">
          <AlertTriangle className="w-6 h-6" />
        </div>

        <div>
          <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
            Delete "{collection.title}"?
          </h3>
          <p className="text-xs text-secondary mt-2 leading-relaxed">
            Deletion is permanent and removes any unpaid dues created at setup that are still untouched. Use Archive to keep collections with later dues activity or payments out of the active list.
          </p>
              <Input label="Type the collection name to confirm" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} />
        </div>

        {actionError && (
          <div className="p-3 rounded-xl bg-sem-error-bg border border-sem-error-border text-sem-error-fg text-xs">
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
            isLoading={deleteMutation.isPending} disabled={deleteConfirmation !== collection.title}
            className="flex-1"
          >
            Delete collection
          </Button>
        </div>
      </Modal>
    </div>
  );
}
