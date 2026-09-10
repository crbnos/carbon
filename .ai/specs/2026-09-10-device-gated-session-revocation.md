# Device-Gated Session Revocation

> Status: draft
> Author: Claude (design resolved with Aashu)
> Date: 2026-09-10

## TLDR

Recognise the **device** a login comes from (signed `carbon-device` cookie +
`deviceId` on `userLogin`), and gate cross-session and bulk revoke on **device
age** instead of session age: the older device wins. A device that has signed
into this account before may sign out newer sessions with no prompt; a newer or
unrecognised device is refused with a message telling the user to act from a
device they have used before. **Self-termination is never gated.** A new device
also triggers an out-of-band email alert naming the device and time — **no IP,
no location**. Also hardens client-IP extraction, which is attacker-controlled
on self-hosted Caddy today.

There is deliberately **no step-up re-authentication anywhere in this design** —
one timestamp comparison is the whole rule.

Builds on [2026-08-26-user-devices-login-history.md](2026-08-26-user-devices-login-history.md)
and [2026-08-26-session-revocation.md](2026-08-26-session-revocation.md).
Research: [session-age-gated-revocation.md](../research/session-age-gated-revocation.md),
[session-management-ip-geolocation.md](../research/session-management-ip-geolocation.md),
[login-notification-emails.md](../research/login-notification-emails.md).

## Problem Statement

Any live session can sign out every other device on the account with one click.
An attacker who phishes a magic link inherits that power the moment they land —
the stolen session is the only thing they need to evict the real owner from
every device they own.

The obvious mitigation, gating revoke on **session age** (Telegram's
`TRUST_DELAY`), was researched and rejected: privilege that grows with session
age favours whoever arrived first, and an attacker who kills the owner's session
resets the owner's clock on every attempt, so the owner never accrues authority.
Carbon's own sessions also expire at 7 days, so a continuously-working owner
periodically becomes the *newest* session on their own account.

**Device age does not have that inversion.** A cookie planted on the owner's
laptop three months ago survives logout, session expiry, and an attacker killing
the current session. The attacker's browser has never been seen, and cannot
become seen by waiting.

## Goals

- A newer or unrecognised device cannot sign out sessions belonging to an older device.
- An older, recognised device signs out newer sessions with no added friction.
- Every account has a self-service way to end its own session, always.
- The owner learns out-of-band when a new device signs in.
- Client IP is trustworthy enough to store as a security record.

## Non-Goals

- **Session-age (`TRUST_DELAY`) gating** — researched and rejected; see the
  Design Decisions table and the research file.
- **The account-keyed audit table** — `logAuthEvent` is still console-only.
  **User decision:** its own spec, built after this one.
- **Geolocation for self-hosted** — DB-IP Country Lite was evaluated and
  declined for this spec; alerts carry no location at all (below).
- **Device management UI** (naming, forgetting, listing devices) — the "Your
  devices" card lists live sessions, and that is enough for this iteration.
- **Blocking logins from new devices.** Alerts are notify-only; an ERP login
  blocked on a mis-detected device is a support ticket.

## Proposed Solution

Three parts, in dependency order.

### 1. Device identity

A signed cookie, `carbon-device`, holding an opaque `deviceId`. Set on first
login when absent, read on every subsequent login, and written to a new
`deviceId` column on `userLogin`. A device is **recognised** for a user when a
`userLogin` row exists with that `(userId, deviceId)` pair.

Signed with `SESSION_SECRET` via the same `createCookieSessionStorage`
machinery the `carbon` auth cookie already uses, so a forged `deviceId` fails
the signature check. Separate cookie from `carbon`, with a 1-year `maxAge` — it
must outlive the 7-day session, which is the entire point.

### 2. The revoke gate

One comparison: **the caller's device must be older than the session it wants to
end.** A device's age is `MIN("createdAt")` over that user's `userLogin` rows
carrying its `deviceId` — when it was first seen. The target session's age is
its own login row's `createdAt`.

| Case | `revokeSession(other)` / `revokeOtherSessions` |
|---|---|
| Caller's device first seen **before** the target session began | **Allowed**, no prompt |
| Caller's device first seen **after** it (or device unrecognised / no cookie) | **Refused** with an explanation |
| Self-termination | **Always allowed**, in every case |

For `revokeOtherSessions`, the caller's device must be older than **every**
session it would end; otherwise the whole action is refused rather than
partially applied.

**User decision:** no step-up re-authentication, no TOTP, no passkey challenge
anywhere in this flow. The cost is that the user's own new device cannot sign
out their old sessions until it has been seen for longer than they have — they
act from an older device, or wait. That is accepted in exchange for one rule
with no branches.

Enforced in the **action handler** in `security.tsx`, never in the UI alone —
a hidden button stops nobody.

### 3. New-device email alert

On a login whose `(userId, deviceId)` pair is unseen, send an out-of-band email:
device (parsed browser + OS) and timestamp, plus a link to Account → Security.

**No IP address and no location.** *User decision on the IP; location follows
from it* — with no IP in the message, a location adds a dependency and a GDPR
surface for a field the owner cannot act on, and `x-vercel-ip-*` is blank
self-hosted, so half of installs would read "Unknown location" forever. Device
plus time is enough to answer "was that me?".

Bypasses notification preferences and plan gates, exactly as
`mfa-email.server.ts` already does — an attacker with account access would
disable the alert first.

### 4. Client-IP hardening (prerequisite)

`recordLogin` reads `x-forwarded-for.split(",")[0]` — the **leftmost** hop.
On self-hosted Caddy, `trusted_proxies static private_ranges`
(`contrib/deploying/simple-docker-caddy/Caddyfile:12`) forwards the client-seeded
chain, so that value is attacker-controlled. Add `getClientIp` to
`packages/utils/src/ip.ts`: rightmost-first walk skipping trusted proxies,
bounded by `TRUSTED_PROXY_COUNT` / `TRUSTED_PROXY_IPS`, merging repeated XFF
headers, stripping `:port` suffixes, and normalising IPv4-mapped IPv6 before
comparison. `recordLogin` switches to it.

**User decision:** fixed in this spec rather than deferred, because a stored
security record built on a forgeable IP is worse than none. Scope here is the
`recordLogin` call site; the ~25 other call sites the research names (including
rate-limit keying, a documented bypass) are **not** in scope — flagged in Risks.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trust signal | **Device recognition**, not session age | Session age inverts under attack (attacker resets the owner's clock; owner is newest after expiry). Device age survives logout, expiry and revocation |
| Trust comparison | Device's first-seen time vs the target session's start | **User decision.** The older device wins — no absolute threshold to tune, and an attacker's fresh browser can never outrank an established one |
| Cookie | `carbon-device`, signed with `SESSION_SECRET`, 1-year `maxAge`, `httpOnly`, `sameSite: lax` | Must outlive the 7-day session. Signing prevents a forged `deviceId`; reuses existing cookie machinery, no new secret |
| Storage | `deviceId` column on existing `userLogin` | Already the per-login record and already user-owned (no `companyId`). Pair `(userId, deviceId)` answers recognition with no new table |
| Step-up re-auth | **None.** Refuse instead | **User decision.** The design is one timestamp comparison; a challenge flow reintroduces the complexity the device signal exists to avoid. `/unlock` was considered and is unusable here anyway — it only renders for idle-locked sessions and destroys sessions with no factor |
| Newer/unrecognised device | Refused with a message naming the remedy | **User decision.** No exception path; the user acts from a device they have used before |
| Self-termination | Never gated, in every combination | The escape hatch that stops step-up becoming a lockout (ASVS 7.5.2) |
| Alert trigger | New `(userId, deviceId)` pair, all login methods | Every vendor surveyed alerts on new device, not every login (>90 % want the former) |
| Alert content | Device + timestamp + security link. **No IP, no location** | **User decision** (no IP). Location follows: no dependency, no GDPR surface, identical on cloud and self-hosted |
| Alert delivery | `trigger("send-email")` with a resolved `companyId` | **User decision.** Reuses `mfa-email.server.ts` exactly; a user with no membership gets no alert and has nothing to protect |
| Client IP | New `getClientIp`, rightmost-first, trusted-proxy bounded | **User decision.** A forgeable IP in a security record is worse than none |
| Audit table | Deferred to its own spec | **User decision.** Keeps this spec's review surface on the gate |
| Multi-tenancy (heuristic 1) | `deviceId` on user-owned `userLogin`; no `companyId` | Device identity precedes company selection, same as the parent spec |
| RLS (heuristic 3) | Unchanged — new column rides the existing owner-only SELECT | Writes stay service-role |
| Form pattern (heuristic 5) | Route-action intents via `useFetcher`, matching existing passkey/revoke intents | Match the file's idiom |
| Backward compatibility (heuristic 7) | Null `deviceId` on pre-feature rows → device unrecognised → refused | Fails toward the safer branch. Note this means revoke is unavailable until the caller's device has been seen once; rows age out at 90 days |

## Data Model Changes

One migration, then `pnpm run generate:types`:

```sql
-- Device recognition for the revoke gate (spec:
-- .ai/specs/2026-09-10-device-gated-session-revocation.md). Opaque id from the
-- signed "carbon-device" cookie. Nullable: rows recorded before this feature,
-- and logins from a client that refuses cookies, have none and are treated as
-- unrecognised.
ALTER TABLE "userLogin" ADD COLUMN "deviceId" TEXT;

-- Recognition asks "has this (userId, deviceId) pair been seen?" on every
-- login and on every revoke.
CREATE INDEX "userLogin_userId_deviceId_idx" ON "userLogin" ("userId", "deviceId");
```

No new table: `userLogin` is already the per-login record, already user-owned,
and already carries the retention and RLS stance a device record needs.

## API / Service Changes

### `packages/auth` (shared)

- **`device.server.ts`** (new) — `getDeviceId(request)`, `setDeviceId()`
  returning a `Set-Cookie`, and `ensureDeviceId(request)` returning
  `{ deviceId, setCookie? }`. Signed via `SESSION_SECRET`; never throws.
- **`recordLogin`** gains `deviceId`, stores it, and returns whether the pair
  was newly seen so the caller can fire the alert.
- **`getDeviceFirstSeenAt(userId, deviceId)`** — `MIN("createdAt")` over that
  user's `userLogin` rows for the device; `null` when unrecognised. One indexed
  lookup.

### `packages/utils`

- **`getClientIp(request, opts?)`** in `ip.ts` — see §4 above. `normalizeIp` and
  `isPrivateIp` stay as they are.

### ERP

- **`sendNewDeviceEmail`** in `apps/erp/app/services/mfa-email.server.ts`
  (alongside the existing security emails) — resolves the user's company,
  renders a new `NewDeviceEmail` template, `trigger("send-email")`, never throws.
- **`security.tsx` action** — before `revokeSession` / `revokeOtherSessions`,
  resolve the caller's device first-seen time and refuse when it is null or not
  strictly older than every target session's `createdAt`.

### Login call sites

All six `recordLogin` sites thread `ensureDeviceId`'s cookie into their existing
`Set-Cookie` headers. The two SSO branches included — they are login mint points
and already call `recordLogin` as of `7f11eb98bb`.

## UI Changes

**Account → Security**, "Your devices" card:

- Caller's device is older than a given row: that row's sign-out control behaves
  exactly as today (confirm modal, then revoke).
- Caller's device is newer than a row, or unrecognised: that row's control is
  disabled with *"This device is newer than that session. Sign out from a device
  you've used for longer."*
- "Sign out other devices" is disabled unless the caller's device is older than
  every other live session, with the same explanation.
- The caller's own row is unaffected — self-termination is always available.

The loader computes an `canRevoke` boolean per device row so the UI never
re-derives the rule.

All strings via Lingui, then `pnpm lingui:extract` + `/translate`.

No MES UI — MES sessions appear and are revocable from ERP, matching the parent
specs.

## Acceptance Criteria

- [ ] A first-ever login sets a signed `carbon-device` cookie and writes its
      `deviceId` to the `userLogin` row
- [ ] A second login from the same browser reuses the same `deviceId` and writes
      a second row with it
- [ ] A tampered `carbon-device` cookie fails signature validation and is
      treated as absent (new device issued), never as a valid id
- [ ] From a device first seen before a target session began, "Sign out" on that
      row succeeds with no challenge
- [ ] From a device first seen after a target session began, that row's control
      is disabled in the UI and the action refuses the POST
- [ ] From an unrecognised device (no cookie, or no prior login), every other
      row is refused and self-termination still works
- [ ] "Sign out other devices" is refused outright when any single other session
      predates the caller's device
- [ ] The refusals hold when the request is POSTed directly, bypassing the UI
- [ ] A login from an unseen `(userId, deviceId)` sends one email naming the
      device and time, containing **no IP and no location**; a login from a seen
      pair sends none
- [ ] The email sends regardless of notification preferences and plan gates
- [ ] A user with no company membership triggers no alert and no error
- [ ] With `TRUSTED_PROXY_COUNT` set, a request whose `x-forwarded-for` carries a
      client-seeded leftmost hop records the real client IP, not the seeded one
- [ ] Pre-feature rows (null `deviceId`) are treated as unrecognised
- [ ] A client that refuses cookies can still log in, and is treated as
      unrecognised rather than erroring
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp
      --filter=mes` and `pnpm run test` pass; new unit tests cover cookie
      signing/forgery, recognition lookup, the gate's three branches, and
      `getClientIp`'s proxy walk

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cookie theft yields a trusted device | Med | A stolen `carbon-device` usually accompanies a stolen session anyway. Device age is a strong signal, not proof — accepted, and the reason the alert is unconditional |
| The user's own new device cannot revoke their old sessions | Med | **Accepted user decision** — the cost of having no step-up path. They act from an older device, or wait for the old sessions to expire (≤7 days). The UI names the remedy explicitly |
| A user whose only device is new (new laptop + cleared cookies) has no revoke path at all | Med | Accepted; self-termination and full logout still work, and sessions expire at 7 days. Revisit if support traffic shows it |
| The other ~25 forgeable-IP call sites stay unfixed | Med | Out of scope here, including rate-limit keying. Should be its own spec — flagged, not silently inherited |
| Alert fatigue from frequent new devices | Low | Fires on new device, not new session; a stable browser alerts once |
| `deviceId` is a cross-login correlator (privacy) | Low | Opaque, per-browser, user-owned, pruned with `userLogin` at 90 days, never shared |

## Open Questions

> All resolved before this spec was written.

- [x] What earns a device the right to revoke others? — **Answer (user):**
      known device, any age. A threshold is satisfiable by waiting and only
      taxes legitimate users.
- [x] Factor-less user on an unrecognised device? — **Answer (user, superseded):**
      originally self-termination only with a step-up path for factor-holders.
      **Revised (user):** drop step-up entirely — see the next question.
- [x] Should an unrecognised/newer device get a step-up challenge? —
      **Answer (user):** no. Refuse with a clear message instead. The design is
      one timestamp comparison and must stay that simple; `/unlock` was also
      found unusable for this (it only renders for idle-locked sessions and
      destroys sessions with no factor).
- [x] How are alerts delivered given `send-email` needs a `companyId`? —
      **Answer (user):** resolve the user's company at send time, reusing the
      existing path.
- [x] Does the audit table belong in this spec? — **Answer (user):** no,
      separate spec built afterwards.
- [x] How to treat the attacker-controlled client IP? — **Answer (user):** fix
      it in this spec, and put no IP in the email at all.
- [x] Geolocation for self-hosted alerts? — **Answer (user):** none — device
      name and time only, identical on every deployment.

## Changelog

- 2026-09-10: Created. Device recognition chosen over session-age gating per
  `.ai/research/session-age-gated-revocation.md`; all six open questions
  resolved with the user before writing.
- 2026-09-10: **Step-up re-authentication removed by user** before planning.
  The gate is now a single comparison — the caller's device must be older than
  the session it ends — with no TOTP/passkey challenge and no factor-based
  branches. Recognition also became an age comparison rather than a binary
  seen/not-seen test.
