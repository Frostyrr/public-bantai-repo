import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  checkAnswer,
  hashAnswer,
  normalizeAnswer,
} from "../src/modules/user/securityQuestionAnswers";

test("recovery answer hashing normalizes predictably and uses independent salts", async () => {
  assert.equal(normalizeAnswer("  Ms.   SANTOS  "), "ms. santos");
  const [first, second] = await Promise.all([
    hashAnswer("Ms. Santos"),
    hashAnswer("Ms. Santos"),
  ]);
  assert.notEqual(first, second);
  assert.equal(await checkAnswer("  MS.  santos ", first), true);
  assert.equal(await checkAnswer("Ms Santos", first), false);
  assert.equal(await checkAnswer("Ms. Santos", "bad-envelope"), false);
});

test("questions protect the native password write and bind proofs to sessions and revisions", async (t) => {
  const db = new PGlite();
  const user = "00000000-0000-4000-8000-000000000001",
    first = "00000000-0000-4000-8000-000000000002",
    second = "00000000-0000-4000-8000-000000000003";
  const call = async (action: string, data: object = {}, session = first) => {
    const result = await db.query<{ result: Record<string, unknown> }>(
      "select public.bantai_sq_action($1,$2,'aal1',$3,$4::jsonb) result",
      [user, session, action, JSON.stringify(data)],
    );
    return result.rows[0].result;
  };
  const fresh = async () => {
    await db.exec(
      "update bantai_private.security_question_challenges set sent_at=now()-interval '2 minutes'",
    );
    await call("send", { digest: "fresh" });
    assert.equal((await call("confirm", { digest: "fresh" })).ok, true);
  };
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
    await t.test(
      "fresh OTP is required for three distinct questions",
      async () => {
        await assert.rejects(
          call("save", { questions: [1, 2, 3], answers: ["a", "b", "c"] }),
        );
        await fresh();
        await assert.rejects(
          call("save", { questions: [1, 1, 3], answers: ["a", "b", "c"] }),
        );
        await call("save", { questions: [1, 2, 3], answers: ["a", "b", "c"] });
        assert.deepEqual(await call("status"), {
          enabled: true,
          questions: [1, 2, 3],
        });
      },
    );
    await t.test(
      "native password API and user metadata cannot skip questions",
      async () => {
        await assert.rejects(
          db.exec(
            `update auth.users set encrypted_password='bypass',raw_user_meta_data='{"bantai_sq_ticket":"guess"}' where id='${user}'`,
          ),
        );
        assert.equal(
          (
            await db.query<{ encrypted_password: string }>(
              "select encrypted_password from auth.users",
            )
          ).rows[0].encrypted_password,
          "original",
        );
        await assert.rejects(call("ticket", { digest: "guess" }));
      },
    );
    await t.test(
      "answer attempt limits span sessions and survive page reloads",
      async () => {
        for (let i = 0; i < 5; i++)
          assert.equal(
            (await call("attempt", {}, i % 2 ? second : first)).enabled,
            true,
          );
        assert.equal((await call("attempt", {}, second)).limited, true);
        await db.exec(
          "update bantai_private.security_questions set window_at=now()-interval '16 minutes'",
        );
        assert.equal((await call("attempt")).enabled, true);
      },
    );
    await t.test(
      "proofs expire, cannot cross sessions, and cannot be reused",
      async () => {
        const attempt = await call("attempt");
        await call("prove", { revision: attempt.revision });
        await assert.rejects(
          call("ticket", { digest: "wrong-session" }, second),
        );
        await db.exec(
          "update bantai_private.security_question_proofs set expires_at=now()-interval '1 second'",
        );
        await assert.rejects(call("ticket", { digest: "expired" }));
        await call("prove", { revision: attempt.revision });
        await call("ticket", { digest: "valid" });
        await assert.rejects(call("ticket", { digest: "reuse" }));
      },
    );
    await t.test(
      "deferred check supports GoTrue password-then-app-metadata transaction order",
      async () => {
        const attempt = await call("attempt");
        await call("prove", { revision: attempt.revision });
        await call("ticket", { digest: "placeholder" });
        await db.exec(
          "update bantai_private.security_question_password_tickets set digest=md5('trusted-ticket')",
        );
        await db.exec(`begin;update auth.users set encrypted_password='changed' where id='${user}';
        update auth.users set raw_app_meta_data='{"provider":"email","bantai_sq_ticket":"trusted-ticket"}' where id='${user}';commit;`);
        const row = (
          await db.query<{ raw_app_meta_data: object }>(
            "select raw_app_meta_data from auth.users",
          )
        ).rows[0];
        assert.deepEqual(row.raw_app_meta_data, { provider: "email" });
        await assert.rejects(
          db.exec(
            `update auth.users set encrypted_password='reuse' where id='${user}'`,
          ),
        );
      },
    );
    await t.test(
      "replacement invalidates recovery proofs; disabling requires new OTP",
      async () => {
        await fresh();
        await call("save", { questions: [4, 5, 6], answers: ["d", "e", "f"] });
        await assert.rejects(call("ticket", { digest: "old-proof" }));
        await assert.rejects(call("disable"));
        await fresh();
        await call("disable");
        assert.deepEqual(await call("status"), {
          enabled: false,
          questions: [],
        });
        await db.exec(
          `update auth.users set encrypted_password='ordinary' where id='${user}'`,
        );
      },
    );
    await t.test(
      "authenticated and anonymous roles cannot call the private API",
      async () => {
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_function_privilege('authenticated','public.bantai_sq_action(uuid,uuid,text,text,jsonb)','execute') allowed",
            )
          ).rows[0].allowed,
          false,
        );
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_function_privilege('anon','public.bantai_sq_action(uuid,uuid,text,text,jsonb)','execute') allowed",
            )
          ).rows[0].allowed,
          false,
        );
      },
    );
    await t.test("native TOTP and revoked sessions remain enforced", async () => {
      await db.exec(`insert into auth.mfa_factors values('${user}','totp','verified')`);
      await assert.rejects(call("send", { digest: "blocked-before-totp" }));
      const result = await db.query<{ result: { ok: boolean } }>(
        "select public.bantai_sq_action($1,$2,'aal2','send','{\"digest\":\"after-totp\"}') result",
        [user, first],
      );
      assert.equal(result.rows[0].result.ok, true);
      await db.exec("create or replace function bantai_private.session_decision(uuid,uuid) returns text language sql as $$select 'revoked'::text$$");
      await assert.rejects(call("status"));
    });
  } finally {
    await db.close();
  }
});
