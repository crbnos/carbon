# Session Lock & Session Termination under CUI (NIST 800-171 3.1.10 / 3.1.11)

> Status: IMPLEMENTED 2026-08-18 (3.1.10/3.1.11 — commits `c76e15e4c`→`c7a076477`).
> Residual: browser-verification (`/test`) + passkey-unlock addition tracked in
> `.ai/plans/2026-08-15-nist-800-171-app-remediation.md`.
> Author: Brad Barbin (with Claude)
> Date: 2026-08-17

## TLDR

Add an **idle session lock** and an **absolute session-lifetime termination** to
Carbon, gated on `CONTROLLED_ENVIRONMENT` (ITAR/CUI), mirroring the existing
`requireMfa` + blocking-screen pattern. After 15 minutes of inactivity a
full-screen **lock** conceals the screen and requires **re-authentication** to
resume — the session and in-progress work are preserved (NIST 3.1.10 / AC-11). A
hard **12-hour** cap since session start **terminates** the session and forces a
full re-login regardless of activity (NIST 3.1.11 / AC-12). Enforcement is
**server-authoritative** in `requireAuthSession` (the one always-run choke point),
driven by two new timestamps (`createdAt`, `lastActiveAt`) on the signed session
cookie; a small in-house client idle hook drives the lock UX and a throttled
activity heartbeat. Non-controlled deployments are unaffected. MES console
(shared-kiosk) sessions lock the operator **pin-in** (re-PIN) instead of using
TOTP, and the console *device* login is exempt from the 12-hour cap.

Research: [.ai/research/session-lock-timeout.md](../research/session-lock-timeout.md).

## Problem Statement

Carbon has no session lock and no absolute session-lifetime cap. Today:

- The only outer bound is a **rolling 7-day cookie `maxAge`** (`SESSION_MAX_AGE`),
  re-committed on every request — a client-side rolling lifetime, not a
  server-enforced cap. An active user's refresh token rotates indefinitely, so a
  session can live effectively forever (`session.server.ts` `refreshAuthSession`).
- There is **no inactivity lock**: an unattended browser on a shop floor or desk
  keeps CUI on screen and the session fully usable.
- Supabase's own timebox/inactivity controls are Pro-tier and only bite at the
  ~50-minute JWT-refresh boundary — too coarse, and not configured
  (`config.toml`: no `sessions.timebox`/`inactivity_timeout`).

For a controlled (ITAR/CUI) deployment this fails two NIST 800-171 controls:

- **3.1.10 Session Lock (AC-11 / AC-11(1))** — initiate a session lock after an
  organization-defined period of inactivity; conceal previously visible
  information; retain the lock until the user re-establishes access via
  identification & authentication procedures. (A lock is *not* a substitute for
  logging out; it preserves the session.)
- **3.1.11 Session Termination (AC-12)** — automatically terminate a user session
  after an organization-defined condition. Lock ≠ termination — an assessor checks
  for both.

## Proposed Solution

Layer two mechanisms, both gated on `CONTROLLED_ENVIRONMENT`, both enforced
server-side, so the app is the authority (not client JS):

1. **Idle lock (3.1.10)** — at **15 min** of no *real user activity*, conceal the
   screen with a full-screen lock overlay and require re-authentication to resume.
   The session/cookie is **preserved** — no work lost. This is the leniency-max
   choice: idle never *logs you out*, it only locks.
2. **Absolute termination (3.1.11)** — **12 h** since session start (`createdAt`)
   terminates the session (destroy cookie → full login), independent of activity
   and independent of token refresh. This is the required termination condition;
   explicit logout is the other.

Both thresholds are named constants, force-on under `CONTROLLED_ENVIRONMENT`, and a
no-op otherwise (mirrors `requireMfa`).

### Where enforcement lives

`requireAuthSession` (`packages/auth/src/services/session.server.ts:285-317`) is the
single point called by `requirePermissions` on **every authenticated leaf
loader/action** in both apps. It already computes expiry and can `throw redirect`.
The two checks slot in there, after the existing token-refresh + MFA re-check:

- **Absolute**: `now - authSession.createdAt > SESSION_ABSOLUTE_MAX_MS` →
  `destroyAuthSession` → `/login` (a *termination*). Console device sessions
  (`authSession.console` set) are **exempt** (decision D8).
- **Idle**: `now - authSession.lastActiveAt > SESSION_IDLE_LOCK_MS` → `throw
  redirect('/unlock?redirectTo=…')` (a *lock* — session preserved, not destroyed).
  Console sessions redirect to the pin-in lock instead (D8).

Placing it here (not the shell loader) is deliberate: the shell loader is skipped
on search-param-only navigations (`x+/_layout.tsx` `shouldRevalidate`), so a
shell-only gate would miss cheap same-pathname navigations and realtime
revalidations; `requireAuthSession` runs on all of them. The **API-key path**
(`auth.server.ts:219-330`) never calls `requireAuthSession`, so machine callers are
exempt by construction.

### Activity signal = throttled client heartbeat, NOT server request-time

`lastActiveAt` must reflect **real user activity** (mouse/keyboard/touch), not HTTP
request time. Carbon issues background requests independent of the user — the 60 s
`CarbonProvider` interval (`provider.tsx:87-105`), realtime revalidations, and
prefetches — so updating `lastActiveAt` on every server request would keep an
unattended session "active" forever and defeat the lock. Therefore:

- A small in-house **`useIdle` client hook** listens to real activity events, and
  when the user is active POSTs a **throttled heartbeat** (~ every 60 s) to a
  `/api/session/heartbeat` action that re-commits the signed cookie with a fresh
  `lastActiveAt`. Only genuine activity moves the timestamp.
- The **server independently enforces** the threshold against `lastActiveAt`.
  Trusting the client for the *activity signal* (not the *enforcement*) is the
  OWASP-standard split and is sound here: idle timeout defends the *unattended*
  session; a thief who keeps a stolen token "active" is bounded instead by the 12 h
  absolute cap, the ≤50 min JWT, and refresh-reuse detection. The cookie is
  HMAC-signed, so the client cannot forge a future `lastActiveAt` — it only chooses
  *when* to heartbeat, through the signed round-trip.

### Client lock UX (concealment is immediate)

The `useIdle` hook also drives the **lock overlay** locally, so concealment
(AC-11(1)) is instant and does not wait on a server round-trip:

- At `SESSION_IDLE_LOCK_MS` the hook renders a **full-screen lock overlay** that
  removes app content from view (pattern-hiding: a blank/branded screen + a
  re-auth form), mirroring the `MfaEnrollmentRequired` / ITAR blocking-screen shape.
- Cross-tab: a `BroadcastChannel` (no new dependency) reconciles activity and lock
  across tabs — activity in any tab resets the shared timer; a lock in one tab
  locks all. (An optional ~13 min pre-lock toast; non-destructive, so it is only a
  courtesy, not a data-loss guard.)
- The overlay is UX; the server enforcement above is the boundary. A scripted
  request past the idle threshold still gets `throw redirect('/unlock')`.

### Unlock (re-authentication)

- **ERP + non-console MES → TOTP.** `/unlock` reuses `completeMfaChallenge`
  (`session.server.ts:138-202`), which rotates tokens **in place** in the same
  `carbon` cookie (no destroy) — the existing "re-auth into an existing session"
  precedent. On success it re-stamps `lastActiveAt = now`, preserves `createdAt`,
  and redirects back. Controlled-env users are force-MFA-enrolled, so a factor
  always exists.
- **MES console → PIN.** A console session's lock is the **operator pin-in**
  dropping to the existing `PinInOverlay` (`console.pin-in.tsx` verifies
  `employee.pin`, sets the `console-pin-{companyId}` cookie). Under
  `CONTROLLED_ENVIRONMENT` the pin-in idle window tightens from 1 h to
  `SESSION_IDLE_LOCK_MS` (15 min). Re-PIN resumes; the device login persists.
- If the **absolute** cap has also passed, termination wins over unlock: `/unlock`
  (and the pin-in) see the expired `createdAt` and fall through to full `/login`.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| D1: Gate | Force-on under `CONTROLLED_ENVIRONMENT`; off (no-op) otherwise | Mirrors `requireMfa`; controlled deployments only. No per-company toggle in v1 (can add later like `companySettings.requireMfa`). |
| D2: Idle → lock, not logout | Idle triggers a **resumable lock** (session preserved, re-auth to resume); no idle-logout | Maximally lenient while compliant — 3.1.10 wants a lock (obscure + preserve + re-auth), and NIST lists inactivity-termination as an *example*, not a mandate. |
| D3: Termination condition | **Absolute 12 h cap** since `createdAt` + explicit logout satisfy 3.1.11 | Bounds total session/hijack window independent of refresh; 12 h = AWS full-workday precedent, lenient end of OWASP 4–8 h. |
| D4: Idle threshold | **15 min** | DISA App-Sec STIG web-app number (V-222389); the lenient ceiling (30 min invites a finding for CUI). NIST leaves it org-defined. |
| D5: Enforcement point | `requireAuthSession` (not the shell loader) | The one always-run choke point; shell loader is skipped on search-param navs. API-key path exempt by construction. |
| D6: Activity signal | Throttled **client heartbeat** updates cookie `lastActiveAt`; server enforces the threshold | Server request-time is a false "active" signal (60 s poll + realtime revalidations). OWASP split: client signals activity, server enforces. |
| D7: State storage | `createdAt` + `lastActiveAt` on the **signed session cookie** (`AuthSession`) | Carbon has no server session store; the cookie is the session. HMAC signing prevents forgery. Both must be preserved across `refreshAuthSession` (like `console`/`mfaVerified`); `lastActiveAt` updated only by the heartbeat/unlock. |
| D8: MES console | Console **device** login exempt from the 12 h cap; console lock = existing **pin-in** re-PIN, tightened to 15 min under CUI | Shared kiosk shouldn't force device re-login twice a shift; operator attribution + ≤15 min re-PIN covers the unattended-display risk. (User decision "a".) |
| D9: Unlock credential | TOTP (ERP/non-console MES) via `completeMfaChallenge`; PIN (console) | Reuses existing in-place re-auth; controlled-env users always have a TOTP factor; console already uses PINs. |
| D10: Dependency | **No new dependency** — in-house `useIdle` hook + `BroadcastChannel` | Respects ask-first-on-deps; idle logic is small and mirrors existing `CarbonProvider` visibility/interval hooks. |
| D11: Thresholds config | Named constants in `@carbon/env` (like `SESSION_MAX_AGE`/`REFRESH_ACCESS_TOKEN_THRESHOLD`) | Documented, single source, overridable by env for a deployment's risk analysis; defaults recorded in the security plan. |

## Data Model Changes

**No new tables and no migration.** The session is a signed react-router cookie,
not a DB row. The change is to the in-cookie `AuthSession` payload
(`packages/auth/src/types.ts`) — two optional fields, backward-compatible with
sessions minted before this ships:

```ts
export interface AuthSession {
  // …existing fields…
  console?: string;
  mfaVerified?: boolean;
  /** Session start (unix ms). Set once at mint; preserved across refresh. Basis of the 12h absolute cap. */
  createdAt?: number;
  /** Last real user-activity (unix ms). Updated by the activity heartbeat / on unlock. Basis of the 15min idle lock. */
  lastActiveAt?: number;
}
```

Backward compatibility: fields are optional. When a pre-existing session lacks
them, `requireAuthSession` treats `createdAt`/`lastActiveAt` as "now" on first
sight and stamps them (so the clock starts at first post-deploy request rather than
locking everyone out immediately). Both are stamped in every mint path — login
(`makeAuthSession`/`setAuthSession`), `completeMfaChallenge`, dev bypass — and
**preserved** (not reset) in `refreshAuthSession`, alongside the existing
`console`/`mfaVerified` preservation (`session.server.ts:330-337`).

New constants (`packages/env/src/index.ts`, re-exported by `@carbon/auth`):

```ts
export const SESSION_IDLE_LOCK_MS  = getEnvNumber("SESSION_IDLE_LOCK_MS",  15 * 60 * 1000);   // 15 min
export const SESSION_ABSOLUTE_MAX_MS = getEnvNumber("SESSION_ABSOLUTE_MAX_MS", 12 * 60 * 60 * 1000); // 12 h
export const SESSION_HEARTBEAT_MS  = getEnvNumber("SESSION_HEARTBEAT_MS",  60 * 1000);        // heartbeat throttle
```

## API / Service Changes

`packages/auth/src/services/session.server.ts`
- `makeAuthSession` (in `auth.server.ts`) / `setAuthSession`: stamp `createdAt = now`
  and `lastActiveAt = now` at mint.
- `refreshAuthSession`: **preserve** `createdAt`; preserve or refresh `lastActiveAt`
  (refresh is not user activity, so preserve — the heartbeat owns it).
- `completeMfaChallenge`: on a successful unlock/step-up, set `lastActiveAt = now`,
  preserve `createdAt`.
- `requireAuthSession`: after refresh + MFA re-check, run the absolute check (→
  `destroyAuthSession`) then the idle check (→ `throw redirect('/unlock')`), gated on
  `CONTROLLED_ENVIRONMENT`, skipping console device sessions per D8. A new
  `touchAuthSession(request, session)` helper re-commits the cookie with a fresh
  `lastActiveAt` for the heartbeat action.
- New: `isSessionExpiredAbsolute(session)` / `isSessionIdleLocked(session)` pure
  predicates (unit-testable, no I/O) — the enforcement math lives here.

Routes (ERP + MES):
- `apps/{erp,mes}/app/routes/api+/session.heartbeat.ts` — POST-only; requires a
  valid session, calls `touchAuthSession`, returns `{ ok: true }` + Set-Cookie.
  Throttled client-side; rate-limited server-side.
- `apps/{erp,mes}/app/routes/_public+/unlock.tsx` — the re-auth screen. ERP/non-console
  MES: TOTP form → `completeMfaChallenge`. Loader redirects away if the session is not
  actually idle-locked (like `/mfa`). Reuses `~/components/TotpEnrollment` OTP input.
- Console lock is handled by the existing `PinInOverlay` / `console.pin-in.tsx`; only
  the idle window constant changes under CUI.

## UI Changes

- **`useIdle` hook** (`packages/react/src/hooks` or app-level `~/hooks`): tracks real
  activity, exposes `{ isIdle, lastActive }`, fires the throttled heartbeat, and
  coordinates cross-tab via `BroadcastChannel`. Reuses the existing `visibilitychange`
  handling in `CarbonProvider` (`provider.tsx:63-85`).
- **`SessionLockOverlay`** — full-screen pattern-hiding overlay rendered when
  `isIdle`, mirroring `MfaEnrollmentRequired`. Contains the unlock form (TOTP for
  standard sessions; delegates to `PinInOverlay` for console). Wired into the ERP/MES
  shells, only active under `CONTROLLED_ENVIRONMENT`.
- No changes to non-controlled deployments (hook is inert when
  `CONTROLLED_ENVIRONMENT` is false).

## Acceptance Criteria

- [ ] With `CONTROLLED_ENVIRONMENT=true`, an idle ERP session shows a full-screen
      lock overlay concealing page content after 15 min of no mouse/keyboard activity.
- [ ] Continuous real activity (mouse/keyboard) never triggers the lock; background
      traffic alone (leaving the tab open with no user input) DOES trigger it at 15 min
      — proving the 60 s poll/realtime revalidations do not count as activity.
- [ ] Unlocking a standard session with a valid TOTP code restores the exact page and
      in-progress form state (session preserved, tokens rotated in place, not a new login).
- [ ] A wrong/absent TOTP does not unlock; the overlay stays and page content remains
      concealed.
- [ ] A scripted/`curl` request carrying an idle-expired session cookie is redirected to
      `/unlock` and served no protected data (server-authoritative, not client-only).
- [ ] At 12 h since session start, the next request terminates the session (cookie
      destroyed) and redirects to `/login`, regardless of activity and regardless of how
      many times the token refreshed in between.
- [ ] A locked tab propagates the lock to other open tabs of the same app within a few
      seconds; activity in one tab keeps the others unlocked.
- [ ] With `CONTROLLED_ENVIRONMENT` unset/false, no lock, no heartbeat, no absolute cap —
      behavior is identical to today (7-day rolling cookie).
- [ ] An MES console (console mode) session drops to the `PinInOverlay` after 15 min idle
      and requires the operator's PIN to resume; the console **device** login is NOT forced
      to fully re-login at 12 h.
- [ ] API-key (`carbon-key`) requests are never locked or absolute-terminated.
- [ ] `pnpm --filter @carbon/auth typecheck` and `pnpm --filter @carbon/auth test` pass;
      new unit tests cover `isSessionExpiredAbsolute` / `isSessionIdleLocked` and the
      preserve-across-refresh behavior.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Lockout / mass-invalidation from bad timestamp math or refresh not preserving `createdAt` | High | Optional fields; treat missing as "now" and stamp; unit tests for preserve-across-refresh; feature is inert unless `CONTROLLED_ENVIRONMENT`. |
| Heartbeat churn (Set-Cookie every 60 s) load | Low | Throttled to `SESSION_HEARTBEAT_MS`; only fires while genuinely active; heartbeat action is lightweight + rate-limited. |
| Client-sourced activity signal is "trusted" | Low | Threat model is the *unattended* session; a stolen token kept active is bounded by the 12 h absolute cap, ≤50 min JWT, refresh-reuse detection. Cookie HMAC prevents forging a future `lastActiveAt`. |
| Idle check misplaced (shell-only) misses cheap navigations | Med | Enforce in `requireAuthSession`, which runs on every leaf loader/action, not the shell. |
| Unlock redirect loop / escape-hatch maze (the MFA-enrollment lesson) | Med | Single dedicated `/unlock` route (not a shell-wide redirect allowlist); `/unlock` needs only a valid-but-idle session; console uses the existing pin-in. |
| MFA token rotation on unlock leaves a stale cookie | Med | `completeMfaChallenge` already returns the rotated cookie; `/unlock` Set-Cookies it (existing `/mfa` precedent). |
| Console kiosk exempt from absolute cap weakens 3.1.11 there | Low | Accepted (D8): operator attribution + ≤15 min re-PIN covers the display risk; documented in the security plan. |

## Open Questions

> Resolved with the user before writing (audit trail of the /grill step).

- [x] Idle → lock or terminate? — **Answer:** Idle → **resumable lock only** (session
      preserved, re-auth to resume). Termination comes from the 12 h absolute cap +
      explicit logout. Most lenient split that still satisfies both 3.1.10 and 3.1.11.
- [x] Unlock credential? — **Answer:** **Console mode → PIN; all other → TOTP** via
      `completeMfaChallenge`. (User: "for the MES — pin unlock in console mode — totp if not.")
- [x] Configurability? — **Answer:** Force-on under `CONTROLLED_ENVIRONMENT` only;
      no per-company toggle in v1 (mirror `requireMfa`, add later if wanted).
- [x] Defaults? — **Answer:** idle **15 min** (DISA), absolute **12 h** (AWS); optional
      ~13 min pre-lock toast.
- [x] Blast radius? — **Answer:** `requireAuthSession` (ERP + MES interactive leaf
      loaders/actions); API-key callers exempt by construction.
- [x] Does the 12 h absolute cap apply to the MES console *device* login? — **Answer:**
      **No (option A)** — exempt the console device login; the console lock is the
      operator pin-in re-PIN, tightened to 15 min under CUI. (User: "a".)

## Changelog

- 2026-08-17: Created. All open questions resolved with the user prior to writing
  (research → grill → spec). Ready for `/plan`.
