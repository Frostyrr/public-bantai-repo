import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { receiptDatabaseSql, receiptOrg as org, receiptOwner as owner, receiptMember as member, receiptOther as other } from "./fixtures/receiptDatabase";
import { syntheticReceipt } from "./fixtures/syntheticReceipt";

test("reimbursement approval recognizes spending, settlement changes reserve once, and correction restores the payable", async () => {
  const db = new PGlite();
  try {
    await db.exec(await receiptDatabaseSql());
    const signIn = (id: string) => db.exec(`set role authenticated;set request.jwt.claim.sub='${id}'`);
    const summary = async () => (await db.query<{value: Record<string,number>}>(
      "select public.workspace_financial_summary($1) value",[org],
    )).rows[0].value;
    const draft = { title:"Member supplies",description:"Supplies for the workshop",amountCentavos:1200,category:"supplies",incurredDate:"2026-01-01" };
    const files = [{ name:"receipt.png",mime:"image/png",data:(await syntheticReceipt()).toString("base64") }];
    const request = "ffffffff-1111-4111-8111-111111111111";
    await signIn(member);
    const submit = () => db.query<{value:{id:string}}>("select public.submit_reimbursement($1,$2,$3,$4) value",[org,request,draft,files]);
    const id = (await submit()).rows[0].value.id;
    assert.equal((await submit()).rows[0].value.id,id);
    assert.equal((await summary()).reserve_balance_centavos,0);
    const review = (decision:string) => db.query("select public.review_expense($1,$2,$3,null,1)",[org,id,decision]);
    await assert.rejects(review("verified"));
    await signIn(other);
    await assert.rejects(db.query("select public.list_reimbursements($1)",[org]),/Active workspace/);
    await signIn(owner);
    await review("verified");
    await review("approved");
    const approved = await summary();
    assert.equal(approved.total_expenses_centavos,1200);
    assert.equal(approved.outstanding_reimbursements_centavos,1200);
    assert.equal(approved.reserve_balance_centavos,0);
    const payment = "eeeeeeee-1111-4111-8111-111111111111";
    const pay = (paymentId=payment, reason:string|null=null) => db.query(
      "select public.settle_reimbursement($1,$2,$3,'2026-01-02','cash',null,$4)",[org,id,paymentId,reason],
    );
    await signIn(member);
    await assert.rejects(pay(),/treasury access/);
    await signIn(owner);
    await pay();
    await pay();
    await assert.rejects(pay(request),/already paid/);
    const paid = await summary();
    assert.equal(paid.reserve_balance_centavos,-1200);
    assert.equal(paid.outstanding_reimbursements_centavos,0);
    assert.equal(paid.total_expenses_centavos,1200);
    await pay(payment,"Incorrect payment record");
    assert.equal((await summary()).reserve_balance_centavos,0);
    assert.equal((await summary()).outstanding_reimbursements_centavos,1200);
    await pay(request);
    assert.equal((await summary()).reserve_balance_centavos,-1200);

    await db.exec(`reset role;update public.organizations set expense_approval_policy='owner_admin_self' where id='${org}'`);
    await signIn(owner);
    const ownClaim = (await db.query<{value:{id:string}}>(
      "select public.submit_reimbursement($1,$2,$3,$4) value",[org,request,draft,files],
    )).rows[0].value.id;
    await assert.rejects(db.query("select public.review_expense($1,$2,'approved','Self approval attempt',1)",[org,ownClaim]),/Another authorized officer/);
    assert.equal((await summary()).total_expenses_centavos,1200);

    // SEC-02: suspended or closed workspaces must block reimbursement settlement/void mutations
    await db.exec(`reset role;update public.organizations set suspended_at=now() where id='${org}'`);
    await signIn(owner);
    await assert.rejects(pay(request,"Attempt void while suspended"),/Active workspace/);
    await db.exec(`reset role;update public.organizations set suspended_at=null where id='${org}'`);

    // SEC-01: cross-organization outsider cannot enumerate usernames via account_identity_labels or resolve_account_identity
    await db.exec(`reset role;insert into bantai_private.account_usernames(user_id,username) values('${owner}','orgowner1') on conflict(user_id) do update set username='orgowner1'`);
    await signIn(other);
    const outsiderLabels = (await db.query<{id:string}>("select * from public.account_identity_labels($1)",[[owner]])).rows;
    assert.equal(outsiderLabels.length,0);
    const outsiderResolved = (await db.query<{name:string}>("select public.resolve_account_identity($1,null) name",[owner])).rows[0].name;
    assert.equal(outsiderResolved,"Member");
    await signIn(member);
    const coMemberLabels = (await db.query<{username:string}>("select * from public.account_identity_labels($1)",[[owner]])).rows;
    assert.equal(coMemberLabels.length,1);
    assert.equal(coMemberLabels[0].username,"orgowner1");
  } finally {
    await db.close();
  }
});
