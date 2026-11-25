import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { formatSignupError } from "../../frontend/src/lib/signupError";

const loadTemplates = () => import("../../supabase/scripts/auth-email-templates.mjs");

test("dashboard HTML and plain-text templates match their source", async () => {
  const { renderEmail, templates } = await loadTemplates();
  for (const name of Object.keys(templates)) {
    const email = renderEmail(name);
    for (const [ext, expected] of [["html", email.html], ["txt", email.text]]) {
      const file = resolve(__dirname, `../../supabase/templates/${name}.${ext}`);
      const saved = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
      assert.equal(saved, expected, `Regenerate ${name}.${ext} using --write`);
    }
    assert.doesNotMatch(email.subject, /[\r\n{}]/);
    assert.match(email.html, /max-width:580px/);
    assert.match(email.html, /\{\{ \.SiteURL \}\}\/favicon\.png/);
    assert.doesNotMatch(email.html, /<script|<form|<iframe|onerror=/i);
    assert.match(email.text, /Bantai account security/);
  }
});

test("signup variants keep a single typed OTP and both confirmation links use the existing form", async () => {
  const { renderEmail } = await loadTemplates();
  assert.equal(renderEmail("confirmation").subject, "Verify your email — Bantai");
  assert.equal(renderEmail("confirmation-action").subject, "Confirm your email address — Bantai");
  for (const name of ["confirmation", "confirmation-action"]) {
    const { html, text } = renderEmail(name);
    assert.equal(html.match(/\{\{ \.Token \}\}/g)?.length, 1);
    assert.equal(html.match(/href="\{\{ \.SiteURL \}\}\/email\/verify"/g)?.length, 2);
    assert.doesNotMatch(html, /\.(?:ConfirmationURL|TokenHash|Email)\b/);
    assert.match(text, /\/email\/verify/);
  }
});

test("verification and recovery mock previews describe the configured five-minute expiry", async () => {
  const { renderEmail } = await loadTemplates();
  for (const name of ["confirmation", "confirmation-action", "recovery"]) {
    const { html, text } = renderEmail(name, { site: "https://bantai.example", token: "123456" });
    assert.match(html, /123456/);
    assert.match(text, /123456/);
    assert.match(html, /five minutes/);
    assert.match(text, /five minutes/);
    assert.match(html, /Do not share this code/);
    assert.doesNotMatch(html, /\{\{/);
  }
  const recovery = renderEmail("recovery");
  assert.equal(recovery.subject, "Reset your password — Bantai");
  assert.doesNotMatch(recovery.html, /href=|ConfirmationURL/);
  assert.match(recovery.html, /Return to the Bantai page where you requested the reset/);
});

test("mock values are escaped and optional security email carries no token", async () => {
  const { renderEmail } = await loadTemplates();
  const hostile = '<img src=x onerror="alert(1)">';
  const { html } = renderEmail("confirmation", { token: hostile, logo: 'https://bantai.example/" onerror="x' });
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x |" onerror="/);
  const notice = renderEmail("password-changed");
  assert.doesNotMatch(notice.html + notice.text, /\.Token|ConfirmationURL|123456/);
  assert.match(notice.text, /If you didn’t make this change/);
});

test("signup provides safe feedback without exposing SMTP or provider internals", () => {
  for (const message of ["SMTP environment missing", "SMTP AUTH rejected", "SMTP transport timeout"]) {
    assert.equal(formatSignupError({ status: 500, message }), "Unable to create an account right now. Please try again.");
  }
  assert.equal(formatSignupError({ code: "over_email_send_rate_limit", message: "private details" }),
    "Too many requests. Please wait before trying again.");
});

test("account change templates use the appropriate Supabase variables", async () => {
  const { renderEmail } = await loadTemplates();
  const emailChange = renderEmail("email-change");
  assert.match(emailChange.html, /href="\{\{ \.ConfirmationURL \}\}"/);
  assert.match(emailChange.text, /both inboxes/);
  assert.doesNotMatch(emailChange.html, /\.Token/);
  const reauthentication = renderEmail("reauthentication");
  assert.match(reauthentication.html, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(reauthentication.html, /ConfirmationURL|five minutes/);
  const notice = renderEmail("email-changed");
  assert.doesNotMatch(notice.html + notice.text, /\.Token|ConfirmationURL/);
});
