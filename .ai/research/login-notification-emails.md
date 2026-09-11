# Research: Login Notification Emails + Login History

> Date: 2026-08-26
> Ported from a prior session's research run (four parallel agents: Auth0/Okta,
> GitHub/Google/Slack/Notion/Vercel, Entra/SAP IAS/NetSuite + NIST/SOC 2, and a
> Carbon infrastructure map). Codebase facts re-verified against this branch.

## Industry findings

### Nobody emails on every successful login

Okta, GitHub, Google, and Notion all trigger the "new sign-in" email only for an
**unrecognized device or location**:

- **Okta** — "New sign-on notification email" fires only for a new/unrecognized
  client, detected via browser cookies or device fingerprint. One of four org-admin
  toggled "security notification emails" (with Authenticator enrolled, Authenticator
  reset, Password changed). Emails carry browser, OS, time, location (unrecognized
  parts render "Unknown") and a "Report Suspicious Activity" button (valid 7 days).
  (help.okta.com — healthinsight/notifications-signon, suspicious-activity-reporting)
- **GitHub** — two mechanisms: device *verification* (pre-login emailed code when no
  2FA, cookie-tracked device) and an unrecognized-**country** post-login notification.
  (docs.github.com — verifying-new-devices; github.blog 2018-11-27 changelog)
- **Google** — risk-engine driven "Critical security alert" on new device/location,
  with device type, time, location; binary "Yes, it was me" / "No, secure account"
  action. Cannot be unsubscribed. (support.google.com/accounts/answer/2590353)
- **Notion** (closest auth model to Carbon: passwordless + OAuth) — sends a
  new-device alert with IP-derived approximate location (explicitly disclaimed) and a
  one-click "This was not me" that kills that session. Sends it even though the login
  code itself arrives by email, because sessions can also start via OAuth.
  (notion.com/help/log-in-and-out)
- **Slack / Vercel** (passwordless peers) — send no sign-in alert at all; the emailed
  code/approval is the notification. Carbon has OAuth + passkeys, so the Notion
  position (alert anyway) is the right one.

### Failed attempts: alert on lockout, not per attempt

- **Auth0** — "Blocked Account Email" fires when brute-force protection blocks the
  account (default 10 failed/IP), throttled **1/hour**, with a self-service unblock
  link. Tenant-level toggle. (auth0.com/docs — brute-force-protection)
- **Google** is the only vendor emailing on blocked attempts ("Suspicious sign in
  prevented"). No vendor documents a per-failure or N-failures email.
- Everyone else routes failures to admin logs/SIEM.

### Enterprise IdPs vs consumer

No enterprise IdP (Entra ID, SAP IAS, NetSuite) emails end users on routine
sign-ins — risky sign-ins go to **admins** (Entra "Users at risk detected"),
audit logs, or in-session interruption (risk-based step-up). End-user email is
reserved for **account mutations** (password changed, authenticator added,
recovery). Per-login user email is a consumer pattern (Google/Microsoft personal).
NetSuite's "Login Notification" is an on-screen acknowledgment banner, not email;
its Login Audit Trail (every login: date/time, user, IP, role, success/failure) is
the admin-facing history feature enterprise buyers ask about.

### Compliance drivers

- **NIST 800-63B-4 §4.6** — notification is a SHALL only for account *changes*
  (authenticator binding, recovery), never for routine sign-ins.
- **NIST 800-53 AC-9** ("Previous Logon Notification") — the one control that puts
  logon info in front of the *user*: last-logon date/time at sign-in, optionally
  failed-attempt counts and location. At-logon display, not email; not in any
  baseline. A user-visible login-history table is the natural implementation.
- **SOC 2 CC7.x** — requires the org to log and monitor successful/failed logins;
  no criterion requires notifying end users.

### Opt-out

Effectively none anywhere for the end user (Google explicitly forbids it; an
attacker with account access would disable the alert first). Okta/Auth0 offer
*tenant-admin* toggles only. Carbon's own precedent agrees:
`apps/erp/app/services/mfa-email.server.ts` deliberately bypasses
`notificationPreference` and the `EMAIL_NOTIFICATIONS` plan gate for security mail.

## Carbon infrastructure map (verified on this branch)

- **Email**: direct `sendEmail` (`@carbon/lib/resend.server`) used by the login-path
  `sendVerificationCode` (`packages/auth/src/services/verification.server.ts`);
  durable `trigger("send-email")` Inngest path used by `mfa-email.server.ts` (its
  event payload requires `companyId`). Templates in `packages/documents/src/email/`;
  `MfaEnabledEmail` is the security-receipt precedent, `InviteEmail` already renders
  `ip`/`location` props.
- **Auth events**: `logAuthEvent` (`packages/auth/src/services/auth-events.server.ts`)
  is console-structured-logging only — **nothing is persisted**. `login_success` is
  emitted only on the dev-bypass path today.
- **Success mint points** (first factor genuinely succeeded — where
  `AccountLockout.reset()` runs): ERP/MES `_public+/callback.tsx` (magic link +
  Google/Azure OAuth, runs **before** the TOTP gate), ERP/MES
  `api+/passkey.authenticate.verify.ts`, ERP `login.tsx` dev bypass. Plus ERP
  `_public+/verify.tsx` (signup, no lockout interaction). `unlock.tsx` and
  `refresh-session.tsx` are re-auth/refresh, not logins.
- **Lockout**: `AccountLockout` (`packages/kv/src/lockout/`) — 5 failures/15 min per
  normalized email, exponential lock 1 min → 1 h, level remembered 24 h. Lock
  *engages* where `recordFailure` returns locked (ERP/MES `login.tsx`).
- **Device/session tracking**: none. No session, device, or login-history table in
  any migration; sessions are stateless signed cookies, so a Notion-style remote
  "log out that device" is not possible in v1.
- **IP/geo/UA capture**: `x-forwarded-for` read inline in login routes (rate-limit
  keying only); `x-vercel-ip-city` used in invite flows; user-agent captured only in
  ITAR acknowledgment (`itarCertification.ipAddress/userAgent` — the only such
  columns in the schema). No UA-parser dependency exists in the repo.
- **User-owned tables precedent**: `passkeyCredential` (no `companyId`, PK on `id`,
  FK to `user`, owner-scoped RLS) and `notificationPreference` (PK on `id` alone).

## Recommendation carried into the spec

1. Two emails: **account-lockout alert** (on lock engagement, throttled 1/hour per
   account) and **new-device sign-in alert** (at first-factor success across all
   methods), both bypassing notification preferences, no per-user opt-out.
2. Device recognition via signed long-lived device cookie **backed by a
   login-history table** (user's decision — gives the email a "review activity"
   destination and closes the no-persisted-auth-events gap).
3. User-facing "Recent sign-in activity" in Account → Security (user's decision).
4. No company-level toggle in v1; always-on (user's decision).

Spec: `.ai/specs/2026-08-26-user-devices-login-history.md`
