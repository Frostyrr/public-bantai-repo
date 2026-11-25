import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolResultCard } from "../src/components/ai/FinancialCards";
import { formatExpenseAmount, mapExpenseToolResult } from "../src/components/ai/expenseToolResult";

const row = (id: string, amount: string, currency = "PHP") => ({
  id, title: `Synthetic expense ${id}`, amount, currency, status: "approved",
});
const fixture = [row("1", "1700.00"), row("2", "125.00"), row("3", "1.00"), row("4", "1.01")];

function render(result: unknown) {
  return renderToStaticMarkup(createElement(ToolResultCard, { toolName: "list_expenses", result }));
}

test("expense card summarizes the returned array using exact minor units", () => {
  const mapped = mapExpenseToolResult(fixture);
  assert.equal(mapped.kind, "records");
  assert.deepEqual(mapped.subtotal, { currency: "PHP", centavos: 182701n });
  const markup = render(fixture);
  assert.match(markup, /4 expenses returned/);
  assert.ok(markup.includes(formatExpenseAmount(182701n, "PHP")));
  assert.match(markup, /Show 1 More/);
});

test("empty and malformed results are distinct and show no fabricated zero", () => {
  assert.match(render([]), /No expenses matched this query/);
  for (const result of [null, { count: 4, total_amount: 0 }, [row("1", "1.001")], { error: "Unavailable" }]) {
    const markup = render(result);
    assert.match(markup, /Expense results are unavailable/);
    assert.doesNotMatch(markup, /PHP 0|expenses returned/);
  }
});

test("partial, duplicate, and mixed-currency rows withhold the subtotal", () => {
  for (const result of [[fixture[0], null], [fixture[0], fixture[0]], [fixture[0], row("eur", "1.00", "EUR")]]) {
    const mapped = mapExpenseToolResult(result);
    assert.equal(mapped.kind, "records");
    assert.equal(mapped.subtotal, null);
    assert.match(render(result), /Subtotal unavailable/);
  }
  assert.match(render([fixture[0], null]), /incomplete results/);
  assert.ok(render([fixture[0], row("eur", "1.00", "EUR")]).includes(formatExpenseAmount(100n, "EUR")));
});
