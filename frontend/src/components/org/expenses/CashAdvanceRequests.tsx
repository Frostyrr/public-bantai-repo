import FormDraftControls from "../../../components/ui/FormDraftControls";
import { useFormDraft } from "../../../hooks/useFormDraft";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API from "../../../config/apiClient";
import Button from "../../../components/ui/Button";
import Input from "../../../components/ui/Input";
import Modal from "../../../components/ui/Modal";
import Select from "../../../components/ui/Select";
import { toast } from "../../../lib/toast";
import { formatErrorMessage } from "../../../utils/formatError";
import { parseDuesAmount } from "../../../utils/duesAssignment";

type Request = { id: string; requester: string; title: string; purpose: string; amount_centavos: number; status: string; revision: number };
export default function CashAdvanceRequests({ org, actor, role, currency, view, onViewChange, spaceId, periodId }: { spaceId?: string; periodId?: string; org: string; actor?: string; role: string; currency: string; view: "ledger" | "requests"; onViewChange: (view: "ledger" | "requests") => void }) {
  const client = useQueryClient();
  const path = `/organizations/${org}/advance-requests`;
  const [editor, setEditor] = useState<Request | "new" | null>(null);
  const [decision, setDecision] = useState<{ row: Request; action: "approve" | "reject" | "release" | "delete" } | null>(null);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [attempted, setAttempted] = useState(false);
  const cents = parseDuesAmount(amount);
  const canDecide = role === "owner" || role === "organization_admin";
  const query = useQuery({
    queryKey: ["advance-requests", org],
    queryFn: async ({ signal }) => (await API.get<{ requests: Request[] }>(path, { signal })).data.requests,
  });
  const request = editor && editor !== "new" ? editor : undefined;
  const requestVersion = (row: Request) => JSON.stringify([row.revision, row.status, row.title, row.purpose, row.amount_centavos]);
  const draft = useFormDraft({
    orgId: org, form: "advance-request", open: !!editor,
    recordId: request?.id, version: request ? requestVersion(request) : "",
    values: { title, purpose, amount },
    verifyEdit: async id => {
      const { data, error } = await query.refetch();
      const row = data?.find(item => item.id === id);
      if (error || !row || row.requester !== actor || !["pending", "rejected"].includes(row.status)) {
        throw Error("This request can no longer be revised.");
      }
      return {
        version: requestVersion(row), values: { title: row.title, purpose: row.purpose, amount: (row.amount_centavos / 100).toFixed(2) },
        adopt: () => setEditor(row),
      };
    },
    restore: v => {
      setTitle(v.title);
      setPurpose(v.purpose);
      setAmount(v.amount);
    },
  });

  const save = useMutation({
    mutationFn: async (body: { action: string; id?: string; [key: string]: unknown }) => {
      if (body.action === "delete") {
        await API.delete(`${path}/${body.id}`);
        return { status: "deleted" };
      }
      return (await API.post<{ request: Request }>(path, body)).data.request;
    },
    onMutate: draft.submission,
    onSuccess: (result, _variables, ticket) => {
      if (_variables.action === "create" || _variables.action === "revise") draft.complete(ticket);
      setEditor(null);
      setDecision(null);
      toast.success(result.status === "pending" ? "Cash advance request submitted" : `Cash advance request ${result.status}`);
      for (const key of ["advance-requests", "advances", "financial-summary", "financial-insights"]) void client.invalidateQueries({ queryKey: [key, org] });
    },
  });
  const openEditor = (row: Request | "new") => {
    save.reset();
    setAttempted(false);
    setEditor(row);
    setTitle(row === "new" ? "" : row.title);
    setPurpose(row === "new" ? "" : row.purpose);
    setAmount(row === "new" ? "" : (row.amount_centavos / 100).toFixed(2));
  };
  const openDecision = (row: Request, action: "approve" | "reject" | "release" | "delete") => {
    save.reset();
    setMethod("cash");
    setReference("");
    setDecision({ row, action });
  };
  return <section className="space-y-4">
    <div className="flex gap-5 border-b border-subtle" aria-label="Cash advance views">
      {(["ledger", "requests"] as const).map(tab => <button key={tab} type="button" aria-pressed={view === tab}
        className={`cursor-pointer border-b-2 py-3 text-sm ${view === tab ? "border-zinc-900 dark:border-white text-primary" : "border-transparent text-secondary hover:text-primary"}`}
        onClick={() => onViewChange(tab)}>{tab === "ledger" ? "Active Ledger" : `Requests (${query.data?.length ?? 0})`}</button>)}
    </div>
    <div hidden={view !== "requests"} className="space-y-3 rounded-xl border border-subtle bg-surface p-4 shadow-xs dark:shadow-none">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-primary section-title">Cash advance requests</h2><p className="text-sm text-secondary">Requests enter the ledger when funds are released.</p></div>
      {role !== "auditor" && <Button variant="outline" onClick={() => openEditor("new")}>Request advance</Button>}
    </header>
    {query.isPending && (
      <div role="status" aria-label="Loading requests" className="space-y-2 animate-pulse motion-reduce:animate-none">
        {[0, 1].map(i => <div key={i} className="h-16 rounded-xl border border-subtle bg-skeleton" />)}
      </div>
    )}
    {query.isError && <p role="alert">Could not load requests. <Button onClick={() => void query.refetch()}>Try again</Button></p>}
    {query.data?.length === 0 && <p className="text-sm text-secondary">No requests yet.</p>}
    {query.data?.map(row => <article key={row.id} className="flex flex-wrap justify-between gap-3 border-t border-subtle pt-3">
      <div className="min-w-0 break-words"><h3 className="font-medium text-primary">{row.title}</h3>
        <p className="text-sm text-secondary">{row.purpose}</p>
        <p className="text-sm capitalize text-primary">{new Intl.NumberFormat(undefined, { style: "currency", currencyDisplay: "code", currency }).format(row.amount_centavos / 100)} · {row.status}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {actor === row.requester && ["pending", "rejected"].includes(row.status) && <Button variant="outline" onClick={() => openEditor(row)}>Revise</Button>}
        {(canDecide || actor === row.requester) && row.status === "pending" && row.revision === 1 &&
          <Button variant="danger" onClick={() => openDecision(row, "delete")}>Delete</Button>}
        {canDecide && actor && actor !== row.requester && row.status === "pending" && <>
          <Button variant="outline" onClick={() => openDecision(row, "approve")}>Approve</Button>
          <Button variant="outline" onClick={() => openDecision(row, "reject")}>Reject</Button>
        </>}
        {(canDecide || role === "treasurer") && row.status === "approved" && <Button onClick={() => openDecision(row, "release")}>Record release</Button>}
      </div>
    </article>)}
    <Modal isOpen={!!editor || !!decision} onClose={() => { if (!save.isPending) { setEditor(null); setDecision(null); } }} labelledBy="cash-request-title">
      <h2 id="cash-request-title" className="mb-4 font-semibold capitalize section-title">{editor ? editor === "new" ? "Request cash advance" : "Revise cash advance request" : `${decision?.action} cash advance request`}</h2>
      {editor && <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        setAttempted(true);
        if (draft.blocked) return;
        if (title.trim().length < 2 || !purpose.trim() || !cents) return;
        save.mutate({ action: editor === "new" ? "create" : "revise", ...(editor === "new" ? {} : { id: editor.id, revision: editor.revision }), title, purpose, amountCentavos: cents });
      }}>
        <FormDraftControls draft={draft} busy={save.isPending} />
        <Input label="Title" required maxLength={150} error={attempted && title.trim().length < 2 ? "Enter at least two characters." : undefined} value={title} onChange={event => setTitle(event.target.value)} />
        <Input label="Purpose" required maxLength={1000} error={attempted && !purpose.trim() ? "Enter the purpose." : undefined} value={purpose} onChange={event => setPurpose(event.target.value)} />
        <Input label={`Requested amount (${currency})`} required inputMode="decimal" error={attempted && !cents ? "Enter a positive amount with up to two decimal places." : undefined} value={amount} onChange={event => setAmount(event.target.value)} />
        <Button type="submit" isLoading={save.isPending}>Submit for review</Button>
      </form>}
      {decision && <div className="space-y-3">
        <p className="text-sm">{decision.row.title}</p>
        {decision.action === "delete" && <p className="text-sm text-zinc-400">This permanently deletes the request.</p>}
        {decision.action === "release" && <>
          <p className="text-xs text-secondary">Release uses the current space and reporting period, if selected.</p>
          <Select label="Disbursement method" required value={method} onValueChange={setMethod} options={[
            { value: "cash", label: "Cash" }, { value: "bank_transfer", label: "Bank transfer" },
            { value: "check", label: "Check" }, { value: "gcash", label: "GCash" },
            { value: "maya", label: "Maya" }, { value: "other", label: "Other" },
          ]} />
          <Input label="Disbursement reference" maxLength={100} value={reference} onChange={event => setReference(event.target.value)} />
        </>}
        <Button isLoading={save.isPending} onClick={() => save.mutate({ action: decision.action, id: decision.row.id, revision: decision.row.revision, method, reference, ...(decision.action === "release" ? { spaceId, periodId } : {}) })}>Confirm {decision.action}</Button>
      </div>}
      {save.isError && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(save.error)}</p>}
    </Modal>
  </div></section>;
}

