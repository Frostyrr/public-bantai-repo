import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import { Archive } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import API from "../../config/apiClient";
import Button from "../../components/ui/Button";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
  InspectorSection,
} from "../../components/ui/DetailInspector";
import { useInspectorSelection } from "../../hooks/useInspectorSelection";
import { getBudgets, getCollections, getExpenses, getSpaces, type Budget, type Collection, type Expense, type Membership } from "../../lib/api";
import BudgetDetailsModal from "../../components/org/budgets/BudgetDetailsModal";
import ExpenseDetailsModal from "../../components/org/expenses/ExpenseDetailsModal";
import RecordActions from "../../components/org/shared/RecordActions";

const categories = { all: "All", collection: "Collections", budget: "Budgets", expense: "Expenses" } as const;
type Category = keyof typeof categories;
type Metadata = { id: string; archived_at: string | null; archived_by: string | null; space: string | null };
type Row = { title: string; amount: number; date: string | null; actor: string; space: string } & (
  { kind: "collection"; record: Collection } | { kind: "budget"; record: Budget } | { kind: "expense"; record: Expense }
);

const dateLabel = (row: Row) => row.date ? new Date(row.date).toLocaleDateString() : "on an unknown date";
const amountLabel = (row: Row) => new Intl.NumberFormat("en-PH", {
  style: "currency", currency: row.record.currency || "PHP", currencyDisplay: "code",
}).format(row.amount / 100);

export default function OrgArchives() {
  const { organization, membership } = useOutletContext<{ organization: { id: string; currency: string }; membership: Membership }>();
  const org = organization.id;
  const canRestore = ["owner", "organization_admin", "treasurer"].includes(membership.role);
  const allowed = canRestore || membership.role === "auditor";
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [space, setSpace] = useState("");
  const query = useQuery({
    queryKey: ["collection-archives", org, "directory"],
    enabled: allowed,
    queryFn: async ({ signal }) => {
      const loadMetadata = async () => {
        const rows: Metadata[] = [];
        for (let page = 0; ; page += 1) {
          const { data } = await API.get<{ rows: Metadata[]; hasMore: boolean }>(
            `/organizations/${org}/archives`, { params: { page }, signal },
          );
          rows.push(...data.rows);
          if (!data.hasMore) return new Map(rows.map(row => [row.id, row]));
        }
      };
      const [metadata, collections, budgets, expenses, spaces] = await Promise.all([
        loadMetadata(), getCollections(org, { status: "archived" }), getBudgets(org), getExpenses(org), getSpaces(org),
      ]);
      const rows: Row[] = [
        ...collections.filter(record => record.status === "archived").map((record): Row => ({
          kind: "collection", record, title: record.title, amount: record.target_amount_centavos,
          space: record.spaces?.name ?? metadata.get(record.id)?.space ?? "No space",
          date: metadata.get(record.id)?.archived_at ?? null, actor: metadata.get(record.id)?.archived_by ?? "Unknown user",
        })),
        ...budgets.filter(record => record.archived_at).map((record): Row => ({
          kind: "budget", record, title: record.name, amount: record.allocated_amount_centavos,
          space: record.spaces?.name ?? "No space", date: record.archived_at ?? null, actor: record.archive_actor?.display_name ?? "Unknown user",
        })),
        ...expenses.filter(record => record.archived_at).map((record): Row => ({
          kind: "expense", record, title: record.title, amount: record.amount_centavos,
          space: record.spaces?.name ?? "No space", date: record.archived_at ?? null, actor: record.archive_actor?.display_name ?? "Unknown user",
        })),
      ];
      rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      return { rows, spaces };
    },
  });

  const rows = query.data?.rows ?? [];
  const filtered = Boolean(search.trim() || space);
  const visible = rows.filter(row => (category === "all" || category === row.kind)
    && (!space || row.record.space_id === space)
    && [row.title, row.space, row.actor].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));

  const getArchiveRowId = useCallback((row: Row) => `${row.kind}-${row.record.id}`, []);
  const {
    selectedItem: selected,
    selectItem: setSelected,
    close: closeArchiveInspector,
    navigate: navigateArchive,
  } = useInspectorSelection(visible, getArchiveRowId);

  const banner = selected ? `Archived ${selected.date ? "on " : ""}${dateLabel(selected)} by ${selected.actor} • Restore to make changes.` : undefined;

  function actions(row: Row) {
    const parent = query.data?.spaces.find(item => item.id === row.record.space_id);
    const blocked = Boolean(row.record.space_id && parent?.status !== "active");
    return <div className="flex flex-col items-end">
      <RecordActions cardHeader title={row.title} onView={() => setSelected(row)}
        archive={canRestore && !blocked ? { org, id: row.record.id, kind: row.kind, archived: true, spaceName: row.space } : undefined} />
      {canRestore && blocked && <span className="max-w-36 text-right text-xs text-secondary">Restore the parent Project first.</span>}
    </div>;
  }

  return <section className="page-shell workspace-page">
    <header className="border-b border-subtle pb-6">
      <Badge variant="context" className="page-header-eyebrow">Retention &amp; Recovery</Badge>
      <h1 className="page-title"><span className="text-display-gradient">Archives</span></h1>
      <p className="page-subtitle">View and restore financial records removed from active workspace views.</p>
      <p className="mt-2 text-xs text-muted">Showing archives from all periods.</p>
    </header>
    {!allowed ? <p role="alert">You don’t have access to Archives.</p> : <>
      <div aria-label="Archive categories" className="flex flex-wrap gap-x-4 border-b border-subtle">
        {(Object.keys(categories) as Category[]).map(key => <button key={key} type="button" aria-pressed={category === key}
          onClick={() => setCategory(key)} className={`cursor-pointer border-b-2 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-strong ${category === key ? "border-primary text-primary" : "border-transparent text-secondary hover:text-primary"}`}>
          {categories[key]} {!!rows.length && <span className="ml-1 tabular-nums text-muted">{key === "all" ? rows.length : rows.filter(row => row.kind === key).length}</span>}
        </button>)}
      </div>
      <div className="filter-toolbar">
        <input type="search" aria-label="Search archives" placeholder="Search by name, space, or user..." value={search}
          onChange={event => setSearch(event.target.value)} className="toolbar-search min-w-0 flex-1 rounded-xl border border-subtle bg-surface px-4 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-strong" />
        <Select
          ariaLabel="Project"
          value={space}
          onValueChange={setSpace}
          variant="pill"
          selectSize="sm"
          menuWidth="auto"
          className="w-fit shrink-0"
          buttonClassName="h-9! min-h-9! rounded-xl! border-subtle! bg-surface! px-3.5! text-sm! text-primary!"
          options={[
            { value: "", label: "Project: All Projects" },
            ...(query.data?.spaces.map(item => ({ value: item.id, label: item.name })) ?? []),
          ]}
        />
      </div>
      {query.isPending ? <div role="status" aria-label="Loading archives" className="space-y-2 rounded-xl border border-subtle p-4">
        {[0, 1, 2].map(index => <div key={index} className="h-16 rounded-lg bg-skeleton motion-safe:animate-pulse md:h-12" />)}
      </div> : query.isError ? <div role="alert" className="rounded-xl border border-subtle p-6 text-center">
        <p className="mb-3 font-medium text-primary">Unable to load archives</p>
        <Button variant="outline" onClick={() => void query.refetch()}>Try again</Button>
      </div> : !visible.length ? <ModuleEmptyState>
        <Archive className="mx-auto mb-3 size-5 text-secondary" />
        <h2 className=" section-title">{filtered ? "No matching archives" : category === "all" ? "No archived records" : `No archived ${categories[category].toLowerCase()}`}</h2>
        <p className="mt-2 text-sm text-secondary">{filtered ? "No archived records match your current search or space filter."
          : category === "all" ? "When collections, budgets, or expenses are archived from active views, they will appear here for reference and restoration."
          : `There are currently no ${categories[category].toLowerCase()} in the archive.`}</p>
        {filtered && <Button variant="outline" className="mt-4" onClick={() => { setSearch(""); setSpace(""); }}>Clear filters</Button>}
      </ModuleEmptyState> : <>
        <div className="table-specular bg-surface shadow-xs dark:shadow-none hidden rounded-xl border border-subtle overflow-hidden md:block">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="text-secondary"><tr>{["Record", "Type", "Project", "Amount", "Archived", "Actions"].map(label =>
              <th key={label} scope="col" className={`p-3 ${["Amount", "Actions"].includes(label) ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
            <tbody>{visible.map(row => {
              const isSelected = selected?.record.id === row.record.id && selected?.kind === row.kind;
              return <tr key={`${row.kind}-${row.record.id}`} onClick={() => setSelected(row)} className={`cursor-pointer border-t border-subtle transition-colors ${isSelected ? "bg-selected-surface" : "hover:bg-elevated"}`}>
              <th scope="row" className="p-3 font-medium wrap-anywhere text-primary"><button type="button" className="cursor-pointer text-left hover:underline">{row.title}</button></th>
              <td className="p-3 capitalize text-secondary">{row.kind}</td>
              <td className="p-3 wrap-anywhere text-secondary">{row.space}</td>
              <td className="p-3 text-right row-amount wrap-anywhere text-primary">{amountLabel(row)}</td>
              <td className="p-3 text-xs wrap-anywhere text-secondary">{dateLabel(row)}<br />by {row.actor}</td>
              <td className="p-3" onClick={event => event.stopPropagation()}>{actions(row)}</td>
            </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="space-y-3 md:hidden">{visible.map(row => <article key={row.record.id} className="card-specular bg-surface shadow-xs dark:shadow-none rounded-xl border border-subtle p-4">
          <div className="flex items-center justify-between gap-3"><p className="min-w-0 wrap-anywhere text-xs text-secondary"><span className="capitalize">{row.kind}</span> · {row.space}</p>{actions(row)}</div>
          <div className="my-2 grid grid-cols-2 gap-3 text-sm">
            <button type="button" onClick={() => setSelected(row)} className="cursor-pointer text-left font-medium wrap-anywhere text-primary hover:underline">{row.title}</button>
            <span className="text-right row-amount wrap-anywhere text-primary">{amountLabel(row)}</span>
          </div>
          <p className="border-t border-subtle pt-3 text-xs text-secondary">Archived {dateLabel(row)} by {row.actor}</p>
        </article>)}</div>
      </>}
    </>}
    <ExpenseDetailsModal
      expense={selected?.kind === "expense" ? selected.record : null}
      archiveBanner={banner}
      onClose={closeArchiveInspector}
      onNavigate={navigateArchive}
    />
    <BudgetDetailsModal
      budget={selected?.kind === "budget" ? selected.record : null}
      currency={organization.currency}
      archiveBanner={banner}
      onClose={closeArchiveInspector}
      onNavigate={navigateArchive}
    />
    <DetailInspector
      isOpen={selected?.kind === "collection"}
      onClose={closeArchiveInspector}
      onNavigate={navigateArchive}
      categoryLabel="Archived Collection Details"
      title={selected?.kind === "collection" ? selected.title : ""}
      footer={
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="rounded-full" onClick={closeArchiveInspector}>
            Close
          </Button>
        </div>
      }
    >
      {selected?.kind === "collection" && (
        <>
          {banner && (
            <p className="rounded-xl bg-elevated border border-subtle p-3 text-xs text-secondary">
              {banner}
            </p>
          )}
          <InspectorGrid>
            <InspectorField label="Target" value={amountLabel(selected)} mono />
            <InspectorField label="Project" value={selected.space} />
          </InspectorGrid>
          {selected.record.description && (
            <InspectorSection title="Description">
              <p className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.02] p-3 text-xs whitespace-pre-wrap text-secondary">
                {selected.record.description}
              </p>
            </InspectorSection>
          )}
          <Link
            className="inline-block text-xs font-medium text-primary underline hover:text-secondary"
            to={`../collections/${selected.record.id}`}
          >
            View roster and payment history →
          </Link>
        </>
      )}
    </DetailInspector>
  </section>;
}
