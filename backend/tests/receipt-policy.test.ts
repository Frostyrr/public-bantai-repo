import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { receiptDatabaseSql, receiptOrg as org, receiptForeignOrg as foreign, receiptOwner as owner, receiptMember as member, receiptOther as other } from "./fixtures/receiptDatabase";
import { expectedReceipt, syntheticReceipt } from "./fixtures/syntheticReceipt";

test("receipt claims, SQL isolation, matching evidence, retention and original workflow", async () => {
  const db = new PGlite();
  try {
    await db.exec(await receiptDatabaseSql());
    const file = await syntheticReceipt();
    const hash = createHash("sha256").update(file).digest("hex");
    const claim = async (actor=owner, workspace=org, source=hash) => (await db.query<{result:any}>(
      "select public.claim_receipt_ai($1,$2,$3,'qwen/qwen3.8-27b','expenses-v1') result",[workspace,actor,source])).rows[0].result;
    const finish = (id:string,result:unknown=expectedReceipt) => db.query(
      "select public.finish_receipt_ai($1,$2,'[]'::jsonb,100,50,150,1000,1)",[id,result]);
    await db.exec("set role service_role");
    await assert.rejects(claim(other),/access required/);
    const first=await claim();assert.equal(first.state,"claimed");
    assert.equal((await claim()).state,"busy");
    await finish(first.id);
    assert.equal((await claim()).state,"cached");
    const memberClaim=await claim(member);assert.equal(memberClaim.state,"claimed");
    assert.notEqual(memberClaim.id,first.id);await finish(memberClaim.id);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}'`);
    await assert.rejects(db.query("select * from public.receipt_ai_extractions"),/permission denied/);
    await assert.rejects(db.query("select * from public.receipt_ai_events"),/permission denied/);
    await assert.rejects(claim(),/permission denied/);
    await assert.rejects(finish(first.id),/permission denied/);
    await assert.rejects(db.query("select public.expire_receipt_ai()"),/permission denied/);
    await db.exec(`set request.jwt.claims='{"role":"authenticated"}'`);
    await assert.rejects(db.query("select public.receipt_ai_access($1)",[org]),/session/i);
    await db.exec(`set request.jwt.claims='{}'`);
    const files=[{name:"receipt.png",mime:"image/png",data:file.toString("base64")}];
    const draft={title:"AI reviewed notebook purchase",amountCentavos:11200,category:"supplies",incurredDate:"2026-11-19",vendorName:"BANTAI TEST STORE"};
    const request="cccccccc-1111-4111-8111-111111111111";
    const links=[{extractionId:first.id,appliedFields:["vendorName","amountCentavos"]}];
    const submit=(workspace=org,attachments=files,provenance=links)=>db.query<{result:any}>(
      "select public.submit_expense_with_ai_evidence($1,$2,$3,$4,$5) result",[workspace,request,draft,attachments,provenance]);
    await assert.rejects(submit(foreign),/access required/);
    const changed=await syntheticReceipt();changed[changed.length-1]^=1;
    await assert.rejects(submit(org,[{...files[0],data:changed.toString("base64")}]),/do not match/);
    await assert.rejects(submit(org,files,[{extractionId:memberClaim.id,appliedFields:["vendorName"]}]),/do not match/);
    const expense=(await submit()).rows[0].result;
    assert.equal(expense.status,"pending");
    assert.equal((await submit()).rows[0].result.id,expense.id);
    await assert.rejects(submit(org,files,[{extractionId:first.id,appliedFields:["incurredDate"]}]),/already used/);
    await db.exec("reset role");
    const events=(await db.query<{expense_id:string;evidence_id:string}>("select expense_id,evidence_id from public.receipt_ai_events where event='applied'")).rows;
    assert.equal(events.length,1);assert.equal(events[0].expense_id,expense.id);assert(events[0].evidence_id);
    assert.equal((await db.query("select id from public.audit_logs where entity_id=$1",[expense.id])).rows.length>0,true);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${member}'`);
    await assert.rejects(submit(),/do not match/);
    await db.exec(`reset role; update public.receipt_ai_extractions set expires_at=now()-interval '1 second' where id='${memberClaim.id}';set role service_role`);
    await db.query("select public.expire_receipt_ai()");
    await db.exec("reset role");
    const expired=(await db.query<{status:string;result_data:unknown}>("select status,result_data from public.receipt_ai_extractions where id=$1",[memberClaim.id])).rows[0];
    assert.equal(expired.status,"expired");assert.equal(expired.result_data,null);
    assert.equal((await db.query("select * from public.expense_evidence where expense_id=$1",[expense.id])).rows.length,1);
    await db.exec(`update public.receipt_ai_extractions set expires_at=now()-interval '1 second' where id='${first.id}';set role service_role`);
    await db.query("select public.expire_receipt_ai()");
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}'`);
    assert.equal((await submit()).rows[0].result.id,expense.id);
    await assert.rejects(db.query("select public.submit_expense_with_ai_evidence($1,$2,$3,$4,$5)",
      [org,"dddddddd-1111-4111-8111-111111111111",draft,files,links]),/expired/);
    await db.exec(`reset role; update public.organization_members set role='auditor' where organization_id='${org}' and profile_id='${owner}';set role service_role`);
    await assert.rejects(claim(),/access required/);
    await db.exec(`reset role; update public.organization_members set role='owner' where organization_id='${org}' and profile_id='${owner}'`);
    await db.exec(`update public.organizations set suspended_at=now() where id='${org}';set role service_role`);
    await assert.rejects(claim(),/access required/);
  } finally { await db.close(); }
});
