import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('policy migration and independent, strict, self approval rules', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
  const dir=path.resolve(__dirname,'../../supabase/migrations');
  for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile(path.join(dir,file),'utf8'));
  const ids=['11111111','22222222','33333333','44444444','55555555'].map(x=>`${x}-1111-4111-8111-111111111111`);
  const [owner,admin,treasurer,auditor,member]=ids;
  const org='aaaaaaaa-1111-4111-8111-111111111111';
  const foreign='bbbbbbbb-1111-4111-8111-111111111111';
  for(const id of ids) await db.exec(`insert into auth.users(id) values('${id}')`);
  await db.exec(`insert into organizations(id,name) values('${org}','Policy test'),('${foreign}','Foreign')`);
  for(const [i,role] of ['owner','organization_admin','treasurer','auditor','member'].entries()) await db.exec(`insert into organization_members(organization_id,profile_id,role) values('${org}','${ids[i]}','${role}')`);
  const actor=async(id:string)=>db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'`);
  const submit=async()=>{const r=await db.query<{result:{id:string}}>(`select submit_expense('${org}','Test expense',100,'supplies','2026-11-13') result`);return r.rows[0].result.id;};
  const review=async(id:string,decision:string,notes='reason',revision=1)=>db.exec(`select review_expense('${org}','${id}','${decision}','${notes}',${revision})`);
  const policy=async(mode:string,allow=false)=>{await actor(owner);await db.exec(`select set_expense_approval_policy('${org}','${mode}',${allow})`);};
  const preset = (value: string, version: number) => db.query(
   "select public.set_approval_preset($1,$2,$3)", [org,value,version],
  );
  await actor(admin);await assert.rejects(preset("strict",1),/owner/);
  await actor(owner);await preset("strict",1);
  await assert.rejects(preset("simple",1),/policy changed/);
  await preset("balanced",2);
  await actor(owner);const standard=await submit();
  await assert.rejects(review(standard,'approved'),/Another authorized/);
  await actor(admin);await review(standard,'verified');await review(standard,'approved');
  const adminExpense=await submit();await actor(owner);await review(adminExpense,'verified');await review(adminExpense,'approved');
  await policy('owner_admin_self');const self=await submit();
  await assert.rejects(review(self,'approved',''),/justification/);await review(self,'approved','Small organization');
  await actor(admin);const adminSelf=await submit();await review(adminSelf,'approved','Authorized exception');
  await policy('standard');const denied=await submit();await actor(treasurer);await assert.rejects(review(denied,'verified'),/not authorized/);
  await policy('standard',true);const allowed=await submit();await actor(treasurer);await review(allowed,'verified');await review(allowed,'approved');
  const treasurerOwn=await submit();await assert.rejects(review(treasurerOwn,'approved'),/Another authorized/);
  await actor(auditor);await assert.rejects(submit(),/permission/);await assert.rejects(review(denied,'verified'),/not authorized/);
  await actor(member);await assert.rejects(submit(),/permission/);
  await policy('strict',true);const strict=await submit();await actor(admin);await review(strict,'verified');await review(strict,'approved');
  await actor(owner);
  assert.equal((await db.query<{status:string}>(`select status from expenses where id='${strict}'`)).rows[0].status,'verified');
  await actor(admin);
  await assert.rejects(review(strict,'approved'),/already approved/);
  await actor(owner);await assert.rejects(review(strict,'approved'),/Another authorized/);
  await actor(treasurer);await review(strict,'approved');await assert.rejects(review(strict,'approved'),/terminal/);
  await policy('strict',true);const snapshot=await submit();await policy('owner_admin_self');await assert.rejects(review(snapshot,'approved'),/Another authorized/);
  await actor(admin);await assert.rejects(db.exec(`select set_expense_approval_policy('${org}','standard',false)`),/Only the owner/);
  await assert.rejects(db.exec(`select review_expense('${foreign}','${snapshot}','approved','reason',1)`),/Active workspace access required/);
  await actor(owner);
  const history=await db.query<{self_approval:boolean;policy_snapshot:string}>(`select self_approval,policy_snapshot from approvals where entity_id='${self}'`);
  assert.equal(history.rows[0].self_approval,true);assert.equal(history.rows[0].policy_snapshot,'owner_admin_self');
  await policy('strict',true);const edited=await submit();await actor(admin);await review(edited,'verified');await review(edited,'approved');
  await actor(owner);await db.exec(`select update_expense('${org}','${edited}','Edited expense',100,'supplies','2026-11-13')`);
  const state=(await db.query<{review_revision:number;status:string}>(`select review_revision,status from expenses where id='${edited}'`)).rows[0];
  assert.equal(state.review_revision,2);assert.equal(state.status,'pending');
  await actor(admin);await assert.rejects(review(edited,'approved'),/was revised/);
  await review(edited,'verified','reason',2);await review(edited,'approved','reason',2);
  await actor(owner);
  assert.equal((await db.query<{status:string}>(`select status from expenses where id='${edited}'`)).rows[0].status,'verified');
  assert.equal((await db.query(`select * from approvals where entity_id='${edited}' and decision='approved'`)).rows.length,2);
  await actor(owner);const memberId=(await db.query<{id:string}>(`select id from organization_members where profile_id='${member}' and organization_id='${org}'`)).rows[0].id;
  await db.exec(`select set_member_expense_submission('${org}','${memberId}',true)`);await actor(member);await submit();
  await assert.rejects(db.exec(`update organizations set expense_approval_policy='owner_admin_self' where id='${org}'`),/permission denied/);
  await actor(owner);
  const budget = (await db.query<{ result: {id: string} }>(
   "select public.create_budget($1,'Amendment test',10000) as result", [org],
  )).rows[0].result.id;
  await assert.rejects(db.query("select public.update_budget($1,$2,'Amendment test',12000)", [org,budget]), /Use a budget amendment/);
  const proposal = (await db.query<{ id: string }>(
   "select id from public.manage_budget_amendment($1,$2,10000,12000,'Additional supplies',null,null)", [org,budget],
  )).rows[0].id;
  const approve = () => db.query(
   "select public.manage_budget_amendment($1,$2,null,null,null,$3,'approved')", [org,budget,proposal],
  );
  await assert.rejects(approve(), /different owner or admin/);
  await actor(admin);
  await approve();
  await assert.rejects(approve(), /no longer pending/);
  await assert.rejects(db.query("select public.delete_budget($1,$2)", [org,budget]), /amendments/);
  const cashRequest = (id: string | null, action: string, draft: object) =>
   db.query<{ id: string; status: string; advance_id: string | null }>(
    "select * from public.manage_cash_advance_request($1,$2,$3,$4::jsonb)",
    [org,id,action,JSON.stringify(draft)],
   );
  await actor(member);
  const request = (await cashRequest(null,"create",{title:"Travel advance",purpose:"Transport",amountCentavos:500})).rows[0];
  assert.equal(request.advance_id,null);
  await cashRequest(request.id,"revise",{revision:1,title:"Travel advance",purpose:"Transport",amountCentavos:600});
  await actor(owner);
  await assert.rejects(cashRequest(request.id,"approve",{revision:1}), /request changed/);
  await assert.rejects(cashRequest(request.id,"release",{revision:2,method:"cash"}), /unavailable/);
  await cashRequest(request.id,"approve",{revision:2});
  const released = (await cashRequest(request.id,"release",{revision:3,method:"cash"})).rows[0];
  assert.equal(released.status,"released");
  assert.ok(released.advance_id);
  await assert.rejects(cashRequest(request.id,"release",{revision:3,method:"cash"}), /request changed/);
  await actor(owner);await preset("simple",3);
  const simpleBudget = (await db.query<{result:{id:string;status:string}}>(
   "select public.create_budget($1,'Simple budget',10000) as result",[org],
  )).rows[0].result;
  assert.equal(simpleBudget.status,"active");
  assert.equal((await db.query<{status:string}>(
   "select status from public.manage_budget_amendment($1,$2,10000,11000,'Add supplies',null,null)",[org,simpleBudget.id],
  )).rows[0].status,"approved");
  await preset("strict",4);
  const strictBudget = (await db.query<{result:{id:string;status:string}}>(
   "select public.create_budget($1,'Strict budget',10000) as result",[org],
  )).rows[0].result;
  assert.equal(strictBudget.status,"pending_approval");
  const activate = () => db.query("select public.decide_budget_activation($1,$2,true)",[org,strictBudget.id]);
  await assert.rejects(activate(),/different owner or admin/);
  await preset("balanced",5);
  await actor(admin);await activate();
  await assert.rejects(activate(),/no longer awaiting/);
  await db.exec('reset role');assert.ok((await db.query(`select * from audit_logs where action='expense_policy_changed'`)).rows.length);
 } finally {await db.close();}
});
