import { test } from "node:test";
import assert from "node:assert/strict";
import { sendSecurityAlert } from "../../supabase/scripts/security-alert-worker.mjs";

test("security alerts retry explicit rate limits but stop on ambiguous delivery", async () => {
  for (const [status, expected] of [[201, "sent"], [429, "retry"], [400, "failed"],
    [401, "failed"], [503, "unconfirmed"], [408, "unconfirmed"]] as const) {
    assert.equal(await sendSecurityAlert(async () => new Response(null, { status }), {}), expected);
  }
  assert.equal(await sendSecurityAlert(async () => { throw new Error("timed out"); }, {}), "unconfirmed");
});
