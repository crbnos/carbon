---
paths:
  - "apps/erp/app/modules/quality/ui/Inspections/**"
  - "apps/erp/app/modules/quality/quality.{server,service,models}.ts"
  - "apps/erp/app/routes/x+/inspection+/**"
  - "apps/mes/app/components/Inspection/**"
  - "apps/mes/app/routes/x+/inspection*.tsx"
  - "packages/database/src/quality.ts"
  - "packages/database/supabase/migrations/*inspection*.sql"
  - "packages/database/supabase/functions/post-receipt/index.ts"
---

# Inspection System

Generic quality-inspection execution keyed by `sourceDocument` /
`sourceDocumentId` / `sourceDocumentLineId` / `sourceDocumentReadableId`
(enum `inspectionSourceDocument`: 'Receipt' and 'Job Operation', both live; no
FKs on the generic ids, unique per `(sourceDocument, sourceDocumentLineId)` —
a **partial** unique index `WHERE "sourceDocumentLineId" IS NOT NULL`).
Renamed from the receipt-only "Inbound Inspections" in `20260722132135_inspections-refactor.sql`
(tables `inspection`/`inspectionSample`/`inspectionSamplingPlan`/
`inspectionMeasurement`/`inspectionHistory`/`nonConformanceInspection`;
readable id column `inspectionId`, sequence key `inspection` — existing
companies keep their II prefix, new companies seed INS).

Receipt flow: when a receipt is posted, a **lot-level** inspection is created
for each received line whose item has `requiresInspection = true`. A **single**
full-screen execution UI at `/x/inspection/{id}` (`InspectionView` +
`InspectionMeasurementGrid`) covers every lot (spec
`.ai/specs/2026-07-21-inbound-inspection-execution.md`):

- **Drawing pane** — shown when the lot has an assigned PDF (`pdfUrl != null`);
  hidden otherwise (the grid takes the full body).
- **Feature rows** — when the assigned document resolved features, the grid is a
  features × samples measurement grid: readings auto-valuate against live
  tolerances, sample status is **derived** (strict, no override), per-feature AQL
  sampling (feature rule → `itemSamplingPlan` → All).
- **No document** — the grid collapses to a single synthetic **"Overall result"**
  pass/fail row (client-only, `featureId = "__overall__"`). Its P/F cells set the
  sample's status **directly** via the sample route (`upsertInspectionSample`,
  status Passed/Failed) rather than recording a measurement; lot-level AQL gating.
- **Columns** — serial lots add one column per **scanned** tracked entity
  (`ScanInspectionSample`, identify-only → a Pending sample with a
  `trackedEntityId`; the column header shows the entity `readableId`); non-serial
  lots pre-create anonymous numbered columns up to the resolved sample size, and
  an anonymous `inspectionSample` is materialized lazily on the first cell save
  (measurement → `upsertInspectionMeasurement`; overall-result → the sample route
  with `sampleId` for idempotent re-toggle).
- **Scanning (serial)** — a header **"Add Sample"** button (not an in-grid column)
  opens the scanner; it is `variant="primary"` until `samples.length >=
  inspection.sampleSize`, then `secondary`. A fresh serial lot (0 samples)
  auto-opens the scanner once on mount.

(The pre-unification "fallback" samples table and the scanner's `mode="record"`
pass/fail path were removed 2026-07-25; scanning is always identify.)

Disposition is always a human decision; Reject can auto-create an NCR whose
description includes the failed characteristics. Two dispositions are exposed in
the UI: **Accept** and **Reject**. **Partial** exists in the backend
(`inspectionStatusType` enum value, `$id.partial.tsx` route,
`path.to.inspectionPartial`, `dispositionInspection` `decision: "Partial"`) but its
header button was removed from `InspectionView.tsx` — the backend path is currently
unreachable from the UI, retained so it can be re-enabled later.

## Data model (newest migration wins: `20260722132135_inspections-refactor.sql`)

Lineage: Phase-1 `20260419094132_inbound-inspections.sql` (dropped) → Phase-2
lot rebuild `20260419163058_inbound-inspection-sampling.sql` → execution layer
`20260722040401_inbound-inspection-execution.sql` → the rename/source refactor
`20260722132135`. Old constraint/index NAMES still carry `inboundInspection`
strings (cosmetic).

- `item.requiresInspection` BOOLEAN (default false) — added `20260419094132`.
- `companySettings.samplingStandard` enum `samplingStandard` (`ANSI_Z1_4` | `ISO_2859_1`,
  default `ANSI_Z1_4`) and `companySettings.enforceInspectionFourEyes` BOOLEAN.
- `itemSamplingPlan` (PK = **`itemId`** only, not composite) — per-item plan, created lazily:
  `type` (`samplingPlanType`: All/First/Percentage/AQL), `sampleSize`, `percentage`,
  `aql`, `inspectionLevel` (I/II/III/S1–S4), `severity` (Normal/Tightened/Reduced).
- `inspection` (lot level, PK = `id`) — `inspectionId` (human id, `II` seq,
  unique per company), `receiptLineId` (**unique** — one lot per receipt line), `receiptId`,
  `itemId`, `itemReadableId`, `supplierId`, `lotSize`, snapshot of the resolved plan
  (`samplingStandard`, `samplingPlanType`, `sampleSize`, `acceptanceNumber`,
  `rejectionNumber`, `aql`, `inspectionLevel`, `severity`, `codeLetter`),
  `status` (`inspectionStatusType`: Pending/In Progress/Passed/Failed/Partial),
  `dispositionedBy`/`dispositionedAt`. **No `itemTrackingType` column** — joined from `item`.
- `inspectionSample` — one row per recorded result: `inspectionId`,
  `trackedEntityId` (**nullable** since `20260612151947`), `status`
  (`inspectionSampleStatusType`: Pending/Passed/Failed), `inspectedBy`/`inspectedAt`.
  A **partial** unique index `inspectionSample_trackedEntityId_key WHERE trackedEntityId
  IS NOT NULL` keeps a serial entity sampleable once while allowing many anonymous samples.
- `inspectionHistory` — one row per disposition (skeleton for future plan auto-switching).
- `nonConformanceInspection` (`20260421091238`) — links an auto-created NCR back to
  the inspection (unique `(nonConformanceId, inspectionId)`).

Execution-layer tables (`20260722040401_inbound-inspection-execution.sql`):

- `inspection.inspectionDocumentId` — **live** reference to the assigned
  `inspectionDocument` (ON DELETE SET NULL); no feature snapshot.
- `itemInspectionDocumentAssignment` — PK `(itemId, usage)`; `usage` enum
  `inspectionDocumentUsage` (v1: only `'Receipt'`; FAI/Production are additive
  enum values later). Edited on the item Quality tab (`ItemQualityView`).
- `inspectionFeature` gained six nullable per-feature sampling columns
  (`samplingPlanType/SampleSize/Percentage/Aql/InspectionLevel/Severity`);
  NULL = inherit `itemSamplingPlan`. Persisted through the
  `save_inspection_document_atomic` fork in the same migration (newest def).
- `inspectionSamplingPlan` — per-lot per-feature **resolved** plan
  (`sampleSize`, `acceptanceNumber`, `rejectionNumber`, `codeLetter`), unique
  `(inspectionId, inspectionFeatureId)`. Created at receipt; lazily
  reconciled by the `$id` loader for features added to the live document later.
- `inspectionMeasurement` — one reading per `(sampleId, featureId)`
  (unique): `value NUMERIC` (NULL for attribute features), `status`
  (`inspectionSampleStatusType` — the valuation at entry; tolerance edits
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
   lot ids) batch-inserts the `inspectionSamplingPlan` rows.
3. **Tracked entities for inspection-required items are set to `"On Hold"` at receipt** (not
   Available); everything else flips to `Available`. They are released individually by sample
   inspection / derived measurement status or en masse by lot disposition.

## Job Operation → inspection flow (MES, added 2026-07-26)

Job operations with `operationType = 'Inspection'` execute in the MES at
`/x/inspection/{jobOperationId}` (`apps/mes/app/routes/x+/inspection.$operationId.tsx`,
guard-redirect pattern per ADR-0005; `operation.$operationId.tsx` redirects
Inspection ops here). The lot is **created lazily on first open** by
`getOrCreateJobOperationInspection` (`@carbon/database/quality`): mirrors
post-receipt plan resolution (itemSamplingPlan → default All; per-feature plans
from the operation's `inspectionDocumentId` FK — stamped even when the document
has no features yet, so drawing-only docs render and later features reconcile
in), `sourceDocument='Job Operation'`, `sourceDocumentId=job.id`,
`sourceDocumentLineId=jobOperationId`, `sourceDocumentReadableId=job.jobId`,
`itemId` = the make method's item (subassembly ops inspect the subassembly),
`lotSize = operationQuantity`, human id from the `inspection` sequence.
Concurrent first-opens are settled by the partial unique index (23505 → reselect).

- **MES UI**: `apps/mes/app/components/Inspection/` — `InspectionView` (AssemblyView
  shell: header segments for Add Sample/Reject/Accept, TimerControl → `/x/event`,
  action sheet for Log Completed/Scrap/Rework/Finish/Quality Issue via the shared
  JobOperation modals), `InspectionMeasurementMatrix` (plain touch-first table,
  SAME per-cell quiet POST contract as the ERP grid), `InspectionDrawingPane`
  (verbatim copy of the ERP pane; MES gained `konva`/`react-konva`/`pdfjs-dist`
  deps + canvas SSR stub + worker bootstrap), `ScanInspectionSample` (adapted:
  `@carbon/form` fields, samples from make-method WIP entities), `RejectLotModal`
  (adds hidden `operationId` for the redirect back).
- **MES routes**: view param is the jobOperationId; lot actions use the lot id
  under a distinct prefix — `x+/inspection-lot.$id.{measurement,sample,accept,reject}.tsx`
  (`path.to.inspectionMeasurement|Sample|Accept|Reject`), each
  `requirePermissions({ update: "quality" })` → MES validators
  (`~/services/models`) → the shared engine with `getDatabaseClient()`
  (`apps/mes/app/services/database.server.ts`, same singleton as ERP's).
- **Reject → issue**: MES reject runs `dispositionInspection(Reject)` then
  (optional, default on) creates the NCR through MES's own job-op path —
  `createQualityIssue` (`apps/mes/app/services/quality.server.ts`, extracted from
  `quality-issue.new.tsx`; links `nonConformanceJobOperation` + item/entities) —
  plus a `nonConformanceInspection` link and the ERP reject route's
  failed-characteristics description block. No `post-nonconformance` invoke:
  job-op lots return `writeOff: null`.
- **WIP entities are never flipped by sampling/disposition.** The entity flips in
  `upsertInspectionSample` / `upsertInspectionMeasurement` (and their
  `applySampleEntityStatus` activity writes) are guarded
  `sourceDocument === "Receipt"`, matching `dispositionInspection`'s existing
  guard — job WIP entities keep their job-owned status (Reserved etc.); physical
  outcomes go through Scrap/Rework/Issues.
- **MES reads**: `apps/mes/app/services/quality.service.ts` (copies of the ERP
  reads + a simplified `getInspectionDocumentWithBalloons` that builds the
  `/file/preview/private/` pdfUrl from `inspectionDocument.storagePath`).

## Tracking types

All four `itemTrackingType` values support inbound inspection (the only UI gate is purchased
items — see Code map). Serial parts produce N tracked entities and the inspector scans/selects a
discrete entity per sample; non-serial (Batch/Inventory/Non-Inventory) record pass/fail with
`trackedEntityId = NULL` (same UI, no scan). Inventory items that aren't tracked have no per-row
status to flip, so a Reject posts a compensating write-off instead (see disposition).

**Reject / disposition GL posting.** A non-tracked `Inventory` reject and every NCR disposition
route their inventory value through the **`post-nonconformance` edge function** (`itemLedger` +
`costLedger` relief + a `journal` offset to `accountDefault.scrapAccount`, gated on
`accountingEnabled`; idempotent per `(documentType, documentId)`). The reject route
(`$id.reject.tsx`) invokes it with the lot write-off (`documentType 'Inbound Inspection'`,
`documentId = inspection.id`) after `dispositionInspection` commits — `dispositionInspection`
itself no longer writes `itemLedger`, it returns a `writeOff` descriptor. Disposition close
(`closeIssue`) invokes it with `documentType 'Non-Conformance'`, `documentId = ncrId`. Non-tracked
disposition rows are dispositionable in `AssociatedItemsList.tsx` (quantity + `Select`, split by
quantity, no move); Use-As-Is/Rework on an inspection-rejected `Inventory` lot restores value,
non-inspection Scrap writes it off, `Non-Inventory` never posts. See `issue-module.md` → Disposition
GL/cost posting and `.ai/plans/2026-07-25-inspection-disposition-gl-posting.md`.

## Code map (ERP)

- **Items toggle**: `apps/erp/app/modules/items/ui/{Parts,Materials,Tools,Consumables}/*Properties.tsx`
  render the `requiresInspection` checkbox only when `replenishmentSystem?.includes("Buy")` (i.e.
  purchased items) — **gated by Buy replenishment, NOT by tracking type**.
- **Item Quality tab**: `.../ui/SamplingPlan/ItemQualityView.tsx` (documents card + usage-slot
  assignments card + `SamplingPlanForm`), mounted on
  `routes/x+/{part,material,tool,consumable}+/$itemId.quality.tsx` (actions branch on
  `intent=assignment`).
- **Execution view**: `.../ui/Inspections/InspectionView.tsx` — full-screen,
  data-prop reusable (AssemblyView pattern, for later MES reuse). Renders
  `InspectionDrawingPane.tsx` (lazy react-pdf + Konva balloons, click ↔ row sync) above
  `InspectionMeasurementGrid.tsx` when `pdfUrl != null`, else the grid alone.
  `InspectionMeasurementGrid.tsx` (shared Table inline editing, per-cell quiet POSTs, capture-phase
  Enter/Tab nav, attribute P/F toggle cells, cells beyond a feature's n disabled) shows feature
  rows when `liveFeatures.length > 0`, otherwise the single `OVERALL_ROW_ID` pass/fail row whose
  cells write the sample status via the sample route. `RejectLotModal.tsx` (extracted) previews
  failed characteristics.
- **Sample modal**: `.../ui/Inspections/ScanInspectionSample.tsx` — identify-only; opened by the
  header **"Add Sample"** button (`InspectionView`, serial lots; primary until the sample size is
  covered, auto-opened once on a fresh 0-sample lot). `isSerial` shows Scan/Select tabs (entity
  required) and posts a **Pending** sample column with a `trackedEntityId` (verdict set later in the
  grid). Non-serial columns are pre-created, so the modal is serial-only in practice.
- **Routes**: list stays `x+/quality+/inspections.tsx`; the old
  `inspections.$id.tsx` is a redirect stub to the full-screen tree
  `x+/inspection+/` (`_layout.tsx` module `quality`; `$id.tsx` loader reconciles features +
  loads document/balloons via service role; actions: `$id.measurement.tsx` (per-cell),
  `$id.sample.tsx`, `$id.document.tsx` (swap, only unmeasured non-terminal lots),
  `$id.{accept,reject,partial}.tsx`). Path helpers: `path.to.inspection*`.
- **Server** — the transactional engine lives in **`@carbon/database/quality`**
  (`packages/database/src/quality.ts`; moved 2026-07-26 so ERP and MES run one
  engine). Every function takes a `Kysely<KyselyDatabase>` first param; ERP's
  `quality.server.ts` is thin wrappers currying `getDatabaseClient()` (names and
  signatures unchanged — ERP routes/tests untouched). `packages/database/src/sampling.ts`
  re-exports the pure Deno `shared/sampling-engine.ts` node-side (client.ts
  pattern); the engine consumes it, so package + edge share ONE resolver copy
  (ERP's `samplingStandards.ts` client copy remains for UI previews).
  - `upsertInspectionSample` — upsert precedence: by `trackedEntityId` (serial),
    else by `sampleId` (the "Overall result" row re-toggling an anonymous column
    in place), else insert a fresh anonymous sample. Entity flip + `trackedActivity`
    via the shared `applySampleEntityStatus` helper; skipped for `Pending`
    (identify-only) samples. The `$id.sample.tsx` route returns the `sampleId` and,
    when `quiet=true` (grid overall-result POST), suppresses the success flash.
  - `valuateMeasurement` (exported, unit-tested) — numeric in `[nominal − |tol−|, nominal + |tol+|]`;
    unparseable nominal / non-Measurement types valuate as attributes.
  - `upsertInspectionMeasurement` — creates anonymous samples on demand, upserts the
    reading, **derives** the sample status from its required measurements (feature required for
    column i iff `sampleSize >= i`), applies entity transitions (revert → On Hold, no activity),
    recomputes non-terminal lot status.
  - `reconcileInspectionSamplingPlans` — lazy per-lot plan rows for features added post-receipt.
  - `changeInspectionDocument` — swap/clear guarded to unmeasured non-terminal lots; wipes
    plan rows for re-resolution.
  - `dispositionInspection` — per-feature gating when the lot has features (Accept: every
    feature `recorded >= n && failed <= Ac`; Reject: some feature `failed >= Re` or a failed
    sample); Accept releases un-sampled entities to Available; Reject flips all lot entities to
    Rejected (and for a non-tracked Inventory item posts an `itemLedger` `Inbound Inspection`
    negative adjustment); Partial (currently UI-unreachable, see above) leaves
    entities; always writes `inspectionHistory`.
  - NCR auto-creation lives in the **reject route** (`x+/inspection+/$id.reject.tsx`),
    optional via `createNcr`, linking through `nonConformanceInspection`; the description
    includes a "Failed characteristics" block built from the lot's measurements.
- **Service** `quality.service.ts`: `getInspections` (list), `getInspection`,
  `getInspectionTrackedEntities`, `getInspectionSamplingPlans` (embeds
  `inspectionFeature(...)` by table name), `getInspectionMeasurements`,
  `getItemInspectionDocumentAssignments` / `upsertItemInspectionDocumentAssignment` (empty
  documentId deletes the slot).
- **Validators** `quality.models.ts`: `inspectionSampleValidator` (`trackedEntityId`
  optional; status includes `Pending`), `itemSamplingPlanValidator`,
  `inspectionDispositionValidator`, `inspectionMeasurementValidator`
  (`value` xor `passed`), `itemInspectionDocumentAssignmentValidator`,
  `inspectionDocumentUsages` const.
- **Sampling engines** (kept in sync manually): `resolveSamplingPlan` +
  `resolveFeatureSamplingPlan` in both `apps/erp/app/modules/quality/samplingStandards.ts` and
  `packages/database/supabase/functions/shared/sampling-engine.ts`.

## Gotchas

- **Lot-based, not entity-based.** The Phase-1 per-entity `inspection` was dropped; read
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
