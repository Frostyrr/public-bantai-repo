import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";

// Counterexamples, not feature acceptance. Only isolated SQL fixtures are changed.
// No production migration, application trigger, credential, or setting is edited.
async function fixture(){
  const db=new PGlite(),user=randomUUID(),session=randomUUID();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create role supabase_auth_admin;create role history_trigger_owner;
    create schema auth;create schema bantai_private;
    create table auth.users(id uuid primary key,encrypted_password text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid);create table auth.mfa_factors(user_id uuid,status text,factor_type text);
    create table auth.mfa_amr_claims(session_id uuid,authentication_method text);
    create function bantai_private.session_decision(uuid,uuid) returns text language sql as $$select 'active'::text$$;
    create table notification_delivery_queue(recipient_user_id uuid,channel text,notification_type text,title text,message text,metadata jsonb);
    grant usage on schema auth to supabase_auth_admin;
    grant select,update on auth.users to supabase_auth_admin;
    insert into auth.users(id,encrypted_password) values('${user}','original-fixture');
    insert into auth.sessions values('${session}','${user}');`);
  for(const file of ["202611180002_recovery_security_questions.sql","202611180004_managed_password_history.sql","202611180005_password_history_rollout_control.sql"])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),"utf8"));
  const call=async(action:string,data:object={})=>(await db.query<{r:any}>("select bantai_password_history($1,$2,'aal1',$3,$4::jsonb) r",[user,session,action,JSON.stringify(data)])).rows[0].r;
  const stage=async()=>{
    const authorizationId=randomUUID(),operationId=randomUUID(),marker=randomUUID(),s=await call("status");
    await call("issue_reset",{id:authorizationId,digest:"fixture-proof"});
    await call("stage",{authorizationId,authorizationDigest:"fixture-proof",operationId,version:s.version,epoch:s.epoch,
      operationDigest:createHash("md5").update(marker).digest("hex"),candidate:"independent-fixture-verifier",questionTicket:randomUUID()});
    return {marker,operationId};
  };
  const write=(password:string,marker?:string)=>db.query("update auth.users set encrypted_password=$1,raw_user_meta_data=$2::jsonb where id=$3",[password,JSON.stringify(marker?{bantai_password_operation:marker}:{}),user]);
  const current=async()=>(await db.query<{p:string}>("select encrypted_password p from auth.users where id=$1",[user])).rows[0].p;
  await db.exec("select bantai_private.set_password_history_mode('frozen','isolated audit setup');select bantai_private.set_password_history_mode('managed','isolated audit setup')");
  return{db,user,session,call,stage,write,current};
}

test("audit: missing/inaccessible control blocks unrelated native maintenance in legacy mode",async()=>{
  const f=await fixture();
  try{
    await f.db.exec("select bantai_private.set_password_history_mode('frozen','isolated disabled audit');select bantai_private.set_password_history_mode('legacy','isolated disabled audit')");
    await f.db.exec("begin;delete from bantai_private.password_history_rollout;set local role supabase_auth_admin");
    await f.write("missing-control-maintenance");
    await assert.rejects(f.db.exec("commit"));await f.db.exec("rollback");
    assert.equal(await f.current(),"original-fixture");
    await f.db.exec(`grant usage,create on schema bantai_private to history_trigger_owner;
      grant usage on schema auth to history_trigger_owner;
      grant select,update on all tables in schema bantai_private to history_trigger_owner;
      grant select on auth.users,auth.sessions,auth.mfa_factors to history_trigger_owner;
      grant update(raw_user_meta_data,raw_app_meta_data) on auth.users to history_trigger_owner;
      alter function bantai_private.commit_managed_password_history() owner to history_trigger_owner;
      revoke select on bantai_private.password_history_rollout from history_trigger_owner;
      set role supabase_auth_admin;`);
    await assert.rejects(f.write("permission-failure-maintenance"));await f.db.exec("reset role");
    assert.equal(await f.current(),"original-fixture");
  }finally{await f.db.close();}
});

test("audit counterexample: swallowing only drift failure loses the same-session managed fence",async()=>{
  const f=await fixture();
  try{
    const first=await f.stage();await f.write("tracked-fixture",first.marker);
    const pending=await f.stage();
    const sql=(await readFile(new URL("../../supabase/migrations/202611180005_password_history_rollout_control.sql",import.meta.url),"utf8")).replace(/\r\n/g,"\n");
    const start=sql.indexOf("create or replace function bantai_private.commit_managed_password_history()");
    const end=sql.indexOf("end $$;",start)+"end $$;".length;
    const body=sql.slice(start,end);
    const update="update bantai_private.password_history_state set stale=true,\n      credential_epoch=credential_epoch+1,coverage_gap=4 where user_id=new.id and version>0;";
    assert.ok(body.includes(update));
    // Deliberately unsafe alternative confined to this ephemeral database.
    await f.db.exec(body.replace(update,`begin\n${update}\nexception when others then null;\nend;`));
    await f.db.exec(`create function bantai_private.fail_drift_only() returns trigger language plpgsql as $$
      begin if new.stale then raise exception 'fixture drift failure';end if;return new;end$$;
      create trigger fail_drift_only before update on bantai_private.password_history_state for each row execute function bantai_private.fail_drift_only();`);
    await f.write("external-same-session-fixture");
    assert.equal((await f.call("status")).stale,false);
    await f.write("late-managed-fixture",pending.marker);
    assert.equal(await f.current(),"late-managed-fixture");
    assert.equal((await f.call("status")).version,2);
    assert.equal((await f.db.query<{n:number}>("select count(*)::int n from auth.sessions")).rows[0].n,1);
  }finally{await f.db.close();}
});

test("audit counterexample: version-zero staging misses external invalidation even without injected failure",async()=>{
  const f=await fixture();
  try{
    const pending=await f.stage();
    await f.write("external-during-first-stage");
    assert.equal((await f.call("status")).epoch,0);
    await f.write("late-first-managed-fixture",pending.marker);
    assert.equal(await f.current(),"late-first-managed-fixture");
    assert.equal((await f.call("status")).version,1);
  }finally{await f.db.close();}
});
