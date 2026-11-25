import { Children, isValidElement, type HTMLAttributes, type ReactNode } from "react";
import { getStatusSemanticTone, SEMANTIC_BADGE_CLASSES } from "../../utils/semanticStatus";

export type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral" | "context";
const variants: Record<BadgeVariant, string> = {
  ...SEMANTIC_BADGE_CLASSES,
  context: "bg-secondary-surface text-secondary border-subtle",
};

function sentenceCase(value: string) {
  const trimmed = value.trim();
  const labels: Record<string, string> = {
    active: "Active", approved: "Approved", paid: "Paid", owner: "Owner",
    pending: "Pending", outstanding: "Outstanding", unreconciled: "Unreconciled",
    rejected: "Rejected", overdue: "Overdue", deficit: "Deficit",
    unpaid: "Unpaid", draft: "Draft", archived: "Archived", container: "Container",
    cash: "Cash", verified: "Verified", closed: "Closed", partially_paid: "Partially paid",
    under_review: "Under review", pending_approval: "Pending approval",
    organization_admin: "Organization admin", treasurer: "Treasurer", auditor: "Auditor",
    member: "Member", student: "Student", cancelled: "Cancelled", completed: "Completed",
  };
  return labels[trimmed.toLowerCase()] ?? value;
}

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child =>
    typeof child === "string" || typeof child === "number" ? String(child)
      : isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : ""
  ).join("").trim().toLowerCase();
}

export default function Badge({ variant, size = "sm", dot = false, children, className = "", ...props }:
  Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
    variant?: BadgeVariant; size?: "sm" | "md"; dot?: boolean; children: ReactNode;
  }) {
  const status = textContent(children);
  const tone = variant ?? getStatusSemanticTone(status);
  return <span {...props} className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium leading-none normal-case tracking-normal tabular-nums ${size === "md" ? "h-6" : "h-5"} ${variants[tone]} ${className}`}>
    {dot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
    {Children.map(children, child => typeof child === "string" ? sentenceCase(child) : child)}
  </span>;
}
