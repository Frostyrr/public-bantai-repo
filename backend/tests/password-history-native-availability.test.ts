import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";

test("database disabled/frozen gate isolates native Auth from private history failures",async t=>{
  const db=new PGlite(),user=randomUUID(),session=randomUUID();
  const md5=(s:string)=>createHash("md5").update(s).digest("hex");
  const call=async(action:string,data:object={})=>(await db.query<{r:any}>("select bantai_password_history($1,$2,'aal1',$3,$4::jsonb) r",[user,session,action,JSON.stringify(data)])).rows[0].r;
  const mode=async(value:string)=>db.query("select bantai_private.set_password_history_mode($1,'isolated native availability test')",[value]);
  const policy=async()=>(await db.query<{p:string}>("select bantai_password_history_database_mode() p")).rows[0].p;
  const status=async()=>(await db.query<{s:any}>("select bantai_password_history_rollout() s")).rows[0].s;
  const issue=async()=>{const authorizationId=randomUUID();await call("issue_reset",{id:authorizationId,digest:"proof"});return{authorizationId,authorizationDigest:"proof"};};
  const stage=async()=>{
    const p=await issue(),s=await call("status"),operationId=randomUUID(),marker=randomUUID();
    if(s.stale)await call("reconcile",p);
    await call("stage",{...p,operationId,operationDigest:md5(marker),version:s.version,epoch:s.epoch,candidate:"independent-fixture-verifier",questionTicket:randomUUID()});
    return{...p,operationId,marker};
  };
  const write=async(value:string,marker?:string,ticket?:string)=>{
    await db.exec("set role supabase_auth_admin");
    try{return await db.query("update auth.users set encrypted_password=$1,raw_user_meta_data=$2::jsonb,raw_app_meta_data=$3::jsonb where id=$4",[value,JSON.stringify(marker?{bantai_password_operation:marker}:{}),JSON.stringify(ticket?{bantai_sq_ticket:ticket}:{}),user]);}
    finally{await db.exec("reset role");}
  };
  const credential=async()=>(await db.query<{p:string}>("select encrypted_password p from auth.users where id=$1",[user])).rows[0].p;
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create role supabase_auth_admin;create role unavailable_history_owner;
      create schema auth;create schema bantai_private;
      create table auth.users(id uuid primary key,encrypted_password text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create table auth.sessions(id uuid primary key,user_id uuid);create table auth.mfa_factors(user_id uuid,status text,factor_type text);
      create table auth.mfa_amr_claims(session_id uuid,authentication_method text);
      create function bantai_private.session_decision(uuid,uuid) returns text language sql as $$select 'active'::text$$;
      create table notification_delivery_queue(recipient_user_id uuid,channel text,notification_type text,title text,message text,metadata jsonb);
      grant usage on schema auth to supabase_auth_admin;grant select,update on auth.users to supabase_auth_admin;
      insert into auth.users(id,encrypted_password) values('${user}','initial-fixture');insert into auth.sessions values('${session}','${user}');`);
    for(const file of ["202611180002_recovery_security_questions.sql","202611180004_managed_password_history.sql","202611180005_password_history_rollout_control.sql","202611180006_password_history_native_availability.sql"])
      await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),"utf8"));

    await t.test("fresh installation is disabled; marked requests always fail",async()=>{
      assert.equal(await policy(),"disabled");assert.equal((await status()).mode,"legacy");
      await write("native-disabled-fixture");
      await assert.rejects(write("tagged-must-fail",randomUUID()));
      assert.equal(await credential(),"native-disabled-fixture");await assert.rejects(stage());
    });
    await t.test("disabled native maintenance and legacy recovery work with a missing control row",async()=>{
      const old=(await db.query<{epoch:number}>("select epoch from bantai_private.password_history_rollout")).rows[0];
      await db.exec("delete from bantai_private.password_history_rollout");
      await write("native-without-control");assert.equal((await status()).mode,"legacy");
      const ticket=randomUUID();await db.query("select bantai_sq_action($1,$2,'aal1','ticket',$3::jsonb)",[user,session,JSON.stringify({digest:md5(ticket)})]);
      await write("legacy-recovery-without-control",undefined,ticket);
      assert.equal(await credential(),"legacy-recovery-without-control");
      await assert.rejects(mode("managed"));
      await db.query("insert into bantai_private.password_history_rollout(singleton,mode,epoch) values(true,'legacy',$1)",[old.epoch+1]);
    });
    await t.test("renamed control table and incomplete columns do not interrupt disabled Auth",async()=>{
      await db.exec("alter table bantai_private.password_history_rollout rename to unavailable_rollout");
      await write("native-without-control-table");assert.equal((await status()).mode,"legacy");
      await db.exec("alter table bantai_private.unavailable_rollout rename to password_history_rollout;alter table bantai_private.password_history_rollout rename column mode to unavailable_mode");
      await write("native-with-incomplete-control");assert.equal((await status()).mode,"legacy");
      await db.exec("alter table bantai_private.password_history_rollout rename column unavailable_mode to mode");
    });
    await t.test("existing question and TOTP ticket guards survive missing history control",async()=>{
      await db.exec("alter table bantai_private.password_history_rollout rename to unavailable_rollout");
      try{
        await db.query("insert into bantai_private.security_questions(user_id,questions,answers) values($1,array[1,2,3],'[\"a\",\"b\",\"c\"]')",[user]);
        await assert.rejects(write("question-bypass-must-fail"),/Use Bantai account recovery/);
        const ticket=randomUUID(),payload=JSON.stringify({digest:md5(ticket)});
        await assert.rejects(db.query("select bantai_sq_action($1,$2,'aal1','ticket',$3::jsonb)",[user,session,payload]));
        const revision=(await db.query<{revision:string}>("select revision from bantai_private.security_questions")).rows[0].revision;
        await db.query("insert into bantai_private.security_question_proofs(user_id,session_id,kind,revision) values($1,$2,'recovery',$3)",[user,session,revision]);
        await db.query("insert into auth.mfa_factors values($1,'verified','totp')",[user]);
        await assert.rejects(db.query("select bantai_sq_action($1,$2,'aal1','ticket',$3::jsonb)",[user,session,payload]));
        await db.query("select bantai_sq_action($1,$2,'aal2','ticket',$3::jsonb)",[user,session,payload]);
        await write("verified-legacy-recovery",undefined,ticket);
        assert.equal(await credential(),"verified-legacy-recovery");
      }finally{await db.exec("delete from auth.mfa_factors;delete from bantai_private.security_questions;alter table bantai_private.unavailable_rollout rename to password_history_rollout");}
    });
    await t.test("active version-zero invalidation fences external same-session changes",async()=>{
      await mode("frozen");await mode("managed");const op=await stage();
      await write("external-first-stage");assert.equal((await call("status")).epoch,1);
      await assert.rejects(write("late-first-managed",op.marker));assert.equal(await credential(),"external-first-stage");
      await mode("frozen");await db.exec("select bantai_private.drain_password_history_operations('approved isolated fenced drain')");await mode("legacy");
      await assert.rejects(write("late-after-disabled",op.marker));
    });
    await t.test("unobserved inactive changes retain known history and force reactivation reconciliation",async()=>{
      await mode("frozen");await mode("managed");const op=await stage();await write("tracked-managed",op.marker);
      await mode("frozen");await mode("legacy");
      const before=await call("status");await write("external-while-disabled");
      assert.equal((await call("status")).version,before.version);assert.equal((await call("status")).epoch,before.epoch);
      await mode("frozen");await mode("managed");
      assert.equal((await call("status")).stale,true);assert.equal((await call("status")).tracked,1);
      const p=await issue(),s=await call("status");
      await assert.rejects(call("stage",{...p,operationId:randomUUID(),operationDigest:md5(randomUUID()),candidate:"candidate",version:s.version,epoch:s.epoch,questionTicket:randomUUID()}));
      await mode("frozen");await mode("legacy");
    });
    await t.test("history definer permission failures spare inactive Auth but block active operations",async()=>{
      await db.exec(`grant usage,create on schema public to unavailable_history_owner;
        alter function public.bantai_complete_managed_password(uuid) owner to unavailable_history_owner;`);
      await write("native-without-history-permissions");
      await mode("frozen");await write("native-frozen-without-history-permissions");
      await mode("managed");const op=await stage();
      await assert.rejects(write("managed-permission-failure",op.marker));
      await assert.rejects(write("active-unmarked-permission-failure"));
      assert.equal(await credential(),"native-frozen-without-history-permissions");
      await mode("frozen");await db.exec("select bantai_private.drain_password_history_operations('approved isolated permission drain')");await mode("legacy");
      await write("native-recovered-disabled");
      await db.exec("alter function public.bantai_complete_managed_password(uuid) owner to postgres");
    });
    await t.test("drift persistence is critical only in managed mode; failed reactivation stays frozen",async()=>{
      await mode("frozen");await mode("managed");await stage();const before=await credential();
      await db.exec(`create function bantai_private.fail_active_drift() returns trigger language plpgsql as $$begin
        if new.stale and new.credential_epoch>old.credential_epoch then raise exception 'fixture drift persistence failure';end if;return new;end$$;
        create trigger fail_active_drift before update on bantai_private.password_history_state for each row execute function bantai_private.fail_active_drift();`);
      try{
        await assert.rejects(write("active-drift-error"),/fixture drift persistence failure/);assert.equal(await credential(),before);
        await mode("frozen");await write("frozen-drift-error-isolated");
        await db.exec("select bantai_private.drain_password_history_operations('approved isolated drift drain')");
        await assert.rejects(mode("managed"),/fixture drift persistence failure/);assert.equal(await policy(),"frozen");
        await mode("legacy");await write("disabled-drift-error-isolated");
        assert.equal((await call("status")).tracked,1);
      }finally{await db.exec("drop trigger fail_active_drift on bantai_private.password_history_state");}
    });
    await t.test("active missing control fails closed; physically frozen native Auth survives",async()=>{
      await mode("frozen");await mode("managed");
      await db.exec("begin;delete from bantai_private.password_history_rollout");
      await db.query("update auth.users set encrypted_password='active-missing-control' where id=$1",[user]);
      await assert.rejects(db.exec("commit"));await db.exec("rollback");
      await mode("frozen");
      await db.exec("begin;delete from bantai_private.password_history_rollout");
      await db.query("update auth.users set encrypted_password='frozen-missing-control' where id=$1",[user]);await db.exec("commit");
      assert.equal(await credential(),"frozen-missing-control");assert.equal((await status()).mode,"frozen");
      await assert.rejects(write("frozen-managed-replay",randomUUID()));
    });
    await t.test("strict worker and operator policy mutation remain inaccessible to application roles",async()=>{
      for(const role of ["anon","authenticated","service_role"]){
        assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.bantai_complete_managed_password(uuid)','execute') allowed",[role])).rows[0].allowed,false);
        assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege($1,'bantai_private.set_password_history_mode(text,text)','execute') allowed",[role])).rows[0].allowed,false);
      }
      await db.exec("revoke execute on function public.bantai_complete_managed_password(uuid) from supabase_auth_admin");
      await write("frozen-without-worker-execute");
      await db.exec("grant execute on function public.bantai_complete_managed_password(uuid) to supabase_auth_admin");
      await db.exec("begin;drop function public.bantai_complete_managed_password(uuid)");
      await db.query("update auth.users set encrypted_password='frozen-without-worker-code' where id=$1",[user]);
      await db.exec("set constraints all immediate;rollback");
      await db.exec(await readFile(new URL("../../supabase/scripts/password_history_hosted_preflight.sql",import.meta.url),"utf8"));
    });
  }finally{await db.close();}
});
