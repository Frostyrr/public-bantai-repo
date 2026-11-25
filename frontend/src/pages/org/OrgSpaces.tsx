import Badge from "../../components/ui/Badge";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import Pagination from "../../components/ui/Pagination";
import RecordActions from "../../components/org/shared/RecordActions";
import React, { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, X, Calendar, Layers, Edit2, AlertTriangle } from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import FormDraftControls from "../../components/ui/FormDraftControls";
import { useFormDraft } from "../../hooks/useFormDraft";
import Modal from "../../components/ui/Modal";
import {
  getSpaces,
  createSpace,
  updateSpace,
  deleteSpace,
  type OrganizationDetails,
  type Membership,
  type Space,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import { SpacesGridSkeleton } from "../../components/layout/WorkspaceSkeletons";

interface ContextType {
  organization: OrganizationDetails;
  membership: Membership;
}

export default function OrgSpaces() {
  const { organization, membership } = useOutletContext<ContextType>();
  const queryClient = useQueryClient();

  const isOfficer =
    membership?.role === "owner" || membership?.role === "organization_admin";

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);

  // Form states
  const [spaceName, setSpaceName] = useState("");
  const [spaceDescription, setSpaceDescription] = useState("");
  const [spaceStatus, setSpaceStatus] = useState<"active" | "archived">("active");
  const [actionError, setActionError] = useState("");

  const createDraft = useFormDraft({
    orgId: organization.id,
    form: "space",
    open: showCreateModal,
    values: { spaceName, spaceDescription },
    restore: (v) => {
      setSpaceName(v.spaceName);
      setSpaceDescription(v.spaceDescription);
    },
  });

  const editDraft = useFormDraft({
    orgId: organization.id,
    form: "space",
    open: Boolean(showEditModal && selectedSpace),
    recordId: selectedSpace?.id,
    version: selectedSpace ? `${selectedSpace.name}:${selectedSpace.description ?? ""}:${selectedSpace.status}` : undefined,
    values: { spaceName, spaceDescription, spaceStatus },
    restore: (v) => {
      setSpaceName(v.spaceName);
      setSpaceDescription(v.spaceDescription);
      setSpaceStatus(v.spaceStatus);
    },
  });

  const spacesQuery = useQuery({
    queryKey: ["organization-spaces", organization?.id],
    queryFn: () => getSpaces(organization.id),
    enabled: Boolean(organization?.id),
  });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string }) =>
      createSpace(organization.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organization-spaces", organization?.id],
      });
      createDraft.complete(undefined);
      setShowCreateModal(false);
      setSpaceName("");
      setSpaceDescription("");
      setActionError("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string; status?: "active" | "archived" }) => {
      if (!selectedSpace) throw new Error("No space selected");
      return updateSpace(organization.id, selectedSpace.id, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organization-spaces", organization?.id],
      });
      editDraft.complete(undefined);
      setShowEditModal(false);
      setSelectedSpace(null);
      setActionError("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!selectedSpace) throw new Error("No space selected");
      return deleteSpace(organization.id, selectedSpace.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organization-spaces", organization?.id],
      });
      setShowDeleteModal(false);
      setSelectedSpace(null);
      setActionError("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!spaceName.trim()) return;
    setActionError("");
    createMutation.mutate({
      name: spaceName.trim(),
      description: spaceDescription.trim() || undefined,
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!spaceName.trim()) return;
    setActionError("");
    updateMutation.mutate({
      name: spaceName.trim(),
      description: spaceDescription.trim() || undefined,
      status: spaceStatus,
    });
  };

  const openEditModal = (space: Space) => {
    setSelectedSpace(space);
    setSpaceName(space.name);
    setSpaceDescription(space.description || "");
    setSpaceStatus(space.status === "archived" ? "archived" : "active");
    setActionError("");
    setShowEditModal(true);
  };

  const openDeleteModal = (space: Space) => {
    setSelectedSpace(space);
    setActionError("");
    setShowDeleteModal(true);
  };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const spaces = (spacesQuery.data ?? []).filter(space =>
    (status === "all" || status === space.status)
    && [space.name, space.description ?? ""].some(value => value.toLowerCase().includes(search.trim().toLowerCase()))
  );

  const visiblePage = Math.min(page, Math.max(1, Math.ceil(spaces.length / pageSize)));

  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <div
        data-tour="projects-header"
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6"
      >
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="context" className="page-header-eyebrow">
              Initiatives &amp; Events
            </Badge>
          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">Projects</span>
          </h1>
          <p className="page-subtitle">
            Group collections, budgets, expenses, and cash advances for an event, initiative, or ongoing program.
          </p>
        </div>

        {isOfficer && (
          <Button
            data-tour="projects-create"
            variant="primary"
            size="sm"
            onClick={() => {
              setActionError("");
              setSpaceName("");
              setSpaceDescription("");
              setShowCreateModal(true);
            }}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Create Project
          </Button>
        )}
      </div>

      <div data-tour="projects-filters" className="filter-toolbar">
        <input type="search" aria-label="Search projects" placeholder="Search projects…" value={search}
          onChange={event => { setSearch(event.target.value); setPage(1); }}
          className="toolbar-search h-10 min-w-0 flex-1 rounded-xl border border-subtle bg-elevated text-primary px-3 text-sm placeholder:text-muted focus:outline-none focus:border-strong" />
        <select aria-label="Project status" value={status}
          onChange={event => { setStatus(event.target.value); setPage(1); }}
          className="h-10 rounded-xl border border-subtle bg-elevated text-primary px-3 text-sm focus:outline-none focus:border-strong">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Loading & Error States */}
      {spacesQuery.isPending && <SpacesGridSkeleton count={6} />}

      {spacesQuery.error && (
        <div role="alert" className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-sm">
          <p>{formatErrorMessage(spacesQuery.error)}</p>
        </div>
      )}

      {/* Empty State */}
      {!spacesQuery.isPending && spaces.length === 0 && (
        <div data-tour="projects-empty">
        <ModuleEmptyState>
          <div className="w-12 h-12 rounded-2xl bg-elevated border border-subtle flex items-center justify-center mb-4 text-secondary">
            <FolderKanban className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary mb-2 tracking-tight">
            {search || status !== "all" ? "No matching projects" : "No projects created yet"}
          </h3>
          <p className="text-secondary text-xs sm:text-sm max-w-md mb-6 leading-relaxed">
            Projects are optional. Group collections, budgets, expenses, and cash advances for an event, initiative, or ongoing program—such as a General Assembly or Fundraising Drive.
          </p>
          {isOfficer && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setActionError("");
                setShowCreateModal(true);
              }}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Create First Project
            </Button>
          )}
        </ModuleEmptyState>
        </div>
      )}

      {/* Projects Grid */}
      {spaces.length > 0 && (
        <div data-tour="projects-list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {spaces.slice((visiblePage - 1) * pageSize, visiblePage * pageSize).map((space: Space) => (
            <div
              key={space.id}
              className="relative card-specular-interactive min-w-0 p-6 rounded-xl bg-surface border border-subtle card-interactive flex flex-col shadow-xs dark:shadow-none"
            >
              <div className="pb-6">
                <div className="flex min-h-10 items-center justify-between gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-primary">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div className="relative z-10 flex items-center gap-2">
                    <Badge >
                      {space.status}
                    </Badge>

                    {isOfficer && <RecordActions cardHeader title={space.name}
                      onEdit={() => openEditModal(space)} onDelete={() => openDeleteModal(space)} />}
                  </div>
                </div>

                <h3 title={space.name} className="line-clamp-2 wrap-anywhere text-xl font-heading font-medium text-primary tracking-tight">
                  <Link to={space.id} className="after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-strong">{space.name}</Link>
                </h3>

                <p className="text-xs text-secondary mt-2 line-clamp-2 wrap-anywhere leading-relaxed">
                  {space.description || "No description provided for this project."}
                </p>
              </div>

              <div className="mt-auto pt-4 border-t border-subtle flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs text-secondary font-mono">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(space.created_at).toLocaleDateString()}
                </span>
                <span className="text-muted">Project</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {spaces.length > 6 && <div className="pt-2">
        <Pagination className="border-0! px-0!" currentPage={visiblePage} totalItems={spaces.length} pageSize={pageSize}
          onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} pageSizeOptions={[6, 12, 24]} />
      </div>}

      {/* Modal: Create Space */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        maxWidth="md"
      >
        <button
          type="button"
          onClick={() => setShowCreateModal(false)}
          className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-primary">
            <FolderKanban className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
            Create Project
          </h3>
        </div>

        <p className="text-xs text-secondary font-body mb-6 leading-relaxed">
          Group collections, budgets, expenses, and cash advances for an event, initiative, or ongoing program within <strong className="text-primary">{organization.name}</strong>. Projects are optional.
        </p>

        {actionError && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs">
            {actionError}
          </div>
        )}

        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <Input
            label="Project Name"
            placeholder="e.g. General Assembly, Fundraising Drive"
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
            required
            disabled={createMutation.isPending}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-body font-normal text-secondary">
              Description (Optional)
            </label>
            <textarea
              rows={3}
              placeholder="Goals, target budget, or event scope..."
              value={spaceDescription}
              onChange={(e) => setSpaceDescription(e.target.value)}
              disabled={createMutation.isPending}
              className="bg-elevated border border-subtle text-primary rounded-2xl p-3 text-xs focus:outline-none focus:border-strong resize-none font-body placeholder:text-muted"
            />
          </div>

          <FormDraftControls draft={createDraft} busy={createMutation.isPending} />
          <div className="pt-1">
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={createMutation.isPending}
              disabled={spaceName.trim().length < 2}
            >
              Create Project
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Edit Project */}
      <Modal
        isOpen={Boolean(showEditModal && selectedSpace)}
        onClose={() => {
          setShowEditModal(false);
          setSelectedSpace(null);
        }}
        maxWidth="md"
      >
        {selectedSpace && (
          <>
            <button
              type="button"
              onClick={() => {
                setShowEditModal(false);
                setSelectedSpace(null);
              }}
              className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-primary">
                <Edit2 className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
                Edit Project
              </h3>
            </div>

            {actionError && (
              <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs">
                {actionError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <Input
                label="Project Name"
                value={spaceName}
                onChange={(e) => setSpaceName(e.target.value)}
                required
                disabled={updateMutation.isPending}
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-body font-normal text-secondary">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={spaceDescription}
                  onChange={(e) => setSpaceDescription(e.target.value)}
                  disabled={updateMutation.isPending}
                  className="bg-elevated border border-subtle text-primary rounded-2xl p-3 text-xs focus:outline-none focus:border-strong resize-none font-body"
                />
              </div>

              <Select
                label="Status"
                value={spaceStatus}
                onChange={(e) => setSpaceStatus(e.target.value as "active" | "archived")}
                options={[
                  { value: "active", label: "Active" },
                  { value: "archived", label: "Archived" },
                ]}
              />

              <FormDraftControls draft={editDraft} busy={updateMutation.isPending} />
              <div className="pt-1 flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  className="flex-1"
                  isLoading={updateMutation.isPending}
                  disabled={spaceName.trim().length < 2}
                >
                  Save Changes
                </Button>
              </div>
            </form>
          </>
        )}
      </Modal>

      {/* Modal: Delete Confirmation */}
      <Modal
        isOpen={Boolean(showDeleteModal && selectedSpace)}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedSpace(null);
        }}
        maxWidth="md"
        className="space-y-5"
      >
        {selectedSpace && (
          <>
            <button
              type="button"
              onClick={() => {
                setShowDeleteModal(false);
                setSelectedSpace(null);
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
                Delete "{selectedSpace.name}"?
              </h3>
              <p className="text-xs text-secondary mt-2 leading-relaxed">
                If this project contains linked collections, budgets, or expenditures, it will be safely <strong className="text-primary">archived</strong> instead of permanently destroyed to protect audit history.
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
