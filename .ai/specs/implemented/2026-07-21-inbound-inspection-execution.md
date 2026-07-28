# Inbound Inspection Execution — Drawing + Features Grid

> Status: implemented (branch feat/mes-assembly, migration 20260722040401)
> Author: Brad Barbin (designed with Claude)
> Date: 2026-07-21

Research: [.ai/research/inbound-inspection-execution.md](../research/inbound-inspection-execution.md)

## TLDR

Merge Carbon's two disconnected quality systems into one inbound inspection
execution screen: the `inboundInspection` lot (AQL sampling, pass/fail samples,
Accept/Reject/Partial, reject→NCR) gains the item's `inspectionDocument`
(ballooned PDF + `inspectionFeature` nominal/tolerance features) as its
inspection plan. The lot opens in a new full-screen split view — PDF drawing
with balloon overlay beside an editable features × samples measurement grid
(inventory-count editing pattern) — with per-feature AQL sampling,
auto-valuation of readings against tolerance, derived sample status, and the
existing human-only disposition + NCR flow. The view is built as a reusable
component so the same UI can be attached to job operations in MES next
(AssemblyView pattern; that attachment is out of scope here).

> **Update 2026-07-26 (2):** the sampling hierarchy changed after this spec —
> the per-item `itemSamplingPlan` tier was **removed** (it "just adds
> confusion"). Sampling now lives entirely in the inspection plan: a feature's
> own rule → the document's default rule (six `sampling*` columns on
> `inspectionDocument`, edited in the document editor) → All. Migration
> `20260726231401_document-sampling-default.sql` backfilled item plans onto
> their documents and dropped the table.

> **Update 2026-07-26:** the MES attachment shipped. Job operations with
> `operationType = 'Inspection'` execute at `/x/inspection/{jobOperationId}` in
> apps/mes against the same (now source-generic) inspection tables; the engine
> moved to `@carbon/database/quality` so both apps share it. See
> `.claude/rules/inspection-system.md` → "Job Operation → inspection flow".

## Problem Statement

Today an inspector receiving parts gets a lot drawer with anonymous Pass/Fail
buttons — no connection to *what* to inspect. The ballooned drawing with its
measurable features (`inspectionDocument`/`inspectionFeature`/`balloon`,
built for FAI) is never surfaced at receiving, so inspectors work from paper
prints or tribal knowledge, and a "Fail" records no evidence of which dimension
failed or by how much. Sampling is one lot-level sample size applied blindly,
while every reference system (SAP QM, 1factory, High QA) resolves sampling per
feature — a critical bore and a cosmetic chamfer should not share a
sample size. NCRs created from rejects carry no measurement data for MRB.

Concrete example: a lot of 200 machined housings arrives. The plan says sample
32. The inspector taps Fail on sample 7 with a note "OD oversize". The NCR
says "Rejected lot II000042" — no feature, no reading, no tolerance. MRB
re-measures everything from scratch.

## Proposed Solution

One execution screen at `/x/inbound-inspection/{id}` (full-screen route tree,
`handle.module: "quality"`), replacing the `InboundInspectionLotView` drawer:

- **Left pane**: the assigned inspection document's PDF rendered with
  `react-pdf` + read-only balloon overlay (reusing the viewer pieces of
  `InspectionDocumentEditor`). Clicking a balloon focuses the matching grid
  row; focusing a grid row highlights its balloon (DISCUS/High QA pattern).
- **Right pane**: an editable grid — one row per `inspectionFeature` (balloon
  number, description, nominal, +tol/−tol, unit, per-feature n/Ac/Re, pass
  count), one column per sample. Cells are `EditableNumber`-style inputs with
  the inventory-count keyboard navigation (Enter/Tab advance). Out-of-tolerance
  values color the cell red at entry (Net-Inspect pattern). The grid is ragged:
  cells beyond a feature's own resolved sample size are disabled.
- **Sampling** resolves **per feature**: feature-level rule → item's
  `itemSamplingPlan` → company default ("All"). Resolved n/Ac/Re per feature
  are stored on the lot at receipt.
- **Valuation** is automatic and strict: an out-of-tolerance reading fails the
  measurement; a sample's status is fully **derived** (any failed required
  measurement ⇒ Failed; all required cells filled and passing ⇒ Passed); no
  sample-level override. Lot disposition (Accept/Reject/Partial) remains a
  human decision; deviations are resolved through MRB/NCR, not overrides.
- **Serial** lots create sample columns by scanning (existing
  `ScanInspectionSample` flow); non-serial lots pre-create anonymous columns.
  Entity status side effects (Available/Rejected) now follow the derived
  sample status and re-derive on cell edits while the lot is non-terminal.
- **NCR** creation on reject is unchanged in mechanism but enriched: the issue
  carries the failed features with measured vs. nominal/tolerance values.
- **Fallback**: items with no assigned inspection document keep today's flow —
  manual Pass/Fail per sample, no grid, no drawing.

Document assignment lives on the item's Quality tab as two new cards:
an **Inspection Documents** card (list + "New" action) and an **Assignments**
card with usage-slot dropdowns — v1 ships only the **Receipt** slot; the model
extends to FAI/Production slots later without schema change.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sampling granularity | Per feature (feature rule → item plan → "All" default) | Industry end-state (SAP/1factory/High QA); user decision Q1. Flat default with per-child override, no matrix config |
| Plan reference | Live: lot stores `inspectionDocumentId` only; no feature snapshot | User decision Q2b. Measurement rows store value + valuation at entry, so later tolerance edits don't silently rewrite recorded results |
| Document selection | `itemInspectionDocumentAssignment` junction (itemId × usage), Receipt slot only in v1, edited on item Quality tab | User decision Q2a. Extensible to FAI/Production via new enum values, mirroring SAP task-list usage without a per-receipt choice |
| Valuation roll-up | Strict: cell auto-valuated vs tolerance, sample status fully derived, no override; disposition human-only | User decision Q3 (SAP: auto-valuate readings, never auto-reject the lot; overrides happen at MRB) |
| Serial sample identity | Scan-first: scanning creates the sample column; non-serial pre-creates anonymous columns to max n | User decision Q4. Preserves sampled-once partial unique index and entity side effects |
| Screen form factor | Dedicated full-screen tree `x+/inbound-inspection+/`, drawer retired | User decision Q5. Matches `x+/inspection+`/`x+/assembly+` editor pattern from `.ai/lessons.md` |
| Execution view reuse | `InboundInspectionView` built as a data-prop component (AssemblyView pattern) | Next step on this branch surfaces the same UI in MES against job operations; that attachment is out of this spec's scope |
| Grid editing pattern | Inventory-count pattern: shared `Table` + `~/components/Editable` cells, `onCellEdit` posting per cell, spreadsheet keyboard nav | Explicit product direction; proven pattern in `InventoryCountLines.tsx` |
| Feature cell types | Numeric features (nominal/tolerance) → number cell; non-numeric feature types → Pass/Fail toggle cell | 1factory Variable vs Attribute features |
| Multi-tenancy (heuristic 1) | New tables carry `companyId` + RLS; PKs follow the inbound-inspection family (surrogate `id` PK, not composite) | Sibling tables `inboundInspection`/`inboundInspectionSample` use `id` PKs (Phase-2 rebuild, newest pattern for this subsystem); `itemInspectionDocumentAssignment` keys on `(itemId, usage, companyId)` like `itemSamplingPlan` keys on `itemId` |
| Service shape (heuristic 2) | New reads in `quality.service.ts` (client first, `{data,error}`); write orchestration in `quality.server.ts` | Matches `upsertInboundInspectionSample`/`dispositionInboundInspection` |
| RLS (heuristic 3) | SELECT/INSERT/UPDATE/DELETE policies gated by `quality_view/create/update/delete` on all new tables | Same as existing inbound-inspection tables |
| Permissions (heuristic 4) | View = `quality_view`; record/disposition/assign = `quality_update` via `requirePermissions` | Same scopes the current routes use |
| Forms (heuristic 5) | Assignment card uses `ValidatedForm` + zod validator + route action; grid cells post per-cell like inventory count (not a form) | Grid precedent is `onCellEdit` fetch, forms precedent is everywhere else |
| Module layout (heuristic 6) | New validators in `quality.models.ts`, services in `quality.service.ts`/`quality.server.ts`, UI in `quality/ui/InboundInspections/`; inspection-document services stay in production module and are imported | No new module; inspection documents already live in production and are surfaced under quality nav |
| Backward compatibility (heuristic 7) | No frozen surface touched. Old drawer routes replaced; in-flight lots (no `inspectionDocumentId`) run the fallback flow untouched | Inbound inspection is a recent internal surface; API docs regenerate from schema |
| Four-eyes | `enforceInspectionFourEyes` warning behavior preserved on the new screen | Preserve behavior |
| Sampling engine | Extend both copies (`sampling-engine.ts` edge + `samplingStandards.ts` app) with per-feature resolution; keep manual sync discipline | Existing dual-copy reality; consolidating is out of scope |

## Data Model Changes

New enum + one column, three new tables, feature sampling columns:

```sql
-- Usage slots for item-level inspection document assignment (extensible: 'FAI', 'Production' later)
CREATE TYPE "inspectionDocumentUsage" AS ENUM ('Receipt');

-- Which document drives which usage for an item (flat assignment, per-child override pattern)
CREATE TABLE "itemInspectionDocumentAssignment" (
    "itemId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "usage" "inspectionDocumentUsage" NOT NULL,
    "inspectionDocumentId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "itemInspectionDocumentAssignment_pkey" PRIMARY KEY ("itemId", "usage", "companyId"),
    CONSTRAINT "itemInspectionDocumentAssignment_itemId_fkey" FOREIGN KEY ("itemId", "companyId") REFERENCES "item"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "itemInspectionDocumentAssignment_document_fkey" FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE CASCADE,
    CONSTRAINT "itemInspectionDocumentAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

-- Per-feature sampling rule (nullable = inherit itemSamplingPlan; mirrors itemSamplingPlan fields)
ALTER TABLE "inspectionFeature"
  ADD COLUMN "samplingPlanType" "samplingPlanType",
  ADD COLUMN "samplingSampleSize" INTEGER,
  ADD COLUMN "samplingPercentage" NUMERIC,
  ADD COLUMN "samplingAql" NUMERIC,
  ADD COLUMN "samplingInspectionLevel" "inspectionLevel",
  ADD COLUMN "samplingSeverity" "samplingSeverity";

-- The document assigned to a lot at receipt (live reference)
ALTER TABLE "inboundInspection"
  ADD COLUMN "inspectionDocumentId" TEXT REFERENCES "inspectionDocument"("id") ON DELETE SET NULL;

-- Per-lot, per-feature resolved sampling plan (computed at receipt; lazily reconciled
-- for features added to the live document while the lot is open)
CREATE TABLE "inboundInspectionFeature" (
    "id" TEXT NOT NULL DEFAULT id('iif'),
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "inboundInspectionId" TEXT NOT NULL REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
    "inspectionFeatureId" TEXT NOT NULL REFERENCES "inspectionFeature"("id") ON DELETE CASCADE,
    "sampleSize" INTEGER NOT NULL,
    "acceptanceNumber" INTEGER NOT NULL,
    "rejectionNumber" INTEGER NOT NULL,
    "codeLetter" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "inboundInspectionFeature_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inboundInspectionFeature_unique" UNIQUE ("inboundInspectionId", "inspectionFeatureId")
);

-- One recorded reading per sample × feature; value AND valuation stored at entry
-- so later tolerance edits never rewrite recorded results
CREATE TABLE "inboundInspectionMeasurement" (
    "id" TEXT NOT NULL DEFAULT id('iim'),
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "inboundInspectionId" TEXT NOT NULL REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
    "inboundInspectionSampleId" TEXT NOT NULL REFERENCES "inboundInspectionSample"("id") ON DELETE CASCADE,
    "inspectionFeatureId" TEXT NOT NULL REFERENCES "inspectionFeature"("id") ON DELETE CASCADE,
    "value" NUMERIC,                                  -- numeric features; NULL for attribute features
    "status" "inboundInspectionSampleStatus" NOT NULL DEFAULT 'Pending',  -- valuation at entry
    "notes" TEXT,
    "inspectedBy" TEXT REFERENCES "user"("id"),
    "inspectedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "inboundInspectionMeasurement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inboundInspectionMeasurement_unique" UNIQUE ("inboundInspectionSampleId", "inspectionFeatureId")
);

-- RLS on all three: standard SELECT/INSERT/UPDATE/DELETE policies gated by
-- quality_view/create/update/delete + companyId, matching inboundInspectionSample.
```

Notes:
- `inboundInspection`'s existing lot-level snapshot columns (`sampleSize`,
  `acceptanceNumber`, …) remain and keep powering the fallback (no-document)
  flow; when a document is assigned they are set to the max/derived values
  across features for list-view display.
- No change to `inboundInspectionSample`; its `status` becomes derived (server
  logic, not schema) when a document is assigned.
- Migration is idempotent (guards on every DDL), forward-dated, randomized
  HHMMSS. Run `pnpm run generate:types` after.

## API / Service Changes

**`post-receipt` edge function** (`packages/database/supabase/functions/post-receipt/index.ts`):
- After resolving the lot plan: look up `itemInspectionDocumentAssignment`
  (usage `Receipt`) for the item; if found, set `inspectionDocumentId` on the
  `inboundInspection` insert, load the document's features, resolve each
  feature's plan (feature rule → item plan → All) via the extended
  `resolveSamplingPlan`, and insert `inboundInspectionFeature` rows.

**Sampling engine** (`shared/sampling-engine.ts` + app copy `samplingStandards.ts`):
- New `resolveFeatureSamplingPlan(feature, itemPlan, lotSize, standard)`
  helper wrapping the existing `resolveSamplingPlan` with the inheritance
  chain. Both copies updated together.

**`quality.service.ts`** (client-first, `{data,error}`):
- `getInboundInspectionFeatures(client, inboundInspectionId, companyId)` —
  resolved per-feature plans joined to live `inspectionFeature` + `balloon`.
- `getInboundInspectionMeasurements(client, inboundInspectionId, companyId)`.
- `getItemInspectionDocumentAssignments(client, itemId, companyId)` /
  `upsertItemInspectionDocumentAssignment(...)`.

**`quality.server.ts`**:
- `upsertInboundInspectionMeasurement` — validates + valuates the reading
  against the feature's live nominal/tolerance at entry (numeric: in/out of
  tolerance; attribute: explicit pass/fail), writes the measurement, then
  **derives the sample status** (any Failed required measurement ⇒ Failed; all
  required filled + passing ⇒ Passed; else Pending) and applies the existing
  entity side effects (flip `trackedEntity` status, `trackedActivity`) through
  the same code path as `upsertInboundInspectionSample`. Re-derivation on edit
  is allowed only while the lot is non-terminal.
- `reconcileInboundInspectionFeatures` — on lot load, upserts
  `inboundInspectionFeature` rows for features added to the live document
  since receipt (and leaves removed-feature rows in place, ignored by the grid).
- `dispositionInboundInspection` — gating updated for per-feature sampling:
  `canAccept` ⇔ every feature has ≥ its `sampleSize` recorded measurements and
  fails ≤ its `acceptanceNumber`; `canReject` ⇔ any feature's fails ≥ its
  `rejectionNumber` (or any failed sample, matching today's semantics for the
  fallback flow); `canPartial` unchanged. Fallback flow keeps lot-level gating.
- Reject route NCR enrichment: issue description/content includes a failed-
  feature table (balloon label, nominal ± tolerance, measured values, sample
  ids); associations unchanged (`nonConformanceInboundInspection`,
  `nonConformanceReceiptLine`, tracked entities).

**`quality.models.ts`**: `inboundInspectionMeasurementValidator`,
`itemInspectionDocumentAssignmentValidator`, `inspectionDocumentUsage` const;
`inspectionFeature` sampling fields added to the feature validator (production
module's `saveInspectionDocumentAtomic` RPC extended to persist them —
new migration forking the newest RPC definition).

**Routes** — new tree `apps/erp/app/routes/x+/inbound-inspection+/`:
- `_layout.tsx` (`handle.module: "quality"`), `$id.tsx` (loader: lot +
  features + measurements + samples + document URL; renders
  `InboundInspectionView`), `$id.sample.tsx` (add/scan sample),
  `$id.measurement.tsx` (per-cell upsert action), `$id.accept.tsx`,
  `$id.reject.tsx`, `$id.partial.tsx` (moved from `x+/quality+/`), plus
  `$id.document.tsx` (swap assigned document while non-terminal).
- `x+/quality+/inbound-inspections.tsx` row click navigates to
  `/x/inbound-inspection/{id}`; old `$id.*` drawer routes removed.
- Item Quality tab route (`x+/{part,material,tool,consumable}+/$itemId.quality.tsx`):
  loads documents + assignments; new action for assignment upsert.
- `path.ts`: `path.to.inboundInspection(id)` + measurement/sample/document
  action paths.

## UI Changes

- **`InboundInspectionView`** (new, `quality/ui/InboundInspections/`) — the
  reusable split-view component (data props, no loaders inside): resizable
  panels; left = PDF pane, right = grid + header (progress, plan summary,
  disposition buttons, four-eyes warning). Replaces
  `InboundInspectionLotView` (deleted). MES will consume this component later.
- **`InspectionDrawingPane`** — `react-pdf` viewer + read-only balloon
  overlay extracted/adapted from `InspectionDocumentEditor`; balloon click →
  scroll/focus grid row; active row → highlighted balloon; page switcher.
- **`InspectionMeasurementGrid`** — features × samples grid on the shared
  `Table` + `~/components/Editable` cells (inventory-count pattern:
  `onCellEdit` per-cell POST returning `{data,error}` for optimistic revert,
  Enter/Tab keyboard nav). Row header: balloon number, description, nominal,
  ±tol, unit, n/Ac/Re, pass-count chip. Cell states: empty, passed (default),
  failed (red), disabled (beyond feature's n). Attribute features render a
  Pass/Fail toggle cell. Column header: sample number or scanned entity
  `readableId`; "Add sample" column button (serial → `ScanInspectionSample`
  scan/select modal, unchanged; non-serial columns are pre-created).
- **Fallback view**: no assigned document → today's samples table + manual
  Pass/Fail (`ScanInspectionSample` with Pass/Fail buttons) inside the new
  full-screen route, so the drawer can still be retired.
- **Item Quality tab** — two new cards above/beside `SamplingPlanForm`:
  - *Inspection Documents*: list of the item's documents (name, drawing
    number, version, feature count), card action "New Inspection Document" →
    creates + navigates to the editor; row click opens the editor.
  - *Assignments*: one dropdown per usage slot; v1 shows only **Receipt**
    (options = the item's documents + "None"); designed so FAI/Production
    slots are additive.
- **Inspection document editor** (production module): feature properties panel
  gains the optional sampling-rule fields (type/size/percentage/AQL/level/
  severity) with "Inherit item plan" as the null state.
- **`RejectLotModal`**: unchanged mechanics (NCR checkbox default on, issue
  type picker); preview of the failed-feature summary that will be attached.

## Acceptance Criteria

- [ ] Posting a receipt for an item with `requiresInspection`, an assigned
      Receipt inspection document, and a lot of 200 creates an
      `inboundInspection` with `inspectionDocumentId` set and one
      `inboundInspectionFeature` row per document feature, each with its own
      resolved n/Ac/Re (feature rule when set, else item plan, else All).
- [ ] Opening `/x/inbound-inspection/{id}` shows the PDF with balloons beside
      the grid; clicking balloon 5 focuses feature 5's row; focusing a row
      highlights its balloon.
- [ ] Typing an in-tolerance value into a cell saves it (Passed), advances
      focus on Enter/Tab; an out-of-tolerance value renders red and marks the
      measurement Failed with no override control at cell or sample level.
- [ ] A sample whose required cells are all filled and passing shows Passed;
      entering one out-of-tolerance value flips it to Failed; correcting that
      value back in-tolerance re-derives it to Passed (lot non-terminal), and
      for a serial sample the tracked entity's status follows each transition.
- [ ] For a serial lot, "Add sample" requires scan/select and creates a column
      headed by the entity `readableId`; scanning the same entity twice is
      rejected. A non-serial lot shows pre-created columns up to max n.
- [ ] A feature with n=8 accepts no more than 8 measurements (cells beyond n
      disabled); Accept is disabled until every feature has ≥ its own n
      measurements with fails ≤ its Ac; Reject enables when any feature's
      fails ≥ its Re.
- [ ] Rejecting with "Open an NCR" creates the issue with the failed-feature
      table (balloon, nominal ± tol, measured values) in its content, plus the
      existing associations, and redirects to the issue.
- [ ] Editing a feature's tolerance in the document editor mid-lot changes the
      grid's displayed tolerance but does not change any recorded
      measurement's stored status.
- [ ] An item with no assigned document still gets a lot at receipt and the
      full-screen view shows the manual Pass/Fail flow (no grid, no PDF);
      disposition gating matches today's lot-level rules.
- [ ] Item Quality tab shows the two cards; creating a document from the card
      lands in the editor; assigning it to Receipt makes the next receipt pick
      it up.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/erp` passes;
      `pnpm run generate:types` run after migrations.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Dual sampling-engine copies (edge + app) drift when adding per-feature resolution | Med | Change both in the same commit; shared test vectors in the app copy's tests |
| Live document reference: feature deleted mid-lot orphans measurements | Med | Grid ignores `inboundInspectionFeature` rows whose live feature is gone; measurements retained for audit; completeness gating recomputed from live features |
| Derived sample status flipping tracked-entity state on every edit could spam `trackedActivity` | Low | Only write activity on actual status transitions, not on every cell save |
| Grid performance (e.g. 60 features × 50 samples) with per-cell POSTs | Med | Per-cell save matches inventory-count precedent; virtualize rows if needed; measurements loaded once and patched optimistically |
| `saveInspectionDocumentAtomic` RPC change (new feature columns) must fork the newest definition | Med | Follow migration-function-redefinition rule: fork latest, `DROP IF EXISTS`, preserve attributes |
| In-flight lots at deploy have no document/feature rows | Low | `inspectionDocumentId` null ⇒ fallback flow; no backfill needed |

## Open Questions

> All resolved with the user before this spec was written (2026-07-21).

- [x] Sampling granularity: lot-level (today) or per-feature? —
      **Answer:** per-feature. Feature-level rule inherits from
      `itemSamplingPlan`, then company default "All"; grid gates completeness
      per feature. (Q1)
- [x] Which inspection document drives an inbound lot? — **Answer:** item
      Quality tab gets an Inspection Documents card (list + create) and an
      Assignments card of usage-slot dropdowns; v1 ships only the **Receipt**
      slot, modeled as an extensible junction (`itemId × usage → documentId`)
      so FAI/Production slots come later without schema change. Job-operation
      attachment (MES) is the next branch step, out of this spec. (Q2a)
- [x] Snapshot features at receipt or reference live? — **Answer:** live; the
      lot stores only `inspectionDocumentId`. Measurements store value +
      valuation at entry, so tolerance edits never silently rewrite recorded
      results. (Q2b)
- [x] Out-of-tolerance semantics and sample status source? — **Answer:**
      strict. Readings auto-valuate; sample status is fully derived with no
      override; deviations are handled at lot disposition via MRB/NCR. (Q3)
- [x] Serial sample identity in the grid? — **Answer:** scan-first; scanning
      creates the sample column; non-serial lots pre-create anonymous columns.
      (Q4)
- [x] Screen form factor? — **Answer:** dedicated full-screen route tree
      `x+/inbound-inspection+/` (`handle.module: "quality"`); the ModalDrawer
      is retired. (Q5)

## Changelog

- 2026-07-22: Generalized to source documents (user directive): the lot family
  is renamed to `inspection`/`inspectionSample`/`inspectionSamplingPlan`/
  `inspectionMeasurement`/`inspectionHistory` with `sourceDocument` (enum:
  Receipt, Job Operation) + `sourceDocumentId`/`sourceDocumentLineId`/
  `sourceDocumentReadableId` replacing `receiptId`/`receiptLineId`; the
  submodule is renamed **Inspections** (list `/x/quality/inspections`,
  execution `/x/inspection/{id}`, document editor moved to
  `/x/inspection-document/{id}`); new-company sequence prefix INS (existing
  companies keep II). Plan: .ai/plans/2026-07-22-inspections-refactor.md.
- 2026-07-21: Created after research
  (`.ai/research/inbound-inspection-execution.md`) and grill interview; all
  six open questions resolved with Brad before writing.
