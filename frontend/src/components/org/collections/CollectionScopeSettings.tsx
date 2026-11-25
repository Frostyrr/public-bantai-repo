import { useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API from "../../../config/apiClient";
import { formatErrorMessage } from "../../../utils/formatError";
import type { CollectionMemberScope, DirectoryAssignmentMember } from "../../../lib/api";
import { defaultCollectionScope, validCollectionScope } from "../../../lib/collectionScope";
import CollectionScopePicker from "./CollectionScopePicker";
import Modal from "../../../components/ui/Modal";
import Button from "../../../components/ui/Button";

type Saved = {scope:CollectionMemberScope["scope"]|"legacy";status:string;groupIds:string[];members:DirectoryAssignmentMember[]};
type Preview = {token:string;eligible:number;added:number;removed:number;retainedAssessed:number};

function ScopeForm({orgId,collectionId,saved,onClose}:{orgId:string;collectionId:string;saved:Saved;onClose:()=>void}) {
  const client=useQueryClient();
  const [draft,setDraft]=useState<CollectionMemberScope>(saved.scope==="legacy"?defaultCollectionScope:{
    scope:saved.scope,groupIds:saved.groupIds,memberIds:saved.members.map(member=>member.id),
  });
  const [preview,setPreview]=useState<Preview|null>(null);
  const mutation=useMutation({
    mutationFn:async(confirm:boolean)=>(await API.post<Preview>(`/organizations/${orgId}/collections/${collectionId}/member-scope`,{
      ...draft,token:confirm?preview?.token:undefined,
    })).data,
    onSuccess:async(result,confirm)=>{
      if(!confirm){setPreview(result);return;}
      await Promise.all([["collection-member-scope",orgId,collectionId],["obligations",orgId,collectionId],["dues-assignment-preview",orgId,collectionId]]
        .map(queryKey=>client.invalidateQueries({queryKey})));
      onClose();
    },
    onError:error=>{
      if(isAxiosError<{preview?:Preview}>(error)&&error.response?.data.preview)setPreview(error.response.data.preview);
    },
  });
  const frozen=saved.status!=="active";
  return <Modal isOpen labelledBy="collection-scope-title" maxWidth="max-w-[640px]" onClose={()=>{if(!mutation.isPending)onClose();}}>
    <h2 id="collection-scope-title" className="font-semibold text-primary section-title">Collection member scope</h2>
    <p className="mt-2 text-sm text-secondary">Saved scope: {({legacy:"Unconfigured",all:"All Members",groups:"Specific Groups",selected:"Selected Members"})[saved.scope]}.</p>
    <div className="my-4">
      {frozen?<p className="text-sm text-secondary">Reopen this collection to change its saved scope.</p>:preview?
        <div className="space-y-2 rounded-xl border border-subtle bg-elevated p-4 text-sm text-primary">
          <p>{preview.eligible} eligible members in the proposed scope.</p>
          <p>{preview.added} enter the scope. {preview.removed} unassessed members leave the roster.</p>
          <p>{preview.retainedAssessed} obligations outside the proposed scope remain visible.</p>
          <p className="text-secondary">Existing obligations and payments are preserved.</p>
        </div>:<CollectionScopePicker orgId={orgId} value={draft} initialMembers={saved.members} onChange={setDraft}/>}
      {mutation.isError&&<p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(mutation.error)}</p>}
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>{frozen?"Close":"Cancel"}</Button>
      {preview&&<Button variant="outline" disabled={mutation.isPending} onClick={()=>{setPreview(null);mutation.reset();}}>Back</Button>}
      {!frozen&&<Button disabled={!validCollectionScope(draft)} isLoading={mutation.isPending} onClick={()=>mutation.mutate(Boolean(preview))}>{preview?"Save scope":"Review changes"}</Button>}
    </div>
  </Modal>;
}

export default function CollectionScopeSettings({orgId,collectionId,onClose}:{orgId:string;collectionId:string;onClose:()=>void}) {
  const query=useQuery({queryKey:["collection-member-scope",orgId,collectionId],queryFn:async({signal})=>
    (await API.get<Saved>(`/organizations/${orgId}/collections/${collectionId}/member-scope`,{signal})).data});
  if(query.data)return <ScopeForm orgId={orgId} collectionId={collectionId} saved={query.data} onClose={onClose}/>;
  return <Modal isOpen onClose={onClose} labelledBy="collection-scope-loading"><h2 id="collection-scope-loading">Collection member scope</h2>
    {query.isError?<p role="alert">{formatErrorMessage(query.error)} <Button variant="ghost" onClick={()=>void query.refetch()}>Retry</Button></p>:<p role="status">Loading saved scope…</p>}
  </Modal>;
}
