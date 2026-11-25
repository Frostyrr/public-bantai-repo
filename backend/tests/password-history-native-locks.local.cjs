/* Manual, network-isolated PostgreSQL SQL-lock rehearsal, not hosted Auth.
 * Creates/removes only its labelled synthetic container. No ports or credentials.
 * No operational environment/configuration or Auth API is used. */
const assert=require("node:assert/strict");
const {execFileSync,spawn}=require("node:child_process");
const {readFileSync}=require("node:fs");
const {randomUUID,createHash}=require("node:crypto");
const path=require("node:path");
const container=`bantai-native-availability-${Date.now()}`;
let created=false,phase="setup";
const docker=(args,input)=>execFileSync("docker",args,{input,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();
const args=["exec","-i",container,"psql","-U","postgres","-XqAt","-v","ON_ERROR_STOP=1"];
const sql=script=>docker(args,script);
const literal=value=>"'"+value.replaceAll("'","''")+"'";
function running(script,label){
  const child=spawn("docker",args,{stdio:["pipe","pipe","pipe"]});
  let output="",finished=false,resolveReady,resolveDone;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const done=new Promise(resolve=>{resolveDone=resolve;});
  child.stdout.on("data",chunk=>{output+=chunk;if(label&&output.includes(label))resolveReady();});
  child.stderr.on("data",()=>{}); // Never print SQL/provider bodies.
  child.on("error",()=>{finished=true;resolveDone({code:1,output:""});});
  child.on("close",code=>{finished=true;resolveDone({code,output});});
  child.stdin.end(script);
  return{done,finished:()=>finished,ready:async()=>{
    let timer;
    try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("SQL latch timeout")),6000);})]);}
    finally{clearTimeout(timer);}
  }};
}
async function main(){
  assert.match(container,/^bantai-native-availability-[0-9]+$/);
  docker(["run","--detach","--network","none","--name",container,"--label","bantai-test=native-availability","--env","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"]);created=true;
  let ready=false;
  for(let i=0;i<60&&!ready;i++){try{assert.equal(docker(["exec",container,"cat","/proc/1/comm"]),"postgres");docker(["exec",container,"pg_isready","-U","postgres"]);ready=true;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
  assert.ok(ready);
  const user=randomUUID(),session=randomUUID();
  phase="schema";
  sql(`create role anon;create role authenticated;create role service_role;create role supabase_auth_admin;
    create schema auth;create schema bantai_private;
    create table auth.users(id uuid primary key,encrypted_password text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid);create table auth.mfa_factors(user_id uuid,status text,factor_type text);
    create table auth.mfa_amr_claims(session_id uuid,authentication_method text);
    create function bantai_private.session_decision(uuid,uuid) returns text language sql as $$select 'active'::text$$;
    create table notification_delivery_queue(recipient_user_id uuid,channel text,notification_type text,title text,message text,metadata jsonb);
    grant usage on schema auth to supabase_auth_admin;grant select,update on auth.users to supabase_auth_admin;
    insert into auth.users(id,encrypted_password) values('${user}','synthetic-initial');insert into auth.sessions values('${session}','${user}');`);
  for(const file of ["202611180002_recovery_security_questions.sql","202611180004_managed_password_history.sql","202611180005_password_history_rollout_control.sql","202611180006_password_history_native_availability.sql"]){
    phase=`migration-${file}`;sql(readFileSync(path.join(__dirname,"../../supabase/migrations",file),"utf8"));
  }
  const mode=value=>sql(`select bantai_private.set_password_history_mode(${literal(value)},'approved isolated SQL rehearsal')`);

  for(const state of ["disabled","frozen"]){
    phase=`${state}-control-lock`;if(state==="frozen")mode("frozen");
    const a=running("begin;select singleton from bantai_private.password_history_rollout for update;select 'CONTROL_HELD';select pg_sleep(3);commit;","CONTROL_HELD");
    await a.ready();
    const b=running(`set role supabase_auth_admin;update auth.users set encrypted_password=${literal(`synthetic-${state}`)} where id=${literal(user)};`);
    assert.equal((await b.done).code,0);assert.equal(a.finished(),false);assert.equal((await a.done).code,0);
    console.log(`PASS ${state}: native SQL update completes while control row is locked`);
  }
  phase="freeze-waits-native";mode("managed");
  const a=running(`begin;set local role supabase_auth_admin;update auth.users set encrypted_password='synthetic-active' where id=${literal(user)};set constraints all immediate;select 'NATIVE_PASSED';select pg_sleep(2);commit;`,"NATIVE_PASSED");
  await a.ready();
  const b=running("set lock_timeout='5s';select bantai_private.set_password_history_mode('frozen','approved freeze barrier test');");
  await new Promise(resolve=>setTimeout(resolve,250));assert.equal(b.finished(),false);
  assert.equal((await a.done).code,0);assert.equal((await b.done).code,0);
  console.log("PASS freeze waits for an admitted native credential transaction without lock inversion");

  phase="queued-managed-replay";mode("managed");
  const authorizationId=randomUUID(),operationId=randomUUID(),marker=randomUUID(),ticket=randomUUID();
  const action=(name,data)=>sql(`select bantai_password_history('${user}','${session}','aal1',${literal(name)},${literal(JSON.stringify(data))}::jsonb)`);
  action("issue_reset",{id:authorizationId,digest:"proof"});
  const state=JSON.parse(action("status",{}));
  if(state.stale)action("reconcile",{authorizationId,authorizationDigest:"proof"});
  action("stage",{authorizationId,authorizationDigest:"proof",operationId,operationDigest:createHash("md5").update(marker).digest("hex"),candidate:"synthetic-independent-verifier",version:state.version,epoch:state.epoch,questionTicket:ticket});
  const owner=running("begin;lock table auth.users in share row exclusive mode;select 'TABLE_HELD';select pg_sleep(2);select bantai_private.set_password_history_mode('frozen','approved queued writer test');commit;","TABLE_HELD");
  await owner.ready();
  const late=running(`set role supabase_auth_admin;update auth.users set encrypted_password='must-not-commit',raw_user_meta_data=jsonb_build_object('bantai_password_operation',${literal(marker)}) where id=${literal(user)};`);
  assert.equal((await owner.done).code,0);assert.notEqual((await late.done).code,0);
  assert.equal(sql(`select encrypted_password from auth.users where id='${user}'`),"synthetic-active");
  sql("select bantai_private.drain_password_history_operations('approved isolated fenced drain')");mode("legacy");
  console.log("PASS queued managed writer is rejected after freeze; fenced drain and disabled rollback succeed");
}
main().catch(()=>{console.error(`FAIL local SQL lock rehearsal at ${phase}; sensitive details suppressed`);process.exitCode=1;}).finally(()=>{
  if(created){
    const label=docker(["inspect","--format","{{index .Config.Labels \"bantai-test\"}}",container]);
    assert.equal(label,"native-availability");
    docker(["rm","--force","--volumes",container]);
    console.log("Removed only the labelled synthetic test container");
  }
});
