# Plan: Inspection plans from STEP PMI

Spec: `.ai/specs/2026-10-27-pmi-inspection-plans.md`
Run record: `.ai/runs/2026-10-27-pmi-inspection-plans.md`

## Tasks

### 1. Migration and types

- [x] Run `pnpm db:migrate:new pmi-inspection-plans`.
- [x] In the new file, add `inspectionDocument."modelUploadId"` (FK `modelUpload`, ON DELETE SET NULL), `inspectionFeature."pmiItemId"`, and the partial unique index `inspectionDocument_part_model_key`.
- [x] In the same file, drop and create `inspectionDocuments` again (body of `20260526153412_inspection-documents-view.sql`).
- [x] Add `packages/database/src/event-system/handlers/queue_pmi_inspection_plans.sql` (copy `queue_model_pipeline.sql`). On INSERT or UPDATE of `item`, for each row whose `modelUploadId` changed to a model with `pmiPath` set, send `carbon/pmi-inspection-plan` with `{ companyId, modelUploadId, itemId }`. Skip under `app.sync_in_progress`.
- [x] Add `queue_pmi_inspection_plans` to `item.statement` in `attachments.ts`.
- [x] Run `pnpm db:migrate`. Run `pnpm --filter @carbon/database authz sync` if migrate does not apply handlers. Ship the handler with `pnpm --filter @carbon/database authz migration pmi-inspection-plans-handler`.
- [x] Run `pnpm run generate:types`.

Verify: `psql` shows the two columns, the index and `trg_event_statement_queue_pmi_inspection_plans_*` on `item`.

### 2. Mapping (`@carbon/viewer/pmi`)

- [x] Add `pmiInspectionCharacteristics(doc: PmiDocument): PmiCharacteristic[]` to `packages/viewer/src/pmi.ts` (mapping table in the spec).
- [x] Add `"./pmi": "./src/pmi.ts"` to `packages/viewer/package.json` exports.
- [x] Add tests in `packages/viewer/src/pmi.test.ts`: ± dimension, limit dimension, fit-only dimension, presentation dimension skipped, angle unit, inch conversion, tolerance with value, tolerance without value, datum and note skipped, labels in order.

Verify: `pnpm --filter @carbon/viewer test` passes.

### 3. Building block (`@carbon/database/quality`)

- [x] Add `createPmiInspectionPlan(db, { companyId, itemId, modelUploadId, characteristics })` to `packages/database/src/quality.ts`. It runs in the caller's transaction. It resolves the drawing number (`readableIdWithRevision`, ` (n)` suffix), inserts the plan with `ON CONFLICT DO NOTHING` on the partial index, and inserts the features when the plan row is new. It returns the plan id or null.

Verify: `pnpm exec turbo run typecheck --filter=@carbon/database`.

### 4. Job

- [x] Add `packages/jobs/src/inngest/functions/tasks/pmi-inspection-plan.ts`: event `carbon/pmi-inspection-plan`, concurrency key `companyId-modelUploadId` limit 1, retries 2. One step, `create-plans`: read the model and the items with no plan for it, download and map `pmi.json`, then create each plan in its own transaction through `getJobDatabaseClient`. One step keeps the characteristics out of the step output.
- [x] Register the function in `tasks/index.ts` and the inngest index. Add the event schema to `packages/lib/src/events.ts` (and `trigger.ts` when events are typed there).
- [x] In `model-optimize.ts`, after `persist`, `step.sendEvent("pmi-inspection-plan", …)` when `outputs.pmi` is set.

Verify: `pnpm exec turbo run typecheck --filter=@carbon/jobs`.

### 5. Viewer: controlled PMI selection

- [x] Add `selectedPmiItemId?: string | null` and `onPmiItemSelect?: (id: string | null) => void` to `ModelPreview`. A change of `selectedPmiItemId` selects the item and sends a focus request. A user pick calls `onPmiItemSelect`.

Verify: `pnpm --filter @carbon/viewer typecheck`.

### 6. ERP

- [x] `quality.service.ts`: `getInspectionDocument` and `mapInspectionDocument` return `model: { modelUploadId, modelPath } | null` (embed `modelUpload(modelPath)`). `getInspectionSamplingPlans` and `getInspectionFeatures` select `pmiItemId`.
- [x] Add `ModelUploadPreview` to `@carbon/viewer` (`./model-upload-preview`): props `modelUploadId`, `modelPath`, `companyId`, `pmiLinks`, `selectedLinkId`, `onLinkSelect`. Superseded the first build's per-app `InspectionModelPane` copies (nuclear self-review).
- [x] `InspectionView.tsx`: prop `model`; the drawing pane shows the model pane when `model` is set.
- [x] `x+/inspection+/$id.tsx`: pass `model`.
- [x] Editor route `x+/inspection-document+/$id.tsx` passes `model`. `InspectionDocumentEditor.tsx`: with `model`, show the model pane in the top pane, hide the PDF actions and the Balloon button, add a Show action per row with a `pmiItemId`.
- [x] `InspectionDocumentTable.tsx`: no PDF link for a model plan (check what it shows).

Verify: `pnpm exec turbo run typecheck --filter=erp`.

### 7. MES

- [x] `services/quality.service.ts`: select `pmiItemId` on features, and `modelUploadId, modelUpload(modelPath)` in `getInspectionDocumentWithBalloons`; return `model`.
- [x] Use `ModelUploadPreview` from `@carbon/viewer` (no app copy).
- [x] `InspectionView.tsx` and `x+/inspection.$operationId.tsx`: pass and use `model`.

Verify: `pnpm exec turbo run typecheck --filter=mes`.

### 8. Docs and gates

- [x] Update `.claude/rules/inspection-system.md`, `apps/erp/app/modules/quality/AGENTS.md`, `packages/viewer/AGENTS.md` (PMI section).
- [x] Run `pnpm --filter @carbon/checks license-headers` for new files.
- [x] Run Biome on changed files, the scoped typechecks, and the viewer and database tests.
- [x] Run `/translate` for new UI strings when the catalogs need it. Not needed: the one new string, `Show`, is already in the catalogs.
- [x] Item delete (`deleteItemsWithPriceBreaks`, `items.service.ts`) deletes the item's PMI plans that no inspection used.

### 9. Nuclear self-review fixes

- [x] `modelPreviewUrls` in `@carbon/viewer`, used by `ModelUploadPreview`, ERP `CadModel` and the MES model tab.
- [x] `ModelPreview`: clear `pmiSelectedRef` with the selection on a new PMI document.
- [x] `deleteUnusedPmiInspectionPlans` building block; `items.service.ts` calls it.
- [x] Tests: `packages/database/src/pmi-inspection-plan.test.ts` (DB), `supabase/tests/pmi-inspection-plans.test.sql` (trigger), `packages/jobs/.../pmi-inspection-plan.test.ts` (mapping graded by `valuateMeasurement`).
- [x] Editor: zoom controls not rendered for a model plan; conformance baseline line re-keyed; `model` prop required; `pmiLinks` memoized.
- [x] `crbn`: one `assemblerMissingPrerequisite`; `dirname`.
- [x] Docs: jobs and dev AGENTS.md, authz-manifest handler counts, user docs `inspections.mdx`.
