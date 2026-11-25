import { formatCategoryLabel } from "../../../utils/formatCategoryLabel";
import ReceiptPreview from "./ReceiptPreview";
import API from "../../../config/apiClient";
import { useMutation } from "@tanstack/react-query";
import { useQuery } from '@tanstack/react-query';
import { getOrganizationMembers, type Expense } from '../../../lib/api';
const receiptImageTypes = ["image/jpeg", "image/png", "image/webp"];
export default function ExpenseReviewInfo({ expense, actorId, inApprovalQueue = false }: {
 expense: Expense;
 actorId?: string;
 inApprovalQueue?: boolean;
}) {
 const roster = useQuery({queryKey:['organization-members', expense.organization_id],queryFn:()=>getOrganizationMembers(expense.organization_id)});
 const path = `/organizations/${expense.organization_id}/expenses/${expense.id}/evidence`;
 const evidence = useQuery({
  queryKey: ["expense-evidence", expense.organization_id, expense.id],
  queryFn: async ({signal}) => (await API.get<{files:{id:string;name:string;mime:string}[]}>(path,{signal})).data.files,
 });
 const download = useMutation({mutationFn: async (file:{id:string;name:string}) => {
  const response = await API.get<Blob>(path,{params:{attachment:file.id},responseType:"blob"});
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }});
 const preview = useMutation({
  mutationFn: async (id: string) => {
   const { data } = await API.get<Blob>(path, { params: { attachment: id }, responseType: "blob" });
   if (!receiptImageTypes.includes(data.type)) throw new Error("Image preview unavailable.");
   return { id, blob: data };
  },
 });
 const actorRole = roster.data?.find(m=>m.profile_id===actorId)?.role;
 const policy = expense.approval_policy_snapshot || 'legacy';
 const decisions = expense.approval_decisions || [];
 const current = decisions.filter(d => d.decision === 'approved' && d.expense_revision === expense.review_revision);
 const eligible = (roster.data || []).filter(m => m.profile_id !== expense.submitted_by && (['owner','organization_admin'].includes(m.role) || m.role === 'treasurer' && (expense.treasurer_approval_snapshot ?? true) || m.role === 'auditor' && policy === 'legacy'));
 return <div className="text-xs text-secondary space-y-2 mt-2">
  <dl className="grid gap-2 rounded-xl border border-subtle bg-elevated/60 p-3 sm:grid-cols-2">
   {!inApprovalQueue && <>
    <div><dt>Incurred</dt><dd className="text-primary">{expense.incurred_date}</dd></div>
    <div><dt>Category</dt><dd className="capitalize text-primary">{formatCategoryLabel(expense.category)}</dd></div>
   </>}
   <div><dt>Vendor / payee</dt><dd className="break-words text-primary">{expense.vendor_name || "—"}</dd></div>
   <div><dt>Authorized budget</dt><dd className="text-primary">{expense.budgets ? expense.budgets.name + (expense.budgets.archived_at ? " (Archived)" : "") : expense.budget_id ? "Assigned budget unavailable" : "Unallocated"}</dd></div>
   {!inApprovalQueue && <>
    <div><dt>Submitted by</dt><dd className="break-words text-primary">{expense.profiles?.display_name || roster.data?.find(m=>m.profile_id===expense.submitted_by)?.profiles?.display_name || "—"}</dd></div>
    <div><dt>Submitted</dt><dd className="text-primary">{new Date(expense.created_at).toLocaleString()}</dd></div>
   </>}
   {expense.description && <div className="sm:col-span-2"><dt>Notes</dt><dd className="break-words text-primary">{expense.description}</dd></div>}
   {expense.receipt_url && <div className="sm:col-span-2"><dt>Receipt reference</dt><dd className="break-all text-primary">{/^https?:\/\//i.test(expense.receipt_url)
    ? <a className="text-primary underline" href={expense.receipt_url} target="_blank" rel="noopener noreferrer">Open receipt</a> : expense.receipt_url}</dd></div>}
  </dl>
  {evidence.data?.map(file => <div key={file.id}>
   <div className="flex flex-wrap items-center gap-x-4">
    <button type="button" disabled={download.isPending}
     className="min-h-11 cursor-pointer break-all text-left text-emerald-700 dark:text-emerald-400 underline"
     onClick={() => download.mutate(file)}>Download {file.name}</button>
    {receiptImageTypes.includes(file.mime) && <button type="button" disabled={preview.isPending}
     aria-expanded={preview.data?.id === file.id}
     className="min-h-11 cursor-pointer text-primary underline"
     onClick={() => preview.data?.id === file.id ? preview.reset() : preview.mutate(file.id)}>
     {preview.data?.id === file.id ? "Hide preview" : "Preview image"}
    </button>}
   </div>
   {preview.data?.id === file.id && <ReceiptPreview file={preview.data.blob} name={file.name} />}
  </div>)}
  {(evidence.isError || download.isError || preview.isError) && <p role="status">Supporting files are unavailable.</p>}
  <h3 className="pt-3 text-sm font-semibold text-primary">Approval activity</h3>
  <p>{inApprovalQueue ? `Revision ${expense.review_revision ?? 1}` : expense.status === "approved" && current.length < (expense.required_approvals || 1)
    ? policy === "legacy" ? "Approved under the earlier workflow. Approval progress was not fully recorded for this revision." : "Marked approved. The recorded decisions for this revision do not meet the required count."
    : `${current.length} of ${expense.required_approvals || 1} approvals recorded for revision ${expense.review_revision ?? 1}.`}</p>
  {expense.submitted_by === actorId && policy === 'owner_admin_self' && ['owner','organization_admin'].includes(actorRole || '') && <p>Self-approval is available. Enter a justification before confirming; the decision will be marked and audited.</p>}
  {!inApprovalQueue && actorRole === 'treasurer' && expense.treasurer_approval_snapshot === false && <p>Treasurer approval is disabled for this expense's policy.</p>}
  {actorRole === 'auditor' && policy !== 'legacy' && <p>Auditors have read access but cannot approve this expense.</p>}
  {expense.submitted_by === actorId && policy !== 'owner_admin_self' && <p>This expense retains its submission-time policy and requires independent review. Changing organization settings only affects new expenses.</p>}
  {roster.data && eligible.length < (expense.required_approvals || 1) && !(policy === 'owner_admin_self') && ['pending','verified'].includes(expense.status) && <p className="text-amber-700 dark:text-amber-400">There are not enough eligible reviewers for this expense. Invite another authorized officer to complete its review.</p>}
  <ol className="ml-2 space-y-4 border-l border-subtle pl-4 py-2">
   <li>
    <p className="font-medium text-primary">Expense submitted</p>
    <p>{expense.profiles?.display_name || roster.data?.find(m => m.profile_id === expense.submitted_by)?.profiles?.display_name || "Submitter unavailable"}</p>
    <time dateTime={expense.created_at}>{new Date(expense.created_at).toLocaleString()}</time>
   </li>
   {[...decisions].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map((decision, index) => (
    <li key={index}>
     <p className="font-medium text-primary capitalize">{decision.self_approval ? "Expense self-approved" : `Expense ${decision.decision}`}</p>
     <p>{roster.data?.find(member => member.profile_id === decision.officer_id)?.profiles?.display_name || "Reviewer unavailable"}</p>
     <time dateTime={decision.created_at}>{new Date(decision.created_at).toLocaleString()}</time>
     <p>{decision.expense_revision == null ? "Revision unavailable" : `Revision ${decision.expense_revision}`}</p>
     {decision.notes && <p className="whitespace-pre-wrap break-words text-secondary">{decision.notes}</p>}
    </li>
   ))}
  </ol>
 </div>;
}
