# Onshape: the Carbon panel (push-only element app)

- **Status:** Implemented on `feat/onshape-app` (pending review)
- **Date:** 2026-08-28
- **Author:** Raul (with Claude)

## Problem

Carbon's Onshape integration was pull-shaped: Carbon lists documents, pulls
models, and a webhook attaches assets when Onshape releases. The people who
decide when CAD data should land in Carbon work *in Onshape*, and they had no
control surface there. Pulling also spends API quota guessing at what changed
instead of acting once when a person says "this is ready".

## Goals

- A Carbon app inside Onshape's element right panel: users trigger everything
  from Onshape; Carbon never pulls automatically.
- Three pushes: **part**, **assembly** (BOM into make methods), **release**
  (revisions + change notice).
- Status first: the panel always shows what the current element already has in
  Carbon before offering to push.
- No item-page fork: the ERP item page gains exactly one self-contained card.
- Frugal with Onshape API quota (private apps debit the app owner annually).

## Architecture

### Panel and auth

- `apps/erp/app/routes/onshape+/panel.tsx` is the only framable route
  (`Content-Security-Policy: frame-ancestors https://*.onshape.com`), rendered
  by `OnshapePanel` from `@carbon/ee` (`packages/ee/src/onshape/panel/`).
- The `carbon` cookie is `SameSite=Lax` and never reaches a cross-site iframe.
  The panel signs in through a same-origin popup (`onshape+/auth.tsx`) that
  mints an opaque bearer token (`cps_…`, Redis `panel-session:<token>`, 12 h,
  refresh in place) and hands it to the opener via postMessage. The token is
  kept in sessionStorage and sent as `Authorization: Bearer`.
- `requirePermissions` accepts that token as a third auth branch; permission
  denials for panel tokens are 401/403 responses, never redirects.

### API routes (`apps/erp/app/routes/api+/integrations.onshape.panel.*`)

| Route | Verb | Does |
|---|---|---|
| `me` | GET | who the token belongs to |
| `session` | DELETE | revoke the token |
| `status` | GET | element kind + part statuses (Part Studio) or root identity + flattened BOM with per-line state (Assembly) |
| `push-part` | POST | create/adopt/update items for selected parts, queue asset export |
| `push-assembly` | POST | ensure BOM items, apply lines to Draft make methods (diff, not rebuild), queue assembly model export |
| `releases` | GET | document releases (revisions grouped by releaseId) joined to Carbon items |
| `push-release` | POST | revisions + BOMs + change notice + assets for one release |

### Identity and mappings (`externalIntegrationMapping`, integration `onshape`)

- Part item: externalId `documentId:elementId:partId`; assembly item:
  `documentId:elementId:assembly`; release revision item:
  `release:<releaseId>:<partNumber>`.
- Onshape-origin BOM lines: entityType `methodMaterial` with
  `metadata.makeMethodId` — a push replaces exactly those lines and leaves
  manual lines alone. Released (Active) methods are refused.
- Onshape-owned item fields (`readableId`, `name`, `description`, `revision`,
  thumbnail, model): the item update path drops them for mapped items; the
  item page shows one `ExternalSourceCard` (Open in Onshape, Detach).

### Push release semantics

- Releases are reconstructed from `GET /revisions/d/{did}` grouped by
  releaseId (Onshape has no packages-by-document endpoint; one call).
- Per released part/assembly: ensure a Carbon item at the released revision
  letter — `createRevision` from the base item (created **active** and made
  the **default** via `updateDefaultRevision`, so consuming lines cut over) —
  or a fresh item when the part number was never in Carbon.
- Released assemblies apply their version-scoped BOM to the new revision's
  Draft method. The revision copy's Onshape-origin lines are deduped through
  the base method's mapping tuples, so manual lines survive into the new
  revision. Children resolve to the same release's letter items first, then
  any existing item (one bulk lookup — purchased hardware isn't re-minted).
- One **Draft** change notice records the push (Revision affected rows with
  base item, `newItemId`, draft + base methods). Releasing methods and
  production cutover stay with the user.
- Assets export at the released version per item; released drawings attach as
  PDF via the panel-sync job's `drawing` branch (exact part-number match).
- Idempotent on the release's part number + letter pairs; re-push re-applies
  BOMs and assets (repair) without duplicating items or the change notice.

### Plan / apply (confirm step, 2026-08-30)

Every push is PLAN then APPLY. PLAN reads Onshape + Carbon, writes nothing,
and returns what would happen — per part: create / adopt / update / unchanged
with the proposed field values; per assembly: items to create or reuse and,
per make method, the lines added, the Onshape-origin lines replaced and the
manual lines kept, with released methods flagged; per release: the revision
each item gets, BOM children that will be minted, the change notice name and
description, and whether new revisions become the default. The plan is stored
in Redis (15 min, bound to the user and company, taken once with GETDEL) and
APPLY consumes it with the user's edits and deselections — no Onshape read at
apply. A completed push costs the same Onshape reads as before, spent at
review time; a cancelled or expired review has spent them. A release plan
skips the BOM read of an assembly whose method is already released in Carbon
(the apply would refuse it anyway) and stores null for a BOM it could not
read, which the apply leaves alone — an empty array is a genuinely empty BOM.

| Route | Verb | Does |
|---|---|---|
| `plan-part` | POST | 1 Onshape read; `{ planId, expiresAt, plan: PartPlan }` |
| `plan-assembly` | POST | 2 reads (BOM, metadata); `AssemblyPlan` (BOM tree stored server-side) |
| `plan-release` | POST | 1 + N reads (revisions, each released assembly's BOM at version); `ReleasePlan` |
| `push-part` | POST | `{ planId, selected, edits }` → results |
| `push-assembly` | POST | `{ planId, edits, excluded }` → summary |
| `push-release` | POST | `{ planId, edits, changeNotice, makeDefault }` → summary |

Editable at create only: name, description, replenishmentSystem,
defaultMethodType, itemTrackingType, unitOfMeasureCode (the four the routes
used to hardcode). Identity (readableId, revision) is Onshape's; adopt and
update take no edits, so the owned-field lock is untouched. Item type stays
Part. Pure module `packages/ee/src/onshape/panel/plan.ts` (builders, edit
merging, the ERP's replenishment↔method interlock) is tested; the store and the
bulk Carbon reads live under `packages/ee/src/onshape/lib/`.

Deliberate behaviour changes with the split: assembly apply is flat per method
(a Draft sub-assembly under a released parent is applied; it used to be
skipped), a "create" whose part number appeared since the plan becomes
adopt/reuse instead of a duplicate, parts never adopt a non-Part item sharing
the number, the change notice `openDate` is the company's day (not UTC), and
the panel patches its part list from the apply response instead of re-reading
status.

### Custom fields (property map, 2026-08-31)

One explicit map per company on the integration metadata: Onshape property →
Carbon `part` custom field, with per-mapping ownership (`owned` = written on
every push and locked in the ERP, like name/description; `default` = filled at
create, editable in the review, Carbon's afterwards). Configured from the
panel's Fields section, which lists the live Onshape property schema (union
across the element's parts) next to the company's part fields, creates fields
inline (type derived from the value type), and saves the whole map. Values are
resolved at plan time (parts: one depth=2 metadata read, verified live;
assembly: root only, from the read the plan already makes; releases and BOM
children: none in v1) and written at apply into `part.customFields` (keyed by
readableId — shared across revisions) as a read-merge-write of mapped keys
only. List options sync add-only at apply. Coercion problems and unmapped
valued properties are review lines, never writes.

### Background work

One Inngest job (`onshape-panel-sync`, event `carbon/onshape-panel-sync`)
does the slow part per pushed element: translation export, poll, download,
thumbnail, then `model-optimize` / `model-thumbnail`. `elementKind` is
`partstudio | assembly | drawing`; `wvm` is `w | v`.

### Quota

- Private Onshape apps debit the **app owner's** annual quota; publicly listed
  App Store apps are exempt — production ships as a public listing.
- Dev: `ONSHAPE_DEV_CACHE=1` serves repeated GETs from a 10-minute Redis cache
  behind an **allow-list of stable content reads** (`DEV_CACHEABLE_PATHS`) —
  never polling endpoints. Live calls are counted in Redis
  (`onshape:api-calls:<year>`).

## Onshape API facts the code depends on

- The indented BOM never returns the top-level assembly row; assembly identity
  comes from element metadata ("Part number").
- `partIds` on Part Studio translations is ignored — exports are whole-studio.
- Unresolved action-URL placeholders arrive as literal `{$partNumber}` and are
  treated as null.
- Extensions render only for users **subscribed** to the app (private store
  entry + "Get for free"); an OAuth grant alone is not enough.

## Out of scope (deferred)

- Custom fields (material / mass / bounding box — `getPartStudioMassProperties`
  exists unused).
- Configurations: not carried at all. Identity ignores them, both BOM reads
  send no `configuration`, and nothing writes one to mapping metadata — the
  release grouping parses `configuration` off a revision row and drops it.
  A non-default configuration therefore resolves to the default BOM and
  collapses onto the default item.
- Drawings on part push (they ride with releases); drawing matching beyond
  exact part number.
- Item names for release-created items (part number until an element push
  refines them).

## Verification

All milestones verified live against a real Onshape document (M1–M5, evidence
in the feature log): part push + owned-field guard, assembly push with
manual-line survival, release push (10 revisions, exact Rev-A tree, change
notice, defaults cutover, idempotent re-push), panel UI for each. 17+ vitest
tests on the pure panel modules (`messages`, `status`, `push-plan`, `bom`,
`releases`).
