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
`.ai/specs/2026-08-28-onshape-app.md`.

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
  place. Panel-token permission denials return 401/403 — **never redirects**
  (a redirect inside the iframe is meaningless).
- Tokens never appear in URLs. postMessage targets `window.location.origin`.

## Identity — externalIntegrationMapping (integration "onshape")

| Entity | externalId |
|---|---|
| Part item | `documentId:elementId:partId` |
| Assembly item | `documentId:elementId:assembly` |
| Release revision item | `release:<releaseId>:<partNumber>` |
| Onshape-origin BOM line | entityType `methodMaterial`, `metadata.makeMethodId` identifies the owning method |

BOM pushes are a **diff, not a rebuild**: delete only lines whose mapping rows a
previous push wrote (matched by `metadata->>makeMethodId`), insert fresh ones,
leave manual lines untouched. Released (Active) make methods are refused with an
error naming the part.

Onshape-owned item fields — `readableId`, `name`, `description`, `revision`,
thumbnail, model — are dropped by `upsertPart`'s update path for mapped items.
The item page's ONLY integration footprint is the self-loading
`ExternalSourceCard` (one JSX line in `x+/part+/$itemId.details.tsx`).

## Plan / apply — every push is two requests

Pushes never write on the first request. PLAN
(`api+/integrations.onshape.panel.plan-{part,assembly,release}`) reads Onshape
and Carbon, builds the plan with the pure builders in
`packages/ee/src/onshape/panel/plan.ts`, stores it and returns
`{ planId, expiresAt, plan }`. APPLY (`push-{part,assembly,release}`) takes the
stored plan and the user's edits/selection and writes — it makes NO Onshape
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
- Editable at CREATE only: name, description, replenishmentSystem,
  defaultMethodType, itemTrackingType, unitOfMeasureCode — validated by
  `mergeItemEdits` (enum whitelist, the ERP's replenishment↔method interlock
  duplicated as `VALID_METHOD_TYPES_BY_REPLENISHMENT`, unit must be one of the
  company's). Adopt/update never take edits: the owned-field lock stays true.
- `proposeItem` holds the defaults the routes used to hardcode (Make / Make to
  Order / Inventory, purchased BOM rows Buy / Pull from Inventory) and picks
  the unit from the company's list ("EA" is not seeded by any migration).
- APPLY re-resolves items by readableId before creating: `upsertPart` reads
  the new id back from the `parts` view, which is the WRONG row when another
  revision of that number exists, so a "create" whose number now exists
  becomes adopt/reuse. Parts adopt via `pickAdoptTarget` (a Part at the same
  revision, else any Part — never a Material/Tool sharing the number).
- Assembly apply is FLAT over `plan.methods`: each level stands alone, so a
  Draft sub-assembly under a released parent is still applied (the old
  recursive push skipped it). Line `itemType` comes from `bomLineItemType`.
- Release plan reads each released assembly's BOM at its version (immutable,
  stored in the plan); the change notice number is only minted at apply
  (`get_next_sequence` burns a number — never call it from a plan).
- The panel patches its part list from the apply response instead of
  re-reading status (saves the 2 status reads per push in production).

## Custom fields — the property map

Onshape properties flow into Carbon custom fields through ONE explicit map per
company, `companyIntegration.metadata.propertyMap`. The save writes ONLY that
key (`jsonb_set` through Kysely): the same column holds `credentials`, and the
token refresh and the settings save are full-column read-modify-writers that
would otherwise revert a saved map. Entry:
`{ onshapePropertyId, onshapeName, valueType, carbonFieldId, mode }`.
Pure logic in `packages/ee/src/onshape/panel/properties.ts` (tested); the
Fields editor is `api+/integrations.onshape.panel.fields.ts` + the panel's
Fields section.

- `mode: "owned"` (default): Onshape writes the field on every push — locked
  like name/description. `"default"`: filled at create only, editable in the
  review, Carbon's afterwards.
- Values are read at plan: parts via `readPartProperties` (one metadata read
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
- Fields POST needs settings update; creating a field inline also needs
  settings create (the settings UI's own gate for field creation).

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
- Configurations are not carried anywhere: `getBillOfMaterials` and
  `getBillOfMaterialsIn` both hardcode their query strings with no
  `configuration` slot, no externalId contains one, and nothing writes one to
  mapping metadata (the release grouping parses it off a revision row and
  drops it). So a non-default configuration silently resolves to the DEFAULT
  BOM and collapses onto the default item — verified live on the v2 branch,
  where pushing WB-100-LR overwrote WB-100.A's model file undetectably.
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

A row's editor and custom fields live behind `RowDisclosure` and MOUNT only when
opened. A hundred selected create rows previously built six Radix Selects each
before the list could paint. Keep new per-row controls inside the disclosure.

`PlanToolbar` (search, action-group chips, bulk select) is shared by the part and
assembly reviews. Bulk selection acts on the FILTERED rows, never the whole plan.
There is no virtualization and none is needed while the editors stay lazy — the
rows themselves are a checkbox, two lines of text and a badge.
