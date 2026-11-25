import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPassword } from "../../frontend/src/lib/passwordPolicy";

test("password policy checks bounds, bcrypt input size, and basic strength", () => {
  assert.equal(assessPassword("Ab#1234").strength, "Weak");
  assert.equal(assessPassword("Ab#12345").strength, "Medium");
  assert.equal(assessPassword("password123!").strength, "Weak");
  assert.equal(assessPassword("lilac mantle green harbor").strength, "Strong");
  assert.equal(assessPassword("Ab1!" + "x".repeat(61)).error, "Use 8 to 64 characters.");
  assert.equal(assessPassword("Áé1!" + "😀".repeat(19)).error, "Use at most 72 UTF-8 bytes.");
});
