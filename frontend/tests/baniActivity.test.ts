import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeToolActivityStep,
  finishActivitySteps,
  formatActivityStep,
  formatToolActivity,
  startActivityStep,
  toolResultFailed,
  type BaniActivityStep,
} from "../src/components/ai/baniActivity";

test("formats context-aware activity messages for real Bani tools and details", () => {
  assert.equal(
    formatToolActivity("get_treasury_summary", "CS Guild"),
    "Preparing treasury summary for CS Guild…",
  );
  assert.equal(
    formatToolActivity("list_expenses", "CS Guild", "pending · food"),
    "Retrieving pending · food expense records…",
  );
  assert.equal(
    formatToolActivity("list_collections_campaigns", "CS Guild", "active"),
    "Checking collection balances (active)…",
  );
  assert.equal(
    formatToolActivity("list_budgets_and_burn_rate", "CS Guild"),
    "Calculating budget utilization…",
  );
  assert.equal(
    formatToolActivity("navigate_to", "CS Guild", "budgets"),
    "Resolving budgets destination…",
  );
});

test("tracks activity step transitions through completion, failure, and cancellation", () => {
  let steps: BaniActivityStep[] = [];
  steps = startActivityStep(steps, { id: "1", kind: "preparing" });
  assert.equal(steps[0].status, "active");
  assert.equal(formatActivityStep(steps[0], "CS Guild"), "Connecting to CS Guild…");

  steps = startActivityStep(steps, { id: "2", kind: "understanding" });
  assert.equal(steps[0].status, "completed");
  assert.equal(steps[1].status, "active");

  steps = startActivityStep(steps, { id: "3", kind: "tool", tool: "list_expenses", detail: "pending" });
  assert.equal(steps[1].status, "completed");
  assert.equal(steps[2].status, "active");

  // Tool returns an error payload
  assert.equal(toolResultFailed({ error: "Unavailable" }), true);
  steps = completeToolActivityStep(steps, "list_expenses", true);
  assert.equal(steps[2].status, "failed");

  // Cancellation settles any active step cleanly
  steps = startActivityStep(steps, { id: "4", kind: "composing" });
  steps = finishActivitySteps(steps, "cancelled");
  assert.equal(steps[3].status, "cancelled");
});
