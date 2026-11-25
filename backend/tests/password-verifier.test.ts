import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword, rejectReusedPassword } from "../src/modules/user/passwordVerifier";
test("password verifiers have independent salts and exact password semantics", async () => {
  const first = await hashPassword(" Example password1! "), second = await hashPassword(" Example password1! ");
  assert.notEqual(first, second);
  assert.ok(!first.includes("Example"));
  assert.equal(await verifyPassword(" Example password1! ", first), true);
  assert.equal(await verifyPassword("Example password1!", first), false);
  assert.equal(await verifyPassword(" example password1! ", first), false);
});
test("rejects current plus three retired passwords and allows the older fifth password", async () => {
  const values = ["PasswordZero!9", "PasswordOne!9", "PasswordTwo!9", "PasswordThree!9", "PasswordFour!9"];
  const verifiers = await Promise.all(values.slice(1).map(hashPassword));
  for (const password of values.slice(1))
    assert.equal(await rejectReusedPassword(password, verifiers, 4, 4), true);
  assert.equal(await rejectReusedPassword(values[0], verifiers, 4, 4), false);
});
test("bootstrap has no invented history; corrupt or unavailable history fails closed", async () => {
  assert.equal(await rejectReusedPassword("New password 1!", [], 0, 0), false);
  for (const [verifiers, version, tracked] of [[null, 0, 0], [[], 1, 0], [[], 0, 1], [["invalid"], 1, 1], [[], undefined, 0], [[], 0, NaN]] as const) {
    await assert.rejects(rejectReusedPassword("candidate", verifiers, version as number, tracked));
  }
});
