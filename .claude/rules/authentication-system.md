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

## Permissions & RLS gating (`auth.server.ts` → `requirePermissions`)

`requirePermissions(request, { view?, create?, update?, delete?, role?, bypassRls? })` is
the gate used in every loader/action. Two paths:

1. **`carbon-key` header present** → API-key auth (see below).
2. **Otherwise** → `requireAuthSession`, then `getUserClaims(userId, companyId)`.
   - Claims are `{ role, permissions }`. Cached in **Redis** (`@carbon/kv`) at key
     `permissions:${userId}`; on miss, fetched via the `get_claims(uid, company)` RPC
     (`getCarbonServiceRole`) and cached. `makePermissionsFromClaims` shapes the result.
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
- Service-role clients bypass RLS — only use behind `bypassRls` + employee role.
- API key `scopes: {}` denies, not grants. Don't assume empty = full access.
- Edition matters: Enterprise rejects unknown-user login; Cloud gates API keys by plan
  and enforces Turnstile.
