# Appendix C — Development Journal

**System:** Bantai – Organization Finance Management System

## Week 1 (Nov 1 – Nov 7, 2026)
- **What I built this week:** Completed the System Proposal (Appendix A), set up the Git repository and `.gitignore` so secrets are never tracked, created the base database tables, and tested sending emails to a test inbox.
- **Where I got stuck:** Test emails failed at first because of sender verification and SMTP port settings.
- **How I solved it:** Verified the sender address, moved all keys and SMTP passwords into local `.env` files listed in `.gitignore`, and tested again until the email arrived.
- **What I learned about security:** Never commit secrets even once, because Git keeps old commits. Setting up `.gitignore` first avoids accidental leaks.
- **Commits this week:** *(Add your Week 1 commit count)*

## Week 2 (Nov 8 – Nov 14, 2026)
- **What I built this week:** Built the registration form and server checks for usernames (6–20 chars), passwords (8–64 chars with Weak/Medium/Strong meter), names (max 50 chars), Privacy Notice consent under RA 10173, live username availability checks, and Turnstile CAPTCHA.
- **Where I got stuck:** Client and server rules did not match on name length at first, and verifying the CAPTCHA token twice caused valid signups to fail.
- **How I solved it:** Aligned both frontend and backend to the 50-character name limit and fixed the login/signup flow so each CAPTCHA token is checked only once on the server.
- **What I learned about security:** Browser validation is easy to bypass with DevTools, so every field rule and dropdown check must be repeated on the server.
- **Commits this week:** *(Add your Week 2 commit count)*

## Week 3 (Nov 15 – Nov 21, 2026)
- **What I built this week:** Added 6-digit email OTPs (hashed, 5-minute expiry, 3-try limit), AES-256 encryption for enrolled MFA email contacts, progressive login lockouts (15s / 30s / 60s), IP blocking (10 fails in 10 min), 3-question password recovery, last-3 password history, and security alert emails.
- **Where I got stuck:** Rejected `429` lockout requests were initially getting counted as extra failures, and unknown usernames gave slightly different feedback than wrong passwords.
- **How I solved it:** Excluded `429` responses from failure counts in the database function and made both unknown usernames and wrong passwords return the exact same message.
- **What I learned about security:** Small differences in error messages let attackers guess valid usernames, and lockouts must live on the server so reloading the page cannot reset them.
- **Commits this week:** *(Add your Week 3 commit count)*

## Week 4 (Nov 22 – Nov 26, 2026)
- **What I built this week:** Verified the 15-minute idle timeout with 1-minute warning, added security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`), checked the read-only Admin Dashboard and CLI monitoring script (`security-monitor.mjs`), exported the sanitized SQL dump, and finished all submission documents.
- **Where I got stuck:** Making sure the public repository only contained the core system and security files without breaking the backend or frontend builds.
- **How I solved it:** Cleaned up unused modules and docs, verified both backend and frontend builds pass with zero errors, and generated a clean SQL dump with synthetic test records.
- **What I learned about security:** Good security uses layers: preventing attacks (validation, hashing, encryption, lockouts) and detecting them (append-only logs, read-only dashboard, and automated log scanning).
- **Commits this week:** *(Add your Week 4 commit count)*
