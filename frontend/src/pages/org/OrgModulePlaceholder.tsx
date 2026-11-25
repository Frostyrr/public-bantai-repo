import Badge from "../../components/ui/Badge";
import { useOutletContext, useLocation } from "react-router-dom";
import {
  Receipt,
  PieChart,
  CreditCard,
  CheckSquare,
  FileCheck,
  BarChart3,
  History,
  Lock,
} from "lucide-react";
import { type OrganizationDetails, type Membership } from "../../lib/api";

interface ContextType {
  organization: OrganizationDetails;
  membership: Membership;
}

export default function OrgModulePlaceholder() {
  const { organization } = useOutletContext<ContextType>();
  const location = useLocation();

  const getModuleConfig = () => {
    const path = location.pathname;
    if (path.includes("/collections")) {
      return {
        title: "Collections & Member Obligations",
        phase: "Phase 4 — Next Milestone",
        icon: <Receipt className="w-8 h-8 text-zinc-400" />,
        description:
          "Manage dues campaigns, track individual member payment obligations, record exact-centavo settlements, and issue tamper-evident digital receipts.",
        features: [
          "Member Contribution Obligation Roster",
          "Cash, Bank Transfer & E-Wallet Entry",
          "Automated Digital Receipt Generator (RCP-xxxx)",
          "Reversal-first payment adjustment workflow",
        ],
      };
    }
    if (path.includes("/budgets")) {
      return {
        title: "Budgets & Authorized Spending Limits",
        phase: "Phase 5 Milestone",
        icon: <PieChart className="w-8 h-8 text-zinc-400" />,
        description:
          "Define authorized spending allocations scoped to active reporting periods or optional spaces, preventing unapproved deficit spending.",
        features: [
          "Authorized Budget Allocations",
          "Project Limits",
          "Live burn rate & remaining balance tracking",
          "Historical budget versioning",
        ],
      };
    }
    if (path.includes("/expenses")) {
      return {
        title: "Expenses & Receipt Verification",
        phase: "Phase 5 Milestone",
        icon: <CreditCard className="w-8 h-8 text-zinc-500" />,
        description:
          "Submit expenditure claims with attached photo or PDF receipts stored in private encrypted Supabase storage, with itemized verification.",
        features: [
          "Private encrypted receipt file storage",
          "Treasurer submission & verification workflow",
          "Categorized expense tagging",
          "Exact integer centavo accounting",
        ],
      };
    }
    if (path.includes("/approvals")) {
      return {
        title: "Two-Officer Approvals Queue",
        phase: "Phase 5 Milestone",
        icon: <CheckSquare className="w-8 h-8 text-zinc-500" />,
        description:
          "Structured review inbox where Treasurers submit and Auditors review financial claims, ensuring no single officer can disburse funds unilaterally.",
        features: [
          "Independent dual-signoff enforcement",
          "Auditor review & rejection with reasons",
          "Batch approvals queue",
          "Immutable approval decision records",
        ],
      };
    }
    if (path.includes("/liquidation")) {
      return {
        title: "Cash Advances & Liquidation",
        phase: "Phase 6 Milestone",
        icon: <FileCheck className="w-8 h-8 text-zinc-400" />,
        description:
          "Deterministic reconciliation: Cash Released − Accepted Expenses − Returned Funds = 0. Track accountable advances to zero unreconciled balance.",
        features: [
          "Cash release custodian tracking",
          "Expense itemization against advances",
          "Return vouchers for excess cash",
          "Deterministic zero-balance reconciliation check",
        ],
      };
    }
    if (path.includes("/reports")) {
      return {
        title: "Authoritative Financial Reports",
        phase: "Phase 7 Milestone",
        icon: <BarChart3 className="w-8 h-8 text-zinc-500" />,
        description:
          "Generate exportable financial summaries, collection progress reports, budget utilization statements, and member contribution rosters.",
        features: [
          "Statement of Receipts and Disbursements",
          "Budget vs Actual expenditure reports",
          "Member dues liquidation summary",
          "CSV & Printable audit export formats",
        ],
      };
    }
    if (path.includes("/audit-logs")) {
      return {
        title: "Immutable Organization Audit Trail",
        phase: "Phase 7 Milestone",
        icon: <History className="w-8 h-8 text-zinc-300" />,
        description:
          "Traceable append-only audit logs recording every financial mutation, role change, approval decision, and reversal with actor timestamps and JSON diffs.",
        features: [
          "Database trigger-enforced audit capture",
          "Actor identity & verified timestamp",
          "Before and after value JSON diffs",
          "Tamper-proof client write revocation",
        ],
      };
    }
    return {
      title: "Workspace Module",
      phase: "Upcoming Module",
      icon: <Lock className="w-8 h-8 text-zinc-400" />,
      description: "This module is part of the planned Bantai financial platform roadmap.",
      features: [],
    };
  };

  const module = getModuleConfig();

  return (
    <div className="page-shell workspace-page">
      <div className="border-b border-subtle pb-6">
        <div className="flex items-center gap-2">
          <Badge variant="context" className="page-header-eyebrow">
            {module.phase}
          </Badge>
          <span className="text-xs font-mono text-muted">
            {organization?.name}
          </span>
        </div>
        <h1 className="page-title">
          <span className="text-display-gradient">{module.title}</span>
        </h1>
        <p className="page-subtitle">
          {module.description}
        </p>
      </div>

      <div className="rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-8 sm:p-12 text-center flex flex-col items-center backdrop-blur-xl">
        <div className="w-16 h-16 rounded-2xl bg-elevated border border-subtle flex items-center justify-center mb-6">
          {module.icon}
        </div>

        <h3 className="text-xl font-heading font-medium text-primary mb-2 tracking-tight">
          Ready for {module.phase.split("—")[0].trim()}
        </h3>

        <p className="text-xs sm:text-sm text-secondary max-w-lg mb-8 leading-relaxed">
          The foundation, multi-tenant isolation, workspace routing, and reporting period containers are fully provisioned. This module’s financial business logic and database tables will be activated in the next development increment.
        </p>

        {module.features.length > 0 && (
          <div className="w-full max-w-md text-left p-5 rounded-2xl bg-elevated border border-subtle space-y-2.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted block mb-1">
              Architectural Scope
            </span>
            {module.features.map((feat, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span>{feat}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
