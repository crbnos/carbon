# MES Mobile — a native iOS and Android app for the shop floor

> Status: draft
> Author: Claude (with Sid)
> Date: 2026-09-30
> Research: `.ai/research/mes-mobile-app.md`

## TLDR

Build a native MES app for operators on tablets and phones, in this monorepo at
`apps/mobile`, with Expo SDK 57, Expo Router, Uniwind and React Native
Reusables. The app never gets the service-role key and never calls a web route
action. Everything that changes data goes through a new **MES API**
(`apps/mes/app/routes/api+/v1+/`), which runs the *same* server code as today's
web MES routes, because the web actions and the API both call one extracted
module (`commands.server.ts`). The three main screens (operations list,
operation detail, picking) also load through the API, so operators see exactly
what web MES shows them. The app reads simple lookups, subscribes to live
changes and uploads photos straight to Supabase as the signed-in user.

One store build serves every Carbon: Cloud, BYOC clusters, staging and
air-gapped installs. The app has no server built in. A supervisor links it to a
Carbon by scanning a QR code that web Carbon shows (or typing the address).
Nothing about a server is published at a public path: before sign-in the app
knows only the address, and everything else arrives over the authenticated MES
API once the user has proved who they are. The app can hold several such
instances and switch between them.

v1 covers core execution: time, good/scrap/rework, material by scan, work
instructions and step records with photos, notes, quality issues, labels,
picking and clock in/out. It supports both personal sign-in (emailed 6-digit
code plus 2FA) and shared tablets, where operators pin in with their console
PIN. It is online-first with a short, ordered, de-duplicated outbox for Wi-Fi
drops.

## Problem Statement

Carbon's MES is a server-rendered web app (`apps/mes`, React Router v7). It
works in a tablet browser, but:

- **No native device features.** A browser can't keep the screen awake on a
  wall-mounted tablet, can't reach Zebra DataWedge scan intents, and loses the
  camera between pages. Vendors that ship native shop-floor apps (Tulip, Plex,
  SAP Service and Asset Manager) cite hardware access and one-time device
  registration as the reason (research, Pattern 1).
- **No store distribution.** Customers who manage devices with MDM want an app
  they can push from the App Store or Google Play, not a bookmark.
- **Nothing a native client can call.** Every MES write is a React Router route
  action behind a cookie session, and most run with the service-role key after a
  sign-in check only (`requirePermissions(request, {})` in `x+/complete.tsx`,
  `x+/start.$operationId.tsx`, `x+/operations.tsx` and 10 others). The ERP's
  public API accepts API keys only and acts as the key's creator, so it can't
  attribute work to individual operators.

## Scope

**In v1** (answer to Q1):

- Operations list and detail for the chosen location and work centers
- Start, pause and finish setup, labor and machine time; end an operation
- Report good, scrap and rework quantities
- Issue material by scan (untracked and tracked entities), and undo an issue
- Work instructions, and step records with photos
- Operation notes
- Raise a quality issue
- Print labels to the printers web MES already uses
- Picking lists: pick quantities, tracked picks, list status
- Clock in, clock out, end shift
- Shared-tablet mode with console PIN switching

**Stays on web MES for now:** inspections and inspection lots, batches,
maintenance dispatch, the 3D assembly view, drawings with markup, work-center
TV displays. **Never in this app:** ERP screens.

## Proposed Solution

### Architecture

```
 MES Mobile (Expo, iOS/Android)                apps/mes server (React Router)
 ┌────────────────────────────┐               ┌──────────────────────────────────┐
 │ Expo Router screens        │  commands +   │ api+/v1+/*  (NEW, Bearer JWT)     │
 │ TanStack Query cache       │  screen reads │   requireApiUser → idempotency →  │
 │ Outbox (expo-sqlite)       │──────────────▶│   zod (mes-core) → command/screen │
 │ supabase-js (user session) │               │ x+/* route actions (web, cookie)  │
 └──────┬──────┬──────┬───────┘               │   parse form → same command       │
        │      │      │                       │ services/commands.server.ts (NEW) │
  sign-in  lookups  live changes, photos      │ services/screens.server.ts  (NEW) │
        │      │      │                       └───────────────┬──────────────────┘
        ▼      ▼      ▼                                       │ invoke / write
 ┌──────────────────────────────────────────────────────────────▼──────────────┐
 │ Supabase: Auth · PostgREST (RLS) · Realtime · Storage · Edge functions      │
 │           (issue, post-production-event, post-picking) · Postgres triggers │
 └─────────────────────────────────────────────────────────────────────────────┘
```

| Path | Goes to | Signed in as | Used for |
|---|---|---|---|
| Sign-in | MES API `POST /auth/code`, then Supabase Auth `verifyOtp` | — | Requesting and entering the emailed code |
| Commands | MES API | Operator (Bearer JWT, plus operator token on shared tablets) | Every change of state |
| Screen reads | MES API `GET` endpoints | Same | Operations list, operation detail, picking, timecard |
| Lookups | Supabase PostgREST | Signed-in user | `location`, `workCenter`, `item`, `trackedEntity`, `jobOperationNote` (read) |
| Live changes | Supabase Realtime | Signed-in user | Refetch triggers |
| Photos | Supabase Storage | Signed-in user | Step-record photos |

**Why writes go through the API.** RLS would let an employee insert a
`productionEvent` row directly, but each web action does more around the write:
material backflush (`issue`), cost posting (`post-production-event`),
tracked-entity genealogy, returning picked leftovers (`post-picking`), workflow
moments (`raiseMoment`), the floor gate in `start` (checked before the timer
reopens, per `.claude/rules/mes-job-operation-ui.md`), and the picking-list
policies (`incompletePickingListPolicy`, enforced server-side per
`2026-07-24-mes-material-picking-behavior.md` D7). A client writing tables
would skip all of it. Calling edge functions from the device doesn't work
either: multi-step commands are orchestrated in route actions, and
`functions/lib/supabase.ts` `requirePermissions` rejects a token whose subject
is not the payload `userId`, which rules out shared tablets.

**Why the main screens read through the API.** The web loaders read with the
service-role key after a sign-in check (`x+/operations.tsx:132`,
`x+/operation.$operationId.tsx:41`). Direct reads would hit RLS rules that
require `production_view` (`productionEvent`,
`20260228000000_rls-refactor-3.sql:1005`) and `inventory_view` (`pickingList`,
`20260601143527_picking-lists.sql:470`), so operators without them would see
less than on web. Lookups keep going direct because their tables only require
an employee of the company.

### Shared-tablet mode

Web MES already has this as console mode: a terminal signed in as one user,
operators pinning in with a PIN, every action attributed to the pinned operator.
Since PR #1734 and `20260926141957_employee-pin.sql`, the pin-in is a signed
cookie bound to the company and the terminal's session user, re-validated on
every request (`@carbon/auth/console-pin.server`), and PINs are bcrypt hashes in
`employeePin`, checked with `verifyEmployeePin` (`@carbon/ee/console.server`).
Console mode is a commercial feature: it is on only when
`isConsoleModeEnabledForCompany` says so (the `consoleEnabled` flag plus the
`PERMISSIONS` entitlement).

The app mirrors this with two signed tokens instead of cookies:

1. **Terminal token.** "Use this tablet as a shared terminal" (More screen) calls
   `POST /console/terminal`. It requires `settings_update` for the signed-in
   user and `isConsoleModeEnabledForCompany`, like `x+/console.toggle.tsx`.
   The server returns a terminal token signed with `SESSION_SECRET`, bound to
   `(companyId, sessionUserId)`. Leaving shared-terminal mode needs no
   permission; the app discards both tokens.
2. **Operator token.** An operator picks their name and enters their PIN:
   `POST /console/pin-in` with the terminal token. The server applies the same
   PIN lockout and terminal rate limit as `x+/console.pin-in.tsx` (moved into a
   shared helper), calls `verifyEmployeePin(getDatabaseClient(), …)`, and returns
   an operator token signed with `SESSION_SECRET`, holding the
   `StoredConsolePinIn` shape (`userId`, `companyId`, `sessionUserId`,
   `pinnedAt`). It expires after 1 hour idle, or the idle-lock window in a
   controlled environment, the same rule as `consolePinMaxAgeMs`.
3. Every API response to a console call returns a refreshed operator token in
   `X-Carbon-Operator` (the web refreshes `pinnedAt` on each shell navigation).
   `requireApiUser` re-validates each call like `resolveConsolePinIn`: the
   signature, the binding, the idle window, console mode still enabled, and the
   operator still an active employee of the company.
4. Commands run as the operator (`createdBy`, labor attribution). Reads and
   subscriptions keep running as the terminal user, as on web today.

Tokens live in memory only (the operator token) or SecureStore (the terminal
token), never in the query cache.

### Instance linking

Carbon is not one server. Carbon Cloud alone is several deployments
(`carbon`/`mes` and `carbon-us`/`mes-us` on Vercel); every BYOC customer runs
their own cluster with its own domain and its own Supabase, derived from the
environment's `domain` and `scheme` (`byoc` `internal/environment/deploy.go`,
`DeployConfig`); a customer can run staging beside production on one cluster;
and some installs are air-gapped or controlled (licence `mode`,
`ControlledEnvironment`). Each web MES server knows which one it is from its
own ENV. The store app cannot: there is one build on the App Store and Google
Play, identical for every customer, with no per-deployment ENV. So the app is
**told** which Carbon to use, on the device, and it can be told more than once.

**Instances are first-class.** An instance is a record the app keeps per linked
Carbon server. Before sign-in it holds only the MES address and the scheme it
was reached over; after sign-in it also holds what `GET /me` returned (name,
Supabase URL and anon key, `mode`, `controlledEnvironment`, analytics key), in
SecureStore. Every other piece of app state hangs off one instance: the
Supabase session, the chosen company, location and work centers, the query
cache and the outbox rows, all keyed by `(instanceId, companyId)`. The app
holds a list of instances and switches between them from the More screen;
switching swaps all of that state at once, so staging data can never appear
under production. No instance is the default.

**The minimum handshake.** The only thing the app needs before a user signs in
is the MES server address, and the QR code carries it. There is no public
document describing the server: a fixed public path would let one internet
scan enumerate every Carbon install with its version and whether it is a
controlled environment (PR review, Q15). The public surface is one
rate-limited `POST` that takes an email and answers `ok`, which is what the
web login form already exposes today.

1. `POST {server}/api/v1/auth/code { email }` — the same gates as web login;
   the body is always `{ ok: true }`, whether or not the account exists. The
   response carries one header, `carbon-api: 1`, listing the API versions the
   server speaks. `404` means the server predates the mobile API ("This Carbon
   server needs an update"); `426` means the app is too old.
2. `POST /api/v1/auth/verify { email, code }` — the server checks the code with
   Supabase and returns the session tokens. Precedent: the server already
   verifies magic-link tokens itself (`auth.server.ts` `verifyOtp`).
3. `POST /api/v1/auth/mfa { code }` — when the user has a TOTP factor, the
   server runs the challenge. Precedent: web MES verifies TOTP server-side
   (`session.server.ts` `verifyTotpChallenge`).
4. `GET /api/v1/me`, authenticated — only now does the app receive the Supabase
   URL and anon key (for realtime, photo uploads, direct lookups and token
   refresh), `mode`, `controlledEnvironment`, the analytics key, and the
   instance name, alongside companies and locations. `mode` and
   `controlledEnvironment` come from the same ENV the web apps read
   (`CONTROLLED_ENVIRONMENT`; a new `CARBON_DEPLOYMENT_MODE` for `connected` /
   `airgapped`, default `connected`).

The Supabase URL and anon key were never secret (they ship in web MES's HTML,
`root.tsx`), but they now reach only a signed-in employee, and nothing at a
known path says what a server is.

**Linking.**

1. **The app stores the address.** From the QR code or typed by hand. It is
   validated as a URL and nothing is fetched until the user requests a code.
2. **Web Carbon shows a QR code.** ERP Settings and the MES More screen get a
   "Connect mobile app" page that renders `carbon-mes://link?server=<MES_URL>`
   as a QR code. Any signed-in employee can open it: the server's public
   address is not a secret. The `carbon-mes` scheme is registered to the app at
   build time, so the tablet's own camera app opens Carbon MES with the address
   filled in, and the in-app scanner (`expo-camera`) reads the same code.
3. **Typing is the fallback.** The Connect screen also accepts an address. A
   bare domain (`carbon.acme.com`) is resolved with the BYOC convention, `mes.`
   under the domain (`byoc` `docs/domains.md`); a full URL is used as given.
   The app tries `https` first, then `http`, because a bare single-node install
   has no certificate (`deploy.go` `Scheme`). Over `http` the sign-in screen
   shows an "insecure connection" warning, and the server hostname is shown on
   every sign-in screen so a malicious QR code cannot quietly point the app at
   a look-alike server.
4. **Carbon Cloud is a button, not a default.** The Connect screen offers
   "Carbon Cloud", which fills in Cloud's address. Cloud users can still scan
   the QR from their own web MES, which is the right choice when Cloud has more
   than one region.
5. **Sign-in runs the handshake above.** A `404` from `auth/code`, or a
   `carbon-api` header listing nothing the app speaks, is shown as "This
   Carbon server needs an update"; the instance stays linked but cannot be
   signed into. The `/me` response is validated with zod (`@carbon/mes-core`)
   before it is saved onto the instance.

**What the flags do.** `mode: "airgapped"` or `controlledEnvironment: true`
turns off every outbound call the app would otherwise make: analytics, the
store update check, image CDNs. Before sign-in the app makes no outbound call
at all, so the flags are always known before anything could leave the device.
Analytics run only when `/me` carries `analytics.posthogKey`; self-hosted
installs leave it null. A controlled
environment also applies the web's idle lock: after `SESSION_IDLE_LOCK_MS` of
inactivity the app shows a lock screen and requires re-authentication, as
web MES does (`SessionLockOverlay`, `_public+/unlock.tsx`).

**Rejected.**

- *A build (flavor) per deployment.* Expo app variants need a distinct bundle
  id each, so each one is a separate store app. Carbon is open source and
  self-hostable: we do not know who runs it, and air-gapped installs never
  tell us, so we cannot build for them; and Apple rejects catalogues of
  near-identical apps. Flavors stay for `development` / `preview` /
  `production` only. A customer who wants a branded app can build one from the
  repo with their own store accounts: supported, not distributed by Carbon.
- *A central directory of servers kept by Carbon.* Air-gapped installs cannot
  register, and it discloses who uses Carbon.
- *Universal links.* The domains an app may claim are fixed at build time, so
  they cannot cover self-hosted domains.
- *Defaulting to Carbon Cloud.* A self-hosted operator would send their email
  to a server where their account does not exist.

### Sign-in and session

1. **Instance.** Sign-in runs against the instance chosen above. Until `/me`
   has answered, the app talks only to `{server}/api/v1`; the supabase-js
   client is created afterwards from the `supabaseUrl` and `supabaseAnonKey`
   in that response.
2. **Request a code.** `POST /api/v1/auth/code { email }` runs the same gates as
   the MES login action (`_public+/login.tsx`): the IP rate limit, the per-account
   lockout (`AccountLockout`), the user-exists check, and the SSO-required
   refusal (`isSsoRequiredForEmail`, returned as `sso_required`). It then sends
   the email the web sends (`signInWithOtp` server-side, as `sendMagicLink`
   does). Web bot protection (BotID/Turnstile) is browser-only, so the app
   relies on the rate limit and lockout, which are the NIST controls.
   Requesting the code straight from Supabase Auth would skip all four gates.
   The response is `{ ok: true }` for every email, so the endpoint reveals
   nothing about which accounts exist; the `sso_required` refusal is the one
   exception, and it matches the web login's behaviour.
   **Store-review accounts (Q11).** Apple and Google reviewers can't receive an
   emailed code. For an email in `APP_REVIEW_EMAILS` (read through
   `@carbon/env`, set only on Carbon Cloud, empty everywhere else so the path
   is off), `/auth/code` sends nothing and returns `{ ok: true, method:
   "password" }`; every other email gets `{ ok: true }` with no `method`.
   The app then shows a password field and calls `POST /api/v1/auth/password`,
   which refuses any email outside the allow-list, applies the same rate limit
   and lockout, signs in with the account's password server-side and returns
   the session. The review account is an ordinary employee of a demo company on
   Carbon Cloud with no other access. Normal users never see a password field.
3. **Enter the code.** The magic-link email template gains the 6-digit code
   (`{{ .Token }}`) next to the existing link, so web users see the same email
   with a code added. The app posts it to `POST /api/v1/auth/verify { email,
   code }`; the server calls `verifyOtp({ email, token, type: "email" })` with
   the anon client and returns `{ accessToken, refreshToken, expiresAt,
   mfaRequired }`. The same lockout counts a wrong code as a failed attempt.
4. **2FA.** When `mfaRequired` is true (`userHasVerifiedTotpFactor(userId)`),
   the app posts the TOTP code to `POST /api/v1/auth/mfa { code }` with the
   `aal1` token; the server runs the challenge and returns `aal2` tokens.
   `requireApiUser` rejects an `aal1` token from such a user with
   `mfa_required`, mirroring the web's `mfaVerified` bounce. Enrolment stays in
   ERP ("MES defers first login to ERP").
5. **Context.** `GET /api/v1/me` returns the instance details above plus
   companies, locations, the default location (`employeeJob.locationId`), work
   centers, whether console mode is available, and the permission flags the UI
   uses to disable controls. The chosen company, location and work centers are
   stored per device.
6. **Session storage.** The tokens and the instance details are stored in
   `expo-secure-store` behind an encryption wrapper (SecureStore caps values at
   2 KB), per Supabase's Expo guide, and the supabase-js client is created from
   them. Token refresh pauses in the background.

SSO sign-in is v1.1. Until then, users of SSO-required domains get a clear
refusal, and those companies use shared-tablet mode with a non-SSO terminal
account or wait for v1.1.

### Offline outbox

Online-first. The outbox covers brief Wi-Fi drops; no vendor surveyed offers
offline production writes (research, Pattern 2).

- Each command is a row in `expo-sqlite`: id, companyId, sessionUserId,
  operator userId, operationId, method, path, body, idempotency key, createdAt,
  attempts, state, last error. Rows are keyed by company; switching company
  pauses the other company's rows.
- Rows for the same operation send in order (SAP's sequential queue for
  quantity confirmations is the precedent). Rows with no operation (clock-in)
  share one lane.
- States: `queued → sending → done`. A network failure, a timeout, `503
  retry_later` or `409 request_in_progress` means **waiting to retry** with the
  same key (backoff 2 s → 60 s), which is safe because the server either never
  ran the command or de-duplicates it. Any other 4xx, or a 5xx the server
  stored, means **needs attention**: the operation's lane stops, the operator
  sees what failed and chooses Retry (new key, after the screen refetches) or
  Discard.
- Rows older than 8 hours (one shift) are never sent automatically. The operator
  confirms or discards each one, so a forgotten "start labor" can't post hours
  later.
- An expired operator token returns `401 operator_expired`. The row moves to
  needs attention until the operator pins in again.
- Signing out is blocked while rows are queued, with a screen listing them.
- A banner shows "Offline · 3 actions waiting". Cached screens show when they
  were last updated.

### Duplicate protection (server)

Every `POST` carries `Idempotency-Key`. The API keeps it in Redis (`@carbon/kv`,
already an ioredis client MES depends on) under
`(companyId, sessionUserId, key)`, together with a fingerprint of method, path
and body:

- Unseen key: `SET NX` an in-progress marker (5-minute expiry), run the command,
  then store the status and body for 24 hours.
- Key in progress: `409 request_in_progress`.
- Completed key: replay the stored response, **including a stored 5xx**. An
  automatic retry therefore never re-runs a command whose first run may have
  partly applied (lesson: "Retrying a 5xx from a non-idempotent Edge Function
  multiplies its side effects"). A retry after a 5xx needs a new key, which only
  the operator's Retry creates.
- Same key, different fingerprint: `422 idempotency_key_reused`.
- Redis unavailable: `503 retry_later`, returned before the command runs.

### Device features

| Need | v1 | Later |
|---|---|---|
| Handheld scanners (Zebra, Honeywell) | Keyboard mode: a focused hidden input catches the scan plus Enter, as web MES does | Own Expo module for DataWedge intents (Zebra's React Native library is archived) |
| Camera scanning | `expo-camera` barcode scanning | VisionCamera + ML Kit if speed matters |
| Photos | `expo-image-picker`, saved as JPEG on the device, uploaded to `{companyId}/job/{operationId}/{stepId}/{nanoid}/{filename}` (the `parseJobFilePath` contract), with a sanitised filename | — |
| Labels | `POST /print` → `trigger("print-job")` → Inngest → ProxyBox, as `x+/print.tsx` does | Bluetooth Zebra printers |
| Screen stays on | `expo-keep-awake` on operation screens | Android kiosk lock (needs the customer's MDM) |

### Distribution and versioning

- One public App Store listing and one Google Play listing under Carbon's
  developer accounts, named "Carbon MES". Bundle and package id
  `ms.carbon.mes` (reverse DNS of Carbon's domain; changeable until the first
  store submission). URL scheme `carbon-mes`.
- EAS Build profiles `development`, `preview` (TestFlight, Play internal
  testing) and `production`. EAS Update channels `preview` and `production`,
  runtime version from a fingerprint of the native code.
- `/api/v1` changes are additive. A breaking change needs `/api/v2`, and v1
  stays until the oldest supported app release stops using it. The two most
  recent store releases are supported. Every request carries
  `X-Carbon-App-Version`, and the server answers `426` to anything older than
  its minimum, from the first `auth/code` call onwards.
- **Versions are checked in both directions**, because a self-hosted server
  can be months behind the store app. Every API response carries
  `carbon-api: 1` (the versions the server speaks); a `404` from `auth/code`,
  or a header listing nothing the app speaks, is refused with "This Carbon
  server needs an update". A newer app never enables a feature from its own
  version number, only from what `/me` reports.
- Self-hosted installs use the same store build, linked through the QR code or
  a typed address. There is no default server.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| App type | Native (Expo), tablet-first, phones supported | Hardware access and device registration (Tulip, Plex precedent); CTO recommendation |
| Where it lives | `apps/mobile` in this monorepo | The API and the app change in one PR; types, validators, translations and tokens are shared without publishing (Q7) |
| React versions | Web stays on 18.3.1; the app uses React 19.2 | Expo forbids two React Native versions per monorepo and two React versions per app, not different React per app. The global pin becomes scoped (see Tooling) |
| Styling | Uniwind (Tailwind v4) | NativeWind stable supports Tailwind v3 only; Carbon web is Tailwind 4.3 |
| Components | React Native Reusables, copied in; Gluestack UI v5 as fallback | shadcn model like `@carbon/react`; we own the code, so the one-maintainer risk is contained |
| Write path | MES API in `apps/mes` running extracted commands | One code path for web and native, per-operator attribution (Q5) |
| Read path | API for operations, operation detail, picking, timecard; direct for lookups | Parity with the web loaders' service-role reads |
| Permissions | Same as each web route today: signed-in employee of the company; quality issue keeps `create: "quality"`; shared-terminal mode keeps `update: "settings"` | Parity (Q4); tightening changes who can use web MES too |
| Sign-in | Emailed code through the MES server, then 2FA; SSO in v1.1; password only for allow-listed store-review accounts | Keeps the rate limit, lockout and SSO-required gates (Q3); store reviewers can't receive codes (Q11) |
| Shared tablets | In v1, via signed terminal and operator tokens | The dominant device model at every surveyed vendor (Q2) |
| Offline | Online-first, ordered outbox, 8-hour stale limit, Redis de-duplication | Nobody offers offline production writes (Q6) |
| Licensing | Community edition; shared-tablet mode only where console mode is entitled | Same as web MES (Q8) |
| Distribution | Public store listings; no default server; the instance is linked on the device by QR code or typed address | Tulip and Epicor partner-app pattern; one build for Cloud, BYOC, staging and air-gapped installs (Q9, revised after PR review, Q12) |
| Instance model | Instances are first-class: a list on the device, all state keyed by `(instanceId, companyId)`, switchable | One customer runs several Carbons (production, staging), and a tablet may need more than one (Q12) |
| Handshake | The app knows only the server address before sign-in; code request, code verify and TOTP all go through the MES API; Supabase URL, anon key, mode and flags arrive in the authenticated `/me` | Nothing at a public path describes a server, so installs cannot be enumerated (Q15). Replaces the earlier `/api/v1/config` and the `.well-known` document |
| Per-deployment builds | Rejected; flavors only for development / preview / production | We do not know who runs Carbon; each flavor is a separate store app (Q12) |
| Transport | `https` first, then `http` with a visible warning; hostname always shown | Bare single-node installs have no certificate (`byoc` `deploy.go` `Scheme`) |
| Translations | Reuse the `mes` Lingui catalog | One set of strings for translators (Q10) |
| Analytics and errors | PostHog (`posthog-react-native`) only when `/me` carries a key; off for air-gapped and controlled installs, and always off before sign-in | No new vendor; self-hosted and ITAR installs must not phone home |
| 1 · Multi-tenancy | No new tables. Every API call takes `X-Carbon-Company`, checked against the user's claims; every query scopes `companyId`; every persisted client cache and outbox row is keyed by `(instanceId, companyId)`, and hydration is guarded against a mid-flight instance or company switch | Lesson "Client-side entity caches must be company-keyed"; a company id can be the same on production and a staging copy restored from its backup |
| 2 · Service shape | `@carbon/mes-core` queries take `client` first and return `{ data, error }`; `commands.server.ts` and `screens.server.ts` take `client` / `db` arguments and never build a DB client in a `*.service.ts` | `conventions-services.md`, `no-db-client-in-service` |
| 3 · RLS coverage | No new tables; direct lookups rely on existing employee-of-company policies | — |
| 4 · Permission scoping | Each endpoint mirrors its web route's `requirePermissions` argument | Parity (Q4) |
| 5 · Form pattern | Web routes keep `ValidatedForm` + `zfd` schemas; the API validates JSON with the plain zod schemas in `@carbon/mes-core`, which the web schemas wrap | One set of rules for both |
| 6 · Module layout | MES stays flat; two new `.server` modules; `packages/mes-core` gets its own `AGENTS.md` | `module-conventions.md`, `keep-sources-in-sync` |
| 7 · Backward compatibility | Web route paths unchanged; validators re-exported from `~/services/models` with `@deprecated`; edge function names and payloads unchanged; `/api/v1` is new and additive-only | `BACKWARD_COMPATIBILITY.md` (route paths and validators are STABLE) |

## Data Model Changes

N/A: no tables, columns or migrations. Idempotency lives in Redis, tokens are
signed rather than stored, and the realtime publication is unchanged.

Non-schema configuration changes:

- `packages/database/supabase/templates/magic-link.html` adds `{{ .Token }}`.
  The same change is applied to each hosted Supabase project's email template
  and the self-hosted Docker setups that ship the template
  (`packages/dev/docker/docker-compose.dev.yml`,
  `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml`).
- Supabase Auth's redirect allow-list is unchanged: code sign-in has no
  redirect.

## API / Service Changes

### `packages/mes-core` (new, plain TypeScript)

Imports only `zod`, `@carbon/database` types and `@supabase/supabase-js` types.
No React, DOM or Node APIs.

- `src/models.ts` — JSON zod schemas for every command body, moved from
  `apps/mes/app/services/models.ts` (467 lines, `zfd`-based). The web file keeps
  its exports, wrapping these schemas with `zfd` where it needs form parsing.
- `src/queries.ts` — lookup reads used by the app: `(client, args) => { data,
  error }`, each scoped by `companyId`.
- `src/contract.ts` — request and response types for every endpoint, the error
  shape, and header names. Both the server routes and the app import them.

### `apps/mes/app/services/commands.server.ts` and `screens.server.ts` (new)

The body of each route action in the table below moves into a command function,
and each listed loader body into a screen function. The route becomes: parse the
form, call the command, redirect or return data as today. The API endpoint
becomes: `requireApiUser`, idempotency, parse JSON, call the same command,
return JSON. Behaviour that must survive the move, per
`mes-job-operation-ui.md`: the floor gate runs before the timer reopens in
`start`; `end` stays ungated; ending a batch-tagged event skips
`post-production-event`; auto-print after `complete` never blocks the
operation; scrap stays one `issue` `jobOperationScrap` invoke.

### `@carbon/auth` (new server functions)

- `requireApiUser(request, permissions?)` → `{ companyId, userId, sessionUserId,
  consoleMode, claims }`, or throws a JSON error `Response` (never a redirect):
  1. Read `Authorization: Bearer <token>`. Reject `crbn_…` API keys (those
     belong to the ERP API).
  2. Verify the token with Supabase Auth (`auth.getUser(token)`).
  3. Read `X-Carbon-Company`; load claims with `getUserClaims(userId,
     companyId)` (Redis-cached, as on web). Require the employee role. Apply
     `permissions` exactly like `requirePermissions`.
  4. If the user has a verified TOTP factor and the token is not `aal2`: `401
     mfa_required`.
  5. If `X-Carbon-Operator` is present: verify the operator token and terminal
     binding and re-validate as in [Shared-tablet mode](#shared-tablet-mode).
     `userId` becomes the operator.
  6. Apply a per-user rate limit (`Ratelimit` from `@carbon/kv`).
- `signTerminalToken` / `verifyTerminalToken`, `signOperatorToken` /
  `verifyOperatorToken`, next to `console-pin.server.ts` and sharing its
  `StoredConsolePinIn` shape and re-validation.
- The PIN lockout and terminal rate limit move from `x+/console.pin-in.tsx`
  into a shared helper that the web route and the API both call.

Commands use the service-role client after `requireApiUser`, exactly as the web
routes do after `requirePermissions`.

### MES API — `apps/mes/app/routes/api+/v1+/`

Every request sends `Authorization`, `X-Carbon-Company`, `X-Carbon-App-Version`,
and, when relevant, `X-Carbon-Location`, `X-Carbon-Operator` and
`Idempotency-Key` (every `POST`). No CORS headers: the API is for the native
app, not browsers. Errors are `{ error: { code, message, fields? } }`.

**Meta and auth**

| Endpoint | Auth | Does |
|---|---|---|
| `GET /x/connect-mobile` (web MES) and ERP Settings → Connect mobile app | Signed-in employee | Renders the `carbon-mes://link?server=…` QR code |
| `POST /auth/code` | Public, rate-limited | The MES login gates, then sends the code email; always `{ ok: true }` (plus `method: "password"` for review accounts); `carbon-api` header |
| `POST /auth/verify` | Public, rate-limited, lockout | Checks the code server-side; returns tokens and `mfaRequired` |
| `POST /auth/mfa` | `aal1` user | Runs the TOTP challenge server-side; returns `aal2` tokens |
| `POST /auth/password` | Public, rate-limited | Store-review accounts only (`APP_REVIEW_EMAILS`); returns tokens |
| `GET /me` | User | Instance details (Supabase URL and anon key, mode, controlled flag, analytics key, name), companies, locations, default location, work centers, console availability, permission flags |
| `POST /console/terminal` | User with `update: "settings"` | Terminal token (console mode must be enabled) |
| `POST /console/pin-in` | Terminal token | PIN check with lockout, operator token |
| `POST /console/pin-out` | Operator | Ends the pin-in (the app also drops the token) |

**Screen reads**

| Endpoint | Web loader today |
|---|---|
| `GET /operations?workCenterIds=…` | `x+/operations.tsx` |
| `GET /operations/:id` | `x+/operation.$operationId.tsx` |
| `GET /operations/:id/rework-targets` | `x+/rework-targets.$operationId.tsx` |
| `GET /picking` | `x+/picking._index.tsx` |
| `GET /picking/:listId` | `x+/picking.$pickingListId.tsx` |
| `GET /timecard` | `x+/timecard.tsx` |

**Commands**

| Operator action | Endpoint | Web route today |
|---|---|---|
| Start setup, labor or machine time | `POST /operations/:id/events` | `x+/start.$operationId.tsx` |
| Pause or stop an event | `POST /events/:id/end` | `x+/event.tsx` |
| End the operation | `POST /operations/:id/end` | `x+/end.$operationId.tsx` |
| Report good parts | `POST /operations/:id/quantities` | `x+/complete.tsx` |
| Report scrap | `POST /operations/:id/scrap` | `x+/scrap.tsx` |
| Report rework | `POST /operations/:id/rework` | `x+/rework.tsx` |
| Finish the operation | `POST /operations/:id/finish` | `x+/finish.tsx` |
| Issue material | `POST /operations/:id/materials/issue` | `x+/issue.tsx` |
| Issue a tracked entity | `POST /operations/:id/materials/issue-tracked` | `x+/issue-tracked-entity.tsx` |
| Undo an issue | `POST /operations/:id/materials/unconsume` | `x+/unconsume.tsx` |
| Record a step | `POST /operations/:id/step-records` | `x+/record.tsx` |
| Delete a step record | `POST /step-records/:id/delete` | `x+/record.$id.delete.tsx` |
| Add a note | `POST /operations/:id/notes` | Web inserts from the browser today; the API makes shared-tablet attribution correct |
| Raise a quality issue | `POST /quality-issues` | `x+/quality-issue.new.tsx` (`create: "quality"`) |
| Print a label | `POST /print` | `x+/print.tsx` |
| Pick a quantity | `POST /picking/:listId/lines/:lineId/quantity` | `x+/picking.$pickingListId.line.quantity.tsx` |
| Pick a tracked entity | `POST /picking/:listId/lines/:lineId/tracked` | `x+/picking.$pickingListId.tracked.$lineId.tsx` |
| Change picking-list status | `POST /picking/:listId/status` | `x+/picking.$pickingListId.status.tsx` |
| Clock in / clock out | `POST /timecard/clock-in`, `POST /timecard/clock-out` | `x+/timecard.tsx` |
| End shift | `POST /timecard/end-shift` | `x+/end-shift.tsx` |

| Status | Meaning | App behaviour |
|---|---|---|
| 400 | Validation failed (`fields`) | Show field errors |
| 401 `token_expired` | Session expired | Refresh once, retry |
| 401 `mfa_required` | 2FA needed | Open the 2FA screen |
| 401 `operator_expired` | Operator token expired | Ask the operator to pin in again |
| 403 | Not an employee, or missing permission | "Ask your supervisor for access"; controls disabled |
| 403 `sso_required` | SSO-required domain | Explain SSO sign-in is coming in an update |
| 409 `request_in_progress` | Duplicate while the first is running | Retry with the same key |
| 409 (other) | State changed, e.g. operation already Done | Refetch and say what changed |
| 422 `idempotency_key_reused` | Client bug | Needs attention |
| 426 `update_required` | App older than `minAppVersion` | Update screen |
| (client-side) `server_too_old` | `404` from `auth/code`, or no shared version in `carbon-api` | "This Carbon server needs an update"; the instance can be linked but not signed into |
| 503 `retry_later` | Redis unavailable; nothing ran | Retry with the same key |

### Tooling

- **React pin.** Replace the workspace-wide `react`, `react-dom`,
  `@types/react` and `@types/react-dom` overrides in `pnpm-workspace.yaml` with
  scoped ones. Only two installed packages hard-depend on React
  (`@react-email/preview-server` → react-dom 19.0.0, `linguito` → React
  ^18.3.1); the first gets a scoped override to keep today's behaviour. Add a
  named catalog (`catalogs.mobile`) for React 19.2, React Native and Expo.
  Prove web is unchanged: `pnpm why react` for `erp` and `mes` shows only
  18.3.1.
- **Lingui.** Add `apps/mobile` sources to the `mes` catalog's extract
  globs (an Ask First change, approved in Q10). Load catalogs through Lingui's
  Metro transformer; add Intl polyfills only where Hermes lacks them.
- **Checks.** Add `apps/mobile` and `packages/mes-core` to the source roots
  in `packages/checks/src/sources/typescript.ts`, so `no-raw-rounding`,
  `no-inline-fraction-digits` and `no-db-client-in-service` scan them. The new
  API routes and `.server` modules are already covered.
- **Biome.** `apps/biome.jsonc` only includes `./**/app/**/*.ts*`; add
  `apps/mobile/src/**`.
- **Turbo.** The app defines `typecheck`, `lint` and `test`, and no `build`
  script (EAS builds it), so `pnpm run build` is unaffected.
- **Dates and numbers.** No JavaScript `Date` for parsing, formatting or
  arithmetic (`@internationalized/date`); quantities use the quantity kind
  (up to 5 decimals) through `@carbon/utils`.

## UI Changes

Design language: `.claude/skills/carbon-design` (`shop-floor-mes.md`). Carbon's
tokens, status colours and copy rules, with MES ergonomics: large touch targets
(44–48 pt, hero Start/Pause larger), no hover-reveal, no context menus, one
colour-coded primary action, a bottom action dock on phones and a right-hand
dock on tablets, bottom sheets for secondary actions, toasts that never move the
operator off the operation screen.

### Screens (Expo Router)

```
app/
  _layout.tsx                 providers: Query, Auth, Theme, i18n
  (setup)/connect.tsx         scan the QR, type an address, or "Carbon Cloud"
  (setup)/instances.tsx       linked instances; switch, add, remove
  (auth)/sign-in.tsx          email → "Send code" (server hostname shown)
  (auth)/verify.tsx           6-digit code
  (auth)/two-factor.tsx       TOTP code
  (app)/_layout.tsx           guard: session + company + location
  (app)/context.tsx           company, location, work centers
  (app)/(tabs)/_layout.tsx    Operations · Picking · Scan · Timecard · More
  (app)/(tabs)/operations/index.tsx
  (app)/(tabs)/operations/[id].tsx
  (app)/(tabs)/picking/index.tsx
  (app)/(tabs)/picking/[listId].tsx
  (app)/(tabs)/timecard.tsx
  (app)/(tabs)/more.tsx       switch instance, shared terminal, language, theme, outbox, sign out
  (app)/scan.tsx              camera scanner (modal)
  (app)/pin.tsx               operator picker + PIN pad (shared terminal)
```

- **Phone (portrait):** bottom tabs; the operation detail is a pushed screen
  with its action dock at the bottom (safe-area padding).
- **Tablet (landscape, usually mounted):** the operations list stays on the
  left (about 360 pt), the detail fills the rest, the dock sits on the right.
- **Operation detail tabs:** Details, Instructions, Materials, Notes. The same
  sections and order as `JobOperation.tsx`.
- **Cards** (operations, picking) show what operators scan for: item ID and
  description, big quantity ("12 of 40"), job ID, status icon plus text, due.
- **Shared terminal:** the header shows the pinned operator with "Switch
  operator"; idle expiry returns to the PIN screen.

### Design brief

- **Users and context:** operators standing at machines and picking carts,
  often gloved, on shared tablets; supervisors setting up terminals.
- **Archetype:** MES operator screen; exemplars
  `apps/mes/app/components/JobOperation/JobOperation.tsx`,
  `components/Controls.tsx`, `OperationsList.tsx`, `ShortPickModal.tsx`,
  `EndShift.tsx`.
- **Actions:** one dominant action per state (Start emerald, Pause red);
  report, scrap, issue and print in the dock; everything else in the More
  actions sheet. Confirmation modals: Cancel left, action right, both large,
  listing what will be affected.
- **States:** loading skeletons; empty only when truly empty ("No operations
  at Assembly 2"); offline banner with the outbox count; needs-attention rows;
  locked and no-permission controls disabled in place, never hidden;
  update-required screen.
- **Copy:** operator words over data-model words ("Instructions", not
  "Procedure"); plain questions ("How many were actually picked?"); every
  string through Lingui, including accessibility labels.
- **Reuse / extend / create:** reuse Carbon's status maps and icon vocabulary
  (shared from `@carbon/utils`), React Native Reusables for primitives (button,
  input, dialog, tabs, select, sheet via community library), `sonner-native`
  for toasts. Create a native action dock and hero buttons following
  `Controls.tsx`, since no React Native equivalent exists.

## Acceptance Criteria

Each is checked on an iPad and an Android tablet (including one Zebra Android
11+ device) and on one phone per platform.

- [ ] A supervisor opens "Connect mobile app" on a self-hosted web MES, scans
      the QR code with the app, and the app shows that server's name and
      hostname; the user requests a code, enters it, and lands on their default
      location's operations list; the same user on web MES sees the same
      operations for the same work centers. The same flow works by typing the
      bare domain, and by tapping "Carbon Cloud".
- [ ] Two instances (production and staging, same company id) are linked on
      one tablet; switching between them swaps the session, cached operations
      and outbox, and nothing from one appears under the other.
- [ ] A server without the mobile API (`404` on `auth/code`) is refused with
      "This Carbon server needs an update"; a server whose minimum app version
      is above the app's answers `426` and the app shows the update screen.
- [ ] Before sign-in, and with `controlledEnvironment: true` or `mode:
      "airgapped"` in `/me` afterwards, the app makes no request to any host
      other than the instance's own (verified with a proxy), and locks after
      the idle window.
- [ ] `GET /.well-known/carbon-mobile` and `GET /api/v1/config` do not exist;
      no unauthenticated endpoint returns the server version, the Supabase URL,
      the anon key, the deployment mode or the company name. `POST /auth/code`
      returns the same body for an existing and a non-existent email.
- [ ] Linking over `http` shows the insecure-connection warning on the sign-in
      screen; linking over `https` does not.
- [ ] An email in `APP_REVIEW_EMAILS` gets a password field and signs in with
      it; any other email gets `{ ok: true }` with no `method`, and `POST /auth/password`
      refuses it. With the variable unset, no email gets the password path.
- [ ] A user with a verified TOTP factor must enter a 2FA code before any API
      call succeeds; an `aal1` token gets `401 mfa_required`.
- [ ] Requesting a code for an SSO-required domain shows the SSO message and
      sends no email; going past the account lockout's 5 attempts
      (`DEFAULT_MAX_ATTEMPTS`) locks the account exactly as web login does.
- [ ] Start labor, pause, report 10 good and 2 scrap, then finish: the
      `productionEvent`, `productionQuantity` and item ledger rows are identical
      to doing the same on web MES, including backflushed materials and the cost
      posting.
- [ ] The floor gate that blocks a start on web blocks the same start in the
      app with the same message.
- [ ] Issue a tracked entity by scanning its barcode with a keyboard-wedge
      scanner and with the camera; both post the same `issue` call as web.
- [ ] Record a step with a photo: the file lands under
      `{companyId}/job/{operationId}/{stepId}/…` and opens on web MES.
- [ ] Print a label from the app: a `print-job` event fires with the same
      payload as web's Print button.
- [ ] Pick a quantity on a picking list with `incompletePickingListPolicy =
      error`: completing an incomplete list is refused with web's message.
- [ ] Clock in, clock out and end shift produce the same timecard rows as web.
- [ ] On a shared terminal (company entitled to console mode), two operators pin
      in one after the other; each one's events show that operator as
      `createdBy`. Five wrong PINs lock that operator, as `x+/console.pin-in.tsx`
      does (`maxAttempts: 5`). After 1
      hour idle the next command returns `operator_expired` and the app shows
      the PIN screen.
- [ ] A user without `settings_update` can't turn a device into a shared
      terminal; the control is disabled with an explanation.
- [ ] With Wi-Fi off, report 5 good parts twice, then reconnect: exactly two
      `productionQuantity` rows are created, in order. Killing the app while
      rows are queued and reopening it resends them.
- [ ] Replaying the same request with the same `Idempotency-Key` creates one
      row and returns the first response.
- [ ] A queued row older than 8 hours is not sent until the operator confirms it.
- [ ] Switching company pauses the other company's outbox rows and never shows
      the other company's cached data.
- [ ] All existing web MES routes keep their paths and behaviour
      (`pnpm test` and the MES route tests pass; a manual pass of start,
      complete, scrap, issue, finish, picking and print on web).
- [ ] `pnpm why react` for `erp` and `mes` shows only 18.3.1 after the pin
      change.
- [ ] `pnpm exec turbo run typecheck --filter=mes --filter=mobile
      --filter=@carbon/mes-core`, `pnpm exec biome check`, `pnpm test` and
      `pnpm run lingui:check` pass.

## Delivery Phases

| Phase | Weeks | Output | Done when |
|---|---|---|---|
| 0 · Scaffold | 1 | React pin scoped, `apps/mobile` and `packages/mes-core` created, tooling wired | CI green with an empty app; web unchanged |
| 1 · Spike | 1 | Server address, code sign-in, 2FA, operations list through `GET /operations` | The list matches web MES on an iPad and an Android tablet |
| 2 · MES API | 2–3 | `requireApiUser`, tokens, idempotency, `commands.server.ts`, `screens.server.ts`, every endpoint | Web routes call the extracted code; API tests pass |
| 3 · Screens | 4–6 | Every v1 screen, outbox, scanning, photos, print, shared terminal | A pilot operator runs a full job on a tablet |
| 4 · Pilot and ship | 1–2 | TestFlight and Play internal testing, one pilot customer, store listings | One full pilot shift without falling back to web |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| The extraction changes web MES behaviour | High | Move bodies without edits first, one route per commit; manual pass of every moved route on web before the API uses it |
| Scoping the React pin pulls React 19 into a web app | Med | Scoped override for `@react-email/preview-server`; `pnpm why react` check in the phase 0 PR |
| An automatic retry duplicates a command | High | Stored responses (including 5xx) replayed; retries only on "never ran" outcomes; Retry after a 5xx needs the operator |
| Shared-terminal tokens become a weaker path than the web cookie | High | Same secret, binding, idle window and per-request re-validation as `console-pin.server`; security review before merge |
| Operators lacking `production_view` get no live timer updates | Low | Same limit as web today; the operation screen also refetches on focus, after commands and every 30 s |
| React Native Reusables stalls (one maintainer) | Med | Components are copied in and owned; Gluestack UI v5 fallback |
| Uniwind breaking changes | Low | Pin versions; upgrade on purpose |
| Store review rejects the app | Med | Review-only password sign-in (Q11); reviewer notes explain the server address and the demo company |
| The review password path is abused | Med | Allow-list only, empty on every install but Carbon Cloud; same rate limit and lockout as code sign-in; the account belongs to a demo company only |
| A malicious QR code links the app to a look-alike server | Med | The hostname is shown on every sign-in screen; `https` preferred with a visible warning over `http`; nothing leaves the device until the user types their email, and no token exists until they enter the emailed code |
| Self-hosted servers stay behind the app for months | Med | Two-way version checks; features gated on the server's document, never the app's version; additive-only `/api/v1` |

## Out of Scope / Later

- SSO sign-in (v1.1), passkeys
- Inspections, batches, maintenance dispatch, 3D assembly view, drawings
- Zebra DataWedge intents, Bluetooth printers, Android kiosk lock
- Push notifications
- Full offline mode or a sync engine
- Tightening MES permissions beyond today's parity

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

Q1–Q10 were answered by Sid on 2026-09-30 by accepting the recommended answer
for each.

- [x] **Q1. Which operator workflows ship in v1?** — **Answer:** core execution:
      time, good/scrap/rework, material by scan, step records with photos,
      notes, quality issues, labels, picking, clock in/out. Inspections,
      batches, maintenance, 3D and drawings stay on web.
- [x] **Q2. Personal devices or shared tablets?** — **Answer:** tablet-first
      with phone support; both personal sign-in and shared-tablet PIN mode in
      v1.
- [x] **Q3. How do users sign in?** — **Answer:** emailed 6-digit code
      requested through the MES server (rate limit, lockout, SSO-required
      gate), then 2FA where the user has a factor. SSO in v1.1.
- [x] **Q4. What permissions do app actions require?** — **Answer:** the same
      as web MES today (signed-in employee of the company); tighten later.
- [x] **Q5. What does the app call for writes?** — **Answer:** a new MES API in
      `apps/mes` at `/api/v1` with Bearer tokens, internal but versioned; the
      two most recent app releases stay supported.
- [x] **Q6. Offline behaviour?** — **Answer:** online-first with an ordered
      outbox for short drops, an 8-hour stale limit and duplicate protection in
      Redis.
- [x] **Q7. Stack and repository?** — **Answer:** this monorepo (folder
      renamed to `apps/mobile` by Q13); Expo SDK 57, Expo Router, Uniwind,
      React Native Reusables, TanStack Query, supabase-js, PostHog; web stays
      on React 18.
- [x] **Q8. Licensing?** — **Answer:** Community edition, like web MES.
- [x] **Q9. Distribution?** — **Answer:** public App Store and Google Play
      listings, with the server chosen on the device by QR code or typed
      address. (Originally "default Carbon Cloud"; revised by Q12.)
- [x] **Q10. Translations?** — **Answer:** reuse the existing `mes` catalog.

Surfaced while writing the spec:

- [x] **Q11. How does App Store and Google Play review sign in?** Both stores
      require working reviewer access, and a reviewer can't receive an emailed
      code. — **Answer (Sid, 2026-09-30):** a review-only password. Emails in
      the `APP_REVIEW_EMAILS` allow-list (Carbon Cloud only) get a password
      field instead of a code; everyone else is unchanged.

Raised in PR review (#1766, Brad, 2026-09-29):

- [x] **Q12. The spec assumed a single instance of Carbon. How does the app
      link to any deployed instance?** Why it matters: Carbon Cloud is several
      deployments, BYOC customers run their own clusters, staging sits beside
      production, and some installs are air-gapped; one store build must reach
      all of them. — **Answer (Brad's comment; design agreed with Sid,
      2026-09-30):** instances are first-class in the app (a switchable list,
      all state keyed by instance), linked by a QR code that web Carbon shows
      or a typed address, with version checks in both directions and no
      default server. Per-deployment builds were rejected. See Instance
      linking. (The first revision described each server through a public
      `.well-known/carbon-mobile` document; Q15 removed it.)
- [x] **Q13. Folder name?** — **Answer (Brad):** `apps/mobile`, not
      `apps/mes-mobile`. The scope stays MES-only for v1; the store name
      "Carbon MES" is kept until the team decides otherwise.
- [x] **Q14. On a shared terminal, whose permissions apply: the terminal
      account's or the pinned operator's?** Surfaced while answering Q12. —
      **Answer:** parity with web, which checks claims for the session user
      (`auth.server.ts` `getUserClaims(userId, companyId)` before
      `getEffectiveUser`) and attributes the work to the operator; the "Console
      Operator" employee type exists for exactly that terminal account. Raised
      for Brad in the PR in case the team wants operator-level permissions,
      which would be a web change too.
- [x] **Q15. The public `.well-known/carbon-mobile` document exposed too much.
      What is the minimum a handshake needs?** (Brad, PR review, 2026-09-30.)
      Why it matters: a fixed public path listing version, mode and the
      controlled-environment flag lets one scan enumerate every Carbon
      install. — **Answer (Sid, 2026-10-01):** the app needs only the server
      address before sign-in. Code request, code verify and TOTP go through
      the MES API (all with server-side precedents), and the Supabase URL, anon
      key, mode, flags and name arrive in the authenticated `/me`. The public
      surface is one rate-limited `POST` that always answers `ok`. A signed
      pairing token in the QR code is noted as optional later hardening.

## Changelog

- 2026-09-30: Created. Q1–Q10 resolved (recommended answers accepted); Q11,
  surfaced while writing, resolved as a review-only password. Built on
  `main` at `ea9f4be1e5`, after PR #1734 and `20260926141957_employee-pin.sql`
  closed the four security gaps found while researching (permission checks in
  `post-picking` and five `issue` cases, the unsigned console cookie, readable
  plain-text PINs).
- 2026-09-30: PR review. Renamed to `apps/mobile` (Q13). Added Instance
  linking (Q12): first-class instances, QR linking from web Carbon, the
  `.well-known/carbon-mobile` document (replaces `/api/v1/config`), BYOC host
  derivation, `http` with a warning, two-way version checks, air-gapped and
  controlled flags, analytics off unless the server allows it, and the rejected
  per-deployment builds. Recorded Q14 (shared-terminal permissions, parity).
- 2026-10-01: PR review (Q15). Removed the public `.well-known/carbon-mobile`
  document. The handshake is now: address from the QR code, `auth/code`
  (always `ok`, `carbon-api` header), `auth/verify` and `auth/mfa` server-side,
  then the authenticated `/me` delivers the Supabase URL and anon key, mode,
  controlled flag, analytics key and name. Added the no-enumeration acceptance
  criterion.
