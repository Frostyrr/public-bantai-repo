import { recoveryFlow } from "./recoveryFlow";
import { createClient } from "@supabase/supabase-js";
import type { QuestionRequest } from "./securityQuestions";
import {parsePasswordHistoryStatus} from "./passwordHistoryStatus";

// Never share recovery sessions with the persistent app client or Axios.
export function createRecoveryFlow() {
  const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { storageKey: "bantai-recovery", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let authorization:string|undefined;
  const base=import.meta.env.VITE_APP_URL.replace(/\/$/, "");
  const questionRequest: QuestionRequest = async <T,>(path: string, method = "GET", body?: unknown) => {
    const {data}=await client.auth.getSession();
    if (!data.session) throw new Error("Recovery session expired. Request a new code.");
    const response=await fetch(`${import.meta.env.VITE_APP_URL.replace(/\/$/, "")}/auth/recovery-questions${path}`, {
      method, headers:{Authorization:`Bearer ${data.session.access_token}`,"Content-Type":"application/json",...(authorization?{"X-Recovery-Authorization":authorization}:{})},
      body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",
    });
    if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(error?.message??"Could not complete recovery. Try again.");}
    return (response.status===204?undefined:await response.json()) as T;
  };
  return recoveryFlow(client.auth, questionRequest,async(email,token)=>{
    authorization=undefined;
    const status=await fetch(`${base}/auth/password-history/status`,{cache:"no-store"});
    if(!status.ok)throw new Error("Could not check recovery availability. Please try again.");
    const config=parsePasswordHistoryStatus(await status.json());
    if(config.enabled===false)return client.auth.verifyOtp({email,token,type:"recovery"});
    if(config.enabled!==true)throw new Error("Recovery configuration is unavailable.");
    const response=await fetch(`${base}/auth/password-history/verify`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,token}),cache:"no-store"});
    if(!response.ok)throw new Error("Invalid or expired recovery code, or recovery is temporarily unavailable. Request a fresh code.");
    const data=await response.json();
    authorization=data.authorization;
    return client.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
  });
}
