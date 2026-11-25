import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const previewSite = "https://bantai.example";
const publicLogo = new URL("../../frontend/public/favicon.png", import.meta.url);
const templateDirectory = fileURLToPath(new URL("../templates/", import.meta.url));
const signup = {
  subject: "Verify your email — Bantai",
  title: "Verify your email address",
  body: "Enter this six-digit code in Bantai to verify your email and finish creating your account.",
  codeLabel: "Verification code",
  action: { label: "Confirm your email address", path: "/email/verify" },
  unexpected: "If you didn’t create a Bantai account, you can ignore this email.",
};

export const templates = {
  confirmation: signup,
  "confirmation-action": { ...signup, subject: "Confirm your email address — Bantai", title: "Confirm your email address" },
  recovery: {
    subject: "Reset your password — Bantai",
    title: "Reset your password",
    body: "We received a request to reset your Bantai password. Return to the Bantai page where you requested the reset and enter the full code below. Use the newest password reset email if you requested more than one code.",
    codeLabel: "Password reset code",
    unexpected: "If you didn’t request a reset, ignore this email. This request does not change your password.",
  },
  "password-changed": {
    subject: "Your password was changed — Bantai",
    title: "Your Bantai password was changed",
    body: "Your account password was changed. If you made this change, no further action is needed.",
    unexpected: "If you didn’t make this change, open Bantai directly and reset your password using a device you trust.",
  },
  "email-change": {
    subject: "Confirm your email address change — Bantai",
    title: "Confirm your email address change",
    body: "Someone requested an email address change for your Bantai account. If that was you, confirm the change in the browser where you requested it. If you received a confirmation in both inboxes, open both links.",
    action: {
      label: "Confirm email address change",
      url: "{{ .ConfirmationURL }}",
      fallback: "If the button doesn’t work, open the confirmation link in the same browser.",
    },
    unexpected: "If you didn’t request this change, ignore this email and review your account security by opening Bantai directly.",
  },
  "email-changed": {
    subject: "Your email address was changed — Bantai",
    title: "Your Bantai email address was changed",
    body: "The email address on your Bantai account was changed. If you made this change, no further action is needed.",
    unexpected: "If you didn’t make this change, contact Bantai support from a device you trust.",
  },
  reauthentication: {
    subject: "Verify your password change — Bantai",
    title: "Verify your password change",
    body: "Enter this verification code in Bantai Account Settings to continue changing your password.",
    codeLabel: "Verification code",
    omitExpiration: true,
    unexpected: "If you didn’t request this code, ignore this email and review your account security by opening Bantai directly.",
  },
};

const escape = (value) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

export function renderEmail(name, { site = "{{ .SiteURL }}", token = "{{ .Token }}", logo = site + "/favicon.png" } = {}) {
  if (!Object.hasOwn(templates, name)) throw new Error("Unknown email template");
  const { subject, title, body, codeLabel, action, unexpected, omitExpiration } = templates[name];
  const actionUrl = action && (action.url ?? site + action.path);
  const expiration = omitExpiration ? "" : "This code expires in five minutes.";
  const secretReminder = "Do not share this code with anyone.";
  const font = "Geist, Arial, Helvetica, sans-serif";
  const paragraph = "margin:0 0 16px;color:#4b5563;font-size:15px;line-height:24px;";
  const codeBlock = codeLabel ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 16px;">
                <tr><td bgcolor="#f4f4f6" style="padding:16px 14px;border:1px solid #e4e4e7;border-radius:12px;">
                  <p style="margin:0 0 6px;color:#4b5563;font-size:13px;line-height:20px;font-weight:bold;">${codeLabel}</p>
                  <p style="margin:0;color:#111827;font-family:Consolas,'Courier New',monospace;font-size:28px;line-height:36px;font-weight:bold;letter-spacing:4px;">${escape(token)}</p>
                </td></tr>
              </table>
              <p style="${paragraph}">${expiration ? `<strong style="color:#111827;">${expiration}</strong> ` : ""}${secretReminder}</p>` : "";
  const actionBlock = action ? `
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0 12px;">
                <tr><td bgcolor="#18181b" style="border-radius:24px;mso-padding-alt:12px 20px;">
                  <a href="${escape(actionUrl)}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-family:${font};font-size:14px;line-height:20px;font-weight:bold;text-decoration:none;mso-padding-alt:0;">${action.label}</a>
                </td></tr>
              </table>
              <p style="margin:0;color:#4b5563;font-size:13px;line-height:20px;">${action.fallback ? `${action.fallback} <a href="${escape(actionUrl)}" style="color:#18181b;text-decoration:underline;">Open the confirmation link</a>` : `Button not working? <a href="${escape(actionUrl)}" style="color:#18181b;text-decoration:underline;">Open the verification page</a>, then enter your email address and code.`}</p>` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${title} — Bantai</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f8;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f7f7f8">
    <tr><td align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" width="580" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:580px;border:1px solid #e4e4e7;border-radius:16px;text-align:left;font-family:${font};">
        <tr><td style="padding:22px 24px;border-bottom:1px solid #e4e4e7;">
          <table role="presentation" cellspacing="0" cellpadding="0">
            <tr>
              <td valign="middle" style="padding-right:10px;"><img src="${escape(logo)}" width="36" height="36" alt="" style="display:block;border-radius:8px;border:0;"></td>
              <td valign="middle" style="color:#111827;font-family:${font};font-size:21px;line-height:28px;font-weight:bold;">Bantai</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 12px;color:#111827;font-size:24px;line-height:32px;letter-spacing:-0.5px;">${title}</h1>
          <p style="${paragraph}${codeLabel || action ? "" : "margin-bottom:0;"}">${body}</p>${codeBlock}${actionBlock}
        </td></tr>
        <tr><td style="padding:18px 24px;border-top:1px solid #e4e4e7;color:#4b5563;font-size:13px;line-height:20px;">
          <p style="margin:0 0 6px;color:#111827;font-weight:bold;">Bantai account security</p>
          <p style="margin:0;">${unexpected}</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>
`;
  const text = [
    "Bantai", title, body,
    codeLabel && `${codeLabel}: ${token}\n${[expiration, secretReminder].filter(Boolean).join(" ")}`,
    action && `${action.label}: ${actionUrl}\n${action.fallback ?? "Enter your email address and code on the verification page."}`,
    "Bantai account security\n" + unexpected,
  ].filter(Boolean).join("\n\n") + "\n";
  return { subject, html, text };
}

async function writeTemplates(directory, context) {
  for (const name of Object.keys(templates)) {
    const email = renderEmail(name, context);
    await Promise.all([
      writeFile(join(directory, name + ".html"), email.html),
      writeFile(join(directory, name + ".txt"), email.text),
    ]);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length === 3 && process.argv[2] === "--write") {
    await writeTemplates(templateDirectory);
  } else if (process.argv.length === 2) {
    const directory = await mkdtemp(join(tmpdir(), "bantai-email-preview-"));
    const logo = "data:image/png;base64," + (await readFile(publicLogo)).toString("base64");
    await writeTemplates(directory, { site: previewSite, token: "123456", logo });
    console.log("Mock previews (no mail sent): " + directory);
  } else {
    throw new Error("Usage: node supabase/scripts/auth-email-templates.mjs [--write]");
  }
}
