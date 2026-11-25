// Local browser test fixture. Never linked by the production application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ReceiptAiReview from "../src/components/org/expenses/ReceiptAiReview";
import type { ReceiptExtraction, ReceiptSuggestions } from "../src/lib/receiptAi";
import "../src/index.css";

const canvas=document.createElement("canvas");canvas.width=800;canvas.height=800;
const context=canvas.getContext("2d")!;context.fillStyle="white";context.fillRect(0,0,800,800);context.fillStyle="black";context.font="28px monospace";
["BANTAI TEST STORE","SYNTHETIC RECEIPT","Date: 2026-11-19","Receipt: TEST-001","Notebook 2 x 50.00","Subtotal PHP 100.00","Tax PHP 12.00","TOTAL PHP 112.00","Paid Cash"].forEach((line,index)=>context.fillText(line,30,65+index*75));
const bytes=Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]),value=>value.charCodeAt(0));
const file=new File([bytes],"receipt.png",{type:"image/png"});
const state={calls:0,applies:0};Object.assign(window,{receiptTest:state});
const extractor=async (_org:string,_file:File,signal:AbortSignal):Promise<ReceiptExtraction>=>{
  state.calls++;await new Promise(resolve=>setTimeout(resolve,250));signal.throwIfAborted();
  return {id:"aaaaaaaa-1111-4111-8111-111111111111",sourceHash:"a".repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString(),cached:false,
    data:{merchant:"BANTAI TEST STORE",transactionDate:"2026-11-19",receiptNumber:"TEST-001",currency:"PHP",subtotal:"100.00",tax:"12.00",total:"112.00",paymentMethod:"Cash",
      lineItems:[{description:"Notebook",quantity:"2",unitPrice:"50.00",total:"100.00"}]},warnings:["AI suggestions may be incorrect. Review the original receipt before applying fields."]};
};
function Harness(){
  const [current,setCurrent]=useState<ReceiptSuggestions>({title:"Manually entered title",vendorName:"",incurredDate:"2026-11-20",amountCentavos:"99.00"});
  const [visible,setVisible]=useState(true);
  return <main className="mx-auto max-w-5xl space-y-4 p-4 text-primary">
    <h1 className="text-xl font-semibold">Receipt review</h1>
    <div className="flex flex-wrap gap-3"><button onClick={()=>setVisible(false)}>Remove receipt</button>
      <button onClick={()=>setCurrent(value=>({...value,amountCentavos:"77.00"}))}>Edit current amount</button>
      <button onClick={()=>document.documentElement.classList.toggle("dark")}>Toggle theme</button></div>
    {visible&&<ReceiptAiReview org="test" file={file} currency="PHP" current={current} extractor={extractor}
      onApply={(_result,values,fields)=>{state.applies++;setCurrent(existing=>({...existing,...Object.fromEntries(fields.map(field=>[field,values[field]]))}));}}/>}
    <output aria-label="Current expense values">{JSON.stringify(current)}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness/>);
