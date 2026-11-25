# Design Decisions

**System:** Bantai — Collaborative Financial Management System for Organizations  
**Course:** IT 107 · Information Assurance and Security 1 (Criterion P4 / CO3)

This document answers every **"Your Call"** design prompt from the IT 107 handout (including the Section 12 hashing-versus-encryption distinction), explaining the security choice made in Bantai and the reasoning behind it.

---

### 1. Password Hashing Algorithm and Settings (§4.4)

Bantai uses **bcrypt** (managed by Supabase Auth / GoTrue with per-password random salts and adaptive work factor) for primary account password storage, and **Node.js `crypto.scrypt`** (memory-hard key derivation with per-record 16-byte random salts and `timingSafeEqual` verification) for application-managed password history verification (`bantai_private.password_history`). Because bcrypt truncates input beyond 72 UTF-8 bytes, both our client-side (`passwordPolicy.ts`) and server-side (`personalIdentity.ts`) validators explicitly enforce a 64-character and 72-UTF-8-byte ceiling so users never experience silent truncation. Using slow, salted, adaptive algorithms ensures that even if the database were compromised, offline brute-force cracking remains computationally prohibitive.

---

### 2. What Makes a Password Strong? (§4.9)

Bantai evaluates password strength on a shared three-tier scale (**Weak**, **Medium**, **Strong**) enforced identically in `frontend/src/lib/passwordPolicy.ts` and `backend/src/modules/user/personalIdentity.ts`. A password is classified as **Weak**—and blocked from submission on both client and server—if it is shorter than 8 characters, exceeds 64 characters or 72 UTF-8 bytes, matches common predictable patterns (such as repeated short substrings or variants of `password`, `qwerty`, `letmein`, `12345678`, `admin`, or `bantai`), or fails to meet either complexity (at least 3 of 4 character classes: lowercase, uppercase, digits, symbols) or passphrase length (16+ characters with at least 3 words). Passwords that pass these checks with 8–15 characters are rated **Medium**, while passphrases or complex passwords of 16+ characters are rated **Strong**. This balances NIST SP 800-63B guidance (favoring length and passphrases over brittle composition rules) with clear, predictable user feedback.

---

### 3. Why Hash Security Answers Instead of Storing Plaintext? (§5)

Security question answers act as authentication credentials during password recovery—anyone who obtains a user's answers can advance through the recovery gate toward resetting the password. If stored in plaintext, a single SQL read, backup leak, or insider lookup would immediately expose every user's recovery answers (and often real-world personal facts reused on other sites). In Bantai (`backend/src/modules/user/securityQuestionAnswers.ts`), each answer is normalized (trimmed and lowercased so `"Bantay"` and `"bantay"` match consistently) and then hashed with a unique per-record random salt using a slow one-way key derivation function (`scrypt`). Because answers are only ever *verified* against user input and never need to be displayed back, one-way hashing eliminates plaintext exposure while throttling and lockout rules mitigate offline and online guessing of low-entropy answers.

---

### 4. Does a Failed CAPTCHA Count as a Failed Log-In? (§7)

**No**—a failed CAPTCHA is logged and rate-limited by source IP, but it does **not** increment the target user account's failed log-in lockout counter. If failed CAPTCHAs counted toward account lockouts, a bot could trivially cause a Denial-of-Service (DoS) against any known user by repeatedly submitting invalid CAPTCHA tokens for that username, locking the legitimate owner out of their own account. Instead, Bantai records Turnstile rejections as distinct `CAPTCHA_FAILED` security events (`backend/src/services/turnstile.ts`), applies Express IP-based rate limiting (`authLoginLimiter`), and preserves uniform error messaging so bots are stopped at the edge without weaponizing account lockouts against victims.

---

### 5. Is "Disabling the Back Button" Enough After Log-Out? (§8.4)

**No**—attempting to disable or manipulate browser history in JavaScript is purely cosmetic and provides zero real security, because a user or attacker can still inspect cached responses, open a direct URL, or replay requests via DevTools/curl. Real protection lives on the server and in HTTP caching controls: when a user logs out or exceeds the **15-minute idle timeout**, Bantai revokes the session server-side in `bantai_private.sessions`, sends `Cache-Control: no-store` on every authenticated API response so browsers do not retain sensitive payloads in cache, clears all user-scoped TanStack Query caches on sign-out, and requires every protected route and API call to pass `authenticate` + `bantai_check_verified_session` before returning any data. Pressing Back after logout therefore triggers an immediate server-verified redirect to `/login`.

---

### 6. How Does the Verified User Reach Change Password? (§10)

A verified user cannot reach Change Password simply by navigating to `/password/reset` or supplying a client-side flag. In Bantai, completing the recovery sequence (identifying the account with CAPTCHA, answering the registered security question, and verifying the 6-digit email recovery OTP) issues a **short-lived, single-use, purpose-scoped recovery session** verified server-side by `recoveryIdentity` (`backend/src/modules/user/securityQuestions.routes.ts`). The middleware validates the JWT signature, confirms a fresh `otp` Authentication Methods Reference (`amr`) timestamp within the 5-minute window, and verifies a matching server-side recovery proof in PostgreSQL (`requireRecoveryProof`). Once the new password is saved (after passing the last-3 password history check), the recovery proof is atomically consumed and invalidated so reloading the page, clicking Back, or directly opening `/password/reset` without completing steps 1–4 is rejected by the server.

---

### 7. Hashing vs. Encryption at Rest (§12 Note)

Hashing and encryption solve fundamentally different security problems. **Hashing** is a **one-way** mathematical transformation (with no decryption key) designed for secrets that the system only ever needs to *verify* by comparing a fresh input against a stored digest—specifically passwords, security question answers, and 6-digit OTPs (stored as keyed HMAC-SHA256 digests so a database leak alone cannot brute-force the 1,000,000 possible 6-digit codes). **Encryption** (AES-256-GCM with a random per-record IV and a protected secret key) is **reversible** and is used exclusively for sensitive data that the system must later *retrieve and display or use*, such as Bantai's enrolled Email MFA contact address (`enrolled_email_ciphertext` in `bantai_private.email_mfa`). Using hashing for verifiers prevents credential recovery even if keys leak, while AES-256 encryption protects retrievable PII at rest in database dumps.

---

### 8. Should the Application Database Role Be Allowed to Delete Activity Logs? (§13.3)

**No**—the database role used by the web application must **never** hold `UPDATE` or `DELETE` privileges on the security activity log table (`public.security_events`). If an attacker compromised the web application tier, having `DELETE` or `UPDATE` permissions would allow them to erase their intrusion trail and conceal unauthorized actions. In Bantai, `public.security_events` is strictly **append-only**: application producers insert events through narrowly scoped `SECURITY DEFINER` RPCs, Platform Administrators read logs via read-only query RPCs, and the Admin Security Dashboard exposes zero edit, delete, or "clear logs" controls. Any future archival or retention pruning is restricted to an out-of-band database maintenance role outside the web application.

---

### 9. How Can the Monitoring Script Run Automatically Every 15 Minutes? (§14.2)

While the monitoring script (`supabase/scripts/security-monitor.mjs`) is executed manually from the command line during the live demo, in production it is scheduled via **Windows Task Scheduler** (on Windows hosts, using `supabase/scripts/run-security-monitor.ps1` with a trigger repeating every 15 minutes indefinitely and the setting *"If the task is already running: Do not start a new instance"* to prevent overlapping runs) or **cron** on Linux (`*/15 * * * * flock -n /tmp/bantai-monitor.lock node /opt/bantai/supabase/scripts/security-monitor.mjs >> /var/log/bantai-monitor.log 2>&1`). The script lives outside the public web root, loads its scoped credentials from environment variables, scans the last 24 hours of `public.security_events`, and relies on database-level uniqueness constraints in `security_flags` so repeated 15-minute runs never insert duplicate flags for the same pattern and target on the same day.

---

### 10. Can a JavaScript File Really Be Hidden from Users? (§15)

**No**—any JavaScript or CSS file that a browser must download and execute to render the web application is inherently public; a browser fetching a `<script>` tag sends an ordinary HTTP GET request that cannot be reliably distinguished from a user typing the URL directly or inspecting the DevTools Sources tab. Attempting to "hide" or obfuscate frontend JavaScript only creates security through obscurity and breaks legitimate page loads if blocked. In Bantai, we treat the entire `frontend/` bundle as public and untrusted: client-side JavaScript exists solely for user experience (instant field feedback, live password strength meter, lockout countdowns), while **all real security enforcement**—input validation, CAPTCHA verification, progressive lockouts, IP blocking, OTP verification, password history, encryption keys, database secrets, and the CLI monitoring script—lives strictly on the Express backend (`backend/src/`) and PostgreSQL database (`supabase/`), completely inaccessible from the browser.
