# Login Notification Emails Research: Best Practices Survey

## Summary

Surveyed how identity leaders (Auth0, Okta, GitHub, Google, Slack, Notion, Vercel),
enterprise platforms (Microsoft Entra ID, SAP Cloud Identity Services, NetSuite), and
NIST guidance handle emailing users about login attempts and successful sign-ins, plus
mapped Carbon's existing email/auth infrastructure. The industry consensus is strong
and consistent: **nobody emails on every successful login** — the trigger is always an
*unrecognized device or location*; **failed attempts almost never get their own email**
— the alert-worthy failure event is the *lockout engaging* (Auth0's "Blocked Account
Email"); enterprise IdPs route routine sign-in telemetry to admins/audit logs, not end
users; and NIST 800-63B-4 makes user notification a SHALL only for account *mutations*
(new authenticator, recovery), not sign-ins. For passwordless products the field
splits: Slack/Vercel send nothing (the emailed code IS the alert), while Notion sends a
new-device alert anyway — because sessions can also start via OAuth where no email
factor was involved. Carbon has the same property (OAuth, SAML SSO, passkey), which
makes the Notion position the right one. Carbon already has every building block: a
durable `carbon/send-email` Inngest path, a security-email precedent that deliberately
bypasses notification preferences (`MfaEnabledEmail`), an email template that already
renders IP + geo (`InviteEmail`), structured auth events (`login_locked`,
`login_success`), and five precisely-located "first factor succeeded" hook points (the
`AccountLockout.reset()` call sites). What it lacks is any device/session recognition —
no session table, no device cookie, no login history.

## Competitors Surveyed

- **Auth0** — the reference for *failure-side* notifications (brute-force lockout email to the user)
- **Okta** — the reference for *success-side* notifications (new sign-on email, Report Suspicious Activity)
- **GitHub / Google** — consumer-scale new-device/new-location detection and "wasn't me" flows
- **Slack / Vercel / Notion** — passwordless products; Notion is the closest analog to Carbon's auth model
- **Microsoft Entra ID, SAP IAS, NetSuite** — the enterprise consensus (admin/audit-first)
- **NIST 800-53 AC-9, 800-63B(-4)** — the compliance floor

## Key Consensus Patterns

### 1. Successful-login emails fire only on *unrecognized* sign-ins, never on every login
- **Okta**: "New sign-on notification email" sent only for a new/unrecognized client (cookie/device-fingerprint based; new OS, new browser, unknown client).
- **GitHub**: unrecognized-*location* (country history) notification; unrecognized-*device* logins are instead gated by an emailed verification code (cookie-tracked, skipped when 2FA/passkey is used).
- **Google**: risk-based — new device, new browser, new location/IP, unusual pattern; delivered as "Critical security alert."
- **Notion** (passwordless): new-device alert with IP-derived approximate location and an explicit "best estimate" disclaimer.
- **Rationale**: per-login email is pure notification fatigue; users stop reading, which defeats the alert. "New context" is the signal.

### 2. Failed attempts don't get per-attempt emails; the lockout event does
- **Auth0**: the only built-in failure email is the "Blocked Account Email" when brute-force protection blocks the account/IP (threshold default 10), with a self-service unblock link — throttled to 1/hour per IP.
- **Google**: the exception — emails "Suspicious sign in prevented" when it *blocks* an attempt (still an event, not a counter).
- **Okta / GitHub / Slack / enterprise**: no end-user failed-attempt email at all; failures go to admin logs (Okta System Log, GitHub security log, Entra sign-in logs).
- **Rationale**: an attacker probing an account would otherwise generate a mailbox flood the user can do nothing about; the actionable moment is "your account is now locked / an attempt was blocked."

### 3. Enterprise platforms notify admins, not users, about sign-in anomalies
- **Entra ID**: Identity Protection risky-sign-in emails go to Global Admin / Security Admin / Security Reader; the risky *user* is interrupted in-session (step-up MFA, forced password change), not emailed.
- **SAP IAS**: "Send Security Alert Emails" covers account *changes* (password changed), not sign-ins; lockout (5 fails → 1 h) is an audit-log event (`Locked Login`, value 112).
- **NetSuite**: Login Audit Trail + saved-search reports for admins; its "Login Notification" feature is an on-screen compliance banner (AC-8), not an email.
- **Rationale**: in a workforce context there is a security team; the same signal that goes to a consumer's inbox goes to the admin/SIEM instead. A B2B product like Carbon should serve both: user email for the events only the user can judge, audit trail for admins.

### 4. Standard email content and actions
- **Content**: device/OS/browser (from user-agent), approximate location (IP geo, always disclaimed as approximate), IP, timestamp. Okta renders unknown components as "Unknown" rather than omitting them.
- **Actions**: "If this was you, ignore" + a secure-account path. Notion's one-click "This was not me" (kills that device's session) is the strongest; Okta's "Report Suspicious Activity" button (7-day link, writes a system-log event admins can automate on) is the enterprise version; Auth0's lockout email carries a self-service *unblock* link.
- **Anti-phishing note**: GitHub's alert format is heavily imitated by phishers — keep the template on-brand, link only to the app's own security page, never ask for credentials.

### 5. No per-user opt-out
- Google: critical security alerts cannot be disabled. GitHub/Notion: no opt-out documented. Okta/Auth0: **org/tenant-level admin toggles**, never per-user. GitLab has a years-open feature request for an opt-out — the industry default is mandatory.
- **Rationale**: the attacker controlling the account would disable the alert first. If configurability is wanted, it belongs at the company/tenant level.

### 6. Throttling is part of the design
- Auth0 throttles user-facing block emails to 1/hour per IP and breach alerts to 1/hour per user. Any lockout email Carbon sends needs the same guard — the lockout re-engages on continued hammering (exponential backoff levels), and each re-engagement must not re-email.

## Answers to Research Questions

1. **Should we email on every successful login?** No — no surveyed vendor does. Email on *unrecognized device/context* sign-ins (Okta, GitHub, Google, Notion).
2. **Should we email on failed attempts?** Not per-attempt. Email once when the account lockout engages (Auth0 pattern; Carbon already logs `login_locked` at exactly this point). Optionally throttled 1/hour.
3. **Does passwordless change the calculus?** Partially. For a magic-link login the email factor already proves inbox access, and Slack/Vercel send nothing. But Carbon sessions also start via Google/Azure OAuth, SAML SSO, and passkey — no email involved — which is why Notion (same shape) alerts anyway. At minimum, non-email-factor logins from a new device warrant the alert.
4. **How is "new device" detected?** Cookie/device-token recognition (Okta, GitHub) sometimes plus IP/geo history (GitHub country history, Google risk engine). Cleared cookies re-trigger — accepted as a false-positive cost. Carbon currently has **no** device recognition, session table, or login history; this is the one genuinely new piece to build.
5. **What goes in the email?** Timestamp, browser/OS from user-agent, IP, approximate city (disclaimed), login method (magic link / Google / SSO / passkey), and a CTA to the account security page. Carbon's `InviteEmail` already renders IP + `x-vercel-ip-city` — the precedent exists.
6. **What can the recipient do?** Carbon sessions are stateless signed cookies (no server-side session store), so a Notion-style "kill that session" one-click is not possible today. Realistic v1 CTA: link to `path.to.accountSecurity` (review passkeys/MFA, rotate factors) and instruct to contact the admin. A session-revocation story would require a session table — out of scope unless deliberately pulled in.
7. **Compliance drivers?** None mandate sign-in emails: SOC 2 CC7.x wants the *logging/monitoring*; NIST AC-9 is an optional at-logon display; NIST 800-63B-4 §4.6 SHALLs notification for authenticator binding and account recovery (Carbon's `MfaEnabledEmail` already covers the enrollment case). Sign-in alerts are a product/security-UX choice, not a checkbox.
8. **Opt-out?** No per-user opt-out (see pattern 5). Carbon precedent agrees: `mfa-email.server.ts` deliberately bypasses `notificationPreference` and the `EMAIL_NOTIFICATIONS` plan gate so security receipts can't be silenced.

## Competitor-Specific Details

### Auth0
Umbrella "Attack Protection": Brute-Force Protection (per-account+IP threshold, default 10; "Blocked Account Email" with self-service unblock link, toggle "Send notifications to the affected users"), Suspicious IP Throttling (admin-only alerts), Breached Password Detection ("Password Breach Alert" to user). New-device email is DIY via post-login Actions. Email throttles: 1/hour per IP (block), 1/hour per user (breach).

### Okta
Four org-toggleable "Security notification emails": New sign-on, Authenticator enrolled, Authenticator reset, Password changed. New-client detection via cookies/device fingerprint; unrecognized parts render "Unknown". All carry a "Report Suspicious Activity" button → System Log event `user.account.report_suspicious_activity_by_enduser` → admins automate response via Workflows (suspend user, clear sessions). Fires even if the MFA challenge is never completed (first factor alone triggers it).

### GitHub / Google
GitHub: emailed device-verification code gates unknown-device logins without 2FA (cookie-tracked, 1 h validity, sent to primary+backup); separate unrecognized-country notification; GitHub Mobile push as alternative. Google: risk-engine alerts on new device/location AND on blocked suspicious attempts; binary "Yes it was me / No, secure account" → Security Checkup; non-optional.

### Slack / Vercel / Notion (passwordless)
Slack: no sign-in notification at all — the emailed one-time code is the login factor. Vercel: location/IP verification embedded in the OAuth device-flow approval step. Notion: passwordless AND sends a new-device alert (IP-geo location with "best estimate" disclaimer, one-click "This was not me" that logs out that device).

### Microsoft Entra / SAP IAS / NetSuite
Entra: admin-facing "Users at risk detected" + weekly digest (P2 feature); users self-review at My Sign-Ins; consumer MSA accounts get the familiar "Unusual sign-in activity" email — a consumer feature, not an enterprise one. SAP IAS: security alert emails for account changes only; lockout is audit-log territory. NetSuite: Login Audit Trail (admin), password-change email (user), on-screen login acknowledgment banner.

### NIST
800-53 AC-9 "Previous Logon Notification" = at-logon *display* of last logon (optional, in no baseline). 800-63B-4 §4.6: notification SHALL for authenticator binding and account recovery, SHOULD for authenticator invalidation, ≥2 notification addresses supported. Nothing requires routine sign-in or failed-attempt notification.

## Carbon Infrastructure Findings (what exists to build on)

- **Send path**: `trigger("send-email", ...)` → durable Inngest `sendEmailFunction` (3 retries). Canonical security-email example: `apps/erp/app/services/mfa-email.server.ts` — renders a react-email template, fires the event, never throws, and **deliberately bypasses** `notificationPreference` + the `EMAIL_NOTIFICATIONS` plan gate.
- **Templates**: `packages/documents/src/email/` — `MfaEnabledEmail` is the visual precedent (Security eyebrow + CTA to `path.to.accountSecurity`); `InviteEmail` already renders IP + location (`x-vercel-ip-city`).
- **Hook points for "login succeeded"**: the five `AccountLockout.reset()` call sites are exactly "a first factor just genuinely succeeded", pre-TOTP-gate: ERP `login.tsx:208` (dev bypass), ERP `callback.tsx:321` (SSO) and `:358` (magic link/OAuth), MES `callback.tsx:160/:197`, ERP+MES `passkey.authenticate.verify.ts:135/:134`. The true terminal mint for MFA users is `completeMfaChallenge` (`session.server.ts:195`). Note: `callback.tsx` does not currently read the request IP; signup `verify.tsx` mints a session with neither lockout reset nor auth event.
- **Hook point for lockout**: ERP `login.tsx:185` / MES `login.tsx:136` — where `recordFailure()` reports `locked: true` and `login_locked` is logged. Caveat: `recordFailure` counts every magic-link *request*, not credential failures — one more reason per-attempt email is wrong and lockout-only is right.
- **Auth events**: `logAuthEvent` (`packages/auth/src/services/auth-events.server.ts`) is structured logging only — **no DB persistence**, no `authEvent`/`loginHistory`/session/device table exists anywhere in the schema. `login_success` is emitted only on the dev-bypass path today; callback/verify/passkey/SSO routes emit nothing.
- **Device recognition**: nothing exists. Closest artifact is `passkeyCredential.lastUsedAt` (per-credential, not per-session). The only `ipAddress`/`userAgent` columns in the schema are on `itarCertification`. IP is read inline (`x-forwarded-for`) in login routes for rate limiting; user-agent is read only in ITAR/invite audit paths (`getRequestMeta` in `x+/acknowledge.tsx`).
- **Throttle primitive**: `@carbon/kv` `Ratelimit` (Redis, fails open) can implement Auth0-style 1/hour email caps with one line.

## Recommended Approach for Carbon

1. **Two emails, not one-per-login** (Auth0 + Okta/Notion split):
   - **Account-lockout alert** — sent when `AccountLockout` transitions into a lock (ERP/MES `login.tsx` `recordFailure().locked` branch), throttled ~1/hour per email via `Ratelimit` (Auth0's exact numbers). Generic copy consistent with the existing enumeration-safe lockout message; CTA = "wasn't you? secure your account" → account security page.
   - **New-device sign-in alert** — sent on successful first-factor login from an unrecognized device (Okta/Notion pattern), hooked at the `AccountLockout.reset()` sites. Content: time, method (magic link / Google / Azure / SSO / passkey), browser/OS, IP, approximate city with disclaimer — mirroring `InviteEmail`'s existing IP+geo rendering.
2. **Device recognition = the one new mechanism.** Minimum viable: a long-lived signed device cookie (per app) checked at the success hook; no cookie or unknown id → treat as new device, email, set cookie. A `userDevice`/login-history table is the more durable option (also gives admins an audit surface and users a "recent activity" list, the Entra/NetSuite pattern) — decide in the spec; the cookie alone matches GitHub/Okta's accepted false-positive profile (cleared cookies re-alert).
3. **Follow the `mfa-email.server.ts` pattern exactly**: react-email template in `@carbon/documents`, `trigger("send-email", ...)`, try/catch never-throw, **bypass notification preferences and plan gating** — industry says security alerts are not opt-out-able per user. If a toggle is wanted, make it company-level (Okta/Auth0 do tenant-level).
4. **Don't email per failed attempt.** Failures stay in `logAuthEvent` structured logs (and any future audit table). This matches every vendor surveyed and avoids the trap that Carbon's `recordFailure` counts benign magic-link requests.
5. **Consider suppressing the new-device email for magic-link logins** (Slack/Vercel logic: the inbox just proved itself) or send for all methods (Notion logic: consistency + OAuth/SSO/passkey coverage). Recommend sending for all methods for v1 simplicity, revisit if noisy. → spec Open Question.
6. **Open questions to carry into the spec**: fire before or after the TOTP gate (Okta fires before; before = alerts on stolen-first-factor attempts, which is the point); cookie vs table for device recognition; company-level toggle or always-on; whether to also emit `login_success` auth events on the currently-silent callback/passkey paths as part of this work (cheap and closes an observability gap); whether signup `verify.tsx` gets the email (it's a first-ever login — probably suppress, "welcome" already covers it).

## Sources

- https://auth0.com/docs/secure/attack-protection/brute-force-protection
- https://auth0.com/docs/secure/attack-protection/breached-password-detection
- https://auth0.com/docs/attack-protection/suspicious-ip-throttling
- https://auth0.com/docs/customize/email/email-templates
- https://help.okta.com/oie/en-us/Content/Topics/Security/healthinsight/notifications-signon.htm
- https://support.okta.com/help/s/article/When-does-Okta-generate-the-new-sign-in-notification
- https://help.okta.com/oie/en-us/content/topics/security/suspicious-activity-reporting.htm
- https://help.okta.com/oie/en-us/Content/Topics/identity-engine/healthinsight/notifications-authenticator-enroll.htm
- https://github.com/okta/workflows-templates/blob/master/workflows/suspicious_activity_reported/readme.md
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/verifying-new-devices-when-signing-in
- https://github.blog/changelog/2018-11-27-unrecognized-location-sign-in-notifications/
- https://github.blog/changelog/2022-05-18-github-mobile-can-now-verify-sign-ins-on-unrecognized-devices/
- https://support.google.com/accounts/answer/2590353
- https://support.google.com/accounts/answer/6063333
- https://slack.com/help/articles/212681477-Sign-in-to-Slack
- https://www.notion.com/help/log-in-and-out
- https://vercel.com/changelog/new-vercel-cli-login-flow
- https://gitlab.com/gitlab-org/gitlab/-/issues/296128
- https://gitlab.com/gitlab-org/gitlab/-/issues/218457
- https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-configure-notifications
- https://support.microsoft.com/en-us/accounts-billing/work-school/view-your-work-or-school-account-sign-in-activity-from-my-sign-ins
- https://help.sap.com/docs/identity-authentication/identity-authentication/send-security-alert-e-mails
- https://userapps.support.sap.com/sap/support/knowledge/en/2758216
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1521211724.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_56135727646.html
- https://csf.tools/reference/nist-sp-800-53/r5/ac/ac-9/
- https://pages.nist.gov/800-63-4/sp800-63b/events
- https://github.com/usnistgov/800-63-3/blob/nist-pages/sp800-63b/sec6_lifecycle.md
- https://heygrc.com/frameworks/soc-2/cc7-2
