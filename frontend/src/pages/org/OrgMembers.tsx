import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import RecordActions from "../../components/org/shared/RecordActions";
import Badge from "../../components/ui/Badge";
import { useState, useMemo } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ellipsis,
  Users,
  Copy,
  ShieldCheck,
  Plus,
  AlertCircle,
  Search,
  RefreshCw,
  UserCheck,
} from "lucide-react";
import Select from "../../components/ui/Select";
import FormDraftControls from "../../components/ui/FormDraftControls";
import { useFormDraft } from "../../hooks/useFormDraft";
import {
  transferOrganizationOwnership,
  getOrganizationMembers,
  updateMemberRole,
  getOrganizations,
  inviteMemberByEmail,
  type OrganizationDetails,
  type Membership,
  type OrganizationMember,
} from "../../lib/api";
import { toast } from "../../lib/toast";
import useAuth from "../../hooks/useAuth";
import { formatErrorMessage } from "../../utils/formatError";

interface ContextType {
  organization?: OrganizationDetails;
  membership?: Membership;
}

export default function OrgMembers() {
  const { orgId } = useParams<{ orgId: string }>();
  const context = useOutletContext<ContextType | undefined>();
  const queryClient = useQueryClient();

  const organization = context?.organization;
  const membership = context?.membership;
  const effectiveOrgId = organization?.id || orgId;

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteError, setInviteError] = useState("");

  const inviteDraft = useFormDraft({
    orgId: effectiveOrgId ?? "",
    form: "member-invite",
    open: showInvite,
    values: { inviteEmail, inviteRole },
    restore: (v) => {
      setInviteEmail(v.inviteEmail);
      setInviteRole(v.inviteRole);
    },
  });
  const [transferTarget, setTransferTarget] = useState<OrganizationMember | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [roleActionError, setRoleActionError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  // Fetch current user
  const { user } = useAuth();
  const currentUserId = user?.id;
  const currentUserName = user?.displayName;

  // Retrieve organizations query to guarantee invite code even if context is resolving
  const orgsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: getOrganizations,
    enabled: !organization,
  });
  const currentMembershipFromQuery = (orgsQuery.data ?? []).find(
    (m) => m.organization_id === effectiveOrgId
  );
  const effectiveOrg = organization || currentMembershipFromQuery?.organizations;
  const inviteCode = effectiveOrg?.invite_code;

  // Members Query with resilient effectiveOrgId
  const membersQuery = useQuery({
    queryKey: ["organization-members", effectiveOrgId],
    queryFn: () => getOrganizationMembers(effectiveOrgId!),
    enabled: Boolean(effectiveOrgId),
  });

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  // Determine current user's role safely from context, member record, or localStorage cache
  const currentMemberRecord = members.find((m) => m.profile_id === currentUserId);
  const effectiveRole =
    membership?.role ||
    currentMemberRecord?.role ||
    (effectiveOrgId ? localStorage.getItem(`bantai_role_${effectiveOrgId}`) : null);

  const isOwnerOrAdmin = effectiveRole === "owner" || effectiveRole === "organization_admin";

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, newRole }: { memberId: string; newRole: string }) =>
      updateMemberRole(effectiveOrgId!, memberId, newRole),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization-members", effectiveOrgId] }),
        queryClient.invalidateQueries({ queryKey: ["organizations"] }),
      ]);
      setRoleActionError("");
    },
    onError: (err) => {
      setRoleActionError(formatErrorMessage(err));
    },
  });

  const transfer = useMutation({
    mutationFn: () => transferOrganizationOwnership(effectiveOrgId!, { targetMemberId: transferTarget!.id, currentOwnerRole: "organization_admin" }),
    onSuccess: async () => {
      setTransferTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization-members", effectiveOrgId] }),
        queryClient.invalidateQueries({ queryKey: ["organizations"] }),
      ]);
    },
  });

  const handleCopyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const getRoleBadge = (role: OrganizationMember["role"]) => {
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

  // Filter members by search query and role filter
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const isCurrentUser = Boolean(currentUserId && m.profile_id === currentUserId);
      const rawName = m.profiles?.display_name?.trim();
      const displayName =
        rawName ||
        (isCurrentUser && currentUserName ? currentUserName : `Member ${m.profile_id.slice(0, 6)}`);

      const matchesSearch =
        searchQuery === "" ||
        displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.profile_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.role.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesRole =
        roleFilter === "all" ||
        (roleFilter === "officer" &&
          (m.role === "owner" ||
            m.role === "organization_admin" ||
            m.role === "treasurer" ||
            m.role === "auditor")) ||
        (roleFilter === "member" && (m.role === "member" || m.role === "student")) ||
        m.role === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [members, searchQuery, roleFilter, currentUserId, currentUserName]);

  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="context" className="page-header-eyebrow">
              Workspace Access
            </Badge>
          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">Workspace Access &amp; Roles</span>
          </h1>
          <p className="page-subtitle">
            Manage members, assign officer roles, and invite new contributors.
          </p>
        </div>

        {(membership?.role === "owner" || membership?.role === "organization_admin") && inviteCode && <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" icon={<Plus size={16} />} onClick={() => setShowInvite(true)}>Invite Member</Button>
          <Button size="sm" variant="outline" icon={<Copy size={14} />} onClick={() => void handleCopyCode()}>{copiedCode ? "Copied" : "Copy Code"}</Button>
        </div>}
      </div>

      <Modal isOpen={showInvite} labelledBy="invite-member-title" onClose={() => { setShowInvite(false); setInviteError(""); }}>
        <h2 id="invite-member-title" className="modal-title">Invite Member</h2>
        <p className="mt-2 text-sm text-secondary">Send a direct workspace invitation by email or share the workspace invite code.</p>

        <form
          className="mt-4 space-y-3 rounded-xl border border-subtle bg-elevated p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!effectiveOrgId || !inviteEmail.trim()) return;
            setInviteError("");
            try {
              await inviteMemberByEmail(effectiveOrgId, inviteEmail.trim(), inviteRole);
              inviteDraft.complete(undefined);
              toast.success(`Invitation sent to ${inviteEmail.trim()}.`);
              setInviteEmail("");
              setInviteRole("member");
              setShowInvite(false);
            } catch (err) {
              setInviteError(formatErrorMessage(err));
            }
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="invite-email-input" className="block text-xs font-medium text-secondary">
              Email address
            </label>
            <input
              id="invite-email-input"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@organization.org"
              className="w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-strong focus:outline-none"
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="invite-role-select" className="block text-xs font-medium text-secondary">
                Role
              </label>
              <Select
                id="invite-role-select"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                options={[
                  { value: "member", label: "Member" },
                  { value: "treasurer", label: "Treasurer" },
                  { value: "organization_admin", label: "Admin" },
                  { value: "auditor", label: "Auditor" },
                ]}
              />
            </div>
            <Button type="submit" size="sm">Send Invite</Button>
          </div>
          {inviteError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{inviteError}</p>}
          <FormDraftControls draft={inviteDraft} />
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-border-subtle" />
          <span>or share workspace code</span>
          <div className="h-px flex-1 bg-border-subtle" />
        </div>

        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-subtle bg-elevated p-4">
          <code className="select-text break-all text-lg tracking-wider text-primary">{inviteCode}</code>
          <Button size="sm" variant="outline" onClick={() => void handleCopyCode()}>{copiedCode ? "Copied" : "Copy code"}</Button>
        </div>
        <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => setShowInvite(false)}>Close</Button></div>
      </Modal>
      <Modal isOpen={Boolean(transferTarget)} labelledBy="transfer-member-title" onClose={() => { if (!transfer.isPending) setTransferTarget(null); }}>
        <h2 id="transfer-member-title" className="modal-title">Transfer ownership?</h2>
        <p className="mt-3 text-sm text-secondary">{transferTarget?.profiles?.display_name || "This member"} will become Owner. Your role will become Admin.</p>
        {transfer.isError && <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">{formatErrorMessage(transfer.error)}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" disabled={transfer.isPending} onClick={() => setTransferTarget(null)}>Cancel</Button>
          <Button isLoading={transfer.isPending} onClick={() => transfer.mutate()}>Transfer ownership</Button>
        </div>
      </Modal>

      {/* Role Action Error Banner */}
      {roleActionError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>{roleActionError}</span>
        </div>
      )}

      {/* Fetch Error Banner with Retry */}
      {membersQuery.isError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-zinc-500 shrink-0" />
            <span>
              Failed to load member roster: {formatErrorMessage(membersQuery.error)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void membersQuery.refetch()}
            className="px-3 py-1.5 rounded-lg bg-rose-900/50 hover:bg-rose-800/60 border border-rose-700/60 text-xs font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

        <div className="filter-toolbar">
            <div className="toolbar-search relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input type="search" aria-label="Search workspace members" placeholder="Search by member name, email, or user ID..."
                value={searchQuery} onChange={event => setSearchQuery(event.target.value)}
                className="w-full pl-9 pr-3" />
            </div>
            {/* Filter Dropdown */}
            <Select
              ariaLabel="Filter workspace roles"
              buttonClassName="h-9! rounded-lg!"
              align="right" menuWidth="auto"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              variant="pill"
              selectSize="sm"
              options={[
                { value: "all", label: "All Roles" },
                { value: "officer", label: "Officers Only" },
                { value: "owner", label: "Owners" },
                { value: "organization_admin", label: "Admins" },
                { value: "treasurer", label: "Treasurers" },
                { value: "auditor", label: "Auditors" },
                { value: "member", label: "General Members" },
              ]}
            />
        </div>

      <div className="table-specular rounded-xl border border-subtle bg-surface shadow-xs dark:shadow-none overflow-hidden">
        {/* Responsive Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-elevated text-secondary font-mono text-[11px] uppercase tracking-wider border-b border-subtle">
              <tr>
                <th className="py-3 px-5 font-normal">Member</th>
                <th className="py-3 px-5 font-normal">Role</th>
                <th className="py-3 px-5 font-normal">Joined</th>
                <th className="py-3 px-5 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle font-body">
              {/* Skeleton Loading State */}
              {membersQuery.isPending && (
                <>
                  {[1, 2, 3, 4].map((i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="py-3.5 px-5 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-skeleton border border-subtle" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-28 bg-skeleton rounded" />
                          <div className="h-2.5 w-20 bg-skeleton rounded" />
                        </div>
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="h-5 w-16 bg-skeleton rounded-full" />
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="h-3.5 w-20 bg-skeleton rounded" />
                      </td>
                      {isOwnerOrAdmin && (
                        <td className="py-3.5 px-5 text-right">
                          <div className="h-7 w-24 bg-skeleton rounded-full inline-block" />
                        </td>
                      )}
                    </tr>
                  ))}
                </>
              )}

              {/* Empty Roster State */}
              {!membersQuery.isPending && !membersQuery.isError && members.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-14 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-elevated border border-subtle flex items-center justify-center text-muted">
                        <Users className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-primary font-medium text-sm">No members found</p>
                        <p className="text-secondary text-xs mt-1">
                          Share your organization&apos;s invite code to bring contributors into this workspace.
                        </p>
                      </div>
                      {inviteCode && (
                        <button
                          type="button"
                          onClick={() => void handleCopyCode()}
                          className="mt-2 px-3 py-1.5 rounded-xl bg-elevated hover:bg-surface text-xs text-primary border border-subtle flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Invite Code: {inviteCode}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {/* No Search Matches State */}
              {!membersQuery.isPending &&
                !membersQuery.isError &&
                members.length > 0 &&
                filteredMembers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-secondary">
                      No members matching &ldquo;{searchQuery}&rdquo; with the selected role filter.
                    </td>
                  </tr>
                )}

              {/* Member Rows */}
              {!membersQuery.isPending &&
                filteredMembers.map((m) => {
                  const isCurrentUser = Boolean(currentUserId && m.profile_id === currentUserId);
                  const rawName = m.profiles?.display_name?.trim();
                  const displayName =
                    rawName ||
                    (isCurrentUser && currentUserName
                      ? currentUserName
                      : `Member ${m.profile_id.slice(0, 6)}`);

                  const parts = displayName.split(/\s+/).filter(Boolean);
                  const initials =
                    parts.length >= 2
                      ? (parts[0][0] + parts[1][0]).toUpperCase()
                      : displayName.slice(0, 2).toUpperCase() || "MB";

                  const avatarUrl = m.profiles?.avatar_url;

                  return (
                    <tr key={m.id} className="hover:bg-elevated transition-colors">
                      <td className="py-3.5 px-5 flex items-center gap-3">
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={displayName}
                            className="w-8 h-8 rounded-full object-cover border border-subtle shadow-inner shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-elevated border border-subtle text-primary flex items-center justify-center font-semibold text-xs tracking-wider shadow-inner shrink-0">
                            {initials}
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-primary font-medium truncate">{displayName}</span>
                            {isCurrentUser && (
                              <Badge variant="neutral">
                                <UserCheck className="w-2.5 h-2.5" /> You
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-muted tabular-nums break-all">
                            {m.profiles?.username?`@${m.profiles.username} · `:""}
                            User ID: {m.profile_id}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-5">
                        {m.role === "owner" ? <Badge variant="success">Owner</Badge> : isOwnerOrAdmin ? <Select
                          ariaLabel={`Role for ${displayName}`} value={m.role}
                          onChange={event => updateRoleMutation.mutate({ memberId: m.id, newRole: event.target.value })}
                          disabled={updateRoleMutation.isPending}
                          variant="pill"
                          selectSize="sm"
                          align="left"
                          menuWidth="auto"
                          className="w-fit"
                          buttonClassName="h-7! min-h-7! gap-1.5! rounded-lg! border-subtle! bg-elevated! px-2.5! py-0! text-xs!"
                          options={[
                            { value: "organization_admin", label: "Admin" }, { value: "treasurer", label: "Treasurer" },
                            { value: "auditor", label: "Auditor" }, { value: "member", label: "Member" },
                          ]} /> : getRoleBadge(m.role)}
                      </td>
                      <td className="py-3.5 px-5 tabular-nums text-secondary">{new Date(m.created_at).toLocaleDateString()}</td>
                      <td className="py-3.5 px-5 text-right">
                        {m.role === "owner" && isCurrentUser && <span title="Root owner access cannot be modified here" className="inline-flex cursor-not-allowed">
                          <button type="button" aria-disabled="true" aria-label="Root owner access cannot be modified here"
                            className="inline-flex size-8 cursor-not-allowed items-center justify-center rounded-lg text-muted opacity-35">
                            <Ellipsis size={20} />
                          </button>
                        </span>}
                        {effectiveRole === "owner" && !isCurrentUser && m.role !== "owner" && <RecordActions title={displayName}
                          extra={{ label: "Transfer Ownership", onClick: () => { transfer.reset(); setTransferTarget(m); } }} />}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
