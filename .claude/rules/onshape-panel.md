paths:
  - "packages/ee/src/onshape/**"
  - "apps/erp/app/routes/onshape+/**"
  - "apps/erp/app/routes/api+/integrations.onshape*"
  - "apps/erp/app/components/ExternalSource.tsx"
  - "packages/jobs/src/inngest/functions/integrations/onshape-*"

# Onshape Panel (push-only element app)

The Carbon app embedded in Onshape's element right panel. Push-only: users
trigger everything from Onshape; Carbon never pulls automatically. Design spec:
`.ai/specs/2026-08-28-onshape-app.md`. User-facing setup and behaviour:
`docs/content/docs/integrations/cad.mdx`.

## Two integrations — `onshape` and `onshape-v2`

The panel is its own integration, `onshape-v2` ("Onshape V2",
`packages/ee/src/onshape/config-v2.tsx`). `onshape` and `onshape-government`
are the sync connections (released-asset webhook sync, `config.tsx`).
Separate OAuth grant, separate `companyIntegration` row, separate
`externalIntegrationMapping` namespace; a company can run the panel beside
either sync connection.

- The panel id is `ONSHAPE_V2_INTEGRATION_ID`
  (`packages/ee/src/onshape/lib/integration-id.ts`). Every panel read and write
  passes it explicitly: `getOnshapeClient(…, ONSHAPE_V2_INTEGRATION_ID)`;
  omitted, `getOnshapeClient` resolves the company's sync connection. A bare
  `"onshape"` literal in panel code is a bug.
- `ONSHAPE_INTEGRATION_IDS`, `OnshapeIntegrationId` and `isOnshapeIntegrationId`
  (`lib/connection.ts`) cover the two SYNC connections only. The
  one-active-connection rule (`getConflictingOnshapeIntegration`) is between
  those two and never involves the panel. `OnshapeOAuthIntegrationId` is all
  three grants.
- Only the `onshape-v2` link means "Onshape owns this item". A sync
  connection's `onshape` item row is BOM-import bookkeeping (the BoM Explorer,
  `components/OnshapeSync.tsx`, reads it); the item lock, the item card and
  Detach never read or delete it.
- Same Onshape OAuth app, same scopes (`OAuth2Read OAuth2Write`), two redirect
  URIs: `ONSHAPE_OAUTH_REDIRECT_URL` → `/api/integrations/onshape/oauth`,
  `ONSHAPE_V2_OAUTH_REDIRECT_URL` → `/api/integrations/onshape-v2/oauth`. Both
  must be registered on the Onshape app. Every grant shares one flow: install
  routes call `beginOnshapeAuthorization` (`@carbon/ee/onshape.server`),
  callbacks call `completeOnshapeAuthorization`
  (`apps/erp/app/modules/settings/onshape-oauth.server.ts`), and
  `getOnshapeOAuthConfig` picks the redirect URI per id; a missing client or
  redirect var answers `not-configured`. The OAuth `state` is the cookie-bound
  one from `@carbon/auth/oauth-state.server`. The callback renders
  `oauthPopupResponse`: it posts the outcome to the opener and closes the popup,
  or lands on the integrations page when there is no opener.
- Install opens a popup (`beginOAuthPopup`, `packages/ee/src/oauth-popup.ts`,
  opened inside the click, before the install fetch). The drawer's
  **Reconnect Onshape** action (Onshape and Onshape V2) POSTs to the same
  install route, which answers `{ redirectUrl }`; the page goes to the consent
  screen and the callback returns to the integrations page. Onshape Government
  re-authorizes by saving its client secret.
- Every Onshape connection has a health check (`onshapeHealthcheck`,
  `packages/ee/src/onshape/hooks.server.ts`): build the client (which refreshes
  an expired token) and read `/companies`. A revoked grant or dead refresh token
  reads unhealthy on the card. `getIntegrationHealth` caches a healthy answer
  for five hours.
- Migration `20260930224500_onshape-v2-integration.sql` seeds the `integration`
  row; `…501_onshape-v2-vault-secrets.sql` puts `onshape-v2` in `SECRET_KEYS`,
  so its tokens live in Supabase Vault.
- The V2 integration form holds the five push defaults (`config-v2.tsx`, "Push
  defaults" group). The unit dropdown's options are the company's units, loaded
  in `x+/settings+/integrations.$id.tsx` as `dynamicOptions`.

## Integration state — one owner per key

`companyIntegration.metadata` has several writers: the token refresh, the OAuth
callback, the settings save (form and API), the webhook's Onshape company id,
and the panel's property map. Each writes only its own keys through
`patchIntegrationState` (row lock, dot-path patches); the helpers are in
`packages/ee/src/onshape/lib/state.ts` (`patchOnshapeSettings`,
`patchOnshapeOAuthGrant`, `patchOnshapeRefreshedTokens`,
`patchOnshapeCompanyId`). The Fields save writes `propertyMap` with
`jsonb_set`. Never write the whole column from a copy read earlier: whichever
write lands last reverts the others.

## Onshape token refresh

`getOnshapeClient` refreshes when the token is within two minutes of expiry and
again on a 401. Onshape rotates refresh tokens, so a refresh runs under an
owner-bound lease from `@carbon/kv` (`acquireLease` / `withLease`: Lua acquire
that tells "held" from "Redis unavailable", renewal while the exchange runs,
compare-and-delete release). With Redis down the refresh runs without a lock.
The lease holder re-reads the stored pair and adopts a token another caller
already refreshed (`resolveOnshapeRefresh`, `lib/token-refresh.ts`). The token
request times out after 15 s.

## Auth — why the panel has its own credential

The `carbon` session cookie is `SameSite=Lax` and never reaches a cross-site
iframe. So:

- `onshape+/panel.tsx` loads with **no auth** and is the only route that may
  be framed by Onshape: its own `Content-Security-Policy: frame-ancestors
  https://onshape.com https://*.onshape.com` replaces the app's baseline
  `frame-ancestors` directive for that route.
- `onshape+/auth.tsx` is a same-origin popup. It takes identity from the cookie
  session alone (`requireAuthSession`), refuses non-employees (portal accounts
  included) and console sessions, applies the app shell's account gates
  (enforced MFA enrollment; ITAR attestation in a controlled environment), then
  mints an opaque `cps_<32 base64url>` token (Redis `panel-session:<token>`,
  `packages/ee/src/onshape/panel/session.server.ts`) and posts it to the
  opener. The panel keeps it in sessionStorage and sends
  `Authorization: Bearer`.
- A panel session holds **identity only** (`PanelSession`, `session-policy.ts`)
  — never a Supabase token. Each request builds its client from a short-lived
  token signed for the user (`getUserScopedClient`, as the MCP bearer path
  does). Copying the cookie session's refresh token would make the panel and
  the ERP tab rotate one chain, and GoTrue revokes the session family on reuse.
- Panel API routes call `requireOnshapePanelPermissions`
  (`@carbon/ee/onshape/panel-session.server`), not `requirePermissions`. Every
  request applies the cookie path's session policy (`panelSessionRefusal`: in
  a controlled environment the absolute cap and idle lock; everywhere, a TOTP
  factor enrolled after minting), requires the `employee` role, then runs the
  same claims check as `requirePermissions` and returns the same shape. The
  acting user is always the session user. Denials are 401 (token missing,
  expired, revoked, refused by policy) or 403 (role or permission) — never
  redirects. Activity is stamped only on an authorized request, with
  `SET … KEEPTTL XX` so a deleted session stays deleted. In a controlled
  environment the Redis TTL stops at the ERP session's absolute cap.
- Tokens never appear in URLs. postMessage targets `window.location.origin`.

## Identity — externalIntegrationMapping (integration `onshape-v2`)

| Entity | externalId |
|---|---|
| Part item | `documentId:elementId:partId[:configuration]` |
| Assembly item | `documentId:elementId:assembly[:configuration]` |
| Release revision item | `release:<releaseId>:<partNumber>` |
| Onshape-origin BOM line | entityType `methodMaterial`, `metadata.makeMethodId` names the owning method |
| Draft the panel made | entityType `makeMethod` (`DRAFT_MARKER_ENTITY_TYPE`), `externalId` = the Draft's id, `metadata.sourceMethodId` = the Active method it copied |

BOM pushes are a **diff, not a rebuild**: delete only lines whose mapping rows a
previous push wrote, insert fresh ones. A manual line for a part number Onshape
also lists is **taken over** (`pairManualLines` in `panel/plan.ts`, applied by
`claimManualMethodLine`): Onshape's quantity, order and child method, plus an
ownership row, with its operation and scrap kept, so a hand-built BOM does not
end up with each shared part twice. Manual lines for parts Onshape doesn't
list are left untouched. A line
already carrying the right component is updated in place, and one whose
push-owned columns (`quantity`, `order`, `materialMakeMethodId`) already match
is skipped. New lines and their mapping rows are written together in a Kysely
transaction (`insertOwnedMethodLines`,
`apps/erp/app/modules/settings/onshape-push.server.ts`; a count mismatch rolls
back), and the item link is swapped in one (`swapItemMapping`). Every delete is
scoped by `companyId`.

**Released (Active) make methods are never edited.** The push writes into a
Draft (`ensureDraftMakeMethod`,
`apps/erp/app/modules/settings/onshape-draft-method.server.ts`). It reuses a
Draft only when the panel made it from the current Active method and no change
notice holds it (`pickReusableDraft`, marker row above); a person's Draft, a
change notice's, one copied from an older version, or a half-built one is left
alone and a new version is made (`max(version) + 1`). The copy runs through
`copyMakeMethod`; ownership is carried with `pairOwnedCopiedLines`, which pairs
over every source line and skips zero quantities. The marker is written last;
a failed copy or carry deletes the new Draft with the service role. The
assembly plan loads the reusable Draft too (`loadReusableDrafts`), so the review
names the Draft the push will write into.

**Item ownership lock.** A panel-linked item's `name` and `description` (the UI
labels them Short Description and Long Description; panel and card copy uses
those labels) belong to Onshape. `checkItemIdentityEdit` (`apps/erp/app/modules/items/onshape-lock.ts`,
kept out of the service file so it is not an MCP tool, and out of `.server` so
the client-bundled service can import it) guards `upsertPart` (after resolving
a readable id), `updateItem` and the Properties sidebar
(`x+/items+/update.tsx`). It refuses only when a value actually changes; the
sidebar shows the refusal as its existing error toast. `upsertPart` leaves the
owned keys out of the write. The panel's own push writes them directly. CSV
import is not guarded (deliberate admin bulk action).

The item page's only integration footprint is the self-loading
`ExternalSourceCard` (one JSX line in `x+/part+/$itemId.details.tsx`): "Short and
long descriptions are managed in Onshape", last push time, **Open in Onshape** (the
exact tab when the link records a workspace, else the document — assembly
pushes link children without one) and **Detach** (behind a `Confirm` dialog;
`api+/integrations.onshape.detach` deletes the item's `onshape-v2` row only,
company-scoped; the card re-reads the link and goes only when it is gone).

## Plan / apply — every push is two requests

Pushes never write on the first request. PLAN
(`api+/integrations.onshape.panel.plan-{part,assembly,release}`) reads Onshape
and Carbon, builds the plan with the pure builders in
`packages/ee/src/onshape/panel/plan.ts`, stores it and returns
`{ planId, expiresAt, plan }`. APPLY (`push-{part,assembly,release}`) takes the
stored plan and writes; it makes NO Onshape call. A review that is cancelled or
expires has spent its reads (part 1, assembly 2, release 1 + N assemblies whose
method is not released).

- Store: `packages/ee/src/onshape/lib/panel-plan-store.ts`, Redis
  `panel-plan:cpp_<32 base64url>`, 15 min, bound to companyId + userId, peeked
  for validation (a 422 leaves it in place) and taken with GETDEL right before
  the writes (one-shot). `createPanelPlan` returns null when Redis did not take
  the write → the PLAN request answers 503. A missing/expired/foreign plan at
  apply → 410.
- The review's only editors are three manufacturing selects per row
  (`ItemFieldSelects.tsx`: replenishment, method type, tracking type). A create
  validates them with `mergeItemEdits`; an existing item with
  `mergeExistingItemEdits`, writing only what changed. Name and description
  always come from Onshape.
- A part is `unchanged` when its microversion matches the one the last push
  recorded. When a property map exists, unchanged rows still have their mapped
  fields resolved; if an owned value differs from Carbon's
  (`ownedCustomFieldsDiffer`), the row becomes an `update` flagged
  `cadUnchanged`, and apply writes the fields and link but skips the model
  export.
- `proposeItem` takes the company's push defaults from `parsePushDefaults`
  (`panel/preferences.ts`, fail-soft to `DEFAULT_PUSH_DEFAULTS`). A null unit
  resolves from the company's list at plan time. A purchased BOM row is always
  Buy.
- APPLY re-resolves items by readableId before creating. Parts adopt via
  `pickAdoptTarget` (a Part at the same revision, else any Part — never a
  Material/Tool sharing the number). Revisions compare the way
  `getNextRevision` counts them (`compareRevisions`, `panel/revision.ts`:
  digits by value, letters by length then alphabet, active rows first).
- Assembly apply is FLAT over `plan.methods`. An assembly push links a child
  item to its Onshape source only when neither the item nor the source is
  linked already (`linkChildParts`); a part push owns the link. The pushed
  assembly itself is always linked. Every reused item that is or becomes
  linked to its BOM row (the root, children already linked to the row, and
  children `linkChildParts` will link — the plan decides with `linkedItemIds`)
  takes Onshape's Short and Long Description (`assemblyTextChanges`); only
  values Onshape gives are written, because Name and Description are optional
  BOM columns and an empty cell must not blank Carbon's text. The review lists
  each change.
- Assembly plans carry a `depth`: `all` (default) or `top` (the root's method
  only, each sub-assembly a line pointing at its own method). `plan-assembly`
  refuses over `MAX_PLAN_PARTS` (1500) distinct part numbers.
- A root with no part number is refused at plan ("Set a part number on the
  assembly in Onshape first").

## Custom fields — the property map

Onshape properties flow into Carbon part custom fields through ONE map per
company, `companyIntegration.metadata.propertyMap`. Entry:
`{ onshapePropertyId, onshapeName, valueType, carbonFieldId, mode }`. Pure logic
in `packages/ee/src/onshape/panel/properties.ts` (tested).

- The editor is the panel's **Fields** page: Onshape lists properties only from
  inside a document. `api+/integrations.onshape.panel.fields.ts`: GET lists the
  element's properties (a part studio's as the union across its parts), the map
  and the part custom field definitions; POST replaces the whole map. Both take
  settings update; `panel.me` returns `canEditFields`. The save refuses a target
  type `MAPPABLE_VALUE_TYPES` does not allow, two properties on one field, and
  deleted fields (422, per property).
- ONE mode: every entry is `owned` — Onshape writes the field on every push.
  Nothing on the item page locks mapped custom fields.
- `MAPPABLE_VALUE_TYPES`: STRING/ENUM/OBJECT→Text, BOOL→Yes/No,
  INT/DOUBLE→Numeric, DATE→Date. USER/BLOB/COMPUTED/CATEGORY are not mappable,
  and no type maps to List.
- Values are read at plan (parts via `readPartProperties`,
  `@carbon/ee/onshape.server`, one metadata read at `depth=2`; assembly root
  from the element metadata the plan already reads). Release pushes and BOM
  children write no custom fields. Map empty → zero extra reads.
- Values land in `part.customFields`, keyed by readableId (shared across
  revisions). Writes merge only the mapped keys (`mergeCustomFieldValues`);
  an owned value emptied in Onshape deletes the key. The plan drops a clear
  for a field Carbon doesn't hold (`withoutNoOpClears`), so the review says
  "will be cleared" only when something is. A Yes/No field stores the
  string `"on"` (`BOOLEAN_TRUE`); a JSON boolean renders unticked.

## Push release

- Releases come from `GET /revisions/d/{did}` grouped by releaseId
  (`panel/releases.ts`). Every Part Studio revision carries its `partId`.
- Release management is an Onshape company feature. An empty list triggers one
  `getCompanies()` call; with no company the route returns
  `releaseManagementAvailable: false` and the panel says releases need a
  company account rather than "No releases yet".
- Per released model item: ensure an item AT the released letter —
  `createRevision` from the base or a fresh item. BOM children that are not
  release items are resolved with one bulk lookup (purchased hardware is
  reused). Release lines are inserted in one batch per method.
- One **Draft** change notice records the push. A released method in Carbon is
  not edited: its BOM is reported as skipped. Idempotent on
  partNumber+letter.
- Model exports carry the revision's `partId` and configuration
  (`releaseExportSelection`); the configuration is sent as Onshape returned it.
  A Part Studio item with no single `partId` is reported as skipped.

## Batch every `.in()` sized by CAD data

Supabase's gateway rejects a REST request whose encoded request line exceeds
4,096 bytes, and a PostgREST `.in()` list rides in the URL (between ~4 KB and
~6 KB Kong reports it as a 502 "invalid response from upstream"). The limit is
bytes, so a list of 53-58 character `documentId:elementId:partId` ids fails at
~56 entries. Every panel `.in()` sized by a BOM, part studio or release goes
through `selectInBatches` / `chunkFilterValues` (`onshape/lib/batched-filter.ts`),
which split on encoded bytes. A fixed count is not a fix. Batched rows arrive
in batch order, so anything relying on `.order(...)` re-sorts afterwards.

## Onshape API quirks (verified live)

- The indented BOM never includes the top-level assembly row — root identity
  comes from element metadata property "Part number".
- A Part Studio model export needs exactly one `partId`; the export job
  (`onshape-sync-element`) refuses a studio export without one. The element
  thumbnail endpoint cannot select a part or configuration, so only
  unconfigured assemblies take Onshape's thumbnail; every other thumbnail comes
  from Carbon's model optimizer once it processes the export.
- Unresolved action-URL placeholders arrive literally (`{$partNumber}`) and are
  treated as null (`parsePanelContext`).
- Extensions render only for users **subscribed** to the app — an OAuth grant
  alone shows nothing.
- Configurations are part of identity: the configuration is appended to every
  mapping key when it is not the default (`normalizeConfiguration` /
  `externalIdFor*` in `panel/status.ts`).
- A linked document's BOM can report a different revision for the same part
  than the source document's own BOM at the same version.
- A refresh token still worked after seven days unused.
- Quota: private apps debit the app owner's annual quota; publicly listed App
  Store apps are exempt.

## Dev workflow

- `ONSHAPE_DEV_CACHE=1` (worktree `.env`) serves repeated GETs from a 10-minute
  Redis cache, only for paths in `DEV_CACHEABLE_PATHS`
  (`packages/ee/src/onshape/lib/client.ts`). Never add a polling endpoint.
- Live calls are counted in Redis `onshape:api-calls:<year>` (never awaited).
- The slow work (export, poll, download, thumbnail; released drawings as PDF)
  is one Inngest job: `onshape-panel-sync`, `elementKind`
  `partstudio | assembly | drawing`, retries 1, per-item concurrency 1.

## Panel layout — three pages

The panel shows status and pushes. Anything a user would change lives in
Onshape or on the Onshape V2 integration page in Carbon, except the property
map (the Fields page), because Onshape lists properties only inside a document.

Top band pinned (`Tabs` is the outermost element): **Parts / Assembly** (label
follows the element kind; hidden on a drawing), **Releases** (needs a
`documentId`), **Fields** (settings update only), and on the right the Carbon
company plus Sign out.

- Assembly BOM is the structured tree (`panel/bom-view.ts`).
- Status badges: Linked (green), Conflict (red — same part number, not linked
  to this source; its tooltip says so, and parts and BOM rows add "number
  already used in Carbon"), Unlinked (grey).
- Reviews are summaries: one line of counts, alerts (parts matched by part
  number, won't-write, Draft, manual lines taken over with their quantity
  change, manual lines kept), and read-only rows.
- Every action is disabled while a read or write is in flight.
- `panelFetch` gives up after `PANEL_FETCH_TIMEOUT_MS` (60 s) with
  `PanelTimeoutError`, so a stalled read shows a message and Refresh. Applies
  pass `null`: a push keeps writing after the panel stops waiting, and its plan
  is spent.

## Panel layout — the scroll container is load-bearing

`onshape+/_layout.tsx` owns the scroll (`h-dvh overflow-hidden`), and the panel
renders three bands: a pinned header, ONE scrolling body
(`min-h-0 flex-1 overflow-y-auto`), and a `sticky bottom-0` action bar per
review section. The document itself must never scroll.

That is not styling. The app shell sets `html.h-full.overflow-x-hidden` plus
`body.h-full`, which makes the root element a fixed-height scroll container,
and Radix Select does not survive that: opening one snapped the document to
scrollTop 0 and closed the popup. Never reintroduce `min-h-screen`/`min-h-dvh`
on the panel shell.
