import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import API from "../../config/apiClient";
import Input from "../ui/Input";
import Button from "../ui/Button";
import { formatErrorMessage } from "../../utils/formatError";
export default function GlobalUsername({username,userId}:{username:string;userId:string}) {
 const [draft,setDraft]=useState(username);
 const [saved,setSaved]=useState(false);
 const [error,setError]=useState("");
 const client=useQueryClient();
 const save=useMutation({mutationFn:()=>API.put("/user/username",{username:draft.trim()},{signal:undefined,...{expectedUserId:userId}}),onSuccess:async()=>{await client.invalidateQueries();setSaved(true);}});
 return <div className="space-y-2">
  <Input label="Global username" placeholder="Choose a username" value={draft} minLength={6} maxLength={20} pattern="[A-Za-z][A-Za-z0-9]{5,19}" onChange={event=>{setDraft(event.target.value);setSaved(false);setError("");}} disabled={save.isPending}/>
  <p className="text-xs text-secondary">Your unique public username. Use 6–20 letters or digits, starting with a letter.</p>
  <Button type="button" variant="outline" size="sm" isLoading={save.isPending} disabled={draft.trim().toLowerCase()===username.toLowerCase()} onClick={()=>{if(!/^[A-Za-z][A-Za-z0-9]{5,19}$/.test(draft.trim())){setError("Use 6–20 letters or digits, starting with a letter.");return;}save.mutate();}}>Save username</Button>
  {(error||save.isError)&&<p role="alert" className="text-xs text-sem-error-fg">{error||formatErrorMessage(save.error)}</p>}
  {saved&&<p role="status" className="text-xs text-secondary">Username saved.</p>}
 </div>;
}
