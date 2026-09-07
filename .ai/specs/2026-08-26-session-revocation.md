# Session Revocation — "Sign out that device"

> Status: in-progress
> Author: Claude (design resolved with Naveen)
> Date: 2026-08-26

## TLDR

Give the sign-in activity card live **session status** (Current / Active /
Ended) and the ability to **revoke a session** — per device, and all-other-
devices at once — by piggybacking GoTrue's existing server-side session store
instead of building one. Each `userLogin` row gains the GoTrue `sessionId`
from the access token's `session_id` claim; revocation deletes the
`auth.sessions` row (refresh tokens cascade away, confirmed by FK), and the
already-existing `requireAuthSession({ verify: true })` gate on every app
shell bounces the revoked device to login within ~a minute. Logout becomes a
real server-side revocation too. Builds directly on
[2026-08-26-user-devices-login-history.md](2026-08-26-user-devices-login-history.md);
prior vendor research in
[.ai/research/login-notification-emails.md](../research/login-notification-emails.md)
(Notion's one-click "log out that device" is the pattern users know).

## Problem Statement

The activity card shows that a login *happened* but not whether that session
is still *alive*, and a user who spots a session that isn't theirs can do
nothing about it. Worse, logout today only clears cookies
(`destroyAuthSession`) — the GoTrue session and its refresh tokens survive, so
even "I logged out" doesn't end the session server-side. Every comparable
product (GitHub Sessions, Google device activity, Notion) pairs the activity
list with per-session revocation.

## Verified Foundations (what makes this cheap)

All confirmed against this branch and the live local stack (GoTrue v2.189.0,
auth-js 2.80.0):

1. Every login mint creates an `auth.sessions` row; the access token carries
   its id in the `session_id` claim. `refreshAuthSession` keeps the same
   session, so the id is stable for the session's whole life.
2. `auth.refresh_tokens.session_id` has `ON DELETE CASCADE` — deleting the
   session row kills the refresh chain atomically.
3. ERP, MES, and starter shell layouts already call
   `requireAuthSession(request, { verify: true })`, a GoTrue round-trip with a
   60-second positive-verdict Redis cache. GoTrue rejects a token whose
   session row is gone, verify fails → refresh fails (revoked) → bounced to
   login. **Enforcement needs zero new code.**
4. `serviceRole.auth.admin.signOut(jwt, scope)` exists with scopes
   `"local" | "others" | "global"` — official API for "revoke the session this
   token belongs to" and "revoke all my other sessions". Only revoking a
   *different* session by id has no official endpoint and needs one wrapped
   SQL statement.
5. ERP already has a Kysely accessor (`getDatabaseClient` in
   `apps/erp/app/services/database.server.ts`) for the raw-SQL piece; the
   generated types don't cover the `auth` schema, so those two queries use the
   `sql` template.

## Proposed Solution

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session store | Piggyback GoTrue `auth.sessions`; **no** app session table | **Settled by codebase**: the store, the cascade, and the enforcement gate all already exist. An app-side registry would duplicate all three |
| UI shape | Status shown per row **inside the existing activity card** (Current / Active / Ended badge), Sign out button on Active rows | **User decision** ("show the status also… instead of just the login happened"). Every live session is ≤ `SESSION_MAX_AGE` (7 d) old and history keeps 90 d, so each live session always has a login row |
| Logout revokes server-side | Yes — `destroyAuthSession` best-effort calls `admin.signOut(accessToken, "local")` before clearing cookies | **User decision.** Keeps the status column truthful and kills the refresh chain; official API, never-throws wrapper (a dead/invalid token just no-ops) |
| "Sign out all other devices" | Yes — `admin.signOut(currentAccessToken, "others")` | **User decision.** Official API, no SQL; the panic action |
| Revoked JWT residual (≤1 h) | **Accepted** — a revoked device's raw JWT still passes RLS/PostgREST until `GOTRUE_JWT_EXP` (3600 s) expiry; app navigation is blocked within ~60 s | **User accepted recommendation.** Matches Supabase's stateless-JWT semantics; a request-path denylist would add a Redis GET to every request in the system for that marginal window |
| Per-device revoke mechanism | One wrapped SQL statement: `DELETE FROM auth.sessions WHERE id = $1 AND user_id = $2` | No official admin endpoint takes a session id. The `user_id` constraint makes a forged id a no-op. Isolated in ONE function with a comment: it reaches into GoTrue's schema and is the single place to fix if a Supabase upgrade moves it |
| Active-status source | `SELECT id FROM auth.sessions WHERE user_id = $1` in the security loader, matched in JS against the ≤20 activity rows | Same wrapped module as the delete; trivial per-user cardinality |
| Current-session detection | Decode own access token's `session_id` (`getAuthSession(request)` in the loader) | No schema or cookie change |
| Current row affordance | No Sign out button on the Current row (use Logout); "Sign out all other devices" covers the rest | Revoking your own session from a page you are on is logout with extra steps and a confusing half-dead state |
| Multi-tenancy (heuristic 1) | `sessionId` column on the existing user-owned `userLogin` table; auth-schema queries scoped by `user_id` | Same user-owned model as the parent spec; sessions are per-user, not per-company |
| RLS (heuristic 3) | Unchanged — new column rides the existing owner-only SELECT; writes stay service-role | The revoke action authorizes via `requirePermissions` + the `user_id`-scoped SQL, not RLS |
| Service shape (heuristic 2) | ERP: `session.service.ts`-style helpers in the account module surface (`getActiveSessionIds`, `revokeSession`) taking the Kysely client; shared: `getSessionId(accessToken)` in `@carbon/auth` | Raw-SQL pieces are ERP-only (the UI lives there); logout revocation is shared and lives in `@carbon/auth` where `destroyAuthSession` is |
| Form pattern (heuristic 5) | Route-action intents (`revokeSession`, `revokeOtherSessions`) via `useFetcher` FormData, like the existing passkey actions in `security.tsx` | Match the file's established idiom; no ValidatedForm needed for id-only posts |
| Backward compatibility (heuristic 7) | Pre-feature `userLogin` rows have `sessionId = NULL` → no status badge, no button | Graceful; rows age out at 90 d |

## Data Model Changes

One migration (`pnpm db:migrate:new user-devices-session-id`), then
`pnpm run generate:types`:

```sql
-- GoTrue session linkage for revocation + live status
-- (spec: .ai/specs/2026-08-26-session-revocation.md).
-- Nullable: rows recorded before this feature have no session id.
ALTER TABLE "userLogin" ADD COLUMN "sessionId" TEXT;
```

No index: reads are the per-user activity page (≤20 rows, matched in JS), and
revocation looks up `auth.sessions` by its own PK.

## API / Service Changes

### `@carbon/auth`

- **`getSessionId(accessToken: string): string | null`** (in
  `login-history.server.ts`) — decode the JWT payload, return the
  `session_id` claim; null on anything malformed.
- **`recordLogin`** gains an `accessToken` param and stores
  `sessionId: getSessionId(accessToken)`. All six call sites already hold
  `authSession.accessToken`. (Implementation check: confirm the session id is
  unchanged across `completeMfaChallenge` — GoTrue upgrades the same session
  to AAL2 rather than minting a new one.)
- **`destroyAuthSession`** (`session.server.ts`): before clearing cookies,
  read the session (`getAuthSession(request)`) and best-effort
  `getCarbonServiceRole().auth.admin.signOut(accessToken, "local")`, swallow
  every error. Callers include logout routes in all four apps, expiry paths,
  and deactivation flows — revoking an already-dead session is a harmless
  no-op, so no call site needs auditing.

### ERP account module (`apps/erp/app/modules/account/account.service.ts`)

Both auth-schema touches live here, together, clearly marked:

```ts
// GoTrue's auth schema is not in the generated types and has no admin REST
// endpoint for these two operations — this is the ONE place that reaches into
// it, via the Kysely client and the sql template. If a Supabase upgrade moves
// auth.sessions, fix it here.
export async function getActiveSessionIds(db, userId: string): Promise<string[]>
// SELECT id FROM auth.sessions WHERE user_id = $userId

export async function revokeSession(db, userId: string, sessionId: string)
// DELETE FROM auth.sessions WHERE id = $sessionId AND user_id = $userId
// (refresh tokens cascade; returns affected count so the action can flash
// "already signed out" vs "signed out")
```

### Route: `x+/account+/security.tsx`

- **Loader** additionally: `getActiveSessionIds` (Kysely client) + current
  session id via `getSessionId((await getAuthSession(request)).accessToken)`.
  Each login row is annotated server-side with
  `status: "current" | "active" | "ended" | null` (null = pre-feature row).
- **Action** intents, `useFetcher`-posted like the passkey intents:
  - `revokeSession` (`sessionId`): re-derive the current session id and refuse
    to revoke it; otherwise `revokeSession(db, userId, sessionId)`, flash
    success.
  - `revokeOtherSessions`: `admin.signOut(currentAccessToken, "others")`,
    flash success.

## UI Changes

In the existing "Recent sign-in activity" card (`security.tsx`):

- **Header**: a "Sign out all other devices" secondary button (confirm modal,
  destructive style, like the passkey delete modal). Disabled when no row is
  `active`.
- **Per row**: a status badge replacing "just the login happened" —
  - `Current` (this device) — badge, no button
  - `Active` — green badge + "Sign out" button (confirm modal) with the row's
    device/location in the modal copy
  - `Ended` — muted badge (session expired or was signed out; the two are not
    distinguishable server-side and are not worth distinguishing)
  - `null` sessionId — no badge (legacy row)
- Revalidate after either action so badges flip to `Ended` immediately.
- All strings via Lingui.

No MES UI (same rationale as the parent spec); MES sessions appear and are
revocable from ERP, and MES logout gets server-side revocation for free via
the shared `destroyAuthSession`.

## Acceptance Criteria

- [ ] A new login writes `userLogin.sessionId` matching the token's
      `session_id` claim (all methods: magic link, OAuth, passkey, verify,
      bypass; ERP and MES)
- [ ] The activity card shows `Current` on this device's row, `Active` on a
      second browser's row, and `Ended` after that session is revoked
- [ ] "Sign out" on an Active row deletes exactly that `auth.sessions` row;
      the second browser's next navigation lands on the login page within
      ~60 s (verify-cache window) and its refresh token no longer works
- [ ] Revoking a forged/foreign `sessionId` via the action affects zero rows
      (the `user_id` constraint) and reveals nothing
- [ ] The Current row shows no Sign out button, and the action refuses its
      own session id even if posted directly
- [ ] "Sign out all other devices" ends every other session (rows flip to
      `Ended`) while the current session survives
- [ ] Logging out (ERP and MES) deletes the GoTrue session server-side — the
      row shows `Ended` when viewed from another still-active session
- [ ] `destroyAuthSession` still succeeds when GoTrue is unreachable or the
      token is already invalid (revocation is best-effort, verified by test)
- [ ] Pre-feature rows (null `sessionId`) render with no badge and no button
- [ ] Scoped typecheck (`@carbon/auth`, `erp`, `mes`) and unit tests pass;
      new tests cover `getSessionId` decode, the never-throws logout revoke,
      and the action's own-session refusal

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Revoked device's raw JWT valid ≤1 h against PostgREST/RLS | Med | **Accepted by user** (matches Supabase semantics); app-shell access dies within ~60 s; document in the modal copy as "signed out within a minute" |
| `auth.sessions` schema drift on Supabase upgrade | Low | Both raw-SQL touches isolated in one commented module; everything else uses official `admin.signOut` |
| Ghost sessions predating logout-revoke show `Active` | Low | "Sign out all other devices" clears them; they also age out with the 7-day cookie life making their rows `Ended`-equivalent in practice |
| `admin.signOut(jwt, "others")` also bumps GoTrue's session `updated_at` semantics differently than SQL delete | Low | Both paths converge on deleted sessions; acceptance test covers the observable behavior, not the mechanism |
| Revoking a session mid-pending-MFA challenge | Low | The parked tokens fail at `/mfa` completion; user restarts login — correct outcome |

## Open Questions

> All resolved with the user before this spec was written (2026-08-26).

- [x] Show session status on activity rows vs a separate sessions card? —
      **Answer (user):** integrate status into the activity rows (Current /
      Active / Ended), not a separate card.
- [x] Should plain logout revoke the GoTrue session server-side? — **Answer
      (user):** yes.
- [x] Include "Sign out all other devices"? — **Answer (user):** yes.
- [x] Handle the ≤1 h revoked-JWT residual with a request-path denylist, or
      accept it? — **Answer (user, on recommendation):** accept; documented as
      a risk. Revisit only if a compliance requirement demands instant token
      death.

## Changelog

- 2026-08-26: Created after codebase verification (GoTrue v2.189 session
  store, refresh-token cascade, existing `verify: true` enforcement,
  `admin.signOut` scopes in auth-js 2.80.0), with all open questions resolved
  by the user beforehand.
- 2026-08-26: **UI reshaped on user request** from a login-event list with
  status badges to a Google-style "Your devices — where you're signed in"
  card: one row per LIVE `auth.sessions` entry (joined to `userLogin` for
  device/location; GoTrue's own `user_agent`/`host(ip)` as fallback for
  pre-feature sessions), "Last active" from `refreshed_at`, current device
  first, "This device" badge, Sign out on the rest. Login history is no longer
  displayed — the table remains the recording backbone.
  `getActiveSessionIds` → `getActiveSessions`.
- 2026-08-26: Implemented on branch `jackson` (migration
  `20260826134307_user-devices-session-id.sql`; `getSessionId` + `sessionId`
  capture in `recordLogin`; logout revocation in `destroyAuthSession`;
  `getActiveSessionIds`/`revokeSession` in the account module; status badges +
  Sign out / Sign out other devices on Account → Security). Typecheck ×4 and
  49 auth tests green; revoke SQL semantics (wrong-user no-op, malformed-id
  no-cast-error, refresh-token cascade) verified against the live DB in a
  rolled-back transaction.
