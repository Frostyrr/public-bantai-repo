# Error Message Mapping

**System:** Bantai – Organization Finance Management System

Every rule below is checked in the browser and on the server. Each error names the exact mistake.

## 1. Core Registration Fields

| Field | Rule | Exact Error Message |
|---|---|---|
| ID Number | Required; format xxxx-xxxx (4 digits, dash, 4 digits) | ID Number must follow the format xxxx-xxxx. |
| ID Number | Must be unique | This ID Number is already registered. |
| First Name | Required; 2 to 50 characters | First Name must be between 2 and 50 characters. |
| First Name | First letter of each word capital, rest small | First letter of your name must be capital. |
| First Name | Not all capital letters | Do not use all capital letters. |
| First Name | Letters only (no numbers) | Numbers are not allowed in First Name. |
| First Name | No special characters or HTML symbols | Special characters are not allowed in First Name. |
| First Name | No double spaces | Double space is not allowed. |
| First Name | No 3 identical letters in a row | Three consecutive identical letters are not allowed. |
| Middle Name (optional) | Same rules as First Name if filled (2–50 chars) | Same messages as First Name (with "Middle Name"). |
| Family Name | Same rules as First Name (required, 2–50 chars) | Same messages as First Name (with "Family Name"). |
| Name Extension (optional) | Jr., Sr., or Other (e.g., I, II, III, IV, IX, X); no digits/symbols | Special characters are not allowed in Name Extension. / Numbers are not allowed in Name Extension. |
| Birthdate & Age | Required; valid date, not in the future | Enter a real date that is not in the future. |
| Birthdate & Age | Must be at least 18 years old (checked on server) | You must be at least 18 years old to register. |
| Purok / Street | Required; 3–50 chars; letters, digits, single spaces | Purok / Street must be 3 to 50 characters using letters, numbers, and single spaces. / Double space is not allowed. |
| Barangay | Required; 2–50 chars; letters and spaces; Title Case | Barangay must be 2 to 50 letters in Title Case. |
| Municipality / City | Required; 2–50 chars; letters and spaces; Title Case | Municipality / City must be 2 to 50 letters in Title Case. |
| Province | Required; 2–50 chars; letters and spaces; Title Case | Province must be 2 to 50 letters in Title Case. |
| Country | Required; letters and spaces; Title Case | Country must contain letters and spaces in Title Case. |
| ZIP Code | Required; exactly 4 digits | ZIP Code must be exactly 4 digits. |
| Email | Required; valid email, no spaces, max 100 chars | Please enter a valid email address. |
| Email | Must be unique | This email is already registered. |
| Username | Required; 6–20 letters/digits, starts with a letter | Use 6 to 20 letters or digits, starting with a letter. |
| Username | Must be unique | This username is already taken. |
| Password | Required; 8–64 characters (max 72 UTF-8 bytes) | Use 8 to 64 characters. / Use at most 72 UTF-8 bytes. |
| Password | Strength must be Medium or Strong (Weak blocked) | Use a longer passphrase or mix letters, numbers, and symbols. |
| Re-enter Password | Must match Password | Passwords do not match. |
| Security Questions | User picks 3 different questions from Section 5 bank | Choose three distinct questions. |
| Security Answers | Required; 2–50 chars; letters and single spaces only | Use at least two characters. / Answers may contain letters and single spaces only. |
| Privacy Consent | Required checkbox (unchecked by default) | You must agree to the Privacy Notice to register. |

## 2. System-Specific Fields

| Field | Rule | Exact Error Message |
|---|---|---|
| Organization Type | Required; must be student, workplace, club, nonprofit, or other | Please select a valid organization type. |
| Preferred Currency | Required; must be PHP, USD, EUR, GBP, JPY, CAD, AUD, or SGD | Choose a supported currency. |
| Organization Name | Required; 2–150 characters | Name must be at least 2 characters. / Name cannot exceed 150 characters. |
| Workspace Display Name (optional) | Max 80 characters; no `<`, `>`, or control characters | Enter a display name without control characters or angle brackets. |

## 3. Login, OTP, Lockout & Password Reset Messages

| Case | Exact Message |
|---|---|
| Wrong username or wrong password | Invalid username or password. |
| Account locked (15s / 30s / 60s) or IP blocked (10 fails / 10 min) | Too many failed sign-in attempts. Try again in {seconds} seconds. |
| Missing or invalid CAPTCHA | Security verification failed. Please complete the challenge and try again. |
| Wrong, expired (> 5 min), or cancelled OTP (3 wrong tries) | Could not complete verification. Verify a fresh code using your selected verification method, then try again. |
| Direct access to Change Password without verified OTP | Verify your email recovery code first. / Recovery session expired. Request a new email code. |
| Reusing any of the last 3 passwords | You cannot reuse a recent password. |
| Change Password mismatch / success | Mismatch Password / Successfully Change Password |
| Idle warning (1 min before 15-min timeout) | Your session will end within one minute if you stay idle. |
| Idle timeout reached | Your session timed out. Please sign in again. |
| Normal user opening Admin Dashboard | Access denied |
