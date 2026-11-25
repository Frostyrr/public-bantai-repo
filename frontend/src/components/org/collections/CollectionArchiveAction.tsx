import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import API from "../../../config/apiClient";
import Button from "../../../components/ui/Button";
import Modal from "../../../components/ui/Modal";
import { toast } from "../../../lib/toast";
import { formatErrorMessage } from "../../../utils/formatError";

export default function CollectionArchiveAction({ org, id, title, archived, kind = "collection", onSuccess, renderTrigger, spaceName }: {
  org: string; id: string; title: string; archived: boolean; spaceName?: string; kind?: "collection" | "budget" | "expense"; onSuccess?: (status: string) => void; renderTrigger?: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const label = archived ? "Restore" : "Archive";
  const mutation = useMutation({
    mutationFn: async () => (await API.post<{ status: string }>(
      kind === "collection" ? `/organizations/${org}/collections/${id}/archive` : `/organizations/${org}/financial-archive/${id}`, { archive: !archived, kind },
    )).data,
    onSuccess: ({ status }) => {
      for (const key of ["collections", "collection", "collection-archives", "financial-summary", "financial-insights", "collection-assessment-policy", "budgets", "expenses"]) {
        void client.invalidateQueries({ queryKey: [key, org] });
      }
      setOpen(false);
      toast.success(archived ? "Record restored" : "Record archived");
      onSuccess?.(status);
    },
  });
  return <>
    {renderTrigger ? renderTrigger(() => { mutation.reset(); setOpen(true); }) : <Button size="sm" variant="outline" onClick={() => { mutation.reset(); setOpen(true); }}>{label}</Button>}
    <Modal isOpen={open} onClose={() => { if (!mutation.isPending) setOpen(false); }} labelledBy={`archive-title-${id}`}>
      <h2 id={`archive-title-${id}`} className="font-semibold section-title">{label} {title}{archived && spaceName && spaceName !== "No space" ? ` to ${spaceName}` : ""}?</h2>
      <p className="my-4 text-sm text-zinc-400">{archived && spaceName ? `It will reappear in active ${kind}s and be included in active workspace views.` : kind !== "collection" ? "This changes where the record appears. Its financial history is preserved." : archived
        ? "The collection returns to its previous status. Older archives with an unknown previous status return as closed."
        : "The collection becomes read-only. Assigned dues and payment history stay available in Archives."}</p>
      {mutation.isError && <p role="alert" className="my-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(mutation.error)}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button isLoading={mutation.isPending} onClick={() => mutation.mutate()}>{label} {kind}</Button>
      </div>
    </Modal>
  </>;
}
