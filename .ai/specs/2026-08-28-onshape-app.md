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
- Configurations: a release item's `configuration` is stored in mapping
  metadata but not part of identity.
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
