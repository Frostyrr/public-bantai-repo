# Bantai Auth email and Brevo SMTP

## Email ownership

Supabase Auth owns transactional authentication email. Registration calls
`signUp`, and verification resends call `resend({ type: "signup" })`. Both use
the **Confirm sign up** template. The app confirms the six-digit code using
`verifyOtp({ type: "email" })`. Recovery calls `resetPasswordForEmail` and
verifies the typed code using `verifyOtp({ type: "recovery" })`. Google OAuth
and ordinary password login keep their existing flows.

Express has no mail transport or active worker delivering email. The inquiry
route acknowledges requests without sending email. Organization invitations,
security events, and the notification inbox have in-app paths. The delivery
outbox schema does not imply a running email worker. No mailer, auth hook, or
additional email send is introduced by this migration.

## First-run onboarding

1. **Registration.** Remove the display-name field and its form validation
   from email signup. Keep email, password, confirm password, CAPTCHA, and
   email verification. Collect profile information after authentication.
2. **Display name.** Reuse the first-run display-name modal after email
   verification and first Google sign-in. Ask “What should we call you?”
   Prefill the Google name when available and let the user edit it. Save
   through the existing profile API and advance after the save succeeds.
3. **Appearance.** After saving the name, ask “How should Bantai look?”
   Offer **Light**, **Dark**, and **System**. Preview the selection using the
   existing theme provider. System follows the device’s appearance. Save
   the choice to the account on Continue and let users change it later
   in **Account Settings → Appearance**.
4. **Completion.** Persist onboarding progress per account so a refresh or
   sign-in on another device can resume the unfinished step. Keep existing
   display names and preferences, and send established users straight to
   their workspace.

Apply `202611170004_account_onboarding.sql` before releasing the API and
frontend. The migration enables Light preferences and assigns the first
onboarding step to newly created profiles. Established accounts bypass the
flow and retain their saved preferences.

Verify email and Google signup, prefilled names, failed saves and retry,
resume between steps, all three themes, device theme changes in System mode,
and returning users bypassing completed onboarding.

## Configure Brevo and Supabase

The files under `supabase/templates` are dashboard inputs. They are not deployed
by a Vercel build or a database migration.

1. Record the current Auth SMTP provider, template subjects and bodies, Site
   URL, OTP settings, rate limits, and enabled security notifications. Keep
   credentials in their secret stores. Verify the current SMTP host in the
   dashboard before assuming Gmail is still active. If Brevo is already
   configured, verify the settings below instead of rotating credentials blindly.
2. In Brevo, check that transactional sending is enabled and that
   `bantai.space@gmail.com` is verified. Obtain a Brevo SMTP login and SMTP key.
   The login is a technical credential. The SMTP key is not a Brevo API key.
3. In **Supabase Dashboard → Authentication → SMTP Settings**, enable custom SMTP
   and enter these values. Store the login and key in the managed SMTP fields.
   The names below label the corresponding fields in the configuration example.

   | Setting | Example name | Value |
   | --- | --- | --- |
   | Host | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | Port | `SMTP_PORT` | `587` |
   | Username | `SMTP_USER` | Brevo SMTP login |
   | Password | `SMTP_PASS` | Brevo SMTP key |
   | Sender email | `SMTP_FROM_EMAIL` | `bantai.space@gmail.com` |
   | Sender name | `SMTP_FROM_NAME` | `Bantai` |

   Use port 587 with STARTTLS and standard certificate validation. Do not disable
   verification or add fallback Gmail SMTP. The hosted Auth service owns its
   transport and timeouts. Express and Vercel have no SMTP sockets, retry loops,
   or SMTP secrets for these flows. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
   and [Brevo SMTP setup](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).
4. Keep **Confirm email** and the current CAPTCHA protections enabled. Set or
   verify a six-digit email OTP and a **300-second (five-minute)** lifetime before
   applying the templates. The prior repository guide suggested ten minutes, so
   the live setting must be checked. The Auth email expiry setting also applies
   to other email tokens in the project. Preserve the current resend interval
   and Auth-side send/verification rate limits, including stricter settings.
   The existing 60-second UI cooldown is not server-side enforcement.
5. Keep the deployed application origin as the Auth Site URL, such as
   `https://bantaispace.vercel.app`, without a trailing slash. Keep the existing
   allowlisted callbacks, including the application `/auth/callback` for Google.
   On staging, use the exact staging origin and callback. The template loads
   the existing `/favicon.png` from the Site URL. Both the sign-up button and
   fallback link open `/email/verify` without putting an OTP or email address
   into the URL. Disable link tracking for authentication mail.
6. In **Authentication → Email Templates**, set the subject and paste the matching
   HTML file. Select one confirmation variant, because both use the same slot.

   | Supabase slot | Subject | Repository file |
   | --- | --- | --- |
   | Confirm sign up | Verify your email — Bantai | `supabase/templates/confirmation.html` |
   | Confirm sign up (alternate) | Confirm your email address — Bantai | `supabase/templates/confirmation-action.html` |
   | Reset password | Reset your password — Bantai | `supabase/templates/recovery.html` |
   | Change email address | Confirm your email address change — Bantai | `supabase/templates/email-change.html` |
   | Reauthentication | Verify your password change — Bantai | `supabase/templates/reauthentication.html` |
   | Password changed (only if already enabled) | Your password was changed — Bantai | `supabase/templates/password-changed.html` |
   | Email address changed (only if enabled) | Your email address was changed — Bantai | `supabase/templates/email-changed.html` |

   Preserve `{{ .Token }}` and `{{ .SiteURL }}` in the active templates. The
   signup button opens the existing verification form. Recovery remains a typed
   code flow. Do not replace either code with a one-click `{{ .ConfirmationURL }}`
   link. Mail scanners can consume those links, and the app expects the typed
   code. **Change email address** uses Supabase’s confirmation links instead.
   Keep **Secure email change** enabled so both inboxes confirm the request.
   Add `https://bantaispace.vercel.app/auth/callback?account=email-change` to the
   redirect allowlist, and add the corresponding exact URL for staging. Open
   both confirmation links in the browser where the change was requested.
   The **Reauthentication** template is used if **Secure password change**
   requires a code for a signed-in password change. Enable **Require current
   password when changing password** for server-side current-password checks
   if exposed by the project settings. Leave unrelated templates unchanged.
   See [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Opt-in authenticator app

Apply `202611170003_enforce_opt_in_mfa.sql` before releasing the API and then the
frontend. Confirm TOTP enrollment and verification are enabled in the Supabase
project. The authenticator app generates its own codes and does not use Brevo.

On a staging test account, open **Account Settings → Security & Sign-in** and
set up an authenticator. Try an invalid code before completing enrollment.
Sign out and test password and Google sign-in, a direct protected URL, and
password recovery. With an enrolled account, verify that an AAL1 token cannot
read protected data through Express, PostgREST, or authenticated Storage.
Verify the same operations succeed at AAL2, and test factor removal.

Also test password changes with a recent and an older session, followed by
an email change that requires both inboxes. Check that the first confirmation
leaves the current address intact and the second updates the account. Test
expired links and confirm enabled security notices reach the expected inbox.
Bantai does not issue backup codes in this version. Establish a verified
support recovery process before offering MFA to production users.

## Vercel environment

**New Vercel variables required: none.** Keep existing frontend
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_APP_URL`, and
existing backend `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `APP_ORIGIN`. Follow the main deployment guide
for other app features. Do not put SMTP credentials into Vercel or any `VITE_*`
variable for this cutover.

## Preview and test

From the repository root:

```powershell
node supabase/scripts/auth-email-templates.mjs
```

Open the HTML files in the printed temporary directory in a browser and open
the corresponding text files in an editor. The preview uses fake OTP
`123456`, a reserved example hostname, and an embedded copy of the existing
Bantai mark. It reads no credentials, sends nothing, and has no application
route. To regenerate the checked-in dashboard files after editing the source:

```powershell
node supabase/scripts/auth-email-templates.mjs --write
```

The design uses Bantai’s neutral light palette, dark action buttons, rounded
surfaces, and compact hierarchy adapted from its auth screens. The templates
use inline styles, presentation tables, an Outlook width fallback, and system
font fallbacks to Geist. The name remains legible when images are blocked.

The matching `.txt` files provide plain-text alternatives for preview and
operators. Hosted Supabase template slots take a single HTML body. There is no
separate dashboard field to upload these files as MIME alternatives. A strict
multipart delivery requirement would need a separately approved sender hook.
See the [upstream SMTP client](https://github.com/supabase/auth/blob/master/internal/mailer/mailmeclient/mailmeclient.go).

## Staging acceptance and cutover

- Verify the first message for signup and recovery is accepted in Brevo and
  appears in a controlled inbox. Check actual From headers, Gmail and Outlook
  rendering, and a narrow mobile viewport. SMTP acceptance is distinct from
  inbox delivery. Monitor Brevo events for failures, bounces, and delays.
- Confirm signup reaches the dashboard after code verification. Check a wrong
  code, a code at the five-minute expiry boundary, a reused code, resend
  throttling, and verification attempt limits. Confirm the CTA allows typing
  the email and code and does not generate another send.
- Confirm the recovery request gives neutral feedback, rejects invalid and
  expired codes, and accepts the correct new password only after successful
  verification. Verify that recovery remains in the isolated client and does
  not create a normal dashboard session.
- On **staging only**, simulate missing SMTP configuration, an invalid SMTP
  key, and an unavailable SMTP host. Confirm users see a generic error, check
  whether the provider attempted a send, and restore the working staging
  configuration. Never record an OTP or credential in test logs. A local TLS
  probe or a preview pass cannot establish hosted Auth delivery.
- Verify Google OAuth and any already enabled password-change notifications.
  Check that a single request produces only the expected email and that
  provider tracking has not rewritten authentication URLs.
- Apply the saved settings to production only after staging acceptance. Verify
  a controlled production signup and recovery, then monitor Auth and Brevo
  failure rates. Keep the previous configuration available for rollback.

**Rollback:** Manually restore the previous SMTP settings and templates in
Supabase if necessary. For a former Gmail setup, the rollback fields are
`smtp.gmail.com`, port `465` (implicit TLS), the previously approved sender,
and its Google App Password from the original secret store. Restore the
previous OTP policy and corresponding copy together. Revoke the Brevo key if
it will no longer be used. There is no automatic fallback.

**Temporary sender limits:** A Gmail address can be verified as a sender but
does not let Bantai authenticate `gmail.com` under its own Brevo account.
Brevo can rewrite the visible From address to a `brevosend.com` subdomain.
Neither sender verification nor SMTP acceptance guarantees inbox placement.
For durable sender identity, use a domain Bantai controls and authenticate it
in Brevo. See [Brevo domain and sender rewriting](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication).

## Recovery boundaries

Recovery uses a separate client with no persistent storage, refresh, or URL
detection. A server-verified user check precedes the password update. Leaving or
reloading clears recovery progress, and a successful reset signs out the local
recovery session. Supabase may issue an authenticated JWT after verification.
Client isolation does not make that JWT a server-enforced reset-only credential
or guarantee that every previous session is revoked immediately.
