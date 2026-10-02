paths:
  - "apps/mes/app/routes/api+/v1+/**"
  - "apps/mes/app/services/commands.server.ts"
  - "apps/mes/app/services/commands.*.server.ts"
  - "apps/mes/app/services/screens.server.ts"
  - "apps/mes/app/services/api-result.server.ts"
  - "packages/mes-core/**"
  - "packages/auth/src/services/api-user.server.ts"

# MES Mobile API (`/api/v1`)

The JSON API the Carbon MES mobile app (`apps/mobile`) calls. Design record:
`.ai/specs/2026-09-30-mes-mobile-app.md`. Plan:
`.ai/plans/2026-10-02-mes-mobile-app.md`.

**It is not the ERP's public API.** That one (`apps/erp/app/routes/api+/v1+/`)
authenticates `crbn_` API keys and acts as the key's creator, so it cannot
attribute work to an individual operator. This one authenticates a Supabase
user token and, on a shared tablet, a signed operator token.

## The one rule that explains the rest

**Every write runs the SAME server code the web route runs.** RLS would let an
employee insert a `productionEvent` directly, but each web action does more
around that write: material backflush (`issue`), cost posting
(`post-production-event`), tracked-entity genealogy, returning picked leftovers
(`post-picking`), workflow moments, the floor gate in `start`, and the
picking-list policies. A client writing tables would skip all of it.

The main screens READ through the API for a different reason: the web loaders
read with the service role after a sign-in check, while RLS on `productionEvent`
requires `production_view` and on `pickingList` requires `inventory_view`. A
direct read would show an operator LESS than the web does.

Lookups (`location`, `workCenter`, `item`, `trackedEntity`, notes) stay direct
over PostgREST — those tables only require an employee of the company.

## Layout

| Path | What |
|---|---|
| `routes/api+/v1+/lib/route.server.ts` | `apiRoute` — the one wrapper every endpoint uses |
| `routes/api+/v1+/lib/idempotency.server.ts` | the duplicate-protection window |
| `routes/api+/v1+/lib/ratelimit.server.ts` | the auth bucket and the shared lockout |
| `routes/api+/v1+/lib/version.server.ts` | `API_VERSIONS`, `MIN_APP_VERSION` |
| `services/commands.server.ts` | barrel + the contract; `commands.*.server.ts` hold the commands |
| `services/screens.server.ts` | the extracted screen reads |
| `services/api-result.server.ts` | `CommandResult`, `FAILURE_STATUS` |
| `packages/mes-core` | the zod wire contract both sides import |
| `@carbon/auth/api-user.server` | `requireApiUser`, `ApiError`, `apiErrorResponse` |

A helper inside `api+/v1+/` MUST be named `*.server.ts` or `remix-flat-routes`
turns it into a route.

## `apiRoute`, in order

1. Method mismatch → 405. A POST-only route also exports
   `loader = methodNotAllowed()`, because React Router answers a GET to a route
   with no loader with its own 400 before `apiRoute` ever runs.
2. `x-carbon-app-version` older than `MIN_APP_VERSION` → 426. **Absent passes**,
   so curl and the dev tools work; only a version we can read and that is too
   old is refused.
3. Read the body ONCE (the idempotency fingerprint and the zod parse both need
   it, and a `Request` body is single-use), then `safeParse` → 400 with
   `fields` from `error.flatten().fieldErrors`.
4. `requireApiUser(request, permissions, deps)` unless `public: true`.
5. Authenticated POST → `withIdempotency`.
6. Errors: `ApiError` → its JSON; a thrown `Response` passes through; anything
   else is logged and becomes a 500 with a fixed message.

Every response carries `carbon-api: 1`. **No CORS headers anywhere** — this API
is for the native app, and `securityMiddleware` already passes a request with
neither `Origin` nor `Sec-Fetch-Site`, which is what a native client sends.

## `requireApiUser`

It is NOT a wrapper around `requirePermissions`: that throws `redirect`s (via
`requireAuthSession`), which a native client cannot follow. The permission loop
is otherwise a deliberate mirror of it, **including the exact-`companyId` match
with no `"0"` wildcard** (note `hasPermission` in `users.ts` differs; it is not
what gates routes).

Order: Bearer token → reject `crbn_` → `getAuthAccountByAccessToken` →
`x-carbon-company` → claims → employee role → the requested permissions → MFA →
operator token → per-user rate limit.

**Claims are cached per (user, COMPANY)** under this API's own key
(`mes-api:claims:…`, 60s). The shared `permissions:${userId}` key carries no
company, which is safe on web because the session's company only changes through
`updateCompanySession` (which deletes it) — but this API takes the company from a
per-request header, so a cached `role` from one company could be read for
another.

**What a cookie carried that a token does not.** `mfaVerified`, `console`,
`companyId` and `lastActiveAt` are session-only. The `DEV_BYPASS_EMAIL` account
is exempt from the MFA gate, gated on `IS_LOCAL_DEV`, because the web bypass
mints `mfaVerified: true` in the cookie while the token stays `aal1` — see the
lesson in `.ai/lessons.md`.

## Idempotency

Every authenticated POST needs `Idempotency-Key`, kept in Redis under
`(companyId, sessionUserId, key)` with a fingerprint of method + path + body.

| State | Answer |
|---|---|
| Unseen | `SET NX` an in-progress marker (5 min), run, store the outcome (24 h) |
| In progress | 409 `request_in_progress` |
| Done, same fingerprint | replay the stored response, `idempotent-replayed: true` |
| Done, different fingerprint | 422 `idempotency_key_reused` |
| Redis unavailable | 503 `retry_later`, **before** the command runs |

**A stored 5xx is replayed as a 5xx.** An automatic retry therefore never
re-runs a command whose first run may have partly applied; only the operator's
own Retry mints a new key. That is the lesson "Retrying a 5xx from a
non-idempotent Edge Function multiplies its side effects".

A `null` from `@carbon/kv` means EITHER "the key exists" OR "Redis is down" (it
fails soft), so the claim is read back to tell the two apart.

## Rate limits

- `@carbon/mes-api:auth`, `RATE_LIMIT * 6` per hour per IP. A separate bucket on
  purpose: web login, mfa and unlock share ONE `RATE_LIMIT`/hour bucket keyed on
  the bare IP, every tablet in a plant leaves through one NAT address, and a
  single sign-in spends three calls.
- The per-EMAIL `AccountLockout` is deliberately the SAME instance the web uses
  (5 attempts / 15 min). An attacker must not get a fresh allowance by moving
  from the web form to the app.
- `@carbon/mes-api:user`, 300/minute per user, inside `requireApiUser`.

## `CommandResult` and the status map

Commands and screen reads return
`{ ok: true, data } | { ok: false, failure }`. The web route maps a failure to
exactly the redirect, flash or `data()` it returned before the extraction; the
API maps `kind` through `FAILURE_STATUS`:

| kind | status | when |
|---|---|---|
| `validation` | 400 | |
| `forbidden` | 403 | |
| `not_found` | 404 | |
| `conflict` | 409 | the state moved under the operator |
| `blocked` | 409 | a sales/storage rule refused it; `details` has the rule names |
| `needs_acknowledgement` | 409 | the operator may proceed after confirming |
| `redirect` | 409 | a web loader's "you cannot be here" — the floor gates |
| `error` | 500 | |

A `redirect` failure is 409 and not 403: the operator's permissions are fine,
the work simply is not on the floor yet, and the message is the one they would
have read on the web.

## Extraction rules

- **Move a route body without edits**, one route per commit, then rerun that
  flow on web before the API uses it. A behaviour change here reaches every
  operator on web MES too.
- A command takes its scope as ARGUMENTS — `companyId`, the effective `userId`,
  `sessionUserId`, `locationId`. `userContext` is set by `userMiddleware`,
  registered only under `x+/_layout.tsx` and `display+/_layout.tsx`, so under
  `api+/` it is **null**.
- Deferred reads stay promises in the shared function. The web streams them
  through `Await`; only the API awaits them.
- Behaviour that must survive, per `.claude/rules/mes-job-operation-ui.md`: the
  floor gate runs before the timer reopens on the scan-start path; the
  scan-complete path stays ungated; ending a batch-tagged event skips
  `post-production-event`; auto-print never blocks the operation; scrap stays
  ONE `issue` `jobOperationScrap` invoke; the picking-list policies stay
  server-side.

## Two routes that are not what they look like

- **`x+/start.$operationId.tsx` and `x+/end.$operationId.tsx` are GET loaders
  that write** (the QR-traveller and kanban-scan flows), behind
  `rejectCrossSiteNavigation`. `start` carries the floor gate, the
  blocked-work-center check and the `operationStart` rules; `end` is
  deliberately ungated.
- **The in-app Start/Stop button posts to `x+/event.tsx`**, whose Start branch
  has none of those three and uses the user client where the scan path uses the
  service role. `POST /operations/:id/events` runs the button command, or the
  scan command when the body carries `viaScan: true`.

Clock in/out likewise has two web entry points: `api+/timecard.ts` is the one
the UI buttons use and it adds a `note` on clock-out.

## Versioning

`/api/v1` is **additive-only** (`BACKWARD_COMPATIBILITY.md`). The two most
recent store releases are supported, and a self-hosted server can be months
behind the app, so the checks run both ways: the app refuses a server whose
`carbon-api` header lists no version it speaks, and the server answers 426 to an
app below `MIN_APP_VERSION`. A newer app never enables a feature from its own
version number — only from what `/me` reports.

## No enumeration surface

There is deliberately no public document describing a Carbon. The whole public
surface is `POST /auth/code`, which is rate-limited and answers `{ ok: true }`
for an account that exists and one that does not. A fixed public path listing
the version, the deployment mode and the controlled-environment flag would let
one internet scan enumerate every Carbon install (spec Q15). `/me` is where the
Supabase url and anon key, the mode, the flags and the analytics key live, and
only a signed-in employee reaches it.
