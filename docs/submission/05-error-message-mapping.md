# Error Message Mapping

**System:** Bantai — Collaborative Financial Management System for Organizations  
**Course:** IT 107 · Information Assurance and Security 1 (Criterion P6 / CO5)

This table maps **every validation rule** across all core registration fields, system-specific fields, and authentication/recovery flows to its **exact error message** enforced in both browser validation and server-side validation. Generic messages such as `"Invalid input"` are never used.

---

## 1. Core Registration Fields

| Field | Validation Rule | Example Failing Input | Exact Error Message | Enforcement Location |
|---|---|---|---|---|
| **ID Number** | Required; format `xxxx-xxxx` (4 digits, hyphen, 4 digits) | `1234-567`, `abcd-1234`, empty | `ID Number must follow the format xxxx-xxxx.` | Client & Server |
| **ID Number** | Must be unique (Primary Key) | Existing `2026-0001` | `This ID Number is already registered.` | Server / DB Unique Constraint |
| **First Name** | Required; min 2 chars, max **50 characters** | `""`, `"A"`, 51+ chars | `First Name must be between 2 and 50 characters.` | `identity.ts`, `personalIdentity.ts` |
| **First Name** | First letter of each word must be capital, rest lowercase | `juan`, `juan carlo` | `First letter of your name must be capital.` | Client & Server |
| **First Name** | Must not be all capital letters | `JUAN`, `JUAN CARLO` | `Do not use all capital letters.` | Client & Server |
| **First Name** | Letters only — no digits or digit-prefixed words | `Ju4n`, `4nn` | `Numbers are not allowed in First Name.` | Client & Server |
| **First Name** | No special characters or HTML/control characters | `Juan!`, `<script>` | `Special characters are not allowed in First Name.` | Client & `personalIdentity.ts` |
| **First Name** | No double spaces | `Juan  Carlo` | `Double space is not allowed.` | Client & Server |
| **First Name** | No three consecutive identical letters (case-insensitive) | `Juaaan`, `JuAaan` | `Three consecutive identical letters are not allowed.` | Client & Server |
| **Middle Name** *(optional)* | If provided, min 2 chars, max **50 characters** | `"A"`, 51+ chars | `Middle Name must be between 2 and 50 characters.` | `identity.ts`, `personalIdentity.ts` |
| **Middle Name** *(optional)* | If provided, same Title Case / no-all-caps / letters-only / no-double-space / no-triple-letter rules | `delos`, `DELOS`, `D3los`, `Delos!`, `De  Los`, `Saaantos` | `First letter of your name must be capital.` / `Do not use all capital letters.` / `Numbers are not allowed in Middle Name.` / `Special characters are not allowed in Middle Name.` / `Double space is not allowed.` / `Three consecutive identical letters are not allowed.` | Client & Server |
| **Family Name** | Required; min 2 chars, max **50 characters** | `""`, `"D"`, 51+ chars | `Family Name must be between 2 and 50 characters.` | `identity.ts`, `personalIdentity.ts` |
| **Family Name** | Same Title Case / no-all-caps / letters-only / no-double-space / no-triple-letter rules | `reyes`, `REYES`, `R3yes`, `Reyes@`, `Dela  Cruz`, `Reeeyes` | `First letter of your name must be capital.` / `Do not use all capital letters.` / `Numbers are not allowed in Family Name.` / `Special characters are not allowed in Family Name.` / `Double space is not allowed.` / `Three consecutive identical letters are not allowed.` | Client & Server |
| **Name Extension** *(optional)* | Dropdown (`Jr.`, `Sr.`, `Other`); custom value allows Roman numerals (`I`, `II`, `III`, `IV`, `IX`, `X`) or valid suffix without digits/special chars | `Jr!`, `3rd` | `Special characters are not allowed in Name Extension.` / `Numbers are not allowed in Name Extension.` | Client & Server |
| **Birthdate & Age** | Required; valid calendar date `YYYY-MM-DD`, not in the future | `2030-01-01`, `2026-02-30` | `Enter a real date that is not in the future.` | `identity.ts`, `personalIdentity.ts` |
| **Birthdate & Age** | Server-recalculated age must be at least 18 years old | Age 17 | `You must be at least 18 years old to register.` | Client & Server |
| **Purok / Street** | Required; 3–50 chars; letters, digits, spaces; no double spaces | `P1`, `Purok  2`, `St#1` | `Purok / Street must be 3 to 50 characters using letters, numbers, and single spaces.` / `Double space is not allowed.` | Client & Server |
| **Barangay** | Required; 2–50 chars; letters and spaces; Title Case | `ampayon`, `Brgy 1` | `Barangay must be 2 to 50 letters in Title Case.` | Client & Server |
| **Municipality / City** | Required; 2–50 chars; letters and spaces; Title Case | `butuan`, `Butuan1` | `Municipality / City must be 2 to 50 letters in Title Case.` | Client & Server |
| **Province** | Required; 2–50 chars; letters and spaces; Title Case | `agusan`, `AGUSAN` | `Province must be 2 to 50 letters in Title Case.` | Client & Server |
| **Country** | Required; letters and spaces; Title Case | `philippines`, `PH1` | `Country must contain letters and spaces in Title Case.` | Client & Server |
| **ZIP Code** | Required; exactly 4 digits | `860`, `86000`, `860a` | `ZIP Code must be exactly 4 digits.` | Client & Server |
| **Email** | Required; valid email format, no spaces, max 100 chars (stored lowercase) | `juan@`, `a b@c.com` | `Please enter a valid email address.` | Client & Server (`/auth/register`) |
| **Email** | Must be unique | Existing email | `This email is already registered.` *(generic on unauthenticated signup: `Check your email or sign in with your existing account.`)* | Server (`/auth/register`) |
| **Username** | Required; **6–20 characters**, starts with a letter, letters and digits only (`^[a-z][a-z0-9]{5,19}$`) | `abc`, `1user01`, `user_name!` | `Use 6 to 20 letters or digits, starting with a letter.` | `usernameAvailability.ts`, `personalIdentity.ts` |
| **Username** | Must be unique (live availability check + server check) | Taken username | `This username is already taken.` | `/auth/username-availability`, DB Unique Index |
| **Password** | Required; **8–64 characters** | `Pass1!`, 65+ chars | `Use 8 to 64 characters.` | `passwordPolicy.ts`, `personalIdentity.ts` |
| **Password** | Must not exceed 72 UTF-8 bytes (bcrypt boundary) | Multi-byte string > 72 bytes | `Use at most 72 UTF-8 bytes.` | `passwordPolicy.ts`, `personalIdentity.ts` |
| **Password** | Strength meter must be **Medium** or **Strong** (Weak blocked: predictable or < 3 character classes and < 16-char passphrase) | `password123`, `aaaaaaaa` | `Use a longer passphrase or mix letters, numbers, and symbols.` | `passwordPolicy.ts`, `personalIdentity.ts` |
| **Re-enter Password** | Must match Password | Non-matching confirmation | `Passwords do not match.` | Client & Server |
| **Authentication Questions** | Must select **3 distinct questions** from the 8-question bank (Section 5) | Duplicate question ID or < 3 selected | `Choose three distinct questions.` | `securityQuestions.routes.ts`, `bantai_sq_action` |
| **Authentication Answers** | Required for all 3 questions; 2–50 chars; letters and spaces only; no double spaces | `"A"`, `Pet1!`, `My  Pet` | `Use at least two characters.` / `Answers may contain letters and single spaces only.` | `securityQuestions.routes.ts` |
| **Privacy Consent** | Required checkbox (unchecked by default) under RA 10173 | Unchecked box | `You must agree to the Privacy Notice to register.` | Client & Server |

---

## 2. System-Specific Fields

| Field | Validation Rule | Example Failing Input | Exact Error Message | Enforcement Location |
|---|---|---|---|---|
| **Organization Type** | Required; allow-listed enum (`student`, `workplace`, `club`, `nonprofit`, `other`) | Tampered dropdown value `admin_org` | `Please select a valid organization type.` | `organizations.routes.ts` (`organizationType` Zod enum) |
| **Preferred Reporting Currency** | Required; allow-listed ISO-4217 code (`PHP`, `USD`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD`, `SGD`) | Tampered value `BTC` | `Choose a supported currency.` | `organizations.routes.ts` (`createOrgSchema`) |
| **Organization Name** | Required; 2–150 characters (trimmed) | `"A"`, 151+ chars | `Name must be at least 2 characters.` / `Name cannot exceed 150 characters.` | `organizations.routes.ts` (`createOrgSchema`) |
| **Workspace Display Name** *(optional)* | Optional; max 80 characters; no control characters or `<` / `>` | `<img src=x>`, 81+ chars | `Enter a display name without control characters or angle brackets.` | `organizations.routes.ts` (`/my-profile`) |

---

## 3. Authentication, OTP, Lockout, Recovery & Password Change Messages

| Flow / Condition | Exact Error / Status Message | Enforcement Location |
|---|---|---|
| Invalid login payload | `Please enter a valid username or email and password.` | `backend/src/index.ts` (`/auth/login`) |
| Wrong username OR wrong password (anti-enumeration) | `Invalid username or password.` *(with remaining-attempts hint when <= 2 left before lockout)* | `backend/src/index.ts` (`/auth/login`) |
| Progressive lockout active (Tier 1: 15s, Tier 2: 30s, Tier 3: 60s) or IP blocked (10 failures / 10 min) | `Too many failed sign-in attempts. Try again in {retryAfter} seconds.` (`HTTP 429` + `Retry-After`) | `backend/src/index.ts`, `bantai_login_restriction` |
| CAPTCHA missing, expired, or invalid | `Security verification failed. Please complete the challenge and try again.` | `backend/src/index.ts`, `turnstile.ts` |
| Rate limiter triggered on signup / login / recovery | `Too many login attempts. Please wait 15 minutes before trying again.` / `Too many signup attempts. Please wait and try again.` | `backend/src/index.ts`, `rateLimit.ts` |
| OTP missing, wrong, expired (> 5 min), or cancelled (3 wrong attempts) | `Could not complete verification. Verify a fresh code using your selected verification method, then try again.` | `emailMfa.routes.ts`, `securityQuestions.routes.ts` |
| Direct access to Change Password without verified recovery OTP + proof | `Verify your email recovery code first.` / `Recovery session expired. Request a new email code.` | `securityQuestions.routes.ts` (`recoveryIdentity`) |
| Password reuse (matches any of the last 3 passwords) | `You cannot reuse a recent password.` | `passwordHistory.service.ts` |
| Change Password mismatch / success | `Mismatch Password` / `Successfully Change Password` | `ResetPassword.tsx` / `AccountSettings.tsx` |
| Idle session warning (1 minute remaining of 15-min timeout) | `Your session will end within one minute if you stay idle.` | `AppContainer.tsx` (`X-Session-Idle-Remaining`) |
| Session timed out (15 minutes idle) | `Your session timed out. Please sign in again.` | `bantai_gateway.check_session`, `authenticate.ts` |
| Non-admin accessing Admin Monitoring Dashboard | `Access denied` (logged as `ADMIN_ACCESS_DENIED`) | `admin.routes.ts`, `AdminDashboard.tsx` |
