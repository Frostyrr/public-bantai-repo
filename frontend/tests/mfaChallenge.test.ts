import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { initialMfaMethod, requestEmailChallenge } from "../src/lib/mfaChallenge";

test("both methods require selection; single methods go directly to verification", () => {
  assert.equal(initialMfaMethod(true, true), null);
  assert.equal(initialMfaMethod(true, false), "totp");
  assert.equal(initialMfaMethod(false, true), "email");
  assert.equal(initialMfaMethod(false, false), null);
});

test("rapid selection and remount share a send; switching reuses the live code and cooldown", async () => {
  const client = new QueryClient();
  let now = 1000;
  let calls = 0;
  let release!: () => void;
  const send = () => { calls++; return new Promise<void>(resolve => { release = resolve; }); };
  const request = (session = "session-1", resend = false) => requestEmailChallenge(client, session, send, String, resend, () => now);
  try {
    const first = request();
    const mountedAgain = request();
    const clickedAgain = request();
    assert.equal(calls, 1);
    release();
    const issued = await first;
    assert.deepEqual(await mountedAgain, issued);
    assert.deepEqual(await clickedAgain, issued);
    assert.deepEqual(await request("session-1", true), issued);
    now += 61_000;
    assert.deepEqual(await request(), issued); // Switch back after cooldown, before expiry.
    assert.equal(calls, 1);
    const resend = request("session-1", true);
    assert.equal(calls, 2);
    release();
    await resend;
    now += 301_000;
    const expiredSelection = request();
    assert.equal(calls, 3);
    release();
    await expiredSelection;
    const newSession = request("session-2");
    assert.equal(calls, 4);
    release();
    await newSession;
  } finally { client.clear(); }
});

test("uncertain delivery failure retains cooldown across remount and permits deliberate retry later", async () => {
  const client = new QueryClient();
  let now = 1000;
  let calls = 0;
  const send = async () => { calls++; throw new Error("Delivery unavailable"); };
  const request = () => requestEmailChallenge(client, "session-1", send, error => (error as Error).message, true, () => now);
  try {
    const failed = await request();
    assert.equal(failed.sent, false);
    assert.equal(failed.error, "Delivery unavailable");
    assert.deepEqual(await request(), failed);
    assert.equal(calls, 1);
    now += 61_000;
    await request();
    assert.equal(calls, 2);
  } finally { client.clear(); }
});
