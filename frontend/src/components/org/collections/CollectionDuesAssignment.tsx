import { toast } from "../../../lib/toast";
import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import API from "../../../config/apiClient";
import { getDirectoryAssignmentFilters, searchDirectoryForAssignment, type DirectoryAssignmentMember } from "../../../lib/api";
import { directoryDisplayIdentifier, orderDirectoryFields } from "../../../lib/organizationTypes";
import { parseDuesAmount, duesMoney } from "../../../utils/duesAssignment";
import { formatErrorMessage } from "../../../utils/formatError";
import Button from "../../../components/ui/Button";
import Input from "../../../components/ui/Input";
import Select from "../../../components/ui/Select";
import Modal from "../../../components/ui/Modal";

type Scope="all"|"groups"|"selected";
type Preview={currency:string;scope:Scope;eligible:number;alreadyAssigned:number;newAssignments:number;ineligibleSelected:number;amountCentavos:string;totalCentavos:string;limit:number;canConfirm:boolean;token:string;groupNames:string[];members:{id:string;name:string;alreadyAssigned:boolean}[];assigned?:number};
const labels:Record<Scope,string>={all:"All Members",groups:"Specific Groups",selected:"Selected Members"};
function useSettledString(value:string) {
 const [settled,setSettled]=useState(value);
 useEffect(()=>{const timer=window.setTimeout(()=>setSettled(value),200);return()=>window.clearTimeout(timer);},[value]);
 return settled;
}
export default function CollectionDuesAssignment({orgId,collectionId,currency,onClose,initialMember,standardAmount}:{orgId:string;collectionId:string;currency:string;onClose:()=>void;initialMember?:DirectoryAssignmentMember;standardAmount?:number|null}) {
 const client=useQueryClient();
 const [scope,setScope]=useState<Scope>(initialMember?"selected":"all");
 const [groupIds,setGroupIds]=useState<string[]>([]);
 const [groupSearch,setGroupSearch]=useState("");
 const [members,setMembers]=useState<DirectoryAssignmentMember[]>(initialMember?[initialMember]:[]);
 const [search,setSearch]=useState("");
 const q=useSettledString(search.trim());
 const [page,setPage]=useState(0);
 const [group,setGroup]=useState("");
 const [fieldKey,setFieldKey]=useState("");
 const [fieldValue,setFieldValue]=useState("");
 const [amount,setAmount]=useState(standardAmount ? (standardAmount / 100).toFixed(2) : "");
 const [notes,setNotes]=useState("");
 const [review,setReview]=useState<Preview|null>(null);
 const cents=parseDuesAmount(amount);
 const path=`/organizations/${orgId}/collections/${collectionId}/dues-assignment`;
 const filters=useQuery({queryKey:["directory-assignment-filters",orgId],queryFn:({signal})=>getDirectoryAssignmentFilters(orgId,signal)});
 const orgType=useQuery({queryKey:["organization-type",orgId],queryFn:async()=> (await API.get<{organizationType:string|null}>(`/organizations/${orgId}/type`)).data.organizationType});
 const field=filters.data?.fields.find(item=>item.key===fieldKey);
 const params={q,page,group:group||undefined,attributeKey:fieldValue!==""?fieldKey||undefined:undefined,attributeValue:fieldValue!==""?fieldValue:undefined};
 const candidates=useQuery({queryKey:["directory-assignment",orgId,params],queryFn:({signal})=>searchDirectoryForAssignment(orgId,params,signal),enabled:scope==="selected"&&!review});
 const payload={scope,groupIds:scope==="groups"?groupIds:[],memberIds:scope==="selected"?members.map(member=>member.id):[],amountCentavos:cents??0,notes:notes.trim()||undefined};
 const payloadKey=JSON.stringify(payload);
 const settledPayloadKey=useSettledString(payloadKey);
 const settling=payloadKey!==settledPayloadKey;
 const scopeReady=scope==="all"||(scope==="groups"?groupIds.length>0:members.length>0);
 const preview=useQuery({queryKey:["dues-assignment-preview",orgId,collectionId,payload],queryFn:async({signal})=>(await API.post<Preview>(path+"/preview",payload,{signal})).data,enabled:scopeReady&&!review&&!settling});
 const summary=review??(!settling?preview.data:undefined);
 const resetReview=()=>{setReview(null);};
 const confirm=useMutation({mutationFn:async()=> (await API.post<Preview>(path+"/confirm",{...payload,token:review!.token})).data,
  onSuccess:async()=>{
   toast.success("Dues assigned");
   await Promise.all([["financial-summary",orgId],["financial-insights",orgId],["directory-obligations"],["user-obligations"],["collections",orgId],["collection",orgId,collectionId],["obligations",orgId,collectionId],["dues-assignment-preview",orgId,collectionId]].map(queryKey=>client.invalidateQueries({queryKey})));
   onClose();
  },onError:error=>{
   if(isAxiosError<{preview?:Preview}>(error)&&error.response?.status===409){
    if(error.response.data.preview) setReview(error.response.data.preview); else {setReview(null);void preview.refetch();}
   }
  }});
 const selectMatching=useMutation({mutationFn:async()=>{
  const selected=new Map(members.map(member=>[member.id,member]));
  let next=0;
  while(true){
   const result=await searchDirectoryForAssignment(orgId,{...params,page:next},new AbortController().signal);
   // Refuse oversized selections before loading additional pages; never silently truncate.
   if(result.total>500) throw new Error("More than 500 members match. Narrow the filters before selecting all matching members.");
   result.members.forEach(member=>selected.set(member.id,member));
   if(selected.size>500) throw new Error("This would exceed 500 selected members. Narrow filters or clear the selection first.");
   if((next+1)*25>=result.total) break;
   next++;
  }
  return [...selected.values()];
 },onSuccess:result=>{setMembers(result);resetReview();}});
 const busy=confirm.isPending||selectMatching.isPending;
 const identifier=(member:DirectoryAssignmentMember)=>directoryDisplayIdentifier(orgType.data,filters.data?.fields??[],member);
 const rosterLayout=scope==="selected"&&!review;
 const filteredGroups=filters.data?.groups.filter(item=>item.name.toLowerCase().includes(groupSearch.toLowerCase()))??[];
 const selectedGroups=filters.data?.groups.filter(item=>groupIds.includes(item.id))??[];
 const totalResults=candidates.data?.total??0;
 const selectedIds=new Set(members.map(member=>member.id));
 const hasSearch=Boolean(search.trim()||group||fieldValue);
 const moneyReady=cents!==null;
 const summaryBusy=!review&&scopeReady&&(settling||preview.isFetching);
 const guidance=busy?"Please wait for the current operation to finish.":!scopeReady?(scope==="groups"?"Choose at least one group.":"Select at least one member.")
  :amount.trim()===""?"Enter an assessment amount per member.":!moneyReady?"Enter a nonnegative amount with up to two decimal places, within the supported range."
  :summaryBusy?"Updating the server assessment preview…":!review&&preview.isError?"Retry the assessment preview before continuing."
  :!summary?"Waiting for the assessment preview.":!summary.eligible?"No active, eligible members in this scope."
  :!summary.newAssignments?"All eligible members in this scope are already assessed.":summary.newAssignments>summary.limit?`Choose a smaller scope: at most ${summary.limit} new assignments can be made at once.`:"";
 const memberMetadata=(member:DirectoryAssignmentMember)=>{
  const primary=identifier(member);
  const values=[primary?.value,...orderDirectoryFields(filters.data?.fields??[],orgType.data)
   .filter(item=>item.label!==primary?.label&&item.kind!=="checkbox")
   .map(item=>member.attributes[item.key])];
  return [...new Set(values.filter(value=>value!==null&&value!==undefined).map(value=>String(value).trim())
   .filter(value=>value!==""&&!["null","undefined","—","-"].includes(value.toLowerCase())))].slice(0,3).join(" · ");
 };
 const controlClass="py-2.5! placeholder:text-muted! placeholder:opacity-100!";
 const assessmentSummary=<section aria-label="Assessment summary" aria-busy={summaryBusy} className="rounded-2xl border border-subtle bg-elevated p-4">
  <h3 className="text-sm font-semibold text-primary">{review?"Review assignment":"Assessment summary"}</h3>
  {summaryBusy?<p role="status" className="mt-3 text-sm text-secondary">Updating eligible members and assessment…</p>
   :!review&&preview.isError?<p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(preview.error)} <Button variant="ghost" size="sm" onClick={()=>void preview.refetch()}>Retry preview</Button></p>
   :summary?<>
    <dl className="mt-3 space-y-2 text-sm">
     <div className="flex justify-between gap-4"><dt className="text-secondary">Scope</dt><dd className="text-right text-primary">{labels[summary.scope]}</dd></div>
     {summary.groupNames.length>0&&<div className="flex justify-between gap-4"><dt className="text-secondary">Groups</dt><dd className="min-w-0 break-words text-right text-primary">{summary.groupNames.join(", ")}</dd></div>}
     {[["Eligible members",summary.eligible],["Already assessed",summary.alreadyAssigned],["New assignments",summary.newAssignments]].map(([label,value])=><div key={label} className="flex justify-between gap-4"><dt className="text-secondary">{label}</dt><dd className="font-medium tabular-nums text-primary">{value}</dd></div>)}
     <div className="flex justify-between gap-4 pt-1"><dt className="text-secondary">Amount per member</dt><dd className="text-right tabular-nums text-primary">{moneyReady?duesMoney(summary.currency,summary.amountCentavos):"Not entered"}</dd></div>
    </dl>
    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-subtle pt-3"><span className="text-sm font-medium text-primary">Total new assessment</span><strong className="select-text text-lg font-semibold tabular-nums text-primary">{moneyReady?duesMoney(summary.currency,summary.totalCentavos):"—"}</strong></div>
    {summary.ineligibleSelected>0&&<p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{summary.ineligibleSelected} selected members are no longer active and are excluded.</p>}
    {summary.newAssignments>summary.limit&&<p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-400">This exceeds {summary.limit} new assignments. Narrow the scope; no members will be omitted silently.</p>}
    {!summary.eligible&&<p className="mt-3 text-sm text-secondary">No eligible directory members in this scope. <Link className="text-primary underline" to={`/app/org/${orgId}/directory`}>Manage Member Directory</Link></p>}
    {summary.eligible>0&&!summary.newAssignments&&<p className="mt-3 text-sm text-secondary">All eligible members are already assessed. Existing obligations will stay unchanged.</p>}
   </>:<p className="mt-3 text-sm text-secondary">{scope==="groups"?"Choose groups to preview their unique eligible members.":"Select members to preview the assessment."}</p>}
 </section>;
 return <Modal isOpen labelledBy="dues-assignment-title" onClose={()=>{if(!busy)onClose();}}
  maxWidth={rosterLayout?"max-w-[1040px]":"max-w-[680px]"} className="flex max-h-[90dvh]! flex-col overflow-hidden! p-0!">
  <header className="shrink-0 border-b border-subtle px-5 py-4 sm:px-6"><h2 id="dues-assignment-title" className="font-semibold text-primary section-title">{initialMember ? "Assign Member Dues" : "Assign Unassessed Members"}</h2><p className="mt-1 text-sm text-secondary">Assign dues to active, unassessed members for this collection. Existing assessments remain unchanged.</p></header>
  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
   <fieldset disabled={busy} className="min-w-0">
    {!review&&<fieldset className="mb-4"><legend className="mb-2 text-sm font-medium text-primary">Assignment scope</legend><div className="grid gap-2 min-[420px]:grid-cols-3">{(Object.keys(labels) as Scope[]).map(value=><label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-emerald-400/60 ${scope===value?"border-emerald-500/50 bg-emerald-500/5 text-primary":"border-subtle text-secondary hover:border-strong"}`}><input className="size-4 shrink-0 appearance-auto! accent-emerald-500" type="radio" name="assignment-scope" checked={scope===value} onChange={()=>{setScope(value);resetReview();confirm.reset();}}/>{labels[value]}</label>)}</div></fieldset>}
    <div className={rosterLayout?"grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)]":"space-y-4"}>
     {!review&&<div className="min-w-0">
      {scope==="all"&&<p className="text-sm leading-relaxed text-secondary">Include active directory members eligible under this collection’s saved scope. Already assessed members are excluded. This is a one-time assessment; future members will not be charged automatically.</p>}
      {scope==="groups"&&<section className="space-y-3" aria-label="Choose directory groups">
       <Input label="Groups" icon={<Search size={16}/>} placeholder="Search or select groups..." className={controlClass} value={groupSearch} onChange={event=>setGroupSearch(event.target.value)}/>
       {filters.isPending&&<div role="status" aria-label="Loading groups" className="space-y-1.5 animate-pulse motion-reduce:animate-none">{[0,1,2].map(i=><div key={i} className="h-11 rounded-xl border border-subtle bg-skeleton"/>)}</div>}
       {filters.isError&&<p role="alert" className="text-sm text-rose-700 dark:text-rose-300">Could not load groups. <Button variant="ghost" size="sm" onClick={()=>void filters.refetch()}>Try again</Button></p>}
       {filters.isSuccess&&!filters.data.groups.length&&<p className="rounded-xl border border-subtle p-3 text-sm text-secondary">No directory groups yet. <Link className="text-primary underline" to={`/app/org/${orgId}/directory`}>Manage members and groups</Link></p>}
       {filters.isSuccess&&filters.data.groups.length>0&&!filteredGroups.length&&<p className="text-sm text-secondary">No groups match this search.</p>}
       {!!filteredGroups.length&&<div className="max-h-52 space-y-1 overflow-y-auto">{filteredGroups.map(item=><label key={item.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-emerald-400/60 ${groupIds.includes(item.id)?"border-emerald-500/40 bg-emerald-500/5 text-primary":"border-subtle text-primary hover:bg-elevated"}`}><input type="checkbox" className="size-4 shrink-0 appearance-auto! accent-emerald-500" checked={groupIds.includes(item.id)} disabled={!groupIds.includes(item.id)&&groupIds.length>=100} onChange={event=>{setGroupIds(event.target.checked?[...groupIds,item.id]:groupIds.filter(id=>id!==item.id));resetReview();}}/><span className="min-w-0 break-words">{item.name}</span></label>)}</div>}
       {selectedGroups.length>0&&<p className="break-words text-xs text-secondary">Selected: {selectedGroups.map(item=>item.name).join(", ")}</p>}
       <p className="text-xs text-secondary">Members in overlapping groups are counted once.{groupIds.length>=100&&" The 100-group selection limit has been reached."}</p>
      </section>}
      {scope==="selected"&&<section className="min-w-0 space-y-3" aria-label="Select directory members">
       <Input label="Directory members" icon={<Search size={16}/>} placeholder="Search by name or member ID..." className={controlClass} value={search} maxLength={100} onChange={event=>{setSearch(event.target.value);setPage(0);}}/>
       {filters.isError&&<p role="alert" className="text-sm text-rose-700 dark:text-rose-300">Directory filters are unavailable. <Button variant="ghost" size="sm" onClick={()=>void filters.refetch()}>Retry</Button></p>}
       <div className={`grid gap-2 sm:grid-cols-2 ${field?"xl:grid-cols-3":""}`}>
        <Select label="Group" buttonClassName="min-h-11 py-2!" value={group} options={[{value:"",label:"All groups"},...(filters.data?.groups??[]).map(item=>({value:item.id,label:item.name}))]} onChange={event=>{setGroup(event.target.value);setPage(0);}}/>
        <Select label="Custom field" buttonClassName="min-h-11 py-2!" value={fieldKey} options={[{value:"",label:"Choose a field..."},...(filters.data?.fields??[]).map(item=>({value:item.key,label:item.label}))]} onChange={event=>{setFieldKey(event.target.value);setFieldValue("");setPage(0);}}/>
        {field&&(field.kind==="select"||field.kind==="checkbox"?<Select label={field.label+" value"} buttonClassName="min-h-11 py-2!" value={fieldValue} options={[{value:"",label:"Select a value..."},...(field.kind==="checkbox"?["true","false"]:field.options).map(value=>({value,label:field.kind==="checkbox"?(value==="true"?"Yes":"No"):value}))]} onChange={event=>{setFieldValue(event.target.value);setPage(0);}}/>:<Input label={field.label+" value"} placeholder="Select or enter a value..." className={controlClass} type={field.kind} value={fieldValue} maxLength={500} onChange={event=>{setFieldValue(event.target.value);setPage(0);}}/>)}
       </div>
       {field&&fieldValue===""&&<p className="text-xs text-secondary">Choose or enter a value to apply the {field.label.toLowerCase()} filter.</p>}
       <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-subtle py-1">
        <Button variant="ghost" size="sm" className="min-h-11 px-0! text-xs" disabled={candidates.isPending||candidates.isError||candidates.isFetching||q!==search.trim()||!totalResults} onClick={()=>{selectMatching.reset();selectMatching.mutate();}}>Select all matching</Button>
        <Button variant="ghost" size="sm" className="min-h-11 px-0! text-xs" disabled={!members.length} onClick={()=>{setMembers([]);selectMatching.reset();resetReview();}}>Clear selection</Button>
        <span role="status" className="ml-auto text-sm font-medium tabular-nums text-primary">{members.length} selected</span>
       </div>
       {members.length>=500&&<p className="text-xs text-amber-700 dark:text-amber-400">Selection limit reached. Remove a member to select another.</p>}
       {selectMatching.isError&&<p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(selectMatching.error)}</p>}
       <div className="max-h-[min(40dvh,22rem)] space-y-1.5 overflow-y-auto p-0.5" aria-label="Member results" aria-busy={candidates.isFetching||q!==search.trim()}>
        {candidates.isPending&&<div role="status" aria-label="Loading directory members" className="space-y-1.5 animate-pulse motion-reduce:animate-none">{[0,1,2].map(i=><div key={i} className="h-14 rounded-xl border border-subtle bg-skeleton"/>)}</div>}
        {candidates.isError&&<p role="alert" className="py-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(candidates.error)} <Button variant="ghost" size="sm" onClick={()=>void candidates.refetch()}>Try again</Button></p>}
        {candidates.isSuccess&&!candidates.data.members.length&&<div className="rounded-xl border border-subtle p-4 text-sm"><p className="text-primary">{hasSearch?"No matching members":"No active directory members"}</p><p className="mt-1 text-secondary">{hasSearch?"Try another search or adjust the filters. Your existing selections are preserved.":<>Add or import members in <Link className="text-primary underline" to={`/app/org/${orgId}/directory`}>Member Directory</Link> to assess dues.</>}</p></div>}
        {candidates.data?.members.map(member=>{
         const checked=selectedIds.has(member.id);const metadata=memberMetadata(member);
         return <label key={member.id} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-emerald-400/60 ${checked?"border-emerald-500/40 bg-emerald-500/5":"border-subtle bg-elevated/60 hover:bg-elevated"}`}>
          <input className="mt-0.5 size-4 shrink-0 appearance-auto! accent-emerald-500" type="checkbox" checked={checked} disabled={members.length>=500&&!checked} onChange={event=>{setMembers(event.target.checked?[...members,member]:members.filter(item=>item.id!==member.id));resetReview();}}/>
          <span className="min-w-0"><span className="block break-words font-medium text-primary">{member.display_name}</span>{metadata&&<span className="mt-0.5 block break-words text-xs leading-relaxed text-secondary">{metadata}</span>}</span>
         </label>;
        })}
       </div>
       {candidates.isSuccess&&totalResults>0&&<nav aria-label="Member result pages" className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
        <span>Showing {page*25+1}–{Math.min(page*25+candidates.data.members.length,totalResults)} of {totalResults}</span>
        <div className="flex items-center gap-1"><Button variant="ghost" size="sm" className="min-h-11 px-2!" icon={<ChevronLeft size={14}/>} disabled={!page||candidates.isFetching} onClick={()=>setPage(page-1)}>Previous</Button><span className="whitespace-nowrap px-1">Page {page+1} of {Math.max(1,Math.ceil(totalResults/25))}</span><Button variant="ghost" size="sm" className="min-h-11 px-2!" iconRight={<ChevronRight size={14}/>} disabled={(page+1)*25>=totalResults||candidates.isFetching} onClick={()=>setPage(page+1)}>Next</Button></div>
       </nav>}
      </section>}
     </div>}
     <div className="min-w-0 space-y-4">
      {!review&&<>
       <Input label={`Assessed amount per member (${currency})`} inputMode="decimal" placeholder="e.g. 150.00" className={controlClass} value={amount} aria-invalid={amount!==""&&!moneyReady} aria-describedby="dues-amount-help" onChange={event=>{setAmount(event.target.value);resetReview();}}/>
       <p id="dues-amount-help" className="-mt-2 text-xs text-secondary">{amount!==""&&!moneyReady?"Use up to two decimal places. Negative or unsupported amounts are not accepted.":cents===0?"A zero amount creates a zero-dues assessment under the existing rules.":"The entered amount applies to each newly assessed member."}</p>
       <Input label="Notes (optional)" placeholder="Add an optional note for this assessment..." className={controlClass} maxLength={500} value={notes} onChange={event=>{setNotes(event.target.value);resetReview();}}/>
      </>}
      {assessmentSummary}
      {review&&summary?.scope==="all"&&<p className="text-sm text-secondary">One-time assessment of currently eligible members. Future members will not be charged automatically.</p>}
      {review&&notes&&<p className="break-words text-sm text-secondary">Notes: {notes}</p>}
      {review&&summary?.scope==="selected"&&<details className="rounded-xl border border-subtle px-3 text-sm"><summary className="min-h-11 cursor-pointer py-3 text-primary focus-visible:outline-2 focus-visible:outline-emerald-400">Inspect selection ({members.length})</summary><ul className="max-h-52 space-y-2 overflow-y-auto pb-3 text-secondary">{members.map(member=><li key={member.id} className="break-words">{member.display_name}{summary.members.find(item=>item.id===member.id)?.alreadyAssigned?" · Already assessed":!summary.members.some(item=>item.id===member.id)?" · No longer eligible":""}</li>)}</ul></details>}
     </div>
    </div>
   </fieldset>
   {confirm.isError&&<p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(confirm.error)}</p>}
  </div>
  <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-subtle px-5 py-3 sm:px-6">
   {guidance&&<p id="dues-assignment-guidance" role="status" className="min-w-0 flex-1 basis-full text-xs text-secondary sm:basis-48">{guidance}</p>}
   <div className="ml-auto flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>{review&&<Button variant="outline" disabled={busy} onClick={()=>{resetReview();confirm.reset();}}>Edit selection</Button>}<Button isLoading={busy} aria-describedby={guidance?"dues-assignment-guidance":undefined} disabled={Boolean(guidance)||!summary?.canConfirm} onClick={()=>{if(review)confirm.mutate();else if(preview.data){confirm.reset();setReview(preview.data);}}}>{review?"Confirm assignment":"Review assignment"}</Button></div>
  </footer>
 </Modal>;
}
