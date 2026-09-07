# Session-Age-Gated Revocation Research: Evaluating the TRUST_DELAY Proposal

> Companion to `.ai/research/session-management-ip-geolocation.md`. That file surveyed how
> session management works generally; this one evaluates one specific proposed design.

## Summary

The proposal is: **revoke-privilege as a function of session age** — tag sessions with
`created_at`, define a `TRUST_DELAY` (~24 h, Telegram's value), block sessions younger than
that from terminating *other* sessions (they may only self-terminate), and pair it with
out-of-band notification on login and on revoke, escape hatches, and an account-keyed audit
table.

**Verdict after research: adopt three of the four parts as specified, and replace the
age-gate itself with step-up re-authentication.** The notification rules, the escape
hatches, and the audit-table design are all well-supported — the audit table in particular
closes a real gap (Carbon persists *no* identity events today). The age-gate is the part the
evidence goes against, for three reasons:

1. **The inversion problem.** Privilege that increases monotonically with session age
   systematically favours whoever arrived *first*. In the realistic Carbon attack (phished
   magic link), the attacker's session is the **older** one — so the rule grants the attacker
   full termination authority and restricts the owner's recovery session. Documented
   first-hand for Telegram: the attacker kills each new owner session as it appears, so the
   owner's clock never reaches 24 h.
2. **Carbon isn't in Telegram's category.** Telegram age-gates because re-auth is *circular*
   there — login is an SMS code, so an attacker who SIM-swapped can satisfy any re-auth
   challenge on demand. Carbon has passkeys and TOTP, and **already ships a working
   re-auth flow** (`/unlock`, TOTP-or-passkey, resumes the session in place). Nothing found
   in the research argues for age-gating in a product that has a strong factor available.
3. **Standards say the opposite.** OWASP ASVS 7.5.2 requires that users be able to terminate
   any or all sessions gated on **re-authentication with at least one factor**, with no age
   condition and no carve-out permitting the capability to be withheld. NIST 800-63B models
   session age as a trigger for *re-authentication*, never as a privilege reduction. OIDC and
   RFC 9470 model freshness as `auth_time` + `max_age` — age of the **authentication event**,
   not of the session.

The single strongest empirical result against delay-plus-notify designs: Markert et al.
(CHI 2024, n=229) found **only 22 % of users took protective action** on a malicious login
notification. A 24 h window whose entire security value is "the owner will notice and act"
is ~22 % effective — and the age-gate's cost is paid by the 100 % of legitimate users who hit
it.

## Competitors Surveyed

Time-delay security controls sort into four structurally different families. Recognising
which family a precedent belongs to is the whole analysis — most "supporting precedents" for
this proposal turn out to be a different family.

| Family | Gate variable | Examples |
|---|---|---|
| **A. Session/device age gates a privilege** | age of *this* session | **Telegram** 24 h; MAS Singapore 12 h new-device cooling-off; Apple's undocumented "short period" for new trusted devices |
| **B. Credential change gates a privilege** | time since a *credential* changed | Google 7-day new-factor trust; Microsoft 30-day security-info hold; Steam Guard 7/15-day trade holds; Binance 24–48 h withdrawal freeze |
| **C. The sensitive action itself is delayed** | delay inserted into the action | Apple Stolen Device Protection 1 h Security Delay; Apple/Google account recovery; Signal/WhatsApp 7-day PIN reset |
| **D. Re-authentication — no delay at all** | freshness of *authentication* | GitHub sudo mode (2 h); NIST 800-63B; OWASP ASVS 7.5.1–7.5.3; OIDC `max_age`; RFC 9470 |

**Family A is rare, and Telegram is the only mass-market product that gates session
revocation on session age.** Everything in B and C delays *credential change* or *asset
egress* — categories the provider can reverse or contain. Session revocation is neither, and
uniquely, withholding it removes the victim's only self-service remedy.

## Key Consensus Patterns

### 1. The inversion problem — age-gating protects the incumbent, not the owner

This is the sharpest critique of the exact proposed design, and it is an inversion argument
rather than the obvious "attacker just waits" one.

First-hand account of Telegram's rule failing (Hacker News item 46590905):
"You can't terminate the hijacked session with a new session. New sessions have to wait
24 hours to gain this authority (which of course never happens)." Because the phished
session is the **older** one, it holds termination authority immediately, while the owner's
recovery login is the restricted one. The attacker terminates each new owner session as it
appears; the owner's clock never advances. That commenter's conclusion — the only recovery
is deleting the account within two minutes of getting a session — and deletion is
irreversible.

Kaspersky and a Habr analysis reach the same structural conclusion: "anyone who has control
of an account for more than 24 hours can terminate all sessions, including the owner's." The
rule **converts a race into a deadline**: whoever is still standing at T+24 h wins outright.

Every family-B/C precedent avoids this by keying the delay to a **credential-change event**
(which the attacker must also trigger, and which notifies the owner) rather than to session
age (which the attacker satisfies merely by arriving earlier).

**Applied to Carbon:** the realistic compromise is a phished or mailbox-read magic link.
The attacker signs in at T+0; the owner notices at T+2 h and signs in to clean up. Under the
proposed rule the owner is the unprivileged party and the attacker is the privileged one.
This is the opposite of the intended effect.

### 2. Standards mandate re-auth, and specifically require the capability the gate withholds

- **OWASP ASVS 5.0 §7.5.2 (L2)**: "Verify that users are able to view and (**having
  authenticated again with at least one factor**) terminate any or all currently active
  sessions." ASVS 4.0.3 §3.3.4 is the same requirement. Note what this is: re-auth **is** the
  prescribed gate, there is no age condition, and there is no carve-out that permits
  withholding bulk termination. A design that refuses bulk revocation for a session's first
  24 h is, read strictly, **in tension with 7.5.2 as written**.
- **ASVS §7.5.1 (L2)**: full re-authentication before modifying sensitive account attributes.
  **§7.5.3 (L3)**: further authentication before highly sensitive operations.
- **ASVS §7.4.3 (L2)**: offer to terminate all *other* sessions after any authentication
  factor is changed or removed — the standards' preferred trigger is a credential event.
- **NIST SP 800-63B-4 §2.3.3/§2.3.5/§2.3.6**: reauthentication overall timeouts — AAL1
  ≤30 days, AAL2 ≤24 h (inactivity ≤1 h), AAL3 ≤12 h (inactivity ≤15 min, both factors).
  Session age triggers **re-authentication**, never a privilege reduction. (Rev 3 had AAL2 at
  12 h / 30 min.)
- **OIDC Core + RFC 9470 (Sept 2023)**: `max_age` is measured from `auth_time` — the
  authentication event — and step-up **resets `auth_time` without destroying the session**
  ("additive, not destructive"). RFC 9470 standardises the resource-server challenge
  (`insufficient_user_authentication` + `acr_values` + `max_age`). Load-bearing distinction
  from the spec commentary: "`acr_values` is advisory and `max_age` is enforceable."
- Nothing in NIST 800-63B, ASVS 4.0/5.0, or the OWASP Session Management Cheat Sheet
  contemplates session age as a privilege gate.

### 3. Why Telegram does it anyway — and why that reason doesn't transfer

Telegram never published a rationale; the only first-party statement is the error string
(`FRESH_RESET_AUTHORISATION_FORBIDDEN`, 406) and the bug-tracker note: "you can't terminate
older sessions from a device where you've recently logged in… wait for up to 24 hours."

The consistent secondary reading, which the code supports: **re-auth is worthless in
Telegram's default threat model.** Login is an SMS/in-app code with no password unless the
user opts into a cloud password, so an attacker who completed a SIM-swap login can satisfy
any re-auth challenge on demand. Age-gating substitutes "the incumbent session is more
trustworthy than the newcomer" plus a notification *for a real second factor Telegram
doesn't have*. Telegram uses delay as its general-purpose primitive — the cloud-password
reset carries a 7-day server-side timer for the same reason.

Two further Telegram-specific weaknesses that also apply to any in-band confirmation design:
critical actions are confirmed **inside Telegram itself**, so an attacker holding the session
owns the confirmation channel; and post-lockout there is no alternate recovery path.

**Carbon is not in this category.** It has passkeys (WebAuthn with user verification) and
TOTP, plus an existing re-auth surface at `/unlock`. An attacker with a phished magic link
cannot satisfy a passkey challenge.

### 4. Delays succeed only under conditions this action doesn't meet

The credit side, for balance — where time delays demonstrably work:

- **Steam Guard trade holds** (15 days without an authenticator; 15-day holds during the
  first 7 days after adding one): trade volume stayed "as high as ever" at ~95 % adoption.
  Works because the delayed thing is **irreversible asset egress** and **Valve retains
  unilateral cancel authority** — the user does not have to notice.
- **Binance 24–48 h post-credential-change withdrawal freeze; MAS Singapore 12 h**: same
  shape — freeze **egress**, not access; the provider can reverse during the window.
- **Apple Stolen Device Protection (iOS 17.3, 1 h Security Delay)**: narrow, achievable goal
  — break the temporal correlation between an observed/coerced biometric and the sensitive
  action ("incredibly unlikely the user would still be available for a second scan an hour
  later"). Threat model is explicitly a thief who *watched you type your passcode*.
- **Google's 7-day new-factor trust**: has a **first-class expedite path** — an
  already-trusted passkey or security key clears it immediately, so an owner with prior
  strong credentials never pays the delay.

The pattern: delays succeed when (a) the delayed action is **asset movement the provider can
unilaterally reverse**, or (b) there is an **escape hatch keyed to a stronger, already-trusted
credential**. They fail when the only backstop is "the user will notice," or when the
incumbent session keeps full authority throughout. Session revocation is not asset egress,
is not provider-reversible, and is *itself the remedy* — friction on it has an asymmetric
cost, because it slows the victim trying to eject an attacker.

Apple's delay is also the best-documented case of a delay being **bypassed**: F-Secure tested
five iPhones and found the Significant Locations exemption defeats it — standing "near the
entrance of the victim's building" was enough for the phone to consider itself at home and
drop the delay. The "Always require security delay" toggle added in 17.4 is not on by
default.

### 5. The notification half of the proposal is well-supported — with one hard number attached

The proposal's notification rules match regulatory and industry consensus:

- **MAS Singapore** mandates the delay *as a triple*: 12 h cooling-off + **real-time
  notification** on token activation, new-device login, and high-risk activity + a
  **self-service kill switch**. The kill switch is what makes the delay defensible — and note
  it is the *opposite* of restricting revocation.
- **Telegram, Google, Discord, GitHub** all notify on new login; Google and Discord include a
  "wasn't you?" action path. **Microsoft** notifies the *old* security info throughout its
  30-day hold with a "Cancel this request" link — notification-plus-undo.
- Notifying on **revoke actions** (the proposal's second rule) is *less* common in the
  surveyed products but follows the same logic and is a genuine improvement: it closes the
  case where an attacker silently ejects the owner.

The hard number: **Markert et al., "Understanding Users' Interaction with Login
Notifications," CHI 2024** (n=229, 110 legitimate / 119 malicious treatment):

- Only **22 %** of participants in the malicious treatment changed their password — ~78 % of
  users who should have acted did **not**.
- 0 % of the legitimate treatment acted (no false-positive cost — notifying is cheap).
- Notification **content** mattered most; only **21 %** of real-world login notifications
  explain *why* they fired.
- **>90 %** expect notification for new-device/suspicious logins, but strongly reject
  notification on **every** login (alert fatigue).
- Authors' conclusion: identifying malicious logins "should not be solely the user's
  responsibility."

**Design consequences:** notify on *new device*, not every login. Say **why** the alert
fired. Put the remedy in the message. And do not let a mechanism's security value rest
entirely on the user reacting.

### 6. Audit records must outlive the session and the actor

The proposal's requirement — log revoke actions to an account-keyed table, not a
session-keyed one — matches how Carbon's existing business audit log already behaves and
closes a real gap in the identity path (see Carbon Grounding §4). Supporting practice:
ASVS 7.4.1/7.4.2 (termination must be enforced server-side and on account
disable/delete); the OWASP Session Management Cheat Sheet's insistence that server-side
invalidation is "the most relevant and mandatory" part, and that clearing the client token
is insufficient.

One caution from the step-up literature that applies to *both* designs: time-based controls
"break down when applications rely on front-end prompts for enforcement, because attackers
can bypass the prompt while preserving the original authenticated session." Whatever gate is
chosen, it must be enforced in the action handler, server-side — never in the UI.

## Answers to the Research Questions

1. **Who else gates a sensitive action on session age?** Essentially only Telegram, for
   session revocation. MAS Singapore mandates a 12 h new-device cooling-off for *high-risk
   financial activity* (the one regulatory endorsement of family A, and it ships bundled with
   notification + a kill switch). Apple has an undocumented "short period" before a new
   trusted device can change critical account info. Everything else that looks like a
   precedent — Google 7-day, Microsoft 30-day, Steam 7/15-day, Binance 24–48 h, Apple SDP
   1 h — keys off a **credential change** or delays **asset egress**, not session age.
   *(Correction to a premise: no Apple documentation supports a 7-day delay before a new
   trusted phone number can be used; Apple publishes no duration at all here.)*
2. **Is Apple's Security Delay considered effective?** Partially, with documented bypasses.
   F-Secure defeated it via the familiar-location exemption; the "always require" toggle is
   off by default; Significant Locations misfires in both directions (users report being
   wrongly delayed, and Elcomsoft observed location lists purged by an update); it covers
   only tier-2 actions (Keychain access and Erase All Content remain biometric-only); and it
   is entirely non-configurable. Its narrow goal — breaking coerced-biometric correlation —
   is considered sound.
3. **Steam Guard trade holds?** No authenticator for 15 days → no trading/Market at all.
   Trades created before adding an authenticator, or within 7 days after, are held **15
   days**; after 7 days, no hold. Removing the authenticator → 15-day cooldown then holds
   again until 7 days re-elapse. Valve's stated model: "This allows users whose accounts have
   been compromised to quickly cancel any fraudulent trades to recover their items." The
   7-day window specifically stops an *attacker's* freshly-added authenticator from conferring
   instant-trade privilege — note this is keyed to the credential the attacker must add, not
   to session age.
4. **Critiques of time-delay security?** (a) The inversion problem (§1) — the decisive one
   here. (b) "The attacker just waits" — a delay only helps if the attacker's retained access
   is revoked or detected inside the window. (c) User vigilance doesn't hold — 22 % action
   rate (CHI 2024). (d) Real-time AiTM relay attacks produce sessions "indistinguishable from
   legitimate access," so an age-keyed gate is blind to them. (e) Delays are a **DoS
   primitive against the legitimate user** — SecureComm 2019 measured 58–77 % of 2,066
   organisations exposing lockout-induced DoS; the literature recommends exponential delays
   plus a bypass for legitimate users, never a flat block. Microsoft's 30-day hold and
   Apple's multi-day recovery generate the loudest user-harm evidence, both lacking an
   expedite path.
5. **Standards guidance?** Covered in §2. Short version: NIST and OWASP both answer "should
   this action be harder?" with *require fresh authentication*, not *make the user wait* —
   and ASVS 7.5.2 affirmatively requires the terminate-any-or-all capability that the
   proposed gate withholds.
6. **What does the industry do for "sign out all other sessions"?** Split, and the split is
   explained by auth model. **Discord** (password + 2FA) and **Slack** (password) gate it on
   re-auth — both password-primary. **GitHub** and **Google** do *not* gate it at all, despite
   GitHub having a 2 h sudo mode it applies to email changes, SSH keys and PATs — an explicit
   choice to keep the defensive action frictionless. **Telegram/WhatsApp/Signal** can't
   meaningfully re-auth; only Telegram uses age. **Microsoft**: no re-auth, and "may take up
   to 24 hours" — MS treats password change as the real revocation primitive.

## Carbon Grounding — what exists today

Verified on branch `user-devices-login-history`; file:line references are to that branch.

1. **Session age is already available two ways.** GoTrue's authoritative
   `auth.sessions.created_at` is already selected by `getActiveSessions`
   (`apps/erp/app/modules/account/account.service.ts:23-38`) — one Postgres round-trip, and
   the security page already pays it. Separately, the auth cookie carries
   `AuthSession.createdAt` (`packages/auth/src/types.ts:22-31`, stamped in
   `auth.server.ts:161-162`), readable with no I/O and deliberately preserved across silent
   refresh (`session.server.ts:394-400`). **Use the DB value for any security decision** —
   the cookie value is optional for back-compat and is *reset* by MFA completion
   (`session.server.ts:180-185`), so it is a lock clock, not a session-identity clock.
2. **`auth_time` is already in the token and already parsed.** `decodeAccessToken` reads the
   `amr` array including `amr[].timestamp` (`packages/auth/src/services/login-history.server.ts:24-40`,
   `deriveLoginMethod` at `:64-93`); the timestamp value is decoded but unused. That is the
   OIDC `auth_time` equivalent — the input a step-up gate needs, available with no DB query.
3. **A working re-auth flow already ships.** `/unlock`
   (`apps/erp/app/routes/_public+/unlock.tsx`) re-authenticates with **TOTP or passkey**,
   **resumes the existing session in place rather than minting a new one**, enforces
   `credRow.userId !== authSession.userId → 403` (`:191-196`), and has an inline mode
   (`:68-76`) that rotates the cookie without navigation for `SessionLockOverlay`. This is a
   sudo-mode primitive that already exists. Precedent for credential-gated sensitive actions
   also exists: MFA unenroll requires a fresh TOTP code (`apps/erp/app/routes/api+/mfa.unenroll.ts:28-47`).
   Today, **no re-auth is required before any security-page action** — `security.tsx:141`
   authorizes with `requirePermissions(request, {})` only.
4. **Identity events are NOT persisted — this is the real gap.**
   `packages/auth/src/services/auth-events.server.ts:27-41` states it plainly: the
   application audit log records only business-entity CRUD; identity events go to
   `@carbon/logger` → CloudWatch. The `AuthEvent` union (`:14-25`) has no `session_revoked`
   member. The business audit table (`create_audit_log_table`,
   `packages/database/supabase/migrations/20260818014100_audit-log-append-only.sql:85-96`) is
   append-only by trigger (`:12-53`) and its `actorId` is a **bare nullable TEXT with no FK**,
   so rows already survive user deletion — exactly the property the proposal asks for.
   `SYSTEM_ACTOR = "system"` exists for unattributed actions.
5. **`userLogin` partially satisfies the audit requirement.** `sessionId` has **no FK**
   (`20260826134307_user-devices-session-id.sql`), so history survives session deletion —
   good. But `userId` is `ON DELETE CASCADE` (`20260825235427_user-devices-login-history.sql`)
   and rows are pruned at **90 days** on every insert (`login-history.server.ts:13,145-158`).
   RLS is SELECT-only for the owner by design ("a user must not be able to forge or erase
   their own sign-in audit trail").
6. **Notification channels: email only, and it is also the login channel.**
   `packages/notifications` is enums; channels are `InApp | Email | Slack`
   (`packages/notifications/src/index.ts:116-120`). **No SMS, no push** (verified by grep).
   The in-app `notification` table requires a **NOT NULL `companyId`**
   (`20260508120001_notifications.sql:11-27`) — a login event precedes company selection, so
   in-app is structurally awkward for this. The right precedent is
   `apps/erp/app/services/mfa-email.server.ts:26-36`, which deliberately bypasses
   notification preferences and the `EMAIL_NOTIFICATIONS` plan gate because "this is a
   security announcement," and never throws. **Honest limitation: Carbon's out-of-band
   channel is email, and email *is* the magic-link auth channel** — so for a mailbox
   compromise, notification and authentication share a failure domain. This is an argument
   for a factor the mailbox can't produce (passkey/TOTP), not for a longer delay.
7. **Recovery already works with zero session state.** Magic link, OAuth, and passkey login
   all mint fresh sessions without a prior one (`_public+/login.tsx:222-224`, `/callback`,
   `api+/passkey.authenticate.*`); revoking every session touches only `auth.sessions`,
   leaving passkeys and TOTP factors intact. `AccountLockout` (`packages/kv/src/lockout/lockout.ts`)
   is 5 attempts / 15 min with exponential backoff, keyed by email, and **fails open on Redis
   errors** (`:20-21`). So the proposal's third escape hatch is already satisfied.
8. **The spec is silent on all of this.** `.ai/specs/2026-08-26-session-revocation.md` never
   discusses session age as a gate, re-auth before revoke, notification on revoke, or audit
   logging of revokes. Its only guard is refusing to revoke your own session (`:139-140`,
   `:177-178`). The accepted ≤1 h revoked-JWT residual (`:68`, `:210-213`) is unchanged by
   anything here.

## Recommended Approach for Carbon

**Adopt rules 2, 3 and 4 of the proposal as written. Replace rule 1 (the age gate) with
step-up re-authentication.** Concretely:

1. **Gate cross-session and bulk revoke on fresh re-auth, not on session age.** Require a
   passkey or TOTP challenge — via the existing `/unlock` inline flow, which already resumes
   the session in place — within a sliding freshness window before `revokeSession(other)` and
   `revokeOtherSessions`. GitHub's 2 h is the closest analog; GCP uses 15 min, Stripe two
   weeks; there is no standard, so pick from Carbon's own idle-lock posture
   (`SESSION_IDLE_LOCK_MS` = 15 min) and treat it as configurable. Enforce it **in the action
   handler** in `security.tsx`, never in the UI — front-end-only gates are bypassable while
   preserving the session. Track freshness from the `amr[].timestamp` already decoded, or
   stamp a `reauthAt` on the auth cookie when `/unlock` succeeds. This satisfies ASVS 7.5.2
   exactly, matches Slack/Discord, avoids the inversion problem entirely (a passkey is
   something the phisher does not have, regardless of who logged in first), and reuses code
   that already exists. **Self-termination stays ungated** — the proposal is right about that,
   and it also matches Telegram, where only the bulk method is restricted.
2. **If you want the age signal anyway, use it as a *trigger* for step-up, not as a
   *prohibition*.** This is how the step-up literature actually uses session age — "new
   device, unusual location, session age" as contextual signals that *require* step-up. A
   session younger than `TRUST_DELAY` must re-auth to revoke others; an older one may be
   allowed through on a longer freshness window. That keeps the intuition behind the proposal
   while removing the failure mode, because the young legitimate session always has a way
   through and the old attacker session does not get a free pass. Read GoTrue's
   `auth.sessions.created_at` for this, not the cookie clock (§Carbon Grounding 1).
3. **Notify on new-device login and on every revoke — by email, bypassing preferences and
   plan gates.** Follow `mfa-email.server.ts` exactly: `trigger("send-email", …)`, never
   `notify`, never throws. Include device, approximate location, IP, timestamp, **why the
   alert fired**, and a one-click path to the security page — CHI 2024 found content and a
   stated reason are the largest levers, and only 21 % of real notifications explain
   themselves. Notify on **new device**, not every login (>90 % want the former, most reject
   the latter). This needs the new-device cookie already in the parent spec's future work,
   and it needs geolocation that works self-hosted — see the companion research file, or
   self-hosted alerts ship with "Unknown location" forever. Skip in-app for these: the
   `notification` table's NOT NULL `companyId` doesn't fit a pre-company-selection event.
4. **Persist identity events to an account-keyed, append-only table.** Add `session_revoked`
   (plus `session_revoked_all`) to the `AuthEvent` union and give `logAuthEvent` a persistent
   sink — today it is console-only, so a revoke leaves no queryable trace. Key rows to
   `userId` with a nullable, FK-less `actorId` (mirroring the business audit table, whose
   rows already survive actor deletion), record the acting session id **as data rather than
   as an FK** so the row outlives the session, and record the target session id. Do not reuse
   `auditLog_{companyId}`: that table is company-partitioned and a login/revoke can precede
   company selection. Retention here should be independent of `userLogin`'s 90-day
   prune-on-insert, and the table must be RLS SELECT-only for the owner, matching
   `userLogin`'s "cannot forge or erase their own trail" stance.
5. **Keep all three escape hatches — two already work.** Self-termination unrestricted (rule
   1 above); session-independent recovery already holds (magic link/OAuth/passkey need no
   prior session, and revocation leaves factors intact). The one to add deliberately: ensure
   a legitimate user who has *lost* their second factor can still recover, or step-up becomes
   the new lockout. Note `AccountLockout` fails **open** on Redis errors — verify any new gate
   fails in the direction you intend, and that it cannot be weaponised for DoS against the
   owner (SecureComm 2019: 58–77 % of organisations expose lockout-induced DoS).
6. **Do not build the 24 h prohibition.** If it is adopted despite the above, it should at
   minimum ship with (a) an expedite path keyed to a stronger credential — Google's 7-day
   trust clears instantly with a trusted passkey, and delays without an expedite path
   (Microsoft 30-day, Apple recovery, Telegram) produce the loudest user-harm evidence; and
   (b) an explicit decision about ASVS 7.5.2 compliance, since withholding bulk termination
   is in tension with that requirement as written.

## Sources

### Telegram and the inversion problem
- https://core.telegram.org/method/auth.resetAuthorizations
- https://core.telegram.org/method/account.resetAuthorization
- https://translations.telegram.org/en/webk/settings/RecentSessions.Error.FreshReset
- https://bugs.telegram.org/c/218
- https://news.ycombinator.com/item?id=46590905
- https://habr.com/en/articles/990262/
- https://www.kaspersky.com/blog/telegram-account-hacked/52775/
- https://frameworks.securityalliance.org/guides/account-management/telegram/

### Standards
- https://pages.nist.gov/800-63-4/sp800-63b.html
- https://pages.nist.gov/800-63-3/sp800-63b.html
- https://asvs.dev/v5.0.0/V7-Session-Management/
- https://github.com/OWASP/ASVS/blob/master/4.0/en/0x12-V3-Session-management.md
- https://github.com/OWASP/ASVS/issues/2883
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://www.rfc-editor.org/rfc/rfc9470.html
- https://openid.net/specs/openid-connect-core-1_0.html
- https://auth0.com/docs/authenticate/login/max-age-reauthentication
- https://www.authlete.com/developers/stepup_authn/
- https://workos.com/blog/rfc-9470-step-up-authentication-challenge

### Step-up / sudo mode
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode
- https://github.blog/news-insights/introducing-github-sudo-mode/
- https://github.com/orgs/community/discussions/184014
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/viewing-and-managing-your-sessions
- https://docs.cloud.google.com/docs/authentication/reauthentication
- https://support.google.com/accounts/answer/7162782
- https://slack.com/help/articles/214613347-Sign-out-of-Slack
- https://support.microsoft.com/en-us/accounts-billing/manage/how-to-sign-out-of-your-microsoft-account-everywhere
- https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation
- https://securityboulevard.com/2026/05/step-up-authentication-when-to-require-it-and-how-to-implement-it-in-oidc/
- https://developer.okta.com/docs/guides/step-up-authentication/main/
- https://supertokens.com/blog/step-up-auth

### WebAuthn user verification
- https://web.dev/articles/webauthn-user-verification
- https://mojoauth.com/blog/webauthn-userverification-preferred-vs-required
- https://www.corbado.com/blog/webauthn-user-verification

### Time-delay precedents and criticism
- https://support.apple.com/en-us/120340
- https://support.apple.com/guide/iphone/use-stolen-device-protection-iph17105538b/ios
- https://support.apple.com/en-us/122621
- https://support.apple.com/en-us/118574
- https://www.f-secure.com/en/articles/iphone-s-stolen-device-protection-tested
- https://blog.elcomsoft.com/2025/03/forensic-implications-of-apples-stolen-device-protection/
- https://mjtsai.com/blog/2026/02/17/ios-26-4-stolen-device-protection-enabled-by-default/
- https://support.google.com/accounts/answer/17137073
- https://support.google.com/accounts/answer/9412469
- https://support.microsoft.com/en-us/accounts-billing/manage/what-does-security-info-change-is-still-pending-mean
- https://store.steampowered.com/oldnews/20631
- https://help.steampowered.com/en/faqs/view/34A1-EA3F-83ED-54AB
- https://steamcommunity.com/discussions/forum/8/2860219962100338908/
- https://support.binance.us/en/articles/9842927-why-can-t-i-withdraw
- https://www.privacyguides.org/articles/2022/11/10/signal-number-registration-update/

### Regulatory
- https://www.mas.gov.sg/news/media-releases/2022/mas-and-abs-announce-measures-to-bolster-the-security-of-digital-banking
- https://www.ocbc.com/personal-banking/security/secure-banking-ways/cooling-off-periods.page
- https://www.malaymail.com/news/singapore/2025/10/03/singapore-banks-tighten-scam-defences-with-24-hour-cooling-off-period-on-risky-transactions-from-oct-15/193301

### Research
- https://arxiv.org/html/2212.07316v6 — Markert et al., CHI 2024, login notifications (22 % action rate)
- https://dl.acm.org/doi/10.1145/3613904.3642823
- https://web.cs.wpi.edu/~cshue/research/securecomm.19.lockouts.pdf — account-lockout DoS
- https://security.googleblog.com/2019/05/new-research-how-effective-is-basic-account-hygiene-at-preventing-hijacking.html
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/03-Testing_for_Weak_Lock_Out_Mechanism
