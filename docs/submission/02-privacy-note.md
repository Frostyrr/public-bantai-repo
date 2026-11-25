# Privacy Note — Data Privacy Act of 2012 (Republic Act No. 10173)

**System:** Bantai — Collaborative Financial Management System for Organizations  
**Course:** IT 107 · Information Assurance and Security 1 (Criterion P5 / CO1)

---

## 1. Purpose and Legal Basis

Bantai collects and processes personal data solely to authenticate users, prevent unauthorized access to organization financial records, maintain accountable audit trails, and comply with the **Data Privacy Act of 2012 (Republic Act No. 10173)** and its Implementing Rules and Regulations (IRR).

Under RA 10173:
* **Personal Information (Section 3(g)):** Any information from which the identity of an individual is apparent or can be reasonably and directly ascertained.
* **Sensitive Personal Information (Section 3(l)):** Personal information about an individual's age, date of birth, government-issued identifiers, health, education, or information specifically established by law to be kept classified.

Before any account is created, the registration form displays a link to the **Privacy Notice** (`/privacy`) and requires an unchecked-by-default consent checkbox:
> *"I have read the Privacy Notice and agree to the collection and processing of my personal data in accordance with the Data Privacy Act of 2012 (RA 10173)."*

Registration is refused server-side if consent is not explicitly recorded, and the exact timestamp of consent is stored in the database.

---

## 2. Field-by-Field Classification and Justification

### A. Core Registration & Account Fields

| Field | RA 10173 Classification | Why It Is Needed (Proportionality & Purpose) | Storage & Security Protection | Retention |
|---|---|---|---|---|
| **ID Number (`xxxx-xxxx`)** | Sensitive Personal Information (institutional identifier) | Uniquely identifies each registered student/member and prevents duplicate accounts across organizations. | Stored as a unique identifier; validated server-side; never exposed in public endpoints. | Retained while account is active; anonymized or purged upon approved deletion. |
| **First Name, Middle Name, Family Name, Name Extension** | Personal Information | Identifies the individual for officer accountability, financial approval attribution, and member directory matching. | Stored in `profiles`; validated against injection/XSS characters; output-escaped in all views. | Retained while account is active and in immutable financial audit snapshots as required for accounting integrity. |
| **Birthdate & Age** | Sensitive Personal Information (Sec. 3(l)(1) — age/DOB) | Verifies that the registrant meets the minimum legal age requirement (18 years old) to enter into platform terms and manage organization funds. Age is recalculated server-side from Birthdate. | Stored in `profiles`; restricted via PostgreSQL RLS to the account owner and authorized platform oversight. | Retained while account is active; purged on account closure. |
| **Address (Purok/Street, Barangay, Municipality/City, Province, Country, ZIP Code)** | Personal Information | Establishes verifiable resident/member identity for organization governance and dispute resolution in financial stewardship. | Stored in user profile records with strict RLS (owner-only access); never exposed to other members or public pages. | Retained while account is active; purged on account closure. |
| **Email Address** | Personal Information | Primary verified communication channel for account activation OTPs, two-step login OTPs, password recovery codes, and automated security alert emails. | Stored normalized in lowercase; unique constraint; verified via 6-digit OTP before account activation. | Retained while account is active. |
| **Enrolled MFA Contact Email** | Personal Information (Security Factor) | Destination address for high-assurance login and recovery OTP challenges. | **Encrypted at rest using AES-256-GCM** with per-record random IV (`enrolled_email_ciphertext` / `pending_email_ciphertext`) in `bantai_private.email_mfa`. | Deleted immediately when Email MFA is disabled or account is deleted. |
| **Username** | Personal Information | Human-readable login identifier and workspace handle (`@username`) that avoids exposing the user's email address to other workspace members. | Normalized to lowercase; 6–20 alphanumeric characters starting with a letter; unique index. | Retained while account is active. |
| **Password** | Security Credential (Authentication Secret) | Primary knowledge factor proving account ownership during sign-in. | **Never stored in plaintext.** One-way hashed (bcrypt via Supabase Auth); last 3 password hashes stored in `bantai_private.password_history` to prevent reuse. | Current hash retained while active; rolling history of last 3 hashes maintained for reuse prevention. |
| **Three Authentication Questions & Answers** | Security Credential (Recovery Factor) | Secondary knowledge-based verification gate during password recovery before issuing a reset OTP. | Answers are normalized (trimmed, lowercased) and **one-way hashed with per-record salt** (`scrypt` / salted digest) in `bantai_private`; plaintext answers are never stored. | Retained while recovery questions are enabled; replaced on update or purged on deletion. |
| **Privacy Consent & Timestamp** | Compliance Record | Legal proof that the data subject gave informed, freely given consent under RA 10173 prior to data processing. | Stored with UTC/PHT timestamp alongside the account creation record. | Retained for the lifetime of the account and compliance audit period. |

### B. System-Specific Fields

| Field | RA 10173 Classification | Why It Is Needed | Storage & Security Protection | Retention |
|---|---|---|---|---|
| **Organization Type** | Non-Personal / Organizational Metadata | Tailors workspace terminology, directory columns, and financial reporting templates (e.g., student org vs. club vs. nonprofit). | Validated against strict server-side enum allow-list. | Retained for the lifetime of the organization. |
| **Preferred Reporting Currency** | Non-Personal / Preference Metadata | Formats budgets, collections, expenses, and financial summaries accurately for the workspace. | Validated against ISO-4217 allow-list (`PHP`, `USD`, etc.). | Retained for the lifetime of the organization. |
| **Workspace Display Name** | Personal Information (Optional) | Allows members to display a preferred nickname or officer title inside a specific organization without modifying their legal profile or rewriting historical audit logs. | Sanitized against control chars and HTML angle brackets; scoped per organization membership. | Retained while membership is active; cleared on user request. |

### C. Security Telemetry & Operational Metadata

| Field | RA 10173 Classification | Why It Is Needed | Storage & Security Protection | Retention |
|---|---|---|---|---|
| **IP Address & User-Agent** | Personal Information (Online Identifier) | Required for server-side IP blocking (10 failures in 10 minutes), anomaly detection (account targeted from 3+ IPs), and informing account owners of suspicious sign-in attempts in security alert emails. | Stored in append-only `public.security_events` and `public.source_restrictions`; readable only by Platform Administrators; output-escaped on dashboard. | Retained in append-only security logs per monitoring retention policy. |
| **One-Time Passwords (OTPs)** | Ephemeral Security Credential | Proves inbox possession for registration, login, and password reset. | Stored **hashed (HMAC-SHA256)** with 5-minute expiry and 3-attempt limit; invalidated immediately upon use, expiry, or resend. | Ephemeral (expires in 5 minutes; cleared upon verification or cancellation). |

---

## 3. Data Subject Rights & Contact

In accordance with **Section 16 of RA 10173**, registered users have the right to be informed, access their personal data, rectify inaccurate profile details (via Account Settings), object to or withdraw consent, and request account erasure subject to statutory and financial audit retention rules. Privacy inquiries are handled via the platform's Contact page (`/contact`) and documented in the public Privacy Policy (`/privacy`).
