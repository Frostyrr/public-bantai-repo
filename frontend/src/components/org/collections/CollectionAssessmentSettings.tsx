import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import API from "../../../config/apiClient";
import Button from "../../../components/ui/Button";
import Input from "../../../components/ui/Input";
import Modal from "../../../components/ui/Modal";
import { parseDuesAmount } from "../../../utils/duesAssignment";
import { formatErrorMessage } from "../../../utils/formatError";

export type AssessmentPolicy = { amount: number | null; automatic: boolean; failed: boolean; status: string };

export default function CollectionAssessmentSettings({ path, policy, currency, onClose, onSaved }: {
  path: string; policy: AssessmentPolicy; currency: string; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState(policy.amount === null ? "" : (policy.amount / 100).toFixed(2));
  const [automatic, setAutomatic] = useState(policy.automatic);
  const amount = parseDuesAmount(value);
  const mutation = useMutation({
    mutationFn: (retry: boolean) => API.post(path, retry ? {retry:true} : {amount, automatic}),
    onSuccess: () => { onSaved(); onClose(); },
  });
  return <Modal isOpen labelledBy="assessment-settings-title" onClose={() => { if (!mutation.isPending) onClose(); }}>
    <h2 id="assessment-settings-title" className="font-semibold section-title">Assessment settings</h2>
    <p className="my-3 text-sm text-zinc-400">Rate changes apply to future assessments. Existing dues keep their original amounts.</p>
    <Input label={`Contribution per member (${currency})`} value={value} inputMode="decimal" onChange={event=>setValue(event.target.value)} />
    <label className="my-4 flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1 size-4 appearance-auto!" checked={automatic} onChange={event=>setAutomatic(event.target.checked)} />
      Automatically assess future eligible members
    </label>
    {policy.failed && <p role="status" className="mb-3 text-sm text-amber-400">An automatic assessment failed. Retry will assess currently eligible members who have no obligation, using the saved rate.</p>}
    {mutation.error && <p role="alert" className="mb-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(mutation.error)}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
      {policy.failed && policy.automatic && <Button variant="outline" disabled={mutation.isPending || policy.status!=="active"} onClick={()=>mutation.mutate(true)}>Retry assessment</Button>}
      <Button isLoading={mutation.isPending} disabled={!amount || policy.status!=="active"} onClick={()=>mutation.mutate(false)}>Save settings</Button>
    </div>
  </Modal>;
}
