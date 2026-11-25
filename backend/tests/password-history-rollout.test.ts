import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {parsePasswordHistoryStatus} from "../../frontend/src/lib/passwordHistoryStatus";

test("v2 clients refuse partial backends and preserve frozen recovery routing",()=>{
  for(const value of [{enabled:false},{protocol:1,enabled:false},null,{protocol:2,backendVersion:"password-history-v2",mode:"frozen",enabled:false,frozen:true,acceptingChanges:false}])
    assert.throws(()=>parsePasswordHistoryStatus(value));
  assert.equal(parsePasswordHistoryStatus({protocol:2,backendVersion:"password-history-v2",mode:"legacy",enabled:false,frozen:false,acceptingChanges:true}).enabled,false);
  assert.equal(parsePasswordHistoryStatus({protocol:2,backendVersion:"password-history-v2",mode:"frozen",enabled:true,frozen:true,acceptingChanges:false}).enabled,true);
});

test("upgrading an existing pending v1 operation starts frozen and fences its old marker",async()=>{
  const db=new PGlite(),user=randomUUID(),session=randomUUID(),authorizationId=randomUUID(),operationId=randomUUID(),marker=randomUUID();
  const call=async(action:string,data:object={})=>(await db.query<{r:any}>("select bantai_password_history($1,$2,'aal1',$3,$4::jsonb) r",[user,session,action,JSON.stringify(data)])).rows[0].r;
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema bantai_private;
      create table auth.users(id uuid primary key,encrypted_password text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create table auth.sessions(id uuid primary key,user_id uuid);create table auth.mfa_factors(user_id uuid,status text,factor_type text);
      create table auth.mfa_amr_claims(session_id uuid,authentication_method text);
      create function bantai_private.session_decision(uuid,uuid) returns text language sql as $$select 'active'::text$$;
      create table notification_delivery_queue(recipient_user_id uuid,channel text,notification_type text,title text,message text,metadata jsonb);
      insert into auth.users(id,encrypted_password) values('${user}','original');insert into auth.sessions values('${session}','${user}');`);
    for(const name of ["202611180002_recovery_security_questions.sql","202611180004_managed_password_history.sql"])
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),"utf8"));
    await call("issue_reset",{id:authorizationId,digest:"proof"});
    await call("stage",{authorizationId,authorizationDigest:"proof",version:0,epoch:0,operationId,operationDigest:createHash("md5").update(marker).digest("hex"),candidate:"candidate",questionTicket:randomUUID()});
    const upgrade=await readFile(new URL("../../supabase/migrations/202611180005_password_history_rollout_control.sql",import.meta.url),"utf8");
    await db.exec("create role incompatible_migrator;grant usage on schema public,bantai_private to incompatible_migrator;set role incompatible_migrator");
    await assert.rejects(db.exec(upgrade),/same owner/);await db.exec("rollback;reset role");
    await db.exec(upgrade);
    assert.equal((await db.query<{r:any}>("select bantai_password_history_rollout() r")).rows[0].r.mode,"frozen");
    await assert.rejects(db.query("update auth.users set encrypted_password='late-upgrade',raw_user_meta_data=jsonb_build_object('bantai_password_operation',$1::text) where id=$2",[marker,user]));
    const fresh=randomUUID();await call("issue_reset",{id:fresh,digest:"fresh"});
    assert.equal((await call("reconcile",{authorizationId:fresh,authorizationDigest:"fresh"})).status,"cancelled");
    await db.exec("select bantai_private.set_password_history_mode('legacy','verified upgrade drain')");
    assert.equal((await call("status")).version,0);
  }finally{await db.close();}
});

test("database freeze fences pending and legacy writers independently of application flags",async t=>{
  const db=new PGlite(),user=randomUUID(),session=randomUUID();
  const md5=(value:string)=>createHash("md5").update(value).digest("hex");
  const call=async(action:string,data:object={})=>(await db.query<{result:any}>("select bantai_password_history($1,$2,'aal1',$3,$4::jsonb) result",[user,session,action,JSON.stringify(data)])).rows[0].result;
  const mode=async(value:string)=>db.query("select bantai_private.set_password_history_mode($1,'isolated rollout test')",[value]);
  const proof=async()=>{const authorizationId=randomUUID();await call("issue_reset",{id:authorizationId,digest:"proof"});return{authorizationId,authorizationDigest:"proof"};};
  const stage=async()=>{
    const p=await proof(),s=await call("status"),operationId=randomUUID(),marker=randomUUID();
    if(s.stale)await call("reconcile",p);
    await call("stage",{...p,version:s.version,epoch:s.epoch,operationId,operationDigest:md5(marker),candidate:"fixture-verifier",questionTicket:randomUUID()});
    return{...p,operationId,marker};
  };
  const write=async(marker:string)=>db.query("update auth.users set encrypted_password=$1,raw_user_meta_data=jsonb_build_object('bantai_password_operation',$2::text) where id=$3",[randomUUID(),marker,user]);
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create role supabase_auth_admin;
      create schema auth;create schema bantai_private;
      create table auth.users(id uuid primary key,encrypted_password text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create table auth.sessions(id uuid primary key,user_id uuid);create table auth.mfa_factors(user_id uuid,status text,factor_type text);
      create table auth.mfa_amr_claims(session_id uuid,authentication_method text);
      create function bantai_private.session_decision(uuid,uuid) returns text language sql as $$select 'active'::text$$;
      create table notification_delivery_queue(recipient_user_id uuid,channel text,notification_type text,title text,message text,metadata jsonb);
      grant usage on schema auth to supabase_auth_admin;grant select,update on auth.users to supabase_auth_admin;
      insert into auth.users(id,encrypted_password) values('${user}','original');insert into auth.sessions values('${session}','${user}');`);
    for(const name of ["202611180002_recovery_security_questions.sql","202611180004_managed_password_history.sql","202611180005_password_history_rollout_control.sql"])
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),"utf8"));
    await t.test("fresh installation is legacy and rejects managed staging until explicit transition",async()=>{
      assert.equal((await db.query<{s:any}>("select bantai_password_history_rollout() s")).rows[0].s.mode,"legacy");
      await assert.rejects(stage());await assert.rejects(mode("managed"));
      await mode("frozen");await mode("managed");
    });
    await t.test("freeze is shared admission and fences an already staged request",async()=>{
      const op=await stage();await mode("frozen");
      await assert.rejects(stage());await assert.rejects(write(op.marker));
      await assert.rejects(db.query("insert into bantai_private.password_history_operations(id,user_id,session_id,authorization_id,version,epoch,digest,candidate) values($1,$2,$3,$4,0,0,'cached-stage','candidate')",[randomUUID(),user,session,op.authorizationId]),/admission is paused/);
      await assert.rejects(mode("legacy"));await assert.rejects(mode("managed"));
      const fresh=await proof();assert.equal((await call("reconcile",fresh)).status,"cancelled");
      await mode("legacy");await assert.rejects(write(op.marker));
      assert.equal((await call("status")).version,0);
    });
    await t.test("old legacy ticket admission is blocked and previous tickets cannot survive rollback",async()=>{
      const ticket="old-legacy-ticket";
      await db.query("select bantai_sq_action($1,$2,'aal1','ticket',$3::jsonb)",[user,session,JSON.stringify({digest:md5(ticket)})]);
      await mode("frozen");
      await assert.rejects(db.query("select bantai_sq_action($1,$2,'aal1','ticket',$3::jsonb)",[user,session,JSON.stringify({digest:md5("new-ticket")})]));
      await mode("legacy");
      await assert.rejects(db.query("update auth.users set encrypted_password='late-admin',raw_app_meta_data=jsonb_build_object('bantai_sq_ticket',$1::text) where id=$2",[ticket,user]));
    });
    await t.test("owner can drain already-fenced operations without waiting for inactive users",async()=>{
      await assert.rejects(db.exec("select bantai_private.drain_password_history_operations('approved fixture drain')"));
      await mode("frozen");await mode("managed");const op=await stage();await mode("frozen");
      await db.exec("begin;update bantai_private.password_history_operations set rollout_epoch=(select epoch from bantai_private.password_history_rollout) where status='pending'");
      await assert.rejects(db.exec("select bantai_private.drain_password_history_operations('must reject unfenced')"));await db.exec("rollback");
      const receipt=(await db.query<{r:any}>("select bantai_private.drain_password_history_operations('approved fixture drain') r")).rows[0].r;
      assert.equal(receipt.cancelled,1);assert.equal(receipt.pending,0);
      await assert.rejects(call("snapshot",op));
      await mode("legacy");await assert.rejects(write(op.marker));
      assert.equal((await call("status")).version,0);
      assert.equal((await db.query<{n:number}>("select count(*)::int n from bantai_private.password_history_rollout_audit where event='drain'")).rows[0].n,1);
    });
    await t.test("committed history survives freeze and rollback; restricted native role can maintain credentials",async()=>{
      await mode("frozen");await mode("managed");const op=await stage();await write(op.marker);
      await mode("frozen");await mode("legacy");
      await db.exec("set role supabase_auth_admin;update auth.users set encrypted_password='maintenance-representation';reset role");
      const s=await call("status");assert.equal(s.version,1);assert.equal(s.stale,true);assert.equal(s.tracked,1);
      await db.exec("set role supabase_auth_admin");
      await assert.rejects(db.exec("select * from bantai_private.password_history"));await db.exec("reset role");
    });
    await t.test("end-user and service roles cannot change admission or call the privileged cores",async()=>{
      for(const role of ["anon","authenticated","service_role"]){
        assert.equal((await db.query<{allowed:boolean}>("select has_table_privilege($1,'bantai_private.password_history_rollout','update') allowed",[role])).rows[0].allowed,false);
        for(const fn of ["bantai_private.set_password_history_mode(text,text)","bantai_private.drain_password_history_operations(text)","bantai_private.password_history_core(uuid,uuid,text,text,jsonb)","bantai_private.password_history_question_core(uuid,uuid,text,text,jsonb)"]){
          assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege($1,$2,'execute') allowed",[role,fn])).rows[0].allowed,false);
        }
      }
    });
    await t.test("frozen reconciliation still requires questions and native TOTP",async()=>{
      await mode("frozen");
      await db.query("insert into bantai_private.security_questions(user_id,questions,answers) values($1,array[1,2,3],'[\"a\",\"b\",\"c\"]')",[user]);
      const p=await proof();await assert.rejects(call("reconcile",p));
      const revision=(await db.query<{revision:string}>("select revision from bantai_private.security_questions where user_id=$1",[user])).rows[0].revision;
      await db.query("insert into bantai_private.security_question_proofs(user_id,session_id,kind,revision) values($1,$2,'recovery',$3)",[user,session,revision]);
      await db.query("insert into auth.mfa_factors values($1,'verified','totp')",[user]);
      await assert.rejects(call("reconcile",p));
      assert.equal((await db.query<{r:any}>("select bantai_password_history($1,$2,'aal2','reconcile',$3::jsonb) r",[user,session,JSON.stringify(p)])).rows[0].r.status,"none");
      await db.exec("delete from auth.mfa_factors;delete from bantai_private.security_questions");
      await mode("legacy");
    });
    await t.test("missing control and drift-persistence failure roll back native maintenance: explicit availability boundary",async()=>{
      await db.exec("begin;delete from bantai_private.password_history_rollout");
      await db.exec("update auth.users set encrypted_password='must-rollback'");
      await assert.rejects(db.exec("commit"));await db.exec("rollback");
      await db.exec(`create function bantai_private.reject_drift() returns trigger language plpgsql as $$begin raise exception 'fixture drift storage failure';end$$;
        create trigger reject_drift before update on bantai_private.password_history_state for each row execute function bantai_private.reject_drift();`);
      await assert.rejects(db.exec("update auth.users set encrypted_password='must-also-rollback'"));
      assert.equal((await db.query<{p:string}>("select encrypted_password p from auth.users")).rows[0].p,"maintenance-representation");
      await db.exec("drop trigger reject_drift on bantai_private.password_history_state");
      await db.exec(await readFile(new URL("../../supabase/scripts/password_history_hosted_preflight.sql",import.meta.url),"utf8"));
    });
  }finally{await db.close();}
});
