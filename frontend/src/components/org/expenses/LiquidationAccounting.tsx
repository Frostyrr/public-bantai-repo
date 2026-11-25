import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../ui/Button";
import Input from "../../ui/Input";
import Select from "../../ui/Select";
import {
  confirmLiquidationAccounting, getExpenses, getLiquidationAccounting, recordLiquidationResolution,
  type CashAdvance, type Liquidation, type LiquidationAllocation, type LiquidationResolutionKind,
} from "../../../lib/api";
import { formatErrorMessage } from "../../../utils/formatError";

const resolutionLabels: Record<LiquidationResolutionKind, string> = {
  recovery: "Record returned cash",
  write_off: "Write off shortage",
  excess_return: "Confirm excess cash received",
};

export default function LiquidationAccounting({ advance, liquidation, canManage }: {
  advance: CashAdvance;
  liquidation: Liquidation;
  canManage: boolean;
}) {
  const org = advance.organization_id;
  const id = liquidation.id;
  const client = useQueryClient();
  const key = ["liquidation-accounting", org, id];
  const [links, setLinks] = useState<LiquidationAllocation[]>([]);
  const [expenseId, setExpenseId] = useState("");
  const [allocation, setAllocation] = useState("");
  const [attribution, setAttribution] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [kind, setKind] = useState<LiquidationResolutionKind>("recovery");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reversal, setReversal] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const accounting = useQuery({ queryKey: key, queryFn: () => getLiquidationAccounting(org, id) });
  const expenses = useQuery({
    queryKey: ["liquidation-eligible-expenses", org, advance.space_id, advance.reporting_period_id],
    queryFn: () => getExpenses(org, {
      spaceId: advance.space_id ?? undefined,
      periodId: advance.reporting_period_id ?? undefined,
    }),
    enabled: canManage && accounting.isSuccess && !accounting.data.review,
  });
  const eligible = (expenses.data ?? []).filter(expense =>
    expense.status === "approved" && expense.currency === advance.currency &&
    expense.space_id === advance.space_id && expense.reporting_period_id === advance.reporting_period_id &&
    (!expense.budget_id || !advance.budget_id || expense.budget_id === advance.budget_id));
  const chosen = eligible.find(expense => expense.id === expenseId);
  const mixedBudget = chosen && chosen.budget_id !== advance.budget_id;
  const allocationCentavos = Math.round(Number(allocation) * 100);

  async function refresh() {
    await Promise.all([key, ["financial-summary", org], ["budgets", org], ["financial-insights", org]].map(queryKey =>
      client.invalidateQueries({ queryKey })));
  }
  const review = useMutation({
    mutationFn: () => confirmLiquidationAccounting(org, id, { links, reason: reviewReason }),
    onSuccess: refresh,
  });
  const resolution = useMutation({
    mutationFn: () => {
      const original = accounting.data?.entries.find(entry => entry.id === reversal);
      return recordLiquidationResolution(org, id, {
        request_id: requestId,
        entry_kind: original?.kind ?? (pendingShortage > 0 ? kind : "excess_return"),
        amount: original ? -original.amount_centavos : Math.round(Number(amount) * 100),
        reason, reversal: original?.id,
      });
    },
    onSuccess: async () => {
      setRequestId(crypto.randomUUID());
      setAmount("");
      setReason("");
      setReversal("");
      await refresh();
    },
  });

  if (accounting.isPending) return <p className="text-sm text-secondary">Loading liquidation accounting…</p>;
  if (accounting.isError) return <p role="alert" className="text-sm text-secondary">{formatErrorMessage(accounting.error)}</p>;
  const { entries } = accounting.data;
  const pendingShortage = Math.max(0, liquidation.outstanding_balance_centavos)
    - entries.reduce((total, entry) => entry.kind === "excess_return" ? total : total + entry.amount_centavos, 0);
  const pendingExcess = Math.max(0, liquidation.total_returned_centavos - advance.amount_released_centavos)
    - entries.reduce((total, entry) => entry.kind === "excess_return" ? total + entry.amount_centavos : total, 0);
  const format = (value: number) => `${advance.currency} ${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return <section className="space-y-4 border-t border-subtle pt-4 text-sm">
    <h3 className="font-medium text-primary">Liquidation accounting</h3>
    <p className="text-secondary">{accounting.data.review
      ? `Reconciliation confirmed. ${accounting.data.review.payload.length} expense allocation(s).`
      : "Provisional totals until an officer confirms whether existing approved expenses overlap."}</p>
    {canManage && !accounting.data.review && <form className="space-y-3" onSubmit={event => { event.preventDefault(); review.mutate(); }}>
      <Select label="Approved expense" value={expenseId} onChange={event => { setExpenseId(event.target.value); setAttribution(false); }}
        options={[{ value: "", label: "Select an expense" }, ...eligible.filter(expense => !links.some(link => link.expense_id === expense.id))
          .map(expense => ({ value: expense.id, label: `${expense.title} · ${format(expense.amount_centavos)}` }))]} />
      {expenses.isError && <p role="alert">{formatErrorMessage(expenses.error)}</p>}
      {chosen && <>
        <Input label="Amount of the overlapping purchase" type="number" min="0.01" step="0.01" value={allocation} onChange={event => setAllocation(event.target.value)} />
        {mixedBudget && <label className="flex items-center gap-2">
          <input type="checkbox" checked={attribution} onChange={event => setAttribution(event.target.checked)} />
          Attribute this amount to {chosen.budgets?.name ?? advance.budgets?.name ?? "the assigned budget"}.
        </label>}
        <Button type="button" variant="outline" size="sm"
          disabled={allocationCentavos <= 0 || allocationCentavos > chosen.amount_centavos || Boolean(mixedBudget && !attribution)}
          onClick={() => {
            setLinks([...links, { expense_id: chosen.id, amount_centavos: allocationCentavos,
              attributed_budget_id: mixedBudget ? chosen.budget_id ?? advance.budget_id ?? undefined : undefined }]);
            setExpenseId("");
            setAllocation("");
          }}>Add allocation</Button>
      </>}
      {links.map(link => <div key={link.expense_id} className="flex items-center justify-between gap-3">
        <span>{eligible.find(expense => expense.id === link.expense_id)?.title} · {format(link.amount_centavos)}</span>
        <Button variant="outline" size="sm" type="button" onClick={() => setLinks(links.filter(item => item.expense_id !== link.expense_id))}>Remove</Button>
      </div>)}
      <Input label="Reconciliation reason" required minLength={3} value={reviewReason} onChange={event => setReviewReason(event.target.value)} />
      <Button type="submit" size="sm" disabled={review.isPending || expenses.isError || expenses.isPending || !!chosen}>
        {links.length ? "Confirm allocations" : "Confirm no overlapping expenses"}
      </Button>
    </form>}
    {pendingShortage > 0 && <p className="text-secondary">Unresolved shortage: {format(pendingShortage)}</p>}
    {pendingExcess > 0 && <p className="text-secondary">Unconfirmed excess return: {format(pendingExcess)}</p>}
    {entries.map(entry => <div key={entry.id} className="flex items-center justify-between gap-3">
      <span>{resolutionLabels[entry.kind]} · {format(entry.amount_centavos)} · {entry.reason}</span>
      {canManage && entry.amount_centavos > 0 && !entries.some(item => item.reverses === entry.id) &&
        <Button type="button" variant="outline" size="sm" onClick={() => { setReversal(entry.id); setReason(""); setRequestId(crypto.randomUUID()); }}>Reverse</Button>}
    </div>)}
    {canManage && (pendingShortage > 0 || pendingExcess > 0 || reversal) && <form className="space-y-3" onSubmit={event => { event.preventDefault(); resolution.mutate(); }}>
      {reversal ? <p>Reverse the selected entry <button type="button" className="underline" onClick={() => setReversal("")}>Cancel</button></p> : <>
        <Select label="Resolution" value={pendingShortage > 0 ? kind : "excess_return"}
          onChange={event => { setKind(event.target.value as LiquidationResolutionKind); setRequestId(crypto.randomUUID()); }}
          options={Object.entries(resolutionLabels).filter(([key]) => key === "excess_return" ? pendingExcess > 0 : pendingShortage > 0)
            .map(([value, label]) => ({ value, label }))} />
        <Input label="Amount" type="number" min="0.01" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} />
      </>}
      <Input label="Reason and receipt reference, if applicable" required minLength={3} value={reason} onChange={event => setReason(event.target.value)} />
      <Button type="submit" size="sm" disabled={resolution.isPending}>Record resolution</Button>
    </form>}
    {(review.error || resolution.error) && <p role="alert">{formatErrorMessage(review.error || resolution.error)}</p>}
  </section>;
}
