# Operation Instruction Sources — per-type source pickers on the Bill of Process

> Status: implemented (branch feat/mes-assembly, migration 20260721022847)
> Author: Brad Barbin (design) + Claude (spec)
> Date: 2026-07-21
> Depends on: [2026-07-20-operation-type-consolidation.md](2026-07-20-operation-type-consolidation.md) (implemented)
> Extends: [2026-07-14-mes-execution-views.md](2026-07-14-mes-execution-views.md) §5.4 (accepted ADR — inspection plan link)
> Related: `.ai/plans/2026-07-20-work-instructions-refactor.md` (Workstreams A + B already landed on this branch)

## TLDR

Generalize the procedure pattern to the other operation types. Today a **Process**
operation can link a procedure: the method/quote editors lock Steps, Parameters,
and Work Instructions ("inherited from the procedure"), get-method materializes
the procedure's content onto the **job** operation, and the job editor offers
re-sync instead of locking. This spec gives **Assembly** operations the same
pattern with an **Assembly Instruction** picker (resolves to steps at get-method
time, re-sync on jobs), and **Inspection** operations an **Inspection Document**
picker (a plan-link pointer per PRD §5.4 — features never materialize as steps).
Both pickers are scoped to the parent make method's item. Time fields slim down
by type: Assembly and Inspection show Setup + Labor only (no Machine, no machine
rate), and the Procedure card shows only for Process operations.

## Problem Statement

- The BoP editors expose one instruction source (Procedure) to every in-house
  operation type, even though a procedure is the wrong source for an Assembly op
  (its steps come from a published 3D assembly instruction) and for an
  Inspection op (its features live on an inspection document).
- The current assembly wiring is a one-off: `AssemblyStepsSource` (internal-flag
  gated) manually syncs instruction steps into `methodOperationStep` rows at
  authoring time — duplicating content on the template instead of inheriting it
  at get-method time like procedures do, and auto-resolving "the item's one
  instruction" instead of letting the author pick.
- Inspection operations have no way to declare *which* inspection document they
  execute. PRD §5.4 already accepted the design (explicit nullable FK,
  propagated by get-method, picker defaults by item) but it was deferred out of
  the classification migration.
- Assembly and Inspection operations show and *require* Machine time/unit (and
  machine rate on job/quote), which is noise — both are setup + labor work.

## Proposed Solution

One rule set, keyed on `operationType`:

| operationType | Source card | Stored FK | Method/Quote editors | Job editor | get-method → job | Time fields |
|---|---|---|---|---|---|---|
| Process | Procedure (existing) | `procedureId` | Lock Instructions + Parameters + Steps when set (existing) | No lock; "Sync Procedure" (existing) | Materialize procedure steps/params/content (existing) | Setup + Labor + Machine (+ rates) |
| Assembly | **Assembly Instruction (new picker)** | `assemblyInstructionId` | **Lock Steps when set** | No lock; **"Sync Assembly Steps"** (existing sync-bop action, per-operation) | **Materialize instruction steps (+ model slide + material↔step links) when set; else copy method steps** | **Setup + Labor only** |
| Inspection | **Inspection Document (new picker)** | `inspectionDocumentId` (new column) | No lock (pointer only — no step content to inherit) | No lock | **Copy the pointer only** — features never become steps (PRD §5.4) | **Setup + Labor only** |
| Outside Processing | none | — | Tabs already disabled | Tabs already disabled | — | none (supplier costing, existing) |

- Every source card renders **conditionally on its type** and the Procedure card
  disappears for Assembly / Inspection / Outside Processing.
- Both new pickers are **scoped to the parent item**: `assemblyInstruction.itemId
  = <make method itemId>` and `inspectionDocument.partId = <make method itemId>`
  (both editors already have the make-method itemId in scope — it's what
  `AssemblyStepsSource` receives today).
- Switching `operationType` **clears the now-inapplicable pointers** in form
  state, and the operation upsert normalizes server-side (a pointer that doesn't
  match the type is written as `null`) so stale links can't survive a type change.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Assembly inheritance model | Method/quote carry the FK + lock Steps; **jobs materialize at get-method time** (mirror of `insertProcedureDataForJobOperation`) | Brad's directive ("inherit from the procedure at get-method time… similar approach for Assembly"). Kills the author-time duplication of instruction steps into `methodOperationStep`. |
| Assembly lock scope | **Steps only** (not Instructions/Parameters) | An assembly instruction provides steps (+ slides/parts); it has no parameters and no work-instruction doc. Locking only what is inherited keeps params/instructions authorable on Assembly ops. Procedure locks all three because a procedure has all three. |
| Inspection inheritance model | **Pointer only** — no materialization, no locking | PRD §5.4 (accepted): features are `inspectionFeature` rows executed by the Phase-3 inspection view against `jobOperationInspectionRecord`; "not `jobOperationStep` rows". The FK is the plan link. |
| `inspectionDocumentId` columns | Nullable TEXT FK on `methodOperation`, `quoteOperation`, `jobOperation` → `inspectionDocument(id)` ON DELETE SET NULL + indexes | Exactly PRD §5.4's shape ("explicit FK, not resolve-by-item"); SET NULL matches the assemblyInstructionId precedent (a deleted source shouldn't delete operations — note `procedureId`'s CASCADE is the odd one out, left as-is). Single-column FK is legal: `inspectionDocument.id` carries a UNIQUE constraint. |
| `quoteOperation.assemblyInstructionId` | Add it (same shape as method/job) | Quote ops can be typed Assembly since the consolidation; the pointer must survive item→quote→job. `quoteLineToJob` already copies the column name — it just doesn't exist on the source yet. |
| Picker options | All statuses/versions for the item, with status badge (assembly) / version + drawing number (inspection) | Parity with the Procedure picker (shows Draft/Active/Archived with badges). The **stored FK is the source of truth**; resolve-by-item is only how the list is scoped (PRD §5.4). |
| Job-side assembly sync | Reuse the existing `assembly+/$id.sync-bop` action (per-operation, Published-only guard, provenance-marker reconcile) via a "Sync Assembly Steps" affordance in the assembly card | The machinery exists and is provenance-safe; the card replaces the internal-flag `AssemblyStepsSource` widget in both editors. |
| get-method materialization vs sync guard | get-method materializes **whatever instruction is linked** (any status), like procedures materialize Draft procedures; the manual job-side sync keeps its Published-only guard | The author's explicit link is authoritative; blocking job creation on instruction status would silently produce step-less operations. |
| Machine fields | Hidden AND not required unless `operationType === "Process"`; Setup/Labor stay `!== "Outside Processing"`; job/quote Costing card keeps laborRate + overheadRate for Assembly/Inspection, hides machineRate | Brad's directive ("only setup and labor"). `=== "Process"` here is correct (a per-type field set, not the subcontract boundary — a future in-house type decides its own fields); the subcontract invariant (`!== 'Outside Processing'`) still governs costing/scheduling/PO logic. |
| Procedure card visibility | Only when `operationType === "Process"` | Brad's directive. |
| Internal-flag gating | **Neither card is flag-gated** (Brad, 2026-07-21: "get rid of the isInternal flag on the assembly card") | The BoP assembly card ships for everyone; the assemblies module's own `requireAssembliesInternal` route gate is untouched by this spec. |
| H1 multi-tenancy | New columns live on existing tenant tables; FKs single-column against UNIQUE ids (matching `assemblyInstructionId` precedent) | No new tables. |
| H2 service shape | New reads follow `(client, …) → {data,error}`; new API routes mirror `api+/production.assembly-for-item.$itemId.ts` | Existing conventions. |
| H3 RLS | Unchanged — new columns on tables with existing policies | No policy references pointers. |
| H4 permissions | Pickers/API routes gate like their editors (parts/production/sales view); sync keeps its target-dependent gate | Existing. |
| H5 forms | New `AssemblyInstruction` + `InspectionDocument` comboboxes in `~/components/Form` mirroring `Procedure.tsx`; validators gain the two optional fields | Existing pattern. |
| H6 module layout | Service additions in `production.service.ts`; models in the three `*.models.ts` | One service per module. |
| H7 backward compatibility | Additive columns; get-method copy-list additions; legacy method-level synced assembly steps become dead weight (skipped at get-method) — harmless, internal-only data | No breaking surface. |

## Data Model Changes

One new migration (`pnpm db:migrate:new operation-instruction-sources`), guarded/idempotent:

```sql
-- Assembly pointer for quotes (method/job already have it)
ALTER TABLE "quoteOperation" ADD COLUMN IF NOT EXISTS "assemblyInstructionId" TEXT;
ALTER TABLE "quoteOperation" ADD CONSTRAINT "quoteOperation_assemblyInstructionId_fkey"
  FOREIGN KEY ("assemblyInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "quoteOperation_assemblyInstructionId_idx" ON "quoteOperation"("assemblyInstructionId");

-- Inspection plan link (PRD §5.4) on all three operation tables
ALTER TABLE "methodOperation" ADD COLUMN IF NOT EXISTS "inspectionDocumentId" TEXT;
ALTER TABLE "methodOperation" ADD CONSTRAINT "methodOperation_inspectionDocumentId_fkey"
  FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "methodOperation_inspectionDocumentId_idx" ON "methodOperation"("inspectionDocumentId");
-- … same for "quoteOperation" and "jobOperation" (ADD CONSTRAINT guarded via DO $$ … duplicate_object)
```

No enum changes, no view changes (`jobOperationsWithMakeMethods` etc. project
`t.*` and pick the new columns up automatically on regen), no RLS changes.
`pnpm run generate:types` after.

## API / Service Changes

**New reads (production.service.ts):**
- `getAssemblyInstructionsForItem(client, itemId, companyId)` — thin wrapper over
  the existing `getAssemblyInstructions` (`production.service.ts:4077`) with
  `itemId` + ordered `updatedAt DESC`, selecting `id, name, version, status`.
- `getInspectionDocumentsForItem(client, itemId, companyId)` —
  `inspectionDocument` filtered `.eq("partId", itemId)`, selecting
  `id, fileName, drawingNumber, version`.

**New API routes (company-cached like `api+/production.procedures.ts`):**
- `api+/production.assembly-instructions.$itemId.ts` — list for the picker.
- `api+/production.inspection-documents.$itemId.ts` — list for the picker.
- (The existing single-resolver `api+/production.assembly-for-item.$itemId.ts`
  stays for MES/other callers; the picker uses the list.)

**get-method edge function (`packages/database/supabase/functions/get-method/index.ts`):**
- New `insertAssemblyDataForJobOperation(...)` mirroring
  `insertProcedureDataForJobOperation` (`:6167-6242`): reads
  `assemblyInstructionStep` rows; inserts `jobOperationStep` rows carrying the
  typed fields **and the `assemblyInstructionStepId` provenance marker** (so the
  job-side re-sync reconciles instead of duplicating); attaches the
  instruction's `modelUploadId` as a step slide; resolves
  `assemblyInstructionStepMaterial.itemId` against the job's just-created
  `jobMaterial` rows into `jobMaterialStep` links (same resolution the app-side
  sync performs at `production.service.ts:5801-5947`).
- Branch order anywhere a job operation is created (`itemToJob :790-939`,
  `itemToJobMakeMethod :1553+`, `quoteLineToJob`):
  `if (procedureId) materialize procedure; else if (assemblyInstructionId)
  materialize assembly; else copy source steps`.
- Method→method (`itemToItem :336`) and →quote (`itemToQuoteLine :2349`,
  `itemToQuoteMakeMethod :2876`) step-copy guards widen from `if (!procedureId)`
  to `if (!procedureId && !assemblyInstructionId)` (templates/quotes carry
  pointers, never materialized content).
- **Copy-lists**: add `assemblyInstructionId` + `inspectionDocumentId` to every
  explicit operation insert list (`itemToJob :722-753`, `itemToJobMakeMethod
  :1497+`, `itemToQuoteLine :2250-2280`, `itemToQuoteMakeMethod :2808+`,
  `quoteLineToJob :4964` area) and audit the remaining directions
  (`jobToItem`, `jobMakeMethodToItem`, `quoteLineToItem`, `quoteMakeMethodToItem`,
  `makeMethodToMakeMethod`, `quoteLineToQuoteLine`, `quoteToQuote`) — spread-based
  lists inherit automatically; explicit lists must name both columns
  (PRD §5.4: "omitting either silently breaks propagation").

**Upsert normalization (app services):** `upsertMethodOperation` /
`upsertQuoteOperation` / `upsertJobOperation` write the three pointers
type-consistently: `procedureId` only for Process, `assemblyInstructionId` only
for Assembly, `inspectionDocumentId` only for Inspection — anything else is
explicitly `null` (not merely omitted, since `sanitize()` would preserve stale
values).

**Validators:** add `assemblyInstructionId: zfd.text(z.string().optional())` and
`inspectionDocumentId: zfd.text(z.string().optional())` to
`methodOperationValidator` (items.models.ts:489 area), `baseJobOperationValidator`
(production.models.ts:296 area), `quoteOperationValidator` (sales.models.ts:439
area). Re-gate the machine refines: `machineUnit`/`machineTime` (all three) and
`machineRate` (job :441-451, quote :578-589) require only when
`operationType === "Process"`; setup/labor refines stay `!== "Outside Processing"`.
(While editing: fix the pre-existing copy/paste where the machineUnit refine
guards read `data.laborUnit` — items :540-551, production :393-403.)

## UI Changes

**All three BoP editors** (items `BillOfProcess.tsx`, `JobBillOfProcess.tsx`,
`QuoteBillOfProcess.tsx`):

- **Procedure card** (items :1675, job :3450, quote :2442): render only when
  `processData.operationType === "Process"`.
- **New Assembly Instruction card** (same collapsible-card pattern), rendered when
  `operationType === "Assembly"`: new `AssemblyInstruction`
  combobox (`~/components/Form/AssemblyInstruction.tsx`, mirroring
  `Procedure.tsx` — options `name · v{version}` + status badge, scoped by
  `itemId` prop), storing `assemblyInstructionId`. Job editor adds the
  "Sync Assembly Steps" button + changed-but-not-synced hint (mirroring the
  Sync Procedure affordance, job :3506-3531) posting
  `{ targetKind: "job", operationId }` to `path.to.assemblySyncBop(assemblyInstructionId)`.
- **New Inspection Document card**, rendered when `operationType === "Inspection"`:
  new `InspectionDocument` combobox (options `drawingNumber ?? fileName · v{version}`,
  scoped by `itemId`), storing `inspectionDocumentId`. No sync, no lock.
- **Locking** — method (items :572/:612/:658) and quote (:584/:648/:691) tab
  disables gain the assembly term: Steps tab also disables when
  `!!item.data.assemblyInstructionId` (tooltip "Steps are inherited from the
  assembly instruction"); Instructions/Parameters lock only on `procedureId` as
  today. Job editor stays lock-free.
- **`AssemblyStepsSource` retired** from both editors (items :686-693, job
  :941-948) — superseded by the card (picker + sync). The component itself is
  deleted with its imports.
- **Time fields** — the Machine card (items :1561-1672, job :3285-3362, quote
  :2275-2352) renders only when `operationType === "Process"`; the job/quote
  Costing cards keep Labor + Overhead rates but render `machineRate` only for
  Process. Type-switch onChange also resets machine values to defaults when
  leaving Process (matching the existing unit-reset pattern).
- **Type switch clears pointers**: the operationType onChange resets
  `procedureId`/`assemblyInstructionId`/`inspectionDocumentId` in `processData`
  to `""` for whichever no longer applies.

**MES:** no changes. The assembly view already resolves playback via
`jobOperation.assemblyInstructionId`; job steps arrive materialized exactly as
they do for procedures; the inspection pointer waits for the Phase-3 view.

## Acceptance Criteria

- [ ] Migration: `quoteOperation.assemblyInstructionId` +
      `inspectionDocumentId` on all three operation tables exist with SET NULL
      FKs + indexes; re-running the migration is a no-op; types regenerate clean.
- [ ] Items BoP, operation typed **Process**: Procedure card visible; Machine
      card + all three time cards visible; no Assembly/Inspection cards.
- [ ] Items BoP, operation typed **Assembly**: Procedure card gone; Assembly
      Instruction picker lists only instructions whose `itemId` = the method's
      item (with status badges); selecting one locks the Steps tab with the
      inherited tooltip; Machine card gone; Setup + Labor still shown and still
      required by the validator; machine fields not required.
- [ ] Items BoP, operation typed **Inspection**: Inspection Document picker
      lists only documents whose `partId` = the method's item; no locking; no
      Machine card; Procedure card gone.
- [ ] Switching an operation from Assembly → Process clears
      `assemblyInstructionId` (form and DB after save); Process → Inspection
      clears `procedureId`.
- [ ] Creating a job from a method whose Assembly operation links a published
      instruction produces `jobOperationStep` rows matching the instruction's
      steps (typed fields + `assemblyInstructionStepId` markers + model slide +
      `jobMaterialStep` links for resolvable parts), and the job operation
      carries `assemblyInstructionId`; the method's own (empty/locked) steps are
      not copied.
- [ ] Creating a job from a method whose Inspection operation links a document
      copies `inspectionDocumentId` onto the job operation and creates **no**
      steps from features.
- [ ] Quote path: item→quote carries both pointers (no materialization);
      quote→job materializes assembly steps.
- [ ] Job editor, Assembly op: picker + "Sync Assembly Steps" re-syncs via the
      existing sync-bop action (update/insert/delete by provenance marker);
      changing the picked instruction shows the not-synced hint.
- [ ] Validators: machine unit/time (and job/quote machineRate) required only
      for Process; an Assembly op saves without machine values.
- [ ] Typecheck (erp, mes, @carbon/database), lint, and existing tests green;
      browser e2e passes for the three editor states + the job materialization
      chain.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| get-method copy-list drift — one of the 14 directions misses the new columns | Med | Audit every explicit insert list in one pass; the PRD calls this exact failure out; grep `procedureId` in the file as the checklist of sites. |
| Assembly materialization in Deno duplicates app-side sync logic imperfectly (slides/material links) | Med | Mirror `insertProcedureDataForJobOperation`'s placement + port the resolution rules from `syncAssemblyInstructionToOperation` (:5801-5973); job-side re-sync remains available to reconcile. |
| Stale method-level synced steps (old AssemblyStepsSource flow) linger on templates | Low | They're skipped at get-method once the FK is set; internal-only data; no cleanup migration. |
| `sanitize()` preserving stale pointers on type change | Med | Explicit server-side null-normalization in the three upserts (spec'd above); acceptance criterion covers it. |
| Hidden-but-required machine fields breaking saves for Assembly/Inspection | Med | Validator re-gate ships in the same change as the UI hiding; acceptance criterion covers it. |
| `inspectionDocument` has no status; picker can select any version | Low | Version shown in the option label; PRD's result-record phase adds execution-time semantics. |

## Open Questions

> Autonomous resolutions below follow the spec-writing skill's autonomous mode —
> surfaced for veto before implementation.

- [x] Assembly lock scope at method/quote level — **Autonomous:** Steps only
      (Instructions/Parameters stay authorable); procedure keeps locking all
      three. Veto → lock all three for assembly too.
- [x] Inspection = pointer only, no steps, no locking — **Resolved by PRD §5.4**
      (accepted ADR) and Brad's phrasing (only Assembly "resolves to steps").
- [x] Machine-fields gate written as `=== "Process"` — **Autonomous:** correct
      semantics for a per-type field set; the `!== 'Outside Processing'`
      invariant remains reserved for subcontract-boundary logic.
- [x] Costing card for Assembly/Inspection — **Autonomous:** keep laborRate +
      overheadRate, hide machineRate ("only setup and labor" read as the
      machine axis disappearing, not costing disappearing).
- [x] get-method materializes a linked instruction of any status (procedure
      parity), while manual job sync keeps its Published guard — **Autonomous.**
- [x] `quoteOperation.assemblyInstructionId` added — **Autonomous:** required
      for pointer continuity item→quote→job.
- [x] Flag gating — **Answer (Brad):** no `isInternal` gate on the assembly
      card; both cards ship ungated. (Superseded the autonomous parity
      recommendation.)
- [x] `AssemblyStepsSource` deleted (both editors) — **Autonomous:** fully
      superseded by picker + lock (method) and picker + sync (job).

## Non-Goals

- The Phase-3 inspection execution view, `jobOperationInspectionRecord`, pass/fail
  evaluator, gauge picker (PRD §5.4's remaining scope).
- Numeric tolerance columns on `inspectionFeature` (PRD §5.3).
- Auto-defaulting the picker to "the item's sole document/instruction" — the
  list is scoped, the author picks.
- Retiring the method-level `assemblyInstructionStepId` provenance column or
  cleaning historical synced steps.
- MES changes of any kind.

## Changelog

- 2026-07-21: Created from Brad's phase brief + two full-codebase research
  passes (procedure mechanics end-to-end; assembly/inspection source schemas).
  All open questions resolved (one PRD-decided, rest autonomous, surfaced for
  veto).
- 2026-07-21: Approved by Brad with one amendment — no `isInternal` gate on the
  assembly card. Implementation started.
