import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
test("managed password commit is atomic, fenced, and compatible with the question gate", async (t) => {
  const db = new PGlite();
  const user = "00000000-0000-4000-8000-000000000001", session = "00000000-0000-4000-8000-000000000002";
  const digest = (v: string) => createHash("md5").update(v).digest("hex");
  const call = async (action: string, data: object = {}) => (await db.query<{
    result: any;
  }>("select bantai_password_history($1,$2,'aal1',$3,$4::jsonb) result", [user, session, action, JSON.stringify(data)])).rows[0].result;
  let authorizationId = "";
  const issue = async () => { authorizationId = randomUUID(); await call("issue_reset", { id: authorizationId, digest: "proof" }); return { authorizationId, authorizationDigest: "proof" }; };
  const stage = async (candidate: string, version: number) => {
    const proof = await issue();
    const operationId = randomUUID(), marker = randomUUID();
    const state = await call("status");
    if (state.stale)
      await call("reconcile", proof);
    await call("stage", { ...proof, operationId, operationDigest: digest(marker), candidate, version, epoch: state.epoch, questionTicket: randomUUID() });
    return { ...proof, operationId, marker };
  };
  const write = async (marker: string, password: string) => db.query("update auth.users set encrypted_password=$1,raw_user_meta_data=jsonb_build_object('bantai_password_operation',$2::text) where id=$3", [password, marker, user]);
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema bantai_private;
   create table auth.users(id uuid primary key,encrypted_password text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
   create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));create table auth.mfa_factors(user_id uuid,status text,factor_type text);
   create table auth.mfa_amr_claims(session_id uuid,authentication_method text);
   create function bantai_private.session_decision(uuid,uuid) returns text language sql as $$select 'active'::text$$;
   create table notification_delivery_queue(recipient_user_id uuid,channel text,notification_type text,title text,message text,metadata jsonb);
   insert into auth.users(id,encrypted_password) values('${user}','original');insert into auth.sessions values('${session}','${user}');`);
    await db.exec(await readFile(new URL("../../supabase/migrations/202611180002_recovery_security_questions.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../supabase/migrations/202611180004_managed_password_history.sql", import.meta.url), "utf8"));
    await t.test("OTP-only sessions cannot seed an unverified current password",async()=>{
      const authorizationId=randomUUID();
      await call("send",{digest:"email-proof"});
      assert.equal((await call("confirm",{codeDigest:"email-proof",id:authorizationId,digest:"change-proof"})).ok,true);
      await assert.rejects(call("stage",{authorizationId,authorizationDigest:"change-proof",operationId:randomUUID(),operationDigest:"test",candidate:"candidate",seed:"unverified-current",version:0,epoch:0}));
      assert.equal((await call("status")).pending,false);
    });
    await t.test("bootstrap commits password and verifier together; clears operation secret", async () => {
      const op = await stage("verifier-1", 0);
      await write(op.marker, "password-1");
      assert.equal((await call("outcome", op)).status, "committed");
      const state = await call("status");
      assert.equal(state.version, 1);
      assert.equal(state.tracked, 1);
      assert.deepEqual((await db.query<{
        raw_user_meta_data: object;
      }>("select raw_user_meta_data from auth.users")).rows[0].raw_user_meta_data, {});
    });
    await t.test("only four verifiers retained after successive commits", async () => {
      for (let v = 1; v <= 4; v++) {
        const op = await stage(`verifier-${v + 1}`, v);
        await write(op.marker, `password-${v + 1}`);
      }
      assert.deepEqual((await db.query<{
        verifier: string;
      }>("select verifier from bantai_private.password_history order by version desc")).rows.map(r => r.verifier), ["verifier-5", "verifier-4", "verifier-3", "verifier-2"]);
    });
    await t.test("pending operations exclude concurrent managed stages and fence cancelled writes", async () => {
      const op = await stage("pending", 5);
      const another = await issue();
      await assert.rejects(call("stage", { ...another, operationId: randomUUID(), operationDigest: "x", candidate: "other", version: 5, epoch: (await call("status")).epoch }));
      assert.equal((await call("cancel", op)).status, "cancelled");
      await assert.rejects(write(op.marker, "late-commit"));
      assert.equal((await call("status")).version, 5);
    });
    await t.test("unmarked native maintenance remains outside the application policy", async () => {
      const op = await stage("pending-native", 5);
      await db.exec("update auth.users set encrypted_password='native-maintenance'");
      assert.equal((await call("status")).version, 5);
      await call("cancel", op);
    });
    await t.test("successful native write survives lost HTTP response; reconcile does not undo it", async () => {
      const op = await stage("verifier-6", 5);
      await write(op.marker, "password-6");
      const fresh = await issue();
      assert.equal((await call("cancel", { ...fresh, operationId: op.operationId })).status, "committed");
      assert.equal((await call("status")).version, 6);
    });
    await t.test("question proof gate remains mandatory and commits in the same transaction", async () => {
      await db.exec(`insert into bantai_private.security_questions(user_id,questions,answers) values('${user}',array[1,2,3],'["a","b","c"]')`);
      const proof = await issue();
      await assert.rejects(call("stage", { ...proof, operationId: randomUUID(), operationDigest: "x", candidate: "blocked", version: 6, epoch: (await call("status")).epoch, questionTicket: "x" }));
      const revision = (await db.query<{
        revision: string;
      }>("select revision from bantai_private.security_questions")).rows[0].revision;
      await db.query("insert into bantai_private.security_question_proofs(user_id,session_id,kind,revision) values($1,$2,'recovery',$3)", [user, session, revision]);
      const op = await stage("verifier-7", 6);
      await write(op.marker, "password-7");
      assert.equal((await call("status")).version, 7);
      assert.deepEqual((await db.query<{
        raw_app_meta_data: object;
      }>("select raw_app_meta_data from auth.users")).rows[0].raw_app_meta_data, {});
    });
    await t.test("expired operations roll back credentials and history", async () => {
      await db.exec("delete from bantai_private.security_questions");
      const op = await stage("expired", 7);
      await db.exec("update bantai_private.password_history_operations set expires_at=clock_timestamp()-interval '1 second' where status='pending'");
      await assert.rejects(write(op.marker, "expired-password"));
      assert.equal((await call("status")).version, 7);
      assert.equal((await call("cancel", op)).status, "cancelled");
    });
    await t.test("history persistence failure rolls back the native credential transaction", async () => {
      const op = await stage("failed-persistence", 7);
      await db.exec(`create function bantai_private.fail_history_insert() returns trigger language plpgsql as $$begin raise exception 'simulated persistence failure';end$$;
    create trigger fail_history_insert before insert on bantai_private.password_history for each row execute function bantai_private.fail_history_insert();`);
      await assert.rejects(write(op.marker, "should-not-commit"));
      assert.equal((await call("status")).version, 7);
      assert.equal((await call("outcome", op)).status, "pending");
      assert.equal((await db.query<{
        encrypted_password: string;
      }>("select encrypted_password from auth.users")).rows[0].encrypted_password, "password-7");
      await db.exec("drop trigger fail_history_insert on bantai_private.password_history");
      await call("cancel", op);
    });
    await t.test("fresh recovery revokes an old operation without reactivating its consumed grant", async () => {
      const op = await stage("cancel-with-recovery", 7), fresh = await issue();
      assert.equal((await call("cancel", fresh)).status, "cancelled");
      await assert.rejects(call("snapshot", op));
      await assert.rejects(write(op.marker, "late-recovered-password"));
      assert.deepEqual((await call("snapshot", fresh)).version, 7);
    });
    await t.test("session binding, proof expiry, TOTP and history versions cannot be bypassed", async () => {
      const proof = await issue();
      await assert.rejects(call("proof", { ...proof, authorizationDigest: "wrong" }));
      await db.exec("update bantai_private.password_history_authorizations set expires_at=clock_timestamp()-interval '1 second'");
      await assert.rejects(call("proof", proof));
      const fresh = await issue();
      await db.query("insert into auth.mfa_factors values($1,'verified','totp')", [user]);
      await assert.rejects(call("snapshot", fresh));
      await db.exec("delete from auth.mfa_factors");
      await assert.rejects(call("stage", { ...fresh, operationId: randomUUID(), operationDigest: "version", candidate: "stale", version: 6, questionTicket: "version" }));
      await db.query("update bantai_private.password_history_authorizations set session_id=$1 where id=$2", [randomUUID(), fresh.authorizationId]);
      await assert.rejects(call("proof", fresh));
    });
    await t.test("ordinary roles cannot mint proofs or read history", async () => {
      assert.equal((await db.query<{
        allowed: boolean;
      }>("select has_function_privilege('authenticated','public.bantai_password_history(uuid,uuid,text,text,jsonb)','execute') allowed")).rows[0].allowed, false);
      assert.equal((await db.query<{
        allowed: boolean;
      }>("select has_table_privilege('authenticated','bantai_private.password_history','select') allowed")).rows[0].allowed, false);
    });
    await t.test("external changes preserve history, require verified reconciliation and age out the recorded gap", async () => {
      const before = (await db.query("select version,verifier from bantai_private.password_history order by version")).rows;
      await db.exec("update auth.users set encrypted_password='external-credential'");
      const state = await call("status");
      assert.equal(state.stale, true);
      assert.equal(state.version, 7);
      assert.equal(state.coverageGap, 4);
      assert.deepEqual((await db.query("select version,verifier from bantai_private.password_history order by version")).rows, before);
      const proof = await issue(), operationId = randomUUID(), marker = randomUUID();
      const data = { ...proof, operationId, operationDigest: digest(marker), candidate: "reconciled-8", version: 7, epoch: state.epoch, questionTicket: randomUUID() };
      await assert.rejects(call("stage", data));
      assert.equal((await call("snapshot", proof)).verifiers.length, 4);
      await call("reconcile", proof);
      assert.deepEqual((await db.query("select version,verifier from bantai_private.password_history order by version")).rows, before);
      await call("stage", data);
      await write(marker, "reconciled-password-8");
      assert.equal((await call("status")).coverageGap, 3);
      assert.equal((await call("status")).stale, false);
      for (let version = 8; version < 11; version++) {
        const op = await stage(`reconciled-${version + 1}`, version);
        await write(op.marker, `reconciled-password-${version + 1}`);
      }
      assert.equal((await call("status")).coverageGap, 0);
      assert.equal((await call("status")).version, 11);
    });
    await t.test("external change after staging fences the old managed writer", async () => {
      const op = await stage("racing-external", 11);
      await db.exec("update auth.users set encrypted_password='new-external-credential'");
      await assert.rejects(write(op.marker, "late-managed-credential"));
      assert.equal((await call("status")).version, 11);
      assert.equal((await call("status")).stale, true);
      await call("cancel", op);
    });
  }
  finally {
    await db.close();
  }
});
