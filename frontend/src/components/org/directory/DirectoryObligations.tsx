import Badge from "../../../components/ui/Badge";
import { Link } from "react-router-dom";
import DirectoryFinancialSummary from "./DirectoryFinancialSummary";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import API from "../../../config/apiClient";
import Button from "../../../components/ui/Button";
import Modal from "../../../components/ui/Modal";
import { formatErrorMessage } from "../../../utils/formatError";

type Obligation = {
  obligation_id: string;
  collection_id: string;
  collection_title: string;
  due_date: string | null;
  currency: string;
  assessed_centavos: string;
  paid_centavos: string;
  remaining_centavos: string;
  overpaid_centavos: string;
  status: string;
  overdue: boolean;
};

type Payment = {
  id: string;
  collection_title: string;
  currency: string;
  amount_centavos: string;
  receipt_number: string;
  paid_at: string;
  status: string;
  reversed_at: string | null;
};

function amount(currency: string, cents: string) {
  const value = BigInt(cents);
  return `${currency} ${(value / 100n).toLocaleString()}.${String(value % 100n).padStart(2, "0")}`;
}

export default function DirectoryObligations({ path, name, onClose, inline = false }: {
  path: string;
  name: string;
  onClose: () => void;
  inline?: boolean;
}) {
  const [tab, setTab] = useState<"obligations" | "payments">("obligations");
  const [page, setPage] = useState(0);
  const counts = useQuery({
    queryKey: ["directory-obligations", path, "counts"],
    queryFn: async ({ signal }) => {
      const totals = { obligations: 0, payments: 0 };
      for (const type of ["obligations", "payments"] as const) {
        for (let cursor = 0; ; cursor += 1) {
          const { data } = await API.get<{ obligations?: Obligation[]; payments?: Payment[]; hasMore: boolean }>(
            path + "/" + type, { params: { page: cursor }, signal });
          totals[type] += data[type]?.length ?? 0;
          if (!data.hasMore) break;
        }
      }
      return totals;
    },
  });
  const history = useQuery({
    queryKey: ["directory-obligations", path, tab, page],
    queryFn: async ({ signal }) => (await API.get<{ obligations?: Obligation[]; payments?: Payment[]; hasMore: boolean }>(
      path + "/" + tab, { params: { page }, signal },
    )).data,
  });

  const content = <>
    {!inline && <h2 id="directory-obligations-title" className="break-words  font-semibold section-title">{name} · Financial history</h2>}
    <DirectoryFinancialSummary path={path} />
    <div className="mt-4 flex gap-5 border-b border-subtle" role="group" aria-label="Financial history">
      {(["obligations", "payments"] as const).map(item => <button type="button" key={item}
        className={`cursor-pointer border-b-2 py-3 text-sm ${tab === item ? "border-primary text-primary font-medium" : "border-transparent text-secondary hover:text-primary"}`} aria-pressed={tab === item}
        onClick={() => { setTab(item); setPage(0); }}>
        {item === "obligations" ? "Obligations" : "Payments"} <span className="tabular-nums">({counts.data?.[item] ?? "—"})</span>
      </button>)}
    </div>
    <div className="mt-4 space-y-3">
      {history.isPending && <p role="status" className="text-secondary">Loading financial history…</p>}
      {history.isError && <p role="alert" className="text-rose-700 dark:text-rose-300">{formatErrorMessage(history.error)}</p>}
      {history.isSuccess && !(history.data[tab]?.length) && <p className="text-secondary">No {tab} found.</p>}
      {history.data?.obligations?.map(row => (
        <article key={row.obligation_id} className="space-y-2 rounded-xl border border-subtle bg-elevated p-3 text-sm">
          <div className="flex items-center justify-between gap-3"><h3 className="min-w-0 break-words font-medium text-primary">{row.collection_title}</h3>
          <Badge >
            {{ pending: "Unpaid", partially_paid: "Partial", paid: "Paid", waived: "Waived" }[row.status] ?? row.status}
          </Badge></div>
          <p className="text-xs text-secondary">{row.due_date && ` · Due ${row.due_date}`}
            {row.overdue && <span className="ml-2 text-amber-700 dark:text-amber-400">Overdue</span>}
          </p>
          <dl className="grid grid-cols-3 gap-2">
            {([["Assessed", row.assessed_centavos], ["Paid", row.paid_centavos], ["Outstanding", row.remaining_centavos],
              ...(row.overpaid_centavos !== "0" ? [["Unapplied overpayment", row.overpaid_centavos]] : [])]).map(([label, value]) =>
              <div key={label} className="min-w-0"><dt className="text-secondary">{label}</dt><dd className="break-words tabular-nums text-xs sm:text-sm text-primary">{amount(row.currency, value)}</dd></div>,
            )}
          </dl>
          <Link className="inline-flex min-h-11 items-center text-secondary hover:text-primary hover:underline focus-visible:outline-2" to={`/app/org/${path.split("/")[2]}/collections/${row.collection_id}?obligation=${row.obligation_id}`} onClick={onClose}>View in Collections →</Link>
        </article>
      ))}
      {history.data?.payments?.map(row => (
        <article key={row.id} className="space-y-1 rounded-xl border border-subtle bg-elevated p-3 text-sm">
          <h3 className="break-words font-medium text-primary">{row.collection_title}</h3>
          <p className="text-primary">{amount(row.currency, row.amount_centavos)} · {row.status === "reversed" ? "Reversed" : "Recorded"}</p>
          <p className="break-all text-secondary">Receipt {row.receipt_number} · {new Date(row.paid_at).toLocaleDateString()}</p>
          {row.reversed_at && <p className="text-secondary">Reversed {new Date(row.reversed_at).toLocaleDateString()}</p>}
        </article>
      ))}
    </div>
    <footer className="mt-4 flex flex-wrap justify-end gap-2">
      {page > 0 && <Button variant="outline" onClick={() => setPage(page - 1)}>Previous</Button>}
      {history.data?.hasMore && <Button variant="outline" onClick={() => setPage(page + 1)}>Next</Button>}
      {!inline && <Button variant="outline" onClick={onClose}>Close</Button>}
    </footer>
  </>;
  return inline ? <section aria-label="Member collection history">{content}</section> : <Modal isOpen onClose={onClose} labelledBy="directory-obligations-title">{content}</Modal>;
}
