import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API from "../../../config/apiClient";
import Button from "../../../components/ui/Button";
import Modal from "../../../components/ui/Modal";
import { toast } from "../../../lib/toast";
import { formatErrorMessage } from "../../../utils/formatError";

const presets = {
  simple: { label: "Simple", description: "Routine operations and budget amendments can proceed directly. Expenses and cash advances retain approval safeguards." },
  balanced: { label: "Balanced — Recommended", description: "Routine operations proceed directly. Budget amendments, assessment changes, and sensitive payment corrections require review." },
  strict: { label: "Strict", description: "Budget activation and assessment issuance also require review." },
};
type Preset = keyof typeof presets;
type Policy = { approval_preset: Preset; approval_preset_version: number };

export default function ApprovalPresetSettings({ org, isOwner }: { org: string; isOwner: boolean }) {
  const client = useQueryClient();
  const path = `/organizations/${org}/approval-preset`;
  const key = ["approval-preset", org];
  const [draft, setDraft] = useState<Preset>();
  const [confirming, setConfirming] = useState(false);
  const current = useQuery({ queryKey: key, queryFn: async ({ signal }) => (await API.get<Policy>(path, { signal })).data });
  const save = useMutation({
    mutationFn: async (input: { preset: Preset; expectedVersion: number }) => (await API.put<Policy>(path, input)).data,
    onSuccess: policy => {
      client.setQueryData(key, policy);
      setConfirming(false);
      setDraft(undefined);
      toast.success("Approval preset saved");
    },
    onError: () => { void client.invalidateQueries({ queryKey: key }); },
  });
  const selected = draft ?? current.data?.approval_preset;
  return <section className="space-y-4 rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-6">
    <div className="border-b border-subtle pb-4">
      <h2 className="font-heading text-base font-medium text-primary">Workflow Preset</h2>
      <p className="mt-1 text-xs sm:text-sm text-secondary">Presets currently affect new budget activations and amendments. The other workflow rules below are a preview.</p>
    </div>
    {current.isPending && (
      <div role="status" aria-label="Loading approval policy" className="grid gap-3 md:grid-cols-3 animate-pulse motion-reduce:animate-none">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-24 rounded-xl border border-subtle bg-elevated p-4 space-y-2">
            <div className="h-3.5 w-24 rounded bg-surface" />
            <div className="h-2.5 w-full rounded bg-surface" />
          </div>
        ))}
      </div>
    )}
    {current.isError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">Could not load the policy. <Button size="sm" variant="outline" onClick={() => void current.refetch()}>Try again</Button></p>}
    {current.data && <>
      <p className="text-xs font-mono text-secondary">Saved preset: <span className="text-primary">{presets[current.data.approval_preset].label}</span></p>
      <fieldset disabled={!isOwner || save.isPending} className="grid gap-3 md:grid-cols-3">
        <legend className="sr-only">Approval preset</legend>
        {(Object.keys(presets) as Preset[]).map(value => <label key={value}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:border-strong ${selected === value ? "border-strong bg-elevated" : "border-subtle bg-surface hover:border-strong"}`}>
          <input className="mt-1 size-4 shrink-0 appearance-auto! accent-primary cursor-pointer" type="radio" name="approval-preset"
            checked={selected === value} onChange={() => { setDraft(value); save.reset(); }} />
          <span><span className="block text-sm font-medium text-primary">{presets[value].label}</span>
            <span className="mt-1 block text-xs leading-relaxed text-secondary">{presets[value].description}</span></span>
        </label>)}
      </fieldset>
      {isOwner && <footer className="-mx-6 border-t border-subtle px-6 pt-4 flex justify-end"><Button size="sm" disabled={!draft || draft === current.data.approval_preset}
        onClick={() => { save.reset(); setConfirming(true); }}>Save Changes</Button></footer>}
    </>}
    <Modal isOpen={confirming} onClose={() => { if (!save.isPending) setConfirming(false); }} labelledBy="approval-preset-confirm">
      <div className="space-y-4">
        <h3 id="approval-preset-confirm" className="font-semibold text-primary">Update approval preset?</h3>
        {draft && <p className="text-sm text-secondary">Save {presets[draft].label} as the organization’s preset. Existing requests keep their current rules.</p>}
        {save.isError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">{formatErrorMessage(save.error)}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={save.isPending} onClick={() => setConfirming(false)}>Cancel</Button>
          <Button isLoading={save.isPending} onClick={() => {
            if (draft && current.data) save.mutate({ preset: draft, expectedVersion: current.data.approval_preset_version });
          }}>Update Policy</Button>
        </div>
      </div>
    </Modal>
  </section>;
}
