import assert from "node:assert/strict";
import { test } from "node:test";
import { receiptSuggestions, defaultReceiptFields, changedReceiptFields, receiptTransferFields } from "../src/lib/receiptSuggestions";

const data = {merchant:"Test merchant",transactionDate:"2026-11-19",receiptNumber:"T-1",currency:"PHP",subtotal:"100.00",tax:"12.00",
  total:"112.00",paymentMethod:"Cash",lineItems:[]};
const blank={title:"",vendorName:"",incurredDate:"",amountCentavos:""};
test("receipt review selects only blank fields and requires explicit replacement of defaults",()=>{
  const values=receiptSuggestions(data);
  assert.deepEqual(defaultReceiptFields(values,blank,"PHP","PHP"),["title","vendorName","incurredDate","amountCentavos"]);
  assert.deepEqual(defaultReceiptFields(values,{...blank,title:"My title",incurredDate:"2026-11-20",amountCentavos:"250"},"PHP","PHP"),["vendorName"]);
  assert.deepEqual(defaultReceiptFields(values,blank,"USD","PHP"),["title","vendorName","incurredDate"]);
  assert.deepEqual(defaultReceiptFields(values,blank,null,"PHP"),["title","vendorName","incurredDate"]);
});
test("receipt review catches fields changed while suggestions were pending or under review",()=>{
  assert.deepEqual(changedReceiptFields(["title","amountCentavos"],blank,{...blank,amountCentavos:"99.00"}),["amountCentavos"]);
  assert.deepEqual(changedReceiptFields(["title"],{...blank,title:"User typed"},{...blank,title:"User typed"}),[]);
  assert.deepEqual(receiptSuggestions({...data,merchant:null,total:null,transactionDate:null}),blank);
});
test("analyzed receipt handoff preserves filled draft values while retaining identical reviewed values",()=>{
  const values=receiptSuggestions(data);
  assert.deepEqual(receiptTransferFields(["title","vendorName","incurredDate","amountCentavos"],values,
    {...blank,title:"Existing draft",amountCentavos:"99.00",incurredDate:values.incurredDate}),["vendorName","incurredDate"]);
  assert.deepEqual(receiptTransferFields(["title","amountCentavos"],values),["title","amountCentavos"]);
});
