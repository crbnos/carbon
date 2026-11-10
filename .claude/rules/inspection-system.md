---
paths:
  - "apps/erp/app/modules/quality/ui/Inspections/**"
  - "apps/erp/app/modules/quality/quality.{server,service,models}.ts"
  - "apps/erp/app/routes/x+/inspection+/**"
  - "apps/erp/app/routes/x+/inspection-document+/**"
  - "apps/erp/app/routes/x+/quality+/inspection-plans*.tsx"
  - "apps/erp/app/modules/quality/ui/InspectionDocument/**"
  - "apps/mes/app/components/Inspection/**"
  - "apps/mes/app/routes/x+/inspection*.tsx"
  - "packages/database/src/quality.ts"
  - "packages/database/supabase/migrations/*inspection*.sql"
  - "apps/erp/app/modules/inventory/inventory.service.ts"
---

# Inspection System

Generic quality-inspection execution keyed by `sourceDocument` /
`sourceDocumentId` / `sourceDocumentLineId` / `sourceDocumentReadableId`
(enum `inspectionSourceDocument`: 'Receipt', 'Job Operation' and 'Manual'; no
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
- **Prefilled samples (inspect all)** — when a serial lot's sample size covers
  every one of its units, there is nothing to choose: `prefillInspectionSamples`
  (`@carbon/database/quality`) adds a Pending sample per unit (serial order,
  `createdAt` a microsecond apart, `ON CONFLICT DO NOTHING` on the per-inspection
  index), so the scanner never auto-opens and Add Sample is hidden (both views
  show it only while a unit has no sample). Units: a receipt line's
  (`attributes ->> 'Receipt Line'`), a job make method's (`'Job Make Method'`,
  not Consumed / Rejected / Scrapped), a manual lot's own. Called on every load
  by the ERP `x+/inspection+/$id.tsx` and MES `inspection.$operationId.tsx`
  loaders (idempotent); a lot sampling a subset is left to the scanner. Pinned by
  `apps/erp/test/database/inspection-prefill.test.ts`.

(The pre-unification "fallback" samples table and the scanner's `mode="record"`
pass/fail path were removed 2026-07-25; scanning is always identify.)

Disposition is always a human decision. The ERP's **Reject Lot** is available on any open
receipt lot: with no statistical failure, `RejectLotModal` requires a reason (a suspected
counterfeit, the wrong part, transit damage), which `rejectInspection` passes to the engine
as `reason`. Reject/Partial can auto-create an NCR
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
  A **partial** unique index `inspectionSample_inspectionId_trackedEntityId_key
  (inspectionId, trackedEntityId) WHERE trackedEntityId IS NOT NULL` keeps a serial
  sampleable once **per inspection** while allowing many anonymous samples. A unit is
  inspected again in a later lot (a manual re-inspection, a rework lot): the old
  global `inboundInspectionSample_trackedEntityId_key` was dropped by
  `20261109202741_inspection-sample-per-inspection.sql`.
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
  `complete_job_to_inventory` (the serial branch excludes `Rejected` entities).
  `20260914095239_complete-job-received-quantity.sql` then rewrote that branch:
  it no longer loops every entity and no longer releases them all to `Available`
  — it receives only the delta between the cumulative completed quantity and
  what the job already received, oldest-numbered first, skipping `Consumed`,
  `Rejected` and `Scrapped`, and flips only the units it received.

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

## Plans made from a model's PMI (`20261027122437_pmi-inspection-plans.sql`)

Spec: `.ai/specs/2026-10-27-pmi-inspection-plans.md`. A STEP AP242 model's PMI
(`modelUpload.pmiPath`, see `packages/viewer/AGENTS.md`) becomes an inspection
plan automatically. The plan holds the model (`inspectionDocument.modelUploadId`,
ON DELETE SET NULL) and no PDF; each feature names its PMI item
(`inspectionFeature.pmiItemId`, `d1`/`t3`) and has `pageNumber = 1`.

- **Made by** `pmi-inspection-plan` (`packages/jobs/.../tasks/pmi-inspection-plan.ts`),
  event `carbon/pmi-inspection-plan`. Senders: `model-optimize` after a run that
  wrote `pmi.json` (every item on the model), and the `queue_pmi_inspection_plans`
  statement handler on `item` when an INSERT/UPDATE points an item at a model that
  already has `pmiPath` (that item only; skipped under `app.sync_in_progress`).
- **Mapping** is `pmiInspectionCharacteristics` (`@carbon/viewer/pmi`, tested):
  a ± dimension → nominal/tol± (re-centred on its band when both deviations
  share a sign, since the verdict reads Tol± as magnitudes); a limit dimension → midpoint ± half range; a
  dimension with no numeric limit (fit class, min/max) or a tolerance with no
  zone → nominal null (Pass/Fail); a geometric tolerance → nominal `0`, Tol+ =
  zone, Tol− `0`. Datums, notes, labels and valueless dimensions are left out.
  Units are the file's own (`mm`/`in`), `deg` for angles.
- **Once per item and model.** `createPmiInspectionPlan` (`@carbon/database/quality`)
  inserts with `ON CONFLICT DO NOTHING` on the partial unique index
  `inspectionDocument_part_model_key`. A re-optimise never rewrites an edited
  plan; a new model on the item makes a new plan and leaves the old one (and its
  assignments) alone. No plan is made when no characteristic results.
- **Item delete** (`deleteItemsWithPriceBreaks`) first calls
  `deleteUnusedPmiInspectionPlans` (`@carbon/database/quality`), which deletes
  the items' PMI plans no `inspection` used, so an automatic plan never trips
  `partId`'s RESTRICT; a used one still refuses the delete. Pinned, with
  `createPmiInspectionPlan`, by `packages/database/src/pmi-inspection-plan.test.ts`;
  the trigger by `supabase/tests/pmi-inspection-plans.test.sql`; the mapping
  against `valuateMeasurement` by `packages/jobs/.../pmi-inspection-plan.test.ts`.
- **Screens.** `InspectionView` (ERP and MES) shows `ModelUploadPreview`
  (`@carbon/viewer/model-upload-preview`, shared — not an app copy) in the
  drawing pane's place when the loader returns `model`. Its `pmiLinks` (feature
  id → `pmiItemId`) tie the active feature to its PMI item both ways; a pick on
  a datum or note clears the active feature. The editor shows the model in its
  top pane, does not render the PDF tools or the Balloon action, and gives each
  PMI row a Show action.
- **Deleting the model** sets `modelUploadId` null (ON DELETE SET NULL): the
  plan keeps its features and shows no drawing pane, and the item-delete
  cleanup no longer recognises it as a PMI plan, so it blocks a part delete
  like a hand-made plan. `deleteUnusedPmiInspectionPlans` runs as the system
  inside the item delete, so `parts_delete` alone can remove an unused PMI plan.
- Recreating the `inspectionDocuments` view also added the six `sampling*`
  columns added after it was first created (`d.*` is fixed at creation), so
  `getInspectionDocuments` (the `quality_getInspectionDocuments` tool) reads the
  document's sampling default.
- The Inspection Plans list (`/x/quality/inspection-plans`) is one row per part,
  read from the `inspectionPlanParts` view (`getInspectionPlanParts`,
  `20261028161842_inspection-plan-parts-view.sql`, recreated by
  `20261028222414_inspection-plan-parts-group-tags.sql`): the part, its plan
  count, its item group (`itemCost.itemPostingGroupId`) and tags (`part.tags`),
  and a `plans` jsonb rollup the expanded row lists, as the Change Notices list
  lists a notice's affected items. Clicking a row expands it; the part is not a
  link. Item Group and Tags are filterable columns, hidden by default. A search
  expands every row and marks the matches (`expandRowsFor` on the Table,
  `Highlight` / `searchMatches`).
- PMI ids are per-kind counters in file order, stable for one file. An extractor
  change that reorders items would point an old plan's features at other items.

## Plan versions (`20261109214614_inspection-plan-versions.sql`)

An inspection plan has versions, as procedures and quality documents do. The
siblings are procedures (status, `VersionMenu`, New Version) and assembly
instructions (row per version grouped by a root id, activation that repoints
references).

- **Schema** — `inspectionDocument.status` (enum `inspectionDocumentStatus`:
  Draft / Active / Archived, default Draft; the migration set every existing
  plan Active) and `rootInspectionDocumentId` (composite self FK, ON DELETE SET
  NULL on that column only). The first version has no root; every later version
  names it. The group is `rootInspectionDocumentId ?? id`. The name is not the
  key: it is nullable and renamable. The PMI unique index
  `inspectionDocument_part_model_key` counts roots only, so copies of a PMI
  plan do not collide; `createPmiInspectionPlan`'s ON CONFLICT matches it.
- **New Version** — `copyInspectionDocumentAsVersion` (`quality.service.ts`,
  Kysely, one transaction; operation `createInspectionDocumentVersion`,
  `create: quality`, route `x+/inspection-document+/$id.version.tsx`). It locks
  the root, numbers the copy one past the group's highest `version`, and copies
  the plan row (drawing `storagePath` and `modelUploadId` are shared, not
  duplicated), its characteristics (new ids), balloons (remapped to the new
  characteristics) and parameters. The copy is a Draft.
- **Publish** — `activateInspectionDocumentVersion` (operation of the same name,
  `update: quality`, route `$id.activate.tsx`). One transaction locks the group,
  archives the Active version, activates this one, and moves
  `itemInspectionDocumentAssignment` and `methodOperation.inspectionDocumentId`
  from the other versions to it. Job operations, quote operations and lots keep
  their version. An Archived version is reactivated the same way.
- **Lock** — only a Draft is editable. The lock is part of each write: the
  name, work instruction, model, sampling and `upsertInspectionDocument`
  updates carry `status = 'Draft'` in the UPDATE, and a write that changes no
  row is refused by `inspectionDocumentWriteRefusal`;
  `replaceInspectionDocumentParameters` reads the status under its row lock.
  `save_inspection_document_atomic` (characteristics and balloons) still relies
  on `inspectionDocumentLockRefusal` read just before it. A lot reads its plan
  live, so a locked version is what keeps a lot's characteristics fixed. The
  editor disables every edit on a locked version (grids, drawing drags, the
  Sampling cell, annotation actions) and Publish while a change is unsaved.
- **Delete** — `deleteInspectionDocument` (Kysely; operation `delete: quality`)
  refuses a version any `inspection` used: its characteristics cascade to the
  lots' measurements. Otherwise it makes the lowest remaining version the root
  when it deletes the root, and returns the drawing path only when no other
  version holds the file, so the operation never removes a PDF another version
  shows.
- **Screens** — the editor shows a `V{n}` version menu (versions with status,
  New Version) beside the title, Publish (Draft) or Reactivate (Archived) next
  to it, and the status badge for Active / Archived. A locked version hides the
  add buttons and row actions and makes the grids read-only. The plans list
  (`inspectionPlanParts`) shows one row per version group: its latest version,
  with `version`, `status` and `versions`. The plan picker shows each version
  with its status. New plans (by hand and by the PMI job) start Draft; the
  datasets seed their plans Active. Pinned by
  `apps/erp/test/database/inspection-plan-versions.test.ts`.

## Plan parameters (`20261109200337_inspection-plan-parameters.sql`)

Fixed key/value pairs on a plan ("Ambient temp" / "20 ±2 °C", "Fixture" /
"F-12") that the inspector reads before measuring. The sibling is procedure
parameters (`procedureParameter`), with two differences: a `sortOrder` column
(the editor keeps the author's order) and no snapshot — a lot reads its plan's
parameters live, as it reads the characteristics.

- **Schema** — `inspectionDocumentParameter` (`id` `idp`, `inspectionDocumentId`
  composite FK ON DELETE CASCADE, `key`, `value` default `''`, `sortOrder`),
  RLS `company("quality")`, shipped by `20261109200419_inspection-plan-parameters-rls.sql`.
- **Save** — through the editor's autosave, not per-row routes. The editor mints
  the ids (`newParameterId`, `ui/InspectionDocument/autosave.ts`) and sends the
  whole list as `parameters` only when it changed (`sendableParameters`: trimmed,
  a row with no key stays in the browser). `saveInspectionDocument` passes it to
  `replaceInspectionDocumentParameters` (`quality.service.ts`, Kysely): it locks
  the plan, deletes the rows not sent and upserts the rest by id; an id that is
  another plan's row throws and rolls the save back. Pinned by
  `apps/erp/test/database/inspection-plan-parameters.test.ts`.
- **Editor** — `Characteristics | Parameters` tabs sit in the header after the
  title's ⋮ menu (no counts), with the matching Add Characteristic / Add Parameter
  button in the header's actions; the bottom pane shows the chosen `Grid` (the
  Parameters grid is Key, Value, delete). Add Selector and the zoom controls show
  only when the plan has a PDF.
  A plan with no PDF and no model has no viewer: the tabs fill the page and a
  right sidebar (`InspectionDocumentDropzone`) takes a dropped or picked PDF
  (the editor's own `uploadPdfAndSave`) or STEP file. A STEP file is staged with
  `useModelUpload` and attached by `attachInspectionDocumentModel`
  (`quality.server.ts`, `@mcp`, `update: "quality"`; route
  `x+/inspection-document+/$id.model.tsx`): it inserts the `modelUpload` as the
  system with no item link (a quality user need not hold `parts`), which starts
  `model-optimize`, then sets `inspectionDocument.modelUploadId`. Refused when the
  plan already has a PDF (`storagePath`) or a model. Once a PDF or model exists the
  viewer takes the top half and the sidebar is gone. The PMI job only plans for
  ITEMS on a model, so an attached model's PMI does not fill the plan's
  characteristics.
- **Execution** — read by `getInspectionDocumentParameters` (ERP `$id` loader)
  and by MES `getInspectionDocumentWithBalloons` (`parameters`). The ERP
  `InspectionMeasurementGrid` and the MES `InspectionMeasurementMatrix` take
  `parameters` and show `Characteristics | Parameters` tabs in their toolbar
  (a key/value list, or "This inspection plan has no parameters"). The views
  pass `parameters` only when the lot has a plan, so a planned lot always shows
  the tab and a lot with no plan shows none.

## Plan work instructions (`20261109231722_inspection-plan-work-instructions.sql`)

Rich text on a plan that the inspector reads on every lot (how to fixture the
part, which gauge to zero first). The sibling is a method operation's
`workInstruction`: the same Tiptap JSON column, the same `Editor` with image
upload, the same `generateHTML` read-only render.

- **Schema** — `inspectionDocument.workInstruction` JSONB, nullable. No
  snapshot: a lot reads it live, like the parameters.
- **Save** — not through the autosave. The editor's **Instructions** tab (after
  Characteristics | Parameters) debounces each change (1 s, flushed on unmount)
  and posts it as JSON to `x+/inspection-document+/$id.update-work-instruction.tsx`
  → `setInspectionDocumentWorkInstruction` (`quality.server.ts`, `@mcp`,
  `update: "quality"`; takes Markdown or a Tiptap document through
  `optionalTiptapDoc`). It is refused on an Active or Archived version
  (`inspectionDocumentLockRefusal`); a locked version renders the HTML.
  `copyInspectionDocumentAsVersion` copies it (pinned by
  `apps/erp/test/database/inspection-plan-versions.test.ts`).
- **Execution** — `getInspectionDocument` (`mapInspectionDocument`'s
  `workInstruction`) for the ERP `$id` loader, MES
  `getInspectionDocumentWithBalloons` for both MES views. The ERP grid and the
  MES matrix show an **Instructions** tab beside Parameters whenever they get
  `parameters` (the lot has a plan); a plan with none (null, or only empty
  paragraphs) shows "This inspection plan has no work instructions."

## Gauges (`20260929203517_inspection-gauges.sql`)

- **Plan side** — `inspectionFeature.gaugeTypeId` (nullable FK → `gaugeType`,
  ON DELETE SET NULL): the gauge TYPE a feature must be measured with. Edited in
  the inspection plan editor's **Gauge Type** column (clearable = any gauge),
  persisted by the `save_inspection_document_atomic` fork in that migration,
  which refuses another company's gauge type (the FK alone would accept it).
- **Execution side** — the gauge actually used is recorded per **lot × feature**
  on `inspectionSamplingPlan.gaugeId` (+ `gaugeRecordedAt`), not per
  measurement — one gauge per characteristic per lot, as SAP QM / FAI forms do.
  Written by `recordInspectionGauge` (`@carbon/database/quality`): closed-lot
  guard, company-scoped gauge, refuses `Inactive` gauges and a gauge whose type
  differs from the feature's `gaugeTypeId`. A gauge recorded on a **closed** lot
  (Passed/Failed/Partial) cannot be deleted — the trigger
  `prevent_deleting_gauge_recorded_on_closed_inspection`
  (`20261001022340_inspection-gauge-history.sql`) raises `23503`, which also refuses a
  gauge-type delete reaching it through its cascade; set the gauge Inactive instead. Open
  lots keep the FK's SET NULL, and a company wipe (`app.sync_in_progress`, or children
  deleted first) is never blocked. Out-of-calibration is shown
  (red icon in the cell, calibration status badge in the list) but does NOT block. Routes: ERP `x+/inspection+/$id.gauge.tsx`,
  MES `x+/inspection-lot.$id.gauge.tsx` (`path.to.inspectionGauge`), quiet POSTs
  like the measurement cells.
- **Picker** — `InspectionGaugePicker` (ERP `ui/Inspections/`, touch-sized copy in
  MES `components/Inspection/`): a button filling the whole Gauge cell opens a
  search + list of Active gauges (the `gauges` view, filtered to the feature's
  type). The loader also returns any gauge already recorded on the lot whatever
  its status, so a gauge retired after use still shows by its readable id
  ("(Inactive)") — that record is what a calibration recall reads. "Recently
  used" comes first — `getRecentInspectionGauges` returns the
  gauges most recently recorded at the lot's **station**: a Job Operation lot's
  station is its operation's `workCenterId`; **all receipts are one station**.
  No Gauge column on the no-document "Overall result" row.

## Receipt → inspection flow (`postReceipt`, `inventory.service.ts`)

`apps/erp/app/modules/inventory/inventory.service.ts`:
1. Loads items (`id, itemTrackingType, replenishmentSystem`), company `samplingStandard`,
   Receipt-usage `itemInspectionDocumentAssignment` rows (`assignmentByItemId`), and the
   assigned documents' `inspectionFeature` rows + default sampling columns.
2. Per receipt line whose item **has a Receipt-usage assignment** (`assignmentByItemId.get(itemId)`)
   and `receivedQuantity > 0`: the assigned document is the plan gate — no assignment, no lot.
   Resolves the lot plan via `resolveSamplingPlan(plan, lotSize, standard)` from
   `packages/database/src/sampling.ts` (ANSI Z1.4 / ISO 2859-1
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
  shell: header segments for Add Sample / Complete (n passed) / Reject / Partial /
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
from the retired reject route; it passes `inspectionId` to `createQualityIssue` so the
inspection link is written with the disposition row under the issue lock).

| Decision | Physical postings |
|---|---|
| **Accept** | Completes the open remainder (serial: per-entity `issue` `jobOperationSerialComplete`, Pending-sampled and un-sampled units included, failed-sample units EXCLUDED; non-serial: one bulk posting of the op-column remaining via `jobOperationBatchComplete` or `insertProductionQuantity`+backflush) |
| **Reject** | The operator allocates the open remainder in `DispositionModal`: serial per-unit Scrap/Rework toggles, non-serial scrap+rework quantity fields; the rest is record-only. Scrap subset → one `insertScrapQuantity` (+reason, + backflush) and the serial subset flips → `Rejected`. Rework subset → ONE `trigger-rework` invoke (targets from `rework-targets`; the routing clone includes the inspection op → fresh lot → automatic re-inspection) + `recalculate jobRequirements`; reworked entities are NOT flipped. |
| **Partial** | Terminal mixed close, gated `inspected >= lotSize && passes > 0 && fails > 0`. Passed units complete; the failed set is allocated exactly like Reject (allocation restricted to failed units). |
| **Complete (n passed)** header chip | Progressive completion of passed-but-unposted units any time the lot is open (`$id.complete-passed.tsx`) — explicit button, not auto-on-pass, so verdict typos need no compensating transaction. |

Mechanics (in order, per POST):
1. Buckets recomputed server-side and validated (allocation ids must be open
   make-method entities; quantities clamped to the **op-column remaining** =
   `target − complete − scrapped − reworked`, so escape-hatch menu postings are
   never double-counted; serial divergence blocks with an error).
2. `dispositionInspection({ requireOpen: true })` closes the lot FIRST — its
   locked first read is the serialization point; a concurrent second POST
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

## Manual inspections (`20261109141852_manual-inspections.sql`)

A person inspects specific tracked entities of one item (a quality hold on stock
on hand, a re-check, a complaint). `sourceDocument = 'Manual'` is the type, and it
decides the behaviour: **hold → release / reject**, exactly a receipt lot's entity
semantics, with no job completion and no bin move (a receipt Accept does not move
stock to its shelf either).

- **Schema** — `inspection.workCenterId` (nullable, composite FK to `workCenter`,
  `ON DELETE SET NULL ("workCenterId")`) and `inspection.assignee` (nullable FK to
  `user`): where and by whom. Set on manual lots only; a Job Operation lot's work
  center and assignee are its operation's. `inspectionTrackedEntity`
  (`inspectionId`, `trackedEntityId`, unique pair) lists a manual lot's entities —
  a receipt lot finds its own through `attributes ->> 'Receipt Line'`. A manual
  lot is its own source: `sourceDocumentId` is the lot's id,
  `sourceDocumentLineId` / `sourceDocumentReadableId` are null.
- **Create** — `createManualInspection` (`@carbon/database/quality`; ERP
  operation `quality.createManualInspection`, `@mcp`, `create: "quality"`; route
  `x+/quality+/inspections.new.tsx`, drawer `ui/Inspections/ManualInspectionForm.tsx`,
  entity options from `api+/quality.inspection-tracked-entities.$itemId.ts`). The
  drawer requires an inspection plan (`manualInspectionValidator`); the operation
  still takes none, which the datasets use. The route returns the result, and the
  drawer toasts a link to the new lot (`inspectionId`) and goes back to the list. One
  transaction: entities `FOR UPDATE`, all of one item, all `Available` / `On Hold`,
  none in another open manual lot or an open receipt lot of their receipt line;
  lot size = serial count or the batches' summed quantity; sampling from the
  chosen plan via the shared `resolveLotSamplingPlans` / `insertLotSamplingPlans`
  (also used by `getOrCreateJobOperationInspection`); `Available` entities flip to
  `On Hold`. The plan must be an Active version of the item's own plans (the
  drawer lists only those). **The picked serials are the samples**: a serial lot gets one Pending
  `inspectionSample` per entity at creation (serial order, each `createdAt` a
  microsecond apart so the grid keeps it), so nothing is scanned — the ERP view's
  `scansSamples` is false for Manual lots (no Add Sample, no auto-opened scanner) and
  the MES lot view opens no scanner for one. Receipt and Job Operation lots still scan their
  samples in. A batch lot keeps the grid's anonymous columns.
- **Engine** — `holdsLotEntities(sourceDocument)` (Receipt or Manual) gates the
  sample / measurement entity flips; `dispositionInspection` reads a manual lot's
  entities from `inspectionTrackedEntity`; a serial sample must be one of the
  lot's units (`assertSampleEntityInLot`: a manual lot's entities, a receipt
  lot's receipt line). A closed manual lot is never dispositioned again, and a
  re-disposition of a receipt lot leaves alone the units another open lot holds.
  Sample and measurement saves lock the lot first and never write over a closed
  status, so a save that waited on a Cancel or a disposition is refused. `requireSource` takes one source or a list: the ERP
  Accept / Partial routes and `rejectInspection` pass `["Receipt", "Manual"]`.
  No write-off: a manual lot is always tracked. `rejectInspection` opens the NCR
  for a manual lot with the lot's own entities and no supplier or receipt line.
- **ERP** — `InspectionView`'s `hasErpDisposition` (Receipt or Manual) shows
  Accept / Reject; the list has a New button, a Manual source filter and Work
  Center / Assignee columns. Pinned by `apps/erp/test/database/manual-inspection.test.ts`.
- **Cancel and delete** (`20261109201803_manual-inspection-cancel.sql`) — manual
  lots only. `inspectionTrackedEntity.previousStatus` records each entity's
  status at create. `cancelManualInspection` (`@carbon/database/quality`;
  operation `quality.cancelManualInspection`, `update: quality`) sets the new
  terminal status `Cancelled` (in `INSPECTION_CLOSED_STATUSES`, so samples,
  measurements, gauges and document swaps are refused; `dispositionInspection`
  refuses it too, also under a racing UPDATE). It keeps what was recorded and
  leaves the MES queue (which lists Pending / In Progress only).
  `deleteManualInspection` (`delete: quality`, `@mcp destructive`) is refused once the lot has a
  non-Pending sample, a measurement, a gauge, an `inspectionHistory` row or an
  NCR link; a serial lot's Pending samples made at create are not activity. Both
  lock the lot and give every entity still On Hold its `previousStatus` (NULL →
  Available, for lots made before the column). Routes `x+/inspection+/$id.cancel.tsx`
  / `$id.delete.tsx`; triggers in the list's ⋯ row menu (`InspectionsTable`) and
  the ⋮ menu beside the inspection id (`InspectionView`), confirmed by
  `ManualInspectionConfirm`. The datasets seed
  one Cancelled manual lot each (the validator allows Cancelled on manual lots only).
- **MES lot view (receipt and manual)** — the MES queue opens a receipt lot
  in the same view as a manual one (`x+/manual-inspection.$id.tsx`,
  `ManualInspectionView`); only a job-operation lot opens around its
  operation. The loader reads a receipt lot's units from its receipt line
  (`getReceiptInspectionTrackedEntities`), prefills an inspect-all serial lot
  (`prefillInspectionSamples`) and passes `receiptVoided`, which locks the view.
  A serial receipt lot that samples a subset scans its units in
  (`ScanInspectionSample`, Add Sample; auto-opened on 0 samples). Accept runs
  `dispositionInspection` (`["Receipt", "Manual"]`, `requireOpen`); Reject is
  the `reject-inspection` posting (`@carbon/api/postings`, `rejectInspectionInput`,
  in `MES_POSTINGS`), which runs the ERP's own `rejectInspection` operation
  (`apps/erp/app/modules/postings.server.ts`), so the write-off of an untracked
  Inventory item and the optional NCR ("Open an NCR for MRB disposition", on by
  default) are the ERP's code (`x+/inspection-lot.$id.verdict.tsx`). Both
  are one-shot: Accept passes `requireOpen`, and Reject sends `requireOpen` in
  the posting (an optional field of `rejectInspectionInput`; the ERP's own
  Reject leaves it off to keep its write-off retry).
- **No timer.** Only production work is clocked: a job-operation lot's time is
  a `productionEvent` on its operation, costed and corrected like any other.
  A receipt or manual lot has no clock, no time record and no labor posting.
  An `inspectionEvent` table was built and removed (2026-11-09) on purpose:
  time that is never costed or corrected is not worth recording.

## Tracking types

All four `itemTrackingType` values support inbound inspection (the only UI gate is purchased
items — see Code map). Serial parts produce N tracked entities and the inspector scans/selects a
discrete entity per sample; non-serial (Batch/Inventory/Non-Inventory) record pass/fail with
`trackedEntityId = NULL` (same UI, no scan). Inventory items that aren't tracked have no per-row
status to flip, so a Reject posts a compensating write-off instead (see disposition).

**Reject / disposition GL posting.** A non-tracked `Inventory` reject and every NCR disposition
route their inventory value through the **`post-nonconformance` posting** (`postNonconformance`, `quality.service.ts`: `itemLedger` +
`costLedger` relief + a `journal` offset to `accountDefault.scrapAccount` for every company,
Provisional before the accounting cutover; idempotent per `(documentType, documentId)`). The reject route
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
- **Entry ergonomics (both apps, 2026-11-05)** — spec
  `.ai/specs/2026-11-05-inspection-entry-ergonomics.md`. The ERP grid and the MES matrix have
  two layouts: **By characteristic** (row per characteristic) and **By part** (row per sample,
  column per characteristic). The default is By part when samples outnumber characteristics
  (`defaultInspectionGridLayout`, decided once per page); the inspector's choice persists in
  `localStorage` (`INSPECTION_GRID_LAYOUT_STORAGE_KEY`). Enter/Tab walk the entry cells of a row
  and wrap to the next row in both layouts; on a go / no-go cell P records a pass and F a
  fail, then the selection moves on. The browser runs the server's verdict
  (`valuateMeasurement` / `toleranceLimits` / `measurementDeviation` from
  `@carbon/database/inspection-verdict`): a cell turns red with ↑ / ↓ while typed and at commit,
  and the save response replaces that client verdict (a saved cell keeps its stored status).
  Saves of one sample are queued, so the first save of an anonymous sample creates it and the
  next reuses its id. **Pass all** (attribute characteristics) and a pasted tab-separated
  block (`planPaste`, `parseMeasurementToken`, `parseAttributeToken` in `@carbon/utils`
  `inspection-entry`) send the same per-cell POSTs one at a time — no batch endpoint. A
  **Hide drawing** toggle (`INSPECTION_DRAWING_HIDDEN_STORAGE_KEY`) gives the grid the body.
  Only a fail has colour (a passed reading has no fill); a closed lot shows no spare row and
  renders go / no-go results as text. The ERP grid turns off every Table toolbar control (no
  toolbar row, no CSV export); its Sample column uses the shared Table's `meta.shrinkToFit`.
  **Positions are bound to sample ids.** `getInspection` (ERP and MES) orders the embedded
  samples by `createdAt`, then `id` (an embed has no order, and an UPDATE moves a row). The grids
  map each column/row to a sample with `placeSamples` (`@carbon/utils`): a sample keeps its
  position for the page, a new one takes the lowest free position, and cell state is keyed by
  sample id. Never map a position to `samples[index]` of a reloaded list: each save broadcasts
  `inspectionSample`, the page reloads, and the index then names another sample.
  Serial lots pass `dropMissing`: their samples come only from a scan, so a sample the loader
  no longer returns was deleted (its tracked entity removed) and its position is freed. The
  serial column count covers the highest kept position, and a save into a freed position is
  refused ("This sample was removed").
  Nothing may remount an open ERP cell editor, or what was typed while the previous save
  landed is lost: each column's editor is made once (`editorCache`) and reads the grid's
  state through a ref, and a By part row is keyed by its position (non-serial) so the
  save that creates its sample does not re-key it.
  A reading typed on a go / no-go cell (both apps) shows "This is a pass / fail check.
  Press P or F." and the next Enter neither records nor moves, so a misplaced reading
  never becomes a Pass (the MES records Pass on Enter over its Pass button).
  Readings and limits are shown and sent with `formatReading` (`@carbon/utils`), never
  `String()`, which writes 0.0000005 as "5e-7"; the ERP editor keeps 20 decimals (at 6, a
  typed 0.0000004 was saved as 0). `parseSpecNumber` reads only a plain decimal (with an
  optional exponent): "Infinity", "0x10", "12,5" and "" make the characteristic pass / fail.
  Every type other than a Measurement with a numeric nominal (Checkbox, Timestamp, Person,
  List, File, Task, Inspection) is a pass / fail cell. A failed cell is red to its edges:
  the ERP display cell paints the fill as a `before:` layer over the whole table cell, and
  the open editor fills the cell.
- **Header**: the lot's Change Document / Cancel Inspection / Delete Inspection sit
  in a ⋮ menu beside the inspection id (`lotActions` in `InspectionView`; on phones
  the same entries go to the record ⋯ sheet through `RecordAction`). The By
  characteristic grid has no Result column. A click inside `[data-gauge-picker]`
  does not make its row active: that re-render rebuilt the columns and closed the
  picker the click had opened.
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
  `quality.service.ts` wraps those engine calls with the caller's `db` (a
  route's `getDatabaseClient()`, a service function's `ctx.asSystem.pg`), and
  also holds the plan editor's server-only helpers (legacy save-payload
  translation `translateLegacyInspectionSavePayload`, the balloon-region vision
  call `runInspectionBalloonRegionVisionAnalysis`). `packages/database/src/sampling.ts`
  is the pure resolver; the engine and `post-receipt` both consume it, so they share ONE resolver copy
  (ERP's `samplingStandards.ts` client copy remains for UI previews).
  - **Voided receipt (2026-10-16):** a Receipt lot whose receipt is `Voided` is
    closed too. `assertReceiptNotVoided` (reads the receipt `FOR SHARE`, so it waits
    for a void in progress) refuses samples, measurements, gauges, document swaps and
    dispositions with "The receipt of this inspection was voided", and the `$id` loader
    passes `receiptVoided` so `InspectionView` treats the lot as closed and shows a
    "Receipt voided" badge. The lot keeps its Pending status (the `Cancelled`
    status is for manual lots only).
  - **Closed guards + linked-sample locks (2026-07-27):** the terminal
    statuses (Passed/Failed/**Partial**, and a manual lot's `Cancelled`) block `upsertInspectionSample` (guard
    is NEW — it had none) and `upsertInspectionMeasurement` ("Inspection is
    closed") and `changeInspectionDocument`. Updating an EXISTING sample (or a
    measurement on one) additionally fails when a `productionQuantity` row
    links its `inspectionSampleId` — the unit was already completed from that
    verdict; deleting the row in the ERP unlocks it (`assertSampleNotLinked`).
  - `upsertInspectionSample` — upsert precedence: by `trackedEntityId` (serial),
    else by `sampleId` (the "Overall result" row re-toggling an anonymous column
    in place), else insert a fresh anonymous sample. Entity flip + `trackedActivity`
    via the shared `applySampleEntityStatus` helper; skipped for `Pending`
    (identify-only) samples. A lot has ONE `Inspect` activity
    (`sourceDocumentId` = the lot, `sourceDocumentReadableId` = its readable id),
    made by the first verdict under an advisory lock; each unit with a verdict is
    linked to it once, as an input at the unit's quantity and with no output
    (nothing is consumed or made). The unit's status carries the result. The
    traceability graph draws an inspection as one dashed edge per unit with no
    new state (`isInspectActivity`, `metadata.ts`: the exact type `Inspect`, never a
    substring, so a production operation named "Final Inspection" keeps its output), and
    `normalizeInspectionLinks` (`utils.ts`) reads older inspections, stored as
    zero-quantity input + output self-loops, the same way. The `$id.sample.tsx` route returns the `sampleId` and,
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
    feature `recorded >= n && failed <= Ac`; Reject: the pure `isRejectableWithoutReason`
    (some feature `failed >= Re` or a failed sample; with no features, failed samples > Ac —
    the rule both apps' Reject buttons apply, pinned by `packages/database/src/quality.test.ts`)
    or a `reason`, so a lot can be rejected with nothing failed, e.g. a suspected counterfeit,
    and the reason is stored as the lot's `notes`); Accept releases every non-failed lot entity to Available (un-sampled AND
    partially-inspected Pending samples included); Reject flips all lot entities to
    Rejected (and for a non-tracked Inventory item posts an `itemLedger` `Inbound Inspection`
    negative adjustment); Partial leaves entities; always writes `inspectionHistory`.
    The lot is read `FOR UPDATE` first, before any entity, so a disposition and
    a Cancel take the same lock in the same order. Optional **`requireOpen`**
    (one-shot mode: the MES disposition and verdict routes) throws "Inspection is
    already dispositioned" when that locked read finds a closed lot — a second
    transaction waits on the lock and then sees the committed terminal status.
    ERP receipt lots do NOT pass it, preserving re-disposition (write-off retry)
    semantics; a closed manual lot is refused either way.
  - NCR auto-creation lives in the **`rejectInspection` operation** (`quality.server.ts`,
    called by `x+/inspection+/$id.reject.tsx`), optional via `createNcr`, linking through `nonConformanceInspection`; the description
    includes the `reason` and a "Failed features" block built from the lot's measurements,
    and the lot's
    `supplierId` is written as the issue's `nonConformanceSupplier` (`insertIssue`'s
    `supplierId`). The `$id` loader reads the lot's issues (`getInspectionIssues`) and the
    header links them (one: a button with the issue's readable id; several: an Issues
    menu). The header's **Create Issue** button passes the failed entities and the lot's
    `supplierId`, never the inspection: an inspection link tells `closeIssue` the lot was
    written off at reject, which is only true for a rejected lot.
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
  `packages/database/src/sampling.ts`.

## Gotchas

- **Lot-based, not entity-based.** The Phase-1 per-entity `inspection` was dropped; read
  the `20260419163058` migration (and newer) for the real shape. `receiptLineId` is unique — one
  inspection lot per received line.
- **Inspection-required tracked entities post `On Hold`, not Available.** They are not on-hand
  until released by sampling/disposition.
- **`trackedEntityId` is nullable** on samples; serial uniqueness is enforced by a *partial* index.
- **Inspection *documents* ("Inspection Plans") are authored in the quality module** (list
  at `/x/quality/inspection-plans`, editor at `/x/inspection-document/{id}`; `inspectionDocument`/
  `inspectionFeature`/`balloon` + `save_inspection_document_atomic`, newest def
  `20261001022635`) and are now *consumed* by this flow via the item's Receipt-usage
  assignment. The lot references the document **live** — measurement rows store the
  valuation at entry, so later tolerance edits never rewrite recorded results. Only
  a Draft version can be edited (see Plan versions), so an Active plan in use
  does not change under its lots.
- **A plan's name is `inspectionDocument.name`** (labelled "Inspection Name"; the
  column was `drawingNumber` until `20261109193418_inspection-plan-name.sql`, which
  also recreated `inspectionDocuments` and `inspectionPlanParts`). It names the plan
  ("R1234 Receipt"), not a drawing; pickers show `name ?? fileName`. Old backups
  map the column through `LIVE_COLUMN_RENAMES` (`packages/jobs/src/backups/renames.ts`).
- **The plan editor autosaves** — there is no Save button. A debounced effect posts the
  whole diff to `x+/inspection-document+/$id.save.tsx` while the editor is quiet (a drag
  saves when it ends), one save at a time; the toolbar shows Saving… / Saved / Could not
  save, and leaving the page first flushes the save (`useBlocker`). The editor **mints the
  ids** of the characteristics and balloons it creates (`ift_…` / `bbn_…`, `newFeatureId` /
  `newBalloonId` in `ui/InspectionDocument/autosave.ts`), and the RPC inserts with them
  (`20261001022635_inspection-plan-client-ids.sql`; a taken id fails the insert, it never
  overwrites). So a row keeps one id from the moment it is drawn: an id the server has not
  created yet is in the editor's unsaved set and goes out as a create, every edit marks its
  row dirty, and `mergeSaveResponse` (tested) only swaps in the server copy of rows
  untouched since the save went out. Deletes are always queued once a row has left the
  browser (deleting an id the server never created is a no-op). Other callers may still
  send `tempId` / `tempBalloonAnchorId` and read the `featureIdMap` / `balloonAnchorIdMap`
  back. A PDF upload goes through the same save. The route skips revalidation after a
  save (the response carries the rows).
- **Features saved together share one `createdAt`** (the RPC is one transaction, `NOW()`
  is fixed), so `ORDER BY "createdAt"` alone returns them in heap order, and an UPDATE
  moves a row to the end. Anything listing features must break the tie — the editor sorts
  by `createdAt`, then label (natural), then id, on load only.
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
