export type SemanticTone = "success" | "warning" | "danger" | "info" | "neutral";

export const SEMANTIC_BADGE_CLASSES: Record<SemanticTone, string> = {
  success: "bg-sem-success-bg text-sem-success-fg border-sem-success-border",
  warning: "bg-sem-warning-bg text-sem-warning-fg border-sem-warning-border",
  danger: "bg-sem-error-bg text-sem-error-fg border-sem-error-border",
  info: "bg-sem-info-bg text-sem-info-fg border-sem-info-border",
  neutral: "bg-sem-neutral-bg text-sem-neutral-fg border-sem-neutral-border",
};

export function getStatusSemanticTone(status?: string | null): SemanticTone {
  switch (status?.trim().toLowerCase()) {
    case "approved":
    case "active":
    case "liquidated":
    case "paid":
    case "owner":
    case "completed":
      return "success";
    case "pending":
    case "pending_approval":
    case "pending approval":
    case "under_review":
    case "under review":
    case "outstanding":
    case "unreconciled":
    case "partially_paid":
    case "partially paid":
      return "warning";
    case "rejected":
    case "disputed":
    case "cancelled":
    case "overdue":
    case "deficit":
      return "danger";
    case "verified":
    case "organization_admin":
    case "organization admin":
    case "treasurer":
    case "admin":
      return "info";
    default:
      return "neutral";
  }
}

export function getStatusBadgeClasses(status?: string | null): string {
  return SEMANTIC_BADGE_CLASSES[getStatusSemanticTone(status)];
}
