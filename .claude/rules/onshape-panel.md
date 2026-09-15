paths:
  - "packages/ee/src/onshape/**"
  - "packages/auth/src/services/panel-session.server.ts"
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
`packages/ee/src/onshape/config-v2.tsx`). `onshape` stays the pull-shaped
original (released-asset webhook sync, `config.tsx`). Separate OAuth grant,
separate `companyIntegration` row, separate `externalIntegrationMapping`
namespace; a company can run either, both, or neither. Intended to be
temporary while v2 replaces v1.

- Ids live in `packages/ee/src/onshape/lib/integration-id.ts`. Every panel read
  and write passes one explicitly (`getOnshapeClient(id)` defaults to v1 for
  the untouched v1 callers). A bare `"onshape"` literal in panel code is a bug.
- Reads that answer "is this already in Carbon?" (status, the item page's
  `ExternalSourceCard`, `items.service.ts`) look in BOTH namespaces,
  `ONSHAPE_INTEGRATION_IDS`, v2 first. Writes name exactly one.
- Same Onshape OAuth app, same scopes (`OAuth2Read OAuth2Write`), two redirect
  URIs: `ONSHAPE_OAUTH_REDIRECT_URL` → `/api/integrations/onshape/oauth`,
  `ONSHAPE_V2_OAUTH_REDIRECT_URL` → `/api/integrations/onshape-v2/oauth`. Both
  must be registered on the Onshape app. Install + callback for both ids are one
  handler parameterised by id (`apps/erp/app/modules/settings/onshape-oauth.server.ts`);
  each install route checks ITS OWN redirect var and answers "Onshape OAuth not
  configured" (500) when missing. Install mints the OAuth `state` bound to
  integration + user + company (Redis `onshape-oauth-state:<uuid>`, 15 min;
  503 when Redis did not take it); the callback GETDELs it and refuses a
  missing, expired, replayed or mismatched state as `invalid-response`.
- Migration `20260909174511_onshape-v2-integration.sql` seeds the `integration`
  row (FK target for `companyIntegration`); `credentials` required, `baseUrl`
  not — the integration settings form may write metadata before any grant exists.
- The V2 integration form holds the five push defaults (`config-v2.tsx`,
  "Push defaults" group). The unit dropdown's options are the company's units,
  loaded in `x+/settings+/integrations.$id.tsx` as `dynamicOptions`. The generic
  save spreads existing metadata under the form values, so `propertyMap`,
  `credentials` and the vaulted tokens survive a save.
- `onshape-v2` is in `SECRET_KEYS`: its tokens live in Supabase Vault
  (migration `20260914101621_onshape-v2-vault-secrets.sql` moved existing ones).
- `beginOAuthPopup` (`packages/ee/src/oauth-popup.ts`) opens the popup inside
  the click, before the install fetch — opening after the await was silently
  blocked.

## Auth — why the panel has its own credential

The `carbon` session cookie is `SameSite=Lax` and never reaches a cross-site
iframe. So:

- `onshape+/panel.tsx` loads with **no auth** and is the ONLY route that may be
  framed (`Content-Security-Policy: frame-ancestors https://*.onshape.com` —
  nothing else in the app sets a CSP).
- `onshape+/auth.tsx` is a same-origin popup: normal cookie session required,
  mints an opaque `cps_<32 base64url>` token (Redis `panel-session:<token>`,
  12 h TTL, `packages/auth/src/services/panel-session.server.ts`), posts it to
  the opener, closes. The panel keeps it in sessionStorage and sends
  `Authorization: Bearer`.
- `requirePermissions` (`packages/auth/src/services/auth.server.ts`) accepts
  the token as a third branch and refreshes the underlying access token in
  place. Supabase rotates refresh tokens, so the refresh runs under an
  owner-bound lease lock (`panel-session-refresh:<token>`, 5 s lease renewed
  every 2 s by `withPanelRefreshLock`, compare-and-delete release). Only the
  holder refreshes; waiters poll for its result and retry the lock, and one
  that sees neither answers 401 rather than racing a second refresh. Panel-token permission denials return 401/403 — **never redirects**
  (a redirect inside the iframe is meaningless).
- Tokens never appear in URLs. postMessage targets `window.location.origin`.

## Identity — externalIntegrationMapping (integration `onshape-v2` for panel writes)

| Entity | externalId |
|---|---|
| Part item | `documentId:elementId:partId` |
| Assembly item | `documentId:elementId:assembly` |
| Release revision item | `release:<releaseId>:<partNumber>` |
| Onshape-origin BOM line | entityType `methodMaterial`, `metadata.makeMethodId` identifies the owning method |

BOM pushes are a **diff, not a rebuild**: delete only lines whose mapping rows a
previous push wrote (matched by `metadata->>makeMethodId`), insert fresh ones,
leave manual lines untouched.

**Released (Active) make methods are never edited and no longer refused.** The
push takes a Draft version (`ensureDraftMakeMethod`,
`apps/erp/app/modules/settings/onshape-draft-method.server.ts`: reuse the
newest existing Draft, else `copyMakeMethod` + `upsertMakeMethodVersion`) and
writes there. Idempotent — a second push finds the same Draft. The copy has new
line ids and no mappings, so `correlateCopiedLines`
(`packages/ee/src/onshape/panel/method-version.ts`) re-derives the
Onshape-origin mappings by natural key (component item, then `order` within a
component) and leaves anything it cannot pair unmapped — an unmapped line reads
as manual and is preserved. Pairing wrongly is the failure that matters. The
push result reports `New Draft version, not yet live: …`.

A line already carrying the right component is UPDATED in place, and one whose
push-owned columns (`quantity`, `order`, `materialMakeMethodId`) already match
is skipped entirely — an untouched re-push costs no writes and stamps no
`updatedBy`. New lines are collected per method and written as ONE bulk insert
plus ONE bulk mapping insert, paired by index; the counts are compared before
pairing, since a short result would link mapping rows to the wrong lines.

Onshape-owned item fields — `readableId`, `name`, `description`, `revision`,
thumbnail, model — are dropped by `upsertPart`'s update path for mapped items.
The item page's ONLY integration footprint is the self-loading
`ExternalSourceCard` (one JSX line in `x+/part+/$itemId.details.tsx`). It shows
the v2 link when both exist and posts that row's `integration` to Detach, which
validates it and deletes exactly that namespace's row. A failed lock lookup in
`upsertPart` returns the error instead of writing the owned fields.

## Plan / apply — every push is two requests

Pushes never write on the first request. PLAN
(`api+/integrations.onshape.panel.plan-{part,assembly,release}`) reads Onshape
and Carbon, builds the plan with the pure builders in
`packages/ee/src/onshape/panel/plan.ts`, stores it and returns
`{ planId, expiresAt, plan }`. APPLY (`push-{part,assembly,release}`) takes the
stored plan and writes — it makes NO Onshape
call; every read a push needs is already in the plan. A completed push costs
the same Onshape reads as before, spent at review time — a review that is
cancelled or expires has spent them (part 1, assembly 2, release 1 + N
assemblies whose method is not released).

- Store: `packages/ee/src/onshape/lib/panel-plan-store.ts`, Redis
  `panel-plan:cpp_<32 base64url>`, 15 min, bound to companyId + userId,
  peeked for edit validation (a 422 leaves it in place) and taken with GETDEL
  right before the writes (one-shot — a double-click cannot apply twice; an
  apply that fails after the take means "review again"). `createPanelPlan`
  returns null when Redis did
  not take the write (`@carbon/kv` is fail-soft) → the PLAN request answers
  503. A missing/expired/foreign plan at apply → 410.
- The review is READ-ONLY. The panel sends no edits, no exclusions and every
  pushable row; values change in Onshape (identity, properties) or in the push
  defaults (item settings), then the user reviews again. The apply routes still
  accept `edits`/`excluded`/`selected` and validate them with `mergeItemEdits`,
  so an older panel keeps working — but nothing in the product sends them.
- `proposeItem` takes the company's **push defaults** from
  `parsePushDefaults(companyIntegration.metadata)`
  (`packages/ee/src/onshape/panel/preferences.ts`, pure, total, fail-soft —
  a malformed row yields `DEFAULT_PUSH_DEFAULTS`: Make / Make to Order /
  Pull from Inventory for purchased rows / Inventory / unit null). Null unit
  means "resolve from the company's list at plan time" ("EA" is not seeded by
  any migration, and a stored code can stop existing). `reconcilePushDefaults`
  enforces the replenishment↔method interlock; a purchased BOM row is always
  Buy. Keys: `defaultUnitOfMeasureCode`, `defaultReplenishmentSystem`,
  `defaultMethodTypeForMake`, `defaultMethodTypeForBuy`,
  `defaultItemTrackingType`. Release behaviour is fixed, not configurable: a
  release push records the plan's change notice when it creates revisions, and
  new revisions become the default (`push-release` still takes `changeNotice`
  and `makeDefault`; the panel sends the plan's values). `panel.me` returns only
  `{ userId, email, company }`.
- APPLY re-resolves items by readableId before creating: `upsertPart` reads
  the new id back from the `parts` view, which is the WRONG row when another
  revision of that number exists, so a "create" whose number now exists
  becomes adopt/reuse. Parts adopt via `pickAdoptTarget` (a Part at the same
  revision, else any Part — never a Material/Tool sharing the number).
- Assembly apply is FLAT over `plan.methods`: each level stands alone, so a
  Draft sub-assembly under a released parent is still applied (the old
  recursive push skipped it). Line `itemType` comes from `bomLineItemType`.
- Assembly plans carry a `depth`: `all` (default, the whole tree) or `top`
  (the root's method only, each sub-assembly a single line pointing at its own
  make method). `top` exists because `methodMaterial.materialMakeMethodId`
  already nests levels, so a big tree composes from pushes made a level at a
  time — and each push is then bounded by one level's line count. A `top` plan
  still classifies an unexploded sub-assembly as an assembly (`madePartNumbers`
  is computed over the WHOLE tree); classifying it from its now-empty child
  list would create it as a Buy part. Apply loads make methods for every
  `isAssembly` item, not just the ones in `plan.methods`, or a `top` push would
  write its lines with a null child-method pointer and flatten the tree.
- `plan-assembly` refuses over `MAX_PLAN_PARTS` (1500) distinct part numbers
  with a message naming the count and the level-by-level route out. Not a
  technical limit — a push is one request with no rollback, so a very large one
  can be cut off mid-write.
- Release plan reads each released assembly's BOM at its version (immutable,
  stored in the plan); the change notice number is only minted at apply
  (`get_next_sequence` burns a number — never call it from a plan).
- The panel patches its part list from the apply response instead of
  re-reading status (saves the 2 status reads per push in production).

## Custom fields — the property map

Onshape properties flow into Carbon custom fields through ONE explicit map per
company, `companyIntegration.metadata.propertyMap`. Entry:
`{ onshapePropertyId, onshapeName, valueType, carbonFieldId, mode }`.
Pure logic in `packages/ee/src/onshape/panel/properties.ts` (tested).

- THERE IS NO EDITOR. The panel's Fields editor and its route were removed; an
  existing map keeps working. Where editing should live is undecided: the
  editor listed the open document's properties, and Carbon's settings page has
  no document and the client has no company property-schema call.
- ONE mode: `parsePropertyMap` reads every entry as `owned` — Onshape writes the
  field on every push. A stored `"default"` is treated as owned. Nothing on the
  item page locks mapped custom fields; they stay editable until the next push
  overwrites them.
- Values are read at plan: parts via `readPartProperties`
  (`@carbon/ee/onshape.server` — kept off the general barrel; one metadata read
  at `depth=2`, verified live to nest `parts.items[].properties`; per-part
  fallback exists), assembly ROOT from the element-metadata read the plan
  already makes. Release pushes and BOM children don't touch custom fields.
  Map empty → zero extra reads.
- Values land in `part.customFields`, KEYED BY readableId — one row per part
  number shared across revisions. Writes are read-merge-write of only the
  mapped keys (`mergeCustomFieldValues`), so Carbon-owned keys survive.
- Enum/List options sync ADD-ONLY at apply (`missingListOptions`), never at
  plan (a plan writes nothing) and never removing options.
- Coercion: STRING→Text/List, BOOL→Yes/No, INT/DOUBLE→Numeric, DATE→Date,
  ENUM→List/Text, OBJECT (Material)→Text display name; USER/BLOB/COMPUTED not
  mappable. A value that cannot coerce is a review problem line, never a write.
  A Yes/No field stores the ERP's checkbox value — the string `"on"` when
  ticked, no key when not (`BOOLEAN_TRUE`); a JSON boolean renders unticked in
  every table (`useCustomColumns` reads `=== "on"`). Dates are validated as
  real calendar days, not just the YYYY-MM-DD shape.
- An `owned` field emptied in Onshape empties in Carbon: owned nulls carry
  through and `mergeCustomFieldValues` deletes the key. Fields the push does
  not own are never touched.
- The OAuth callback spreads the existing metadata, so reconnecting Onshape
  keeps the map (it used to rebuild the column from scratch).

## Push release

- Releases come from `GET /revisions/d/{did}` grouped by releaseId
  (`packages/ee/src/onshape/panel/releases.ts`, pure + tested). Onshape has no
  packages-by-document endpoint.
- Per released model item: ensure an item AT the released letter —
  `createRevision` from the base (created active, then `updateDefaultRevision`
  cuts consumers over) or a fresh item. The revision copy's Onshape-origin
  lines are deduped via the base method's mapping tuples so manual lines
  survive into the new revision. BOM children that aren't release items are
  resolved with one bulk lookup before minting anything (purchased hardware
  already in Carbon must be reused, not re-created).
- One **Draft** change notice records the push; releasing methods stays with
  the user. Idempotent on partNumber+letter; re-push re-applies BOMs + assets.

## Batch every `.in()` sized by CAD data

Supabase's gateway rejects a REST request whose **encoded request line exceeds
4,096 bytes**, and a PostgREST `.in()` list rides in the URL. Measured: 3,821
bytes succeeds, 4,001 fails; past ~6 KB Kong answers 414, and between the two it
forwards and PostgREST rejects it, which Kong reports as a **502 "invalid
response from upstream"** — a confusing way to be told a list was too long.

The limit is BYTES, so the part count a call survives depends on the value
length — ~215 nine-character part numbers, but only **~56** of the 53-58
character `documentId:elementId:partId` external ids. That pair of reads in
`linkChildParts` was therefore the first thing a real assembly broke, and it
broke QUIETLY: the failure lands in `summary.errors` on a push that otherwise
reports success, leaving created items unlinked from their part studios.

Every panel `.in()` sized by a BOM, a part studio or a release now goes through
`selectInBatches` / `chunkFilterValues` (`onshape/lib/batched-filter.ts`, exported
from `@carbon/ee/onshape`), which split on encoded bytes. They live under
`onshape/` rather than in shared code deliberately: the limit is platform-wide,
but the panel is the only feature that turns an arbitrary customer assembly into
an unbounded filter list, and the integration should not be changing the shape of
calls the rest of Carbon makes. **A fixed count is not a fix** — it is exactly how a list of long
ids slips past a limit tuned for short ones. Two consequences to keep in mind:
a batched read's rows arrive in batch order, so anything that relied on
`.order("revision")` re-sorts afterwards; and the orphan-mapping cleanup reads
the method's rows and diffs in memory rather than sending a `not in` list of
every line it just wrote.

## Onshape API quirks (verified live)

- The indented BOM never includes the top-level assembly row
  (`includeTopLevelAssemblyRow=true` notwithstanding) — root identity comes
  from element metadata property "Part number".
- `partIds` on Part Studio translations is **ignored**: exports are always the
  whole studio.
- Unresolved action-URL placeholders arrive literally (`{$partNumber}`) and
  must be treated as null (`parsePanelContext`).
- Extensions render only for users **subscribed** to the app (private store
  entry + "Get for free") — an OAuth grant alone shows nothing.
- Configurations are part of identity. A configured part is one partId whose
  variants can carry different part numbers, so the configuration is appended
  to every mapping key when it is not the default:
  `documentId:elementId:partId[:configuration]`, `…:assembly[:configuration]`
  (`normalizeConfiguration` / `externalIdFor*` in `panel/status.ts`). The
  default configuration ("default", empty, absent) adds nothing, so keys written
  before this still match. BOM rows carry it in `itemSource.configuration`; the
  panel sends its launch `configuration` to status, plan-part and plan-assembly,
  which pass it to the Onshape reads (BOM, parts, metadata) and store it on the
  plan; the push routes key and export with it (`onshape-panel-sync` passes it to
  the GLTF translation). Without it, two variants in one BOM claimed one key and
  the unique mapping index rejected the whole child-link insert.
- Child links (`linkChildParts` in push-assembly) skip a source claimed by two
  items and report it, and fall back to one insert per row when the bulk insert
  is refused, so one bad row cannot unlink the rest. Remaining edge: two
  configurations sharing ONE part number map to one item, which gets only the
  first source's link; the other row shows Conflict. The thumbnail is still read
  unconfigured.
- Quota: private apps debit the app owner's annual quota; **publicly listed**
  App Store apps are exempt. Production ships as a public listing.

## Dev workflow

- `ONSHAPE_DEV_CACHE=1` (worktree `.env`) serves repeated GETs from a
  10-minute Redis cache — but ONLY paths in `DEV_CACHEABLE_PATHS`
  (`packages/ee/src/onshape/lib/client.ts`). Never add a polling endpoint
  (`/translations/{id}` poisoned the wait loop once). `/revisions/d/` is
  cached, so a fresh Onshape release can lag up to the TTL in a dev panel.
- Live calls are counted in Redis `onshape:api-calls:<year>`.
- The slow work (export, poll, download, thumbnail; released drawings as PDF)
  is one Inngest job: `onshape-panel-sync`, `elementKind`
  `partstudio | assembly | drawing`, retries 1, per-item concurrency 1 —
  every execution spends live quota.

## Panel layout — two pages, no settings

The panel shows status and pushes; it edits nothing. Anything a user would
change lives in Onshape or on the Onshape V2 integration page in Carbon.

Top band pinned (`Tabs` is the outermost element): **Parts / Assembly** (label
follows the element kind; hidden on a drawing), **Releases** (needs a
`documentId`), and on the right the Carbon company plus Sign out. A page that
vanishes when Onshape moves the panel to another element falls back to the
first available.

- Assembly BOM is the structured tree only (top level collapsed, Expand all),
  built from the status route's dotted item numbers
  (`packages/ee/src/onshape/panel/bom-view.ts`). Assembly plans are
  `depth: "all"` unless the too-large refusal offers "Push this level only".
- Status badges: Linked (green), Conflict (red — same part number, no link),
  Unlinked (grey).
- Reviews are summaries: one line of counts, the conflict / won't-write / Draft
  / manual-lines-kept alerts, and read-only rows (no per-method line list) (proposed settings, owned-field changes, mapped
  custom field values). No search, filter chips, tick boxes or editors.
- Every action disabled while a read or write is in flight; a Refresh keeps
  rows on screen instead of collapsing to a spinner.

## Panel layout — the scroll container is load-bearing

`onshape+/_layout.tsx` owns the scroll (`h-dvh overflow-hidden`), and the panel
renders three bands: a pinned header, ONE scrolling body
(`min-h-0 flex-1 overflow-y-auto`), and a `sticky bottom-0` action bar per
review section. The document itself must never scroll.

That is not styling. The app shell sets `html.h-full.overflow-x-hidden` plus
`body.h-full`, which makes the ROOT element a fixed-height scroll container, and
**Radix Select does not survive that**: opening one snapped the document to
scrollTop 0 and closed the popup before it could be used. Verified live in the
panel — click a Select near the bottom of a scrolled page and the trigger takes
focus, the view jumps to the top, and no listbox mounts. Freeing `html`/`body`
height, or giving the panel its own scroller, both fix it; the panel owns its
scroller because that is also what lets the header and the push button stay put.
Never reintroduce `min-h-screen`/`min-h-dvh` on the panel shell.

Review rows are text and a badge, with no controls, so a 300-row review needs
no virtualization. Adding an interactive control per row would bring that back
into question — the removed editors mounted six Radix Selects per row.
