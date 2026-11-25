import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type MouseEvent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BaniChoices from "../src/components/ai/BaniChoices";
import BaniReplyContent from "../src/components/ai/BaniReplyContent";
import type { ButtonProps } from "../src/components/ui/Button";

const stored = JSON.parse(JSON.stringify([{
  tool: "bani_actions",
  result: {
    kind: "clarification",
    actions: [
      { kind: "prompt", label: "Financial transparency report", input: { id: "transparency" } },
      { kind: "navigate", label: "Open Reports", target: { destination: "reports" } },
      { kind: "external", label: "Visit a link", url: "https://example.com" },
    ],
  },
}]));

test("saved interactions render after the reply and use only structured actions", () => {
  const markup = renderToStaticMarkup(createElement(BaniReplyContent, {
    formatted: "Which report would you like?", organizationName: "Pilot", results: stored,
    sendChoice() {}, openDestination() {}, actionsBusy: true,
  }));
  assert.ok(markup.indexOf("Which report would you like?") < markup.indexOf("Choose what to see"));
  assert.match(markup, /<button[^>]*\sdisabled=""[^>]*><span>Financial transparency report/);
  assert.match(markup, /Open Reports/);
  assert.doesNotMatch(markup, /href=|Visit a link/);
  const withoutNavigation = renderToStaticMarkup(createElement(BaniChoices, { results: stored, sendChoice() {} }));
  assert.doesNotMatch(withoutNavigation, /Open Reports/);
});

test("choice buttons send only the action ID or the existing navigation target", () => {
  const sent: unknown[] = [];
  const rendered = BaniChoices({
    results: stored,
    sendChoice: (input, label) => { sent.push({ input, label }); },
    openDestination: target => { sent.push(target); },
  });
  assert.ok(rendered);
  const buttons = rendered.props.children[1].props.children as ReactElement<ButtonProps>[];
  for (const button of buttons) button.props.onClick?.({} as MouseEvent<HTMLButtonElement>);
  assert.deepEqual(sent, [
    { input: { id: "transparency" }, label: "Financial transparency report" },
    { destination: "reports", record: undefined, space: undefined },
  ]);
});
