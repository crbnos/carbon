# @carbon/auth

Authentication, RBAC, session management, Supabase client factories, API key auth, and OAuth 2.0 server. The single auth source of truth for ERP and MES.

## Always

- Gate loaders/actions with `requirePermissions(request, { view?, create?, update?, delete? })` — never construct Supabase clients directly in routes.
- Use the factory from `@carbon/auth/client.server`: `getCarbon(accessToken)` for user-scoped (RLS), `getCarbonServiceRole()` for privileged server ops only.
- Invalidate Redis permission cache (`redis.del(getPermissionCacheKey(userId))`) when changing user permissions — stale cache is the #1 cause of "Access Denied" bugs.
- API key `scopes: {}` **denies all** — never treat empty scopes as full access.
- Import env constants from `@carbon/auth` (re-exports `@carbon/env`) — not `process.env` directly.

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
| `./auth.server` | `requirePermissions`, API key auth, `hashApiKey`, `hashOAuthSecret` |
| `./session.server` | `createCookieSessionStorage`, `requireAuthSession`, `destroyAuthSession`, session refresh |
| `./company.server` | Company switching, `updateCompanySession` |
| `./users.server` | `getUserClaims`, deactivation flows, cache invalidation |
| `./passkey.server` | WebAuthn/passkey registration and authentication |
| `./middleware/flash.server` | Flash message middleware |

## Cross-References

- `.claude/rules/authentication-system.md` — full auth architecture, login flows, claims caching
- `packages/env/` — env var definitions (`getEnv`, `SUPABASE_URL`, `SESSION_SECRET`, etc.)
- `packages/kv/` — Redis client for permission caching and login rate limiting
- `packages/database/` — `Database` type, `checkApiKeyRateLimit` RPC wrapper
