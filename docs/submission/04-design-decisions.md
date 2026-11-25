# Design Decisions

**System:** Bantai – Organization Finance Management System

This document answers every "Your Call" question from the IT 107 handout and explains why each choice was made.

## 1. Password Hashing Algorithm (§4.4)
We use **bcrypt** (through Supabase Auth) for account passwords and **scrypt** (with a random salt per record) for our password history table. Both are slow hashing algorithms made specifically for passwords, so even if someone steals the database, guessing passwords offline takes a very long time. Since bcrypt only reads up to 72 bytes, we also limit passwords to 64 characters / 72 bytes so nothing gets silently cut off.

## 2. What Makes a Password Strong? (§4.9)
Our strength meter rates passwords as **Weak**, **Medium**, or **Strong**, and blocks Weak passwords on both the browser and the server. A password is **Weak** if it is under 8 characters, over 64 characters, uses a common word or pattern (like `password123` or `bantai123`), or has fewer than 3 character types (lowercase, uppercase, numbers, symbols) without being a long passphrase. A valid password of 8–15 characters is **Medium**, and 16 or more characters (including 3+ word passphrases) is **Strong**. This stops easy-to-guess passwords while still letting users pick long passphrases that are easier to remember.

## 3. Why Hash Security Answers? (§5)
Security answers work like backup passwords during account recovery. If we saved them as plain text, anyone who got a copy of the database could read the answers and take over accounts. Instead, we convert each answer to lowercase (so "Bantay" and "bantay" both match) and hash it with a random salt before saving. Since we only ever need to check if a user's answer matches, we never need to store the original text.

## 4. Does a Failed CAPTCHA Count as a Failed Login? (§7)
No. A failed CAPTCHA is logged and rate-limited by IP address, but it does not count toward a user's login lockout. If it did, a bot could keep failing the CAPTCHA using someone's username just to lock that real user out of their account. Logging and limiting CAPTCHA failures by IP stops bots without hurting legitimate users.

## 5. Is "Disabling the Back Button" Enough After Logout? (§8.4)
No. Trying to block the browser Back button with JavaScript does not actually protect anything because a user can still open the URL directly or look at cached data. Real protection happens on the server: when a user logs out or hits the 15-minute idle timeout, the server marks the session as ended, sends `Cache-Control: no-store` so the browser does not cache private data, clears the app's local cache, and checks the session on every protected request before sending any data.

## 6. How Does the Verified User Reach Change Password? (§10)
A user cannot open Change Password just by typing `/password/reset` in the address bar. After the user passes the security question and enters the 6-digit recovery OTP, the server creates a short-lived, single-use recovery proof tied to that user and session. The Change Password endpoint checks that proof on the server before allowing a password update, and deletes the proof right after the password changes so it cannot be replayed or opened directly.

## 7. Hashing vs. Encryption (§12 Note)
Hashing is one-way and cannot be reversed. We use hashing for passwords, security answers, and 6-digit OTPs because we only need to check if what the user typed matches what is stored. Encryption is two-way and can be reversed with a secret key. We use AES-256 encryption (with a random IV) for the user's enrolled MFA email contact because the system actually needs to read that email back to send OTPs and display it to the account owner.

## 8. Should the App Database Account Be Allowed to Delete Logs? (§13.3)
No. The database role used by the web app can only add new rows and read logs—it cannot run `UPDATE` or `DELETE` on `security_events`. If an attacker ever broke into the web app, they would not be able to erase their tracks. The admin dashboard is also strictly read-only with no edit, delete, or clear buttons.

## 9. How to Run the Monitoring Script Every 15 Minutes (§14.2)
For the demo, we run `node supabase/scripts/security-monitor.mjs` manually from the terminal. In real use, we would schedule it every 15 minutes using **Windows Task Scheduler** (running `supabase/scripts/run-security-monitor.ps1` with "Do not start a new instance" turned on) or a Linux **cron** job (`*/15 * * * *`). Because the `security_monitor_flags` table blocks duplicate flags for the same pattern, target, and day, running it every 15 minutes will not create duplicate alerts.

## 10. Can a JavaScript File Really Be Hidden? (§15)
No. A browser has to download JavaScript files to run the page, so anyone can also view those same files in DevTools. Because of this, we never put secrets, database keys, or real security checks only in frontend JavaScript. Client-side JS is only there to help users (like showing errors right away and running countdowns). All real checks—validation, CAPTCHA, lockouts, IP blocks, OTPs, encryption, and the CLI monitor—run on the server and database where users cannot reach them.
