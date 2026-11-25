import { PersonalHeaderActions, type PersonalWorkspaceContext } from "../../components/layout/PersonalWorkspaceLayout";
import Badge from "../../components/ui/Badge";
import { toast } from "../../lib/toast";
import { RequiredMark } from "../../components/ui/FieldFeedback";
import WizardDialog from "../../components/ui/WizardDialog";
import { SUPPORTED_CURRENCIES } from "../../lib/currencies";
import { getBrowserTimeZone } from "../../lib/timezones";
import { organizationTypes, type OrganizationType } from "../../lib/organizationTypes";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  GraduationCap, Briefcase, Users, HeartHandshake, Shapes, ArrowLeft,
  Plus,
  KeyRound,
  Copy,
  Check,
  ArrowRight,
  ShieldCheck,
  X,
  Search,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import Modal from "../../components/ui/Modal";
import {
  createOrganization,
  joinOrganization,
  type Membership,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import API from "../../config/apiClient";
import { getOrgCoverAndLogo } from "../../utils/organizationTheme";
import AnimatedNumber from "../../components/ui/AnimatedNumber";
import { navigateWithTransition } from "../../utils/navTransition";
import { MyOrganizationsGridSkeleton, MyOrganizationsHeading } from "../../components/layout/WorkspaceSkeletons";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [copyError, setCopyError] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "officer" | "member">("all");
  const [showMobileActionMenu, setShowMobileActionMenu] = useState(false);
  const mobileActionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMobileActionMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mobileActionMenuRef.current &&
        !mobileActionMenuRef.current.contains(event.target as Node)
      ) {
        setShowMobileActionMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMobileActionMenu]);

  // Dialog States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep,setCreateStep]=useState<1|2>(1);
  const [nameTouched,setNameTouched]=useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgType, setNewOrgType] = useState<OrganizationType | "">("");
  const [creationRequest, setCreationRequest] = useState(() => crypto.randomUUID());
  const selectedType = organizationTypes.find(type => type.value === newOrgType);
  const [newOrgCurrency, setNewOrgCurrency] = useState("PHP");
  const [joinCode, setJoinCode] = useState("");
  const [createNickname,setCreateNickname]=useState("");
  const [joinNickname,setJoinNickname]=useState("");
  const [actionError, setActionError] = useState("");

  const { organizationsQuery } = useOutletContext<PersonalWorkspaceContext>();

  // Mutations
  const createMutation = useMutation({
    mutationFn: createOrganization,
    onSuccess: async (newOrg) => {
      if(createNickname.trim())try{await API.patch(`/organizations/${newOrg.id}/my-profile`,{displayName:createNickname.trim()});}catch{toast.error("Organization created. Set your display name later in My Profile.");}
      setCreateNickname("");
      toast.success("Organization created");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      navigate(`/app/org/${newOrg.id}/overview`);
      setShowCreateModal(false);
      setNewOrgName("");
      setNewOrgCurrency("PHP");setCreateStep(1);setNameTouched(false);
      setNewOrgType("");
      setCreationRequest(crypto.randomUUID());
      setActionError("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const joinMutation = useMutation({
    mutationFn: joinOrganization,
    onSuccess: async (joinedOrg) => {
      if(joinNickname.trim())try{await API.patch(`/organizations/${joinedOrg.id}/my-profile`,{displayName:joinNickname.trim()});}catch{toast.error("Organization joined. Set your display name later in My Profile.");}
      setJoinNickname("");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      navigate(`/app/org/${joinedOrg.id}/overview`);
      setShowJoinModal(false);
      setJoinCode("");
      setActionError("");
    },
    onError: (err) => {
      setActionError(formatErrorMessage(err));
    },
  });

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyError("");
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      setCopyError("Unable to copy the invite code. Select and copy it manually.");
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if(createMutation.isPending) return;
    setNameTouched(true);
    if(newOrgName.trim().length<2||newOrgName.trim().length>150||!SUPPORTED_CURRENCIES.some(item=>item.code===newOrgCurrency)) return;
    if(createStep===1) {setNewOrgName(newOrgName.trim());setCreateStep(2);setActionError("");return;}
    if(!newOrgType) {
      setActionError("Select an organization type.");
      e.currentTarget.querySelector<HTMLInputElement>('input[name="organization-type"]')?.focus();
      return;
    }
    setActionError("");
    const detectedTimeZone = getBrowserTimeZone() ?? undefined;
    createMutation.mutate({
      name: newOrgName.trim(),
      currency: newOrgCurrency,
      timeZone: detectedTimeZone,
      organizationType: newOrgType,
      requestId: creationRequest,
    });
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setActionError("");
    joinMutation.mutate({ code: joinCode.trim() });
  };

  const memberships = useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  );

  const isOfficerRole = (role: Membership["role"]) =>
    role === "owner" ||
    role === "organization_admin" ||
    role === "treasurer" ||
    role === "auditor";

  const { officerCount, memberCount } = useMemo(() => {
    let officers = 0;
    let members = 0;
    for (const m of memberships) {
      if (isOfficerRole(m.role)) officers += 1;
      else members += 1;
    }
    return { officerCount: officers, memberCount: members };
  }, [memberships]);

  const filteredMemberships = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return memberships.filter((membership) => {
      if (roleFilter === "officer" && !isOfficerRole(membership.role)) return false;
      if (roleFilter === "member" && isOfficerRole(membership.role)) return false;
      if (!q) return true;
      const orgName = membership.organizations?.name?.toLowerCase() || "";
      const currency = membership.organizations?.currency?.toLowerCase() || "";
      const role = membership.role?.toLowerCase() || "";
      return orgName.includes(q) || currency.includes(q) || role.includes(q);
    });
  }, [memberships, searchQuery, roleFilter]);

  const getRoleBadge = (role: Membership["role"]) => {
    switch (role) {
      case "owner":
        return (
          <Badge >
            <ShieldCheck className="w-3 h-3" /> Owner
          </Badge>
        );
      case "treasurer":
        return (
          <Badge >
            Treasurer
          </Badge>
        );
      case "auditor":
        return (
          <Badge >
            Auditor
          </Badge>
        );
      case "organization_admin":
        return (
          <Badge >
            Admin
          </Badge>
        );
      default:
        return (
          <Badge >
            Member
          </Badge>
        );
    }
  };

  return (
    <div className="min-h-[calc(100dvh-var(--workspace-navbar-height,3.5rem))] workspace-canvas bg-canvas text-primary flex flex-col font-body font-normal relative">
      {/* Top Application Header */}
      <PersonalHeaderActions loading={organizationsQuery.isPending}>
        <div className="hidden md:flex items-center gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setActionError("");
              setShowJoinModal(true);
            }}
            className="h-9 px-3.5! py-0! text-xs!"
            icon={<KeyRound className="w-3.5 h-3.5" />}
          >
            Join Organization
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setActionError("");
              setShowCreateModal(true);
            }}
            className="h-9 px-4! py-0! bg-action! hover:opacity-90! text-xs! text-action-fg!"
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Create Organization
          </Button>
        </div>
      </PersonalHeaderActions>

      {/* Main Workspace Body */}
      {organizationsQuery.isPending ? <MyOrganizationsGridSkeleton /> : (
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 space-y-8 relative z-10">
        <MyOrganizationsHeading>
          {memberships.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-secondary">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface px-3 py-1.5 text-primary shadow-xs dark:shadow-none">
                <span className="text-muted">Total</span>
                <AnimatedNumber value={memberships.length} />
              </span>
              {officerCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface px-3 py-1.5 shadow-xs dark:shadow-none">
                  <span className="text-muted">Officer</span>
                  <span className="text-primary"><AnimatedNumber value={officerCount} /></span>
                </span>
              )}
              {memberCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface px-3 py-1.5 shadow-xs dark:shadow-none">
                  <span className="text-muted">Member</span>
                  <span className="text-primary"><AnimatedNumber value={memberCount} /></span>
                </span>
              )}
            </div>
          )}
        </MyOrganizationsHeading>

        {/* Search & Filter Toolbar */}
        {memberships.length > 0 && (
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
              <div className="relative flex-1 max-w-md">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted">
                  <Search className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  aria-label="Search organizations"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, role, or currency..."
                  className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-surface border border-subtle text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-strong shadow-xs dark:shadow-none transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted hover:text-primary transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div role="group" aria-label="Filter by workspace role" className="inline-flex items-center gap-1 rounded-xl border border-subtle bg-secondary-surface p-1 self-start sm:self-auto">
                {(
                  [
                    ["all", "All"],
                    ["officer", "Officer"],
                    ["member", "Member"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRoleFilter(value)}
                    aria-pressed={roleFilter === value}
                    className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-strong ${
                      roleFilter === value
                        ? "bg-selected-surface text-primary shadow-xs dark:shadow-none"
                        : "text-secondary hover:text-primary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-secondary font-mono tabular-nums">
              <span className="px-3 py-1.5 rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none">
                Showing <AnimatedNumber value={filteredMemberships.length} /> of <AnimatedNumber value={memberships.length} /> {memberships.length === 1 ? "workspace" : "workspaces"}
              </span>
            </div>
          </div>
        )}

        {organizationsQuery.error && (
          <div role="alert" className="p-6 rounded-2xl bg-sem-error-bg border border-sem-error-border text-sem-error-fg text-sm">
            <p>{formatErrorMessage(organizationsQuery.error)}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void organizationsQuery.refetch()}
              className="mt-3"
            >
              Retry
            </Button>
          </div>
        )}

        {copyError && <p role="alert" className="text-sm text-sem-warning-fg">{copyError}</p>}

        {/* Empty State: Zero Organizations */}
        {organizationsQuery.isSuccess && memberships.length === 0 && (
          <div className="p-10 sm:p-14 rounded-3xl bg-surface border border-subtle text-center flex flex-col items-center max-w-2xl mx-auto shadow-xs dark:shadow-none">
            <h2 className="text-2xl font-heading font-medium text-primary mb-2 tracking-tight">
              No organizations yet
            </h2>
            <p className="text-secondary text-sm max-w-md mb-8 leading-relaxed">
              Create an organization to manage your group's collections, budgets, and expenses, or join an existing organization using an invite code.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="primary"
                onClick={() => {
                  setActionError("");
                  setShowCreateModal(true);
                }}
                icon={<Plus className="w-4 h-4" />}
              >
                Create First Organization
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setActionError("");
                  setShowJoinModal(true);
                }}
                icon={<KeyRound className="w-4 h-4" />}
              >
                Join with Code
              </Button>
            </div>
          </div>
        )}

        {/* Search Empty State */}
        {memberships.length > 0 && filteredMemberships.length === 0 && (
          <div className="p-10 rounded-3xl bg-surface border border-subtle text-center flex flex-col items-center max-w-md mx-auto shadow-xs dark:shadow-none">
            <div className="w-12 h-12 rounded-2xl bg-secondary-surface border border-subtle flex items-center justify-center mb-4 text-muted">
              <Search className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-heading font-medium text-primary mb-1.5 tracking-tight">
              No matching organizations found
            </h3>
            <p className="text-secondary text-xs sm:text-sm max-w-xs mb-5 leading-relaxed">
              {searchQuery.trim()
                ? <>No workspaces matched &ldquo;{searchQuery}&rdquo;. Try adjusting your search or role filter.</>
                : "No workspaces match the selected role filter."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setRoleFilter("all");
              }}
              icon={<X className="w-3.5 h-3.5" />}
            >
              Reset Filters
            </Button>
          </div>
        )}

        {/* Organizations Grid */}
        {filteredMemberships.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMemberships.map((membership, index) => {
              const org = membership.organizations;
              const isOwnerOrAdmin =
                membership.role === "owner" || membership.role === "organization_admin";
              const orgData = getOrgCoverAndLogo(
                membership.organization_id,
                org?.name ?? "Organization",
                org?.logo_url,
                org?.cover_image_url,
                org?.cover_theme
              );
              const openWorkspace = () => {
                const destination = `/app/org/${membership.organization_id}/overview`;
                navigateWithTransition(() => navigate(destination), destination);
              };

              return (
                <div
                  key={membership.organization_id}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open ${org?.name ?? "Organization"} workspace`}
                  onClick={openWorkspace}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openWorkspace();
                    }
                  }}
                  style={{ "--stagger-index": Math.min(index, 12) } as React.CSSProperties}
                  className="animate-stagger-item card-specular-interactive group flex cursor-pointer flex-col justify-between rounded-2xl border border-subtle bg-surface shadow-(--shadow-card) dark:shadow-none hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-strong"
                >
                  <div>
                    {/* Cover Photo Header */}
                    <div className="h-28 sm:h-32 w-full relative overflow-hidden bg-secondary-surface">
                      {orgData.customImageUrl ? (
                        <img
                          src={orgData.customImageUrl}
                          alt=""
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className={`w-full h-full bg-gradient-to-br ${orgData.theme.gradient} relative overflow-hidden`}>
                          {/* Ambient Glows */}
                          <div
                            className={`absolute -right-6 -top-6 w-32 h-32 rounded-full ${orgData.theme.ambientGlow} blur-2xl pointer-events-none transition-opacity duration-300 group-hover:opacity-100 opacity-75`}
                          />
                          <div
                            className={`absolute -left-6 -bottom-6 w-24 h-24 rounded-full ${orgData.theme.ambientGlow2} blur-xl pointer-events-none opacity-60`}
                          />
                          {/* Fine grid overlay */}
                          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />
                        </div>
                      )}

                      {/* Role Badge in top-right corner of Cover */}
                      <div className="absolute top-3 right-3 z-10 backdrop-blur-md">
                        {getRoleBadge(membership.role)}
                      </div>
                    </div>

                    {/* Profile Picture (Avatar) Overlapping Cover */}
                    <div className="px-5 sm:px-6 relative">
                      <div className="-mt-8 sm:-mt-9 mb-3.5 flex items-end justify-between">
                        <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-surface p-1 border-2 border-subtle shadow-md dark:shadow-xl overflow-hidden shrink-0 group-hover:border-strong transition-colors">
                          {orgData.customLogoUrl ? (
                            <img
                              src={orgData.customLogoUrl}
                              alt={org?.name ?? "Workspace"}
                              className="w-full h-full rounded-xl object-cover"
                            />
                          ) : (
                            <div
                              className={`w-full h-full rounded-xl flex items-center justify-center font-heading font-semibold text-base sm:text-lg tracking-wider ${orgData.theme.avatarBg} shadow-inner`}
                            >
                              {orgData.initials}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Organization Info */}
                      <div className="mb-4 flex items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 text-xl font-heading font-medium text-primary tracking-tight truncate group-hover:text-secondary transition-colors">
                          {org?.name ?? "Organization"}
                        </h3>
                        {org?.currency && (
                          <span className="shrink-0 rounded-md border border-subtle bg-secondary-surface px-2 py-0.5 font-mono text-[11px] font-medium text-secondary">
                            {org.currency}
                          </span>
                        )}
                      </div>

                      {/* Invite Code for Owners & Admins */}
                      {isOwnerOrAdmin && org?.invite_code && (
                        <div className="p-3 rounded-xl bg-secondary-surface border border-subtle flex items-center justify-between gap-2 mb-4">
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] uppercase font-mono tracking-wider text-muted">
                              Invite Code
                            </span>
                            <span className="font-mono text-xs font-medium text-primary truncate">
                              {org.invite_code}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCopyCode(org.invite_code!);
                            }}
                            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-subtle bg-surface px-3.5 text-xs text-primary hover:bg-hover-surface transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-strong"
                          >
                            {copiedCode === org.invite_code ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-sem-success-fg" />
                                <span className="text-sem-success-fg">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="px-5 sm:px-6 pb-5 pt-3 border-t border-subtle flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openWorkspace();
                      }}
                      iconRight={<ArrowRight className="w-3.5 h-3.5" />}
                      className="h-9 flex-1 bg-action! px-4! py-0! text-xs! text-action-fg! hover:opacity-90!"
                    >
                      Open Workspace
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </main>
      )}

      {/* Exactly two steps; only the final submission calls the existing idempotent API. */}
      <WizardDialog isOpen={showCreateModal} onClose={()=>setShowCreateModal(false)}
        title="Create Organization" steps={["Organization Details","Organization Type"]} step={createStep}
        stepTitle={createStep===1?"Organization details":"What kind of organization is this?"}
        formId="create-organization-form" onSubmit={handleCreateSubmit} busy={createMutation.isPending}
        footer={<>
          {createStep===1 && <Button variant="outline" onClick={()=>setShowCreateModal(false)}>Cancel</Button>}
          {createStep===2&&<Button variant="outline" disabled={createMutation.isPending} icon={<ArrowLeft size={16}/>} onClick={()=>{setCreateStep(1);setActionError("");}}>Back</Button>}
          <Button type="submit" form="create-organization-form" isLoading={createMutation.isPending} iconRight={createStep===1?<ArrowRight size={16}/>:undefined}>{createStep===1?"Next":"Create Organization"}</Button>
        </>}>
          <fieldset disabled={createMutation.isPending} className="min-w-0 space-y-4">
            <legend className="sr-only">{createStep===1?"Organization details":"Organization type"}</legend>
            <p className="text-sm text-secondary">{createStep===1?"Start with the basics. You can update these details later.":"Choose a category so Bantai can tailor your member directory and workspace defaults."}</p>
            {createStep===1?<>
              <Input label="Organization name" placeholder="e.g. Robotics Council, Society of Writers" value={newOrgName} required maxLength={150}
                validationMessage={newOrgName.trim().length<2?"Enter an organization name with at least 2 characters.":undefined}
                aria-invalid={nameTouched&&newOrgName.trim().length<2} error={nameTouched&&newOrgName.trim().length<2?"Enter a name with at least 2 characters.":undefined}
                onBlur={()=>setNameTouched(true)} onChange={event=>{if(event.target.value.trim()!==newOrgName.trim())setCreationRequest(crypto.randomUUID());setNewOrgName(event.target.value);setActionError("");}}/>
              <Select label="Default currency" value={newOrgCurrency} required options={SUPPORTED_CURRENCIES.map(item=>({value:item.code,label:item.label}))}
                onChange={event=>{if(event.target.value!==newOrgCurrency)setCreationRequest(crypto.randomUUID());setNewOrgCurrency(event.target.value);setActionError("");}}/>
              <div className="space-y-1 text-xs text-secondary"><p>Used for collections, budgets, expenses, and financial reports.</p><p>Choose carefully: currency changes are restricted once financial records exist. No currency conversion is performed.</p></div>
              <p className="flex items-start gap-2 text-sm text-secondary"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-sem-success-fg"/>You'll automatically become this organization's Owner.</p>
            </>:<>
              <fieldset className="space-y-2"><legend className="text-sm text-primary">Organization type<RequiredMark /></legend>
                {organizationTypes.map(type=>{
                  const Icon={student:GraduationCap,workplace:Briefcase,club:Users,nonprofit:HeartHandshake,other:Shapes}[type.value];
                  return <label key={type.value} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-strong ${newOrgType===type.value?"border-sem-success-border bg-sem-success-bg":"border-subtle hover:border-strong hover:bg-hover-surface"}`}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-subtle bg-secondary-surface"><Icon size={16} className={newOrgType===type.value?"text-sem-success-fg":"text-secondary"}/></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-primary">{type.label}</span><span className="mt-0.5 block text-xs leading-relaxed text-secondary">{type.description}</span></span>
                    <input type="radio" name="organization-type" required value={type.value} checked={newOrgType===type.value} onChange={()=>{setNewOrgType(type.value);setCreationRequest(crypto.randomUUID());setActionError("");}} className="mt-1 size-4 shrink-0 appearance-auto! accent-emerald-700 dark:accent-emerald-500"/>
                  </label>;
                })}
              </fieldset>
              <section className="border-t border-subtle pt-3" aria-live="polite"><h4 className="text-sm font-medium text-primary">What does this change?</h4>
                <p className="mt-1 text-xs leading-relaxed text-secondary">{selectedType?(selectedType.fields.length?`Suggested directory fields: ${selectedType.fields.join(", ")}. You can customize these later.`:"Start with standard member information and add custom directory fields whenever you need them."):"Choose a category to see its directory defaults."}</p>
                <p className="mt-2 text-xs text-secondary">All types include the same financial tools, groups, custom fields, and workspace permissions.</p>
              </section>
            </>}
          </fieldset>
          {createStep===2&&<div className="mt-4"><Input label="Your organization display name (optional)" maxLength={80} value={createNickname} onChange={e=>setCreateNickname(e.target.value)} disabled={createMutation.isPending}/><p className="mt-1 text-xs text-secondary">Leave blank to use your Bantai username.</p></div>}
          {actionError&&<p role="alert" className="mt-4 rounded-xl border border-sem-error-border bg-sem-error-bg p-3 text-sm text-sem-error-fg">{actionError}</p>}
      </WizardDialog>

      {/* Modal: Join Organization */}
      <Modal
        isOpen={showJoinModal}
        onClose={() => setShowJoinModal(false)}
        maxWidth="md"
      >
        <button
          type="button"
          onClick={() => setShowJoinModal(false)}
          className="absolute top-5 right-5 text-muted hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-secondary-surface border border-subtle flex items-center justify-center text-primary">
            <KeyRound className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
            Join Organization
          </h3>
        </div>

        <p className="text-xs text-secondary font-body mb-6 leading-relaxed">
          Enter the unique invite code provided by your organization owner or treasurer to gain authorized access.
        </p>

        {actionError && (
          <div className="p-3 mb-4 rounded-xl bg-sem-error-bg border border-sem-error-border text-sem-error-fg text-xs">
            {actionError}
          </div>
        )}

        <form onSubmit={handleJoinSubmit} className="space-y-4">
          <Input label="Your organization display name (optional)" maxLength={80} value={joinNickname} onChange={e=>setJoinNickname(e.target.value)} disabled={joinMutation.isPending}/>
          <Input
            label="Invitation Code"
            placeholder="e.g. 8-character code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            required
            disabled={joinMutation.isPending}
          />

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={joinMutation.isPending}
              disabled={joinCode.trim().length < 4}
            >
              Join Organization
            </Button>
          </div>
        </form>
      </Modal>

      {/* Mobile Floating + Action Button & Pop-up Menu */}
      <div
        className="md:hidden fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-40"
        ref={mobileActionMenuRef}
      >
        {showMobileActionMenu && (
          <div className="absolute bottom-16 right-0 mb-1 w-60 rounded-2xl bg-surface border border-subtle shadow-2xl p-1.5 z-50">
            <button
              type="button"
              onClick={() => {
                setShowMobileActionMenu(false);
                setActionError("");
                setShowJoinModal(true);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-hover-surface active:bg-hover-surface transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-secondary-surface border border-subtle flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4 text-secondary" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-primary">Join Organization</div>
                <div className="text-[11px] text-muted">Enter an invite code</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowMobileActionMenu(false);
                setActionError("");
                setShowCreateModal(true);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-hover-surface active:bg-hover-surface transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-action text-action-fg flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-primary">Create Organization</div>
                <div className="text-[11px] text-muted">Start a new workspace</div>
              </div>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowMobileActionMenu((prev) => !prev)}
          aria-label="Join or create organization"
          aria-expanded={showMobileActionMenu}
          className="w-14 h-14 rounded-2xl bg-action hover:opacity-90 text-action-fg flex items-center justify-center shadow-xl transition-all duration-200 active:scale-95 cursor-pointer"
        >
          <Plus
            className={`w-6 h-6 transition-transform duration-200 ${
              showMobileActionMenu ? "rotate-45" : ""
            }`}
          />
        </button>
      </div>
    </div>
  );
}
