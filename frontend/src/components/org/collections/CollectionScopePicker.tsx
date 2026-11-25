import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDirectoryAssignmentFilters, searchDirectoryForAssignment, type CollectionMemberScope, type DirectoryAssignmentMember } from "../../../lib/api";
import API from "../../../config/apiClient";
import Input from "../../../components/ui/Input";
import Select from "../../../components/ui/Select";
import Button from "../../../components/ui/Button";

export default function CollectionScopePicker({orgId,value,onChange,initialMembers=[],error,id}:{
  error?: string; id?: string; orgId:string;value:CollectionMemberScope;onChange:(value:CollectionMemberScope)=>void;initialMembers?:DirectoryAssignmentMember[];
}) {
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(0);
  const [knownMembers,setKnownMembers]=useState(initialMembers);
  const groups=useQuery({queryKey:["directory-assignment-filters",orgId],queryFn:({signal})=>getDirectoryAssignmentFilters(orgId,signal),enabled:value.scope==="groups"});
  const params={q:search.trim(),page};
  const members=useQuery({queryKey:["directory-assignment",orgId,params],queryFn:({signal})=>searchDirectoryForAssignment(orgId,params,signal),enabled:value.scope==="selected"});
  const groupCount=useQuery({
    queryKey:["collection-group-eligible-count",orgId,value.groupIds],
    enabled:value.scope==="groups"&&value.groupIds.length>0,
    queryFn:async({signal})=>(await API.post<{count:number}>(`/organizations/${orgId}/collections/group-eligible-count`,{groupIds:value.groupIds},{signal})).data.count,
  });
  const loading=value.scope==="groups"?groups.isPending:members.isPending;
  const failed=value.scope==="groups"?groups.isError:members.isError;
  const ids=value.scope==="groups"?value.groupIds:value.memberIds;
  const options=value.scope==="groups"?(groups.data?.groups??[]).filter(group=>group.name.toLowerCase().includes(search.trim().toLowerCase())).map(group=>({id:group.id,name:group.name}))
    :(members.data?.members??[]).map(member=>({id:member.id,name:[member.display_name,member.member_code].filter(Boolean).join(" · ")}));
  const toggle=(id:string)=>{
    const next=ids.includes(id)?ids.filter(item=>item!==id):[...ids,id];
    if(value.scope==="selected") {
      const member=members.data?.members.find(item=>item.id===id);
      if(member&&!knownMembers.some(item=>item.id===id))setKnownMembers([...knownMembers,member]);
    }
    onChange(value.scope==="groups"?{...value,groupIds:next}:{...value,memberIds:next});
  };
  return <section className="space-y-3">
    <Select label="Member scope" required error={error} id={id} value={value.scope} options={[
      {value:"all",label:"All Members"},{value:"groups",label:"Specific Groups"},{value:"selected",label:"Selected Members"},
    ]} onChange={event=>{setSearch("");setPage(0);onChange({scope:event.target.value as CollectionMemberScope["scope"],groupIds:[],memberIds:[]});}}/>
    <p className="text-xs text-secondary">Scope controls who appears in the roster. Dues are assigned separately.</p>
    {value.scope!=="all"&&<>
      <Input label={value.scope==="groups"?"Find groups":"Find directory members"} maxLength={100} value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}}/>
      {loading&&<p role="status">Loading options…</p>}
      {failed&&<p role="alert">Could not load options. <Button variant="ghost" onClick={()=>void (value.scope==="groups"?groups.refetch():members.refetch())}>Retry</Button></p>}
      {!loading&&!failed&&!options.length&&<p className="text-sm text-secondary">No matches.</p>}
      <div className="max-h-48 space-y-1 overflow-y-auto">{options.map(option=><label key={option.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-subtle bg-elevated/60 hover:bg-elevated px-3 py-2 text-sm text-primary">
        <input type="checkbox" className="size-4 shrink-0 appearance-auto! accent-emerald-500" checked={ids.includes(option.id)}
          disabled={!ids.includes(option.id)&&ids.length>=(value.scope==="groups"?100:500)} onChange={()=>toggle(option.id)}/>
        <span className="min-w-0 break-words">{option.name}</span>
      </label>)}</div>
      {value.scope==="selected"&&<div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!page} onClick={()=>setPage(page-1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={(page+1)*25>=(members.data?.total??0)} onClick={()=>setPage(page+1)}>Next</Button>
      </div>}
      {value.scope==="groups"&&ids.length>0&&<p role="status" className="text-sm text-secondary">{groupCount.isError?"Eligible member count unavailable.":groupCount.data===undefined?"Counting eligible members…":`${groupCount.data} unique eligible members`}</p>}
      {ids.length>0&&<details className="text-sm"><summary className="cursor-pointer">{ids.length} selected</summary>
        <ul className="max-h-40 overflow-y-auto">{ids.map(id=><li key={id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 break-words">{groups.data?.groups.find(item=>item.id===id)?.name??knownMembers.find(item=>item.id===id)?.display_name??"Selected record"}</span>
          <Button variant="ghost" size="sm" onClick={()=>toggle(id)}>Remove</Button>
        </li>)}</ul>
      </details>}
    </>}
  </section>;
}
