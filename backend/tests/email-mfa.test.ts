import { createHash, randomBytes } from "node:crypto";
import { openMfaAddress, openMfaAddressWithPreviousKey, sealMfaAddress } from "../src/modules/user/emailMfaAddress";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const user = "00000000-0000-4000-8000-000000000001";
const first = "00000000-0000-4000-8000-000000000002";
const second = "00000000-0000-4000-8000-000000000003";
const trusted = "00000000-0000-4000-8000-000000000004";
const inbox = "enrolled@example.test";
const key = randomBytes(32);
const envelope = sealMfaAddress(key, user, inbox);
const addressHash = createHash("sha256").update(inbox).digest("hex");
const untrusted = "00000000-0000-4000-8000-000000000005";

test("email MFA enforces proof across Express, PostgREST and Storage", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema bantai_private; create schema bantai_gateway;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create table auth.sessions(id uuid primary key, user_id uuid, factor_id uuid);
      create table auth.mfa_factors(id uuid primary key, user_id uuid, factor_type text, status text);
      create function auth.jwt() returns jsonb language sql stable
        as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
      create function bantai_private.session_decision(target_session uuid, target_user uuid)
        returns text language sql stable as $$
          select case when exists(select 1 from auth.sessions where id = target_session and user_id = target_user)
          then 'active' else 'revoked' end
        $$;
      create function public.bantai_check_session(p_session uuid, p_user uuid, p_activity boolean)
        returns text language sql as $$ select bantai_private.session_decision(p_session, p_user) $$;
      create function public.bantai_check_verified_session(p_session uuid, p_user uuid, p_activity boolean)
        returns jsonb language sql as $$ select jsonb_build_object('decision', bantai_private.session_decision(p_session, p_user)) $$;
      insert into auth.users values ('${user}', 'enrolled@example.test', now());
      insert into auth.sessions values ('${first}', '${user}', null), ('${second}', '${user}', null);
      insert into auth.mfa_factors values ('${trusted}', '${user}', 'totp', 'verified');
    `);
    for (const name of ["202611170003_enforce_opt_in_mfa.sql", "202611170008_email_mfa.sql", "202611170016_encrypt_mfa_contact.sql"]) {
      await db.exec(await readFile(new URL("../../supabase/migrations/" + name, import.meta.url), "utf8"));
    }

    async function value(sql: string, params: unknown[] = []) {
      return (await db.query<{ result: unknown }>(sql, params)).rows[0]?.result;
    }
    const disable = (session: string, aal: string) =>
      value("select public.bantai_disable_email_mfa($1,$2,$3) as result", [user, session, aal]);
    const issue = (session: string, digest: string, enroll = false, aal = "aal1") =>
      value("select public.bantai_issue_email_mfa($1,$2,$3,$4,$5,$6,$7) as result", [user, session, digest, enroll, aal, enroll ? envelope : null, enroll ? addressHash : null]);
    const verify = (session: string, digest: string, enroll = false, aal = "aal1") =>
      value("select public.bantai_verify_email_mfa($1,$2,$3,$4,$5,$6,$7) as result", [user, session, digest, enroll, aal, enroll ? envelope : null, enroll ? addressHash : null]);
    const gate = (session: string, aal = "aal1") =>
      value("select public.bantai_check_session($1,$2,false,$3) as result", [session, user, aal]);
    const claims = (session: string, aal = "aal1") =>
      db.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify({ sub: user, session_id: session, aal, role: "authenticated" }),
      ]);
    const storage = () => value("select public.bantai_storage_session_allowed() as result");

    await db.query("update auth.sessions set factor_id=$1 where id=$2", [trusted, first]);
    // Existing TOTP permits enrollment. Only that verified factor is trusted.
    assert.equal(await gate(first, "aal2"), "active");
    assert.equal(await issue(first, "enroll", true), null);
    assert.equal(await issue(first, "enroll", true, "aal2"), envelope);
    assert.equal(await verify(first, "enroll"), false);
    assert.equal(await verify(first, "enroll", true, "aal2"), true);
    const stored = await value("select enrolled_email_ciphertext as result from bantai_private.email_mfa");
    assert.equal(stored, envelope);
    assert.equal(openMfaAddress(key, user, String(stored)), inbox);
    assert.equal(await verify(first, "enroll", true, "aal2"), false);
    await db.exec("update bantai_private.email_mfa set sent_at=null, send_times='{}'");
    // The session that enrolled email already has a proof. Use a new
    // session association to exercise the trusted native factor by itself.
    await db.exec("delete from bantai_private.email_mfa_proofs");
    assert.equal(await gate(first, "aal2"), "active");
    await db.query("insert into auth.mfa_factors values ($1,$2,'totp','verified')", [untrusted, user]);
    await db.query("update auth.sessions set factor_id=$1 where id=$2", [untrusted, second]);
    assert.equal(await gate(second, "aal2"), "mfa_required");
    assert.equal(await disable(second, "aal2"), false);
    await claims(second, "aal2");
    await assert.rejects(db.exec("select bantai_gateway.check_session()"), /mfa_required/);
    assert.equal(await storage(), false);

    await db.exec("set role authenticated");
    await assert.rejects(issue(second, "first"), /permission denied/);
    await assert.rejects(verify(second, "first"), /permission denied/);
    await db.exec("reset role");

    const simultaneous = await Promise.all([issue(second, "first"), issue(second, "duplicate")]);
    assert.deepEqual(simultaneous, [envelope, null]);
    assert.equal(await issue(second, "cooldown"), null);
    assert.equal(await verify(first, "first"), false);
    await db.exec("update bantai_private.email_mfa set expires_at = now() - interval '1 second'");
    assert.equal(await verify(second, "first"), false);

    const clearCooldown = () => db.exec("update bantai_private.email_mfa set sent_at = now() - interval '61 seconds'");
    await clearCooldown();
    assert.equal(await issue(second, "second"), envelope);
    for (let attempt = 0; attempt < 3; attempt++) assert.equal(await verify(second, "wrong"), false);
    assert.equal(await verify(second, "second"), false);

    await clearCooldown();
    assert.equal(await issue(second, "third"), envelope);
    await clearCooldown();
    await db.query("update auth.users set email='changed@example.test' where id=$1", [user]);
    assert.equal(await issue(second, "fourth"), envelope);
    await clearCooldown();
    assert.equal(await issue(second, "rate-limited"), null);
    assert.equal(await verify(second, "third"), false);
    assert.equal(await verify(second, "fourth"), true);
    assert.equal(await verify(second, "fourth"), false);

    await claims(second);
    assert.equal(await gate(second), "active");
    assert.deepEqual(
      await value("select public.bantai_check_verified_session($1,$2,false,'aal1') as result", [second, user]),
      { decision: "active" },
    );
    await db.exec("select bantai_gateway.check_session()");
    assert.equal(await storage(), true);
    assert.equal(await gate(first), "mfa_required");

    assert.equal(await disable(second, "aal1"), true);
    assert.equal(await gate(second), "mfa_required");
    assert.equal(await gate(first, "aal2"), "active");
  } finally {
    await db.close();
  }
});


test("encrypted MFA inbox uses random nonces, account binding, and authenticated ciphertext", () => {
  assert.notEqual(sealMfaAddress(key, user, inbox), envelope);
  const nextKey = randomBytes(32);
  assert.equal(openMfaAddressWithPreviousKey(nextKey, key, user, envelope), inbox);
  assert.equal(openMfaAddressWithPreviousKey(nextKey, key, user, sealMfaAddress(nextKey, user, inbox)), inbox);
  assert.throws(() => openMfaAddressWithPreviousKey(nextKey, key, first, envelope));
  assert.throws(() => sealMfaAddress(Buffer.alloc(31), user, inbox));
  assert.throws(() => openMfaAddress(key, first, envelope));
  assert.throws(() => openMfaAddress(randomBytes(32), user, envelope));
  const [version, nonce, tag, payload] = envelope.split(".");
  const corrupted = Buffer.from(payload, "base64url");
  corrupted[0] ^= 1;
  assert.throws(() => openMfaAddress(key, user, [version, nonce, tag, corrupted.toString("base64url")].join(".")));
});
