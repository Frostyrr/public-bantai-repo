/* Explicit manual rehearsal only. Use an isolated Supabase CLI stack with all
 * migrations and auth.email.require_current_password=true. Never target hosted
 * data. No password, grant, token, verifier or provider body is printed. */
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const {randomUUID,createHmac} = require("node:crypto");
const {createClient} = require("@supabase/supabase-js");
const express = require("express");

const {API_URL,PUBLISHABLE_KEY,SECRET_KEY,BANTAI_TEST_DB_CONTAINER}=process.env;
assert.equal(new URL(API_URL).hostname,"127.0.0.1");
assert.match(BANTAI_TEST_DB_CONTAINER,/^supabase_db_bantai-password-history-[0-9]+$/);
process.env.NODE_ENV="test";
process.env.SUPABASE_URL=API_URL;
process.env.SUPABASE_PUBLISHABLE_KEY=PUBLISHABLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY=SECRET_KEY;
process.env.PASSWORD_HISTORY_ENABLED="true";
process.env.PASSWORD_HISTORY_NATIVE_CURRENT_PASSWORD_REQUIRED="true";
process.env.EMAIL_MFA_HMAC_KEY="local-history-rehearsal-secret-at-least-32";
process.env.BREVO_API_KEY="local-rehearsal-only";
process.env.BREVO_SENDER_EMAIL="rehearsal@example.test";

const {passwordHistoryPublic,passwordHistorySettings}=require("../dist/modules/user/passwordHistory.routes");
const {recoveryQuestions}=require("../dist/modules/user/securityQuestions.routes");
const {authenticate}=require("../dist/middleware/authenticate");
const errorHandler=require("../dist/middleware/errorHandler").default;
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const service=createClient(API_URL,SECRET_KEY,options);
const client=()=>createClient(API_URL,PUBLISHABLE_KEY,options);
const nativeFetch=globalThis.fetch;
let code="",server,base,dropNativeResponse=false,nativeWrites=0;
globalThis.fetch=async(input,init)=>{
  const target=new URL(input instanceof Request?input.url:String(input));
  if(target.hostname==="api.brevo.com"){
    code=JSON.parse(String(init.body)).textContent.match(/code is ([0-9]{6})/)[1];
    return Response.json({messageId:"local-rehearsal"});
  }
  assert.ok(["127.0.0.1","localhost"].includes(target.hostname),"No external network requests in this rehearsal");
  if(target.pathname==="/auth/v1/user"&&init?.method==="PUT"){
    nativeWrites++;
    const response=await nativeFetch(input,init);
    if(dropNativeResponse&&response.ok){dropNativeResponse=false;throw new Error("Simulated lost native response");}
    return response;
  }
  return nativeFetch(input,init);
};
function sql(query){
  try{return execFileSync("docker",["exec","-i",BANTAI_TEST_DB_CONTAINER,"psql","-U","postgres","-XqAt","-v","ON_ERROR_STOP=1"],{input:query,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();}
  catch{throw new Error("Disposable database command failed (sensitive input suppressed)");}
}
function checked(result,label){if(result.error)throw new Error(label+" failed (provider response suppressed)");return result.data;}
let email=`history-${randomUUID()}@example.test`;
let userId,current="Initial-fixture-password9!";
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const state=()=>JSON.parse(sql(`select json_build_object('version',version,'tracked',tracked_count,'stale',stale,'gap',coverage_gap) from bantai_private.password_history_state where user_id=${literal(userId)}`));
async function post(path,body,token,proof){
  const result=await nativeFetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{ }),...(proof?{"X-Recovery-Authorization":proof}:{})},body:JSON.stringify(body)});
  return{status:result.status,data:result.status===204?null:await result.json()};
}
async function login(password=current){const auth=client();checked(await auth.auth.signInWithPassword({email,password}),"Native login");return auth;}
async function token(auth){return checked(await auth.auth.getSession(),"Native session").session.access_token;}
async function grant(auth){
  sql(`update bantai_private.password_history_challenges set sent_at=now()-interval '2 minutes' where user_id=${literal(userId)}`);
  const bearer=await token(auth);assert.equal((await post("/user/password-history/send",{},bearer)).status,204);
  const result=await post("/user/password-history/confirm",{code},bearer);assert.equal(result.status,200);
  return result.data.authorization;
}
async function change(auth,password,authorization){return post("/user/password-history/change",{password,currentPassword:current,authorization},await token(auth));}
async function recover(){
  const generated=checked(await service.auth.admin.generateLink({type:"recovery",email}),"Recovery OTP fixture");
  const result=await post("/auth/password-history/verify",{email,token:generated.properties.email_otp});assert.equal(result.status,200);
  const auth=client();checked(await auth.auth.setSession(result.data),"Isolated recovery session");
  return{auth,authorization:result.data.authorization};
}
function totp(secret){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits=[...secret.replace(/=/g,"")].map(char=>alphabet.indexOf(char).toString(2).padStart(5,"0")).join("");
  const bytes=Buffer.from((bits.match(/.{8}/g)||[]).map(value=>parseInt(value,2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));
  const digest=createHmac("sha1",bytes).update(counter).digest(),offset=digest[digest.length-1]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,"0");
}
async function main(){
  // Admission changes require a separate explicit local rehearsal setup. The
  // runner never activates or resumes shared database admission itself.
  const admission=JSON.parse(sql("select public.bantai_password_history_rollout()"));
  assert.equal(admission.protocol,2);assert.equal(admission.mode,"managed");assert.equal(admission.databaseGate,"managed");
  const app=express();app.use(express.json());
  app.use("/auth/password-history",passwordHistoryPublic);
  app.use("/user/password-history",authenticate,passwordHistorySettings);
  app.use("/auth/recovery-questions",recoveryQuestions);app.use(errorHandler);
  server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const created=checked(await service.auth.admin.createUser({email,password:current,email_confirm:true,user_metadata:{bantai_identity:{firstName:"History",lastName:"Fixture",middleName:null,birthdate:null,username:`h${randomUUID().replaceAll("-","").slice(0,14)}`}}}),"Synthetic account");
  userId=created.user.id;
  let auth=await login(),authorization=await grant(auth),next="Managed-fixture-password1!";
  assert.equal((await change(auth,next,authorization)).status,204);current=next;
  assert.deepEqual(state(),{version:1,tracked:2,stale:false,gap:0});
  console.log("PASS native login and authenticated managed change with current-password seed");

  const before=sql(`select string_agg(verifier,',' order by version) from bantai_private.password_history where user_id=${literal(userId)}`);
  const external="External-fixture-password9!";
  checked(await service.auth.admin.updateUserById(userId,{password:external}),"External administrative password change");current=external;
  auth=await login();assert.equal(state().stale,true);
  assert.equal(sql(`select string_agg(verifier,',' order by version) from bantai_private.password_history where user_id=${literal(userId)}`),before);
  authorization=await grant(auth);assert.equal((await change(auth,"Blocked-before-reconciliation9!",authorization)).status,409);
  console.log("PASS external administrative change preserves login and blocks stale managed writes");

  const recovery=await recover();const bearer=await token(recovery.auth);
  let result=await post("/auth/recovery-questions/password",{password:"Managed-fixture-password1!"},bearer,recovery.authorization);
  assert.equal(result.status,400);assert.equal(result.data.code,"password_reused");
  assert.equal((await post("/auth/recovery-questions/password",{password:"Not-yet-reconciled9!"},bearer,recovery.authorization)).status,409);
  assert.equal((await post("/auth/recovery-questions/reconcile",{},bearer,recovery.authorization)).status,200);
  assert.equal(sql(`select string_agg(verifier,',' order by version) from bantai_private.password_history where user_id=${literal(userId)}`),before);
  result=await post("/auth/recovery-questions/password",{password:external},bearer,recovery.authorization);
  assert.equal(result.status,400);assert.equal(result.data.code,"password_reused");
  next="Recovered-fixture-password2!";
  assert.equal((await post("/auth/recovery-questions/password",{password:next},bearer,recovery.authorization)).status,204);current=next;
  assert.deepEqual(state(),{version:2,tracked:3,stale:false,gap:3});
  auth=await login();
  console.log("PASS verified recovery retains history, rejects actual external current password and records gap");

  for(let i=3;i<=5;i++){
    authorization=await grant(auth);next=`Managed-fixture-password${i}!`;
    assert.equal((await change(auth,next,authorization)).status,204);current=next;
  }
  assert.deepEqual(state(),{version:5,tracked:4,stale:false,gap:0});
  console.log("PASS subsequent managed changes age out gap without another bootstrap");

  // Native user API is another real out-of-band writer, separate from Admin.
  next="Native-external-fixture9!";
  checked(await auth.auth.updateUser({password:next,current_password:current}),"External native user password change");current=next;
  auth=await login();assert.equal(state().stale,true);assert.equal(state().version,5);
  console.log("PASS direct native user change preserves login and invalidates tracked state");
  const nativeRecovery=await recover(),nativeBearer=await token(nativeRecovery.auth);
  assert.equal((await post("/auth/recovery-questions/reconcile",{},nativeBearer,nativeRecovery.authorization)).status,200);
  next="Native-recovered-fixture6!";
  assert.equal((await post("/auth/recovery-questions/password",{password:next},nativeBearer,nativeRecovery.authorization)).status,204);current=next;
  auth=await login();authorization=await grant(auth);next="Native-followup-fixture7!";
  assert.equal((await change(auth,next,authorization)).status,204);current=next;
  assert.deepEqual(state(),{version:7,tracked:4,stale:false,gap:2});
  console.log("PASS native external change followed by recovery and managed password change");

  // A separate fixture stays within the real per-account request limit.
  email=`history-race-${randomUUID()}@example.test`;current="Race-initial-fixture9!";
  userId=checked(await service.auth.admin.createUser({email,password:current,email_confirm:true}),"Race account").user.id;
  auth=await login();authorization=await grant(auth);next="Race-seeded-fixture1!";
  assert.equal((await change(auth,next,authorization)).status,204);current=next;
  const other=await login(),firstProof=await grant(auth),secondProof=await grant(other);
  const candidates=["Race-candidate-first9!","Race-candidate-second9!"];
  const race=await Promise.all([change(auth,candidates[0],firstProof),change(other,candidates[1],secondProof)]);
  assert.equal(race.filter(result=>result.status===204).length,1);
  assert.ok(race.every(result=>[204,409,401].includes(result.status)));
  current=candidates[race.findIndex(result=>result.status===204)];
  assert.equal(state().version,2);auth=await login();
  console.log("PASS concurrent Express changes serialize across real database requests");

  authorization=await grant(auth);const version=state().version;
  sql(`create function bantai_private.history_rehearsal_failure() returns trigger language plpgsql as $$begin raise exception 'rehearsal history persistence failure';end$$;
    create trigger history_rehearsal_failure before insert on bantai_private.password_history for each row execute function bantai_private.history_rehearsal_failure();`);
  try{assert.equal((await change(auth,"Rollback-fixture-password9!",authorization)).status,400);assert.equal(state().version,version);await login();}
  finally{sql("drop trigger history_rehearsal_failure on bantai_private.password_history;drop function bantai_private.history_rehearsal_failure()");}
  next="Retry-after-rollback9!";assert.equal((await change(auth,next,authorization)).status,204);current=next;
  console.log("PASS native password and session changes roll back on history persistence error; retry succeeds");

  authorization=await grant(auth);next="Lost-response-fixture9!";dropNativeResponse=true;nativeWrites=0;
  assert.equal((await change(auth,next,authorization)).status,204);current=next;
  assert.equal(nativeWrites,1);await login();
  console.log("PASS real Auth commit with lost response reconciles without credential replay");

  email=`history-mfa-${randomUUID()}@example.test`;current="MFA-initial-fixture9!";
  userId=checked(await service.auth.admin.createUser({email,password:current,email_confirm:true}),"MFA account").user.id;
  auth=await login();
  const factor=checked(await auth.auth.mfa.enroll({factorType:"totp",issuer:"Bantai rehearsal"}),"Native TOTP enrollment");
  const enrolledCounter=Math.floor(Date.now()/30_000);
  checked(await auth.auth.mfa.challengeAndVerify({factorId:factor.id,code:totp(factor.totp.secret)}),"Native TOTP enrollment verification");
  const {hashAnswer}=require("../dist/modules/user/securityQuestionAnswers");
  const answers=["Fixture pet","Fixture friend","Fixture teacher"],answerVerifiers=await Promise.all(answers.map(hashAnswer));
  sql(`insert into bantai_private.security_questions(user_id,questions,answers) values(${literal(userId)},array[1,2,3],${literal(JSON.stringify(answerVerifiers))}::jsonb)`);
  const mfaRecovery=await recover();let mfaBearer=await token(mfaRecovery.auth);
  next="MFA-recovered-fixture9!";
  assert.equal((await post("/auth/recovery-questions/password",{password:next},mfaBearer,mfaRecovery.authorization)).status,409);
  if(Math.floor(Date.now()/30_000)===enrolledCounter)await new Promise(resolve=>setTimeout(resolve,30_050-Date.now()%30_000));
  checked(await mfaRecovery.auth.auth.mfa.challengeAndVerify({factorId:factor.id,code:totp(factor.totp.secret)}),"Native recovery TOTP verification");
  mfaBearer=await token(mfaRecovery.auth);
  assert.equal((await post("/auth/recovery-questions/password",{password:next},mfaBearer,mfaRecovery.authorization)).status,409);
  assert.equal((await post("/auth/recovery-questions/verify",{answers},mfaBearer,mfaRecovery.authorization)).status,204);
  assert.equal((await post("/auth/recovery-questions/password",{password:next},mfaBearer,mfaRecovery.authorization)).status,204);current=next;
  assert.deepEqual(state(),{version:1,tracked:1,stale:false,gap:0});
  assert.equal(sql(`select count(*) from bantai_private.security_question_password_tickets where user_id=${literal(userId)}`),"0");
  auth=await login();assert.equal((await post("/user/password-history/send",{},await token(auth))).status,403);
  console.log("PASS real native TOTP and question proofs remain mandatory; deferred question gate commits correctly");
}
main().catch(error=>{console.error("FAIL native password-history rehearsal; details suppressed to protect credentials");console.error(error.name,...String(error.stack).split("\n").filter(line=>/^\s+at /.test(line)).slice(0,4));process.exitCode=1;}).finally(async()=>{
  globalThis.fetch=nativeFetch;
  if(server)await new Promise(resolve=>server.close(resolve));
});
