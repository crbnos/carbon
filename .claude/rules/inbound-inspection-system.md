---
paths:
  - "apps/erp/app/modules/quality/ui/InboundInspections/**"
  - "apps/erp/app/modules/quality/quality.{server,service,models}.ts"
  - "apps/erp/app/routes/x+/inbound-inspection+/**"
  - "packages/database/supabase/migrations/*inbound-inspection*.sql"
  - "packages/database/supabase/functions/post-receipt/index.ts"
---

# Inbound Inspection System

Receiving-side quality gate. When a receipt is posted, a **lot-level** inspection is
created for each received line whose item has `requiresInspection = true`. Two
execution flows (spec `.ai/specs/2026-07-21-inbound-inspection-execution.md`):

- **Document-driven** (item has a Receipt-usage `inspectionDocument` assignment):
  full-screen split view at `/x/inbound-inspection/{id}` — ballooned PDF beside a
  features × samples measurement grid. Readings auto-valuate against live
  tolerances; sample status is **derived** (strict, no override); per-feature
  AQL sampling (feature rule → `itemSamplingPlan` → All).
- **Fallback** (no assigned document): manual per-sample Pass/Fail, lot-level
  sampling — the original flow, now inside the same full-screen route.

Disposition (Accept / Reject / Partial) is always a human decision; Reject can
auto-create an NCR whose description includes the failed characteristics.

## Data model (newest migration wins)

The shipped schema is the **Phase 2 rebuild** in `20260419163058_inbound-inspection-sampling.sql`,
which `DROP ... CASCADE`s the original Phase-1 `inboundInspection` table from
`20260419094132_inbound-inspections.sql` and recreates it lot-based. Don't trust the
Phase-1 shape (it was per-tracked-entity with `trackedEntityId`/`inspectedBy` columns).

- `item.requiresInspection` BOOLEAN (default false) — added `20260419094132`.
- `companySettings.samplingStandard` enum `samplingStandard` (`ANSI_Z1_4` | `ISO_2859_1`,
  default `ANSI_Z1_4`) and `companySettings.enforceInspectionFourEyes` BOOLEAN.
- `itemSamplingPlan` (PK = **`itemId`** only, not composite) — per-item plan, created lazily:
  `type` (`samplingPlanType`: All/First/Percentage/AQL), `sampleSize`, `percentage`,
  `aql`, `inspectionLevel` (I/II/III/S1–S4), `severity` (Normal/Tightened/Reduced).
- `inboundInspection` (lot level, PK = `id`) — `inboundInspectionId` (human id, `II` seq,
  unique per company), `receiptLineId` (**unique** — one lot per receipt line), `receiptId`,
  `itemId`, `itemReadableId`, `supplierId`, `lotSize`, snapshot of the resolved plan
  (`samplingStandard`, `samplingPlanType`, `sampleSize`, `acceptanceNumber`,
  `rejectionNumber`, `aql`, `inspectionLevel`, `severity`, `codeLetter`),
  `status` (`inboundInspectionStatus`: Pending/In Progress/Passed/Failed/Partial),
  `dispositionedBy`/`dispositionedAt`. **No `itemTrackingType` column** — joined from `item`.
- `inboundInspectionSample` — one row per recorded result: `inboundInspectionId`,
  `trackedEntityId` (**nullable** since `20260612151947`), `status`
  (`inboundInspectionSampleStatus`: Pending/Passed/Failed), `inspectedBy`/`inspectedAt`.
  A **partial** unique index `inboundInspectionSample_trackedEntityId_key WHERE trackedEntityId
  IS NOT NULL` keeps a serial entity sampleable once while allowing many anonymous samples.
- `inboundInspectionHistory` — one row per disposition (skeleton for future plan auto-switching).
- `nonConformanceInboundInspection` (`20260421091238`) — links an auto-created NCR back to
  the inspection (unique `(nonConformanceId, inboundInspectionId)`).

Execution-layer tables (`20260722040401_inbound-inspection-execution.sql`):

- `inboundInspection.inspectionDocumentId` — **live** reference to the assigned
  `inspectionDocument` (ON DELETE SET NULL); no feature snapshot.
- `itemInspectionDocumentAssignment` — PK `(itemId, usage)`; `usage` enum
  `inspectionDocumentUsage` (v1: only `'Receipt'`; FAI/Production are additive
  enum values later). Edited on the item Quality tab (`ItemQualityView`).
- `inspectionFeature` gained six nullable per-feature sampling columns
  (`samplingPlanType/SampleSize/Percentage/Aql/InspectionLevel/Severity`);
  NULL = inherit `itemSamplingPlan`. Persisted through the
  `save_inspection_document_atomic` fork in the same migration (newest def).
- `inboundInspectionFeature` — per-lot per-feature **resolved** plan
  (`sampleSize`, `acceptanceNumber`, `rejectionNumber`, `codeLetter`), unique
  `(inboundInspectionId, inspectionFeatureId)`. Created at receipt; lazily
  reconciled by the `$id` loader for features added to the live document later.
- `inboundInspectionMeasurement` — one reading per `(sampleId, featureId)`
  (unique): `value NUMERIC` (NULL for attribute features), `status`
  (`inboundInspectionSampleStatus` — the valuation at entry; tolerance edits
  never rewrite recorded statuses), `notes`, `inspectedBy/At`.

RLS on all tables: standard SELECT/INSERT/UPDATE/DELETE gated by `quality_view/create/update/delete`.

## Receipt → inspection flow (`post-receipt/index.ts`, Supabase edge fn)

`packages/database/supabase/functions/post-receipt/index.ts` (inserts ~line 700):
1. Loads items (`id, itemTrackingType, requiresInspection`), company `samplingStandard`,
   `itemSamplingPlan` rows, Receipt-usage `itemInspectionDocumentAssignment` rows, and the
   assigned documents' `inspectionFeature` rows.
2. Per receipt line whose item `requiresInspection` and `receivedQuantity > 0`: resolves the
   lot plan via `resolveSamplingPlan(plan, lotSize, standard)` from
   `packages/database/supabase/functions/shared/sampling-engine.ts` (ANSI Z1.4 / ISO 2859-1
   tables; returns `{ sampleSize, acceptance, rejection, codeLetter }`). No configured plan →
   defaults to `type: "All"`, level `II`, `Normal`. When a document is assigned, also resolves
   **each feature** via `resolveFeatureSamplingPlan(feature, itemPlan, lotSize, standard)`
   (feature rule → item plan → All), stamps `inspectionDocumentId` on the lot, sets the
   lot-level `sampleSize` to the max across features, and (after the insert `.returning`s the
   lot ids) batch-inserts the `inboundInspectionFeature` rows.
3. **Tracked entities for inspection-required items are set to `"On Hold"` at receipt** (not
   Available); everything else flips to `Available`. They are released individually by sample
   inspection / derived measurement status or en masse by lot disposition.

## Tracking types

All four `itemTrackingType` values support inbound inspection (the only UI gate is purchased
items — see Code map). Serial parts produce N tracked entities and the inspector scans/selects a
discrete entity per sample; non-serial (Batch/Inventory/Non-Inventory) record pass/fail with
`trackedEntityId = NULL` (same UI, no scan). Inventory items that aren't tracked have no per-row
status to flip, so a Reject posts a compensating ledger entry instead (see disposition).

## Code map (ERP)

- **Items toggle**: `apps/erp/app/modules/items/ui/{Parts,Materials,Tools,Consumables}/*Properties.tsx`
  render the `requiresInspection` checkbox only when `replenishmentSystem?.includes("Buy")` (i.e.
  purchased items) — **gated by Buy replenishment, NOT by tracking type**.
- **Item Quality tab**: `.../ui/SamplingPlan/ItemQualityView.tsx` (documents card + usage-slot
  assignments card + `SamplingPlanForm`), mounted on
  `routes/x+/{part,material,tool,consumable}+/$itemId.quality.tsx` (actions branch on
  `intent=assignment`).
- **Execution view**: `.../ui/InboundInspections/InboundInspectionView.tsx` — full-screen,
  data-prop reusable (AssemblyView pattern, for later MES reuse). Document flow renders
  `InspectionDrawingPane.tsx` (lazy react-pdf + Konva balloons, click ↔ row sync) beside
  `InspectionMeasurementGrid.tsx` (shared Table inline editing, per-cell quiet POSTs, capture-phase
  Enter/Tab nav, attribute P/F toggle cells, cells beyond a feature's n disabled). Fallback flow =
  the old samples table. `RejectLotModal.tsx` (extracted) previews failed characteristics.
- **Sample modal**: `.../ui/InboundInspections/ScanInspectionSample.tsx` — `isSerial` prop; serial
  shows Scan/Select tabs (entity required). `mode="identify"` (document flow) registers a Pending
  sample column; `mode="record"` (fallback) keeps Pass/Fail.
- **Routes**: list stays `x+/quality+/inbound-inspections.tsx`; the old
  `inbound-inspections.$id.tsx` is a redirect stub to the full-screen tree
  `x+/inbound-inspection+/` (`_layout.tsx` module `quality`; `$id.tsx` loader reconciles features +
  loads document/balloons via service role; actions: `$id.measurement.tsx` (per-cell),
  `$id.sample.tsx`, `$id.document.tsx` (swap, only unmeasured non-terminal lots),
  `$id.{accept,reject,partial}.tsx`). Path helpers: `path.to.inboundInspection*`.
- **Server** `quality.server.ts`:
  - `upsertInboundInspectionSample` — entity flip + `trackedActivity` via the shared
    `applySampleEntityStatus` helper; skipped for `Pending` (identify-only) samples.
  - `valuateMeasurement` (exported, unit-tested) — numeric in `[nominal − |tol−|, nominal + |tol+|]`;
    unparseable nominal / non-Measurement types valuate as attributes.
  - `upsertInboundInspectionMeasurement` — creates anonymous samples on demand, upserts the
    reading, **derives** the sample status from its required measurements (feature required for
    column i iff `sampleSize >= i`), applies entity transitions (revert → On Hold, no activity),
    recomputes non-terminal lot status.
  - `reconcileInboundInspectionFeatures` — lazy per-lot plan rows for features added post-receipt.
  - `changeInboundInspectionDocument` — swap/clear guarded to unmeasured non-terminal lots; wipes
    plan rows for re-resolution.
  - `dispositionInboundInspection` — per-feature gating when the lot has features (Accept: every
    feature `recorded >= n && failed <= Ac`; Reject: some feature `failed >= Re` or a failed
    sample); Accept releases un-sampled entities to Available; Reject flips all lot entities to
    Rejected (and for a non-tracked Inventory item posts an `itemLedger` `Inbound Inspection`
    negative adjustment); Partial leaves entities; always writes `inboundInspectionHistory`.
  - NCR auto-creation lives in the **reject route** (`x+/inbound-inspection+/$id.reject.tsx`),
    optional via `createNcr`, linking through `nonConformanceInboundInspection`; the description
    includes a "Failed characteristics" block built from the lot's measurements.
- **Service** `quality.service.ts`: `getInboundInspections` (list), `getInboundInspection`,
  `getInboundInspectionLotTrackedEntities`, `getInboundInspectionFeatures` (embeds
  `inspectionFeature(...)` by table name), `getInboundInspectionMeasurements`,
  `getItemInspectionDocumentAssignments` / `upsertItemInspectionDocumentAssignment` (empty
  documentId deletes the slot).
- **Validators** `quality.models.ts`: `inboundInspectionSampleValidator` (`trackedEntityId`
  optional; status includes `Pending`), `itemSamplingPlanValidator`,
  `inboundInspectionDispositionValidator`, `inboundInspectionMeasurementValidator`
  (`value` xor `passed`), `itemInspectionDocumentAssignmentValidator`,
  `inspectionDocumentUsages` const.
- **Sampling engines** (kept in sync manually): `resolveSamplingPlan` +
  `resolveFeatureSamplingPlan` in both `apps/erp/app/modules/quality/samplingStandards.ts` and
  `packages/database/supabase/functions/shared/sampling-engine.ts`.

## Gotchas

- **Lot-based, not entity-based.** The Phase-1 per-entity `inboundInspection` was dropped; read
  the `20260419163058` migration (and newer) for the real shape. `receiptLineId` is unique — one
  inspection lot per received line.
- **Inspection-required tracked entities post `On Hold`, not Available.** They are not on-hand
  until released by sampling/disposition.
- **`trackedEntityId` is nullable** on samples; serial uniqueness is enforced by a *partial* index.
- **Inspection *documents* are authored in the production module** (`inspectionDocument`/
  `inspectionFeature`/`balloon` + `save_inspection_document_atomic`, newest def
  `20260722040401`) and are now *consumed* by this flow via the item's Receipt-usage
  assignment. The lot references the document **live** — measurement rows store the
  valuation at entry, so later tolerance edits never rewrite recorded results.
- **Sample status is derived on document-driven lots** — do not add manual sample
  pass/fail UI there; deviations resolve at disposition via MRB/NCR (spec decision).
- **Per-cell measurement saves are quiet** (plain `fetch`, no revalidation) — the grid and
  the view mirror statuses locally from the action's returned
  `{sampleId, measurementStatus, sampleStatus}`.
