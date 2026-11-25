import assert from "node:assert/strict";
import { test } from "node:test";
import { createFormDraftStore } from "../src/hooks/useFormDraft";

test("draft cleanup targets the submitted snapshot and leaves other records alone", () => {
  const store = createFormDraftStore("account-a");
  const previousOwner = Symbol();
  const currentOwner = Symbol();
  store.write("org-a:budget:edit:one", { values: { amount: "12." }, version: "original", owner: previousOwner, change: 1 });
  store.write("org-a:budget:edit:one", { values: { amount: "12.5" }, version: "original", owner: currentOwner, change: 2 });
  store.write("org-b:budget:edit:one", { values: { amount: "8" }, version: "original", owner: previousOwner, change: 1 });

  store.remove("org-a:budget:edit:one", previousOwner);
  assert.equal(store.read("org-a:budget:edit:one")?.values.amount, "12.5");
  store.remove("org-a:budget:edit:one", currentOwner);
  assert.equal(store.read("org-a:budget:edit:one"), undefined);
  assert.equal(store.read("org-b:budget:edit:one")?.values.amount, "8");
});

test("ending the account session clears drafts and rejects late autosaves", () => {
  const store = createFormDraftStore("account-a");
  const draft = { values: { title: "Private draft" }, version: "", owner: Symbol(), change: 1 };
  store.write("org-a:expense:create", draft);
  assert.equal(createFormDraftStore("account-b").read("org-a:expense:create"), undefined);

  store.endSession();
  store.write("org-a:expense:create", draft);
  assert.equal(store.read("org-a:expense:create"), undefined);
});
