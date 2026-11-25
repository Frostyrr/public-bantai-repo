import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDirectoryColumns, recommendedDirectoryColumns } from "../../frontend/src/utils/directoryColumns";

const available = ["identifier", "groups", "status", "custom:student_id", "custom:college",
  "custom:program", "custom:year_level", "custom:section", "custom:employee_id", "custom:department",
  "custom:job_title", "custom:membership_id", "custom:membership_type", "custom:chapter",
  "custom:member_id", "custom:team", "custom:role"];

test("directory recommendations use stable keys in the requested order", () => {
  assert.deepEqual(recommendedDirectoryColumns("student", available),
    ["custom:student_id", "custom:program", "custom:year_level", "custom:section", "status"]);
  assert.deepEqual(recommendedDirectoryColumns("workplace", available),
    ["custom:employee_id", "custom:department", "custom:job_title", "status"]);
  assert.deepEqual(recommendedDirectoryColumns("club", available),
    ["custom:membership_id", "custom:membership_type", "custom:chapter", "status"]);
  assert.deepEqual(recommendedDirectoryColumns("nonprofit", available),
    ["custom:member_id", "custom:team", "custom:role", "status"]);
  for (const type of [null, "other", "unsupported"]) {
    assert.deepEqual(recommendedDirectoryColumns(type, available), ["identifier", "groups", "status"]);
  }
});
test("asynchronous loading never resolves or persists a premature generic layout", () => {
  assert.equal(resolveDirectoryColumns(undefined, available, null), null);
  assert.equal(resolveDirectoryColumns("student", undefined, null), null);
  assert.deepEqual(resolveDirectoryColumns("student", available, null), recommendedDirectoryColumns("student", available));
});
test("saved preferences override type changes while archived fields are omitted", () => {
  const preference = { version: 1, keys: ["custom:college", "custom:program", "status"] };
  assert.deepEqual(resolveDirectoryColumns("workplace", available, preference), preference.keys);
  assert.deepEqual(resolveDirectoryColumns("student", available.filter(key => key !== "custom:college"), preference),
    ["custom:program", "status"]);
  assert.deepEqual(resolveDirectoryColumns("student", available, preference), preference.keys);
  assert.deepEqual(resolveDirectoryColumns("student", ["status"], null), ["status"]);
});
test("legacy preferences remain usable and invalid defaults do not hide recommendations", () => {
  assert.deepEqual(resolveDirectoryColumns("student", available, ["groups"]), ["groups"]);
  for (const preference of [[], ["invalid"], ["groups", 42], {}]) {
    assert.deepEqual(resolveDirectoryColumns("student", available, preference), recommendedDirectoryColumns("student", available));
  }
  assert.deepEqual(resolveDirectoryColumns("student", available, { version: 1, keys: [] }), []);
});
