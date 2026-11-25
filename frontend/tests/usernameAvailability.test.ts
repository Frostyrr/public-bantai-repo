import assert from "node:assert/strict";
import {test} from "node:test";
import {setTimeout as wait} from "node:timers/promises";
import {normalizeUsername,scheduleUsernameCheck,validUsernameCandidate} from "../src/lib/usernameAvailability";
import {formatRestrictionDuration,getLoginRestriction} from "../src/config/loginRestriction";

test("candidate validation and normalization match the registration constraints",()=>{
  for(const value of ["abc","1member","member_name","name@site.test"," member1 ","a".repeat(21)]) assert.equal(validUsernameCandidate(value),false,value);
  assert.equal(validUsernameCandidate("Member123"),true);
  assert.equal(normalizeUsername("Member123"),"member123");
});
test("rapid input cancels debounce and only checks the latest candidate",async()=>{
  const checked:string[]=[];
  const results:unknown[]=[];
  const check=async(username:string)=>{checked.push(username);return true;};
  const cancel=scheduleUsernameCheck("Member1",check,value=>results.push(value),20);
  cancel();
  const cleanup=scheduleUsernameCheck("Member2",check,value=>results.push(value),20);
  await wait(50);
  assert.deepEqual(checked,["member2"]);
  assert.deepEqual(results,[{available:true}]);
  cleanup();
});
test("late success and failure cannot replace current state after cancellation",async()=>{
  const results:unknown[]=[];
  let resolve!:(value:boolean)=>void;
  const cancel=scheduleUsernameCheck("Member1",()=>new Promise<boolean>(done=>{resolve=done;}),value=>results.push(value),0);
  await wait(5); cancel(); resolve(false); await wait(5);
  const failure=scheduleUsernameCheck("Member2",async()=>{throw new Error("offline");},value=>results.push(value),0);
  await wait(10); failure();
  assert.equal(results.length,1);
  assert.ok("error" in (results[0] as object));
});
test("restriction messages include server retry timing without inventing suspension expiry",()=>{
  assert.equal(formatRestrictionDuration(3661),"1h 1m 1s");
  for(const [code,status] of [["account_locked",403],["ip_restricted",429],["login_restricted",429]] as const){
    const error={status,code,retryAfterSeconds:90};
    assert.match(getLoginRestriction(error)!.message,/1m 30s/);
    assert.match(getLoginRestriction(error,10)!.message,/10s/);
    assert.doesNotMatch(getLoginRestriction(error,0)!.message,/Retry in/);
  }
  assert.doesNotMatch(getLoginRestriction({status:403,code:"account_suspended"})!.message,/Retry in/);
});
