import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("Bani receipt preparation makes no API calls; send, retry and new-chat preserve the correct receipt scope",async()=>{
  const server=await createServer({root:fileURLToPath(new URL("..",import.meta.url)),configFile:false,
    server:{middlewareMode:true,watch:null,ws:false},plugins:[{
      name:"mock-receipt-chat",enforce:"pre",resolveId(id){if(id==="../../lib/api")return "\0receipt-chat";if(id==="../../lib/imageAi")return "\0image-test";},
      load(id){if(id==="\0image-test")return 'export const analyzeBaniImage=(...args)=>globalThis.__imageAnalyze(...args);';if(id!=="\0receipt-chat")return;return `
        export const createAIConversation = async()=>({id:"chat"});
        export const getAIConversation = async()=>({messages:[]});
        export const streamAIChat = (...args)=>globalThis.__receiptChat(...args);`;
      },
    }]});
  const originalRaf=globalThis.requestAnimationFrame,originalCancel=globalThis.cancelAnimationFrame;
  Object.assign(globalThis,{requestAnimationFrame:()=>1,cancelAnimationFrame:()=>undefined});
  type StreamCallbacks = { onError: (msg: string) => void; onDelta: (chunk: string) => void; onDone: () => void };
  const calls: unknown[][] = [];
  let fail = true;
  Object.assign(globalThis, {
    __receiptChat: async (...args: unknown[]) => {
      calls.push(args);
      const cbs = args[3] as StreamCallbacks;
      if (fail) cbs.onError("Try again");
      else {
        cbs.onDelta("Two notebooks.");
        cbs.onDone();
      }
    },
  });
  let conversation: InstanceType<typeof import("../src/components/ai/BaniConversation").BaniConversation> | undefined;
  try{
    const module=await server.ssrLoadModule("/src/components/ai/BaniConversation.ts");
    conversation=new module.BaniConversation("user","org","owner");
    const receipt={extractionId:"aaaaaaaa-1111-4111-8111-111111111111",name:"receipt.png"};
    conversation.prepareReceipt(true);conversation.setPrompt("Find the notebook");
    await conversation.send();assert.equal(calls.length,0);
    conversation.attachReceipt(receipt);assert.equal(calls.length,0);
    await conversation.send();assert.deepEqual(calls[0][8],receipt);assert.equal(conversation.getSnapshot().pendingReceipt,null);
    fail=false;
    conversation.retry();await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(calls[1][8],receipt);
    await conversation.send("How many were there?");assert.equal(calls[2][8],undefined,"Follow-ups use the server conversation link without retransmitting an image");
    conversation.applyDraft({text:"Explain the insight",insightId:"negative_reserve:aaaaaaaa-1111-4111-8111-111111111111",autoSend:false});
    conversation.attachReceipt(null);await conversation.send();
    assert.equal(calls.at(-1)?.[5],"negative_reserve:aaaaaaaa-1111-4111-8111-111111111111");assert.equal(calls.at(-1)?.[8],undefined);
    conversation.prepareReceipt(true);
    conversation.applyDraft({text:"Explain this insight now",insightId:"negative_reserve:aaaaaaaa-1111-4111-8111-111111111111",autoSend:true});
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(conversation.getSnapshot().receiptPreparing,false);assert.equal(calls.at(-1)?.[8],undefined);
    conversation.attachReceipt(receipt);const oldScope=conversation.getSnapshot().receiptScope;
    conversation.newChat();assert.equal(conversation.getSnapshot().pendingReceipt,null);assert(conversation.getSnapshot().receiptScope>oldScope);
    let visionCalls=0;
    Object.assign(globalThis,{__imageAnalyze:async()=>{visionCalls++;return {id:receipt.extractionId};}});
    const image=new File(["synthetic pixels"],"whiteboard.png",{type:"image/png"});
    conversation.attachImage(image);assert.equal(visionCalls,0);assert.equal(conversation.getSnapshot().pendingImage,image);
    fail=true;await conversation.send();assert.equal(visionCalls,1);assert.equal(calls.at(-1)?.[2],"Describe this image.");
    assert.deepEqual(calls.at(-1)?.[9],{analysisId:receipt.extractionId,name:image.name});assert.equal(calls.at(-1)?.[8],undefined);
    assert.equal(conversation.getSnapshot().pendingImage,null);
    fail=false;conversation.retry();await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(visionCalls,1,"A chat retry reuses the completed analysis");assert.equal((calls.at(-1)?.[9] as {analysisId:string}).analysisId,receipt.extractionId);
    await conversation.send("What time is the meeting?");assert.equal(visionCalls,1);assert.equal(calls.at(-1)?.[9],undefined);
    conversation.attachImage(image);conversation.newChat();assert.equal(conversation.getSnapshot().pendingImage,null);
    conversation.attachImage(image);conversation.applyDraft({text:"Explain an insight",insightId:"negative_reserve:aaaaaaaa-1111-4111-8111-111111111111",autoSend:false});
    assert.equal(conversation.getSnapshot().pendingImage,null);
    conversation.newChat();let finishVision:((value:{id:string})=>void)|undefined;
    Object.assign(globalThis,{__imageAnalyze:()=>new Promise(resolve=>{finishVision=resolve;})});
    conversation.attachImage(image);const interrupted=conversation.send("Read this image");
    const chatCallsBefore=calls.length;conversation.stop();finishVision!({id:receipt.extractionId});await interrupted;
    assert.equal(calls.length,chatCallsBefore,"Stopping vision does not send an image to chat afterwards");
    conversation.newChat();conversation.attachImage(image);conversation.dispose();assert.equal(conversation.getSnapshot().pendingImage,null);
  }finally{
    conversation?.dispose();await server.close();
    Object.assign(globalThis,{requestAnimationFrame:originalRaf,cancelAnimationFrame:originalCancel});
    Reflect.deleteProperty(globalThis,"__receiptChat");
    Reflect.deleteProperty(globalThis,"__imageAnalyze");
  }
});
