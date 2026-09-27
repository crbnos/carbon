# @carbon/auth

Authentication, RBAC, session management, Supabase client factories, API key auth, and OAuth 2.0 server. The single auth source of truth for ERP and MES.

## Always

- Gate loaders/actions with `requirePermissions(request, { view?, create?, update?, delete? })` — never construct Supabase clients directly in routes.
- `requirePermissions` refuses customer and supplier portal sessions with a 403 (API keys are unaffected). `{}` used to admit them everywhere, and ~50 routes that then read with the service role were reachable by a portal account. Pass `allowPortalAccounts: true` ONLY on a route that acts on the user's own identity (onboarding, company switch, notification links, academy progress) — never on one that returns company data.
- Use the factory from `@carbon/auth/client.server`: `getCarbon(accessToken)` for user-scoped (RLS), `getCarbonServiceRole()` for privileged server ops only.
- Invalidate Redis permission cache (`redis.del(getPermissionCacheKey(userId))`) when changing user permissions — stale cache is the #1 cause of "Access Denied" bugs.
- API key `scopes: {}` **denies all** — never treat empty scopes as full access.
- Import env constants from `@carbon/auth` (re-exports `@carbon/env`) — not `process.env` directly.
- Keep `securityMiddleware` in every app's root `middleware`. It refuses cross-origin POST/PUT/PATCH/DELETE (CSRF), issues the CSP nonce and sets `nosniff`/`X-Frame-Options`/`Referrer-Policy`/HSTS on every response. A route that browsers must reach from another origin goes in `CROSS_ORIGIN_ENDPOINTS` (`lib/security.ts`) — webhooks and API-key callers do not need it (servers send neither `Sec-Fetch-Site` nor `Origin`).
- A loader that writes on GET calls `rejectCrossSiteNavigation(request)` first: the `SameSite=Lax` session cookie still rides a top-level link from another site.
- Re-issue the session cookie after any `supabase.auth.mfa.challengeAndVerify` — it rotates the refresh token, and the old one dies after GoTrue's reuse interval.

## Ask First

- Adding new auth providers or modifying the `isAuthProviderEnabled` gate.
- Changing session cookie config (`SESSION_MAX_AGE`, `sameSite`, `secure`, cookie name).
- Modifying the OAuth 2.0 server routes (`_oauth+/`) or MCP token resolution.

## Never

- Expose `getCarbonServiceRole()` client to code that hasn't verified permissions via `requirePermissions` with `bypassRls: true` + employee role.
- Return or log raw API keys — only `keyHash` (SHA-256) and `keyPreview` are stored; raw key is shown once at creation.
- Skip rate limiting on login or API key endpoints.

## Validation Commands

```bash
pnpm --filter @carbon/auth typecheck
pnpm --filter @carbon/auth test
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` (index) | Env re-exports, Supabase client factories, `getClaims`, cookie/http/result utils, validators |
| `./auth.server` | `requirePermissions`, API key auth (30s Redis-cached `getApiKeyRecord` + `bustApiKeyCache`, from `services/api-key.server.ts`), `hashApiKey`, `hashOAuthSecret` |
| `./mfa.server` | TOTP MFA: `enrollTotpFactor`, `verifyTotpChallenge`, `unenrollTotpFactor`, `userHasVerifiedTotpFactor` (Redis-cached), `adminDeleteTotpFactors` |
| `./session.server` | `createCookieSessionStorage`, `requireAuthSession` (incl. MFA re-check), `destroyAuthSession`, session refresh, pending-MFA session + `completeMfaChallenge` |
| `./company.server` | Company switching, `updateCompanySession` |
| `./users.server` | `getUserClaims`, deactivation flows, cache invalidation |
| `./passkey.server` | WebAuthn/passkey registration and authentication |
| `./console-pin.server` | MES console pin-in cookie (signed, bound to company + terminal session user): `setConsolePinIn`, `clearConsolePinIn`, `resolveConsolePinIn` (re-validated against the DB, memoized per read), `ConsolePinIn`; `requirePermissions` uses it to derive `userId` in console mode |
| `./self-signup.server` | Cloud self-signup blocklist: `isSelfSignupBlockedForEmail`, `SELF_SIGNUP_BLOCKED_MESSAGE` (free/disposable email domains; used by ERP login/verify/callback + MES callback) |
| `./middleware/flash.server` | Flash message middleware |
| `./middleware/security.server` | `securityMiddleware` (CSRF check + CSP nonce + baseline headers), `rejectCrossSiteNavigation`, `getNonce`, `setStrictContentSecurityPolicy` (report-only for now; `entry.server` calls it), `cspReportAction` + `CSP_REPORT_PATH`. The decisions are pure and tested in `lib/security.ts` |

SAML SSO lives in `@carbon/ee/sso.server` (Enterprise-gated), NOT here — auth
only carries `AuthSession.ssoProviderId` and its preservation across refresh.

## Cross-References

- `.claude/rules/authentication-system.md` — full auth architecture, login flows, claims caching
- `packages/env/` — env var definitions (`getEnv`, `SUPABASE_URL`, `SESSION_SECRET`, etc.)
- `packages/kv/` — Redis client for permission caching and login rate limiting
- `packages/database/` — `Database` type, `checkApiKeyRateLimit` RPC wrapper
