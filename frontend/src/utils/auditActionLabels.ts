const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Platform & Security
  platform_session_timeout_updated: "Session Timeout Policy Updated",
  platform_role_updated: "Platform Role Updated",
  platform_user_suspended: "User Account Suspended",
  platform_user_restored: "User Account Restored",
  platform_org_suspended: "Workspace Suspended",
  platform_org_restored: "Workspace Restored",
  security_incident_created: "Security Incident Created",
  security_incident_updated: "Security Incident Updated",
  organization_regional_settings_updated: "Organization Regional Settings Updated",
  organization_time_zone_changed: "Organization Time Zone Changed",
  organization_type_initialized: "Organization Type Set",
  organization_type_changed: "Organization Type Changed",

  // Approvals
  "approvals.insert": "Approval Decision Recorded",
  "approvals.update": "Approval Status Updated",
  "approvals.delete": "Approval Decision Revoked",
  review_expense: "Expense Review Decision",

  // Expenses & Cash Advances
  submit_expense: "Expense Submitted",
  "expenses.insert": "Expense Submitted",
  "expenses.update": "Expense Details Edited",
  "expenses.delete": "Expense Removed",
  update_expense: "Expense Modified",
  delete_expense: "Expense Archived",
  release_cash_advance: "Cash Advance Released",
  "cash_advances.insert": "Cash Advance Released",
  "cash_advances.update": "Cash Advance Modified",
  "cash_advances.delete": "Cash Advance Cancelled",
  update_cash_advance: "Cash Advance Modified",
  delete_cash_advance: "Cash Advance Cancelled",
  submit_liquidation: "Liquidation Submitted",
  "liquidations.insert": "Liquidation Submitted",
  delete_liquidation: "Liquidation Cancelled",

  // Collections & Payments
  create_collection: "Campaign Created",
  update_collection: "Campaign Details Edited",
  delete_collection: "Campaign Archived",
  "collections.insert": "Campaign Created",
  "collections.update": "Collection Updated",
  "collections.delete": "Campaign Archived",
  record_payment: "Payment Recorded",
  "payments.insert": "Payment Logged",
  reverse_payment: "Payment Reversed",
  "payments.update": "Payment Modified",
  "payments.delete": "Payment Voided",
  assign_obligation: "Member Due Assigned",
  "obligations.insert": "Member Dues Assigned",
  "obligations.update": "Member Due Adjusted",
  "obligations.delete": "Member Due Waived",

  // Budgets
  create_budget: "Budget Created",
  update_budget: "Budget Allocation Edited",
  delete_budget: "Budget Archived",
  "budgets.insert": "Budget Created",
  "budgets.update": "Budget Adjusted",
  "budgets.delete": "Budget Archived",

  // Operational Projects & Periods
  create_space: "Project Created",
  update_space: "Project Edited",
  delete_space: "Project Archived",
  "spaces.insert": "Project Created",
  "spaces.update": "Project Modified",
  create_reporting_period: "Accounting Period Opened",
  "reporting_periods.insert": "Accounting Period Created",

  // Workspace & Members
  update_organization: "Workspace Settings Updated",
  update_organization_logo: "Workspace Logo Changed",
  regenerate_invite_code: "Invite Code Regenerated",
  "organizations.update": "Workspace Settings Modified",
  update_member_role: "Member Role Changed",
  "organization_members.insert": "Member Joined Workspace",
  "organization_members.update": "Member Status Changed",
  join_organization: "Member Joined Workspace",
};

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Converts a technical audit action identifier into a plain-language label. */
export function formatAuditActionLabel(action: string): string {
  const normalized = action.trim().toLowerCase();
  if (AUDIT_ACTION_LABELS[normalized]) {
    return AUDIT_ACTION_LABELS[normalized];
  }
  if (normalized.endsWith(".insert")) {
    return `${titleCase(normalized.slice(0, -7).replace(/_/g, " "))} Created`;
  }
  if (normalized.endsWith(".update")) {
    return `${titleCase(normalized.slice(0, -7).replace(/_/g, " "))} Updated`;
  }
  if (normalized.endsWith(".delete")) {
    return `${titleCase(normalized.slice(0, -7).replace(/_/g, " "))} Removed`;
  }
  return titleCase(normalized.replace(/[._]/g, " ")) || "System Event";
}

/** Formats a concise plain-language summary from before/after audit payloads. */
export function formatAuditChangeSummary(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string {
  if (!after && !before) return "—";
  const target = after ?? before ?? {};
  const entries = Object.entries(target).slice(0, 3);
  if (entries.length === 0) return "—";
  return entries
    .map(([key, val]) => {
      const label = titleCase(key.replace(/_/g, " "));
      const prev = before && key in before ? before[key] : undefined;
      if (after && prev !== undefined && prev !== val) {
        return `${label}: ${String(prev)} → ${String(val)}`;
      }
      return `${label}: ${String(val)}`;
    })
    .join(" · ");
}

export type AuditEventSignificance = "critical" | "high" | "medium" | "low";

export const AUDIT_SIGNIFICANCE_META: Record<
  AuditEventSignificance,
  { label: string; badgeClass: string; dotClass: string; description: string }
> = {
  critical: {
    label: "Critical",
    badgeClass: "border-rose-500/35 bg-rose-500/15 text-rose-300",
    dotClass: "bg-rose-500",
    description: "Suspensions, deletions, reversals & incident alerts",
  },
  high: {
    label: "High",
    badgeClass: "border-amber-500/35 bg-amber-500/15 text-amber-300",
    dotClass: "bg-amber-500",
    description: "Role changes, rejections & security triage",
  },
  medium: {
    label: "Medium",
    badgeClass: "border-blue-500/30 bg-blue-500/12 text-blue-300",
    dotClass: "bg-blue-500",
    description: "Approvals, settings & financial modifications",
  },
  low: {
    label: "Routine",
    badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    dotClass: "bg-emerald-500",
    description: "Standard creations, restorations & payments",
  },
};

/** Classifies an audit action by operational/security significance. */
export function getAuditActionSignificance(action: string): AuditEventSignificance {
  const a = action.trim().toLowerCase();
  if (
    a.includes("suspend") ||
    a.includes("delete") ||
    a.includes("reverse") ||
    a.includes("disput") ||
    a === "security_incident_created" ||
    a.endsWith(".delete")
  ) {
    return "critical";
  }
  if (
    a.includes("role") ||
    a.includes("reject") ||
    a.includes("incident") ||
    a.includes("security") ||
    a.includes("invite_code")
  ) {
    return "high";
  }
  if (
    a.includes("update") ||
    a.includes("approv") ||
    a.includes("review") ||
    a.includes("liquidat") ||
    a.includes("settings") ||
    a.includes("time_zone") ||
    a.endsWith(".update")
  ) {
    return "medium";
  }
  return "low";
}
