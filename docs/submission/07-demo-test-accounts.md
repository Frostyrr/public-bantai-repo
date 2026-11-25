# Demo Day Test Accounts & Walkthrough

**System:** Bantai – Organization Finance Management System

*Reminder: Keep actual passwords and email App Passwords offline—never commit them to Git.*

## 1. Test Accounts (1 Admin + 2 Users)

| Role | Username | ID Number | Demo Email Inbox | Password (Keep Offline) | Security Questions (Section 5) |
|---|---|---|---|---|---|
| Admin | secadmin01 | 2026-0001 | *(Add your admin test inbox)* | *(Keep offline)* | Q1, Q3, Q7 |
| User 1 | jdelacruz | 2026-0002 | *(Add your user 1 test inbox)* | *(Keep offline)* | Q1, Q4, Q8 |
| User 2 | mreyes2026 | 2026-0003 | *(Add your user 2 test inbox)* | *(Keep offline)* | Q2, Q5, Q6 |

## 2. Live Demo Checklist (6 Minutes)

1. **Register (0:00 – 1:30):** Enter one bad input to show the exact field error, then submit valid test details with Privacy Consent and CAPTCHA, and enter the 6-digit registration OTP from email.
2. **Login, Lockout & Alert (1:30 – 3:30):** Log in as User 1 with OTP, log out, and show Back button does not reopen the page. Fail login 3 times on User 2 (show Forgot Password link after 2 fails, 15s lockout after 3 fails, and the alert email in User 2's inbox).
3. **Forgot & Change Password (3:30 – 4:45):** Try opening `/password/reset` directly (blocked). Complete Forgot Password for User 2 (question + 5-min OTP), try reusing the current password (blocked), then save a new password and show the password-changed email.
4. **Monitoring Script & Admin Dashboard (4:45 – 6:00):** Run `node supabase/scripts/security-monitor.mjs` in the terminal to show the 4-pattern scan, then log in as Admin with OTP and open `/admin` to show the read-only dashboard and logs.
