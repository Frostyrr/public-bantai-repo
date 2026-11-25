import type { OnboardingTourId } from "../../lib/api";

export type GuideId =
  | OnboardingTourId
  | "org_collections"
  | "org_budgets"
  | "org_expenses"
  | "org_advances"
  | "org_directory";

export function isPersistedTourId(id: GuideId): id is OnboardingTourId {
  return id === "org_overview" || id === "org_projects";
}

export interface TourStepDefinition {
  id: string;
  /** Ordered list of stable CSS selectors (first visible match wins). */
  targets: string[];
  title: string;
  body: string | ((role: string) => string);
  /** Optional role allow-list; omit to show to all roles. */
  roles?: string[];
  preferredPlacement?: "top" | "bottom" | "left" | "right";
}

export interface TourDefinition {
  id: GuideId;
  version: number;
  title: string;
  routeSuffix: string;
  steps: TourStepDefinition[];
}

const OFFICER_FINANCE_ROLES = new Set(["owner", "organization_admin", "treasurer"]);

export const TOUR_DEFINITIONS: Record<GuideId, TourDefinition> = {
  org_overview: {
    id: "org_overview",
    version: 1,
    title: "Organization Introduction",
    routeSuffix: "overview",
    steps: [
      {
        id: "overview-nav",
        targets: ['[data-tour="nav-sidebar"]', '[data-tour="mobile-nav-trigger"]'],
        title: "Navigate your workspace",
        body: "Use the navigation menu to switch between Overview, Projects, Collections, Budgets, Expenses, and workspace settings.",
        preferredPlacement: "right",
      },
      {
        id: "overview-metrics",
        targets: ['[data-tour="overview-metrics"]'],
        title: "Understand your financial overview",
        body: "Track available reserves, collections, budgets, and expenses at a glance for the active reporting period.",
        preferredPlacement: "bottom",
      },
      {
        id: "overview-bani",
        targets: ['[data-tour="ask-bani-trigger"]'],
        title: "Meet Bani, your financial assistant",
        body: (role) =>
          OFFICER_FINANCE_ROLES.has(role)
            ? "Open Ask Bani (Cmd/Ctrl+J) anytime to query balances, trends, or reports, and check Bani Insights on the left for automated ledger checks."
            : "Open Ask Bani anytime to ask questions about your contributions, dues, or workspace activity.",
        preferredPlacement: "bottom",
      },
      {
        id: "overview-activity",
        targets: ['[data-tour="overview-activity"]'],
        title: "Follow organizational activity",
        body: (role) =>
          OFFICER_FINANCE_ROLES.has(role)
            ? "Recent collections, budgets, expenses, and advances appear here. Open Collections, Budgets, or Expenses from the sidebar to begin recording activity."
            : "Follow organizational transactions here, and check My Contributions in the sidebar for your personal dues and receipts.",
        preferredPlacement: "top",
      },
    ],
  },
  org_projects: {
    id: "org_projects",
    version: 1,
    title: "Projects Introduction",
    routeSuffix: "spaces",
    steps: [
      {
        id: "projects-purpose",
        targets: ['[data-tour="projects-header"]'],
        title: "What Projects group together",
        body: "Group collections, budgets, expenses, and cash advances for an event, initiative, or ongoing program—such as a General Assembly or Fundraising Drive.",
        preferredPlacement: "bottom",
      },
      {
        id: "projects-create",
        targets: ['[data-tour="projects-create"]'],
        title: "Create a Project",
        body: "Authorized officers can create Projects here. Projects are completely optional—your organization can also operate without any.",
        roles: ["owner", "organization_admin"],
        preferredPlacement: "bottom",
      },
      {
        id: "projects-assign",
        targets: ['[data-tour="projects-list"]', '[data-tour="projects-empty"]'],
        title: "Projects and linked records",
        body: "Your Projects appear here. Open a Project to view its related totals. When creating a collection, budget, expense, or cash advance in its own section, you can optionally link it to a Project.",
        preferredPlacement: "top",
      },
      {
        id: "projects-filters",
        targets: ['[data-tour="projects-filters"]'],
        title: "Find a Project",
        body: "Search Projects by name or description, or filter the list by active, completed, or archived status.",
        preferredPlacement: "bottom",
      },
    ],
  },
  org_collections: {
    id: "org_collections",
    version: 1,
    title: "Collections & Dues Guide",
    routeSuffix: "collections",
    steps: [
      {
        id: "collections-overview",
        targets: ['[data-tour="collections-header"]'],
        title: "Collections & Member Dues",
        body: "Track incoming dues, assessments, and fundraising collections in one place.",
        preferredPlacement: "bottom",
      },
      {
        id: "collections-create",
        targets: ['[data-tour="collections-create"]'],
        title: "Create a Collection",
        body: "Officers can launch a new collection, set a target or fixed dues amount, and optionally link it to a Project.",
        roles: ["owner", "organization_admin", "treasurer"],
        preferredPlacement: "bottom",
      },
      {
        id: "collections-filters",
        targets: ['[data-tour="collections-filters"]'],
        title: "Filter by Project or Status",
        body: "Search collections or filter by Project and status to inspect specific initiatives.",
        preferredPlacement: "bottom",
      },
    ],
  },
  org_budgets: {
    id: "org_budgets",
    version: 1,
    title: "Budgets Guide",
    routeSuffix: "budgets",
    steps: [
      {
        id: "budgets-overview",
        targets: ['[data-tour="budgets-header"]'],
        title: "Authorized Spending Limits",
        body: "Budgets set clear spending limits for operating periods or specific Projects, with real-time burn tracking.",
        preferredPlacement: "bottom",
      },
      {
        id: "budgets-create",
        targets: ['[data-tour="budgets-create"]'],
        title: "Create a Budget",
        body: "Officers can allocate funds here and optionally link a budget to a Project so expenses roll up automatically.",
        roles: ["owner", "organization_admin", "treasurer"],
        preferredPlacement: "bottom",
      },
      {
        id: "budgets-filters",
        targets: ['[data-tour="budgets-filters"]'],
        title: "Monitor Utilization",
        body: "Filter budgets by Project or status to spot high utilization before overspending occurs.",
        preferredPlacement: "bottom",
      },
    ],
  },
  org_expenses: {
    id: "org_expenses",
    version: 1,
    title: "Expenses Guide",
    routeSuffix: "expenses",
    steps: [
      {
        id: "expenses-overview",
        targets: ['[data-tour="expenses-header"]'],
        title: "Expense Claims & Receipts",
        body: "Submit itemized expenses with receipts. Claims are checked against linked budgets and your organization's approval rules.",
        preferredPlacement: "bottom",
      },
      {
        id: "expenses-create",
        targets: ['[data-tour="expenses-create"]'],
        title: "Submit an Expense",
        body: "Attach receipt details, optionally charge to a budget, and link to a Project if applicable.",
        preferredPlacement: "bottom",
      },
      {
        id: "expenses-filters",
        targets: ['[data-tour="expenses-filters"]'],
        title: "Filter & Review",
        body: "Filter expenses by Project, category, or approval status to audit spending quickly.",
        preferredPlacement: "bottom",
      },
    ],
  },
  org_advances: {
    id: "org_advances",
    version: 1,
    title: "Cash Advances Guide",
    routeSuffix: "liquidation",
    steps: [
      {
        id: "advances-overview",
        targets: ['[data-tour="advances-header"]'],
        title: "Advances & Liquidation",
        body: "Release funds upfront for events or errands, then reconcile them with itemized expenses and any returned cash.",
        preferredPlacement: "bottom",
      },
      {
        id: "advances-create",
        targets: ['[data-tour="advances-create"]'],
        title: "Release a Cash Advance",
        body: "Officers can disburse an advance to a member and optionally link it to a Project or budget.",
        roles: ["owner", "organization_admin", "treasurer"],
        preferredPlacement: "bottom",
      },
      {
        id: "advances-filters",
        targets: ['[data-tour="advances-filters"]'],
        title: "Track Liquidation Status",
        body: "Switch views or filter by status to follow outstanding, under-review, and settled advances.",
        preferredPlacement: "bottom",
      },
    ],
  },
  org_directory: {
    id: "org_directory",
    version: 1,
    title: "Member Directory Guide",
    routeSuffix: "directory",
    steps: [
      {
        id: "directory-overview",
        targets: ['[data-tour="directory-header"]'],
        title: "Organization Roster",
        body: "Maintain your member roster for dues assessment and obligation tracking—separate from workspace login access.",
        preferredPlacement: "bottom",
      },
      {
        id: "directory-actions",
        targets: ['[data-tour="directory-actions"]'],
        title: "Add, Import, or Export",
        body: "Add members individually, bulk-import from CSV/Excel, or export your directory at any time.",
        preferredPlacement: "bottom",
      },
      {
        id: "directory-list",
        targets: ['[data-tour="directory-list"]'],
        title: "Search & Filter Roster",
        body: "Quickly locate members by name, identifier, or custom directory fields.",
        preferredPlacement: "bottom",
      },
    ],
  },
};

export function resolveTourSteps(tourId: GuideId, role: string): TourStepDefinition[] {
  const def = TOUR_DEFINITIONS[tourId];
  return def.steps.filter((step) => !step.roles || step.roles.includes(role));
}
