import assert from "node:assert/strict";
import {test} from "node:test";
import express from "express";
import type {AddressInfo} from "node:net";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {createUsernameAvailabilityRouter} from "../src/modules/user/usernameAvailability.routes";
import errorHandler from "../src/middleware/errorHandler";

test("availability endpoint normalizes, validates, and returns no account data",async()=>{
  let calls=0;
  let unavailable=false;
  const app=express();app.use(express.json());
  app.use("/check",createUsernameAvailabilityRouter((()=>({rpc:async(name:string,args:{p_username:string})=>{
    calls++;assert.equal(name,"bantai_username_available");
    return unavailable ? {data:null,error:new Error("private database detail")} : {data:args.p_username!=="member1",error:null};
  }})) as never));
  app.use(errorHandler);
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const post=(username:string)=>fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/check`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username})});
  try{
    const taken=await post(" Member1 ");assert.equal(taken.status,200);assert.deepEqual(await taken.json(),{available:false});assert.equal(taken.headers.get("cache-control"),"no-store");
    assert.deepEqual(await (await post("Unused1")).json(),{available:true});
    assert.equal((await post("bad")).status,400);assert.equal(calls,2);
    unavailable=true;const failed=await post("Unused2");assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private database/);unavailable=false;
    for(let i=0;i<35;i++){const response=await post("Member1");assert.equal(response.status,200);}
  }finally{server.close();}
});

test("SQL availability uses the existing unique B-tree and leaves atomic uniqueness authoritative",async()=>{
  const db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create schema bantai_private;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
    for(const file of ["202611170006_account_usernames.sql","202611180009_username_availability.sql"]) await db.exec(await readFile(new URL("../../supabase/migrations/"+file,import.meta.url),"utf8"));
    await db.exec("insert into auth.users select md5(i::text)::uuid,'test@example.test' from generate_series(1,10000)i;insert into bantai_private.account_usernames select md5(i::text)::uuid,'member'||lpad(i::text,5,'0') from generate_series(1,10000)i;analyze bantai_private.account_usernames;");
    const available=async(value:string)=>(await db.query<{v:boolean}>("select public.bantai_username_available($1) as v",[value])).rows[0].v;
    assert.equal(await available(" MEMBER00001 "),false);assert.equal(await available("unused1"),true);await assert.rejects(available("bad"));
    const plan=await db.query("explain (format json) select 1 from bantai_private.account_usernames where username='member00001'");
    assert.match(JSON.stringify(plan.rows),/Index (Only )?Scan/);
    const indexes=await db.query("select indexdef from pg_indexes where schemaname='bantai_private' and tablename='account_usernames'");
    assert.match(JSON.stringify(indexes.rows),/UNIQUE INDEX.*USING btree.*username/);
    // A successful check never reserves the name; two claims still cannot succeed.
    await db.exec("insert into auth.users values(gen_random_uuid(),'new@example.test');insert into bantai_private.account_usernames select id,'unused1' from auth.users where email='new@example.test'");
    assert.equal(await available("unused1"),false);
    await db.exec("insert into auth.users values('00000000-0000-4000-8000-000000000099','racing@example.test')");
    await assert.rejects(db.exec("insert into bantai_private.account_usernames values('00000000-0000-4000-8000-000000000099','unused1')"), /account_usernames_username_key/);
    await db.exec("set role anon");await assert.rejects(available("unused1"));await db.exec("reset role");
  }finally{await db.close();}
});
