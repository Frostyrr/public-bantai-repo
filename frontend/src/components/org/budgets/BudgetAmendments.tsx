import API from "../../../config/apiClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Budget } from "../../../lib/api";
import { financialKey } from "../../../utils/queryKeys";
import { formatErrorMessage } from "../../../utils/formatError";
import { toast } from "../../../lib/toast";
import Button from "../../../components/ui/Button";
import Input from "../../../components/ui/Input";
import Modal from "../../../components/ui/Modal";

type Amendment = {
  id: string;
  previous_centavos: number;
  proposed_centavos: number;
  proposed_by: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
};

export default function BudgetAmendments({ org, budget, ownerOrAdmin, actor, onClose }: {
  org: string; budget: Budget; ownerOrAdmin: boolean; actor?: string; onClose: () => void;
}) {
  const client = useQueryClient();
  const path = `/organizations/${org}/budgets/${budget.id}/amendments`;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const proposed = /^\d+(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : NaN;
  const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currencyDisplay: "code", currency: budget.currency }).format(value / 100);
  const query = useQuery({
    queryKey: [path],
    queryFn: async () => (await API.get<{ amendments: Amendment[] }>(path)).data.amendments,
  });
  const save = useMutation({
    mutationFn: async (body: object) => (await API.post<{ amendment: Amendment }>(path, body)).data.amendment,
    onSuccess: result => {
      toast.success(`Budget amendment ${result.status === "pending" ? "submitted" : result.status}`);
      void client.invalidateQueries({ queryKey: [path] });
      void client.invalidateQueries({ queryKey: financialKey("budgets", org, {}) });
      void Promise.all([client.invalidateQueries({ queryKey: ["financial-summary", org] }), client.invalidateQueries({ queryKey: ["financial-insights", org] })]);
      onClose();
    },
  });
  const pending = query.data?.find(item => item.status === "pending");
  return <Modal isOpen onClose={() => { if (!save.isPending) onClose(); }} labelledBy="budget-amendment-title">
    <h2 id="budget-amendment-title" className="mb-4 font-semibold text-primary section-title">Budget amendments</h2>
    {query.isPending && (
      <div role="status" aria-label="Loading amendments" className="space-y-2 animate-pulse motion-reduce:animate-none">
        {[0, 1].map(i => <div key={i} className="h-16 rounded-xl border border-subtle bg-skeleton" />)}
      </div>
    )}
    {query.isError && <p role="alert">Could not load amendments. <Button onClick={() => void query.refetch()}>Retry</Button></p>}
    {query.data?.map(item => <div key={item.id} className="mb-3 rounded-xl border border-subtle bg-elevated/60 p-3 text-sm">
      <p className="text-primary">{money(item.previous_centavos)} to {money(item.proposed_centavos)} · {item.status}</p>
      <p className="break-words text-secondary">{item.reason}</p>
      {item === pending && ownerOrAdmin && actor && actor !== item.proposed_by && <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={save.isPending} onClick={() => save.mutate({ amendmentId: item.id, decision: "approved" })}>Approve amendment</Button>
        <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ amendmentId: item.id, decision: "rejected" })}>Reject amendment</Button>
      </div>}
    </div>)}
    {query.isSuccess && !pending && budget.status === "active" && <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (Number.isSafeInteger(proposed) && proposed !== budget.allocated_amount_centavos && reason.trim().length >= 3)
        save.mutate({ expected: budget.allocated_amount_centavos, proposed, reason: reason.trim() });
    }}>
      <p className="text-sm text-secondary">Current allocation {money(budget.allocated_amount_centavos)} · Available after approved expenses {money(budget.remaining_centavos ?? budget.allocated_amount_centavos)}</p>
      <Input label="Proposed allocation" required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
      {Number.isSafeInteger(proposed) && <p className="text-sm text-secondary">Net change {money(proposed - budget.allocated_amount_centavos)}</p>}
      <Input label="Reason" required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
      <Button type="submit" isLoading={save.isPending}>Submit amendment</Button>
    </form>}
    {save.isError && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(save.error)}</p>}
    <Button variant="outline" className="mt-4" onClick={onClose} disabled={save.isPending}>Close</Button>
  </Modal>;
}
