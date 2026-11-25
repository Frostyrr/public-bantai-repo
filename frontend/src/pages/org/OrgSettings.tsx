import Badge from "../../components/ui/Badge";
import ApprovalPresetSettings from "../../components/org/settings/ApprovalPresetSettings";
import { toast } from "../../lib/toast";
import { duesMoney as formatFinancialAmount } from "../../utils/duesAssignment";
import { SUPPORTED_CURRENCIES } from "../../lib/currencies";
import API from "../../config/apiClient";
import { organizationTypes, type OrganizationType } from "../../lib/organizationTypes";
import RegionalSettings from "../../components/org/settings/RegionalSettings";
import ExpenseApprovalSettings from "../../components/org/settings/ExpenseApprovalSettings";
import useOrgOnboarding from "../../hooks/useOrgOnboarding";
import React, { useState, useRef, useEffect } from "react";
import { useOutletContext, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Plus,
  ShieldCheck,
  Building2,
  X,
  CheckCircle2,
  Copy,
  Camera,
  Check,
  Trash2,
  UploadCloud,
  AlertTriangle,
  Crown,
  ArrowRightLeft,
  Lock,
  KeyRound,
  ShieldAlert,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import Select from "../../components/ui/Select";
import DatePicker from "../../components/ui/DatePicker";
import useAuth from "../../hooks/useAuth";
import {
  getReportingPeriods,
  createReportingPeriod,
  updateOrganization,
  regenerateInviteCode,
  updateOrganizationLogo,
  getOrgDeletability,
  transferOrganizationOwnership,
  deleteOrganization,
  getOrganizationMembers,
  type OrganizationDetails,
  type Membership,
  type ReportingPeriod,
  type OrganizationMember,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";

interface ContextType {
  organization: OrganizationDetails;
  membership: Membership;
}

export default function OrgSettings() {
  const { orgId } = useParams<{ orgId: string }>();
  const { organization, membership } = useOutletContext<ContextType>();
  const queryClient = useQueryClient();
  const effectiveOrgId = organization?.id || orgId;

  // Role Permissions
  const isOwnerOrAdmin =
    membership?.role === "owner" || membership?.role === "organization_admin";
  const { data: onboarding, markOrgDetailsReviewed } = useOrgOnboarding(
    organization?.id,
    isOwnerOrAdmin,
  );
  const needsDetailsReview = Boolean(
    onboarding?.checklist.tasks.some(
      (t) => t.id === "review_org_details" && !t.completed,
    ),
  );
  const isOfficer =
    isOwnerOrAdmin || membership?.role === "treasurer" || membership?.role === "auditor";

  // Reporting Periods State
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodName, setPeriodName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [periodActionError, setPeriodActionError] = useState("");

  // Edit Organization State
  const [showEditOrgModal, setShowEditOrgModal] = useState(false);
  const [editName, setEditName] = useState(organization?.name || "");
  const [orgTypeDraft, setOrgTypeDraft] = useState<OrganizationType | "">("");
  const [syncDirectoryFields, setSyncDirectoryFields] = useState(true);
  const [settingsTab, setSettingsTab] = useState("General");
  const [editCurrency, setEditCurrency] = useState(organization?.currency || "PHP");
  const [editOrgError, setEditOrgError] = useState("");
  const [identityError, setIdentityError] = useState("");

  // Regenerate Invite Code State
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [regenerateError, setRegenerateError] = useState("");
  const [copiedId, setCopiedId] = useState(false);

  // Logo Customizer State
  const logoStorageKey = `bantai_logo_${organization?.id}`;
  const [orgLogo, setOrgLogo] = useState<string>(() => {
    return (
      organization?.logo_url ||
      (organization?.id ? localStorage.getItem(logoStorageKey) || "" : "")
    );
  });
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoMeta, setLogoMeta] = useState<{ name: string; size: string; dimensions: string } | null>(null);
  const [logoUploadError, setLogoUploadError] = useState("");
  const [isLogoDragging, setIsLogoDragging] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);


  useEffect(() => {
    const handleUpdate = () => {
      if (organization?.id) {
        setOrgLogo(
          organization?.logo_url ||
          localStorage.getItem(`bantai_logo_${organization.id}`) ||
          ""
        );
      }
    };
    window.addEventListener("bantai_logo_updated", handleUpdate);
    return () => window.removeEventListener("bantai_logo_updated", handleUpdate);
  }, [organization?.id, organization?.logo_url]);

  // Query: Organization Type
  const orgTypeQuery = useQuery({
    queryKey: ["organization-type", organization?.id],
    queryFn: async () =>
      (await API.get<{ organizationType: OrganizationType | null }>(`/organizations/${organization.id}/type`))
        .data.organizationType,
    enabled: Boolean(organization?.id),
  });

  // Query: Reporting Periods
  const periodsQuery = useQuery({
    queryKey: ["organization-periods", organization?.id],
    queryFn: () => getReportingPeriods(organization.id),
    enabled: Boolean(organization?.id),
  });

  // Mutation: Create Period
  const createPeriodMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      startDate: string;
      endDate: string;
      isDefault?: boolean;
    }) => createReportingPeriod(organization.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organization-periods", organization?.id],
      });
      setShowPeriodModal(false);
      setPeriodName("");
      setStartDate("");
      setEndDate("");
      setIsDefault(false);
      setPeriodActionError("");
    },
    onError: (err) => {
      setPeriodActionError(formatErrorMessage(err));
    },
  });

  // Mutation: Update Organization Identity (Name & Type)
  const saveIdentityMutation = useMutation({
    mutationFn: async (payload: { name?: string; organizationType?: OrganizationType; syncDirectoryFields?: boolean }) => {
      if (payload.name !== undefined) {
        await updateOrganization(organization.id, { name: payload.name });
      }
      if (payload.organizationType !== undefined) {
        await API.put(`/organizations/${organization.id}/type`, {
          organizationType: payload.organizationType,
          syncDirectoryFields: payload.syncDirectoryFields ?? false,
        });
      }
    },
    onSuccess: async (_data, variables) => {
      if (variables.organizationType !== undefined) {
        queryClient.setQueryData(["organization-type", organization.id], variables.organizationType);
        setOrgTypeDraft("");
      }
      toast.success("Organization updated");
      await queryClient.invalidateQueries({ queryKey: ["organization", organization.id] });
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await queryClient.invalidateQueries({ queryKey: [`/organizations/${organization.id}/directory`] });
      void markOrgDetailsReviewed();
      setIdentityError("");
    },
    onError: (err) => {
      setIdentityError(formatErrorMessage(err));
    },
  });

  // Mutation: Update Organization Settings
  const updateOrgMutation = useMutation({
    mutationFn: (payload: { name: string; currency?: string }) =>
      updateOrganization(organization.id, payload),
    onSuccess: async () => {
      toast.success("Organization updated");
      await queryClient.invalidateQueries({ queryKey: ["organization", organization.id] });
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setShowEditOrgModal(false);
      setEditOrgError("");
    },
    onError: (err) => {
      setEditOrgError(formatErrorMessage(err));
    },
  });

  // Mutation: Regenerate Invite Code
  const regenerateCodeMutation = useMutation({
    mutationFn: () => regenerateInviteCode(organization.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization", organization.id] });
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setShowRegenerateModal(false);
      setRegenerateError("");
    },
    onError: (err) => {
      setRegenerateError(formatErrorMessage(err));
    },
  });

  // Mutation: Update Organization Logo
  const updateLogoMutation = useMutation({
    mutationFn: (logoUrl: string | null) => updateOrganizationLogo(organization.id, logoUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization", organization.id] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: () => {
      // LocalStorage guarantees immediate persistence
    },
  });

  const isOwner = membership?.role === "owner";
  const navigate = useNavigate();
  const { user } = useAuth();

  // Transfer Ownership State
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [targetSuccessorId, setTargetSuccessorId] = useState("");
  const [formerOwnerRole, setFormerOwnerRole] = useState<"organization_admin" | "member" | "owner">("organization_admin");
  const [transferError, setTransferError] = useState("");
  const [transferSuccess, setTransferSuccess] = useState("");

  // Deletability & Organization Deletion State
  const [showDeleteOrgModal, setShowDeleteOrgModal] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteOrgError, setDeleteOrgError] = useState("");

  // Queries: Members & Deletability
  const membersQuery = useQuery({
    queryKey: ["organization-members", effectiveOrgId],
    queryFn: () => getOrganizationMembers(effectiveOrgId!),
    enabled: Boolean(effectiveOrgId),
  });

  const deletabilityQuery = useQuery({
    queryKey: ["org-deletability", effectiveOrgId],
    queryFn: () => getOrgDeletability(effectiveOrgId!),
    enabled: Boolean(effectiveOrgId),
  });

  const members: OrganizationMember[] = membersQuery.data ?? [];
  const owners = members.filter((m) => m.role === "owner");
  const primaryOwner = owners[0];
  const eligibleSuccessors = members.filter(
    (m) => m.profile_id !== user?.id && m.status === "active"
  );
  const deletability = deletabilityQuery.data;

  // Mutation: Transfer Ownership
  const transferOrgMutation = useMutation({
    mutationFn: (payload: { targetMemberId: string; currentOwnerRole?: string }) =>
      transferOrganizationOwnership(organization.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization", organization.id] });
      await queryClient.invalidateQueries({ queryKey: ["organization-members", organization.id] });
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setShowTransferModal(false);
      setTargetSuccessorId("");
      setTransferError("");
      setTransferSuccess("Ownership successfully transferred.");
      setTimeout(() => setTransferSuccess(""), 4000);
    },
    onError: (err) => {
      setTransferError(formatErrorMessage(err));
    },
  });

  // Mutation: Close Organization
  const deleteOrgMutation = useMutation({
    mutationFn: (payload: { confirmName: string }) =>
      deleteOrganization(organization.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      navigate("/app/organizations", { replace: true });
    },
    onError: (err) => {
      setDeleteOrgError(formatErrorMessage(err));
      toast.error("Could not close organization", { id: "organization-closure-error", duration: 7000 });
    },
  });

  // Copy handlers

  const handleCopyOrgId = async () => {
    if (!organization?.id) return;
    try {
      await navigator.clipboard.writeText(organization.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Submit handlers
  const handlePeriodSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodName.trim() || !startDate || !endDate) return;
    setPeriodActionError("");
    createPeriodMutation.mutate({
      name: periodName.trim(),
      startDate,
      endDate,
      isDefault,
    });
  };

  const handleEditOrgSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = editName.trim();
    if (!cleanName) {
      setEditOrgError("Workspace name cannot be empty.");
      return;
    }
    setEditOrgError("");
    updateOrgMutation.mutate({
      name: cleanName,
      currency: editCurrency,
    });
  };

  // Logo file processor
  const handleLogoFileProcess = (file: File) => {
    setLogoUploadError("");
    const validMimes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!validMimes.includes(file.type)) {
      setLogoUploadError("Invalid logo file format. Please upload a PNG, JPG, WebP, or SVG image.");
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setLogoUploadError(`Logo file size (${sizeMb} MB) exceeds the 5 MB maximum limit.`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.naturalWidth < 64 || img.naturalHeight < 64) {
        setLogoUploadError(
          `Logo resolution too small (${img.naturalWidth} × ${img.naturalHeight}px). Recommended minimum is 128 × 128px.`
        );
        return;
      }

      const canvas = document.createElement("canvas");
      const size = 512;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setLogoUploadError("Could not process logo graphics buffer.");
        return;
      }

      const minDim = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - minDim) / 2;
      const sy = (img.naturalHeight - minDim) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

      const processedDataUrl = canvas.toDataURL("image/webp", 0.9);
      setLogoPreview(processedDataUrl);
      setLogoMeta({
        name: file.name,
        size: `${(file.size / 1024).toFixed(0)} KB`,
        dimensions: `${img.naturalWidth} × ${img.naturalHeight} px (Square 512×512)`,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setLogoUploadError("Could not decode image file. The file may be corrupt.");
    };

    img.src = objectUrl;
  };

  const handleSaveLogo = () => {
    if (!logoPreview) return;
    setOrgLogo(logoPreview);
    localStorage.setItem(logoStorageKey, logoPreview);
    window.dispatchEvent(new Event("bantai_logo_updated"));
    updateLogoMutation.mutate(logoPreview);
    setShowLogoModal(false);
    setLogoPreview(null);
    setLogoMeta(null);
  };

  const handleRemoveLogo = () => {
    setOrgLogo("");
    localStorage.removeItem(logoStorageKey);
    window.dispatchEvent(new Event("bantai_logo_updated"));
    updateLogoMutation.mutate(null);
    setShowLogoModal(false);
    setLogoPreview(null);
    setLogoMeta(null);
  };

  const getInitials = (name = "") => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase() || "OR";
  };

  const periods = periodsQuery.data ?? [];

  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <Button to={`/app/org/${effectiveOrgId}/my-profile`} variant="outline" size="sm">My Profile in this organization</Button>
      <div className="border-b border-subtle pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="context" className="page-header-eyebrow">
              Workspace Administration
            </Badge>
          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">Organization Settings</span>
          </h1>
          <p className="page-subtitle">
            Manage workspace branding, base accounting currency, invitation codes, and reporting intervals.
          </p>
        </div>

      </div>

      <nav aria-label="Organization settings" className="flex items-center gap-1 overflow-x-auto border-b border-subtle pb-px">
        {(
          [
            { id: "General", label: "General", icon: Building2 },
            { id: "Approval Policies", label: "Approval Policies", icon: ShieldCheck },
            { id: "Reporting Periods", label: "Reporting Periods", icon: Calendar },
            { id: "Danger Zone", label: "Danger Zone", icon: AlertTriangle },
          ] as const
        ).map(({ id, label, icon: Icon }) => {
          const active = settingsTab === id;
          const isDanger = id === "Danger Zone";
          return (
            <button
              type="button"
              key={id}
              aria-pressed={active}
              onClick={() => setSettingsTab(id)}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong ${
                active
                  ? isDanger
                    ? "border-sem-error-fg text-sem-error-fg"
                    : "border-primary text-primary"
                  : isDanger
                    ? "border-transparent text-secondary hover:text-rose-700 dark:hover:text-rose-300"
                    : "border-transparent text-secondary hover:text-primary"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      <div className="max-w-3xl space-y-6">
        <div hidden={settingsTab !== "General"} className={settingsTab === "General" ? "space-y-6" : "hidden"}>
          {/* Section 1: Organization Identity */}
          <section className="card-specular rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-6 space-y-5">
            <div className="flex items-center gap-3 border-b border-subtle pb-4">
              <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-secondary shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-heading font-medium text-primary">Organization Identity</h2>
                <p className="text-xs text-secondary mt-0.5">Workspace branding, classification, and unique system identifier.</p>
              </div>
            </div>
            {/* Logo Preview & Quick Change */}
            <div className="p-4 rounded-2xl bg-elevated border border-subtle flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl overflow-hidden bg-surface border-2 border-subtle flex items-center justify-center font-heading font-semibold text-lg text-primary shadow-md shrink-0">
                {orgLogo ? (
                  <img src={orgLogo} alt={organization?.name} className="w-full h-full object-cover" />
                ) : (
                  getInitials(organization?.name)
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted block">
                  Workspace Logo
                </span>
                <span className="text-xs text-secondary truncate block mt-0.5">
                  {orgLogo ? "Custom photo uploaded" : "Default monogram active"}
                </span>
                {isOwnerOrAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoUploadError("");
                      setLogoPreview(null);
                      setShowLogoModal(true);
                    }}
                    className="text-xs font-mono text-secondary hover:text-primary mt-1.5 cursor-pointer inline-flex items-center gap-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Change logo</span>
                  </button>
                )}
              </div>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const trimmedName = editName.trim();
                const nameChanged = Boolean(trimmedName) && trimmedName !== organization.name;
                const typeChanged = Boolean(orgTypeDraft) && orgTypeDraft !== orgTypeQuery.data;
                if (!nameChanged && !typeChanged) return;
                setIdentityError("");
                saveIdentityMutation.mutate({
                  name: nameChanged ? trimmedName : undefined,
                  organizationType: typeChanged ? (orgTypeDraft as OrganizationType) : undefined,
                  syncDirectoryFields: typeChanged ? syncDirectoryFields : undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="org-workspace-name" className="field-label">
                    Workspace Name
                  </label>
                  <input
                    id="org-workspace-name"
                    required
                    disabled={!isOwnerOrAdmin || saveIdentityMutation.isPending}
                    value={editName}
                    onChange={(event) => {
                      setIdentityError("");
                      setEditName(event.target.value);
                    }}
                    className="block w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary hover:border-strong focus:outline-none focus:border-border-strong focus:bg-surface focus-visible:ring-2 focus-visible:ring-border-strong disabled:opacity-60 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <Select
                    label="Organization Type"
                    ariaLabel="Organization type"
                    value={orgTypeDraft || orgTypeQuery.data || ""}
                    placeholder="Unspecified"
                    disabled={!isOwnerOrAdmin || !orgTypeQuery.isSuccess || saveIdentityMutation.isPending}
                    buttonClassName="py-2.5! rounded-xl!"
                    options={organizationTypes.map((type) => ({
                      value: type.value,
                      label: type.label,
                      description: type.description,
                    }))}
                    onChange={(event) => {
                      setIdentityError("");
                      setOrgTypeDraft(event.target.value as OrganizationType);
                    }}
                  />
                </div>
              </div>

              {Boolean(orgTypeDraft) && orgTypeDraft !== orgTypeQuery.data && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-subtle bg-elevated/60 px-3.5 py-2.5 text-xs text-secondary select-none">
                  <input
                    type="checkbox"
                    checked={syncDirectoryFields}
                    disabled={saveIdentityMutation.isPending}
                    onChange={(event) => setSyncDirectoryFields(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-white"
                  />
                  <span>
                    <strong className="font-medium text-primary">
                      Add default {organizationTypes.find(t => t.value === orgTypeDraft)?.label ?? orgTypeDraft} Member Directory fields
                    </strong>{" "}
                    (keeps all existing member records and custom fields).
                  </span>
                </label>
              )}

              <div className="space-y-1.5">
                <label htmlFor="org-system-id" className="field-label">
                  System Organization ID
                </label>
                <div className="relative">
                  <input
                    id="org-system-id"
                    type="text"
                    readOnly
                    value={organization.id}
                    className="block w-full rounded-xl border border-subtle bg-elevated pl-3.5 pr-24 py-2.5 font-mono text-sm text-secondary select-all focus:outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-border-strong"
                  />
                  <button
                    type="button"
                    aria-label="Copy organization ID"
                    onClick={() => void handleCopyOrgId()}
                    className="absolute inset-y-1.5 right-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-subtle bg-surface px-2.5 text-xs font-medium text-secondary hover:bg-elevated hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                  >
                    {copiedId ? (
                      <>
                        <Check size={13} className="text-emerald-600 dark:text-emerald-400" />
                        <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {(identityError || orgTypeQuery.isError) && (
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                  {identityError || formatErrorMessage(orgTypeQuery.error)}
                </p>
              )}

              {isOwnerOrAdmin && (
                <footer className="-mx-6 mt-5 border-t border-subtle px-6 pt-4 flex flex-wrap items-center justify-end gap-2">
                  {needsDetailsReview && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void markOrgDetailsReviewed();
                        toast.success("Organization details marked as reviewed");
                      }}
                    >
                      Confirm details reviewed
                    </Button>
                  )}
                  <Button
                    type="submit"
                    size="sm"
                    isLoading={saveIdentityMutation.isPending}
                    disabled={
                      saveIdentityMutation.isPending ||
                      !editName.trim() ||
                      (editName.trim() === organization.name &&
                        (!orgTypeDraft || orgTypeDraft === orgTypeQuery.data))
                    }
                  >
                    Save Changes
                  </Button>
                </footer>
              )}
            </form>
          </section>

          {/* Section 2: Regional Settings */}
          <RegionalSettings
            key={organization.id}
            organization={organization}
            isOwnerOrAdmin={isOwnerOrAdmin}
          />

          {/* Section 3: Workspace Owner & Custody Card */}
          <div className="card-specular rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-subtle pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-secondary shrink-0">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-heading font-medium text-primary">
                    Workspace Owner
                  </h2>
                  <p className="text-xs text-secondary mt-0.5">
                    Custody &amp; primary administrative authority.
                  </p>
                </div>
              </div>

              {isOwner && eligibleSuccessors.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTransferError("");
                    setTargetSuccessorId(eligibleSuccessors[0]?.id || "");
                    setShowTransferModal(true);
                  }}
                  icon={<ArrowRightLeft className="w-3.5 h-3.5 text-secondary" />}
                  className="rounded-full text-xs shrink-0"
                >
                  Transfer
                </Button>
              )}
            </div>

            {transferSuccess && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{transferSuccess}</span>
              </div>
            )}

            {/* Owner Profile Preview */}
            {primaryOwner ? (
              <div className="p-4 rounded-2xl bg-elevated border border-subtle space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-surface border border-subtle flex items-center justify-center text-sm font-semibold text-primary overflow-hidden shrink-0 shadow-md">
                    {primaryOwner.profiles?.avatar_url ? (
                      <img
                        src={primaryOwner.profiles.avatar_url}
                        alt={primaryOwner.profiles.display_name || "Owner"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      getInitials(primaryOwner.profiles?.display_name || "Owner")
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-primary truncate">
                        {primaryOwner.profiles?.display_name || "Workspace Creator"}
                      </span>
                      <Badge >
                        <Crown className="w-3 h-3" />
                        Owner
                      </Badge>
                    </div>
                    <span className="text-[11px] font-mono text-muted block truncate mt-0.5">
                      Account ID: {primaryOwner.profile_id}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-subtle text-[11px] text-secondary leading-relaxed font-body">
                  {isOwner ? (
                    <span className="text-primary flex items-center gap-1.5 font-mono">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      You hold Root Ownership &amp; Primary Custody over this organization.
                    </span>
                  ) : (
                    <span>
                      Administrative ownership and lifecycle custody are held by {primaryOwner.profiles?.display_name || "the workspace owner"}.
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div role="status" aria-label="Loading workspace owner" className="p-4 rounded-2xl bg-elevated border border-subtle flex items-center gap-3 animate-pulse motion-reduce:animate-none">
                <div className="w-11 h-11 rounded-xl bg-skeleton shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-36 rounded bg-skeleton" />
                  <div className="h-2.5 w-48 rounded bg-skeleton" />
                </div>
              </div>
            )}

            {/* Additional Co-Owners if any */}
            {owners.length > 1 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted">
                  Co-Owners ({owners.length})
                </span>
                <div className="space-y-1">
                  {owners.slice(1).map((co) => (
                    <div
                      key={co.id}
                      className="p-2.5 rounded-xl bg-elevated border border-subtle flex items-center justify-between text-xs"
                    >
                      <span className="text-secondary truncate">
                        {co.profiles?.display_name || co.profile_id}
                      </span>
                      <span className="text-[10px] font-mono text-primary">Co-Owner</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div hidden={settingsTab !== "Approval Policies"} className="space-y-6">
          <ApprovalPresetSettings key={organization.id} org={organization.id} isOwner={isOwner} />
          <ExpenseApprovalSettings orgId={organization.id} isOwner={isOwner} />
        </div>
        <div hidden={settingsTab !== "Reporting Periods"}>          <div className="card-specular rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-5 mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-secondary" />
                  <h3 className="text-lg font-heading font-medium text-primary tracking-tight">
                    Reporting Periods
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-secondary mt-1">
                  Define temporal accounting intervals (academic semesters, fiscal quarters, or annual cycles).
                </p>
              </div>

              {isOfficer && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setPeriodActionError("");
                    setShowPeriodModal(true);
                  }}
                  icon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add Period
                </Button>
              )}
            </div>

            {periodsQuery.isPending && (
              <div role="status" aria-label="Loading reporting periods" className="space-y-2 animate-pulse motion-reduce:animate-none">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-12 rounded-xl bg-skeleton border border-subtle" />
                ))}
              </div>
            )}

            {periods.length === 0 && !periodsQuery.isPending && (
              <div className="p-8 text-center rounded-2xl bg-elevated border border-subtle">
                <p className="text-xs text-secondary max-w-md mx-auto leading-relaxed">
                  No predefined reporting periods created. Your organization currently operates in a continuous cycle. Create custom periods when ready to filter collections and budgets by term.
                </p>
              </div>
            )}

            {periods.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-elevated text-secondary font-mono text-[11px] uppercase tracking-wider border-b border-subtle">
                    <tr>
                      <th className="py-3 px-4 font-normal">Period Name</th>
                      <th className="py-3 px-4 font-normal">Date Range</th>
                      <th className="py-3 px-4 font-normal">Status</th>
                      <th className="py-3 px-4 font-normal text-right">Default</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle font-body">
                    {periods.map((p: ReportingPeriod) => (
                      <tr key={p.id} className="hover:bg-elevated/60 transition-colors">
                        <td className="py-3.5 px-4 font-medium text-primary">
                          {p.name}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-secondary">
                          {p.start_date} → {p.end_date}
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge >
                            {p.status}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {p.is_default && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-primary">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Current
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

</div>
        <div hidden={settingsTab !== "Danger Zone"} className="space-y-6">          {/* Privacy & Security Card */}
          <div className="card-specular rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-6">
            <h4 className="text-sm font-heading font-medium text-primary mb-2 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-secondary" />
              Privacy &amp; Security Policy
            </h4>
            <p className="text-xs text-secondary leading-relaxed font-body">
              All financial records, budgets, and member dues are strictly isolated to authenticated members of <strong>{organization?.name}</strong>. Officers are held accountable via immutable audit logs.
            </p>
          </div>
          <section className="card-specular rounded-xl border border-subtle bg-surface p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="section-title">Closure readiness</h3>
              {/* Status Badge */}
              <div className="shrink-0">
                {deletabilityQuery.isPending ? (
                  <Badge >
                    Checking safeguards…
                  </Badge>
                ) : !deletability ? (
                  <Badge>Unavailable</Badge>
                ) : deletability.is_deletable ? (
                  <Badge variant="success">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Eligible for Closure
                  </Badge>
                ) : (
                  <Badge variant="danger">
                    <Lock className="w-3.5 h-3.5" />
                    Closure Locked
                  </Badge>
                )}
              </div>
            </div>

            {/* Deletability Diagnostics & Financial Safeguards */}
            <div className="space-y-4">
              {deletabilityQuery.isPending ? (
                <div className="p-4 rounded-2xl bg-surface dark:bg-elevated border border-subtle text-xs text-muted font-mono">
                  Evaluating unliquidated advance safeguards and membership status…
                </div>
              ) : !deletability ? (
                <p role="status" className="text-xs text-secondary">
                  Closure readiness could not be verified.{" "}
                  <button type="button" className="cursor-pointer underline" onClick={() => void deletabilityQuery.refetch()}>
                    Try again
                  </button>
                </p>
              ) : !deletability.is_deletable ? (
                <div className="p-4 rounded-2xl bg-rose-100/70 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs leading-relaxed">
                      <span className="font-medium text-rose-900 dark:text-rose-200 block">
                        Closure Safeguards Active
                      </span>
                      <p className="text-rose-800 dark:text-rose-300/90 mt-0.5">
                        Settle outstanding cash advances before closing this workspace.
                      </p>
                    </div>
                  </div>

                  {deletability.unliquidated_count > 0 && (
                    <div className="mt-2 pt-2 border-t border-rose-200 dark:border-rose-500/20 text-xs font-mono text-primary flex items-center justify-between">
                      <span>Unliquidated Cash Advances:</span>
                      <span className="font-semibold text-rose-800 dark:text-rose-200">
                        {deletability.unliquidated_count} advance(s) ({formatFinancialAmount(organization?.currency ?? "PHP", String(deletability.unliquidated_amount_centavos))})
                      </span>
                    </div>
                  )}

                  {deletability.reasons && deletability.reasons.length > 0 && (
                    <ul className="list-disc list-inside text-[11px] text-primary space-y-1 font-mono pt-1">
                      {deletability.reasons.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-sem-success-bg border border-sem-success-border flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-sem-success-fg shrink-0 mt-0.5" />
                  <div className="text-xs text-secondary leading-relaxed font-body">
                    <span className="font-medium text-primary block mb-0.5 font-heading">
                      Zero Unliquidated Liabilities
                    </span>
                    All cash advances have been settled. The owner can close this workspace and place its records under retention review.
                  </div>
                </div>
              )}

            </div>
          </section>

          {/* Danger Zone: Organization Deletion */}
          <div className="rounded-2xl bg-sem-error-bg border border-sem-error-border shadow-(--shadow-card) dark:shadow-none p-6 transition-colors">
            <div className="border-b border-sem-error-border pb-5 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-sem-error-bg border border-sem-error-border flex items-center justify-center text-sem-error-fg shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <h3 className="text-lg font-heading font-medium text-primary tracking-tight">
                    Danger Zone · Organization Lifecycle
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-secondary mt-1.5 leading-relaxed">
                  Close this workspace and revoke member access. Financial records and receipts enter retention review.
                </p>
              </div>

            </div>
            <div>
              {/* Action bar */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-[11px] text-muted font-mono">
                  {!isOwner ? (
                    <span>Only organization owners can close this workspace.</span>
                  ) : !deletability?.is_deletable ? (
                    <span>Review the closure readiness checks above.</span>
                  ) : (
                    <span className="text-sem-error-fg font-medium">Closing revokes workspace access for all members.</span>
                  )}
                </div>

                <Button
                  variant="danger"
                  size="sm"
                  disabled={!isOwner || !deletability?.is_deletable}
                  onClick={() => {
                    setDeleteConfirmName("");
                    setDeleteOrgError("");
                    setShowDeleteOrgModal(true);
                  }}
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  className="shrink-0"
                >
                  Close Organization
                </Button>
              </div>
            </div>
          </div>
</div>
      </div>

      {/* Modal: Edit Organization Settings */}
      <Modal
        isOpen={showEditOrgModal}
        onClose={() => setShowEditOrgModal(false)}
        maxWidth="md"
      >
        <button
          type="button"
          onClick={() => setShowEditOrgModal(false)}
          className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-primary">
            <Building2 className="w-5 h-5 text-secondary" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
            Edit Organization Settings
          </h3>
        </div>

        <p className="text-xs text-secondary font-body mb-6 leading-relaxed">
          Update the organization name and primary currency standard for all accounting operations.
        </p>

        {editOrgError && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{editOrgError}</span>
          </div>
        )}

        <form onSubmit={handleEditOrgSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-body font-normal text-secondary">
              Workspace Name
            </label>
            <input
              type="text"
              placeholder="e.g. Computer Science Society"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              disabled={updateOrgMutation.isPending}
              className="bg-elevated border border-subtle text-primary rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-strong"
            />
          </div>

          <div className="space-y-1.5">
            <Select
              label="Base Currency Standard"
              value={editCurrency}
              onChange={(e) => setEditCurrency(e.target.value)}
              disabled={updateOrgMutation.isPending}
              options={SUPPORTED_CURRENCIES.map((curr) => ({
                value: curr.code,
                label: curr.label,
              }))}
            />
            <span className="text-[11px] text-muted font-mono block">
              Currency can be changed only before financial records exist. Historical amounts are never converted.
            </span>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowEditOrgModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={updateOrgMutation.isPending}
              disabled={!editName.trim()}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Regenerate Invite Code Confirmation */}
      <Modal
        isOpen={showRegenerateModal}
        onClose={() => setShowRegenerateModal(false)}
        maxWidth="md"
      >
        <button
          type="button"
          onClick={() => setShowRegenerateModal(false)}
          className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-secondary">
            <KeyRound className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
            Regenerate Invite Code?
          </h3>
        </div>

        <p className="text-xs text-secondary font-body mb-4 leading-relaxed">
          Are you sure you want to generate a new invitation code for <strong className="text-primary">{organization.name}</strong>?
        </p>

        <div className="p-3.5 mb-6 rounded-2xl bg-elevated border border-subtle text-secondary text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-muted shrink-0 mt-0.5" />
          <span>
            The previous invitation code (<strong className="text-primary">{organization.invite_code}</strong>) will immediately stop working. Existing members are not affected, but unredeemed invites will need the new code.
          </span>
        </div>

        {regenerateError && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs">
            {regenerateError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowRegenerateModal(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            isLoading={regenerateCodeMutation.isPending}
            onClick={() => regenerateCodeMutation.mutate()}
          >
            Regenerate Code
          </Button>
        </div>
      </Modal>

      {/* Modal: Logo & Profile Picture Customizer */}
      <Modal
        isOpen={showLogoModal}
        onClose={() => {
          setShowLogoModal(false);
          setLogoPreview(null);
          setLogoMeta(null);
          setLogoUploadError("");
        }}
        maxWidth="lg"
        className="space-y-6"
      >
        <div className="flex items-center justify-between border-b border-subtle pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-elevated border border-subtle flex items-center justify-center text-secondary">
              <Camera className="w-5 h-5 text-secondary" />
            </div>
            <div>
              <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
                Workspace Logo &amp; Profile Picture
              </h3>
              <p className="text-xs text-secondary font-body">
                Upload a square logo or avatar for {organization?.name}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowLogoModal(false);
              setLogoPreview(null);
              setLogoMeta(null);
              setLogoUploadError("");
            }}
            className="text-muted hover:text-primary p-1 rounded-lg hover:bg-elevated transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drag and Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsLogoDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsLogoDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsLogoDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleLogoFileProcess(e.dataTransfer.files[0]);
            }
          }}
          onClick={() => logoFileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-3xl p-6 sm:p-8 text-center cursor-pointer transition-all ${
            isLogoDragging
              ? "border-strong bg-elevated scale-[0.99]"
              : "border-subtle hover:border-strong bg-elevated/60 hover:bg-elevated"
          }`}
        >
          <input
            ref={logoFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleLogoFileProcess(e.target.files[0]);
              }
            }}
          />

          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-surface border border-subtle flex items-center justify-center text-secondary mb-3 group-hover:scale-105 transition-transform">
              <UploadCloud className="w-6 h-6 text-secondary" />
            </div>

            <p className="text-sm font-medium text-primary mb-1">
              Click to browse or drag and drop your logo
            </p>
            <p className="text-xs text-muted font-mono">
              PNG, JPG, WebP, or SVG &bull; Max 5 MB &bull; Square (1:1) recommended
            </p>
          </div>
        </div>

        {logoUploadError && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{logoUploadError}</span>
          </div>
        )}

        {/* Live Preview Area */}
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted block mb-3">
            Preview Across Workspace
          </span>

          <div className="grid grid-cols-2 gap-4 bg-elevated p-4 rounded-2xl border border-subtle">
            <div className="flex flex-col items-center text-center p-3 rounded-xl bg-surface border border-subtle">
              <span className="text-[10px] font-mono text-muted mb-2">Overview Profile</span>
              <div className="w-16 h-16 rounded-2xl overflow-hidden bg-elevated border-2 border-strong flex items-center justify-center font-heading font-semibold text-xl text-primary shadow-lg">
                {logoPreview ? (
                  <img src={logoPreview} alt="Preview" className="w-full h-full object-cover" />
                ) : orgLogo ? (
                  <img src={orgLogo} alt="Current" className="w-full h-full object-cover" />
                ) : (
                  getInitials(organization?.name)
                )}
              </div>
            </div>

            <div className="flex flex-col items-center text-center p-3 rounded-xl bg-surface border border-subtle">
              <span className="text-[10px] font-mono text-muted mb-2">Sidebar &amp; Nav</span>
              <div className="w-10 h-10 rounded-xl overflow-hidden bg-elevated border border-strong flex items-center justify-center font-semibold text-xs text-primary shadow-md">
                {logoPreview ? (
                  <img src={logoPreview} alt="Preview" className="w-full h-full object-cover" />
                ) : orgLogo ? (
                  <img src={orgLogo} alt="Current" className="w-full h-full object-cover" />
                ) : (
                  getInitials(organization?.name)
                )}
              </div>
            </div>
          </div>

          {logoMeta && (
            <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-secondary bg-elevated px-3 py-1.5 rounded-xl border border-subtle">
              <span className="truncate max-w-[200px]">{logoMeta.name}</span>
              <span>{logoMeta.dimensions} &bull; {logoMeta.size}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-subtle flex items-center justify-between">
          <div>
            {orgLogo && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRemoveLogo}
                icon={<Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />}
                className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:border-rose-500/20"
              >
                Remove Custom Logo
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowLogoModal(false);
                setLogoPreview(null);
                setLogoMeta(null);
                setLogoUploadError("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveLogo}
              disabled={!logoPreview}
            >
              Save Logo
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Create Reporting Period */}
      <Modal
        isOpen={showPeriodModal}
        onClose={() => setShowPeriodModal(false)}
        maxWidth="md"
      >
        <button
          type="button"
          onClick={() => setShowPeriodModal(false)}
          className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-primary">
            <Calendar className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
            New Reporting Period
          </h3>
        </div>

        <p className="text-xs text-secondary font-body mb-6 leading-relaxed">
          Create an official date interval for <strong className="text-primary">{organization.name}</strong>.
        </p>

        {periodActionError && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs">
            {periodActionError}
          </div>
        )}

        <form onSubmit={handlePeriodSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-body font-normal text-secondary">
              Period Name
            </label>
            <input
              type="text"
              placeholder="e.g. AY 2026-2027 Semester 1, Q1 2026"
              value={periodName}
              onChange={(e) => setPeriodName(e.target.value)}
              required
              disabled={createPeriodMutation.isPending}
              className="bg-elevated border border-subtle text-primary rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-strong"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DatePicker
              label="Start Date"
              value={startDate}
              onChange={setStartDate}
              required
              disabled={createPeriodMutation.isPending}
              size="sm"
            />
            <DatePicker
              label="End Date"
              value={endDate}
              onChange={setEndDate}
              required
              disabled={createPeriodMutation.isPending}
              size="sm"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-xs text-secondary pt-1">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 rounded border-strong bg-elevated text-primary accent-zinc-900 dark:accent-white"
            />
            <span>Set as default active period for this organization</span>
          </label>

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={createPeriodMutation.isPending}
              disabled={!periodName.trim() || !startDate || !endDate}
            >
              Create Reporting Period
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Transfer Ownership */}
      <Modal
        isOpen={showTransferModal}
        onClose={() => {
          setShowTransferModal(false);
          setTransferError("");
        }}
        maxWidth="md"
      >
        <button
          type="button"
          onClick={() => {
            setShowTransferModal(false);
            setTransferError("");
          }}
          className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-secondary">
            <Crown className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
              Transfer Workspace Ownership
            </h3>
            <p className="text-xs text-secondary font-body">
              Designate a successor owner for {organization?.name}
            </p>
          </div>
        </div>

        {transferError && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{transferError}</span>
          </div>
        )}

        {eligibleSuccessors.length === 0 ? (
          <div className="p-5 rounded-2xl bg-elevated border border-subtle text-center space-y-2">
            <p className="text-xs text-secondary leading-relaxed font-body">
              There are no other active members in this organization to transfer ownership to.
            </p>
            <p className="text-[11px] text-muted font-mono">
              Invite another user to join the workspace and wait until their membership is active.
            </p>
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTransferModal(false)}
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!targetSuccessorId) return;
              setTransferError("");
              transferOrgMutation.mutate({
                targetMemberId: targetSuccessorId,
                currentOwnerRole: formerOwnerRole,
              });
            }}
            className="space-y-5"
          >
            {/* Successor Member Selector */}
            <Select
              label="Select Successor Member"
              value={targetSuccessorId}
              onChange={(e) => setTargetSuccessorId(e.target.value)}
              required
              disabled={transferOrgMutation.isPending}
              placeholder="Select a member to transfer ownership"
              options={eligibleSuccessors.map((m) => ({
                value: m.id,
                label: `${m.profiles?.display_name || "Unnamed"} (${m.role})`,
                description: m.profile_id,
              }))}
            />

            {/* Former Owner's Subsequent Role */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-body font-normal text-secondary">
                Your Subsequent Role in Workspace
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  {
                    id: "organization_admin",
                    label: "Admin",
                    desc: "Retain manager permissions without root custody",
                  },
                  {
                    id: "owner",
                    label: "Co-Owner",
                    desc: "Remain as equal co-owner with successor",
                  },
                  {
                    id: "member",
                    label: "Member",
                    desc: "Standard member view without management rights",
                  },
                ].map((roleOpt) => (
                  <label
                    key={roleOpt.id}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                      formerOwnerRole === roleOpt.id
                        ? "bg-elevated border-strong text-primary"
                        : "bg-surface border-subtle hover:border-strong text-secondary"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-primary">
                        {roleOpt.label}
                      </span>
                      <input
                        type="radio"
                        name="formerOwnerRole"
                        value={roleOpt.id}
                        checked={formerOwnerRole === roleOpt.id}
                        onChange={() =>
                          setFormerOwnerRole(
                            roleOpt.id as "organization_admin" | "owner" | "member"
                          )
                        }
                        className="accent-zinc-900 dark:accent-white"
                      />
                    </div>
                    <span className="text-[10px] text-muted leading-snug">
                      {roleOpt.desc}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Warning callout */}
            <div className="p-3.5 rounded-2xl bg-elevated border border-subtle text-secondary text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-muted shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                Transferring primary ownership grants the designated successor complete authority over workspace administration, settings, and lifecycle deletion.
              </span>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowTransferModal(false);
                  setTransferError("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={transferOrgMutation.isPending}
                disabled={!targetSuccessorId}
              >
                Confirm Ownership Transfer
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Close Organization Confirmation */}
      <Modal
        isOpen={showDeleteOrgModal}
        onClose={() => {
          if (deleteOrgMutation.isPending) return;
          setShowDeleteOrgModal(false);
          setDeleteConfirmName("");
          setDeleteOrgError("");
        }}
        maxWidth="md"
      >
        <button
          type="button"
          onClick={() => {
            setShowDeleteOrgModal(false);
            setDeleteConfirmName("");
            setDeleteOrgError("");
          }}
          className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
              Close Organization
            </h3>
            <p className="text-xs text-secondary font-mono">
              Workspace closure and retention
            </p>
          </div>
        </div>

        <div className="p-4 mb-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs leading-relaxed space-y-2">
          <p className="font-semibold text-rose-800 dark:text-rose-100">
            All members will lose workspace access.
          </p>
          <p className="text-rose-700/90 dark:text-rose-300/90">
            Closing <strong>{organization.name}</strong> retains member records, obligations, receipts, financial transactions, and audit history for retention review. Disposal requires a separately approved retention decision.
          </p>
        </div>

        {deleteOrgError && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{deleteOrgError}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (deleteConfirmName.trim() !== organization.name.trim()) return;
            setDeleteOrgError("");
            deleteOrgMutation.mutate({ confirmName: deleteConfirmName.trim() });
          }}
          className="space-y-4"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-body font-normal text-secondary">
              To verify custody, please type{" "}
              <strong className="text-primary font-mono">{organization.name}</strong> below:
            </label>
            <input
              type="text"
              placeholder={organization.name}
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              required
              disabled={deleteOrgMutation.isPending}
              autoFocus
              className="bg-elevated border border-subtle text-primary rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-rose-500 font-mono"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowDeleteOrgModal(false);
                setDeleteConfirmName("");
                setDeleteOrgError("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              isLoading={deleteOrgMutation.isPending}
              disabled={deleteConfirmName.trim() !== organization.name.trim()}
              icon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Close Organization
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
