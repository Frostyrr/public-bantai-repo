# Appendix C — Development Journal

**System:** Bantai — Collaborative Financial Management System for Organizations  
**Course:** IT 107 · Information Assurance and Security 1 (Criterion P2 / CO5)

---

## Week 1 — Foundation, System Proposal & Repository Setup

* **Week / Dates:** Week 1 (Nov 1 – Nov 7, 2026)
* **What I built this week:**
  * Finalized the System Proposal (Appendix A) for **Bantai**, defining the four system-specific fields (ID Number, Organization Type, Preferred Reporting Currency, Workspace Display Name) and selecting the enrolled Email MFA contact as the AES-256 encrypted field.
  * Set up the clean Git repository structure (`frontend/`, `backend/`, `supabase/`, `docs/`) and configured `.gitignore` to strictly exclude `.env`, `.env.local`, build outputs, and local CLI caches before writing any credentials.
  * Configured the PostgreSQL base schema (`profiles`, `organizations`, `security_events`, `source_restrictions`) with Row-Level Security (RLS) and verified transactional SMTP/Brevo email delivery to a test inbox.
* **Where I got stuck:**
  * Initial SMTP testing failed due to sender verification and port/TLS configuration mismatches between local development and Brevo/Gmail App Password settings.
* **How I solved it:**
  * Verified the sender identity, moved all SMTP and API keys into local gitignored `.env` files validated by `backend/src/constants/env.ts`, and confirmed a test email arrived cleanly in the demo inbox.
* **What I learned about security:**
  * Secrets management starts on day one: once a credential enters Git history, deleting it in a later commit does not remove it. Isolating configuration outside version control and verifying `.gitignore` first prevents accidental leaks.
* **Commits this week:** *(Update with your final Week 1 commit count)*

---

## Week 2 — Registration, Dual Validation, Privacy Consent & CAPTCHA

* **Week / Dates:** Week 2 (Nov 8 – Nov 14, 2026)
* **What I built this week:**
  * Implemented structured personal identity registration (`personalIdentity.ts` on backend, `identity.ts` on frontend) enforcing standardized field limits: 6–20 char usernames starting with a letter, 8–64 char passwords (max 72 UTF-8 bytes), and 50-char max per name field.
  * Built the live password strength meter (`passwordPolicy.ts`: Weak/Medium/Strong) blocking Weak submissions on both client and server, plus real-time username availability checks (`/auth/username-availability`).
  * Added the RA 10173 Privacy Notice page (`/privacy`), unchecked-by-default consent checkbox, and server-side Cloudflare Turnstile CAPTCHA verification (`backend/src/services/turnstile.ts`).
* **Where I got stuck:**
  * Client-side and server-side validators initially drifted on name length limits and edge-case UTF-8 byte lengths for bcrypt, and double-verifying a single-use Turnstile token in both Express and Supabase Auth caused legitimate signups to fail.
* **How I solved it:**
  * Aligned both `personalIdentity.ts` and `identity.ts` to the exact 50-character name limit and 72-byte UTF-8 password ceiling, and routed Turnstile token verification cleanly so each single-use token is redeemed once.
* **What I learned about security:**
  * Client-side validation is strictly for usability—anyone can bypass browser scripts or tamper with dropdown values using DevTools. Every rule, allow-list, and CAPTCHA check must be enforced independently on the server.
* **Commits this week:** *(Update with your final Week 2 commit count)*

---

## Week 3 — Two-Step OTP Login, Progressive Lockout, Alerts & Recovery

* **Week / Dates:** Week 3 (Nov 15 – Nov 21, 2026)
* **What I built this week:**
  * Implemented Email MFA / 6-digit OTP challenges (`202611170008_email_mfa.sql`, `emailMfa.routes.ts`) with HMAC-SHA256 hashed digests, 5-minute expiry, 3-attempt invalidation, and 60-second resend cooldowns.
  * Encrypted enrolled MFA contact emails at rest using AES-256-GCM with per-record random IVs (`202611170016_encrypt_mfa_contact.sql`).
  * Built server-enforced progressive login lockouts (`202611180001_configurable_login_lockout.sql`): "Forgot Password?" suggested after 2 failures, Tier 1 (3 failures → 15s), Tier 2 (6 → 30s), Tier 3 (9 → 60s), and IP blocking at 10 failures in 10 minutes across any accounts.
  * Implemented 3-question recovery (`securityQuestions.routes.ts`) using the Section 5 question bank with salted `scrypt` answer hashes, single-use recovery proofs, and last-3 password history (`passwordHistory.service.ts`).
  * Added automated security alert delivery (`security-alert-worker.mjs`) for lockout tier transitions and password changes.
* **Where I got stuck:**
  * Early testing showed that returning HTTP `429` responses during an active cooldown could accidentally get counted as new failed attempts, extending the block unfairly; also, testing username enumeration revealed subtle differences between nonexistent usernames and wrong passwords.
* **How I solved it:**
  * Excluded `HTTP 429` throttle events from brute-force failure scoring in `record_edge_security_event`, and mapped unknown usernames to a synthetic invalid address (`unassigned-username@example.invalid`) so both paths return the exact same `"Invalid username or password."` response.
* **What I learned about security:**
  * Anti-enumeration, atomic server-side locks (`pg_advisory_xact_lock`), and purpose-scoped single-use recovery tokens are essential to stop attackers from bypassing UI flows or racing concurrent requests.
* **Commits this week:** *(Update with your final Week 3 commit count)*

---

## Week 4 — Session Hardening, Monitoring Dashboard, CLI Script & Documentation

* **Week / Dates:** Week 4 (Nov 22 – Nov 26, 2026)
* **What I built this week:**
  * Verified the 15-minute idle session timeout (`bantai_private.sessions`), 1-minute idle warning banner (`X-Session-Idle-Remaining <= 60`), `Cache-Control: no-store` headers, and Helmet security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).
  * Built and verified the read-only Admin Security Monitoring Dashboard (`AdminDashboard.tsx`, `admin.routes.ts`) logging `ADMIN_VIEWED_DASHBOARD` and `ADMIN_ACCESS_DENIED`, with React XSS escaping on attacker-supplied log fields.
  * Verified the standalone CLI monitoring script (`supabase/scripts/security-monitor.mjs` calling `bantai_run_security_monitor`) detecting all 4 required patterns (`ip_threshold`, `account_targeted`, `otp_guessing`, `off_hours_login`) with daily deduplication in `security_monitor_flags`.
  * Completed all submission deliverables: System Proposal (Appendix A), Privacy Note (RA 10173), Threat Model (Appendix B), Design Decisions, Error Message Mapping, sanitized SQL dump (`database/bantai_security_dump.sql`), and demo test account plan.
* **Where I got stuck:**
  * Ensuring that no sensitive startup-only modules, draft notes, or `.env` files were present in the public repository while keeping both backend and frontend TypeScript builds passing cleanly.
* **How I solved it:**
  * Scoped the repository to the core workspace and security modules, extracted plain file encoding to `frontend/src/utils/encodeFile.ts`, verified both `backend` and `frontend` TypeScript builds (`tsc --noEmit` and `tsc -b`), and generated a 100% synthetic SQL dump.
* **What I learned about security:**
  * Defense in depth requires combining preventive controls (validation, hashing, encryption, CSRF/CAPTCHA) with detective controls (append-only logs, read-only admin dashboards, and automated CLI pattern scanning) so attacks are both blocked and visible.
* **Commits this week:** *(Update with your final Week 4 commit count)*
