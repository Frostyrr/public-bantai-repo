import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BaniReplyContent from "../src/components/ai/BaniReplyContent";
import BaniDestinationCard from "../src/components/ai/BaniDestinationCard";
import { formatFinancialReply } from "../src/components/ai/formatFinancialReply";
import BaniMarkdown from "../src/components/ai/BaniMarkdown";

const record = "dddd4444-4444-4444-8444-444444444444";
const budgetTool = "list_budgets_and_burn_rate";
const budget = { id: record, name: "Logistics Budget", currency: "PHP", allocated_amount: "1000.00",
  spent_amount: "100.00", committed_amount: "0.00", remaining_budget: "900.00", burn_percent: 10 };
const envelope = (data: unknown, destination: string, label: string, records?: { destination: string; ids: string[] }) => ({
  kind: "financial_navigation", data, navigation: { page: { target: { destination }, label, immediate: false }, records },
});
const result = envelope([budget], "budgets", "Budgets", { destination: "budget", ids: [record] });

test("financial results render a page action and an accessible record button without exposing a UUID or URL", () => {
  let opens = 0;
  const markup = renderToStaticMarkup(createElement(BaniReplyContent, {
    organizationName: "Pilot Club", formatted: "Here’s how the budget is doing.",
    results: [{ tool: budgetTool, result }], openDestination: () => { opens++; },
  }));
  assert.match(markup, /<button[^>]+aria-label="Open Logistics Budget"/);
  assert.match(markup, /Open Budgets/);
  assert.match(markup, /900\.00/);
  assert.doesNotMatch(markup, /href=|dddd4444/);
  assert.equal(opens, 0);
});

test("only records included in server action metadata get buttons, and disabled clients show the financial data", () => {
  const noRecordAccess = envelope([budget], "budgets", "Budgets", { destination: "budget", ids: [] });
  const render = (data: unknown, openDestination?: () => void) =>
    renderToStaticMarkup(createElement(BaniReplyContent, { organizationName: "Pilot Club", formatted: "", results: [{ tool: budgetTool, result: data }], openDestination }));
  const limited = render(noRecordAccess, () => undefined);
  assert.match(limited, /Open Budgets/);
  assert.doesNotMatch(limited, /aria-label="Open Logistics Budget"/);
  const disabled = render(result);
  assert.match(disabled, /Logistics Budget/);
  assert.doesNotMatch(disabled, /Open Budgets|aria-label="Open Logistics Budget"/);
});

test("collection arrays show real records and actions and expenses show a page action", () => {
  const render = (toolName: string, data: unknown) =>
    renderToStaticMarkup(createElement(BaniReplyContent, { organizationName: "Pilot Club", formatted: "", results: [{ tool: toolName, result: data }], openDestination: () => undefined }));
  const campaign = { id: record, title: "Membership dues", currency: "PHP", collected_amount: "250.00", target_amount: "500.00", completion_percent: 50 };
  const collections = render("list_collections_campaigns", envelope([campaign], "collections", "Collections", {
    destination: "collection", ids: [record],
  }));
  assert.match(collections, /aria-label="Open Membership dues"/);
  assert.match(collections, /Open Collections/);
  assert.match(collections, /250\.00/);
  const expenses = render("list_expenses", envelope([{ id: record, title: "Paper", currency: "PHP", amount: "250.00", status: "approved" }], "expenses", "Expenses"));
  assert.match(expenses, /Open Expenses/);
  assert.match(expenses, /Paper/);
});

test("assistant rendering drops duplicate financial tables and internal IDs while preserving new analysis", () => {
  const tools = [{ tool: budgetTool, result }];
  const raw = [
    "Logistics has room for upcoming purchases.",
    "",
    "| Budget | Allocated | Spent | UUID |",
    "|---|---|---|---|",
    `| Logistics Budget | PHP 1,000.00 | PHP 100.00 | ${record} |`,
    "",
    "| Budget | Scenario forecast |",
    "|---|---|",
    "| Logistics Budget | PHP 650.00 |",
    "",
    "Reference: " + record,
  ].join("\n");
  const markup = renderToStaticMarkup(createElement(BaniMarkdown, { content: formatFinancialReply(raw, tools) }));
  assert.match(markup, /Logistics has room/);
  assert.match(markup, /Scenario forecast/);
  assert.equal(markup.match(/<table/g)?.length, 1);
  assert.doesNotMatch(markup, /dddd4444|Allocated/);
  assert.match(formatFinancialReply(raw, tools, "Show the budget UUID"), new RegExp(record));
});

test("Collections reply renders compact campaign facts and actions instead of duplicate tables and directions", () => {
  const campaign = {
    id: record, title: "Semester dues", currency: "PHP", collected_amount: "50.00", assessed_amount: "600.00",
    target_amount: "600.00", status: "active", completion_percent: 8, due_date: "2026-11-30",
  };
  const collections = envelope([campaign], "collections", "Collections", { destination: "collection", ids: [record] });
  const results = [{ tool: "list_collections_campaigns", result: collections }];
  const reply = [
    "Dues collection is at an early stage.",
    "",
    "| Collection | Total collected | Assessed amount | Status | Due date |",
    "|---|---|---|---|---|",
    "| Semester dues | PHP 50.00 | PHP 600.00 | Active | 2026-11-30 |",
    "",
    "I can't navigate the UI for you.",
    "To view the details, go to **Collections & Dues** in the left sidebar.",
    "",
    "Review how much is due before changing the collection goal.",
  ].join("\n");
  const markup = renderToStaticMarkup(createElement(BaniReplyContent, {
    organizationName: "Pilot Club", formatted: formatFinancialReply(reply, results, "", true),
    results, openDestination: () => assert.fail("Rendering must not navigate"),
  }));
  assert.match(markup, /Open Semester dues/);
  assert.match(markup, /Open Collections/);
  assert.match(markup, /Assessed: PHP 600\.00/);
  const prose = renderToStaticMarkup(createElement(BaniMarkdown, { content: formatFinancialReply(reply, results, "", true) }));
  assert.match(prose, /Dues collection is at an early stage/);
  assert.match(prose, /Review how much is due/);
  assert.doesNotMatch(prose, /<table|can.t navigate|left sidebar/);
  const disabled = formatFinancialReply(reply, results, "", false);
  assert.match(disabled, /left sidebar/);
});

test("personal dues show amounts and link to the parent collection only when it is eligible", () => {
  const rows = [{ obligation_id: "obligation", collection_id: record, collection_title: "Membership dues",
    currency: "PHP", amount_due: "500.00", paid_amount: "250.00", remaining_balance: "250.00", status: "pending" }];
  const render = (ids: string[]) => renderToStaticMarkup(createElement(BaniReplyContent, {
    organizationName: "Pilot Club", formatted: "", results: [{ tool: "get_member_obligations", result: envelope(rows, "contributions", "My Contributions", { destination: "collection", ids }) }],
    openDestination: () => assert.fail("Rendering must not navigate"),
  }));
  assert.match(render([record]), /Open Membership dues/);
  assert.match(render([record]), /Open My Contributions/);
  assert.match(render([record]), /Remaining: PHP 250\.00/);
  assert.doesNotMatch(render([]), /Open Membership dues/);
});

test("reply shows conversation and financial facts before one destination card per target", () => {
  const tools = [
    { tool: budgetTool, result },
    { tool: "navigate_to", result: { target: { destination: "budgets" }, label: "Budgets" } },
    { tool: "navigate_to", result: { target: { destination: "reports" }, label: "Reports" } },
  ];
  const prose = formatFinancialReply("Here’s how [Budgets] look.\n\n[Budgets](/budgets)\n\nI used the navigate_to tool for this.", tools, "", true);
  const markup = renderToStaticMarkup(createElement(BaniReplyContent, {
    organizationName: "The Timberland", formatted: prose, results: tools, openDestination: () => undefined,
  }));
  assert.match(markup, /Here’s how Budgets look\./);
  assert.ok(markup.indexOf("Budgets look.") < markup.indexOf("Logistics Budget"));
  assert.ok(markup.indexOf("Logistics Budget") < markup.indexOf("Open Budgets"));
  assert.equal(markup.match(/Open Budgets/g)?.length, 1);
  assert.match(markup, /The Timberland/);
  assert.match(markup, /Open Reports/);
  assert.doesNotMatch(markup, /navigate_to|href=|\[Budgets\]/);
  const waiting = renderToStaticMarkup(createElement(BaniReplyContent, {
    organizationName: "The Timberland", formatted: "", results: tools, openDestination: () => undefined, waitingForProse: true,
  }));
  assert.doesNotMatch(waiting, /Open Budgets|Open Reports/);
});

test("Collections card starts with an enabled Open button and an empty status region", () => {
  const target = { destination: "collections", space: record };
  const opened: unknown[] = [];
  const props = { card: { target, label: "Collections", immediate: false }, organizationName: "The Timberland",
    openDestination: (destination: unknown) => { opened.push(destination); } };
  const markup = renderToStaticMarkup(createElement(BaniDestinationCard, props));
  assert.match(markup, /Collections &amp; Dues/);
  assert.match(markup, /The Timberland/);
  assert.match(markup, /View campaigns, payments, and assessments/);
  assert.match(markup, /<button[^>]+w-full/);
  assert.match(markup, /role="status"><\/div>/);
  assert.doesNotMatch(markup, /Workspace|href=|<button[^>]*\sdisabled(?:=|[ >])|Taking you to/);
  assert.deepEqual(opened, []);
});

test("transparency reply suppresses only exact duplicate ledger and record breakdowns", () => {
  const results = [
    { tool: "get_treasury_summary", result: { reserve_balance: "1250.00", total_collected: "1500.00", currency: "PHP" } },
    { tool: budgetTool, result },
    { tool: "list_collections_campaigns", result: [{ title: "Member Dues", currency: "PHP", collected_amount: "250.00", target_amount: "500.00" }] },
  ];
  const raw = [
    "The recorded reserve is provisional.",
    "",
    "## Treasury Overview",
    "- **Recorded reserve:** ₱1,250.00",
    "- Total inflows: PHP 1,500.00",
    "",
    "## Budgets",
    "- **Logistics Budget** — Spent: PHP 100.00; Remaining: PHP 900.00",
    "- Logistics Budget: Spent PHP 101.00",
    "",
    "## Collections",
    "- Member Dues: Collected ₱250.00; Target PHP 500.00",
    "- Member Dues: Collected PHP 250.00, which is half of its target.",
    "",
    "Reserve = Collected - Directly Paid Expenses - Advances Released + Actual Cash Returns",
  ].join("\n");
  const prose = formatFinancialReply(raw, results);
  assert.doesNotMatch(prose, /1,250\.00|1,500\.00|900\.00|Target PHP 500\.00|Treasury Overview/);
  assert.match(prose, /provisional|half of its target/);
  assert.match(prose, /101\.00/);
  assert.match(prose, /Actual Cash Returns/);
});

test("collections and budgets render narrow-friendly previews with independently expandable detail", () => {
  const collections = envelope(Array.from({ length: 15 }, (_, i) => ({
    id: String(i), title: `Collection ${i + 1}`, currency: "PHP", collected_amount: "250.00", target_amount: "500.00",
    assessed_amount: "400.00", due_date: "2026-11-30",
  })), "collections", "Collections", { destination: "collection", ids: ["0"] });
  const budgets = envelope(Array.from({ length: 4 }, (_, i) => ({ ...budget, id: String(i), name: `Budget ${i + 1}` })),
    "budgets", "Budgets", { destination: "budget", ids: ["0"] });
  const markup = renderToStaticMarkup(createElement(BaniReplyContent, {
    organizationName: "Pilot Club", formatted: "Here’s what stands out.",
    results: [{ tool: "list_collections_campaigns", result: collections }, { tool: budgetTool, result: budgets }],
    openDestination() {},
  }));
  assert.match(markup, /Showing 3 of 15 campaigns returned/);
  assert.match(markup, /Showing 3 of 4 budgets returned/);
  assert.match(markup, /lookups return up to 15 campaigns/);
  assert.match(markup, /aria-label="Open Collection 1"/);
  assert.match(markup, /aria-label="Open Budget 1"/);
  assert.match(markup, /<details[^>]*><summary[^>]*>Details/);
  assert.match(markup, /flex-wrap[^"]*wrap-anywhere/);
  assert.doesNotMatch(markup, /Collection 4|>Budget 4</);
});
