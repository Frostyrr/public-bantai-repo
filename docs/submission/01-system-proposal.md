# Appendix A — System Proposal

**Course:** IT 107 · Information Assurance and Security 1  
**Term:** 1st Semester, A.Y. 2026–2027  
**Institution:** Caraga State University — BS Information Technology

---

## 1. System Overview

| Field | Proposal Details |
|---|---|
| **System Name (Prospect Name)** | **Bantai** — Collaborative Financial Management System for Organizations |
| **Who Uses It** | Student organization officers (Owner, Organization Admin, Treasurer, Auditor), regular organization members/students, and Platform Administrators. |
| **What It Stores** | User account credentials and structured personal identity records; organization memberships and role assignments; member directory records; collection campaigns and dues payment ledgers; budget allocations; expense, reimbursement, and cash advance/liquidation records with supporting receipt evidence; and immutable security/audit activity logs. |
| **Why Accounts Need Protecting** | Bantai handles sensitive personal identity data and authoritative organization financial records (collections, dues, budgets, expenses, reimbursements, and liquidation approvals). Unauthorized access could result in personal data exposure under RA 10173, fraudulent approval of financial disbursements, tampering with collection or audit records, or account takeover of officers with financial oversight privileges. |
| **Sensitive Field to Encrypt at Rest (Protection 13)** | **Enrolled MFA Contact Email (`enrolled_email_ciphertext` / `pending_email_ciphertext`)** — encrypted at rest using **AES-256-GCM** with a random per-record IV and versioned application key (`EMAIL_MFA_ENCRYPTION_KEY`), decrypted only on the server when displaying the masked/owned recovery contact to the authenticated account owner or dispatching a verified OTP challenge. |

---

## 2. System-Specific Registration / Account Fields

In addition to the core IT 107 registration fields (ID Number, First Name, Middle Name, Family Name, Name Extension, Birthdate & Age, 6-part Address, Email, Username, Password & Confirmation, 3 Authentication Questions, and Privacy Consent), Bantai defines four system-specific fields spanning four distinct input kinds:

| # | Field Name | Kind | Required? | Validation Rule | Exact Error Message |
|---|---|---|---|---|---|
| 1 | **Organization Enrollment / Member ID** | Formatted text | Required | Format `xxxx-xxxx` (four digits, hyphen, four digits) matching the organization's roster identifier; preserves leading zeroes; unique per user. | `ID Number must follow the format xxxx-xxxx.` / `This ID Number is already registered.` |
| 2 | **Organization Type** | Dropdown (allow-listed enum) | Required | Server-validated allow-list: `student`, `workplace`, `club`, `nonprofit`, `other`. Any tampered or unlisted value is rejected server-side. | `Please select a valid organization type.` |
| 3 | **Preferred Reporting Currency** | Dropdown (allow-listed enum) | Required | Server-validated ISO-4217 allow-list: `PHP`, `USD`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD`, `SGD` (default `PHP`). | `Choose a supported currency.` |
| 4 | **Workspace Display Name** | Free text | Optional | 1–80 characters when provided; no control characters (`\p{Cc}`) or angle brackets (`<`, `>`). Used for human-readable attribution in organization workspaces without altering immutable audit identities. | `Enter a display name without control characters or angle brackets.` |

---

## 3. Standardized Security Configuration

Per the updated IT 107 course specification, Bantai enforces the standardized security parameters across both client-side and server-side/database layers:

| Security Parameter | Configured Value | Enforcement Layer |
|---|---|---|
| Minimum username length | **6 characters** | Frontend (`usernameAvailability.ts`), Backend (`personalIdentity.ts`), DB constraints |
| Maximum username length | **20 characters** | Frontend (`usernameAvailability.ts`), Backend (`personalIdentity.ts`), DB constraints |
| Minimum password length | **8 characters** (max 64 chars / 72 UTF-8 bytes) | Frontend (`passwordPolicy.ts`), Backend (`personalIdentity.ts`) |
| Maximum length of each name field | **50 characters** | Frontend (`identity.ts`), Backend (`personalIdentity.ts`) |
| Failed log-ins before "Forgot Password?" appears | **2 consecutive failures** | PostgreSQL (`bantai_login_restriction`) & Express (`/auth/login`) |
| Lockout Tier 1 (3 failed log-ins) | **15 seconds** | PostgreSQL (`login_lockout` policy) & Express (`429` + `Retry-After`) |
| Lockout Tier 2 (6 failed log-ins) | **30 seconds** | PostgreSQL (`login_lockout` policy) & Express (`429` + `Retry-After`) |
| Lockout Tier 3 (9 failed log-ins) | **60 seconds** | PostgreSQL (`login_lockout` policy) & Express (`429` + `Retry-After`) |
| OTP expiry | **5 minutes** | PostgreSQL (`bantai_issue_email_mfa`, `expires_at = now + 5m`) |
| Idle session timeout | **15 minutes** (with 1-minute warning) | PostgreSQL (`session_timeout` policy) & Express (`X-Session-Idle-Remaining`) |
| IP block threshold (failures in 10 min, any account) | **10 failures** (blocks IP for 10 min) | PostgreSQL (`bantai_record_login_failure` & `source_restrictions`) |
| Authentication questions | **3 distinct questions** selected by the user from the 8-question bank (Section 5) | Backend (`securityQuestions.routes.ts`) & PostgreSQL (`bantai_sq_action`) |

---

## 4. Technical Architecture Summary

* **Frontend:** React 19 + TypeScript + Vite SPA with client-side validation, live password strength meter, real-time username availability check, lockout countdowns, and idle session warning banner.
* **Backend API:** Node.js + Express 5 + TypeScript + Zod server-side validation, Helmet security headers, Upstash Redis rate limiting, Cloudflare Turnstile CAPTCHA verification, and Brevo/SMTP transactional email delivery.
* **Database & Auth:** PostgreSQL with Row-Level Security (RLS), private security schema (`bantai_private`), parameterized RPCs/prepared statements, append-only security event logging, and a standalone CLI monitoring script (`supabase/scripts/security-monitor.mjs`).

---

## 5. Instructor Approval

| Field | Entry |
|---|---|
| **Instructor's Decision** | ☐ Approved &nbsp;&nbsp;&nbsp;&nbsp; ☐ Revise and resubmit |
| **Signature and Date** | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
