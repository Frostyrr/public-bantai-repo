import { isValidAmountInput } from "../../lib/formValidation";
import FormDraftControls from "../../components/ui/FormDraftControls";
import { useFormDraft, unavailableDraftSelection } from "../../hooks/useFormDraft";
import useFinancialQuery from "../../hooks/useFinancialQuery";
import { useSpaceRouteFilter } from "../../hooks/useSpaceRouteFilter";
import AnimatedNumber from "../../components/ui/AnimatedNumber";
import CompactAmount from "../../components/ui/CompactAmount";
import Badge from "../../components/ui/Badge";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import Pagination from "../../components/ui/Pagination";
import RecordActions from "../../components/org/shared/RecordActions";
import { toast } from "../../lib/toast";
import WizardDialog from "../../components/ui/WizardDialog";
import API from "../../config/apiClient";
import { isAxiosError } from "axios";
import { parseDuesAmount, duesMoney } from "../../utils/duesAssignment";
import CollectionScopePicker from "../../components/org/collections/CollectionScopePicker";
import { defaultCollectionScope,validCollectionScope } from "../../lib/collectionScope";
import FinancialQueryState from '../../components/layout/FinancialQueryState';
import React, { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt,
  Plus,
  Search,
  Filter,
  Layers,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  X,
  AlertTriangle,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import DatePicker from "../../components/ui/DatePicker";
import Modal from "../../components/ui/Modal";
import {
  createCollection,
  updateCollection,
  deleteCollection,
  getSpaces,
  getReportingPeriods,
  type OrganizationDetails,
  type Membership,
  type CreateCollectionPayload,
  type Collection,
} from "../../lib/api";
import { getCollection } from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";

interface ContextType {
  activePeriodId: string;
  organization: OrganizationDetails;
  membership: Membership;
}

export default function OrgCollections() {
  const [requestedSpace, setSelectedSpaceId] = useSpaceRouteFilter();
  const { organization, membership, activePeriodId } = useOutletContext<ContextType>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [searchQuery, setSearchQuery] = useState("");
  const selectedSpaceId = requestedSpace || "all";
  const [previousSpace, setPreviousSpace] = useState(selectedSpaceId);
  if (previousSpace !== selectedSpaceId) {
    setPreviousSpace(selectedSpaceId);
    setPage(1);
  }
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [createStep, setCreateStep] = useState(1);
  const [contribution, setContribution] = useState("");
  const [automatic, setAutomatic] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [review, setReview] = useState<{eligible:number;totalCentavos:string;token:string}>();
  const amount = parseDuesAmount(contribution);
  const [memberScope,setMemberScope]=useState(defaultCollectionScope);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [scopeTouched, setScopeTouched] = useState(false);
  const [actionError, setActionError] = useState("");

  // Modal form states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [targetAmountInput, setTargetAmountInput] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [collectionStatus, setCollectionStatus] = useState<"active" | "closed" | "archived">("active");

  const isOfficer =
    membership?.role === "owner" ||
    membership?.role === "organization_admin" ||
    membership?.role === "treasurer";

  // Data Queries
  const collectionsQuery = useFinancialQuery("collections", organization.id, { periodId: activePeriodId, spaceId: selectedSpaceId, status: selectedStatus });

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

  const collectionVersion = (row: Collection) => JSON.stringify([row.title, row.description, row.space_id, row.target_amount_centavos, row.due_date, row.status]);
  const draft = useFormDraft({
    orgId: organization.id, form: "collection", open: showCreateModal || showEditModal,
    recordId: showEditModal ? selectedCollection?.id : undefined,
    version: showEditModal && selectedCollection ? collectionVersion(selectedCollection) : "",
    values: {
      title, description, spaceId, targetAmountInput, dueDate,
      collectionStatus: showEditModal ? collectionStatus : undefined,
      periodId: showEditModal ? undefined : periodId,
      memberScope: showEditModal ? undefined : memberScope,
      contribution: showEditModal ? undefined : contribution,
      automatic: showEditModal ? undefined : automatic,
    },
    verifyEdit: async (id, signal) => {
      const row = await getCollection(organization.id, id, signal);
      if (!isOfficer || row.status === "archived") throw Error("This collection can no longer be edited.");
      return {
        version: collectionVersion(row),
        values: { title: row.title, description: row.description || "", spaceId: row.space_id || "",
          targetAmountInput: row.target_amount_centavos ? (row.target_amount_centavos / 100).toFixed(2) : "",
          dueDate: row.due_date ? row.due_date.slice(0, 10) : "", collectionStatus: row.status,
          periodId: undefined, memberScope: undefined, contribution: undefined, automatic: undefined },
        adopt: () => setSelectedCollection(row),
      };
    },
    restore: v => {
      setTitle(v.title);
      setDescription(v.description);
      setSpaceId(v.spaceId);
      if (v.periodId !== undefined) setPeriodId(v.periodId);
      setTargetAmountInput(v.targetAmountInput);
      setDueDate(v.dueDate);
      if (v.collectionStatus !== undefined) setCollectionStatus(v.collectionStatus);
      if (v.memberScope !== undefined) setMemberScope(v.memberScope);
      if (v.contribution !== undefined) setContribution(v.contribution);
      if (v.automatic !== undefined) setAutomatic(v.automatic);
      setCreateStep(1);
      setReview(undefined);
      setScopeTouched(false);
    },
  });

  const preview = useMutation({
    mutationFn: async () => (await API.post<{eligible:number;totalCentavos:string;token:string}>(
      `/organizations/${organization.id}/collections/creation-review`, {...memberScope,amount},
    )).data,
    onSuccess: result => { setReview(result); setCreateStep(3); },
    onError: error => setActionError(formatErrorMessage(error)),
  });
  const createMutation = useMutation({
    mutationFn: (payload: CreateCollectionPayload) =>
      createCollection(organization.id, payload),
    onMutate: draft.submission,
    onSuccess: (_result, _variables, ticket) => {
      draft.complete(ticket);
      toast.success("Collection created");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["collections", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["collection", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["user-obligations"] }),
      ]);
      setShowCreateModal(false);
      resetForm();
    },
    onError: (err) => {
      if (isAxiosError<{preview?:typeof review}>(err) && err.response?.status === 409 && err.response.data.preview) {
        setReview(err.response.data.preview);
        setActionError("Eligible members changed. Review the new total before creating the collection.");
        return;
      }
      toast.error("Could not create collection", { id: "collection-creation-error", duration: 7000, description: "Review the collection details and try again." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      description?: string;
      targetCentavos?: number;
      dueDate?: string;
      spaceId?: string;
      status?: "active" | "closed" | "archived";
    }) => {
      if (!selectedCollection) throw new Error("No collection selected");
      return updateCollection(organization.id, selectedCollection.id, payload);
    },
    onMutate: draft.submission,
    onSuccess: (_result, _variables, ticket) => {
      draft.complete(ticket);
      toast.success("Collection updated");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["collections", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["collection", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["user-obligations"] }),
      ]);
      setShowEditModal(false);
      setSelectedCollection(null);
      resetForm();
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!selectedCollection) throw new Error("No collection selected");
      return deleteCollection(organization.id, selectedCollection.id, deleteConfirmation);
    },
    onSuccess: (result) => {
      toast.success(result.action === "archived" ? "Collection archived" : "Collection deleted",
        result.action === "archived" ? { description: "The collection’s dues and payment history were preserved." } : undefined);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["collections", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["collection", organization.id] }),
        queryClient.invalidateQueries({ queryKey: ["user-obligations"] }),
      ]);
      void queryClient.invalidateQueries({ queryKey: ["collection-archives", organization.id] });
      setShowDeleteModal(false);
      setSelectedCollection(null);
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const resetForm = () => {
    setMemberScope(defaultCollectionScope);
    setCreateStep(1);
    setScopeTouched(false); setContribution(""); setAutomatic(false); setReview(undefined); setRequestId(crypto.randomUUID());
    setTitle("");
    setDescription("");
    setSpaceId((spacesQuery.data ?? []).find(space => space.id === requestedSpace && space.status === "active")?.id ?? "");
    setPeriodId("");
    setTargetAmountInput("");
    setDueDate("");
    setCollectionStatus("active");
    setActionError("");
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.enabled && (draft.blocked || unavailableDraftSelection(spaceId, spacesQuery.data) || unavailableDraftSelection(periodId, periodsQuery.data))) {
      setActionError("Review the draft and choose an available space and reporting period.");
      return;
    }
    if (createMutation.isPending || preview.isPending) return;
    setActionError("");
    const targetVal = parseDuesAmount(targetAmountInput || "0");
    if (title.trim().length < 2 || title.trim().length > 150 || targetVal === null) {
      setActionError("Enter a collection name of 2–150 characters and a valid target amount.");
      return;
    }
    if (createStep === 1) { setCreateStep(2); return; }
    if (!validCollectionScope(memberScope) || amount === null || amount <= 0) {
      setScopeTouched(true);
      requestAnimationFrame(() => document.getElementById("collection-create-member-scope")?.focus());
      return;
    }
    if (createStep === 2) { preview.mutate(); return; }
    if (!review || review.eligible > 500) return;
    createMutation.mutate({
      memberScope,
      assessment: { amount, automatic, token:review.token, requestId },
      title: title.trim(),
      description: description.trim() || undefined,
      spaceId: spaceId || undefined,
      periodId: periodId || undefined,
      targetCentavos: targetVal,
      dueDate: dueDate || undefined,
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.enabled && (draft.blocked || unavailableDraftSelection(spaceId, spacesQuery.data))) {
      setActionError("Review the draft and choose an available space.");
      return;
    }
    if (!title.trim()) return;
    if (!isValidAmountInput(targetAmountInput, 0, false)) { setActionError("Enter a nonnegative target with up to two decimal places."); return; }

    const targetVal = parseFloat(targetAmountInput) || 0;

    updateMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      targetCentavos: targetVal > 0 ? Math.round(targetVal * 100) : 0,
      dueDate: dueDate || undefined,
      spaceId: spaceId || undefined,
      status: collectionStatus,
    });
  };

  const openEditModal = (c: Collection) => {
    setSelectedCollection(c);
    setTitle(c.title);
    setDescription(c.description || "");
    setSpaceId(c.space_id || "");
    setPeriodId(c.reporting_period_id || "");
    setTargetAmountInput(c.target_amount_centavos ? (c.target_amount_centavos / 100).toFixed(2) : "");
    setDueDate(c.due_date ? c.due_date.slice(0, 10) : "");
    setCollectionStatus(c.status || "active");
    setActionError("");
    setShowEditModal(true);
  };

  const openDeleteModal = (c: Collection) => {
    setSelectedCollection(c);
    setActionError("");
    setDeleteConfirmation("");
                    setShowDeleteModal(true);
  };

  const collections = collectionsQuery.data ?? [];

  const filteredCollections = collections.filter(c => c.status !== "archived").filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalCollectedCentavos = collections.reduce(
    (sum, c) => sum + (c.total_collected_centavos || 0),
    0
  );
  const totalTargetCentavos = collections.reduce(
    (sum, c) => sum + (c.target_amount_centavos || 0),
    0
  );
  const collectionRate =
    totalTargetCentavos > 0
      ? Math.min(100, Math.round((totalCollectedCentavos / totalTargetCentavos) * 100))
      : 0;

  const visiblePage = Math.min(page, Math.max(1, Math.ceil(filteredCollections.length / pageSize)));

  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <div data-tour="collections-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="context" className="page-header-eyebrow">
              Receivables &amp; Dues
            </Badge>
          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">Collections &amp; Dues</span>
          </h1>
          <p className="page-subtitle">
            Create collection campaigns, assess member dues, and track electronic receipts with complete accountability.
          </p>
        </div>

        {isOfficer && (
          <div data-tour="collections-create" className="flex items-center gap-2.5 flex-wrap">
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
              New Collection
            </Button>
          </div>
        )}
      </div>

      {collectionsQuery.data === undefined ? (
        <FinancialQueryState queries={[collectionsQuery]} variant="cards" kpiCount={3} />
      ) : (
        <>
      {/* Aggregate Financial Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Total Received</span>
            <Receipt className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary">
            <CompactAmount centavos={totalCollectedCentavos} currency={organization.currency} animate />
          </p>
          <p className="text-xs text-secondary mt-1">
            Target: <CompactAmount centavos={totalTargetCentavos} currency={organization.currency} />
          </p>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Overall Progress</span>
            <TrendingUp className="w-4 h-4 text-secondary" />
          </div>
          <p className="metric-value text-primary">
            <AnimatedNumber value={collectionRate} format={(v) => `${Math.round(v)}%`} />
          </p>
          <div className="w-full bg-progress-track rounded-full h-1.5 mt-2.5 overflow-hidden">
            <div
              className="bg-progress-fill dark:bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${collectionRate}%` }}
            />
          </div>
        </div>

        <div className="kpi-card p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="field-label">Active Campaigns</span>
            <Clock className="w-4 h-4 text-secondary" />
          </div>
          <p className="metric-value text-primary">
            <AnimatedNumber value={collections.filter((c) => c.status === "active").length} />
          </p>
          <p className="text-xs text-secondary mt-1">
            {collections.length} total campaigns created
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div data-tour="collections-filters" className="filter-toolbar">
        <div className="toolbar-search relative flex-1">
          <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search campaigns by name or description…"
            className="w-full bg-elevated border border-subtle rounded-full pl-10 pr-4 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors font-body"
          />
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={selectedSpaceId}
            onChange={(e) => setSelectedSpaceId(e.target.value)}
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
            onChange={(e) => setSelectedStatus(e.target.value)}
            variant="pill"
            selectSize="sm"
            icon={<Filter className="w-3.5 h-3.5 text-zinc-400" />}
            menuWidth="auto"
            options={[
              { value: "all", label: "All Statuses" },
              { value: "active", label: "Active" },
              { value: "closed", label: "Closed" },
            ]}
          />
        </div>
      </div>

      {/* Error State */}

      {collectionsQuery.error && (
        <div role="alert" className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-sm">
          <p>{formatErrorMessage(collectionsQuery.error)}</p>
        </div>
      )}

      {/* Empty State */}
      {collectionsQuery.isSuccess && filteredCollections.length === 0 && (
        <ModuleEmptyState>
          <div className="w-12 h-12 rounded-2xl bg-elevated border border-subtle flex items-center justify-center mb-4 text-secondary">
            <Receipt className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary mb-2 tracking-tight">
            {searchQuery ? "No matching collections found" : "No collections created yet"}
          </h3>
          <p className="text-secondary text-xs sm:text-sm max-w-md mb-6 leading-relaxed">
            {searchQuery
              ? "Try adjusting your search keywords or filter options."
              : "Create your first collection campaign to assess member dues, track individual obligations, and record payments."}
          </p>
          {isOfficer && !searchQuery && (
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
              Create First Collection
            </Button>
          )}
        </ModuleEmptyState>
      )}

      {/* Collections Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredCollections.slice((visiblePage - 1) * pageSize, visiblePage * pageSize).map((coll) => {
          const collected = coll.total_collected_centavos || 0;
          const target = coll.target_amount_centavos || 0;
          const pct = target > 0 ? Math.min(100, Math.round((collected / target) * 100)) : 0;
          const totalObligations = coll.total_obligations_count || 0;
          const paidObligations = coll.paid_obligations_count || 0;

          return (
            <div
              key={coll.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button, a")) return;
                navigate(`/app/org/${organization.id}/collections/${coll.id}`);
              }}
              className="card-specular-interactive min-w-0 p-6 rounded-xl bg-surface border border-subtle card-interactive flex flex-col group cursor-pointer shadow-xs dark:shadow-none transition-all duration-200 hover:-translate-y-0.5 hover:border-strong hover:shadow-md"
            >
              <div className="pb-6">
                {/* Meta Badges */}
                <div className="flex min-h-10 items-center justify-between gap-2 mb-3">
                  <div className="flex min-w-0 items-center gap-2 flex-wrap">
                    <Badge >
                      {coll.status}
                    </Badge>

                    {coll.spaces && (
                      <Badge variant="context" className="max-w-full" >
                        Project: {coll.spaces.name}
                      </Badge>
                    )}

                    {coll.reporting_periods && (
                      <Badge className="max-w-full" >
                        {coll.reporting_periods.name}
                      </Badge>
                    )}
                  </div>

                  <RecordActions cardHeader title={coll.title} onView={() => navigate(`/app/org/${organization.id}/collections/${coll.id}`)}
                    onEdit={isOfficer && coll.status !== "archived" ? () => openEditModal(coll) : undefined}
                    archive={isOfficer ? { org: organization.id, id: coll.id, kind: "collection", archived: coll.status === "archived" } : undefined}
                    onDelete={isOfficer && coll.status !== "archived" && !collected && !paidObligations ? () => openDeleteModal(coll) : undefined} />
                </div>

                {/* Title & Description */}
                <Link
                  to={`/app/org/${organization.id}/collections/${coll.id}`}
                  className="block group-hover:text-primary transition-colors"
                >
                  <h3 title={coll.title} className="line-clamp-2 wrap-anywhere text-xl font-heading font-medium text-primary transition-colors tracking-tight">
                    {coll.title}
                  </h3>
                </Link>
                {coll.description && (
                  <p className="text-xs text-secondary mt-2 line-clamp-2 wrap-anywhere leading-relaxed">
                    {coll.description}
                  </p>
                )}

                {/* Financial Progress Bar */}
                <div className="mt-5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-secondary">Collected Progress</span>
                    <span className="font-mono tabular-nums text-primary font-medium">{pct}%</span>
                  </div>
                  <div className="w-full bg-progress-track h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-progress-fill dark:bg-emerald-400 h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 items-baseline gap-3 pt-1">
                    <div>
                      <span className="text-[11px] text-secondary block">Collected</span>
                      <span className="wrap-anywhere tabular-nums text-sm font-mono font-medium text-primary">
                        <CompactAmount centavos={collected} currency={coll.currency} />
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-secondary block">Target</span>
                      <span className="wrap-anywhere tabular-nums text-sm font-mono text-secondary">
                        <CompactAmount centavos={target} currency={coll.currency} />
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Footer */}
              <div className="mt-auto pt-4 border-t border-subtle flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs text-secondary">
                <span className="font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-secondary" />
                  {paidObligations} / {totalObligations} paid
                </span>

                <Link
                  to={`/app/org/${organization.id}/collections/${coll.id}`}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-subtle bg-elevated px-3 py-1.5 text-xs font-medium text-primary transition-all group-hover:border-strong group-hover:bg-action group-hover:text-action-fg"
                >
                  Manage Roster <ArrowRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {filteredCollections.length > 6 && <div className="pt-2">
        <Pagination className="border-0! px-0!" currentPage={visiblePage} totalItems={filteredCollections.length} pageSize={pageSize}
          onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} pageSizeOptions={[6, 12, 24]} />
      </div>}
        </>
      )}

      {/* Create Collection Modal */}
      <WizardDialog isOpen={showCreateModal} onClose={() => setShowCreateModal(false)}
        title="Create Collection" steps={["Details", "Members & Dues", "Review"]} step={createStep}
        stepTitle={["Collection Details", "Who should contribute?", "Review Collection"][createStep - 1]}
        formId="create-collection-form" onSubmit={handleCreateSubmit} busy={createMutation.isPending || preview.isPending}
        footer={<><Button type="button" variant="outline" disabled={createMutation.isPending || preview.isPending}
                  onClick={()=>{setActionError(""); if(createStep===1)setShowCreateModal(false);else setCreateStep(createStep-1);}}>
                  {createStep===1?"Cancel":"Back"}
                </Button>
                <Button type="submit" form="create-collection-form" isLoading={createMutation.isPending || preview.isPending} disabled={createStep===3&&(!review||review.eligible>500)}>
                  {createStep===3?"Create Collection":"Next"}
                </Button></>}>
            {actionError && (
              <div role="alert" className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-zinc-500" />
                <p>{actionError}</p>
              </div>
            )}

            <fieldset disabled={createMutation.isPending || preview.isPending} className="min-w-0 space-y-4">
              {createStep === 1 && <>
              <Input
                label="Campaign Title"
                validationMessage={title.trim().length < 2 || title.trim().length > 150 ? "Enter a collection name of 2–150 characters." : undefined}
                placeholder="e.g. Semester Membership Dues 2026"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Description (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Outline the purpose, coverage, or guidelines for this contribution…"
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={`Target Amount (${organization.currency})`}
                  validationMessage={parseDuesAmount(targetAmountInput || "0") === null ? "Enter a nonnegative target with up to two decimal places." : undefined}
                  placeholder="e.g. 25000.00"
                  inputMode="decimal"
                  value={targetAmountInput}
                  onChange={(e) => setTargetAmountInput(e.target.value)}
                />

                <DatePicker
                  label="Due Date (Optional)"
                  value={dueDate}
                  onChange={setDueDate}
                />
              </div>

              </>}
              {showCreateModal && <div hidden={createStep !== 2}>

                <CollectionScopePicker id="collection-create-member-scope" orgId={organization.id} value={memberScope} onChange={setMemberScope}
                  error={scopeTouched && !validCollectionScope(memberScope) ? "Select at least one group or member for this collection." : undefined}/>
                <div className="mt-4 space-y-3">
                  <Input label={`Contribution per member (${organization.currency})`} required
                    validationMessage={!amount ? "Enter a positive contribution with up to two decimal places." : undefined} inputMode="decimal" placeholder="e.g. 150.00"
                    value={contribution} onChange={event=>setContribution(event.target.value)} />
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" className="mt-1 size-4 appearance-auto!" checked={automatic} onChange={event=>setAutomatic(event.target.checked)} />
                    Automatically assess future eligible members at the saved contribution
                  </label>
                  <p className="text-xs text-secondary">Manual assessment is the default. Future eligible members appear as Not Assessed.</p>
                </div>
              </div>}
              {createStep === 3 && review && <section className="space-y-2 rounded-xl border border-subtle bg-elevated p-4 text-sm">

                <p>{title}</p>{description && <p>{description}</p>}
                {dueDate && <p>Due {dueDate}</p>}
                {spaceId && <p>{spacesQuery.data?.find(space=>space.id===spaceId)?.name}</p>}
                {periodId && <p>{periodsQuery.data?.find(period=>period.id===periodId)?.name}</p>}
                {targetAmountInput && <p>Collection target · {duesMoney(organization.currency ?? "PHP",String(parseDuesAmount(targetAmountInput)))}</p>}
                <p>{({all:"All Members",groups:"Specific Groups",selected:"Selected Members"})[memberScope.scope]} · {review.eligible} eligible</p>
                <p>{duesMoney(organization.currency ?? "PHP",String(amount))} per member</p>
                <p className="font-semibold text-primary">Initial assessed dues · {duesMoney(organization.currency ?? "PHP",review.totalCentavos)}</p>
                <p>Future members · {automatic?"Automatic assessment":"Manual assessment"}</p>
                {review.eligible > 500 && <p role="alert" className="text-amber-700 dark:text-amber-400">Choose a smaller scope. Creation supports at most 500 initial obligations.</p>}
              </section>}
              <FormDraftControls draft={draft} busy={createMutation.isPending || preview.isPending} />
        </fieldset>
      </WizardDialog>

      {/* Edit Collection Modal */}
      <Modal
        isOpen={Boolean(showEditModal && selectedCollection)}
        onClose={() => {
          setShowEditModal(false);
          setSelectedCollection(null);
        }}
        maxWidth="lg"
      >
        {selectedCollection && (
          <>
            <button
              onClick={() => {
                setShowEditModal(false);
                setSelectedCollection(null);
              }}
              className="absolute top-6 right-6 p-2 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Badge >
                Update Campaign
              </Badge>
            </div>
            <h2 className="text-primary mb-1 section-title">
              Edit Collection
            </h2>

            {actionError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <p>{actionError}</p>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <Input
                label="Campaign Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
                <Input
                  label={`Target Amount (${organization.currency})`}
                  inputMode="decimal"
                  value={targetAmountInput}
                  onChange={(e) => setTargetAmountInput(e.target.value)}
                />

                <DatePicker
                  label="Due Date"
                  value={dueDate}
                  onChange={setDueDate}
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
                  value={collectionStatus}
                  onChange={(e) => setCollectionStatus(e.target.value as "active" | "closed" | "archived")}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "closed", label: "Closed" },
                        ]}
                />
              </div>

              <FormDraftControls draft={draft} busy={updateMutation.isPending} />

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
                  disabled={updateMutation.isPending || !title.trim()}
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
        isOpen={Boolean(showDeleteModal && selectedCollection)}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedCollection(null);
        }}
        maxWidth="md"
        className="space-y-5"
      >
        {selectedCollection && (
          <>
            <button
              onClick={() => {
                setShowDeleteModal(false);
                setSelectedCollection(null);
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
                Delete "{selectedCollection.title}"?
              </h3>
              <p className="text-xs text-secondary mt-2 leading-relaxed">
                Deletion is permanent and removes any unpaid dues created at setup that are still untouched. Use Archive to keep collections with later dues activity or payments out of the active list.
              </p>
              <Input label="Type the collection name to confirm" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} />
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
                isLoading={deleteMutation.isPending} disabled={deleteConfirmation !== selectedCollection.title}
                className="flex-1"
              >
                Delete collection
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
