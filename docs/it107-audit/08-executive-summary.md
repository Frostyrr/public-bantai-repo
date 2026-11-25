# Bantai IT 107 compliance audit

**Decision: substantial additional work is required before the IT 107 demo.** Bantai is suitable as the subject of the proposal because its organization finances, member information and records need account and workspace access control. The present authentication flows and security monitoring diverge from several explicit course requirements.

React/Vite and Express use Supabase Auth, PostgreSQL with role/RLS enforcement, and Storage. Existing typed signup and recovery email codes, Google OAuth, opt-in authenticator MFA, session checks, Turnstile integration, and admin/security telemetry provide a base. Preserve these production paths and financial audit semantics. [Architecture and evidence](03-architecture-compatibility.md)

| Status | Count |
|---|---:|
| Compliant | 4 |
| Partial | 47 |
| Missing | 55 |
| Unverified | 22 |
| Instructor clarification | 4 |
| Total verification units | 132 |

Verified compliance is **3.0%** (4 ÷ 132 × 100). This is unweighted and counts individual verification units as defined in the matrix, including process and deployed/runtime evidence. Provisional rubric readiness is **14/100** using partial-feature credit and no credit for live performance. Seventeen focused local checks passed. Actual hosted settings, SMTP receipt, entire secret history, browser behavior and student performance remain unverified. [Matrix](01-compliance-matrix.md) · [Rubric and self-tests](05-demo-and-submission-checklist.md) · [Test evidence](07-test-plan.md)

## Ten priority gaps

1. Password login immediately creates and returns an Auth session. Course email OTP must precede issuance.
2. Recovery lacks the required question gate and demonstrated single-use server-side scope for password change.
3. Progressive account tier lockouts, exact countdown, recovery link gating and shared failure accounting are missing.
4. Current IP cooldown uses a different time window and event class. Trusted ingress and direct-path parity remain unverified.
5. Registration lacks most required fields, approved system-specific fields, full dual validation and server-persisted consent.
6. OTP lifetimes, invalidation, quotas and inbox delivery need isolated proof. Automatic tier security emails are missing.
7. Idle enforcement defaults and the super-admin exemption can defeat the required 15-minute timeout. A one-minute warning is missing.
8. Password history and an owner-only AES-256 field are missing.
9. Course append-only events, dashboard specifics and a four-rule command-line monitor are missing.
10. Signed proposal and checkpoint evidence are absent from the materials, and HEAD’s 217 commits span 12–17 November 2026. The four-week requirement needs an instructor discussion.

Authorization changes around Auth issuance, recovery and direct access affect OAuth, platform and workspace roles, REST and Storage. Course DOB, address and knowledge questions add privacy and security risks if collected from real users. Proceed with **Phase 0** first. Obtain the proposal and interpretation decisions, and prepare an isolated synthetic environment. Then complete registration, Auth/recovery, enforcement, monitoring and demonstration evidence in that order. [Gap analysis](02-security-gap-analysis.md) · [Implementation roadmap](04-implementation-roadmap.md) · [Design decisions](06-design-decisions.md)

Audited HEAD `ee20510464f544f6082c0758f4087962f42204ec`. Application and environment state were read only. The audit produced eight Markdown reports.
