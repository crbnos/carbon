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
