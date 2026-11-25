import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("demo exemptions are scoped, expire, and audit updates", async () => {
 const db = new PGlite();
 try {
     await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await db.exec(await readFile(new URL("./fixtures/supabase-session-auth.sql", import.meta.url), "utf8"));
    const dir = new URL("../../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }

 const admin="00000000-0000-4000-8000-000000000004";
 const member="00000000-0000-4000-8000-000000000005";
 await db.query("insert into auth.users(id,email) values ($1,'sa@example.test'),($2,'regular@example.test')",[admin,member]);
 await db.exec("set app.allow_platform_role_change='true'");
 await db.query("update public.profiles set role='super_admin' where id=$1",[admin]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 const val=async(sql:string,params:unknown[]=[]) => (await db.query<{v:any}>(sql,params)).rows[0].v;
 await assert.rejects(val("select public.set_platform_demo_exemption(true,true,121,'Demo') as v"));
 const saved=await val("select public.set_platform_demo_exemption(true,true,30,'Local demo') as v");
 assert.equal(saved.ip_restriction,true);
 assert.notEqual(await val("select public.bantai_demo_ip_exempt($1,'aal2') as v",[member]),true);
 await db.exec("set role authenticated");
 await assert.rejects(db.exec("select * from bantai_private.demo_exemptions"));
 await db.exec("reset role");
 assert.equal(await val("select count(*)::int as v from public.audit_logs where action='platform_demo_exemption_updated'"),1);
 await db.query("update public.profiles set locked_until=now()+interval '5 minutes' where id=$1",[admin]);
 assert.equal(await val("select locked_until is null as v from public.profiles where id=$1",[admin]),true);
 await db.query("update public.profiles set locked_until=now()+interval '5 minutes' where id=$1",[member]);
 assert.equal(await val("select locked_until>now() as v from public.profiles where id=$1",[member]),true);
 await db.query("update bantai_private.demo_exemptions set expires_at=now()-interval '1 second' where user_id=$1",[admin]);
 await db.query("update public.profiles set locked_until=now()+interval '5 minutes' where id=$1",[admin]);
 assert.equal(await val("select locked_until>now() as v from public.profiles where id=$1",[admin]),true);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[member]);
 await assert.rejects(val("select public.set_platform_demo_exemption(true,true,30,'Demo') as v"));
 } finally { await db.close(); }
});
