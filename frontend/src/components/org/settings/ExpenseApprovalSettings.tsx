import Badge from "../../ui/Badge";
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExpensePolicy, saveExpensePolicy, getOrganizationMembers, setMemberExpenseSubmission } from '../../../lib/api';
import Select from '../../ui/Select';
import Modal from '../../ui/Modal';

export default function ExpenseApprovalSettings({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
 const client = useQueryClient();
 const query = useQuery({ queryKey: ['expense-policy', orgId], queryFn: () => getExpensePolicy(orgId) });
 const members = useQuery({queryKey:['organization-members',orgId],queryFn:()=>getOrganizationMembers(orgId),enabled:isOwner});
 const grant = useMutation({mutationFn:({id,allowed}:{id:string;allowed:boolean})=>setMemberExpenseSubmission(orgId,id,allowed),onSuccess:()=>{ void client.invalidateQueries({queryKey:['organization-members',orgId]}); void client.invalidateQueries({queryKey:['organizations']}); }});
 const [draft, setDraft] = useState<{ policy: string; treasurer: boolean } | null>(null);
 const mutation = useMutation({ mutationFn: () => saveExpensePolicy(orgId, draft!.policy, draft!.treasurer), onSuccess: () => { void client.invalidateQueries({ queryKey: ['expense-policy', orgId] }); setDraft(null); setConfirming(false); } });
 const [confirming, setConfirming] = useState(false);
 const policyNames = { standard: 'Standard approval', owner_admin_self: 'Owner/Admin self-approval', strict: 'Strict approval' };
 const explanations = { standard: 'An independent officer verifies and approves each expense.', owner_admin_self: 'Owners and Admins may self-approve with a recorded justification. Other approvals remain independent.', strict: 'Two distinct authorized officers must approve. The submitter cannot count toward either approval.' };
 const memberList = members.data?.filter(m => ['member', 'student'].includes(m.role)) || [];
 return (
  <section aria-labelledby="expense-policy-heading" className="rounded-xl bg-surface border border-subtle shadow-xs dark:shadow-none p-6 min-w-0">
   <div className="flex flex-wrap items-start justify-between gap-3 border-b border-subtle pb-4 mb-6">
    <div><h2 id="expense-policy-heading" className="font-heading text-base font-medium text-primary tracking-tight">Expense Approval</h2><p className="mt-1 text-xs sm:text-sm text-secondary">Set the review rules for your organization's expenses.</p></div>
    <Badge >{isOwner ? 'Owner controls' : 'View only'}</Badge>
   </div>
   {query.isError ? <p role="alert" className="text-sm text-red-600 dark:text-red-300">Could not load approval settings. <button className="underline cursor-pointer" onClick={() => void query.refetch()}>Retry</button></p> : query.data ? (
    <div className="space-y-6">
     <div className="space-y-4 min-w-0">
      <Select label="Approval policy" disabled={!isOwner || mutation.isPending} value={draft?.policy ?? query.data.expense_approval_policy} onValueChange={policy => setDraft({policy, treasurer: draft?.treasurer ?? query.data.treasurer_expense_approval})} options={Object.entries(policyNames).map(([value,label])=>({value,label}))} />
      <p className="text-sm leading-relaxed text-secondary">{explanations[query.data.expense_approval_policy]}</p>
      {query.data.expense_approval_policy === 'owner_admin_self' && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">Self-approvals are marked in the expense history and require a justification.</p>}
      <p className="text-xs leading-relaxed text-muted">Changes apply to future submissions. Existing expenses keep their original policy. Only the owner can change these rules.</p>
     </div>
     <div className="min-w-0 space-y-5 ">
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-subtle bg-elevated p-4">
       <div><h3 className="text-sm font-medium text-primary">Treasurer approvals</h3><p className="text-xs text-secondary mt-1 leading-relaxed">Allow Treasurers to approve other members' expenses under the selected policy.</p></div>
       <button type="button" role="switch" aria-label="Allow Treasurer to Approve Expenses" aria-checked={draft?.treasurer ?? query.data.treasurer_expense_approval} disabled={!isOwner || mutation.isPending} onClick={()=>setDraft({policy:draft?.policy ?? query.data.expense_approval_policy,treasurer:!(draft?.treasurer ?? query.data.treasurer_expense_approval)})} className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-border-strong disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${(draft?.treasurer ?? query.data.treasurer_expense_approval) ? 'bg-action border-action' : 'bg-surface border-strong'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full transition-transform motion-reduce:transition-none ${(draft?.treasurer ?? query.data.treasurer_expense_approval) ? 'translate-x-5 bg-action-fg' : 'translate-x-0.5 bg-secondary'}`} /></button>
      </div>
      {isOwner && <div className="space-y-3"><div><h3 className="text-sm font-medium text-primary">Member expense submission</h3><p className="text-xs text-secondary mt-1 leading-relaxed">Choose who can submit expenses. Auditors cannot submit.</p></div>
       {members.isPending ? (
         <div role="status" aria-label="Loading members" className="space-y-2 animate-pulse motion-reduce:animate-none">
           {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl border border-subtle bg-skeleton" />)}
         </div>
       ) : members.isError ? <p role="alert" className="text-xs text-red-600 dark:text-red-300">Member permissions unavailable. <button className="underline cursor-pointer" onClick={()=>void members.refetch()}>Retry</button></p> : memberList.length === 0 ? <p className="rounded-xl border border-dashed border-subtle p-4 text-xs text-muted">No members or students to configure yet.</p> : <div className="max-h-64 overflow-y-auto space-y-2">{memberList.map(m=><div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-elevated px-4 py-3"><div className="min-w-0"><p className="text-sm text-primary break-words">{m.profiles?.display_name || 'Member'}</p><p className="text-[11px] text-muted capitalize">{m.role}</p></div><button type="button" role="switch" aria-label={`Allow expense submissions for ${m.profiles?.display_name || m.profile_id}`} aria-checked={!!m.can_submit_expenses} disabled={grant.isPending} onClick={()=>{if(window.confirm('Change expense submission permission for this member?')) grant.mutate({id:m.id,allowed:!m.can_submit_expenses});}} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong ${m.can_submit_expenses ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-subtle text-secondary hover:text-primary'}`}>{m.can_submit_expenses ? 'Allowed' : 'Not allowed'}</button></div>)}</div>}
       {grant.isError && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{grant.error.message}</p>}
      </div>}
     </div>
    </div>
   ) : (
    <div role="status" aria-label="Loading approval settings" className="space-y-4 animate-pulse motion-reduce:animate-none">
      <div className="h-11 rounded-xl border border-subtle bg-skeleton" />
      <div className="h-16 rounded-2xl border border-subtle bg-skeleton" />
    </div>
   )}
   {isOwner && <footer className="-mx-6 mt-6 border-t border-subtle px-6 pt-3.5 flex justify-end">
     <button type="button" disabled={!draft || mutation.isPending || (draft.policy === query.data?.expense_approval_policy && draft.treasurer === query.data?.treasurer_expense_approval)}
       onClick={() => setConfirming(true)} className="rounded-full bg-action px-4 py-2 text-sm text-action-fg font-medium cursor-pointer disabled:opacity-50">Save Changes</button>
   </footer>}
   <Modal isOpen={confirming && !!draft} onClose={() => { if (!mutation.isPending) setConfirming(false); }} maxWidth="lg">
    <div className="space-y-5"><div><h3 className="font-heading text-xl font-medium text-primary tracking-tight">Change approval rules?</h3><p className="mt-2 text-sm text-secondary">This change applies to new expenses only.</p></div>
     {draft?.policy === 'owner_admin_self' && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300 leading-relaxed">Owners and Admins will be able to approve their own submissions. A justification and audit record are required.</p>}
     <dl className="rounded-xl border border-subtle p-4 text-sm space-y-3"><div className="flex justify-between gap-4"><dt className="text-secondary">Policy</dt><dd className="text-right text-primary">{draft && policyNames[draft.policy as keyof typeof policyNames]}</dd></div><div className="flex justify-between gap-4"><dt className="text-secondary">Treasurer approval</dt><dd className="text-primary">{draft?.treasurer ? 'Enabled' : 'Disabled'}</dd></div></dl>
     {mutation.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{mutation.error.message}</p>}
     <div className="flex flex-wrap justify-end gap-3 border-t border-subtle pt-5"><button type="button" disabled={mutation.isPending} onClick={()=>setDraft(null)} className="rounded-full border border-subtle px-4 py-2 text-sm text-secondary hover:text-primary cursor-pointer disabled:opacity-50">Cancel</button><button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-full bg-action text-action-fg px-5 py-2 text-sm font-medium cursor-pointer hover:opacity-90 disabled:opacity-50">{mutation.isPending ? 'Saving...' : 'Confirm change'}</button></div>
    </div>
   </Modal>
  </section>
 );
}
