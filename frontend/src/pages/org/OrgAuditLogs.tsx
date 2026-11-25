import Select from "../../components/ui/Select";
import Badge from "../../components/ui/Badge";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
  InspectorSection,
} from "../../components/ui/DetailInspector";
import { useInspectorSelection } from "../../hooks/useInspectorSelection";
import { useCallback, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Shield,
  History,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Pagination from "../../components/ui/Pagination";
import {
  getAuditLogs,
  type AuditLog,
  type OrganizationDetails,
  type Membership,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import { AuditLogsTableSkeleton } from "../../components/layout/WorkspaceSkeletons";

interface ContextType {
  organization: OrganizationDetails;
  membership: Membership;
}

function capitalize(str: string) {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface FormattedAction {
  label: string;
  category: "approval" | "financial" | "member" | "system";
  badgeBg: string;
  icon: React.ReactNode;
}

function formatAuditAction(rawAction: string): FormattedAction {
  const normalized = rawAction.toLowerCase().trim();

  // Explicit translations for clean, jargon-free labels
  const MAP: Record<string, { label: string; category: FormattedAction["category"] }> = {
    // Approvals & Reviews
    "approvals.insert": { label: "Approval Decision Recorded", category: "approval" },
    "approvals.update": { label: "Approval Status Updated", category: "approval" },
    "approvals.delete": { label: "Approval Decision Revoked", category: "approval" },
    "liquidation_reconciliation_confirmed": { label: "Liquidation Reconciliation Confirmed", category: "financial" },
    "liquidation_resolution_recorded": { label: "Liquidation Resolution Recorded", category: "financial" },
    "review_expense": { label: "Expense Review Decision", category: "approval" },

    // Expenses & Cash Advances
    "submit_expense": { label: "Expense Submitted", category: "financial" },
    "expenses.insert": { label: "Expense Submitted", category: "financial" },
    "expenses.update": { label: "Expense Details Edited", category: "financial" },
    "expenses.delete": { label: "Expense Removed", category: "financial" },
    "update_expense": { label: "Expense Modified", category: "financial" },
    "delete_expense": { label: "Expense Archived", category: "financial" },
    "release_cash_advance": { label: "Cash Advance Released", category: "financial" },
    "cash_advances.insert": { label: "Cash Advance Released", category: "financial" },
    "cash_advances.update": { label: "Cash Advance Modified", category: "financial" },
    "cash_advances.delete": { label: "Cash Advance Cancelled", category: "financial" },
    "update_cash_advance": { label: "Cash Advance Modified", category: "financial" },
    "delete_cash_advance": { label: "Cash Advance Cancelled", category: "financial" },
    "submit_liquidation": { label: "Liquidation Submitted", category: "financial" },
    "liquidations.insert": { label: "Liquidation Submitted", category: "financial" },
    "delete_liquidation": { label: "Liquidation Cancelled", category: "financial" },

    // Collections & Payments
    "create_collection": { label: "Campaign Created", category: "financial" },
    "update_collection": { label: "Campaign Details Edited", category: "financial" },
    "delete_collection": { label: "Campaign Archived", category: "financial" },
    "collections.insert": { label: "Campaign Created", category: "financial" },
    "collections.update": { label: "Collection Updated", category: "financial" },
    "collections.delete": { label: "Campaign Archived", category: "financial" },
    "record_payment": { label: "Payment Recorded", category: "financial" },
    "payments.insert": { label: "Payment Logged", category: "financial" },
    "reverse_payment": { label: "Payment Reversed", category: "financial" },
    "payments.update": { label: "Payment Modified", category: "financial" },
    "payments.delete": { label: "Payment Voided", category: "financial" },
    "assign_obligation": { label: "Member Due Assigned", category: "financial" },
    "obligations.insert": { label: "Member Dues Assigned", category: "financial" },
    "obligations.update": { label: "Member Due Adjusted", category: "financial" },
    "obligations.delete": { label: "Member Due Waived", category: "financial" },

    // Budgets
    "create_budget": { label: "Budget Created", category: "financial" },
    "update_budget": { label: "Budget Allocation Edited", category: "financial" },
    "delete_budget": { label: "Budget Archived", category: "financial" },
    "budgets.insert": { label: "Budget Created", category: "financial" },
    "budgets.update": { label: "Budget Adjusted", category: "financial" },
    "budgets.delete": { label: "Budget Archived", category: "financial" },

    // Operational Projects & Periods
    "create_space": { label: "Project Created", category: "system" },
    "update_space": { label: "Project Edited", category: "system" },
    "delete_space": { label: "Project Archived", category: "system" },
    "spaces.insert": { label: "Project Created", category: "system" },
    "spaces.update": { label: "Project Modified", category: "system" },
    "create_reporting_period": { label: "Accounting Period Opened", category: "system" },
    "reporting_periods.insert": { label: "Accounting Period Created", category: "system" },

    // Workspace & Members
    "update_organization": { label: "Workspace Settings Updated", category: "system" },
    "update_organization_logo": { label: "Workspace Logo Changed", category: "system" },
    "regenerate_invite_code": { label: "Invite Code Regenerated", category: "system" },
    "organizations.update": { label: "Workspace Settings Modified", category: "system" },
    "update_member_role": { label: "Member Role Changed", category: "member" },
    "organization_members.insert": { label: "Member Joined Workspace", category: "member" },
    "organization_members.update": { label: "Member Status Changed", category: "member" },
    "join_organization": { label: "Member Joined Workspace", category: "member" },
  };

  const matched = MAP[normalized];
  let label = matched?.label;
  const category = matched?.category || "system";

  if (!label) {
    if (normalized.includes(".insert")) {
      const entity = normalized.replace(".insert", "").replace(/_/g, " ");
      label = `${capitalize(entity)} Created`;
    } else if (normalized.includes(".update")) {
      const entity = normalized.replace(".update", "").replace(/_/g, " ");
      label = `${capitalize(entity)} Updated`;
    } else if (normalized.includes(".delete")) {
      const entity = normalized.replace(".delete", "").replace(/_/g, " ");
      label = `${capitalize(entity)} Removed`;
    } else {
      label = capitalize(normalized.replace(/_/g, " "));
    }
  }

  if (
    normalized.includes("reject") ||
    normalized.includes("reverse") ||
    normalized.includes("delete") ||
    normalized.includes("cancel") ||
    normalized.includes("void")
  ) {
    return {
      label,
      category,
      badgeBg: "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300",
      icon: <XCircle className="w-3.5 h-3.5 shrink-0" />,
    };
  }

  if (
    normalized.includes("approve") ||
    normalized.includes("create") ||
    normalized.includes("insert") ||
    normalized.includes("paid") ||
    normalized.includes("release")
  ) {
    return {
      label,
      category,
      badgeBg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
    };
  }

  if (
    normalized.includes("update") ||
    normalized.includes("review") ||
    normalized.includes("waive") ||
    normalized.includes("regenerate")
  ) {
    return {
      label,
      category,
      badgeBg: "bg-amber-500/10 border-amber-500/20 text-amber-400",
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
    };
  }

  return {
    label,
    category,
    badgeBg: "bg-elevated border-subtle text-secondary",
    icon: <Clock className="w-3.5 h-3.5 shrink-0" />,
  };
}

function auditTarget(log: AuditLog) {
  const module = log.action.split(".")[0];
  const labels: Record<string, string> = {
    collections: "Collection", obligations: "Collection obligation", payments: "Payment",
    budgets: "Budget", expenses: "Expense", reporting_periods: "Accounting Period",
    spaces: "Project", organization_members: "Workspace member", organizations: "Organization",
    cash_advances: "Cash advance", liquidations: "Liquidation", organization_directory_members: "Directory member",
  };
  const label = labels[module] || module.replaceAll("_", " ").replace(/^./, value => value.toUpperCase());
  const snapshot = log.after_value ?? log.before_value;
  const name = snapshot?.title ?? snapshot?.name ?? snapshot?.display_name;
  return typeof name === "string" && name.trim() ? label + " · " + name : label;
}

const HIDDEN_AUDIT_KEYS = new Set([
  "id",
  "organization_id",
  "created_by",
  "updated_by",
  "actor_id",
  "profile_id",
  "created_at",
  "updated_at",
]);

function formatAuditFieldLabel(key: string): string {
  return key
    .replace(/_centavos$/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatAuditFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (key.endsWith("_centavos")) {
      return (value / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return value.toLocaleString("en-US");
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function getReadableAuditRows(
  beforeValue: Record<string, unknown> | null,
  afterValue: Record<string, unknown> | null
): Array<{ label: string; before?: string; after?: string }> {
  const before = beforeValue ?? {};
  const after = afterValue ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
    (key) => !HIDDEN_AUDIT_KEYS.has(key)
  );

  if (beforeValue && afterValue) {
    const changed = keys.filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
    );
    const targetKeys = changed.length > 0 ? changed : keys.slice(0, 8);
    return targetKeys.map((key) => ({
      label: formatAuditFieldLabel(key),
      before: formatAuditFieldValue(key, before[key]),
      after: formatAuditFieldValue(key, after[key]),
    }));
  }

  const source = afterValue ?? beforeValue ?? {};
  return keys
    .filter((key) => source[key] !== null && source[key] !== undefined && source[key] !== "")
    .slice(0, 10)
    .map((key) => ({
      label: formatAuditFieldLabel(key),
      after: formatAuditFieldValue(key, source[key]),
    }));
}

export default function OrgAuditLogs() {
  const { organization, membership } = useOutletContext<ContextType>();
  const isOfficer = ["owner", "admin", "treasurer", "auditor"].includes(
    membership.role
  );

  const [search, setSearch] = useState("");
  const [actorFilter, setActorFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [showRawDetails, setShowRawDetails] = useState(false);

  const auditQuery = useQuery({
    queryKey: ["audit-logs", organization.id],
    queryFn: () => getAuditLogs(organization.id, 100, 0),
    enabled: Boolean(organization.id) && isOfficer,
  });

  const logs = auditQuery.data ?? [];

  // Filter logs by search & category
  const filteredLogs = logs.filter((log) => {
    const formatted = formatAuditAction(log.action);
    const matchesSearch =
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      formatted.label.toLowerCase().includes(search.toLowerCase()) ||
      log.actor_name.toLowerCase().includes(search.toLowerCase()) ||
      log.entity_id.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch || (actorFilter !== "all" && log.actor_id !== actorFilter)) return false;

    if (actionFilter === "all") return true;
    if (actionFilter === "approval") return formatted.category === "approval" || log.action.toLowerCase().includes("approv");
    if (actionFilter === "payment") return log.action.toLowerCase().includes("payment");
    if (actionFilter === "collection") return log.action.toLowerCase().includes("collection") || log.action.toLowerCase().includes("obligation");
    if (actionFilter === "budget") return log.action.toLowerCase().includes("budget");
    if (actionFilter === "expense") return log.action.toLowerCase().includes("expense");
    if (actionFilter === "liquidation") return log.action.toLowerCase().includes("liquidation") || log.action.toLowerCase().includes("advance");
    if (actionFilter === "role") return log.action.toLowerCase().includes("member") || log.action.toLowerCase().includes("role");
    if (actionFilter === "settings") return log.action.toLowerCase().includes("organization") || log.action.toLowerCase().includes("period") || log.action.toLowerCase().includes("space");
    return log.action.toLowerCase().includes(actionFilter.toLowerCase()) || formatted.label.toLowerCase().includes(actionFilter.toLowerCase());
  });

  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const getLogId = useCallback((log: AuditLog) => String(log.id), []);
  const {
    selectedItem: selectedLog,
    selectItem: selectLog,
    close: closeLogInspector,
    navigate: navigateLog,
  } = useInspectorSelection(filteredLogs, getLogId);

  if (!isOfficer) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-4 font-body">
        <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-3xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-primary section-title">
            Restricted Officer Access
          </h2>
          <p className="text-sm text-secondary max-w-md mx-auto">
            This activity log is reserved for Organization Owners, Admins, Treasurers, and Auditors.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell workspace-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <Badge variant="context" className="page-header-eyebrow">Security &amp; Activity</Badge>
          <h1 className="page-title">
            <span className="text-display-gradient">Audit Logs</span>
          </h1>
          <p className="page-subtitle">
            A complete timeline of financial actions, member approvals, and settings changes.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void auditQuery.refetch()}
          disabled={auditQuery.isFetching}
          icon={
            <RefreshCw
              className={`w-3.5 h-3.5 ${auditQuery.isFetching ? "animate-spin" : ""}`}
            />
          }
          className="shrink-0 rounded-full"
        >
          Sync Logs
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-toolbar">
        <div className="toolbar-search relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="search"
            aria-label="Search audit logs"
            placeholder="Search action, actor, or target..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 bg-surface border border-subtle rounded-full text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors"
          />
        </div>

        <Select ariaLabel="Module" value={actionFilter} onChange={event => { setActionFilter(event.target.value); setCurrentPage(1); }}
          variant="pill" selectSize="sm" menuWidth="auto" options={[
            { value: "all", label: "All Modules" }, { value: "approval", label: "Approvals" },
            { value: "payment", label: "Payments" }, { value: "collection", label: "Collections" },
            { value: "budget", label: "Budgets" }, { value: "expense", label: "Expenses" },
            { value: "liquidation", label: "Cash Advances" }, { value: "role", label: "Workspace Access" }, { value: "settings", label: "Settings" },
          ]} />
        <Select ariaLabel="Actor" value={actorFilter} onChange={event => { setActorFilter(event.target.value); setCurrentPage(1); }}
          variant="pill" selectSize="sm" menuWidth="auto" options={[
            { value: "all", label: "All Members" },
            ...Array.from(new Map(logs.filter(log => log.actor_id).map(log => [log.actor_id!, log.actor_name])).entries()).map(([value, label]) => ({ value, label })),
          ]} />
      </div>

      {/* Main Audit List */}
      <div className="table-specular bg-surface rounded-xl border border-subtle shadow-xs dark:shadow-none overflow-hidden">
        {auditQuery.isLoading ? (
          <AuditLogsTableSkeleton rows={6} />
        ) : auditQuery.isError ? (
          <div className="p-8 text-center text-primary font-mono text-sm">
            {formatErrorMessage(auditQuery.error)}
          </div>
        ) : filteredLogs.length === 0 ? (
          <ModuleEmptyState>
            <History className="mb-3 size-5 text-secondary" />
            <h2 className="mb-2 section-title">No audit records</h2>
            <p className="text-sm text-secondary">
              No audit records match the selected filter criteria.
            </p>
          </ModuleEmptyState>
        ) : (
          <>
            <div className="divide-y divide-subtle overflow-x-auto">
              <table className="w-full text-left text-sm tabular-nums">
              <thead className="bg-elevated border-b border-subtle text-[11px] font-mono font-normal uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-3.5 px-6 font-normal">When</th>
                  <th className="py-3.5 px-6 font-normal">Activity</th>
                  <th className="py-3.5 px-6 font-normal">Done By</th>
                  <th className="py-3.5 px-6 font-normal">Item</th>
                  <th className="py-3.5 px-6 font-normal text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle font-body">
                {paginatedLogs.map((log) => {
                  const actionDetails = formatAuditAction(log.action);
                  const date = new Date(log.occurred_at);

                  const isSelected = selectedLog?.id === log.id;
                  const openLog = () => {
                    setShowRawDetails(false);
                    selectLog(log);
                  };

                  return (
                    <tr
                      key={log.id}
                      tabIndex={0}
                      onClick={openLog}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openLog();
                        }
                      }}
                      className={`transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/30 ${
                        isSelected ? "bg-selected-surface" : "hover:bg-elevated"
                      }`}
                    >
                      <td className="py-4 px-6 text-secondary font-mono text-xs whitespace-nowrap">
                        <div className="text-primary font-medium">
                          {date.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                        <div className="text-muted text-[11px]">
                          {date.toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </div>
                      </td>

                      <td className="py-4 px-6 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="neutral">
                            {actionDetails.icon}
                            {actionDetails.label}
                          </Badge>
                        </div>
                      </td>

                      <td className="py-4 px-6 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-elevated text-secondary flex items-center justify-center text-xs font-mono font-medium">
                            {log.actor_name ? log.actor_name[0]?.toUpperCase() : "S"}
                          </div>
                          <div className="text-sm font-medium text-primary">
                            {log.actor_name || "System"}
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-6">
                        <div className="text-sm font-medium text-primary">{auditTarget(log)}</div>
                      </td>

                      <td className="py-4 px-6 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLog();
                          }}
                          className="inline-flex min-h-9 cursor-pointer items-center text-xs font-medium text-secondary transition-colors hover:text-primary focus-visible:outline-2"
                        >
                          View details →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={currentPage}
            totalItems={filteredLogs.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            pageSizeOptions={[15, 30, 50]}
            onPageSizeChange={setPageSize}
            itemLabel="audit records"
          />
        </>
      )}
    </div>

      <DetailInspector
        isOpen={Boolean(selectedLog)}
        onClose={closeLogInspector}
        onNavigate={(dir) => {
          setShowRawDetails(false);
          navigateLog(dir);
        }}
        categoryLabel="Activity Details"
        title={selectedLog ? formatAuditAction(selectedLog.action).label : ""}
        footer={
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={closeLogInspector}
            >
              Close
            </Button>
          </div>
        }
      >
        {selectedLog && (
          <>
            <InspectorGrid>
              <InspectorField
                label="When"
                value={new Date(selectedLog.occurred_at).toLocaleString()}
              />
              <InspectorField
                label="Done By"
                value={selectedLog.actor_name || "System"}
              />
            </InspectorGrid>

            <InspectorField
              label="Item"
              value={auditTarget(selectedLog)}
            />

            {(() => {
              const rows = getReadableAuditRows(
                selectedLog.before_value,
                selectedLog.after_value
              );
              const isUpdate = Boolean(
                selectedLog.before_value && selectedLog.after_value
              );
              return (
                <InspectorSection
                  title={
                    isUpdate
                      ? "What Changed"
                      : selectedLog.after_value
                      ? "Recorded Details"
                      : "Removed Details"
                  }
                  action={
                    <button
                      type="button"
                      onClick={() => setShowRawDetails((prev) => !prev)}
                      className="text-[11px] font-mono text-muted hover:text-primary transition-colors cursor-pointer"
                    >
                      {showRawDetails
                        ? "Hide technical data"
                        : "Show technical data"}
                    </button>
                  }
                >
                  {rows.length > 0 ? (
                    <div className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/50 dark:bg-white/[0.02] divide-y divide-subtle dark:divide-white/[0.06]">
                      {rows.map((row) => (
                        <div
                          key={row.label}
                          className="flex flex-col gap-0.5 px-3.5 py-2.5"
                        >
                          <span className="text-[11px] text-secondary font-medium">
                            {row.label}
                          </span>
                          {row.before !== undefined ? (
                            <span className="text-primary break-words">
                              <span className="text-muted line-through mr-2">
                                {row.before}
                              </span>
                              <span>→ {row.after}</span>
                            </span>
                          ) : (
                            <span className="text-primary break-words">
                              {row.after}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/50 dark:bg-white/[0.02] px-3.5 py-3 text-muted">
                      No additional field details were recorded for this activity.
                    </p>
                  )}
                </InspectorSection>
              );
            })()}

            {showRawDetails && (
              <div className="space-y-3 pt-1 font-mono">
                <div className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/50 dark:bg-white/[0.02] px-3 py-2 text-[11px] text-secondary break-all">
                  Event code: {selectedLog.action} &bull; Record ID:{" "}
                  {selectedLog.entity_id}
                </div>
                <InspectorSection title="Previous data">
                  <pre className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/50 dark:bg-white/[0.02] p-3 text-[11px] text-primary max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                    {selectedLog.before_value
                      ? JSON.stringify(selectedLog.before_value, null, 2)
                      : "None"}
                  </pre>
                </InspectorSection>
                <InspectorSection title="Updated data">
                  <pre className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/50 dark:bg-white/[0.02] p-3 text-[11px] text-primary max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                    {selectedLog.after_value
                      ? JSON.stringify(selectedLog.after_value, null, 2)
                      : "None"}
                  </pre>
                </InspectorSection>
              </div>
            )}
          </>
        )}
      </DetailInspector>
    </div>
  );
}
