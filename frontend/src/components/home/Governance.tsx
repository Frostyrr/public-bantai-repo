import { Shield } from "lucide-react";
import HairlineGrid from "../ui/HairlineGrid";
import ScrollReveal from "../ui/ScrollReveal";

const roles = [
  ["Owner", "Set workspace policy, assign officer roles, manage reporting periods, and oversee archival decisions."],
  ["Admin", "Manage spaces, member rosters, invite codes, and daily operations while keeping audit records intact."],
  ["Treasurer", "Record member dues, allocate project budgets, disburse cash advances, and prepare financial reports."],
  ["Auditor", "Review receipts, approval chains, adjustments, and activity logs independently, with access set by the workspace."],
  ["Project Leads", "Coordinate project budgets, submit itemized expense claims, and account for advances where authorized."],
  ["Members", "View personal dues and payment receipts, and read published organization summaries."],
] as const;

export default function Governance() {
  return (
    <section id="governance" tabIndex={-1} aria-labelledby="governance-heading" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
      <ScrollReveal className="mb-8 text-center">
        <p className="mb-4 flex items-center justify-center gap-2 text-xs font-medium text-secondary">
          <Shield className="size-3.5" aria-hidden="true" /> Role-Based Governance
        </p>
        <h2 id="governance-heading" className="text-3xl leading-[1.12] tracking-[-0.025em] sm:text-4xl md:text-[42px]">
          <span className="text-display-gradient">Built for every role in your organization.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-secondary sm:text-base">
          Give people access to the records and tools they need, with clear responsibilities for handling shared funds.
        </p>
      </ScrollReveal>
      <HairlineGrid items={roles} />
    </section>
  );
}
