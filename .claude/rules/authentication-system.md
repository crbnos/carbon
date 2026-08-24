---
paths:
  - "packages/auth/**"
  - "apps/erp/app/routes/_public+/**"
  - "apps/erp/app/routes/_oauth+/**"
  - "apps/erp/app/routes/api+/mcp+/**"
---

# Authentication System

Carbon auth is built on Supabase Auth with cookie sessions, Redis-cached claims, and
per-company role/permission gating enforced through Postgres RLS. The `@carbon/auth`
package is the single source of truth; ERP and MES consume it.

## Package: `@carbon/auth` (`packages/auth/src`)

Export subpaths (`package.json`): `.` (`index.ts`), `./auth.server`, `./session.server`,
`./company.server`, `./users.server`, `./passkey.server`, `./verification.server`,
`./middleware/flash.{server,client}`. User query helpers split across
`services/users.ts` (client-safe: `getClaims`, `getPermissionCacheKey`,
`getCompaniesForUser`, `makePermissionsFromClaims`) and `services/users.server.ts`
(server-only: `getUserClaims`, deactivate flows).

## Supabase client factories (`lib/supabase/client.ts`, `client.server.ts`)

- `getCarbon(accessToken?)` — anon-key client, optionally Bearer-authed as a user.
- `getCarbonServiceRole()` — service-role client, bypasses RLS (admin ops only).
- `getCarbonAPIKeyClient(apiKey)` — anon client that sends the `carbon-key` header so
  RLS resolves the company via the key.
- `getUserScopedClient(userId)` — mints a short-lived (5m) HS256 JWT with
  `SUPABASE_JWT_SECRET` and returns a user-scoped client (RLS enforced).
- All clients use `fetchWithRetry` (timeout + retry on 5xx/408/524).

## Login (`apps/erp/app/routes/_public+/login.tsx`)

Magic link is the primary flow. The action rate-limits by IP (Upstash via `@carbon/kv`,
`RATE_LIMIT` env default **5 / hour**), optionally verifies a Cloudflare Turnstile token
(Cloud edition), then:

- `DEV_BYPASS_EMAIL` match + active user → `signInWithBypassEmail` (local dev only).
- Existing active user → `sendMagicLink` (Supabase OTP email).
- Unknown user (non-Enterprise) → `sendVerificationCode`, redirect to `/verify` (email
  verification-code signup). Enterprise edition rejects unknown users.

Other methods on the login page: Google + Azure OAuth (`signInWithOAuth`, redirect to
`/callback`), and Passkey/WebAuthn (`@simplewebauthn`, `/api/passkey/authenticate/*`,
backed by `passkey.server.ts`). Availability gated by `isAuthProviderEnabled(...)`.
<!-- UNVERIFIED: there is no /signup route; the old cache doc's "/signup" + "Sign up for free" claims were stale (and contained a git merge-conflict artifact). Signup happens via the verification-code flow above. -->

Routes live under `_public+/` (`login`, `callback`, `logout`, `magic-link`, `verify`,
`invite.$code`, `refresh-session`). MES mirrors a subset under its own `_public+/`.

## Sessions (`session.server.ts`)

- `createCookieSessionStorage`, cookie name **`carbon`**, `httpOnly`, `sameSite: "lax"`
  (`"none"` in Test edition), `secure`/`domain` from `DOMAIN` in non-test. Payload stored
  under key `SESSION_KEY = "auth"`; `SESSION_MAX_AGE = 7 days`.
- `requireAuthSession` reads/validates; `getOrRefreshAuthSession` refreshes within
  `REFRESH_ACCESS_TOKEN_THRESHOLD` (10 min) of expiry via `refreshAccessToken`.
- `destroyAuthSession` clears auth + company-id cookies, redirects to login.
  `updateCompanySession` / `updateSessionConsole` switch active company / console mode.

## MFA / TOTP (`mfa.server.ts`)

Supabase TOTP MFA, gated explicitly in app code (server-side sign-in runs through the
service role, so GoTrue's automatic AAL enforcement never fires). Factors live in
Supabase's `auth.mfa_factors` — no app table.

- **Gate at login**: ERP/MES `callback.tsx` and `passkey.authenticate.verify.ts` check
  `userHasVerifiedTotpFactor(userId)` after the first factor succeeds; enrolled users get
  their tokens parked via `setPendingMfaSession` (session key `"mfa"`, 10-min TTL) and a
  redirect to `/mfa` — the full `carbon` cookie is only minted after the challenge.
- **Active re-check**: `requireAuthSession` bounces any session without
  `AuthSession.mfaVerified` whose user has a verified factor to `/mfa` (covers sessions
  minted before enrollment). The factor lookup is Redis-cached (`mfa:factors:${userId}`,
  1h TTL, invalidated on enroll/unenroll/admin reset) and `oncePerRead`-memoized; it
  fails OPEN on lookup errors. Dev-bypass sessions are minted with `mfaVerified: true`.
- **`/mfa` routes** exist in all four apps (ERP/MES/starter `_public+/mfa.tsx`, academy
  `_auth+/mfa.tsx`); the shared action logic is `completeMfaChallenge(request, code)` in
  `session.server.ts`. Academy/starter have no callback gate — the re-check bounces them.
- **Token rotation**: every `challengeAndVerify` rotates the refresh token — any caller
  MUST re-issue the cookie from the returned session (`/mfa` routes, `api+/mfa.verify`,
  `api+/mfa.unenroll` all do). `refreshAuthSession` preserves `mfaVerified` like `console`.
- **auth-js gotcha**: `supabase.auth.mfa.*` reads the client's INTERNAL session, not the
  `Authorization` header override — `mfa.server.ts` seeds a fresh anon client via
  `auth.setSession` with the cookie's tokens.
- **Enrollment**: Account → Security (`x+/account+/security.tsx`, which also owns
  passkeys) → `api+/mfa.enroll` / `mfa.verify` / `mfa.unenroll` (unenroll requires a
  current code as step-up). The enroll→scan→verify state machine, the 6-slot code
  input, and the invalid-code copy are shared with the enforcement gate via
  `~/components/TotpEnrollment` (`useTotpEnrollment`, `OtpInput`,
  `INVALID_CODE_MESSAGE`) — change them there, not per surface. The QR carries
  `issuer` = `Carbon (<company name>)` so a phone can tell two Carbon tenants
  apart (the account line is the user's email, set by GoTrue). `sanitizeIssuer`
  strips colons: `otpauth://totp/{issuer}:{account}` uses one as its delimiter
  and the Key-URI spec forbids it in either field. The issuer is baked into the
  QR at enrollment — changing it does not update existing entries. Admin recovery:
  `x+/users+/employees.reset-mfa.$employeeId.tsx` (`update: "users"`) calls
  `adminDeleteTotpFactors` — factors are global to the auth user, so it affects
  every company the user belongs to.
- **Org enforcement**: `companySettings.requireMfa` (migration
  `20260816103045`) toggled from Settings → System → Security
  (`x+/settings+/security.tsx`); `CONTROLLED_ENVIRONMENT=true`
  forces it on and cannot be overridden (NIST 800-171 3.5.3). Enforced as a
  BLOCKING SCREEN in the ERP/MES shell loaders (`MfaEnrollmentRequired`), never a
  redirect — a redirect would have to allowlist the `api+/mfa.*` routes used to
  escape it, and any gap there is a lockout or a hole. Mirrors the ITAR gate.
  Scoped to the ACTIVE company only: a user in a company that does not require
  MFA is not gated, and the shell re-runs on company switch. Console sessions are
  exempt (a shared kiosk cannot complete a personal enrollment); MES has no
  enrollment UI so its gate links to ERP.
- **Email**: `~/services/mfa-email.server.ts` owns both MFA emails
  (`MfaRequiredEmail` / `MfaEnabledEmail` in `@carbon/documents/email`).
  `sendMfaRequiredEmails` fires from the settings action on the **off → on
  transition only** (it re-reads `companySettings.requireMfa` first — the Switch
  re-submits on every flip), and batches active employees through
  `batchTrigger("send-email", …)` 25 at a time. It is additionally skipped when
  `CONTROLLED_ENVIRONMENT` — effective enforcement there is
  `CONTROLLED_ENVIRONMENT || requireMfa` and NOTHING ever writes the column, so
  it sits `false` while MFA is already mandatory; the column alone would read as
  a fresh transition and announce a requirement that predates the deployment.
  The Switch is `disabled` in that mode, but the action has no such guard, so
  this cannot live in the UI. `sendMfaEnabledEmail` fires from
  `api+/mfa.verify` — that route only ever verifies an ENROLLMENT (a login
  challenge goes through `completeMfaChallenge` on `/mfa`), so reaching it means
  a factor was just added. Both take a service-role client, and NEITHER goes
  through `trigger("notify", …)`: security mail must not be silenced by a
  `notificationPreference` opt-out or gated on the `EMAIL_NOTIFICATIONS` plan
  feature. Both swallow their own errors — enrollment and the setting flip must
  not fail because email did.
- **Admin visibility**: the `users_with_verified_mfa(company_id)` RPC
  (SECURITY DEFINER — `auth.mfa_factors` is unreachable from the SECURITY_INVOKER
  `employees` view) backs the Two-Factor column on employee accounts. It returns
  ids only, is scoped to the caller's companies, and returns nothing unless the
  company enforces MFA. **A migration that adds an RPC needs a PostgREST schema
  reload** or the function is invisible to the app.
- **Config**: local GoTrue MFA env in `packages/dev/docker/docker-compose.dev.yml`
  (`GOTRUE_MFA_TOTP_*`); `[auth.mfa]` in `config.toml` for hosted parity. API-key and
  OAuth/MCP token auth are machine paths and are not challenged.

## Permissions & RLS gating (`auth.server.ts` → `requirePermissions`)

`requirePermissions(request, { view?, create?, update?, delete?, role?, bypassRls? })` is
the gate used in every loader/action. Two paths:

1. **`carbon-key` header present** → API-key auth (see below).
2. **Otherwise** → `requireAuthSession`, then `getUserClaims(userId, companyId)`.
   - Claims are `{ role, permissions }`. Cached in **Redis** (`@carbon/kv`) at key
     `permissions:${userId}`; on miss, fetched via the `get_claims(uid, company)` RPC
     (`getCarbonServiceRole`) and cached. `makePermissionsFromClaims` shapes the result.
   - `getUserClaims` is additionally memoized **per read request** via
     `oncePerRead` (`@carbon/logger/middleware.server`), so the several loaders a
     page matches share one Redis GET. Read-gated on purpose: an action and its
     loader revalidation run in the same request, and memoizing there could let a
     gate pass on claims the action just revoked. The Supabase clients
     `requirePermissions` returns are memoized per request too (`oncePerRequest`),
     which needs no gate — a client is not database state.
   - Each required permission checks `permissions[name][action]` contains the active
     `companyId` (or `"0"` wildcard = all companies). `role` is matched directly.
   - On failure: if `role === null` destroy session → `/`; else flash "Access Denied"
     → authenticated root.
   - Returns `{ client, companyId, companyGroupId, email, userId, sessionUserId,
     consoleMode }`. `bypassRls: true` + employee role returns a service-role client;
     otherwise a Bearer-authed `getCarbon(accessToken)` client (RLS enforced).

Claims cache must be invalidated when permissions change — `users.server.ts` deactivate
flows call `redis.del(getPermissionCacheKey(userId))`.

## API key auth

`carbon-key: <key>` header. `requirePermissions` resolves it via service role
(`getCompanyIdFromAPIKey` → `apiKey` lookup by `keyHash`), then:

- Reject if `expiresAt` passed (401).
- Rate-limit via `checkApiKeyRateLimit` (`@carbon/database/ratelimit`, Postgres function
  `check_api_key_rate_limit`) using per-key `rateLimit` + `rateLimitWindow`
  (`"1m"|"1h"|"1d"`). 429 with `X-RateLimit-*` + `Retry-After` headers on exceed.
- Fire-and-forget `lastUsedAt` update.
- Scope check: `scopes` is JSONB `{ "<permission>_<action>": [companyIds] }`; required
  perms must be present and include the active company. `{}` is NOT full access here —
  an empty scope set fails the check. 403 on failure.
- Cloud edition: Starter-plan companies are blocked from API access (Business+ only),
  except `STRIPE_BYPASS_COMPANY_IDS`.
- Returns a `getCarbonAPIKeyClient(apiKey)` client (RLS resolves company via header).

Key hashing: `hashApiKey` = `createHash("sha256")` hex (same in Node ERP and Deno edge
functions). Raw key is shown once; only `keyHash` is stored.

## OAuth 2.0 server (MCP remote connector)

ERP exposes an OAuth 2.0 AS for use as a remote Claude/MCP connector. Routes under
`_oauth+/` (`authorize.tsx`, `token.tsx`, `register.ts`) plus discovery at
`[.]well-known.oauth-authorization-server.ts` and `[.]well-known.oauth-protected-resource.ts`.

- PKCE supported (`code_challenge` / `code_challenge_method` S256|plain on authorize,
  `code_verifier` on token).
- Dynamic client registration (`POST /oauth/register`) writes to the **`oauthClient`**
  table. <!-- UNVERIFIED: the old cache doc described a separate `oauthDynamicClient` table; it does not exist in current migrations. -->
- Tables: `oauthClient`, `oauthCode`, `oauthToken` (all PK `xid()`, scoped by
  `companyId`/`userId`). Columns are plain TEXT, but **access tokens, refresh tokens, and
  client secrets are SHA-256 hashed at the app layer before storage** via
  `hashOAuthSecret` (`auth.server.ts`). Lookups hash the incoming value and compare.
- MCP endpoint (`apps/erp/app/routes/api+/mcp+/_index.ts`): a `Bearer` token (when no
  `carbon-key`) is hashed and looked up in `oauthToken`; on miss it falls back to
  `carbon-key` API-key auth. `companyId`/`userId` always come from the token context.

## Schema (newest migrations; `packages/database/supabase/migrations`)

- `user` / `userPermission` (`id`, `permissions` JSONB) — seeded by the
  `create_public_user()` trigger (`on_auth_user_created` on `auth.users`).
- `userToCompany` — junction, PK `(userId, companyId)`, `role` enum
  `'employee' | 'supplier' | 'customer'`.
- `apiKey` — `keyHash` (unique), `keyPreview`, `name`, `companyId`, `createdBy`, `scopes`
  JSONB, `rateLimit` (default **60**), `rateLimitWindow` (default `'1m'`), `expiresAt`,
  `lastUsedAt`. The old plaintext `key` column was dropped.
- `apiKeyRateLimit` — UNLOGGED, PK `(apiKeyId, windowStart)`, `requestCount`.
- RLS/RPC functions: `get_claims`, `get_company_id_from_api_key`, `get_api_key_scopes`,
  `check_api_key_rate_limit`, `create_public_user`.

## Config (`packages/env/src/index.ts`, re-exported by `@carbon/auth`)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
`SESSION_SECRET`, `SESSION_KEY` (`"auth"`), `SESSION_MAX_AGE`,
`REFRESH_ACCESS_TOKEN_THRESHOLD`, `DOMAIN`, `RATE_LIMIT`, `CarbonEdition`,
`STRIPE_BYPASS_COMPANY_IDS`, Turnstile + OAuth-provider keys.

## Gotchas

- `getUserClaims` swallows Redis errors and falls back to the DB; a stale cache is the
  usual cause of "Access Denied" after a permission change — invalidate the cache key.
- `verifyAuthSession` (the `requireAuthSession(request, { verify: true })` path) caches
  only its **positive** verdict in Redis for 60s, keyed by a SHA-256 of the access
  token. Negatives are never cached — `getAuthAccountByAccessToken` also returns null
  on a transient network error. Bounds how long a deleted/deactivated account keeps
  being accepted; signing out never revoked a live access token anyway.
- ERP's `~/modules/users/users.server` re-exports `getUserClaims` from `@carbon/auth`;
  it used to carry a drifted copy that missed the cache TTL. Don't reintroduce one.
- Service-role clients bypass RLS — only use behind `bypassRls` + employee role.
- API key `scopes: {}` denies, not grants. Don't assume empty = full access.
- Edition matters: Enterprise rejects unknown-user login; Cloud gates API keys by plan
  and enforces Turnstile.
