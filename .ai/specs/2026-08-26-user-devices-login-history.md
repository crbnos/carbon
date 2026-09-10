# Login History + Your Devices (where you're signed in)

> Status: in-progress
> Author: Claude (design resolved with Naveen)
> Date: 2026-08-26

## TLDR

Add a persistent **`userLogin` history table** that records every completed
sign-in (method, app, IP, approximate geo location, user agent, timestamp) and a
user-facing **"Recent sign-in activity"** card on Account → Security showing it.
Rows are written by one shared fire-and-forget helper in `@carbon/auth` at every
login mint point across ERP and MES. **Scope was deliberately reduced by the
user from an earlier design**: the security emails (lockout alert, new-device
alert), device-recognition cookie, and remote sign-out are explicitly future
work — this spec is the durable activity record and its UI only.
Research: [.ai/research/login-notification-emails.md](../research/login-notification-emails.md).

## Problem Statement

Carbon's auth events are structured console logs only — nothing is persisted.
A user has no way to answer "when and from where was my account signed in?",
which is the first thing anyone checks when they suspect account compromise
(every major platform offers it: Google's Recent Activity, Microsoft's My
Sign-Ins, NetSuite's Login Audit Trail; NIST 800-53 AC-9 is the matching
control). It is also the foundation any future security alerting or remote
sign-out has to stand on.

## Proposed Solution

At every point where a login genuinely completes its first factor (the existing
`AccountLockout.reset()` sites plus the signup mint), call a shared helper in
`@carbon/auth` that inserts a `userLogin` row via the service role — capturing
method, app, `x-forwarded-for` IP, `x-vercel-ip-city`/`x-vercel-ip-country`
geo, and the user agent — prunes that user's rows older than 90 days, and emits
`logAuthEvent("login_success")`. The helper never throws: a login must not fail
because history did. Account → Security gains a read-only activity card backed
by owner-scoped RLS.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | History table + user-facing view only; **no emails, no device cookie** in this iteration | **User decision** ("for now let's just add user activity"). Emails/device recognition are additive later — see Future Work |
| Multi-tenancy (heuristic 1) | `userLogin` is **user-owned**: no `companyId`, PK on `id` alone, FK to `user` | Deliberate deviation with precedent: a login predates company selection; `passkeyCredential` (no companyId) and `notificationPreference` (PK on `id`) establish the pattern |
| RLS (heuristic 3) | SELECT owner-only (`auth.uid()::text = "userId"`); **no INSERT/UPDATE/DELETE policies** | Writes happen pre-session via service role; users must not be able to forge or erase their own sign-in audit trail |
| Service shape (heuristic 2) | Write helper `recordLogin` in `packages/auth` (service-role internally, never throws, fire-and-forget); read via `getLoginHistory(client, userId)` in the ERP `account` module returning `{ data, error }` | Login routes are pre-session (no user client exists yet); reads follow module conventions |
| Record timing | At **first-factor success**, before the TOTP gate | Matches where `AccountLockout.reset()` already sits; a TOTP-abandoned attempt still carried a valid first factor and belongs in the record |
| What is NOT a login | `unlock.tsx` (idle re-auth), `refresh-session.tsx` (token refresh), `/mfa` (second factor of an already-recorded login) | No rows from these routes |
| Geo source | `x-vercel-ip-city` / `x-vercel-ip-country` request headers, nullable | Existing precedent (invite flows read `x-vercel-ip-city`); no geo-IP dependency or lookup service. Absent headers (self-hosted) render "Unknown" |
| Retention | Prune-on-insert: delete the user's rows older than **90 days** | Self-cleaning, no new scheduled job; bounds PII (IP) storage |
| UA parsing | Tiny internal regex helper (browser family + OS) for display; raw UA stored | No UA-parser dependency exists in the repo; full fidelity not required |
| Method detection in `/callback` | Best-effort: decode the access-token JWT `amr` claim (`otp` → magic_link, `oauth` → provider via most-recent `user.identities` entry), fallback `'unknown'` | The callback serves magic-link AND both OAuth providers; other routes (passkey, verify, bypass) know their method statically |
| `logAuthEvent("login_success")` | Emitted inside the helper for every recorded login | Closes the gap where only the dev-bypass path logs it today, keeping structured logs and the table in step |
| Form pattern (heuristic 5) | N/A — read-only UI, no forms | — |
| Backward compatibility (heuristic 7) | N/A — new table, new read path, no frozen surface touched | — |

## Data Model Changes

One migration (`pnpm db:migrate:new user-devices-login-history`), then
`pnpm run generate:types`.

```sql
-- Per-user sign-in history. USER-OWNED (no companyId): a login happens before
-- a company is chosen. Precedent: "passkeyCredential" / "notificationPreference".
CREATE TABLE "userLogin" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL,
  "method" TEXT NOT NULL CHECK (
    "method" IN ('magic_link', 'oauth_google', 'oauth_azure', 'passkey',
                 'verification_code', 'bypass', 'sso', 'unknown')
  ),
  "app" TEXT NOT NULL CHECK ("app" IN ('erp', 'mes')),
  "ipAddress" TEXT,
  "city" TEXT,                       -- x-vercel-ip-city (null when absent)
  "country" TEXT,                    -- x-vercel-ip-country (null when absent)
  "userAgent" TEXT,
  "sessionId" TEXT,                  -- GoTrue session_id claim; join key to auth.sessions
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "userLogin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "userLogin_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "userLogin_userId_createdAt_idx" ON "userLogin" ("userId", "createdAt" DESC);

ALTER TABLE "userLogin" ENABLE ROW LEVEL SECURITY;

-- Owner can read their own history. NO insert/update/delete policies: rows are
-- written pre-session by the service role, and a user must not be able to forge
-- or erase their own sign-in audit trail.
CREATE POLICY "SELECT" ON "userLogin"
  FOR SELECT USING (auth.uid()::text = "userId");
```

No audit columns (`createdBy` etc.): the row *is* the audit record and has no
mutator; matches `notificationPreference`'s user-owned shape.

## API / Service Changes

### `packages/auth/src/services/login-history.server.ts` (new)

The one write path, imported by ERP and MES routes. Never throws — every I/O
failure is swallowed and logged (a login must not fail because history did;
same fail-open stance as the lockout's Redis paths).

```ts
// Reads IP/geo/UA from request headers, inserts the userLogin row (service
// role), prunes this user's rows older than 90 days, and emits
// logAuthEvent("login_success", { actor, ip, method, app }).
export async function recordLogin(params: {
  request: Request;
  userId: string;
  email: string;                // for the auth-event actor field only — not stored
  method: LoginMethod;          // 'magic_link' | 'oauth_google' | ... | 'unknown'
  app: "erp" | "mes";
}): Promise<void>;
```

Supporting pieces in the same file:

- Header capture: `x-forwarded-for` (first hop) for IP, `x-vercel-ip-city` /
  `x-vercel-ip-country` for geo, `user-agent` raw — all nullable.
- Method derivation for `/callback`: decode the access-token JWT payload's
  `amr` claim; `otp` → `magic_link`, `oauth` → pick `oauth_google`/`oauth_azure`
  from the most recently used `user.identities` entry; anything unresolvable →
  `'unknown'`.
- `parseUserAgent(ua)` — tiny regex helper returning `{ browser, os }` for
  display (exported for the UI); raw UA is what's stored.

### Call-site wiring (the integration diff)

Fire-and-forget — no cookie or header threading; each site adds one awaited
try/caught call (or `void recordLogin(...)`).

| Route | Change |
|---|---|
| ERP `_public+/callback.tsx` | After `AccountLockout.reset()` (~L101), before the TOTP gate — method via `amr` derivation |
| MES `_public+/callback.tsx` | Same, at its reset site (~L89) |
| ERP + MES `api+/passkey.authenticate.verify.ts` | After reset — `method: 'passkey'` |
| ERP `_public+/login.tsx` (dev bypass) | After reset — `method: 'bypass'` |
| ERP `_public+/verify.tsx` (signup) | After mint — `method: 'verification_code'` |

`unlock.tsx`, `refresh-session.tsx`, and `mfa.tsx` are untouched.

### ERP account module

`apps/erp/app/modules/account/account.service.ts`:

```ts
export async function getLoginHistory(
  client: SupabaseClient<Database>,
  userId: string,
  limit = 20
) {
  return client
    .from("userLogin")
    .select("*")
    .eq("userId", userId)
    .order("createdAt", { ascending: false })
    .limit(limit);
}
```

RLS makes the `userId` filter belt-and-braces; the Bearer-authed client can only
see its own rows regardless.

## UI Changes

**Account → Security (`apps/erp/app/routes/x+/account+/security.tsx`)** — one
new Card below Passkeys: "Recent sign-in activity" ("Sign-ins to your account
across Carbon apps over the last 90 days"). Loader adds `getLoginHistory`.
Table (simple `@carbon/react` table primitives, not DataTable) with columns:

- **When** — `formatDate` with time, newest first
- **Method** — labeled (`Magic link`, `Google`, `Microsoft`, `Passkey`,
  `Email verification`, `Dev bypass`, `Unknown`)
- **Device** — parsed browser + OS; falls back to a truncated raw UA
- **Location** — `city, country` or "Unknown"; IP shown beneath in muted text
- **App** — ERP / MES

Empty state: "No sign-ins recorded yet. Activity appears here after your next
sign-in." All strings via Lingui (`useLingui`/`<Trans>`), then
`pnpm lingui:extract` + `/translate`.

No MES UI: MES logins produce rows (`app: 'mes'`) and are reviewed in ERP,
matching the MFA pattern (MES links to ERP for enrollment).

## Acceptance Criteria

- [ ] Magic-link login inserts a `userLogin` row with `method: 'magic_link'`,
      the caller's IP, city/country from the Vercel headers, and the raw user
      agent
- [ ] Google and Azure OAuth logins record `oauth_google` / `oauth_azure`;
      passkey records `passkey`; signup via `verify.tsx` records
      `verification_code`; dev bypass records `bypass`
- [ ] An MFA-enrolled user's row is written at first-factor success — it exists
      even if the TOTP challenge is abandoned
- [ ] `unlock`, `refresh-session`, and `/mfa` produce no rows
- [ ] MES login inserts a row with `app: 'mes'` visible in the ERP card
- [ ] Account → Security shows the activity card: newest first, method label,
      parsed browser/OS, "city, country" (or "Unknown" when headers absent),
      IP, app
- [ ] User A cannot read user B's rows (RLS verified via a user-scoped client);
      a user-authed client cannot INSERT, UPDATE, or DELETE any `userLogin` row
- [ ] A login row insert prunes that user's rows older than 90 days
- [ ] With the database insert failing (e.g. service role misconfigured), the
      login still completes — helper swallows the error (verified by test)
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp
      --filter=mes` and `pnpm run test` pass; new unit tests cover header
      capture, `amr` method derivation, the 90-day prune, and the never-throws
      contract

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Geo headers (`x-vercel-ip-*`) absent when self-hosted | Low | Columns nullable; UI renders "Unknown" |
| Helper adds latency to login (1 insert + occasional prune) | Low | Single-row insert; can be `void`-dispatched if measured slow |
| IP storage is PII | Med | 90-day prune bounds it; `user` FK cascade removes history on account deletion; SELECT restricted to owner |
| `amr`-based method detection mislabels edge cases | Low | Falls back to `'unknown'`; label is cosmetic, never gates logic |
| Two tabs racing the same login double-insert | Low | Two identical history rows are harmless |

## Future Work (explicitly out of scope now)

Designed in the earlier iteration of this spec and in the research file; all
additive on top of this table:

1. **New-device sign-in email** — signed `carbon-device` cookie + a `deviceId`
   column on `userLogin`; alert when `(userId, deviceId)` is unseen.
2. **Account-lockout alert email** — at lockout engagement, throttled 1/hour.
3. **Remote sign-out** — ~~record the GoTrue `session_id` claim per row;
   revoke via the service role~~ **IMPLEMENTED** — see
   [2026-08-26-session-revocation.md](2026-08-26-session-revocation.md)
   (no per-request check needed: the existing `verify: true` shell gate
   already enforces revocation within ~60 s).
4. **Admin-facing login audit view** — an admin RLS policy or RPC over the same
   table.
5. **Company toggle for security emails** — additive `companySettings` boolean
   if a customer asks.

## Open Questions

> All resolved before this spec was written.

- [x] Persist login history in a table (vs cookie-only device recognition)? —
      **Answer (user):** yes — table, with the user-facing activity view in
      account settings.
- [x] Include the security emails now? — **Answer (user):** no — "for now let's
      just add user activity" with geo, IP, and meta info; emails moved to
      Future Work.
- [x] Company-level toggle? — **Answer (user):** skip; nothing to toggle in
      this scope anyway.
- [x] What meta info per row? — **Answer (user + precedent):** IP, geo
      (city/country from Vercel headers), user agent, method, app, timestamp.
- [x] Retention? — **Autonomous:** 90-day prune-on-insert; no new scheduled
      job; bounds PII.
- [x] Record before or after the TOTP gate? — **Autonomous (carried from the
      accepted earlier design):** before — first-factor success is the login
      fact being recorded.

## Changelog

- 2026-08-26: Created as "Login Security Emails + Sign-in History" with emails
  + device recognition, all open questions resolved beforehand.
- 2026-08-26: **Scope reduced by user** to sign-in activity history only (table
  + account-settings view with geo/IP/meta). Emails, device cookie, and remote
  sign-out moved to Future Work.
- 2026-08-26: IP handling hardened post-implementation: `normalizeIp` /
  `isPrivateIp` in `@carbon/utils` (strip IPv4-mapped IPv6, `x-real-ip`
  fallback, "Local network" display for private addresses). MaxMind GeoLite
  for self-hosted geo was evaluated and **declined by user** — Vercel headers
  remain the only geo source; self-hosted renders "Unknown location".
- 2026-08-26: The user-facing card was later reshaped into "Your devices"
  (live sessions only; see
  [2026-08-26-session-revocation.md](2026-08-26-session-revocation.md)) —
  `userLogin` recording, retention, and RLS are unchanged and now serve as the
  join source for device detail.
- 2026-08-26: Implemented on branch `jackson` (migration
  `20260910000000_user-devices-login-history.sql`, `@carbon/auth/login-history.server`,
  `parseUserAgent` in `@carbon/utils`, six call sites, `getLoginHistory` +
  activity card on Account → Security). Typecheck + unit tests green; RLS
  verified against the local DB in a rolled-back transaction.
