# Privacy Note (RA 10173 — Data Privacy Act of 2012)

**System:** Bantai – Organization Finance Management System

Before creating an account, users must read the Privacy Notice page (`/privacy`) and check an unchecked box agreeing to the collection of their data under Republic Act No. 10173. If the box is not checked, the server blocks registration. We also save the exact date and time the user agreed.

## Field Classification and Purpose

| Field | RA 10173 Type | Why It Is Needed | How It Is Protected |
|---|---|---|---|
| ID Number (xxxx-xxxx) | Sensitive Personal Information | Uniquely identifies each student or member so nobody can make duplicate accounts. | Checked on the server; unique in the database. |
| First, Middle, Family Name, Name Extension | Personal Information | Shows who owns the account and who submitted or approved financial records. | Validated for allowed characters; escaped when displayed. |
| Birthdate and Age | Sensitive Personal Information | Checks that the user is at least 18 years old. Age is calculated on the server from Birthdate. | Only the account owner and authorized admins can view it. |
| Address (6 fields) | Personal Information | Confirms member identity for organization records and accountability. | Private to the account owner; never shown to other users. |
| Email Address | Personal Information | Used to send 6-digit OTP codes for signup, login, password reset, and security alerts. | Stored in lowercase; verified by OTP before login is allowed. |
| Enrolled MFA Contact Email | Personal Information | Receives login and recovery OTP codes. | Encrypted at rest with AES-256 and a random IV. |
| Username | Personal Information | Lets users log in and identify themselves in workspaces without sharing their email. | 6–20 letters/numbers, stored lowercase, unique. |
| Password | Security Secret | Proves the user owns the account. | Never saved as plain text; hashed, plus last 3 hashes kept to block reuse. |
| 3 Security Questions & Answers | Security Secret | Confirms identity during Forgot Password before sending a reset OTP. | Answers are lowercased and hashed with a salt; never saved as plain text. |
| Privacy Consent Timestamp | Compliance Record | Proves the user gave consent before we stored their data. | Saved with date and time when the account is created. |
| Organization Type | Non-Personal Metadata | Sets up the right workspace labels (student org, club, etc.). | Checked against an allowed list on the server. |
| Preferred Currency | Non-Personal Metadata | Displays budgets and expenses in the right currency (e.g., PHP). | Checked against an allowed list on the server. |
| Workspace Display Name | Personal Information (Optional) | Lets a member show a nickname or officer title inside an organization. | Optional; blocks HTML symbols (< or >). |
| IP Address & Browser Info | Personal Information | Needed to block abusive IPs, detect attacks, and warn the owner in alert emails. | Stored in append-only security logs; visible only to admins. |
| 6-Digit OTPs | Temporary Secret | Confirms the user owns the email inbox. | Stored hashed; expires in 5 minutes; cancelled after 3 wrong tries. |

## Data Retention and User Rights

Personal data is kept only while the account is active (financial audit records keep basic attribution for transparency). Under RA 10173, users can view and update their profile in Account Settings, or contact the system admin via `/contact` to ask questions or request account removal.
