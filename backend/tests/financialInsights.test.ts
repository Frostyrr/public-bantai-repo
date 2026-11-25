import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateInsights } from "../src/modules/finances/financialInsights";

const budget = (spent: number, status = "active") => ({
  id: "budget-1", name: "Events", status, spent_centavos: spent, allocated_amount_centavos: 10000,
});
const evaluate = (reserve: number, budgets = [budget(0)]) =>
  evaluateInsights("org", reserve, budgets, "2026-11-14T00:00:00Z").map(item => item.type);

test("reserve and approved spending use exact thresholds", () => {
  assert.deepEqual(evaluate(0, [budget(7999)]), []);
  assert.deepEqual(evaluate(0, [budget(8000)]), ["budget_nearing_limit"]);
  assert.deepEqual(evaluate(0, [budget(10000)]), ["budget_nearing_limit"]);
  assert.deepEqual(evaluate(-1, [budget(10001), budget(10001)]), ["negative_reserve", "budget_exceeded"]);
  assert.deepEqual(evaluate(0, [budget(20000, "rejected"), { ...budget(20000), archived_at: "2026-11-14" }]), []);
});
