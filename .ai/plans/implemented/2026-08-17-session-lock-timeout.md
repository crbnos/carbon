# Session Lock & Session Termination under CUI — implementation plan

Status: IMPLEMENTED 2026-08-18 (residual: `/test` browser verification + passkey-unlock
addition — see `.ai/plans/2026-08-15-nist-800-171-app-remediation.md`).

**Spec:** .ai/specs/implemented/2026-08-17-session-lock-timeout.md
**Research:** .ai/research/session-lock-timeout.md
**Branch:** nist-800-110-audit (single PR #1414)

NIST 800-171 3.1.10 (session lock) + 3.1.11 (session termination), gated on
`CONTROLLED_ENVIRONMENT`, inert otherwise. No DB migration — two optional cookie
fields on `AuthSession`. Server-authoritative enforcement in `requireAuthSession`;
client idle UX drives concealment + a throttled activity heartbeat.

## Progress
- [x] Task 1: Add session-timeout constants to `@carbon/env`
- [x] Task 2: Add `createdAt`/`lastActiveAt` to `AuthSession`
- [x] Task 3: Stamp at mint, preserve across refresh; add predicates + `touchAuthSession` (+ unit tests)
- [x] Task 4: Enforce idle-lock + absolute-termination in `requireAuthSession`
- [x] Task 5: Heartbeat route (ERP + MES)
- [x] Task 6: `/unlock` TOTP route (ERP + MES)
- [x] Task 7: `useIdle` client hook (activity + heartbeat + cross-tab)
- [x] Task 8: `SessionLockOverlay` + wire into ERP/MES shells
- [x] Task 9: MES console idle-lock (tighten pin-in window under CUI)
- [ ] Task 10: Browser verification via `/test`

## Dependencies
- Task 3 needs Tasks 1–2 (constants + type fields).
- Task 4 needs Task 3 (predicates).
- Tasks 5 and 6 need Task 3 (`touchAuthSession` / `completeMfaChallenge` stamping). Tasks 5 and 6 are independent of each other.
- Task 7 needs Task 5 (heartbeat endpoint path). Task 8 needs Tasks 6–7. Task 9 is independent of Tasks 5–8 (separate console mechanism).
- Task 10 is last (needs everything).

---

## Task 1: Add session-timeout constants to `@carbon/env`

**Depends on:** none
**Files:**
- Modify: `packages/env/src/index.ts` — add three numeric constants next to the existing session constants.
- Copy from (precedent): the existing `SESSION_MAX_AGE` / `REFRESH_ACCESS_TOKEN_THRESHOLD` declarations at `packages/env/src/index.ts:372-373` (plain literal `export const`, seconds/ms literals — NOT `getEnv`).

**Steps:**
1. After line 373 (`export const REFRESH_ACCESS_TOKEN_THRESHOLD = 60 * 10; // ...`), add:
   ```ts
   // Session lock / termination (NIST 800-171 3.1.10 / 3.1.11). All in MILLISECONDS
   // (unlike SESSION_MAX_AGE above, which is seconds for the cookie maxAge). Enforced
   // only when CONTROLLED_ENVIRONMENT is true. Plain literals, matching SESSION_MAX_AGE
   // precedent (not env-overridable in v1).
   export const SESSION_IDLE_LOCK_MS = 15 * 60 * 1000; // 15 min — DISA App-Sec STIG web-app idle
   export const SESSION_ABSOLUTE_MAX_MS = 12 * 60 * 60 * 1000; // 12 h — absolute session cap
   export const SESSION_HEARTBEAT_MS = 60 * 1000; // client activity heartbeat throttle
   ```
2. These are re-exported automatically: `@carbon/auth` does `export * from "@carbon/env"` (via `@carbon/config`/`config/env`). No change needed to `@carbon/auth` exports.
3. Do NOT add them to `getBrowserEnv()` — the client receives the values as loader data (Task 8), matching how `session.expiresAt` reaches `CarbonProvider`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/env
# Expected: typecheck passes (1 successful)
```

**Out of scope:** Do not touch `SESSION_MAX_AGE`, `getBrowserEnv`, or the `Window.env` interface.

---

## Task 2: Add `createdAt`/`lastActiveAt` to `AuthSession`

**Depends on:** none
**Files:**
- Modify: `packages/auth/src/types.ts` — add two optional fields to the `AuthSession` interface.

**Steps:**
1. In the `AuthSession` interface (currently ends at the `mfaVerified?: boolean;` field, `packages/auth/src/types.ts:3-19`), add after `mfaVerified`:
   ```ts
     /**
      * Session start (unix ms). Stamped once at mint; PRESERVED across token
      * refresh (never reset by refreshAuthSession). Basis of the 12h absolute cap
      * (SESSION_ABSOLUTE_MAX_MS). Optional for back-compat with sessions minted
      * before this shipped — treated as "now" on first sight.
      */
     createdAt?: number;
     /**
      * Last real user activity (unix ms). Updated only by the activity heartbeat
      * and on unlock — NOT by background requests or token refresh. Basis of the
      * 15min idle lock (SESSION_IDLE_LOCK_MS). Optional for back-compat.
      */
     lastActiveAt?: number;
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth
# Expected: typecheck passes
```

**Out of scope:** Do not change any other field or the `Company`/`Permission`/`Result` types.

---

## Task 3: Stamp at mint, preserve across refresh; add predicates + `touchAuthSession` (+ unit tests)

**Depends on:** Tasks 1, 2
**Files:**
- Modify: `packages/auth/src/services/auth.server.ts` — stamp `createdAt`/`lastActiveAt` in `makeAuthSession`.
- Modify: `packages/auth/src/services/session.server.ts` — preserve both across refresh in `refreshAuthSession`; add `isSessionExpiredAbsolute` / `isSessionIdleLocked` pure predicates and `touchAuthSession`.
- Create: `packages/auth/src/services/session-timeout.test.ts` — unit tests.
- Copy from (precedent): the existing preserve block in `refreshAuthSession` (`session.server.ts:330-337`, which preserves `console`/`mfaVerified`); the existing `mfa-session.test.ts` for the test harness shape.

**Steps:**
1. **Stamp at mint** — in `makeAuthSession` (`auth.server.ts:146-157`), add `createdAt`/`lastActiveAt` to the returned object. Because `makeAuthSession` is also called by `refreshAccessToken` (line 518), stamping `now` here is correct ONLY because `refreshAuthSession` overwrites them with the preserved values in step 2. Add before the `...(options?.mfaVerified ...)` spread:
   ```ts
     createdAt: Date.now(),
     lastActiveAt: Date.now(),
   ```
   (NOTE: this uses `Date.now()` for an absolute instant / elapsed-ms comparison — the narrow exception in `.claude/rules/date-handling.md`; this is not a calendar date. The file already uses `Date.now()` — e.g. `isExpiringSoon`.)
2. **Escape hatch:** confirm the only `makeAuthSession` caller that is a *refresh* (not a fresh login/re-auth) is `refreshAccessToken` (`auth.server.ts:503-519`). The fresh-mint callers are `signInWithBypassEmail` (472), `signInWithEmail` (496), `signInWithPasskey` (595), and `completeMfaChallenge` (177) — all of which SHOULD get `createdAt = now`. If you find another refresh-style caller that must preserve session age, STOP and report — do not improvise.
3. **Preserve across refresh** — in `refreshAuthSession` (`session.server.ts:319-370`), extend the existing preserve block (after the `mfaVerified` preserve at line 335-337) with:
   ```ts
     // Preserve session age + last-activity across a silent token refresh — a
     // refresh is neither a re-auth nor user activity, so it must not reset the
     // absolute-cap clock or the idle clock.
     if (refreshedAuthSession && authSession?.createdAt) {
       refreshedAuthSession.createdAt = authSession.createdAt;
     }
     if (refreshedAuthSession && authSession?.lastActiveAt) {
       refreshedAuthSession.lastActiveAt = authSession.lastActiveAt;
     }
   ```
4. **Pure predicates** — add near `isExpiringSoon` (`session.server.ts:281-283`), importing the two new constants from `../config/env`:
   ```ts
   /** Absolute cap (3.1.11). Missing createdAt = never expired (back-compat; the
    *  session gets stamped on next mint/refresh). */
   export function isSessionExpiredAbsolute(session: AuthSession): boolean {
     if (!session.createdAt) return false;
     return Date.now() - session.createdAt > SESSION_ABSOLUTE_MAX_MS;
   }
   /** Idle lock (3.1.10). Missing lastActiveAt = not locked (back-compat). */
   export function isSessionIdleLocked(session: AuthSession): boolean {
     if (!session.lastActiveAt) return false;
     return Date.now() - session.lastActiveAt > SESSION_IDLE_LOCK_MS;
   }
   ```
   Add `SESSION_ABSOLUTE_MAX_MS`, `SESSION_IDLE_LOCK_MS` to the existing import from `../config/env` at `session.server.ts:6-13`.
5. **`touchAuthSession`** — add an exported helper that re-commits the signed cookie with a fresh `lastActiveAt` (used by the heartbeat and unlock). Model it on `updateSessionConsole` (`session.server.ts:372-387`):
   ```ts
   /** Re-commit the session cookie with lastActiveAt = now. Used by the activity
    *  heartbeat and on unlock. Returns the Set-Cookie string, or null if no session. */
   export async function touchAuthSession(request: Request): Promise<string | null> {
     const session = await getSession(request);
     const authSession = await getAuthSession(request);
     if (!authSession) return null;
     session.set(SESSION_KEY, { ...authSession, lastActiveAt: Date.now() });
     return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
   }
   ```
6. **Unit tests** (`session-timeout.test.ts`): cover
   - `isSessionExpiredAbsolute`: false when `createdAt` missing; false at `now - createdAt < 12h`; true at `> 12h`.
   - `isSessionIdleLocked`: false when `lastActiveAt` missing; false `< 15min`; true `> 15min`.
   - Preserve-across-refresh: simulate `refreshAuthSession` preserving `createdAt`/`lastActiveAt` — assert a refreshed session keeps the ORIGINAL `createdAt` (i.e. the absolute clock does not reset on refresh). Follow the mock style in `mfa-session.test.ts` (mock `makeAuthSession`/`refreshAccessToken`). Use `vi.useFakeTimers()` / `vi.setSystemTime(...)` for the elapsed-time assertions.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth
pnpm --filter @carbon/auth test
# Expected: typecheck passes; new session-timeout tests pass; existing auth tests still pass
```

**Out of scope:** Do not add the enforcement branch to `requireAuthSession` yet (Task 4). Do not touch `completeMfaChallenge` beyond what `makeAuthSession` already gives it (it re-stamps `createdAt`/`lastActiveAt = now` on unlock, which is the intended re-auth behavior).

---

## Task 4: Enforce idle-lock + absolute-termination in `requireAuthSession`

**Depends on:** Task 3
**Files:**
- Modify: `packages/auth/src/services/session.server.ts` — add the two enforcement checks inside `requireAuthSession` (`:285-317`), gated on `CONTROLLED_ENVIRONMENT`, skipping console device sessions.
- Copy from (precedent): the existing MFA re-check redirect in the same function (`session.server.ts:309-314`) and the `destroyAuthSession` termination pattern (`:214-219`).

**Steps:**
1. Import `CONTROLLED_ENVIRONMENT` from `../config/env` (add to the existing import block).
2. In `requireAuthSession`, AFTER the refresh (`:301-303`) and BEFORE the MFA re-check (`:309`), insert:
   ```ts
     // NIST 800-171 3.1.10 / 3.1.11 — controlled environments only. Console DEVICE
     // sessions are exempt: their lock is the operator pin-in (see console.server),
     // and a shared kiosk must not be force-logged-out mid-shift (spec D8).
     if (CONTROLLED_ENVIRONMENT && !authSession.console) {
       if (isSessionExpiredAbsolute(authSession)) {
         // 3.1.11 termination — destroy the session, force full re-login.
         throw await destroyAuthSession(request);
       }
       if (isSessionIdleLocked(authSession)) {
         // 3.1.10 lock — session PRESERVED; re-auth at /unlock to resume.
         throw redirect(`${path.to.unlock}?${makeRedirectToFromHere(request)}`);
       }
     }
   ```
3. Add `path.to.unlock` to the auth package path helper (`packages/auth/src/utils/path.ts`) — find where `path.to.mfa` / `path.to.login` are defined and add `unlock: "/unlock"` in the same shape. If `path.to.mfa` is defined there, mirror it exactly. If the path helper does not have `mfa`, STOP and report (the redirect target must resolve).
4. `destroyAuthSession` already returns a `redirect(...)` Response — `throw` it (matches how `refreshAuthSession` throws its redirect).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth
pnpm --filter @carbon/auth test
# Expected: passes. (Behavioral verification is Task 10 — CONTROLLED_ENVIRONMENT is unset locally.)
```

**Out of scope:** The API-key path (`auth.server.ts:219-330`) — it never calls `requireAuthSession`, so machine callers are exempt by construction; do not add a check there. Do not gate on anything other than `CONTROLLED_ENVIRONMENT` (no per-company toggle in v1).

---

## Task 5: Heartbeat route (ERP + MES)

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/routes/api+/session.heartbeat.ts`
- Create: `apps/mes/app/routes/api+/session.heartbeat.ts`
- Copy from (precedent): `apps/erp/app/routes/_public+/refresh-session.tsx` (POST-only action that re-issues the session cookie and returns a small JSON body).

**Steps:**
1. Each file: POST-only action. Require a valid session (call `requirePermissions(request, {})` — an empty permission set just asserts an authenticated session), then call `touchAuthSession(request)` and return `data({ ok: true }, { headers: { "Set-Cookie": cookie } })` when a cookie came back, else `data({ ok: false })`.
   ```ts
   import { assertIsPost } from "@carbon/auth";
   import { requirePermissions } from "@carbon/auth/auth.server";
   import { touchAuthSession } from "@carbon/auth/session.server";
   import { data, type ActionFunctionArgs } from "react-router";

   export async function action({ request }: ActionFunctionArgs) {
     assertIsPost(request);
     await requirePermissions(request, {});
     const cookie = await touchAuthSession(request);
     return data(
       { ok: Boolean(cookie) },
       cookie ? { headers: { "Set-Cookie": cookie } } : undefined
     );
   }
   ```
2. Confirm the flat-route filename maps to `/api/session/heartbeat` (the `api+/` + `.` segment convention, e.g. existing `api+/…` files). If the resolved path differs, note the real path for Task 7.
3. NOTE: `requireAuthSession` runs inside `requirePermissions`, so a heartbeat from an already-idle session would itself redirect to `/unlock` before touching. That is correct — once locked, the heartbeat stops resuming the session; only `/unlock` re-auth does. The heartbeat's job is to keep an ACTIVE session from locking, firing well within the 15-min window.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=mes
# Expected: both pass
```

**Out of scope:** No rate-limit table needed; the endpoint only re-signs a cookie. Do not add idle logic here — enforcement lives in `requireAuthSession`.

---

## Task 6: `/unlock` TOTP route (ERP + MES)

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/routes/_public+/unlock.tsx`
- Create: `apps/mes/app/routes/_public+/unlock.tsx`
- Copy from (precedent): `apps/erp/app/routes/_public+/mfa.tsx` (loader guards, `completeMfaChallenge` action, Set-Cookie of the rotated session, OTP input via `~/components/TotpEnrollment`) and `apps/mes/app/routes/_public+/mfa.tsx` for the MES variant.

**Steps:**
1. Build `unlock.tsx` as a near-copy of `mfa.tsx` with these differences:
   - **Loader**: redirect away (to `redirectTo` or authenticated root) if the session is NOT actually idle-locked — i.e. if `getAuthSession` returns a session and `!isSessionIdleLocked(session)` and `!isSessionExpiredAbsolute(session)`. If the session is absolute-expired or missing, redirect to `/login` (termination wins). Only render the unlock form when the session exists and is idle-locked.
   - **Action**: identical to `mfa.tsx` — `completeMfaChallenge(request, code)`; on success Set-Cookie the rotated session (which now carries fresh `createdAt`/`lastActiveAt` from `makeAuthSession`) and redirect to `redirectTo`. Rate-limit the same way `mfa.tsx` does.
   - **Copy/label**: "Session locked — enter your authentication code to resume" instead of the enrollment-challenge copy. Reuse the shared `OtpInput` / `useTotpEnrollment` from `~/components/TotpEnrollment` and `INVALID_CODE_MESSAGE`.
2. MES `unlock.tsx`: mirror the MES `mfa.tsx` (its layout/console handling). Console-mode sessions never reach `/unlock` (Task 4 skips `authSession.console`); the MES `/unlock` serves non-console MES sessions.
3. If `mfa.tsx` relies on the pending-MFA session (`getPendingMfaSession`) in its loader, DROP that branch for `/unlock` — an unlock always operates on the existing full session, never a pending one.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=mes
# Expected: both pass
```

**Out of scope:** Do not implement PIN unlock here — console PIN is Task 9. Do not modify `completeMfaChallenge` (Task 3 already made it re-stamp timestamps).

---

## Task 7: `useIdle` client hook (activity + heartbeat + cross-tab)

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/hooks/useIdle.tsx`
- Create: `apps/mes/app/hooks/useIdle.tsx` (or a shared spot if both apps import from one — prefer per-app to match the existing per-app hooks dir; keep them identical).
- Copy from (precedent): `packages/auth/src/lib/supabase/provider.tsx:63-105` (the existing `visibilitychange` listener + `useInterval` refresh loop — reuse this activity/interval shape).

**Steps:**
1. `useIdle({ idleMs, heartbeatMs, heartbeatUrl, enabled })` returns `{ isIdle, resume }`:
   - When `enabled` is false (non-controlled env), the hook is inert: never sets `isIdle`, never posts.
   - Track `lastActivityRef = Date.now()` updated on `mousemove`, `mousedown`, `keydown`, `touchstart`, `scroll`, `visibilitychange` (visible). Throttle activity handling to avoid per-event work.
   - A `setInterval` (~1s) sets `isIdle = true` once `Date.now() - lastActivity > idleMs`.
   - **Heartbeat**: while active (not idle) and at most once per `heartbeatMs`, `fetch(heartbeatUrl, { method: "POST" })` (credentials same-origin). Do NOT heartbeat while idle.
   - **Cross-tab** via `BroadcastChannel("carbon-session-activity")`: on local activity, post `{ t: Date.now() }` (throttled); on receiving a peer activity message, update `lastActivity` and clear `isIdle`. On local lock, post `{ locked: true }`; peers set `isIdle = true`. Guard `typeof BroadcastChannel !== "undefined"`. Close the channel on unmount.
   - `resume()` clears `isIdle` and resets `lastActivity` (called after a successful unlock navigation).
2. Use plain `Date.now()` here — client-side elapsed-ms, the allowed exception; this is not a calendar date.
3. Do NOT add `react-idle-timer` or any dependency (spec D10).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=mes
# Expected: both pass
```

**Out of scope:** No server calls other than the heartbeat POST. The hook renders nothing — the overlay is Task 8.

---

## Task 8: `SessionLockOverlay` + wire into ERP/MES shells

**Depends on:** Tasks 6, 7
**Files:**
- Create: `apps/erp/app/components/SessionLockOverlay.tsx`
- Create: `apps/mes/app/components/SessionLockOverlay.tsx` (identical shape, MES sizing `size="lg"` per `.claude/rules` MES convention).
- Modify: `apps/erp/app/routes/x+/_layout.tsx` — pass timeout config from loader; render the overlay driven by `useIdle`.
- Modify: `apps/mes/app/routes/x+/_layout.tsx` — same.
- Copy from (precedent): `apps/erp/app/components/MfaEnrollmentRequired.tsx` (full-screen blocking-screen shape) and the shell's existing `mfaScreen` render (`apps/erp/app/routes/x+/_layout.tsx:397-411`); the session prop is already passed to `CarbonProvider` at `x+/_layout.tsx:413` and `session.expiresAt` at `:259-264`.

**Steps:**
1. **Shell loader**: in each `x+/_layout.tsx` loader, add to the returned data a `sessionTimeout` object:
   ```ts
   sessionTimeout: {
     enabled: CONTROLLED_ENVIRONMENT,
     idleMs: SESSION_IDLE_LOCK_MS,
     heartbeatMs: SESSION_HEARTBEAT_MS,
   }
   ```
   Import the three from `@carbon/auth` (re-exported from `@carbon/env`). Console sessions: pass `enabled: false` when `consoleMode` is true (console uses the pin-in path, Task 9) — read the existing `consoleMode`/`authSession.console` already available in the loader.
2. **`SessionLockOverlay`**: a full-viewport fixed overlay (mirror `MfaEnrollmentRequired`'s container) that renders ONLY when its `isIdle` prop is true. It must **conceal page content** (opaque background, high z-index, covers the shell) — pattern-hiding (AC-11(1)). Content: a lock icon, "Session locked" heading, short copy, and a link/button that navigates to `/unlock?redirectTo=<current path>` (the actual TOTP form lives on `/unlock`, Task 6 — the overlay just conceals + funnels there). Optionally embed the OTP form inline later; for v1 the overlay conceals and routes to `/unlock`.
3. **Wire in**: in the shell component, call `useIdle({ enabled: sessionTimeout.enabled, idleMs, heartbeatMs, heartbeatUrl: "/api/session/heartbeat" })` and render `<SessionLockOverlay isIdle={isIdle} />` alongside the existing `mfaScreen`/ITAR blocking screens. When `isIdle`, render the overlay INSTEAD OF / on top of the `Outlet` so content is concealed even on a same-pathname navigation (the server enforcement in Task 4 is the boundary; this overlay is the immediate concealment).
4. Keep it inert when `!sessionTimeout.enabled` — non-controlled deployments see nothing.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=mes
pnpm run lint
# Expected: typecheck + biome pass
```

**Out of scope:** Do not change the MFA/ITAR blocking screens. Do not add the overlay to non-`x+` routes (public routes have no session shell).

---

## Task 9: MES console idle-lock (tighten pin-in window under CUI)

**Depends on:** none (independent console mechanism)
**Files:**
- Modify: `apps/mes/app/services/console.server.ts` — make the pin-in idle window `SESSION_IDLE_LOCK_MS` under `CONTROLLED_ENVIRONMENT` (currently fixed 1h, `CONSOLE_PIN_MAX_AGE`).
- Modify: `packages/auth/src/services/auth.server.ts:187-194` — `getEffectiveUser` reads the pin cookie with a hard-coded `3600000` (1h) expiry; apply the same tightening so the server drops an idle operator to "not pinned in".
- Modify: `apps/mes/app/components/PinInOverlay.tsx` — surface the pin-in overlay after `SESSION_IDLE_LOCK_MS` of idle when controlled (reuse the `useIdle` hook from Task 7 to trigger re-display).
- Copy from (precedent): the existing `getConsolePinIn` expiry check (`console.server.ts:29-30`) and `getEffectiveUser` (`auth.server.ts:190-194`).

**Steps:**
1. In `console.server.ts`, replace the fixed `CONSOLE_PIN_MAX_AGE_MS` used in `getConsolePinIn`'s elapsed check with `CONTROLLED_ENVIRONMENT ? SESSION_IDLE_LOCK_MS : CONSOLE_PIN_MAX_AGE_MS`. Import both from `@carbon/auth`. Keep the cookie `maxAge` on `setConsolePinIn` as-is (the manual elapsed check is the tightening point; a shorter maxAge would also work but the elapsed check is the defense-in-depth already there).
2. In `getEffectiveUser` (`auth.server.ts:190-194`), replace the literal `3600000` with `CONTROLLED_ENVIRONMENT ? SESSION_IDLE_LOCK_MS : 3600000` so the server-side effective-user resolution matches. Import `CONTROLLED_ENVIRONMENT` + `SESSION_IDLE_LOCK_MS`.
3. In `PinInOverlay.tsx`, use `useIdle` (enabled only when controlled + console) so that after 15 min idle the overlay re-appears (operator must re-PIN). If the existing overlay is already shown whenever no operator is pinned in, the tightened server expiry (steps 1–2) may be sufficient on the next navigation; add the client `useIdle` trigger so concealment is immediate rather than waiting for a request. If the existing pin-in display logic already reacts to "no pinned-in user", wire `isIdle` to force that state.
4. **Escape hatch:** if `CONTROLLED_ENVIRONMENT` / `SESSION_IDLE_LOCK_MS` cannot be imported into `console.server.ts` without a circular import, STOP and report — fall back to reading `SESSION_IDLE_LOCK_MS` via a small constant duplicated with a comment rather than breaking the build.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
pnpm exec turbo run typecheck --filter=@carbon/auth
# Expected: both pass
```

**Out of scope:** Do not force the console DEVICE session to re-login (spec D8 — device exempt from the 12h cap; Task 4 already skips `authSession.console`). Do not change how PINs are stored/verified (`console.pin-in.tsx`).

---

## Task 10: Browser verification via `/test`

**Depends on:** Tasks 1–9
**Files:** none (verification only)

**Steps:**
1. This feature is gated on `CONTROLLED_ENVIRONMENT`, which is NOT set in normal local dev. To verify, boot the stack with `CONTROLLED_ENVIRONMENT=true` (via the `.env` `#force` escape hatch documented in `.claude/rules/environment-configuration.md`, so `crbn up` won't overwrite it), then run `/test`.
2. Verify against the spec Acceptance Criteria, at minimum:
   - Idle 15 min (temporarily lower `SESSION_IDLE_LOCK_MS` to ~30s for the test run, or drive via the hook) → lock overlay conceals content.
   - Active mouse/keyboard → never locks; leaving the tab idle with only background traffic → DOES lock (proves request-time is not the activity signal).
   - Unlock with a valid TOTP → resumes the same page; wrong code → stays locked.
   - `curl` with an idle-expired cookie → redirected to `/unlock`, no protected data.
   - Absolute cap → terminates to `/login` regardless of activity.
   - Cross-tab lock propagation.
   - `CONTROLLED_ENVIRONMENT` unset → no lock, identical to today.
   - MES console → pin-in re-PIN after idle; device not force-logged-out.
   - Capture agent-browser screenshots of the lock overlay + unlock for the PR (per the surface-designs-with-screenshots convention).
3. If the stack cannot boot with the controlled flag, the loop is BLOCKED (not done) — report per the loop-proof philosophy.

**Verify:**
```bash
# Full typecheck of touched packages + lint before calling done:
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=@carbon/env --filter=erp --filter=mes
pnpm run lint
pnpm --filter @carbon/auth test
# Expected: all pass; acceptance criteria demonstrated in the browser with screenshots.
```

**Out of scope:** Do not restore any temporarily-lowered constant without noting it; ship the real 15 min / 12 h values.
