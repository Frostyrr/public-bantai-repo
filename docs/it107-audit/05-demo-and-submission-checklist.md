# Demo and submission checklist

- [ ] CP1 in lab. Signed Appendix A, approved system name and fields, Git and ignore file, received test mail. Confirm how an existing project fits the approval-before-registration rule. The revised seed table is waived.
- [ ] CP2 in lab. Core and system fields, dual validation, exact feedback, consent and timestamp, registration OTP and CAPTCHA.
- [ ] CP3 in lab. Login OTP, exact tiers, alert delivery, recovery and event recording.
- [ ] CP4 in lab. All 13 protections, privileged dashboard and runnable private CLI.
- [ ] Attach actual checkpoint attendance and genuine signed proposal. Git has 217 HEAD commits dated 12–17 November 2026, which falls short of four weeks. Verify meaningful messages and explain actual project chronology.
- [ ] Submit sanitized SQL dump with at least five synthetic records and equivalent users, answers, OTPs, activity log, flags, history and IP blocks.
- [ ] Complete Appendix B with 13 threat/weakness/control/CIA/observed test rows.
- [ ] Finalize the [Design Decisions](06-design-decisions.md) in the student's own words.
- [ ] Submit Privacy Note with classification, necessity, purpose and retention for each field, plus full error-message mapping using the [matrix](01-compliance-matrix.md).
- [ ] Submit one authentic dated Appendix C page per week with work, challenges, solutions, lessons and commit count.
- [ ] Prepare one isolated admin and two ordinary synthetic users with accessible test inboxes. Keep credentials out of submissions and logs.

## Section 18 self-tests

Original order. Run dynamic steps with approved synthetic fixtures in an isolated environment. For SQL injection and XSS, use defensive verification and existing authorized regression evidence.

| ID | Requirement | Preconditions | Test step | Expected | Existing evidence and status |
|---|---|---|---|---|---|
| ST01 | S1/S2 | Synthetic account, challenge and encrypted reference | Inspect redacted schema/storage and compare authorized owner display | No readable password, answer, OTP or protected field at rest | Pending, no qualifying storage test |
| ST02 | S3 | Synthetic invalid registration fixture | Exercise server contract without client validation | Field-specific server refusal | Gap, registration requirements missing |
| ST03 | S4 | Disposable account/clock | Record three failed fixture attempts, then retry from fresh browser state while locked | Denial throughout tier-1 deadline | Gap, no tier; sourceRestrictionCooldown.test.ts covers different policy and was not run |
| ST04 | F7 | Tier-1 fixture and controlled inbox | Trigger one transition and inspect redacted receipt | One email with time, IP and browser | Gap, no sender; template tests passed only |
| ST05 | S5 | Pending login challenge fixture | Request user page and authorized test data routes before code verification | No usable session or protected content | Gap, current password endpoint issues tokens; session tests cover separate policy |
| ST06 | S5 | New browser profile | Open reset URL and assert no authorized password form/write | Only request stage is available | Partial, client stage observed; recovery.test.ts not run |
| ST07 | F3 | Fixed challenge fixture | Record three wrong values then use known fixture code | Correct code now rejected | Pending, managed counter unknown |
| ST08 | F3 | Synthetic challenge and clock | Check validity at 299 and 300 seconds | Expired code refused | Pending, template test does not verify Auth |
| ST09 | S6 | Static query review and approved regression evidence | Check parameter binding and invalid-input rejection for the handout scenario | No unintended authentication or SQL error | Pending, full query review |
| ST10 | S6 | Synthetic event containing inert angle-bracket text | Inspect rendering, email and export context | Literal text, no markup execution | Pending, escaped mock email passed |
| ST11 | S7 | Isolated form/route fixture | Omit CAPTCHA or required CSRF credential in separate checks | Request refused by authority | Partial, mock TURNSTILE-01/07 passed, CSRF interpretation pending |
| ST12 | S9 | Existing and nonexistent synthetic identities | Compare rejected UI/status/body/timing and outward effects | Equivalent result | Pending, source wording differs |
| ST13 | F5/S1 | Synthetic password history fixture | Request new password matching current and previous fixture entries | Reuse refused without state change | Gap, no history |
| ST14 | S8 | 900-second policy without exemption | Observe minute 14 and 15 during passive polling then resume | Warning, expiry and rejection | Partial, verified-session tests passed for middleware/SQL fixture only |
| ST15 | S5 | Ordinary synthetic user | Open admin route and verify response/event | Denied, no admin data, denial event | Partial, role checks present; platformAdmin.test.ts not run |
| ST16 | S5 | Logged-out client | Request admin JSON endpoint | No monitoring data | Pending, middleware tests only |
| ST17 | F9 | Isolated deployment and monitor artifact | Check HTTP response and deployed manifest for private script path | No execution/source and not found where required | Gap, proposed CLI absent |
| ST18 | S11 | Synthetic journal and application role | Inspect UI/actions and prove UPDATE/DELETE refused in disposable database | No edit/delete/clear or row mutation | Gap, aggregate writer updates rows |
| ST19 | S10 | Reachable Git refs and built artifact inventory | Scan redacted, examine category/path/commit only | No actual credentials | Pending, limited metadata-only scan done |
| ST20 | F4 | Synthetic account and precise clock | Exercise all three tier deadlines in fixture | 15/30/60 seconds and both actions disabled | Gap, no countdown |

## Twenty-minute presentation

| Time | Actions |
|---|---|
| 0:00–2:00 | Register with one bad input, show exact error, submit valid synthetic details and enter the emailed registration code. |
| 2:00–4:00 | Verify password login with email OTP. Use second test user for three failures, countdown and alert inbox receipt. |
| 4:00–6:00 | Demonstrate question and recovery OTP, change password, run CLI and open dashboard. |
| 6:00–12:00 | Explain four instructor-picked paths. Prepare registration schema/consent, password/OTP/session, lockout and trusted proxy, Auth/RLS and admin roles, outbox/events/CLI. |
| 12:00–20:00 | Implement and explain an unseen requirement without AI. Rehearse finding handlers, validators, role checks and tests quickly. |

Keep only app, code editor, inbox and terminal open. Rehearse realistic inbox delay. Obtain approval for any local inbox substitute.

## Section 19 rubric crosswalk

Fractional points represent analyst-assigned readiness for evidenced partial features. Live performance is uncredited. The explainability rule still applies on assessment day. The provisional estimate is **14/100**.

| ID | Maximum | Estimate | CO | Criterion | Matrix section |
|---|---:|---:|---|---|---|
| F1 | 3 | .5 | CO5 | Core/system registration and exact validation | 2–5 |
| F2 | 1 | .5 | CO1 | Privacy Notice and consent | 4 |
| F3 | 4 | 1 | CO3 | All three OTP flows and rules | 6 |
| F4 | 3 | 0 | CO3 | Lockouts, countdown and disabled controls | 8 |
| F5 | 3 | 1 | CO3 | Forgot/Change Password end to end | 5,10–11 |
| F6 | 1 | .5 | CO5 | CAPTCHA on all forms | 7 |
| F7 | 2 | 0 | CO4 | Alerts at the correct trigger with correct content | 9 |
| F8 | 2 | 1 | CO4 | Complete monitoring dashboard | 13 |
| F9 | 1 | 0 | CO4 | CLI detects four patterns and writes flags | 14 |
| S1 | 2 | .5 | CO3 | Passwords, answers and OTPs hashed | 4–6 |
| S2 | 2 | 0 | CO3 | AES-256 field encryption | 12.13 |
| S3 | 2 | .5 | CO5 | Server validation without client script | 4,12 |
| S4 | 3 | 1 | CO5 | Server lockout and IP blocking | 8,12.5 |
| S5 | 3 | 1 | CO3 | Guard OTP, reset, dashboard and data | 6,10,13 |
| S6 | 4 | 1 | CO5 | SQL injection/XSS resistance including logs | 12.1–2,13 |
| S7 | 3 | .5 | CO5 | Server CSRF and CAPTCHA | 7,12.3 |
| S8 | 2 | 1 | CO3 | Session hardening and idle timeout | 8.4,12.6 |
| S9 | 1 | 0 | CO2 | No username enumeration | 8,10,12.4 |
| S10 | 2 | .5 | CO5 | Git secrets, safe errors and headers | 12.10–12,15 |
| S11 | 1 | .5 | CO4 | Append-only events and read-only dashboard | 13 |
| D1 | 8 | 0 | CO5 | Run all live flows | 17 |
| D2 | 12 | 0 | CO2 | Explain four code paths | 17 |
| A1 | 6 | 0 | CO5 | New live requirement works | 17 |
| A2 | 4 | 0 | CO5 | Explain implementation and reasoning | 17 |
| G1 | 5 | 1 | CO5 | Consistent name/header/footer/state navigation | 3 |
| G2 | 5 | 1 | CO5 | Field clarity and countdowns | 3–4,8 |
| G3 | 5 | 0 | CO5 | Readable responsive layout and dashboard | 19 |
| P1 | 3 | .5 | CO5 | Meaningful history, four weeks and checkpoints | 16 |
| P2 | 2 | 0 | CO5 | Weekly journal | Appendix C |
| P3 | 2 | 0 | CO2 | Threat Model with CIA | Appendix B |
| P4 | 1 | .5 | CO3 | Reasoned design decisions | 4–16 |
| P5 | 1 | 0 | CO1 | Field-level Privacy Note | 4,16 |
| P6 | 1 | 0 | CO5 | Full error-message mapping | 4,16 |
| Total | 100 | 14 | | Functionality 20 · Security 25 · Live demo 20 · Additional requirement 10 · Design/UI 15 · Documentation/process 10 | [Compliance matrix](01-compliance-matrix.md) |
