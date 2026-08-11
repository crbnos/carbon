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
for each received line whose item has a **Receipt-usage inspection plan** — i.e.
an `itemInspectionDocumentAssignment` row for `usage = 'Receipt'` (the item-level
`requiresInspection` flag was removed 2026-07-26; the assigned document IS the
gate). A **single**
full-screen execution UI at `/x/inspection/{id}` (`InspectionView` +
`InspectionMeasurementGrid`) covers every lot (spec
`.ai/specs/implemented/2026-07-21-inbound-inspection-execution.md`):

- **Drawing pane** — shown when the lot has an assigned PDF (`pdfUrl != null`);
  hidden otherwise (the grid takes the full body).
- **Feature rows** — when the assigned document resolved features, the grid is a
  features × samples measurement grid: readings auto-valuate against live
  tolerances, sample status is **derived** (strict, no override), per-feature AQL
  sampling (feature rule → document default → All; the per-item
  `itemSamplingPlan` tier was removed 2026-07-26, migration
  `20260726231401_document-sampling-default.sql`).
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

Disposition is always a human decision; Reject/Partial can auto-create an NCR
whose description includes the failed features (documentation only — never
required, and the NCR does not drive the physical outcome). The **ERP receipt
UI** exposes **Accept** and **Reject** (its `$id.partial.tsx` route exists but
has no header button). The **MES job-operation UI** exposes **Accept**,
**Partial**, and **Reject**, and its dispositions carry their physical
production outcome (see "Disposition → production outcome" below). All three
terminal statuses (Passed/Failed/**Partial**) are hard-terminal in the engine
since 2026-07-27: samples and measurements are guarded closed on all of them.

## Data model (newest migration wins: `20260722132135_inspections-refactor.sql`)

Lineage: Phase-1 `20260419094132_inbound-inspections.sql` (dropped) → Phase-2
lot rebuild `20260419163058_inbound-inspection-sampling.sql` → execution layer
`20260722040401_inbound-inspection-execution.sql` → the rename/source refactor
`20260722132135`. Old constraint/index NAMES still carry `inboundInspection`
strings (cosmetic).

- ~~`item.requiresInspection`~~ — **dropped 2026-07-26** (along with the vestigial
  `purchaseOrderLine.requiresInspection` / `salesOrderLine.requiresInspection`
  columns). Receipt inspection is now gated by the item's Receipt-usage
  `itemInspectionDocumentAssignment` (see Receipt flow above), not a boolean flag.
- `companySettings.samplingStandard` enum `samplingStandard` (`ANSI_Z1_4` | `ISO_2859_1`,
  default `ANSI_Z1_4`) and `companySettings.enforceInspectionFourEyes` BOOLEAN.
- `inspectionDocument.sampling*` — the document-level **default sampling rule**
  (six nullable columns mirroring the per-feature set; added
  `20260726231401_document-sampling-default.sql`, which also **dropped
  `itemSamplingPlan`** — plans that existed were backfilled onto the item's
  documents via `partId`). NULL default = All (100%).
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
- `productionQuantity.inspectionId` / `.inspectionSampleId`
  (`20260727031247_inspection-production-links.sql`) — nullable FKs (ON DELETE
  SET NULL) recording which inspection/sample drove a posting. The **partial
  UNIQUE index on `inspectionSampleId`** is the double-count guard: a sample's
  verdict can produce at most one posting. The same migration forks
  `sync_finish_job_operation` (the zero-completions fallback to the full job
  quantity now applies ONLY when the job recorded no scrap/rework — a fully
  scrapped job closes with `quantityComplete = 0` and receives nothing) and
  `complete_job_to_inventory` (the serial branch excludes `Rejected` entities
  from the Assembly Output ledger loop AND the Available release).

Execution-layer tables (`20260722040401_inbound-inspection-execution.sql`):

- `inspection.inspectionDocumentId` — **live** reference to the assigned
  `inspectionDocument` (ON DELETE SET NULL); no feature snapshot.
- `itemInspectionDocumentAssignment` — PK `(itemId, usage)`; `usage` enum
  `inspectionDocumentUsage` (v1: only `'Receipt'`; FAI/Production are additive
  enum values later). Edited on the item Quality tab (`ItemQualityView`).
- `inspectionFeature` gained six nullable per-feature sampling columns
  (`samplingPlanType/SampleSize/Percentage/Aql/InspectionLevel/Severity`);
  NULL = inherit the document's default rule. Persisted through the
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
1. Loads items (`id, itemTrackingType, replenishmentSystem`), company `samplingStandard`,
   Receipt-usage `itemInspectionDocumentAssignment` rows (`assignmentByItemId`), and the
   assigned documents' `inspectionFeature` rows + default sampling columns.
2. Per receipt line whose item **has a Receipt-usage assignment** (`assignmentByItemId.get(itemId)`)
   and `receivedQuantity > 0`: the assigned document is the plan gate — no assignment, no lot.
   Resolves the lot plan via `resolveSamplingPlan(plan, lotSize, standard)` from
   `packages/database/supabase/functions/shared/sampling-engine.ts` (ANSI Z1.4 / ISO 2859-1
   tables; returns `{ sampleSize, acceptance, rejection, codeLetter }`). Document with no
   default rule → `type: "All"`, level `II`, `Normal`. Always resolves **each feature** via
   `resolveFeatureSamplingPlan(feature, documentDefault, lotSize, standard)` (feature rule →
   document default → All), **always** stamps `inspectionDocumentId = assignedDocumentId` on the
   lot (even a drawing-only document with no features), sets the lot-level `sampleSize` to the max
   across features (or the snapshot size when featureless), and (after the insert `.returning`s
   the lot ids) batch-inserts the `inspectionSamplingPlan` rows.
3. **Tracked entities for items with a Receipt-usage assignment are set to `"On Hold"` at
   receipt** (not Available); everything else flips to `Available`. They are released
   individually by sample inspection / derived measurement status or en masse by lot disposition.

## Job Operation → inspection flow (MES, added 2026-07-26)

Job operations with `operationType = 'Inspection'` execute in the MES at
`/x/inspection/{jobOperationId}` (`apps/mes/app/routes/x+/inspection.$operationId.tsx`,
guard-redirect pattern per ADR-0005; `operation.$operationId.tsx` redirects
Inspection ops here). The lot is **created lazily on first open** by
`getOrCreateJobOperationInspection` (`@carbon/database/quality`): mirrors
post-receipt plan resolution (document default → All; per-feature plans
from the operation's `inspectionDocumentId` FK — stamped even when the document
has no features yet, so drawing-only docs render and later features reconcile
in), `sourceDocument='Job Operation'`, `sourceDocumentId=job.id`,
`sourceDocumentLineId=jobOperationId`, `sourceDocumentReadableId=job.jobId`,
`itemId` = the make method's item (subassembly ops inspect the subassembly),
`lotSize = operationQuantity`, human id from the `inspection` sequence.
Concurrent first-opens are settled by the partial unique index (23505 → reselect).

- **MES UI**: `apps/mes/app/components/Inspection/` — `InspectionView` (AssemblyView
  shell: header segments for Add Sample / Complete passed (n) / Reject / Partial /
  Accept, TimerControl → `/x/event` — the labor clock **auto-starts on open
  whenever no clock is running**, always on for inspections, independent of the
  company `autoStartOperationTimer` setting; action sheet for Scrap/Rework/Finish/Quality
  Issue via the shared JobOperation modals), `InspectionMeasurementMatrix` (plain
  touch-first table, SAME per-cell quiet POST contract as the ERP grid),
  `InspectionDrawingPane` (verbatim copy of the ERP pane; MES gained
  `konva`/`react-konva`/`pdfjs-dist` deps + canvas SSR stub + worker bootstrap),
  `ScanInspectionSample` (adapted: `@carbon/form` fields, samples from
  make-method WIP entities), `DispositionModal` (the Reject/Partial failed-set
  allocator; replaced `RejectLotModal` 2026-07-27).
- **MES routes**: view param is the jobOperationId; lot actions use the lot id
  under a distinct prefix — `x+/inspection-lot.$id.{measurement,sample,disposition,complete-passed}.tsx`
  (`path.to.inspectionMeasurement|Sample|Disposition|CompletePassed`; the old
  accept/reject routes were retired 2026-07-27), each
  `requirePermissions({ update: "quality" })` → MES validators
  (`~/services/models`) → the shared engine with `getDatabaseClient()`
  (`apps/mes/app/services/database.server.ts`, same singleton as ERP's).
- **WIP entities are never flipped by sampling or by the quality engine.** The
  entity flips in `upsertInspectionSample` / `upsertInspectionMeasurement` (and
  their `applySampleEntityStatus` activity writes) are guarded
  `sourceDocument === "Receipt"`, matching `dispositionInspection`'s existing
  guard — job WIP entities keep their job-owned status (Reserved etc.). The
  ONE exception lives in the production-outcome layer, not the engine: the MES
  disposition route flips the **scrap-allocated** serial subset to `Rejected`
  (see below).
- **MES reads**: `apps/mes/app/services/quality.service.ts` (copies of the ERP
  reads + a simplified `getInspectionDocumentWithBalloons` that builds the
  `/file/preview/private/` pdfUrl from `inspectionDocument.storagePath`).

### Disposition → production outcome (MES, added 2026-07-27)

The MES verdict carries its physical posting — one decision surface instead of
parallel Accept/Reject + menu Log-Completed/Scrap/Rework vocabularies. The
quality engine stays pure (verdicts only); orchestration lives in
`x+/inspection-lot.$id.disposition.tsx` on top of shared helpers in
`apps/mes/app/services/quality.server.ts`
(`getInspectionOutcomeState` — buckets recomputed fresh from the DB per POST;
`getSerialCompletionCandidates` / `postSerialCompletions` /
`postBulkCompletion`; `createInspectionRejectionIssue` — the NCR block lifted
from the retired reject route).

| Decision | Physical postings |
|---|---|
| **Accept** | Completes the open remainder (serial: per-entity `issue` `jobOperationSerialComplete`, Pending-sampled and un-sampled units included, failed-sample units EXCLUDED; non-serial: one bulk posting of the op-column remaining via `jobOperationBatchComplete` or `insertProductionQuantity`+backflush) |
| **Reject** | The operator allocates the open remainder in `DispositionModal`: serial per-unit Scrap/Rework toggles, non-serial scrap+rework quantity fields; the rest is record-only. Scrap subset → one `insertScrapQuantity` (+reason, + backflush) and the serial subset flips → `Rejected`. Rework subset → ONE `trigger-rework` invoke (targets from `rework-targets`; the routing clone includes the inspection op → fresh lot → automatic re-inspection) + `recalculate jobRequirements`; reworked entities are NOT flipped. |
| **Partial** | Terminal mixed close, gated `inspected >= lotSize && passes > 0 && fails > 0`. Passed units complete; the failed set is allocated exactly like Reject (allocation restricted to failed units). |
| **Complete passed (n)** header chip | Progressive completion of passed-but-unposted units any time the lot is open (`$id.complete-passed.tsx`) — explicit button, not auto-on-pass, so verdict typos need no compensating transaction. |

Mechanics (in order, per POST):
1. Buckets recomputed server-side and validated (allocation ids must be open
   make-method entities; quantities clamped to the **op-column remaining** =
   `target − complete − scrapped − reworked`, so escape-hatch menu postings are
   never double-counted; serial divergence blocks with an error).
2. `dispositionInspection({ requireOpen: true })` closes the lot FIRST — the
   one-shot status UPDATE is the serialization point; a concurrent second POST
   dies before any posting can re-run (a re-POST can never re-clone the rework
   path).
3. Postings, each carrying provenance links (`productionQuantity.inspectionId`
   + `inspectionSampleId`; serial completes processed in ascending sample order;
   non-serial bulk rows link the lowest unlinked passed sample as a serializing
   representative). Failures after step 2 leave a closed lot with partial
   postings — surfaced loudly in the flash; the links make the arithmetic
   self-heal for manual ERP fixes.
4. Optional NCR (`createNcr`), `willBeFinished` mirror from `complete.tsx` for
   `targetQuantity = 0` operations.

The action sheet keeps Scrap/Rework (escape hatches for non-quality losses),
Finish, and Quality Issue; **Log Completed was removed** (verdict-driven
completion replaced it).

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

- **No items toggle**: the `requiresInspection` checkbox was removed from the item
  Properties sidebars (Parts/Materials/Tools/Consumables) 2026-07-26. Inbound
  inspection is configured entirely on the item **Quality tab** by assigning a
  Receipt-usage inspection document; there is no per-item boolean.
- **Item Quality tab**: `.../ui/Item/ItemQualityView.tsx` (documents card + usage-slot
  assignments card; sampling lives on the document, not the item), mounted on
  `routes/x+/{part,material,tool,consumable,service}+/$itemId.quality.tsx` (actions branch on
  `intent=assignment`). The tab is **always shown** (no `requiresInspection` gate in the item
  navigation hooks), for every item type, gated only by the `quality` view permission.
- **Execution view**: `.../ui/Inspections/InspectionView.tsx` — full-screen,
  data-prop reusable (AssemblyView pattern, for later MES reuse). Renders
  `InspectionDrawingPane.tsx` (lazy react-pdf + Konva balloons, click ↔ row sync) above
  `InspectionMeasurementGrid.tsx` when `pdfUrl != null`, else the grid alone.
  `InspectionMeasurementGrid.tsx` (shared Table inline editing, per-cell quiet POSTs, capture-phase
  Enter/Tab nav, attribute P/F toggle cells; every cell is recordable — a feature's n is the
  required MINIMUM, extra readings up to the lot size are allowed) shows feature
  rows when `liveFeatures.length > 0`, otherwise the single `OVERALL_ROW_ID` pass/fail row whose
  cells write the sample status via the sample route. `RejectLotModal.tsx` (extracted) previews
  failed features.
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
  - **Closed guards + linked-sample locks (2026-07-27):** all three terminal
    statuses (Passed/Failed/**Partial**) block `upsertInspectionSample` (guard
    is NEW — it had none) and `upsertInspectionMeasurement` ("Inspection is
    closed") and `changeInspectionDocument`. Updating an EXISTING sample (or a
    measurement on one) additionally fails when a `productionQuantity` row
    links its `inspectionSampleId` — the unit was already completed from that
    verdict; deleting the row in the ERP unlocks it (`assertSampleNotLinked`).
  - `upsertInspectionSample` — upsert precedence: by `trackedEntityId` (serial),
    else by `sampleId` (the "Overall result" row re-toggling an anonymous column
    in place), else insert a fresh anonymous sample. Entity flip + `trackedActivity`
    via the shared `applySampleEntityStatus` helper; skipped for `Pending`
    (identify-only) samples. The `$id.sample.tsx` route returns the `sampleId` and,
    when `quiet=true` (grid overall-result POST), suppresses the success flash.
  - `valuateMeasurement` (exported, unit-tested) — numeric in `[nominal − |tol−|, nominal + |tol+|]`;
    unparseable nominal / non-Measurement types valuate as attributes.
  - `upsertInspectionMeasurement` — creates anonymous samples on demand, upserts the
    reading, **derives** the sample status count-based (not positional): any failed
    reading ⇒ Failed; every plan feature Passed on the sample ⇒ Passed; else Pending.
    A feature's n is the required minimum across ANY samples (per-feature disposition
    gating enforces the counts); extra readings up to the lot size are allowed.
    Applies entity transitions (revert → On Hold, no activity), recomputes
    non-terminal lot status.
  - `reconcileInspectionSamplingPlans` — lazy per-lot plan rows for features added post-receipt.
  - `changeInspectionDocument` — swap/clear guarded to unmeasured non-terminal lots; wipes
    plan rows for re-resolution.
  - `dispositionInspection` — per-feature gating when the lot has features (Accept: every
    feature `recorded >= n && failed <= Ac`; Reject: some feature `failed >= Re` or a failed
    sample); Accept releases every non-failed lot entity to Available (un-sampled AND
    partially-inspected Pending samples included); Reject flips all lot entities to
    Rejected (and for a non-tracked Inventory item posts an `itemLedger` `Inbound Inspection`
    negative adjustment); Partial leaves entities; always writes `inspectionHistory`.
    Optional **`requireOpen`** (one-shot mode, MES disposition route only): the
    status UPDATE gains `WHERE status NOT IN (Passed,Failed,Partial)` and the
    call throws "Inspection is already dispositioned" on zero rows — concurrency
    safe because a second transaction blocks on the row lock, re-evaluates the
    predicate against the committed terminal status, and matches nothing. ERP
    receipt lots do NOT pass it, preserving re-disposition (write-off retry)
    semantics.
  - NCR auto-creation lives in the **reject route** (`x+/inspection+/$id.reject.tsx`),
    optional via `createNcr`, linking through `nonConformanceInspection`; the description
    includes a "Failed features" block built from the lot's measurements.
- **Service** `quality.service.ts`: `getInspections` (list), `getInspection`,
  `getInspectionTrackedEntities`, `getInspectionSamplingPlans` (embeds
  `inspectionFeature(...)` by table name), `getInspectionMeasurements`,
  `getItemInspectionDocumentAssignments` / `upsertItemInspectionDocumentAssignment` (empty
  documentId deletes the slot).
- **Validators** `quality.models.ts`: `inspectionSampleValidator` (`trackedEntityId`
  optional; status includes `Pending`),
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
- **MES dispositions are one-shot; ERP receipt dispositions are not.** Only the
  MES disposition route passes `requireOpen` — don't add it to ERP receipt
  routes (their Reject retry re-invokes the idempotent `post-nonconformance`).
- **A crash between the one-shot close and the postings** leaves a closed lot
  with missing postings (by design — close-first is what makes rework
  un-repeatable). Recovery is manual: post the missing rows from the ERP
  (`productionQuantity` links make completed-vs-not arithmetic self-healing);
  deleting a linked Production row makes that sample's unit completable again.
- **ERP inspection views of Job Operation lots are verdict-only.** The
  execution surface (postings, allocation, complete-passed) is the MES; the
  ERP shows the lot, samples, and measurements but exposes no outcome
  orchestration for job-op lots.
