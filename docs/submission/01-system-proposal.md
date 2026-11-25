# Appendix A — System Proposal

**Course:** IT 107 – Information Assurance and Security 1  
**School:** Caraga State University – BS Information Technology

## System Details

| Field | Details |
|---|---|
| System Name | Bantai – Organization Finance Management System |
| Who Uses It | Student organization officers (Owner, Admin, Treasurer, Auditor), regular members, and System Administrators. |
| What It Stores | User accounts and personal details, organization memberships and roles, member lists, dues and payments, budgets, expenses, reimbursements, and security activity logs. |
| Why Accounts Need Protecting | The system holds personal user details and organization money records. If an account is hacked, someone could steal personal data, fake expense approvals, or change financial records. |
| Sensitive Field to Encrypt (Protection 13) | Enrolled MFA Email Contact – encrypted in the database using AES-256 with a random IV, and decrypted only when needed to send an OTP or show it to the account owner. |

## System-Specific Fields

| Field Name | Kind | Required? | Rule | Error Message |
|---|---|---|---|---|
| ID Number | Formatted text | Required | Format xxxx-xxxx (4 digits, dash, 4 digits). Must be unique. | ID Number must follow the format xxxx-xxxx. / This ID Number is already registered. |
| Organization Type | Dropdown | Required | Must be one of: student, workplace, club, nonprofit, other. Checked on the server. | Please select a valid organization type. |
| Preferred Currency | Dropdown | Required | Must be one of: PHP, USD, EUR, GBP, JPY, CAD, AUD, SGD. Checked on the server. | Choose a supported currency. |
| Workspace Display Name | Free text | Optional | Up to 80 characters. No special HTML symbols (< or >) or control characters. | Enter a display name without control characters or angle brackets. |

## Security Settings Used

- Minimum username length: 6 characters
- Maximum username length: 20 characters
- Minimum password length: 8 characters (max 64)
- Maximum length of each name field: 50 characters
- Failed logins before "Forgot Password?" appears: 2
- Lockout tier 1 (3 failed logins): 15 seconds
- Lockout tier 2 (6 failed logins): 30 seconds
- Lockout tier 3 (9 failed logins): 60 seconds
- OTP expiry: 5 minutes
- Idle session timeout: 15 minutes (with 1-minute warning)
- IP block threshold: 10 failures in 10 minutes (blocks IP for 10 minutes)
- Authentication questions: User picks 3 different questions from the 8-question bank in Section 5

## Instructor's Decision

- [ ] Approved
- [ ] Revise and resubmit

**Signature and Date:** ______________________________
