import assert from "node:assert/strict";
import { test } from "node:test";
import { computeActiveTurnMinHeight, isAwayFromBottom } from "../src/components/ai/baniScroll";

test("isAwayFromBottom detects content below viewport and clears near bottom", () => {
  assert.equal(isAwayFromBottom(1200, 700, 450), true);
  assert.equal(isAwayFromBottom(1200, 720, 450), false);
  assert.equal(isAwayFromBottom(450, 0, 450), false);
});

test("computeActiveTurnMinHeight reserves space only during generation so short replies leave no trailing gap", () => {
  assert.equal(computeActiveTurnMinHeight(true, 640), 608);
  assert.equal(computeActiveTurnMinHeight(true, 180), 200);
  // Once generation completes or stops, no artificial blank space remains.
  assert.equal(computeActiveTurnMinHeight(false, 640), undefined);
});
