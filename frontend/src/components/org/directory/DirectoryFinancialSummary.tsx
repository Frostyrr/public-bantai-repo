import { useQuery } from "@tanstack/react-query";
import API from "../../../config/apiClient";
import { formatErrorMessage } from "../../../utils/formatError";
import CompactAmount from "../../ui/CompactAmount";

export type MemberFinancialTotals = { currency: string; obligation_count: number; assessed_centavos: string; paid_centavos: string; remaining_centavos: string; overpaid_centavos: string };
export default function DirectoryFinancialSummary({path}: {path: string}) {
  const summary = useQuery({
    queryKey: ["directory-obligations", path, "summary"],
    queryFn: async ({signal}) => (await API.get<{summaries: MemberFinancialTotals[]}>(path + "/financial-summary", {signal})).data.summaries,
  });
  return <section className="" aria-label="Financial overview">
    <h3 className="text-sm font-semibold text-primary">Financial overview</h3>
    <p className="mt-1 text-xs text-secondary">All applicable periods · Read-only</p>
    {summary.isPending && <p role="status" className="mt-3 text-sm text-secondary">Loading financial overview…</p>}
    {summary.isError && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(summary.error)}</p>}
    {summary.isSuccess && !summary.data.length && <p className="mt-3 text-sm text-secondary">Not assessed — no collection obligations assigned.</p>}
    {summary.data?.map(row => <dl key={row.currency} className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-subtle bg-elevated p-3 text-sm">
      {([["Assigned dues",row.assessed_centavos],["Valid payments",row.paid_centavos],["Outstanding",row.remaining_centavos],
        ...(BigInt(row.overpaid_centavos) > 0n ? [["Unapplied overpayment",row.overpaid_centavos]] : [])]).map(([label,value]) =>
        <div key={label} className="min-w-0"><dt className="text-xs text-secondary">{label}</dt><dd className="mt-1 select-text break-words financial-value text-primary"><CompactAmount centavos={value} currency={row.currency} /></dd></div>)}
    </dl>)}
  </section>;
}
