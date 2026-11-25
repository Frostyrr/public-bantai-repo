import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {PGlite} from "@electric-sql/pglite";
test("question management accepts either proof, rejects OAuth and retains recovery TOTP",async()=>{
 const db=new PGlite();
 const user="00000000-0000-4000-8000-000000000001",first="00000000-0000-4000-8000-000000000002",second="00000000-0000-4000-8000-000000000003";
 try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create schema bantai_private;
      create table auth.users(id uuid primary key,encrypted_password text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
      create table auth.mfa_factors(user_id uuid,factor_type text,status text);
      create table public.notification_delivery_queue(recipient_user_id uuid,channel text,notification_type text,title text,message text,metadata jsonb);
      create function bantai_private.session_decision(uuid,uuid) returns text language sql as $$select 'active'::text$$;
      insert into auth.users(id,encrypted_password) values('${user}','original');
      insert into auth.sessions values('${first}','${user}'),('${second}','${user}');`);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/202611180002_recovery_security_questions.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
 await db.exec("create function bantai_private.mfa_allows(uuid,uuid,text) returns boolean language sql as $$select $3='aal2'$$");
 await db.exec(await readFile(new URL("../../supabase/migrations/202611180008_recovery_question_method_selection.sql",import.meta.url),"utf8"));
 const call=async(action:string,aal="aal1",data:object={})=>(await db.query<{v:any}>("select bantai_private.password_history_question_core($1,$2,$3,$4,$5::jsonb) as v",[user,first,aal,action,JSON.stringify(data)])).rows[0].v;
 await assert.rejects(call("send"));
 await db.query("update auth.users set raw_app_meta_data=$1::jsonb where id=$2",[JSON.stringify({provider:"email"}),user]);
 assert.equal((await call("status")).eligible,true);
 await db.query("insert into auth.mfa_factors values($1,'totp','verified')",[user]);
 await assert.rejects(call("authorize_totp"));
 await call("send","aal1",{digest:"email-proof"});
 assert.equal((await call("confirm","aal1",{digest:"email-proof"})).ok,true);
 await call("save","aal1",{questions:[1,2,3],answers:["a","b","c"]});
 await assert.rejects(call("disable"));
 await assert.rejects(call("attempt"));
 await call("authorize_totp","aal2");
 await call("disable","aal2");
 assert.equal((await call("status")).enabled,false);
 await db.query("update auth.users set raw_app_meta_data=$1::jsonb where id=$2",[JSON.stringify({provider:"google"}),user]);
 assert.equal((await call("status")).eligible,false);
 await assert.rejects(call("authorize_totp","aal2"));
 await assert.rejects(call("save","aal2",{questions:[1,2,3],answers:["a","b","c"]}));
 }finally{await db.close();}
});
