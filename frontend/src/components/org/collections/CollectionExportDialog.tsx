import type { CollectionAmountFilters } from "./CollectionAmountFilter";
import { downloadSpreadsheet, type ExportFormat } from "../../../utils/downloadSpreadsheet";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import API from "../../../config/apiClient";
import Button from "../../../components/ui/Button";
import Modal from "../../../components/ui/Modal";
import Select from "../../../components/ui/Select";

export default function CollectionExportDialog({orgId, collectionId, q, status, obligationId, amountFilters, onClose}: {
  orgId: string; collectionId: string; q: string; status: string; obligationId?: string; amountFilters?: CollectionAmountFilters; onClose: () => void;
}) {
  const [mode, setMode] = useState("detailed");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [scope, setScope] = useState("all");
  const download = useMutation({
    mutationFn: async () => {
      try {
        const response = await API.get<Blob>(`/organizations/${orgId}/collections/${collectionId}/export`, {
          responseType: "blob",
          params: { mode, status: scope === "filtered" ? status : scope, q: scope === "filtered" ? q : undefined,
            obligationId: scope === "filtered" ? obligationId : undefined, ...(scope === "filtered" ? amountFilters : {}) },
        });
        await downloadSpreadsheet(response.data, `collection-${mode}`, format, true);
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 403) {
          throw new Error(mode === "detailed" ? "Detailed reports require directory export permission. Try Financial Summary if you have financial access." : "Financial access is required to export this report.");
        }
        throw new Error("The report could not be downloaded. Try again.");
      }
    },
    onSuccess: onClose,
  });
  return <Modal isOpen labelledBy="collection-export-title" onClose={() => { if (!download.isPending) onClose(); }}>
    <h2 id="collection-export-title" className="font-semibold text-primary section-title">Export Collection</h2>
    <p className="mt-2 text-sm text-secondary">Choose the information to include in your collection report.</p>
    <fieldset disabled={download.isPending} className="my-4 space-y-3">
      <legend className="sr-only">Report type</legend>
      {[{id:"detailed",name:"Detailed Report",description:"Includes current directory fields and financial records."},
        {id:"summary",name:"Financial Summary",description:"Includes member identification and financial records only."}].map(option =>
        <label key={option.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-emerald-400 ${mode === option.id ? "border-emerald-500/50 bg-emerald-500/5" : "border-subtle hover:bg-elevated"}`}>
          <input className="mt-1 size-4 shrink-0 appearance-auto! accent-emerald-500" type="radio" name="report-mode" checked={mode === option.id}
            onChange={() => { setMode(option.id); download.reset(); }} />
          <span><strong className="block text-sm text-primary">{option.name}</strong><span className="text-xs text-secondary">{option.description}</span></span>
        </label>)}
      <Select label="Include" value={scope} onChange={event => setScope(event.target.value)} options={[
        {value:"all",label:"All collection members"},{value:"assessed",label:"Assessed members"},
        {value:"not_assessed",label:"Not Assessed members"},{value:"filtered",label:"Current filtered results"},
      ]} />
      <Select label="Format" value={format} onChange={event => setFormat(event.target.value === "csv" ? "csv" : "xlsx")} options={[{value:"xlsx",label:"Excel workbook (.xlsx)"},{value:"csv",label:"CSV (.csv)"}]} />
    </fieldset>
    {download.error && <p role="alert" className="mb-4 text-sm text-rose-700 dark:text-rose-300">{download.error.message}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" disabled={download.isPending} onClick={onClose}>Cancel</Button>
      <Button isLoading={download.isPending} onClick={() => download.mutate()}>Export Report</Button>
    </div>
  </Modal>;
}
