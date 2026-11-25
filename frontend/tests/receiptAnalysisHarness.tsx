// Test-only fixture: mock session, mocked HTTP, and synthetic receipt pixels.
import React, {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {BrowserRouter} from "react-router-dom";
import ReceiptAnalysisModal,{type ReceiptTransfer} from "../src/components/org/expenses/ReceiptAnalysisModal";
import BaniPanel from "../src/components/ai/AskBantaiPanel";
import {BaniConversation} from "../src/components/ai/BaniConversation";
import {supabase} from "../src/config/supabase";
import "../src/index.css";

const userId="11111111-1111-4111-8111-111111111111",org="aaaaaaaa-1111-4111-8111-111111111111";
supabase.auth.getSession=(async()=>({data:{session:{access_token:"test-only",user:{id:userId}}},error:null})) as typeof supabase.auth.getSession;
const canvas=document.createElement("canvas");canvas.width=800;canvas.height=800;
const context=canvas.getContext("2d")!;context.fillStyle="white";context.fillRect(0,0,800,800);context.fillStyle="black";context.font="28px monospace";
["BANTAI TEST STORE","SYNTHETIC RECEIPT","Date: 2026-11-19","Receipt: TEST-001","Notebook 2 x 50.00","Subtotal PHP 100.00","Tax PHP 12.00","TOTAL PHP 112.00"].forEach((line,index)=>context.fillText(line,30,65+index*80));
Object.assign(window,{analysisSyntheticData:canvas.toDataURL("image/png").split(",")[1]});
function Harness(){
  const [conversation]=useState(()=>new BaniConversation(userId,org,"owner"));
  const [transfer,setTransfer]=useState<ReceiptTransfer|null>(null);
  const [open,setOpen]=useState(true);
  useEffect(()=>()=>conversation.dispose(),[conversation]);
  if(new URLSearchParams(location.search).get("mode")==="bani")return <BaniPanel organizationName="Test workspace" conversation={conversation} isOpen onClose={()=>{}}/>;
  return <main className="min-h-screen bg-canvas p-5 text-primary">
    {open&&<ReceiptAnalysisModal org={org} userId={userId} role="owner" currency="PHP" onClose={()=>setOpen(false)} onUse={value=>{setTransfer(value);setOpen(false);}}/>}
    {transfer&&<output aria-label="Transferred receipt">{JSON.stringify({name:transfer.file.name,extractionId:transfer.result.id,fields:transfer.fields,values:transfer.values})}</output>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BrowserRouter><Harness/></BrowserRouter></QueryClientProvider>);
