# Demo Day Test Accounts & Verification Guide

**System:** Bantai — Collaborative Financial Management System for Organizations  
**Course:** IT 107 · Information Assurance and Security 1 (Deliverable #9 & Section 17/18)

> **Security Note (Protection 11):** Actual account passwords and live SMTP/App Passwords are **never** committed to Git. Fill in the live demo passwords and accessible inbox addresses on your offline demo sheet or private password manager before Demo Day.

---

## 1. Required Demo Accounts (1 Admin + 2 Standard Users)

| Role | Username | ID Number | Accessible Demo Inbox | Password (Keep Offline) | Security Questions Selected (Section 5 Bank) |
|---|---|---|---|---|---|
| **Platform Admin** (`admin`) | `secadmin01` | `2026-0001` | *(Set your accessible admin test inbox)* | *(Store offline — Strong, >= 16 chars)* | Q1 (First pet), Q3 (Favorite HS teacher), Q7 (Elementary school) |
| **Test User 1** (`user`) | `jdelacruz` | `2026-0002` | *(Set your accessible user 1 test inbox)* | *(Store offline — Medium/Strong, >= 8 chars)* | Q1 (First pet), Q4 (Mother's maiden first name), Q8 (First dish cooked) |
| **Test User 2** (`user`) | `mreyes2026` | `2026-0003` | *(Set your accessible user 2 test inbox)* | *(Store offline — Medium/Strong, >= 8 chars)* | Q2 (Best friend in elem), Q5 (Grade 1 street), Q6 (First song learned) |

*Note:* The Admin account (`secadmin01`) is provisioned directly in the database with `role = 'admin'` — never through the public registration form (Section 13.1).

---

## 2. Live Demo Script (6-Minute Flow — Section 17)

1. **Registration & Dual Validation (0:00 – 1:30):**
   * Open `/register`, enter a deliberately invalid value (e.g., lowercase name `juan` or bad ID `1234-567`) to show the exact field-level error message under the input.
   * Enter valid synthetic details, tick the RA 10173 Privacy Notice consent checkbox, solve Turnstile CAPTCHA, submit, and enter the 6-digit registration OTP received in the test inbox.
2. **Two-Step Log-in & Lockout + Alert Email (1:30 – 3:30):**
   * Log in as **Test User 1 (`jdelacruz`)** with password + Email OTP to show normal authenticated access.
   * Log out and verify the browser Back button does not expose protected pages.
   * Attempt 3 failed logins against **Test User 2 (`mreyes2026`)**:
     * After **2 failures**, point out the `"Forgot Password? Reset Here"` link.
     * After **3 failures**, show the server-enforced **15-second** Tier 1 lockout countdown (survives page reload) and open User 2's inbox to display the automated security alert email (with Philippine time, IP, and browser user-agent).
3. **Forgot Password, Security Question, OTP & Password History (3:30 – 4:45):**
   * Attempt to open `/password/reset` directly without completing recovery (show server refusal).
   * Complete Forgot Password for **Test User 2**: enter username + CAPTCHA → answer one of the 3 registered questions → enter the 5-minute reset OTP → attempt reusing the current password (show `"You cannot reuse a recent password."`) → set a new valid password → show `"Your password was changed"` email.
4. **CLI Monitoring Script & Read-Only Admin Dashboard (4:45 – 6:00):**
   * Run the standalone CLI monitor from the terminal:
     ```powershell
     node supabase/scripts/security-monitor.mjs
     ```
   * Show the console report scanning the last 24 hours and writing deduplicated flags (`ip_threshold`, `account_targeted`, `otp_guessing`, `off_hours_login`).
   * Log in as **Platform Admin (`secadmin01`)** with OTP, open `/admin`, show the summary cards, failed-login telemetry, top IPs, security flags, recent events (with XSS payload rendered as literal text), and `ADMIN_VIEWED_DASHBOARD` logged automatically with zero edit/delete controls.
