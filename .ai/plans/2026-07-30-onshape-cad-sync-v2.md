# Onshape CAD Sync v2 — per-part re-pull, metadata panel, engineering data, sync progress

Branch: `feat/onshape-cad-sync-v2`
Status: REVIEWED (/plan-eng-review 2026-07-30; all decisions resolved — see GSTACK REVIEW REPORT)
Scope decisions: full 4-feature scope as stacked PRs (D2); F3 = read-only engineering
view over synced BOM data (D3); dedicated sync-state tables (D8); drawing re-pull via
known identifiers (D9); cancel is a recorded first-class action (D12/D13 + user ask).

## Context

v1 (PR #1092 + the older manual BOM sync) left two non-communicating pipelines:

- **BOM/data sync (manual):** `OnshapeSync.tsx` → `api+/integrations.onshape.sync.ts` →
  `sync` edge function. Writes `item`/`makeMethod`/`methodMaterial` and
  `externalIntegrationMapping` rows (`integration: 'onshape'` doc locator,
  `integration: 'onshapeData'` per-part BOM row JSON).
- **Released-asset sync (automatic):** `webhook.onshape.$companyId.ts` →
  `onshape-revision-sync` Inngest job; admin backfill button → `onshape-backfill`
  Inngest job. Both reuse the `onshape-sync-element.ts` / `onshape-attach.ts` core
  (GLTF/PDF export → download → attach with replace-not-append idempotency).

The asset pipeline **persists no sync state**: per-run totals live in memory and are
returned once to the Inngest run log; per-item outcomes are discarded. That single gap
is why all four v2 features are currently impossible. v2's foundation is one new
concern: **persist sync state at two granularities** (per item+asset, per run), then
hang each feature off it.

```
                    TRIGGERS                       CORE                    STATE (new tables)
  ┌────────────────────────────────┐
  │ webhook onshape.revision.created│──┐
  │ (onshape-revision-sync job)     │  │
  ├────────────────────────────────┤  │      ┌──────────────────┐   ┌──────────────────────┐
  │ backfill button → dashboard     │──┼────▶│ sync-element +   │──▶│ onshapeItemSyncState  │
  │ (onshape-backfill job)          │  │     │ attach core      │   │ (1 row per item ×     │
  ├────────────────────────────────┤  │     │ (v1, unchanged)  │   │  assetKind)           │
  │ NEW per-part re-pull button     │──┘     └──────────────────┘   └──────────┬───────────┘
  │ (onshape-item-sync job)         │                                          │
  └────────────────────────────────┘         ┌──────────────────┐              │
            backfill job also ──────────────▶│ onshapeSyncRun   │              │
            (cancel/fail terminal writes     │ (progress, hist.,│              │
             from route + onFailure)         │ unmatched, cancel)│             │
                                             └────────┬─────────┘              │
                READ SURFACES                          ▼                        ▼
  ┌─────────────────────────┐   ┌───────────────────────────┐   ┌─────────────────────────┐
  │ Part page sidebar:      │   │ Sync dashboard (settings): │   │ Engineering data page    │
  │ OnshapeBlock, all tabs  │──▶│ live BarProgress + history │   │ (items module): part/rev/│
  │ (F2) + re-pull btn (F1) │   │ + per-item table + cancel  │   │ state/mass/material/     │
  │ "Sync details" deep-link│   │ (F4)                       │   │ vendor table (F3)        │
  └─────────────────────────┘   └───────────────────────────┘   └─────────────────────────┘
```

## Goals

1. **F1 — Per-part re-pull:** a button on the part page that re-pulls that item's
   released assets from Onshape on demand (model always; drawing when its identifiers
   are known from any prior sync — D9).
2. **F2 — Onshape metadata block:** a compact section in the part page's properties
   sidebar (visible on every part tab): is this item synced, last synced when / by
   whom / from which trigger, Onshape revision + release state, per-asset outcome
   incl. skip reason, open-in-Onshape link, "Sync details" deep-link to the dashboard.
3. **F3 — Engineering data in Carbon:** an engineering-progress table (part number,
   revision, release state, mass, material, vendor, last synced) replacing the
   Onshape→Google Sheet tracker; release state webhook-fresh via the item state join
   (D11), mass/material/vendor as fresh as the last BOM sync.
4. **F4 — Sync progress + tracking:** live backfill progress (counters, phase,
   elapsed), run history, per-item sync-state table, unmatched-releases table, and a
   **recorded cancel** with cancel-before-restart semantics (D12/D13).

## Non-goals (explicitly out of scope)

- Writing Onshape mass/material/vendor into item/part/supplierPart fields (D3:
  deferred until the read-only view has proven the data; conflict rules first).
- Auto-refreshing BOM engineering data (mass/material/vendor) on webhook — those stay
  as fresh as the last manual BOM sync; release STATE is webhook-fresh via the item
  state rows and the D11 view join. Freshness timestamps visible per row.
- Drawing *discovery* from the re-pull button (D9: never-synced drawings arrive via
  webhook/backfill; the panel says so honestly).
- Any change to the v1 matching contract (`releaseKey` / `sharedNumberSuffix`) or the
  export/attach core.
- Webhook signature verification (v1 decision stands).

## Data model — two new tables (review D8/8A; migration in PR1)

No more squatting on `externalIntegrationMapping` — typed columns, composite tenant
FKs (lessons.md), proper RLS. All statuses below are TEXT with CHECK constraints
(enum-alter footguns avoided).

### `onshapeItemSyncState` — one row per item × asset kind (fixes OV#1 clobbering)

```
id            TEXT PK DEFAULT id('osis')   -- composite PK (id, companyId) per repo convention
companyId     TEXT NOT NULL
itemId        TEXT NOT NULL          -- single-column FK → item(id) (D13B: adding a
                                     -- (id, companyId) unique key to item was declined;
                                     -- tenant integrity = companyId scoping in write paths)
assetKind     TEXT NOT NULL CHECK IN ('model','drawing')
status        TEXT NOT NULL CHECK IN ('queued','running','synced','skipped','failed')
source        TEXT NOT NULL CHECK IN ('webhook','backfill','manual')
skipReason    TEXT NULL              -- 'revision-not-found'|'asset-too-large'|'ambiguous-item'|...
error         TEXT NULL
observedOnly  BOOLEAN NOT NULL DEFAULT false  -- D10: backfill saw it already-synced (v1-attached);
                                              -- lastSyncedAt = when observed, not when attached
partNumber, revision, revisionId, documentId, versionId, elementId, releaseState  TEXT NULL
modelUploadId TEXT NULL              -- what the sync attached (model rows)
documentPath  TEXT NULL              -- (drawing rows)
runId         TEXT NULL              -- backfill attribution
createdAt/createdBy, updatedAt/updatedBy (audit; createdBy = acting user:
  webhook → integration installer, backfill → run initiator, re-pull → clicking user)
UNIQUE (itemId, assetKind, companyId)
INDEX (companyId, status), INDEX (companyId, updatedAt)
```

State machine (also goes as an ASCII comment atop `onshape-sync-state.ts`):

```
            route writes            job step writes
  (none) ──▶ queued ──▶ running ──▶ synced | skipped(reason) | failed(error)
               │                        ▲
               └── stale >10min ────────┘  (read-side: UI re-enables re-pull;
                   "didn't start"           next write flips it back)
```

- Drawing identifiers persisted here are what makes D9's known-drawing re-pull work.
- Ambiguous drawing matches (2+ candidate items) are recorded at RUN level (skips
  list), never on an item row. `ambiguous-item` can only originate from the
  webhook/backfill matching paths — the re-pull's drawing arm uses persisted
  identifiers (D9), so no matching and therefore no ambiguity is possible there
  (corrected 2026-07-30 during WP4; supersedes the earlier re-pull-ambiguity line).

### `onshapeSyncRun` — one row per backfill run

```
id            TEXT PK DEFAULT id('osr')
companyId     TEXT NOT NULL          -- composite FK → company
status        TEXT NOT NULL CHECK IN ('queued','running','completed','failed','cancelled')
startedAt, finishedAt TIMESTAMPTZ NULL
pagesProcessed, revisionsScanned, matched, synced, skippedNoItem,
skippedAlreadySynced, skippedNonModel, skippedTooLarge, failed  INT NOT NULL DEFAULT 0
totalRevisions INT NULL              -- only if Onshape exposes a total (V1)
unmatchedReleases JSONB NOT NULL DEFAULT '[]'  -- [{partNumber, revision, state}] capped
                                     -- at 200 + unmatchedOverflow INT (D4/1A)
ambiguousReleases JSONB NOT NULL DEFAULT '[]'  -- capped like unmatched (D12/OV#10)
ambiguousOverflow INT NOT NULL DEFAULT 0
error         TEXT NULL
cancelledBy   TEXT NULL              -- D12: cancel route records who
createdAt/createdBy, updatedAt/updatedBy
INDEX (companyId, createdAt DESC)
```

Run lifecycle (D12/D13 — terminal states are always explicit writes):

```
  route insert          job onFailure ──▶ failed(error)
  queued ──▶ running ──▶ completed
     │           │
     │           └── cancel route: writes cancelled(cancelledBy) THEN fires
     │               carbon/onshape-backfill.cancel (cancelOn kills the run;
     │               Inngest runs no cleanup — the route write IS the record)
     └── >30min without progress writes → dashboard shows "possibly stalled" +
         "Cancel and start new" (13A). The 409 start-guard yields ONLY to
         completed/failed/cancelled — never to a heuristic.
```

Retention (D7/4A): inserting a new run deletes rows beyond the newest 50 for the
company (service-role).

RLS: SELECT for employees of the company; INSERT/UPDATE/DELETE service-role only
(routes and jobs both write via `getCarbonServiceRole()`; every query filters
`companyId` — lessons.md).

### Engineering data — write-time normalization + view (D5/2A, D11/11A)

- `extractEngineeringFields(bomRow)` — pure, case-insensitive, alias-aware
  (Deno-shared under `functions/shared/`, `deno test`-covered like
  `resolve-tracked-entity-bin.ts`); the `sync` edge function calls it when writing
  `onshapeData` rows, storing `metadata.engineering = {state, mass, material, vendor}`
  under stable keys. Unknown columns → null field; raw row still stored, so an alias
  is a one-line visible fix, never a silent hole.
- Migration (PR5): best-effort SQL backfill of `metadata.engineering` for existing
  rows, then the view:

```sql
CREATE VIEW "onshapeEngineeringData" AS
SELECT
  eim."companyId", eim."entityId" AS "itemId",
  i."readableId", i."revision", i."name",
  -- D11: webhook-fresh state wins; BOM-sync state is the fallback
  COALESCE(s."releaseState", eim.metadata->'engineering'->>'state') AS "releaseState",
  s."updatedAt"                             AS "stateSyncedAt",
  eim.metadata->'engineering'->>'mass'      AS "mass",
  eim.metadata->'engineering'->>'material'  AS "material",
  eim.metadata->'engineering'->>'vendor'    AS "vendor",
  eim."updatedAt"                           AS "bomSyncedAt"
FROM "externalIntegrationMapping" eim
JOIN "item" i ON i."id" = eim."entityId" AND i."companyId" = eim."companyId"
LEFT JOIN "onshapeItemSyncState" s
  ON s."itemId" = i."id" AND s."companyId" = eim."companyId" AND s."assetKind" = 'model'
WHERE eim."integration" = 'onshapeData';
```

Run `pnpm run generate:types` after each migration, before typecheck. Migration
timestamps forward-dated past the newest on main (lessons.md).

## Inngest write placement (D12/OV#7 — normative)

The function body replays on every step invocation, so:

- Run-progress writes: one memoized `step.run("progress-page-N")` per page — no
  throttle needed (deleted from the design), no replay re-writes.
- Item-state writes: inside the work-item step, wrapped best-effort (log, never
  throw) so bookkeeping can never fail a completed export into a retry (CRITICAL
  regression guard).
- Terminal run writes: `completed` as the final step; `failed` in `onFailure`;
  `cancelled` by the cancel route BEFORE firing the cancel event.
- `onshape-item-sync` gets the same `onFailure` → item row `failed(error)`.

## Build sequence — stacked PRs

Additive/inert first, behavior and UI later; each PR merges safely alone.

### PR1 — Sync-state foundation (migration + jobs, no UI)

- [ ] Migration: `onshapeItemSyncState` + `onshapeSyncRun` (above) + RLS +
      `pnpm run generate:types`.
- [ ] `packages/jobs/.../onshape-sync-state.ts`: pure builders + service-role
      write helpers (`upsertItemSyncState`, `writeRunProgress`, `finalizeRun`) +
      `isStalled` (item: 10min since `queued`; run: 30min since last progress
      write — warning-only, D13) + the state-machine ASCII comment.
- [ ] `onshape-revision-sync.ts`: upsert item state rows per asset kind (source
      `'webhook'`); ambiguous drawing matches recorded nowhere item-level.
- [ ] `onshape-backfill.ts`: accept `runId`; per-page memoized progress step;
      item state upserts per work item (source `'backfill'`); **already-synced
      matches get `observedOnly` state rows (D10)**; unmatched + ambiguous release
      capture (capped 200 + overflow count); `completed` final step; `onFailure` →
      `failed`; `cancelOn: carbon/onshape-backfill.cancel` matched on `runId`.
- [ ] `packages/lib/src/events.ts` + `trigger.ts`: `onshape-backfill` payload gains
      optional `runId` (legacy events without it run with tracking disabled);
      new `carbon/onshape-item-sync` + `carbon/onshape-backfill.cancel` events.
- [ ] `api+/integrations.onshape.backfill.ts`: insert `queued` run row (service
      role), 409 unless the latest run is `completed`/`failed`/`cancelled`,
      retention delete beyond 50, trigger with `runId`.
- [ ] `api+/integrations.onshape.backfill.cancel.ts`: permission-gated; writes
      `cancelled` + `cancelledBy`, then fires the cancel event (D12; user ask).
- [ ] Unit tests: builder shapes (synced/skipped/failed, null revision fields);
      counter accumulation; unmatched cap + overflow accuracy; `isStalled`
      boundaries + live-run flip-back; **CRITICAL: a throwing state writer does not
      fail the enclosing sync step**; legacy no-`runId` event runs untracked;
      run-transition guards (no `completed` after `cancelled`).

### PR2 — Per-part re-pull (F1, job + route; button lands with the panel in PR3)

- [ ] `onshape-item-sync.ts` Inngest job, event `carbon/onshape-item-sync`
      `{ companyId, userId, itemId }`. Steps: asset-sync gate → load item scoped by
      `companyId` → resolve `onshapeCompanyId` → **model:**
      `getRevisions(onshapeCompanyId, partNumber, modelElementTypes)`, pick the
      revision matching the item's revision letter (V3) → v1 sync core →
      state row. **Drawing (D9):** only if the item's drawing state row has
      identifiers — re-export from those; else no drawing attempt (panel copy
      explains discovery runs via release sync/backfill).
      Config: `retries: 3`, concurrency key `event.data.itemId` limit 1,
      `withRateLimitRetry`, `onFailure` → item row `failed(error)`.
- [ ] Revision-not-found / no-longer-released → `skipped` with reason, never a
      retry loop; re-pull ambiguous drawing → `skipped/ambiguous-item` on the row.
- [ ] `api+/integrations.onshape.item-sync.$itemId.ts` (POST): `requirePermissions`
      `update: 'parts'`, integration + `assetSyncEnabled` gates, `companyId`
      ownership check, service-role `queued` row write, trigger. Generic single
      message for not-found vs not-authorized.
- [ ] Unit tests: revision-selection (pure); drawing-arm gating on identifier
      presence; route 403/404 indistinguishability.

### PR3 — Onshape sidebar block (F2 + F1's button; design revised 2026-07-30)

Decision (user, supersedes the earlier details-page card): the F2 surface is a
**compact block in the properties sidebar** (`PartProperties.tsx`, ~line 676 next to
the Methods section) — visible on every part tab, not just Details. Deep detail
(long error text, history) lives on the PR4 dashboard's per-item table; the block
deep-links there. No details-page card.

- [ ] `getOnshapeItemState(client, itemId, companyId)` in
      `apps/erp/app/modules/items/items.service.ts`: item state rows (both asset
      kinds) + the `onshape`/`onshapeData` mapping rows → block view model. Single
      bulk queries — `entityId` is polymorphic on the mapping table (no FK, no
      PostgREST embed); the new tables join properly.
- [ ] `OnshapeBlock.tsx` in `apps/erp/app/modules/items/ui/Item/`: sidebar section
      in `PartProperties.tsx` (both `layout` variants, hidden when `embedded`),
      gated `useIntegrations().has('onshape')`. Contents: one status line per asset
      kind (Model / Drawing: status badge + relative last-synced + short skip
      reason), Onshape revision + `OnshapeStatus` release badge, synced-by + source,
      `observedOnly` as "observed already synced", stale-queued → "sync did not
      complete — try again", open-in-Onshape link (documentId/versionId/elementId
      when present), **Pull from Onshape** button (disabled while queued/running),
      and a "Sync details" link → PR4 dashboard filtered to the item (long error
      text lives there, tooltip-truncated here).
- [ ] In-flight polling: 2s fetcher (`ModelConvertProgress` pattern), stop on
      terminal; toast on failure.
- [ ] Data: the properties panel's existing item fetch gains the state query
      (deferred), so the block renders on every tab without per-tab loader changes.
- [ ] UI copy: product facts only ("CAD", "Onshape", "Version Unknown"-style
      neutral copy) — no job/table names on screen. i18n via Lingui.

### PR4 — Backfill progress + sync dashboard (F4)

- [ ] `api+/integrations.onshape.backfill-status.ts`: current + recent runs.
- [ ] `x+/settings+/integrations.onshape.sync.tsx` (nests under `integrations.tsx`
      Outlet): the sync dashboard.
      - Layout, states, actions, and copy per the **UI design spec** (pinned IA:
        header Start button + one live-run Card + Tabs Items/Runs/Release
        exceptions; five named counters; confirmed Cancel writing the recorded
        state; Start new sync on terminal runs; per-row "Sync again"; stalled
        (>30min) shows "No progress for 30 minutes" + Cancel — start stays
        blocked until an explicit terminal state, D13).
      - BarProgress determinate iff `totalRevisions` (V1); run history last 50
        (bounded by retention) with status, initiator, duration, counters,
        cancelledBy; Items tab over `onshapeItemSyncState` (item link, asset
        kind, status chip, source label, skip reason, last synced at/by;
        filterable; standard Table → CSV export free); Release exceptions tab =
        unmatched + ambiguous merged with a reason column (+ "and N more").
      - `useInterval` revalidate 2s while a run is live, else off; focus/scroll
        preserved per the design spec.
- [ ] Integration drawer: "View sync dashboard" link action next to backfill
      (extend `IntegrationForm` with a `link` action kind, declared in
      `packages/ee/src/onshape/config.tsx`); backfill start redirects to the
      dashboard.
- [ ] Update `.ai/playbooks/onshape-asset-sync.md` with the new surfaces.

### PR5 — Engineering data page (F3)

- [ ] `extractEngineeringFields` (Deno-shared) + `deno test` coverage; wired into
      the `sync` edge function's onshape case.
- [ ] Migration: `metadata.engineering` backfill + `onshapeEngineeringData` view
      (D11 COALESCE join) + `pnpm run generate:types`.
- [ ] `getOnshapeEngineeringData` service fn (items module) with standard
      filters/sort/pagination.
- [ ] `x+/items+/engineering.tsx`: Table page in the Items sidebar group
      (module = items, permission `parts_view`) per the **UI design spec**:
      part (link), revision, release-state chip (webhook-fresh), mass, material,
      vendor, **Data synced** + **State synced** columns (two visible relative
      timestamps — D11/8B), both in CSV export, "—" for nulls. Empty state links
      to the BoM Explorer's Onshape panel.
- [ ] i18n via Lingui; /translate for .po files.

## Edge cases

- **Stale in-flight states (D6/3A + D13):** shared read-side heartbeat in the state
  helper, keyed on the row's `updatedAt` (falling back to `createdAt` for
  never-updated `queued` rows — there is no separate lastSyncedAt column).
  Items: `queued` >10min reads stalled → panel re-enables re-pull. Runs:
  >30min without progress writes shows a WARNING + "Cancel and start new"; the 409
  guard yields only to explicit terminal states — two live backfills are
  unreachable by construction.
- **Backfill double-start:** 409 while the latest run lacks a terminal status.
- **Re-pull on an item with no Onshape revision:** `skipped/revision-not-found`,
  visible in the panel — not an error toast, not a retry.
- **Re-pull racing the webhook for the same item:** both funnel into the attach
  core's replace-not-append idempotency; concurrency keys (`elementId` webhook,
  `itemId` item-sync) serialize per entity; the state row records which trigger won.
- **Ambiguous drawing match:** run-level record for webhook/backfill; item-level
  `skipped/ambiguous-item` only from user-initiated re-pull (D12/OV#10).
- **Multi-tenancy:** every job/route/service query filters `companyId`; composite
  tenant FKs on both new tables; RLS SELECT company-scoped, writes service-role.
- **Old queued events after deploy** (no `runId`): backfill runs untracked.
- **Company with zero Onshape-linked items:** run completes with zero counters;
  dashboard shows the honest empty run.
- **Pre-v2 fleet (D10):** first backfill writes `observedOnly` rows for
  already-synced items — panel/dashboard truthful without re-downloading.

## Testing

**CRITICAL (regression guard, PR1):** state bookkeeping must be non-fatal to the
sync. Wrap every sync-state/progress write best-effort (log, never throw) and prove
via `onshape-sync-state.test.ts` that a throwing writer does not fail the enclosing
sync step — otherwise a bookkeeping error makes Inngest retry (re-run) an
already-successful sync. This is the only path that can break shipped v1 behavior.

Unit (vitest, colocated like `onshape-matching.test.ts`): as itemized per PR above —
builders, cap/overflow, `isStalled` boundaries, run-transition guards (no
`completed` after `cancelled`), revision selection, drawing-arm gating, legacy
event shape, route 403/404 indistinguishability, 409-yields-only-to-terminal.

Deno (`deno test`): `extractEngineeringFields` — standard names, case variants,
aliases, missing columns → null (never throw), non-string coercion.

Browser (/test playbooks — `.ai/playbooks/onshape-asset-sync.md`, updated in the PR
shipping each surface):

- [→E2E] Re-pull: click → queued badge → synced + refreshed timestamps; double-click
  no-ops (disabled button, idempotent queued write); skip renders reason inline;
  navigate-away-and-back shows persisted state.
- [→E2E] Backfill: start → redirect → counters advance → terminal + history row;
  double-start blocked with clear copy; **cancel finalizes as cancelled with the
  canceller recorded and unblocks a new start**; stalled warning appears with
  "Cancel and start new".
- [→E2E] Panel + engineering page: never-linked empty state; skipped-with-reason;
  stalled affordance; engineering zero-rows empty state; "—" for null
  mass/material/vendor; CSV export.

Validation per PR: `pnpm exec turbo run typecheck --filter=@carbon/jobs
--filter=erp`, `pnpm run lint`, `pnpm run test`; `pnpm run generate:types` after
each migration before typechecking.

## Verify items (before/while building)

- **V1:** does `GET /revisions/companies/{cid}` return a total count usable as a
  progress denominator? (determinate vs indeterminate bar)
- **V2:** BOM column names in real `onshapeData` metadata ("Part number", "State",
  "Mass", "Material", "Vendor"?) — confirm against live rows before finalizing the
  extraction alias table.
- **V3:** `getRevisions(companyId, partNumber, elementType)` semantics for the
  MODEL arm: all revisions for the part number, with revision letter +
  documentId/versionId/elementId in the response? (Drawing arm no longer depends on
  this — D9.)
- **V4:** worst-case Inngest retry backoff for `retries: 10` — confirm 30min stall
  warning threshold comfortably exceeds a normal inter-attempt gap (warning-only
  either way, D13).

## Rollout

- No new feature flag: PR1/PR2 are inert without UI; PR3–PR5 surfaces gate on the
  integration + `assetSyncEnabled`.
- Migrations are additive; rollback = revert the PR (no destructive DDL).
- After deploy, run one backfill per company to heal pre-v2 history (D10).
- Update `.claude/rules/event-system.md`, `packages/jobs/AGENTS.md`, and the
  playbook in the PRs that change those subsystems (keep-sources-in-sync rule).

## UI design spec (from /plan-design-review 2026-07-30 — NORMATIVE for WP5–WP7)

All decisions below are locked (design-review issues 1–8). Packets implement TO
this spec; ds-rules bindings named here are requirements, not suggestions.

### OnshapeBlock (PR3) — one job: current CAD sync status

Pinned line order (both PartProperties layout variants, hidden when `embedded`):

1. `h3` header `Onshape` (the Files/Methods `text-xs text-muted-foreground` idiom)
2. Revision + `OnshapeStatus` release chip + open-in-Onshape `LuExternalLink`
   (the hover pattern of the 3D Model badge, `PartProperties.tsx:250-263`)
3. Model row: item-status chip + relative time
4. Drawing row: item-status chip + relative time
5. Muted line: "Synced by {name} · {source label}"
6. Footer `HStack`: **Pull from Onshape** (`Button variant="secondary" size="sm"`,
   `LuRefreshCw`) + **Sync details** (`link` variant; render-gated until the PR4
   route exists — un-gated in PR4's diff)

Never-linked (no mapping and no state rows — the most common state): header + one
muted "Not linked to Onshape" line, NO pull button (the button appears once a
mapping or state row exists; linking a new part stays in the BoM Explorer panel).
Loading (deferred fetch): one skeleton line, no layout shift. Long errors and
provenance detail live on the dashboard, never in the block.

### Shared status → component mapping (PR3 + PR4, one source)

- Item status → `Status` chip: synced→`green` "Synced" · running→`blue` "Syncing"
  · queued→`gray` "Queued" · skipped→`yellow` "Skipped" · failed→`red` "Failed"
- Run status → `Status` chip: completed→`green` "Completed" · running→`blue`
  · queued→`gray` · cancelled→`gray` "Cancelled" · failed→`red` "Failed"
- Partial success is never silent: a completed run with `failed > 0` renders a
  `red` chip "N failed" beside the green chip, deep-linking to the Items tab
  pre-filtered to `status=failed`.
- Chips carry the color; prose stays `text-muted-foreground` (ds-rules law).

### Copy (all via Lingui; wire codes never reach the screen)

- Skip reasons: `revision-not-found`→"No released revision found" ·
  `asset-too-large`→"File too large to sync" · `ambiguous-item`→"Matches more
  than one part" · unknown→"Skipped" (raw detail only in the dashboard row detail)
- Sources: webhook→"Automatic" · backfill→"Bulk sync" · manual→"Manual"
- Stall warning: "No progress for 30 minutes" (not "possibly stalled")
- `observedOnly`: "Existing attachment confirmed"
- Cancel confirm: "Cancel this sync? Items already synced are kept. This action
  is recorded."

### Sync dashboard (PR4) — pinned IA

- **Header:** page title + **Start sync** (`primary`, permission-gated; disabled
  with tooltip while a run is live per the 409 rule). The dashboard can start a
  sync — it is not watch-only.
- **Top: ONE Card** — run-status chip, `BarProgress`, elapsed, five inline
  label-over-number counters (`tabular-nums`): Scanned (`revisionsScanned`),
  Matched, Synced, Skipped (sum; `Tooltip` breakdown "already synced / no
  matching part / not a model / too large"), Failed. `pagesProcessed` stays
  internal. Run action in the card: **Cancel sync**
  (`Button variant="destructive" size="sm"` → confirm `Modal`) while running;
  after the cancelled state lands, the card shows the gray chip + "Cancelled by
  {name} · {relative time}", then yields to **Start new sync** (`secondary`).
  Failed latest run → same Start new sync affordance. Never one combined
  cancel-and-restart control. Idle: the card collapses to the latest run's
  summary line. **Banned:** boxed KPI metric cards, card-per-section chrome,
  decorative shadows.
- **Below: `Tabs`** — **Items** (default; standard `~/components` Table; row
  action "Sync again" on failed/skipped model rows posting to the PR2 item-sync
  route) · **Runs** (history, last 50) · **Release exceptions** (unmatched +
  ambiguous merged into one table with a reason column).
- Per-tab empty states: Items — "No synced items yet — run a sync to populate
  this table"; Runs — "No syncs have run yet"; zero-state page leads with Start.
- Polling failure: keep last data + muted "Live updates paused — retrying".

### Deep-link contract (block ↔ dashboard)

`path.to` helper for `/x/settings/integrations/onshape/sync`; Items tab default;
`?filter=itemId:eq:{id}` per Table filter conventions. Defined in PR3, implemented
by PR4; PR3 renders the link only when the route exists.

### Engineering page (PR5)

Columns: part (link) · revision · release-state chip · mass · material · vendor ·
**Data synced** (`bomSyncedAt`, relative) · **State synced** (`stateSyncedAt`,
relative) — two visible timestamp columns (user decision, design-review D11/8B);
both in the CSV export. Nulls render "—". Empty state links to the BoM Explorer's
Onshape panel where a BOM sync is actually run.

### Accessibility & responsive (all surfaces)

- Errors: short visible reason inline everywhere; full error text in the Items
  tab's row detail (assistive-technology accessible). Tooltips are enrichment,
  never the only path to essential content.
- Live polling preserves focus and scroll — revalidation swaps data, never
  remounts the table.
- Narrow widths: declared column priority (part + status always visible;
  source/timestamp columns collapse first); tables overflow-scroll in their own
  container.
- Row actions keyboard-reachable; `IconButton`s carry `aria-label`; block footer
  buttons meet 44px touch targets.

### Interaction-state table

```
FEATURE          | LOADING          | EMPTY                  | ERROR                       | SUCCESS            | PARTIAL
-----------------|------------------|------------------------|-----------------------------|--------------------|------------------------
OnshapeBlock     | skeleton line    | "Not linked to Onshape"| failed chip + short reason  | chips + rel. times | per-asset chips diverge
Dashboard card   | latest-run line  | Start-sync lead        | red chip + error + restart  | green + counters   | green + red "N failed"
Items tab        | table skeleton   | "No synced items yet…" | row detail w/ full error    | synced rows        | mixed chips, filterable
Runs tab         | table skeleton   | "No syncs have run yet"| failed rows, red chip       | history rows       | "N failed" chip on row
Engineering page | table skeleton   | links to BoM Explorer  | —                           | data rows          | "—" for null fields
```

## Execution protocol — subagent dispatch (Opus builds, Fable reviews)

How this plan gets built: each work packet below is dispatched to a cheaper Opus
subagent as a self-contained brief; Fable reviews every diff against the reviewer
checklist before it lands. One packet per subagent, in PR order. Packets never
re-decide anything — all decisions (D2–D13) are resolved above; a packet that hits
an unlisted decision STOPS and reports back instead of inventing.

**Every packet's brief includes, verbatim:**

1. This plan file path (`.ai/plans/2026-07-30-onshape-cad-sync-v2.md`) + the packet's
   PR section as the spec. The Data model and "Inngest write placement" sections are
   normative — copy shapes from there, don't redesign.
2. Read-first list (below per packet) — the subagent reads these BEFORE writing code
   and mirrors their idioms exactly.
3. Standing rules: descriptive variable names (no single letters anywhere, including
   callbacks); delete code without tombstone comments; every query filters
   `companyId`; service-role for all new-table writes; generic not-found/not-authorized
   messages; no vendor/wire detail in UI copy; pnpm only; `pnpm run generate:types`
   after any migration BEFORE typecheck; migration timestamps forward-dated past
   newest on main; Lingui for all user-facing strings.
4. Verification commands the packet must run and paste output from (its PR section's
   validation lines). No "done" without evidence.

### Work packets

**WP1 (PR1a) — Migration.** Read first: `20260128140000_external-integration-mapping.sql`
(RLS/index style), `20260703143904_composite-tenant-fks.sql` (composite FK pattern),
`.claude/rules/workflow-database-migration.md`, `conventions-database.md`.
Produce: the two-table migration exactly as the Data model section specifies +
regenerate types. Verify: `pnpm db:migrate` locally green, generated types compile.

**WP2 (PR1b) — State helpers + job wiring.** Read first: `onshape-backfill.ts`,
`onshape-revision-sync.ts`, `company-export.ts:236-330` (marker-writer idiom being
replaced by step-scoped writes), `packages/lib/src/{events,trigger}.ts`,
`.claude/rules/event-system.md`. Produce: `onshape-sync-state.ts` (+ state-machine
ASCII comment + tests), both jobs' state writes per "Inngest write placement",
event payload changes, `cancelOn` + `onFailure`. The CRITICAL non-fatal-writes test
is the acceptance gate.

**WP3 (PR1c) — Backfill trigger + cancel routes.** Read first:
`integrations.onshape.backfill.ts` (current shape), `settings.backup-export-status.ts`,
`.claude/rules/authentication-system.md`. Produce: run-row insert/409/retention in
the trigger route + the cancel route (writes `cancelled` + `cancelledBy` BEFORE
firing the event) + route tests.

**WP4 (PR2) — Item-sync job + route.** Read first: `onshape-revision-sync.ts`
(the model to mirror), `onshape-matching.ts` + its test, `client.ts:263-353`
(`getRevisions`, `getParts`). Produce: per PR2 section. V3 verify item is part of
this packet: probe `getRevisions` response shape first, paste findings into the PR
description.

**WP5 (PR3) — Sidebar block + service fn.** Read first: the **UI design spec
section above (normative)**, `PartProperties.tsx:236-357` + `:346-357` + `:676-725`
(section idiom + both layout variants + the Methods block it sits beside),
`SelectedItemProperties.tsx:14-126` (dispatch), `ModelConvertProgress.tsx:38-142`
(poll idiom), `useIntegrations.ts`, `.claude/rules/conventions-ui.md`. Produce: per
PR3 section + the design spec's block line order, states, and copy maps.

**WP6 (PR4) — Dashboard + status route.** Read first: the **UI design spec
section above (normative — pinned IA, tabs, counters, recovery actions, cancel
modal)**, `x+/settings+/backups.tsx` + `BackupProgressModal.tsx` (progress UI to
copy), `x+/settings+/integrations.tsx` + `integrations.$id.tsx` (nesting),
`IntegrationForm.tsx:43-111` (action rendering),
`.claude/rules/table-csv-export.md`. Produce: per PR4 section + the design spec.

**WP7 (PR5) — Engineering data.** Read first: `sync/index.ts:176-763` (the onshape
case being extended), `resolve-tracked-entity-bin.ts` + its deno test (shared-fn
idiom), an existing Table list page under `x+/items+/`, `bom.ts:67-83` (the header
flattening that produces the keys). Produce: per PR5 section. V2 verify item (real
BOM key names) is part of this packet — check live `onshapeData` rows first.

### Fable's reviewer checklist (applied to every packet diff)

- [ ] Every new query filters `companyId`; new-table writes are service-role; RLS
      matches the plan (SELECT company-scoped, writes service-role only).
- [ ] State writes are non-fatal + correctly placed in step topology (no body-level
      writes that replay; no bookkeeping inside an export step that can fail it).
- [ ] Terminal states only from explicit writes (route cancel / onFailure / final
      step) — never inferred.
- [ ] Idioms match the read-first files (naming, form validators, flash/toast,
      Lingui) — not generic React/Node style.
- [ ] Standing rules from the brief (names, no tombstones, generic errors, UI copy).
- [ ] Tests listed for the packet exist and fail meaningfully when the guarded
      behavior is broken (spot-check by mutating).
- [ ] AGENTS.md / rules / playbook updated when the packet touches their subsystem.
- [ ] Diff is right-sized: nothing outside the packet's PR section.

## NOT in scope (considered and deferred)

- **Mass/material/vendor → real item/part/supplierPart fields** — deferred (D3):
  needs per-field conflict rules before Onshape may write production data.
- **Webhook-driven BOM/engineering refresh** — deferred: requires choosing which
  assembly BOM to re-sync per release; manual BOM sync remains the mass/material
  source, honestly timestamped.
- **Drawing discovery from the re-pull button** — deferred (D9): quota-heavy
  company-revision scan for a rare case; webhook/backfill own discovery.
- **Details-page Onshape card** — dropped (user decision, 2026-07-30): the sidebar
  block is the primary F2 surface; the dashboard per-item table is the detail view.
  A card next to `CadModel` adds a duplicated surface with no content that doesn't
  fit the sidebar + dashboard split.
- **Inngest run-status API integration for the stall guard** — rejected (D13):
  cancel-before-restart makes it unnecessary.
- **Inngest Realtime for progress** — rejected (Step 0): persisted run history +
  per-item state need DB rows anyway; poll-while-active covers the live view.
- **Generic multi-integration syncRun table** — rejected (D8): premature
  abstraction; revisit if a second integration needs run history.

## What already exists (reused, not rebuilt)

- Export→download→attach core: `onshape-sync-element.ts` / `onshape-attach.ts`
  (replace-not-append idempotency) — reused untouched by all three triggers.
- Matching contract: `releaseKey` / `sharedNumberSuffix` (`onshape-matching.ts`,
  unit-tested) — unchanged.
- Rate limiting: `withRateLimitRetry` (429 → `RetryAfterError`) — reused.
- Progress-UI vocabulary: `BarProgress` + phase checklist
  (`BackupProgressModal.tsx`), adaptive `useInterval` revalidation
  (`assembly+/$id.tsx:425-441`), poll-status routes
  (`settings.backup-export-status.ts`) — copied patterns.
- Panel slots: `$itemId.details.tsx` card stack (next to `CadModel`),
  `PartHeader` dropdown, integration drawer actions (`IntegrationForm.tsx`).
- BOM data already stored: `onshapeData` mapping rows carry full Onshape BOM rows;
  F3 reads them instead of re-pulling from Onshape.
- `OnshapeStatus` badge, `useIntegrations`, `getOnshapeClient` token refresh.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~1d / CC: ~45min)** — database — Create `onshapeItemSyncState` + `onshapeSyncRun` tables with composite tenant FKs and service-role-write RLS
  - Surfaced by: Outside voice #9 / D8 — mapping-table squat had no UPDATE policy and untyped counters
  - Files: packages/database/supabase/migrations/, generated types
  - Verify: `pnpm db:migrate` + `pnpm run generate:types` + scoped typecheck
- [ ] **T2 (P1, human: ~1d / CC: ~1h)** — jobs — State helpers with non-fatal writes placed per Inngest step topology
  - Surfaced by: Test review CRITICAL regression guard + Outside voice #7 / D12
  - Files: packages/jobs/src/inngest/functions/integrations/onshape-sync-state.ts (+test), onshape-backfill.ts, onshape-revision-sync.ts
  - Verify: `pnpm run test` — throwing writer must not fail the sync step
- [ ] **T3 (P1, human: ~0.5d / CC: ~30min)** — jobs+routes — Explicit terminal states: cancel route writes `cancelled`+`cancelledBy`, `onFailure` writes `failed`
  - Surfaced by: Outside voice #5 / D12 + user cancel requirement
  - Files: api+/integrations.onshape.backfill.cancel.ts, onshape-backfill.ts, onshape-item-sync.ts
  - Verify: cancel E2E in playbook; unit transition guards
- [ ] **T4 (P2, human: ~0.5d / CC: ~20min)** — jobs+ui — Stall detection warning-only; 409 yields solely to explicit terminal states (cancel-before-restart)
  - Surfaced by: Code quality finding 3 / D6 + Outside voice #8 / D13
  - Files: onshape-sync-state.ts (isStalled), api+/integrations.onshape.backfill.ts, dashboard route
  - Verify: isStalled boundary tests; 409 test
- [ ] **T5 (P2, human: ~1d / CC: ~45min)** — jobs — Re-pull job: model via getRevisions, drawing only from persisted identifiers
  - Surfaced by: Outside voice #2 / D9 — drawing part numbers differ from part part numbers
  - Files: onshape-item-sync.ts (+test), api+/integrations.onshape.item-sync.$itemId.ts
  - Verify: revision-selection + drawing-gating unit tests; V3 probe pasted in PR
- [ ] **T6 (P2, human: ~2h / CC: ~10min)** — jobs — `observedOnly` state rows for already-synced backfill matches
  - Surfaced by: Outside voice #3 / D10 — pre-v2 fleet would show "never synced" forever
  - Files: onshape-backfill.ts scan step
  - Verify: unit test on scan-step upserts; post-deploy backfill heals history
- [ ] **T7 (P2, human: ~2h / CC: ~15min)** — jobs — Capped unmatched + ambiguous release capture on the run row
  - Surfaced by: Architecture finding 1 / D4 + Outside voice #10 / D12
  - Files: onshape-sync-state.ts, onshape-backfill.ts, dashboard route
  - Verify: cap + overflow-count unit tests
- [ ] **T8 (P2, human: ~1d / CC: ~45min)** — edge-fn+db — Write-time `extractEngineeringFields` + metadata backfill + COALESCE view joining webhook-fresh state
  - Surfaced by: Architecture finding 2 / D5 + Outside voice #4 / D11
  - Files: packages/database/supabase/functions/shared/extract-engineering-fields.ts (+deno test), sync/index.ts, PR5 migration
  - Verify: deno test; view precedence test against seeded rows
- [ ] **T9 (P2, human: ~1h / CC: ~5min)** — routes — Run-history retention: keep newest 50 per company
  - Surfaced by: Performance finding 4 / D7
  - Files: api+/integrations.onshape.backfill.ts
  - Verify: unit test on retention delete
- [ ] **T10 (P2, human: ~1d / CC: ~45min)** — ui — OnshapeBlock in the properties sidebar (not a details card) + dashboard deep-link
  - Surfaced by: User design decision 2026-07-30 (supersedes details-page card)
  - Files: apps/erp/app/modules/items/ui/Item/OnshapeBlock.tsx, PartProperties.tsx, items.service.ts
  - Verify: /test playbook — block on every part tab, re-pull flow, deep-link

Design-review tasks (all fold into WP5–WP7 builds; spec in the UI design spec section):

- [ ] **DT1 (P1, human: ~1d / CC: ~30min)** — dashboard IA — live-run Card + header Start + Tabs (Items/Runs/Release exceptions); metric cards banned (design issue 1/1A)
- [ ] **DT2 (P1, human: ~0.5d / CC: ~20min)** — OnshapeBlock — pinned 6-line order; never-linked = muted line, no pull button (issue 2/2A)
- [ ] **DT3 (P1, human: ~0.5d / CC: ~20min)** — shared UI maps — status→Status chip, skip-reason + source Lingui copy maps, interaction-state table (issue 3/3A)
- [ ] **DT4 (P1, human: ~0.5d / CC: ~20min)** — recovery — Start new sync on terminal runs, per-row Sync again, confirmed Cancel + post-cancel state (issue 4/4A)
- [ ] **DT5 (P2, human: ~1h / CC: ~10min)** — copy — honest stall/observed copy, source labels, red "N failed" chip on completed runs (issue 5/5A)
- [ ] **DT6 (P2, human: ~0.5d / CC: ~15min)** — a11y/responsive — visible inline errors + row-detail full text, focus-safe polling, column priority, 44px targets (issue 6/6A)
- [ ] **DT7 (P2, human: ~1h / CC: ~5min)** — deep-link contract — path.to helper + itemId filter param in PR3, link gated until PR4 (issue 7/7A)
- [ ] **DT8 (P2, human: ~1h / CC: ~10min)** — engineering table — Data synced + State synced visible columns, both in CSV (issue 8/8B, user override)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAN (PLAN) | 22 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAN (FULL) | score: 6/10 → 9/10, 8 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** Eng outside voice (Claude subagent; Codex timed out) raised 10
  findings, all resolved (D8–D13: dedicated tables, drawing re-pull from persisted
  identifiers, explicit terminal states, step-scoped writes, observed-only
  backfill, webhook-fresh view join). Design outside voices (Codex + Claude
  subagent, 24 findings, heavy convergence) drove 8 locked design decisions —
  7 recommended options accepted, 1 user override (two visible timestamp columns
  on the engineering page).
- **VERDICT:** ENG + DESIGN CLEARED — ready to implement (dispatch WP1–WP7 per the
  Execution protocol; the UI design spec section is normative for WP5–WP7; Fable
  reviews each packet).

NO UNRESOLVED DECISIONS
