import useFinancialQuery from "../../hooks/useFinancialQuery";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import { formatErrorMessage } from "../../utils/formatError";
import { useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  CreditCard,
  Edit2,
  FileCheck,
  FolderKanban,
  LayoutGrid,
  List,
  PieChart,
  TrendingUp,
} from "lucide-react";
import Badge from "../../components/ui/Badge";
import CompactAmount from "../../components/ui/CompactAmount";
import FinancialQueryState from "../../components/layout/FinancialQueryState";
import {
  getSpaces,
  updateSpace, type Membership, type OrganizationDetails,
} from "../../lib/api";

const tabs = [
  ["Collections", "collections"],
  ["Budgets", "budgets"],
  ["Expenses", "expenses"],
  ["Cash advances", "liquidation"],
] as const;

const outstandingStatuses = new Set(["outstanding", "under_review", "disputed"]);

export default function OrgSpaceDetail() {
  const { spaceId } = useParams();
  const { organization, membership, activePeriodId } = useOutletContext<{
    organization: OrganizationDetails;
    activePeriodId: string;
    membership: Membership;
  }>();
  const [tab, setTab] = useState(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("bantai_space_records_view") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const setAndPersistViewMode = (mode: "grid" | "list") => {
    setViewMode(mode);
    try {
      localStorage.setItem("bantai_space_records_view", mode);
    } catch {
      /* Optional preference storage. */
    }
  };
  const org = organization.id;
  const base = `/app/org/${org}`;
  const spaces = useQuery({ queryKey: ["organization-spaces", org], queryFn: () => getSpaces(org) });
  const space = spaces.data?.find(item => item.id === spaceId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const canManage = membership?.role === "owner" || membership?.role === "organization_admin";
  const update = useMutation({
    mutationFn: (values: { name: string; description: string; status: "active" | "archived" }) =>
      updateSpace(org, space!.id, values),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["organization-spaces", org] });
    },
  });
  const filters = { spaceId, periodId: activePeriodId === "all" ? undefined : activePeriodId };
  const collections = useFinancialQuery("collections", org, filters, !!space);
  const budgets = useFinancialQuery("budgets", org, filters, !!space);
  const expenses = useFinancialQuery("expenses", org, filters, !!space);
  const advances = useFinancialQuery("advances", org, filters, !!space);
  const summary = useFinancialQuery("financial-summary", org, filters, !!space);

  const queries = [collections, budgets, expenses, advances, summary];
  const linkedCollections = collections.data ?? [];
  const linkedBudgets = budgets.data ?? [];
  const linkedExpenses = expenses.data ?? [];
  const linkedAdvances = advances.data ?? [];
  const totals = [
    {
      label: "Collected",
      amount: linkedCollections.reduce((total, item) => total + (item.total_collected_centavos ?? 0), 0),
      Icon: TrendingUp,
    },
    {
      label: "Budget allocated",
      amount: linkedBudgets.filter(item => item.status === "active").reduce((total, item) => total + item.allocated_amount_centavos, 0),
      Icon: PieChart,
    },
    {
      label: summary.data?.provisional ? "Expenditure (provisional)" : "Recognized expenditure",
      amount: summary.data?.total_expenses_centavos ?? 0,
      Icon: CreditCard,
    },
    {
      label: "Outstanding advances",
      amount: linkedAdvances.filter(item => outstandingStatuses.has(item.status)).reduce((total, item) => total + item.amount_released_centavos, 0),
      Icon: FileCheck,
    },
  ] as const;

  const tabItems = [
    linkedCollections.map(item => ({
      id: item.id,
      kind: "Collection",
      label: item.title,
      amount: item.total_collected_centavos ?? 0,
      status: item.status,
      href: `${base}/collections/${item.id}`,
    })),
    linkedBudgets.filter(item => !item.archived_at).map(item => ({
      id: item.id,
      kind: "Budget",
      label: item.name,
      amount: item.allocated_amount_centavos,
      status: item.status,
      href: `${base}/budgets?budget=${item.id}`,
    })),
    linkedExpenses.filter(item => !item.archived_at).map(item => ({
      id: item.id,
      kind: "Expense",
      label: item.title,
      amount: item.amount_centavos,
      status: item.status,
      href: `${base}/expenses?space=${spaceId}`,
    })),
    linkedAdvances.map(item => ({
      id: item.id,
      kind: "Cash advance",
      label: item.title,
      amount: item.amount_released_centavos,
      status: item.status,
      href: `${base}/liquidation?space=${spaceId}`,
    })),
  ];
  const rows = tabItems[tab];
  const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: organization.currency || "PHP", currencyDisplay: "code" });

  return (
    <div className="page-shell workspace-page space-y-5!">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs font-mono text-secondary">
        <Link to={`${base}/spaces`} className="inline-flex items-center gap-1.5 hover:text-primary transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Projects</span>
        </Link>
        {space && (
          <>
            <span className="text-muted">/</span>
            <span aria-current="page" className="text-primary truncate">{space.name}</span>
          </>
        )}
      </nav>
      {spaces.isPending || spaces.isError ? <FinancialQueryState queries={[spaces]} variant="space-detail" kpiCount={4} showFilterToolbar={false} /> : !space ? (
        <p role="status" className="text-sm text-secondary">This project is unavailable in this workspace.</p>
      ) : (
        <>
          <header className="card-specular p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-heading text-xl sm:text-2xl font-medium tracking-tight wrap-anywhere">
                    <span className="text-display-gradient">{space.name}</span>
                  </h1>
                  {space.status === "active" ? (
                    <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Active
                    </span>
                  ) : (
                    <Badge>{space.status}</Badge>
                  )}
                </div>
                {space.description && (
                  <p className="mt-1.5 text-sm text-secondary wrap-anywhere">{space.description}</p>
                )}
              </div>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8! px-3! rounded-lg! text-xs! shrink-0"
                  icon={<Edit2 className="w-3.5 h-3.5" />}
                  onClick={() => { update.reset(); setEditing(true); }}
                >
                  Edit space
                </Button>
              )}
            </div>
          </header>
          {space.status === "archived" && (
            <p role="status" className="rounded-xl border border-subtle bg-surface px-4 py-3 text-sm text-secondary">
              This space is archived. Existing records remain available, and new assignments require an active space.
            </p>
          )}
          {editing && (
            <Modal isOpen onClose={() => { if (!update.isPending) setEditing(false); }} maxWidth="md" labelledBy="edit-space-title">
              <h2 id="edit-space-title" className="modal-title mb-4">Edit space</h2>
              <form className="space-y-4" onSubmit={event => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const name = String(data.get("name")).trim();
                if (name) update.mutate({
                  name, description: String(data.get("description")).trim(),
                  status: data.get("status") === "archived" ? "archived" : "active",
                });
              }}>
                <label className="block text-xs font-medium text-secondary">Name
                  <input required name="name" defaultValue={space.name} className="mt-1.5 block w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary focus:outline-none focus:border-strong" />
                </label>
                <label className="block text-xs font-medium text-secondary">Description
                  <textarea name="description" rows={3} defaultValue={space.description ?? ""} className="mt-1.5 block w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary focus:outline-none focus:border-strong" />
                </label>
                <label className="block text-xs font-medium text-secondary">Status
                  <select name="status" defaultValue={space.status} className="mt-1.5 block w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary focus:outline-none focus:border-strong">
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                {update.error && <p role="alert" className="text-sm text-sem-error-fg">{formatErrorMessage(update.error)}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={update.isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" isLoading={update.isPending}>
                    Save changes
                  </Button>
                </div>
              </form>
            </Modal>
          )}
          {queries.some(query => query.isError || query.isPending) ? <FinancialQueryState queries={queries} variant="space-detail-body" kpiCount={4} showFilterToolbar={false} /> : (
            <>
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {totals.map(({ label, amount, Icon }) => (
                  <div key={label} className="kpi-card min-w-0 rounded-2xl border border-subtle bg-surface p-5 shadow-xs dark:shadow-none">
                    <div className="flex items-center justify-between text-secondary mb-2">
                      <dt className="field-label">{label}</dt>
                      <Icon className="w-4 h-4 text-muted shrink-0" />
                    </div>
                    <dd className="metric-value wrap-anywhere text-primary">
                      <CompactAmount centavos={amount} currency={organization.currency || "PHP"} animate />
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle">
                <div className="flex overflow-x-auto" role="group" aria-label="Linked financial records">
                  {tabs.map(([label], index) => (
                    <button key={label} type="button" aria-pressed={tab === index} onClick={() => setTab(index)}
                      className={`shrink-0 inline-flex items-center gap-2 cursor-pointer border-b-2 px-3 py-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-strong ${tab === index ? "border-action text-primary" : "border-transparent text-secondary hover:text-primary"}`}>
                      <span>{label}</span>
                      <Badge>{tabItems[index].length}</Badge>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 pb-2 sm:pb-0">
                  <div
                    role="group"
                    aria-label="View layout"
                    className="inline-flex items-center rounded-lg border border-subtle bg-elevated p-0.5"
                  >
                    <button
                      type="button"
                      aria-label="Grid view"
                      aria-pressed={viewMode === "grid"}
                      onClick={() => setAndPersistViewMode("grid")}
                      className={`grid size-7 place-items-center rounded-md transition-colors cursor-pointer ${
                        viewMode === "grid"
                          ? "bg-surface text-primary shadow-xs dark:shadow-none"
                          : "text-muted hover:text-primary"
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="List view"
                      aria-pressed={viewMode === "list"}
                      onClick={() => setAndPersistViewMode("list")}
                      className={`grid size-7 place-items-center rounded-md transition-colors cursor-pointer ${
                        viewMode === "list"
                          ? "bg-surface text-primary shadow-xs dark:shadow-none"
                          : "text-muted hover:text-primary"
                      }`}
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <Link
                    className="inline-flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-secondary hover:text-primary transition-colors"
                    to={`${base}/${tabs[tab][1]}?space=${space.id}`}
                  >
                    <span>Open {tabs[tab][0]}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
              {rows.length ? (
                viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {rows.map(row => (
                      <Link
                        key={row.id}
                        to={row.href}
                        className="card-specular-interactive group flex flex-col justify-between rounded-2xl border border-subtle bg-surface p-5 shadow-xs dark:shadow-none focus-visible:ring-2 focus-visible:ring-strong"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
                              {row.kind}
                            </span>
                            <Badge>{row.status.replaceAll("_", " ")}</Badge>
                          </div>
                          <h3 className="mt-2.5 text-base font-medium text-primary wrap-anywhere">
                            {row.label}
                          </h3>
                        </div>
                        <div className="mt-4 pt-3.5 border-t border-subtle flex items-center justify-between gap-2">
                          <span className="text-sm font-mono font-medium tabular-nums text-primary">
                            {money.format(row.amount / 100)}
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted group-hover:text-primary transition-colors" />
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <ul className="table-specular divide-y divide-subtle rounded-2xl border border-subtle bg-surface shadow-xs dark:shadow-none overflow-hidden">
                    {rows.map(row => (
                      <li key={row.id}>
                        <Link to={row.href} className="group flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm text-primary hover:bg-hover-surface/70 transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-strong">
                          <span className="min-w-0 font-medium wrap-anywhere">{row.label}</span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs font-mono tabular-nums text-secondary">{money.format(row.amount / 100)}</span>
                            <Badge>{row.status.replaceAll("_", " ")}</Badge>
                            <ChevronRight className="w-4 h-4 text-muted group-hover:text-primary transition-colors" />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className="card-specular rounded-2xl border border-subtle bg-surface p-10 text-center shadow-xs dark:shadow-none">
                  <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-muted mx-auto mb-3">
                    <FolderKanban className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-primary">No {tabs[tab][0].toLowerCase()} linked yet</p>
                  <p className="mt-1 text-xs text-secondary">
                    Records assigned to {space.name} will appear here.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
