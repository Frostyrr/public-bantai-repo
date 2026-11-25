import { toast } from "../../../lib/toast";
import { isPaymentImportHeader, mapDirectoryHeaders, parseDirectoryCsvWithRows, restoreDirectoryCsvCell, suggestHeaderlessStudentColumns } from "../../../utils/directorySpreadsheet";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { ApiRequestError } from "../../../config/sessionRecovery";
import API from "../../../config/apiClient";
import Button from "../../../components/ui/Button";
import Modal from "../../../components/ui/Modal";
import { formatErrorMessage } from "../../../utils/formatError";
import { validateRosterXlsx } from "../../../utils/validateRosterXlsx";

const importAliases: Record<string, string[]> = {
  display_name: ["full name", "display name", "member name", "student name", "name"],
  member_code: ["member id", "member code", "identifier"],
  "custom:student_id": ["student number", "student no.", "student no"],
  "custom:program": ["course"],
  "custom:year_level": ["year"],
  "custom:section": ["block"],
};
const batchFieldKeys = ["college", "program", "year_level", "section"];
const standardColumns = ["display_name", "member_code", "email", "phone"] as const;
type Field = { key: string; label: string; kind: string; options: string[]; import_aliases?: string[] };
type NewField = { key: string; label: string; kind: "text" | "number" | "date" | "checkbox" };
type ImportRowResult = { row: number; status: string };
type ImportIssue = { row: number; field: string; message: string };

function importIssues(error: unknown): ImportIssue[] {
  if (!(error instanceof ApiRequestError) || !Array.isArray(error.issues)) return [];
  return error.issues.filter((issue): issue is ImportIssue =>
    issue && Number.isInteger(issue.row) && typeof issue.field === "string" && typeof issue.message === "string");
}

async function readRoster(file: File) {
  if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > 500000) {
    throw new Error("Choose a CSV or XLSX file up to 500 KB.");
  }
  if (/\.csv$/i.test(file.name)) {
    return parseDirectoryCsvWithRows(await file.text());
  }
  const { readSheet } = await import("read-excel-file/browser");
  const validated = await validateRosterXlsx(file);
  const rows = await readSheet(new Blob([validated]), 1, { parseNumber: value => value });
  return rows.map((row, index) => ({
    cells: row.map(value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "")),
    sourceRow: index + 1,
  })).filter(row => row.cells.some(value => value.trim()));
}

export default function DirectoryImport({ path, fields, isStudent, canEditFields, onClose, onImported }: {
  path: string;
  fields: Field[];
  isStudent: boolean;
  canEditFields: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [records, setRecords] = useState<Awaited<ReturnType<typeof readRoster>>>([]);
  const sheet = records.map(row => row.cells);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [headerMode, setHeaderMode] = useState<"headers" | "members" | null>(null);
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [editColumns, setEditColumns] = useState(false);
  const [draftFields, setDraftFields] = useState<Record<number, NewField>>({});
  const [skippedColumns, setSkippedColumns] = useState<number[]>([]);
  const [batchValues, setBatchValues] = useState<Record<string, string>>({});
  const columns = [
    ...standardColumns.filter(key => !isStudent || key !== "member_code").map(key => ({
      key, label: { display_name: "Full Name", member_code: "Member identifier", email: "Email", phone: "Phone" }[key],
      aliases: importAliases[key] ?? [],
    })),
    ...fields.map(field => ({ key: "custom:" + field.key, label: field.label, aliases: [field.key, ...(field.import_aliases ?? []), ...(importAliases["custom:" + field.key] ?? [])] })),
  ];
  const newFields = Object.values(draftFields).map(field => ({ ...field, label: field.label.trim() }));
  const importFields = [...fields, ...newFields.map(field => ({ ...field, options: [] }))];
  const fieldNames = [...columns.map(field => field.label.toLowerCase()), ...newFields.map(field => field.label.toLowerCase())];
  const invalidFields = newFields.some(field => !field.label || fieldNames.indexOf(field.label.toLowerCase()) !==
    fieldNames.lastIndexOf(field.label.toLowerCase()) || isPaymentImportHeader(field.label));
  const hasName = (mapping.display_name ?? -1) >= 0;
  const sourceOffset = headerMode === "members" ? 1 : 2;
  const sourceRow = (row: number) => records[row + sourceOffset - 3]?.sourceRow ?? row + sourceOffset - 2;
  const exportedCsv = headerMode === "headers" && /\.csv$/i.test(fileName) && sheet[0]?.includes("Status [Bantai CSV]");
  const issues: ImportIssue[] = [];
  const rows = (headerMode && hasName ? sheet.slice(sourceOffset - 1) : []).map((cells, index) => {
    const read = (key: string) => {
      const value = batchValues[key]?.trim() || (cells[mapping[key] ?? -1] ?? "");
      return (exportedCsv ? restoreDirectoryCsvCell(value) : value).trim();
    };
    const report = (field: string, message: string) => issues.push({ row: sourceRow(index + 2), field, message });
    const displayName = read("display_name");
    const memberCode = read("member_code");
    const email = read("email");
    const phone = read("phone");
    if (!displayName || displayName.length > 150) report("Name", "Enter a name of 1–150 characters.");
    if (memberCode.length > 100) report("Member identifier", "Use at most 100 characters.");
    if (phone.length > 40) report("Phone", "Use at most 40 characters.");
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) report("Email", "Enter a valid email address.");
    const attributes: Record<string, string | number | boolean> = {};
    for (const field of importFields) {
      const value = read("custom:" + field.key);
      if (!value) continue;
      switch (field.kind) {
        case "number":
          if (!Number.isFinite(Number(value))) report(field.label, "Enter a valid number.");
          else attributes[field.key] = Number(value);
          break;
        case "checkbox":
          if (!/^(true|false)$/i.test(value)) report(field.label, "Use true or false.");
          else attributes[field.key] = value.toLowerCase() === "true";
          break;
        case "date": {
          const date = new Date(value + "T00:00:00Z");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") ||
              Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
            report(field.label, "Enter a calendar date as YYYY-MM-DD.");
          } else attributes[field.key] = value;
          break;
        }
        case "select":
          if (!field.options.includes(value)) report(field.label, "Use one of the configured choices.");
          else attributes[field.key] = value;
          break;
        default:
          if (value.length > 500) report(field.label, "Use at most 500 characters.");
          else attributes[field.key] = value;
      }
    }
    return { display_name: displayName || null, member_code: memberCode || null,
      email: email || null, phone: phone || null, attributes };
  });
  const invalid = new Set(issues.map(issue => issue.row)).size;

  const downloadErrors = (errors: ImportIssue[]) => {
    const escape = (value: string) => {
      const firstContent = Array.from(value).find(char => char.charCodeAt(0) > 32 && char.trim());
      const safe = (firstContent && "=+@-".includes(firstContent)) || /^[\t\r\n]/.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const report = ["Row,Field,Issue", ...errors.map(issue => [issue.row, escape(issue.field), escape(issue.message)].join(","))];
    const url = URL.createObjectURL(new Blob([report.join("\r\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "directory-import-errors.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const preview = useMutation({
    mutationFn: async (payload: { requestId: string; rows: typeof rows; newFields: NewField[] }) =>
      (await API.post<{ rows: ImportRowResult[] }>(path + "/import/preview", payload)).data,
  });
  const previewCurrent = preview.variables?.requestId === requestId;
  const readyForPreview = !editColumns && mappingConfirmed && rows.length > 0 && rows.length <= 500 && invalid === 0;
  const refreshPreview = useEffectEvent(() => preview.mutate({ requestId, rows, newFields }));
  useEffect(() => {
    if (!readyForPreview) return;
    const timer = window.setTimeout(() => refreshPreview(), 200);
    return () => window.clearTimeout(timer);
  }, [requestId, readyForPreview]);
  const checkedRows = previewCurrent ? preview.data?.rows : undefined;
  const addCount = checkedRows?.filter(row => row.status === "new").length ?? 0;
  const hasStudentIdField = importFields.some(field => field.key === "student_id");
  const missingIds = isStudent && hasStudentIdField ? rows.filter(row => !row.attributes.student_id).length : 0;
  const importToastId = `directory-import-${requestId}`;
  const submit = useMutation({
    mutationFn: async () => (await API.post<{ inserted: number; skipped: number; rows: ImportRowResult[] }>(
      path + "/import", { requestId, rows, newFields },
    )).data,
    onMutate: () => { toast.loading("Importing members", { id: importToastId }); },
    onSuccess: result => {
      if (result.skipped) toast.warning("Import completed with skipped rows", { id: importToastId, description: `${result.inserted} added, ${result.skipped} skipped.` });
      else toast.success("Members imported", { id: importToastId, description: `${result.inserted} added.` });
      onImported();
    },
    onError: error => {
      if (importIssues(error).length) toast.dismiss(importToastId);
      else toast.error("Could not import members", { id: importToastId, duration: 7000, description: "Try again or review the import details." });
    },
  });
  const serverIssues = [...importIssues(previewCurrent ? preview.error : null), ...importIssues(submit.error)];
  const visibleIssues = [...issues, ...serverIssues.map(issue => ({ ...issue, row: sourceRow(issue.row) }))];
  const resetReview = () => {
    submit.reset();
    preview.reset();
    setRequestId(crypto.randomUUID());
  };
  const applyHeaderMode = (records: string[][], mode: "headers" | "members", csv: boolean) => {
    const headers = records[0];
    const suggested = mode === "members"
      ? (isStudent ? suggestHeaderlessStudentColumns(records) : {})
      : mapDirectoryHeaders(csv && headers.includes("Status [Bantai CSV]") ? headers.map(restoreDirectoryCsvCell) : headers, columns);
    const paymentIndices = mode === "headers"
      ? headers.flatMap((header, index) => isPaymentImportHeader(header) ? [index] : []) : [];
    const matched = Object.fromEntries(columns.map(column => {
      const index = suggested[column.key] ?? -1;
      return [column.key, paymentIndices.includes(index) ? -1 : index];
    }));
    const included = new Set([...Object.values(matched), ...paymentIndices]);
    const hasUnmatched = records.slice(1).some(row =>
      row.some((value, index) => value.trim() && !included.has(index)));

    const reviewImmediately = mode === "headers" && (matched.display_name ?? -1) >= 0 && !hasUnmatched;
    setDraftFields({});
    setMapping(matched);
    setSkippedColumns([]);
    setHeaderMode(mode);
    setMappingConfirmed(reviewImmediately);
    setEditColumns(!reviewImmediately);
    resetReview();
  };
  const sourceColumns = Array.from({ length: Math.max(0, ...sheet.map(row => row.length)) }, (_, index) => {
    let letters = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
    }
    const position = "Column " + letters;
    const header = headerMode === "headers" ? sheet[0][index]?.trim() : "";
    const duplicateHeader = header && sheet[0].filter(cell => cell.trim().toLowerCase() === header.toLowerCase()).length > 1;
    return { index, label: header ? (duplicateHeader ? `${header} (${position})` : header) : position,
      payment: Boolean(header && isPaymentImportHeader(header)),
      sample: sheet.slice(sourceOffset - 1).find(row => row[index]?.trim())?.[index] };

  });
  const matchedSources = new Map(Object.entries(mapping).filter(([, index]) => index >= 0)
    .map(([key, index]) => [index, key]));
  const unmatched = sourceColumns.filter(source => !source.payment && !matchedSources.has(source.index) &&
    !skippedColumns.includes(source.index) && source.sample);
  const paymentSources = sourceColumns.filter(source => source.payment);
  const skippedSources = sourceColumns.filter(source => !source.payment && !matchedSources.has(source.index));
  const changeMapping = (index: number, target: string) => {
    const previousDraft = draftFields[index];
    const nextDraft = target === "new" ? previousDraft ?? {
      key: "import_" + crypto.randomUUID().replaceAll("-", ""),
      label: headerMode === "headers" ? (sheet[0][index] ?? "").trim().slice(0, 80) : "",
      kind: "text" as const,
    } : undefined;
    setDraftFields(current => {
      const next = { ...current };
      if (nextDraft) next[index] = nextDraft;
      else delete next[index];
      return next;
    });
    const destination = nextDraft ? "custom:" + nextDraft.key : target;
    setMapping(current => ({
      ...Object.fromEntries(Object.entries(current).map(([key, sourceIndex]) => [key, sourceIndex === index ? -1 : sourceIndex])),
      ...(destination && destination !== "skip" ? { [destination]: index } : {}),
    }));
    setSkippedColumns(current => target === "skip" ? [...current.filter(value => value !== index), index] :
      current.filter(value => value !== index));
    resetReview();
  };
  const close = () => { if (!submit.isPending) onClose(); };

  return <Modal isOpen onClose={close} labelledBy="directory-import-title" maxWidth="3xl" mobileFullScreen>
    <header className="flex items-center justify-between gap-3">
      <div>
        <h2 id="directory-import-title" className="font-semibold section-title">Import members</h2>
        <p className="mt-1 text-sm text-secondary">{submit.isSuccess ? "Import complete" : !headerMode ? "Upload" : editColumns ? "Match columns" : "Review"}</p>
      </div>
      <Button variant="ghost" aria-label="Close import" disabled={submit.isPending} onClick={close}><X size={18} /></Button>
    </header>
    <div className="mt-4 space-y-4">
      {!submit.isSuccess && <div className="rounded-2xl border border-dashed border-strong bg-elevated p-4 text-sm">
        <p className="text-primary">CSV or XLSX file · up to 500 members · 500 KB maximum</p>
        <p className="mt-1 text-secondary">For XLSX, use the first worksheet and store identifiers as text to preserve leading zeros.</p>
        <Button className="mt-4 min-h-11" variant="outline" icon={<Upload size={16} />}
          disabled={reading || submit.isPending} onClick={() => fileInput.current?.click()}>
          {fileName ? "Choose another file" : "Upload file"}
        </Button>
        {fileName && <p className="mt-2 break-all text-secondary">{fileName}</p>}
        <input ref={fileInput} aria-label="Upload member spreadsheet" type="file" accept=".csv,.xlsx" disabled={reading || submit.isPending} className="hidden"
          onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            event.target.value = "";
            setFileName(file.name);
            setReading(true);
            setError("");
            setRecords([]);
            setHeaderMode(null);
            setMappingConfirmed(false);
            setMapping({});
            setSkippedColumns([]);
            setDraftFields({});
            setBatchValues({});
            setEditColumns(false);
            submit.reset();
            preview.reset();
            try {
              const parsed = await readRoster(file);
              if (!parsed.length || parsed.length > 501) throw new Error("Include between 1 and 500 member rows.");
              setRecords(parsed);
              const cells = parsed.map(row => row.cells);
              const detected = mapDirectoryHeaders(
                /\.csv$/i.test(file.name) && cells[0].includes("Status [Bantai CSV]")
                  ? cells[0].map(restoreDirectoryCsvCell) : cells[0], columns,
              );
              if (Object.values(detected).some(index => index >= 0)) {
                applyHeaderMode(cells, "headers", /\.csv$/i.test(file.name));
              }
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Could not read the spreadsheet.");
            } finally {
              setReading(false);
            }
          }} />
      </div>}
      {reading && <p role="status" className="text-sm text-secondary">Reading spreadsheet…</p>}
      {!!sheet.length && !submit.isSuccess && <>
        {(!headerMode || headerMode === "members") && (
          <section className="space-y-2 text-sm">
            {!headerMode && <p className="font-semibold">What is in the first row?</p>}
            {!headerMode && <p className="break-all text-secondary">{sheet[0].slice(0, 5).join(" · ")}</p>}
            {!headerMode && <Button variant="outline" onClick={() => applyHeaderMode(sheet, "members", false)}>
              First row contains member details
            </Button>}
            <Button variant="ghost" disabled={submit.isPending}
              onClick={() => applyHeaderMode(sheet, "headers", /\.csv$/i.test(fileName))}>First row contains headers</Button>
          </section>
        )}
        {headerMode && <>
          <div className="flex flex-wrap items-center gap-2">
            {!editColumns && <Button size="sm" variant="ghost" disabled={submit.isPending} onClick={() => setEditColumns(true)}>
              Edit columns
            </Button>}
            {headerMode === "headers" && <Button variant="ghost" size="sm" disabled={submit.isPending}
              onClick={() => applyHeaderMode(sheet, "members", false)}>Keep first row as a member</Button>}
          </div>
          {editColumns && <section className="space-y-3" aria-label="Match uploaded columns">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-secondary">{matchedSources.size} matched · {unmatched.length} to review</p>
              {!!unmatched.length && <Button size="sm" variant="ghost" onClick={() =>
                setSkippedColumns(current => [...current, ...unmatched.map(source => source.index)])}>Skip unmatched columns</Button>}
            </div>
            {!hasName && <p role="status" className="text-sm font-semibold">Choose which column to save as Full Name.</p>}
            <div className="divide-y divide-subtle rounded-xl border border-subtle px-3">
              {[...unmatched, ...sourceColumns.filter(source => !unmatched.includes(source))].map(source => {
                const draft = draftFields[source.index];
                const target = draft ? "new" : matchedSources.get(source.index) ?? (skippedColumns.includes(source.index) ? "skip" : "");
                return <div key={source.index} className="grid gap-2 py-3 sm:grid-cols-2 sm:items-center">
                  <div className="min-w-0 text-sm">
                    <p className="break-words font-medium">{source.label}</p>
                    {source.sample && <p className="truncate text-secondary">{source.sample}</p>}
                  </div>
                  {source.payment ? <p className="text-sm text-secondary">Payment column · skipped in member import</p> :
                    <label className="text-sm">
                      <span className="sr-only">Save {source.label} as</span>
                      <select value={target} onChange={event => changeMapping(source.index, event.target.value)}
                        className="block min-h-11 w-full rounded-xl border border-subtle bg-surface p-2 text-primary">
                        <option value="">Choose a field</option>
                        <option value="skip">Skip column</option>
                        {canEditFields && <option value="new" disabled={!draft && newFields.length >= 10}>Create custom field</option>}
                        {columns.map(column => <option key={column.key} value={column.key}
                          disabled={(mapping[column.key] ?? -1) >= 0 && mapping[column.key] !== source.index}>{column.label}</option>)}
                      </select>
                    </label>}
                  {draft && <div className="grid gap-2 rounded-lg bg-elevated p-3 sm:col-span-2 sm:grid-cols-2">
                    <label className="text-sm">Field name
                      <input className="mt-1 block min-h-11 w-full rounded-lg border border-subtle bg-surface px-2"
                        maxLength={80} value={draft.label} onChange={event => {
                          setDraftFields(current => ({ ...current, [source.index]: { ...draft, label: event.target.value } }));
                          resetReview();
                        }} />
                    </label>
                    <label className="text-sm">Field type
                      <select className="mt-1 block min-h-11 w-full rounded-lg border border-subtle bg-surface px-2"
                        value={draft.kind} onChange={event => {
                          setDraftFields(current => ({ ...current, [source.index]: { ...draft, kind: event.target.value as NewField["kind"] } }));
                          resetReview();
                        }}>
                        <option value="text">Text</option><option value="number">Number</option>
                        <option value="date">Date</option><option value="checkbox">Checkbox</option>
                      </select>
                    </label>
                  </div>}
                </div>;
              })}
            </div>
          </section>}
          {editColumns && invalidFields && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
            Give each new field a unique directory field name. Keep payment information in the collection.
          </p>}
          {!!paymentSources.length && <p className="text-sm text-secondary">
            Payment columns are skipped in member import. {paymentSources.map(source => source.label).join(", ")}
          </p>}
          {!editColumns && !!skippedSources.length && (
            <p className="text-sm text-secondary">Skipped columns · {skippedSources.map(source => source.label).join(", ")}</p>
          )}
          {isStudent && !editColumns && mappingConfirmed && fields.some(field => batchFieldKeys.includes(field.key)) && (
            <details className="space-y-2 text-sm">
              <summary className="cursor-pointer">Apply values to all rows</summary>
              <p className="text-secondary">A value here replaces that field for every row. Leave it blank to use the file.</p>
              {fields.filter(field => batchFieldKeys.includes(field.key)).map(field => {
                const key = "custom:" + field.key;
                const changeValue = (value: string) => {
                  setBatchValues(current => ({ ...current, [key]: value }));
                  resetReview();
                };
                const classes = "mt-1 block w-full rounded-xl border border-subtle bg-surface p-2 text-primary";
                return <label key={key} className="block">
                  {field.label}
                  {field.kind === "select" ? <select className={classes} value={batchValues[key] ?? ""}
                    disabled={submit.isPending} onChange={event => changeValue(event.target.value)}>
                    <option value="">Use file values</option>
                    {field.options.map(option => <option key={option}>{option}</option>)}
                  </select> : <input className={classes} value={batchValues[key] ?? ""} disabled={submit.isPending}
                    onChange={event => changeValue(event.target.value)} />}
                </label>;
              })}
            </details>
          )}
          {!editColumns && mappingConfirmed && hasName && <>
            {newFields.length > 0 && <p className="text-sm">New directory fields · {newFields.map(field => field.label).join(", ")}</p>}
            <p role="status" className="text-sm text-secondary">
              {rows.length} {rows.length === 1 ? "row" : "rows"}
              {!!invalid && ` · ${invalid} need correction`}
              {checkedRows && ` · ${addCount} ready to add · ${checkedRows.length - addCount} will be skipped`}
              {!!missingIds && ` · ${missingIds} without Student ID`}
            </p>
            {(rows.length === 0 || rows.length > 500) && <p role="alert">Include between 1 and 500 member rows.</p>}
            {!!missingIds && <p className="text-sm text-secondary">Rows without a Student ID can be imported and won’t be matched by that ID.</p>}
            {!!visibleIssues.length && <div className="space-y-2">
              <ul className="max-h-32 overflow-auto text-sm text-rose-700 dark:text-rose-300" aria-label="Import errors">
                {visibleIssues.map((issue, index) => <li key={index}>Row {issue.row} · {issue.field}: {issue.message}</li>)}
              </ul>
              <Button variant="outline" size="sm" onClick={() => downloadErrors(visibleIssues)}>Download error report</Button>
            </div>}
            <ul className="rounded-xl border border-subtle bg-elevated p-3 text-sm text-primary" aria-label="Sample members">
              {rows.slice(0, 5).map((row, index) => <li key={index} className="break-words">
                {sourceRow(index + 2)}. {[row.display_name, row.member_code, row.email, row.phone, ...importFields.map(field => row.attributes[field.key])]
                  .filter(value => value !== null && value !== undefined).map(String).join(" · ")}
              </li>)}
            </ul>
            {readyForPreview && (!previewCurrent || preview.isPending) && <p role="status">Checking duplicates…</p>}
            {previewCurrent && preview.isError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
              {formatErrorMessage(preview.error)}{" "}
              <Button variant="ghost" size="sm" onClick={() => preview.mutate({ requestId, rows, newFields })}>Retry check</Button>
            </p>}
            {checkedRows?.some(row => row.status !== "new") && <ul className="max-h-40 overflow-y-auto text-sm">
              {checkedRows.filter(row => row.status !== "new").map(row => <li key={row.row}>Row {sourceRow(row.row)} · {
                row.status === "identifier_conflict" ? "Multiple existing records use this Student ID. Review the directory." :
                row.status === "duplicate_in_file" ? "Duplicate identifier in file" : "Identifier already in the directory"
              }</li>)}
            </ul>}

          </>}
        </> }
      </>}
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {submit.isError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(submit.error)}</p>}
      {submit.isSuccess && <div className="space-y-2">
        <p role="status">{submit.data.inserted} added · {submit.data.skipped} skipped</p>
        <ul className="max-h-40 overflow-y-auto text-sm">{submit.data.rows?.map(row =>
          <li key={row.row}>Row {sourceRow(row.row)} · {row.status === "inserted" ? "Added" : row.status === "identifier_conflict" ? "Skipped conflicting Student ID" : "Skipped duplicate identifier"}</li>)}</ul>
        {!!submit.data.skipped && <Button variant="outline" onClick={() => downloadErrors(
          submit.data.rows.filter(row => row.status !== "inserted").map(row => ({
            row: sourceRow(row.row), field: isStudent ? "Student ID" : "Member identifier",
            message: row.status === "identifier_conflict" ? "Multiple existing records use this Student ID." : "Duplicate identifier skipped.",
          })),
        )}>Download skipped rows</Button>}
      </div>}
      <footer className="sticky -bottom-6 z-10 -mx-6 flex justify-between gap-3 border-t border-subtle bg-surface px-6 py-3">
        <Button variant="outline" disabled={submit.isPending} onClick={!editColumns && checkedRows && !submit.isSuccess
          ? () => setEditColumns(true) : close}>{submit.isSuccess ? "Done" : !editColumns && checkedRows ? "Back" : "Cancel"}</Button>
        {headerMode && !submit.isSuccess && (editColumns ?
          <Button disabled={!hasName || unmatched.length > 0 || invalidFields}
            onClick={() => { setMappingConfirmed(true); setEditColumns(false); }}>Review import</Button> :
          <Button isLoading={submit.isPending} disabled={!readyForPreview || !addCount} onClick={() => submit.mutate()}>
            {addCount ? `Import ${addCount} ${addCount === 1 ? "member" : "members"}` : "Import members"}
          </Button>)}
      </footer>
    </div>
  </Modal>;
}
