# Step model slides — 3D models (STP → assembler → GLB) alongside pictures in BOP steps + MES assembly view

## Context

The `poc/mes-assembly-view` branch gives BOP steps "slides" (reference pictures with captions/pins) authored in the ERP BOP editors and shown in the MES assembly view. The user wants (a) the assembler service integrated into the BOP step section for parts and jobs, and (b) the MES assembly view to show **3D models (.stp, plus other supported formats) alongside pictures** per step — reversing the earlier "no 3D slides" non-goal in `.ai/specs/implemented/2026-07-14-mes-execution-views.md` §4.

Everything heavy already exists and is reused, not rebuilt:

- `modelUpload` table (modelPath, thumbnailPath, glbPath, graphPath, processingStatus, componentCount) + `/api/model/upload` route (inserts row, fires `model-thumbnail`).
- Inngest `assembly-convert` task → assembler `POST /convert` (STEP → GLB + graph.json in `private` bucket at `{companyId}/models/{modelUploadId}/{jobId}/`), gated by `isAssemblerServiceHealthy()` (apps/erp/app/modules/production/production.server.ts).
- `ModelViewer` (`@carbon/react`, online-3d-viewer + three) renders all of `supportedModelTypes` (packages/utils/src/file.ts) client-side, **including step/stp**, in both ERP and MES; MES preview proxy `/file/preview/private/...` already whitelists 3D types.
- Slide system: `methodOperationStepSlide` / `jobOperationStepSlide` / `quoteOperationStepSlide` tables; `SlidesEditor.tsx` + `BillOfProcess.tsx` (items) + `JobBillOfProcess.tsx` (jobs); `operationStepSlideValidator` (apps/erp/app/modules/shared/shared.models.ts); get-method `copyStepSlides`; MES `getJobOperationProcedure` → `AssemblyView.tsx`.

## Design

A slide becomes **image XOR model**:

- Add nullable `modelUploadId` (FK → `modelUpload` ON DELETE CASCADE) to the three slide tables; relax `imagePath` to nullable; CHECK at least one of the two is set. Annotations/pins remain image-only.
- ERP step editors get "Add model" beside "Add slide": upload file to `{companyId}/models/{nanoid}.{ext}` in `private`, create `modelUpload` via the existing `/api/model/upload` action, save slide with `modelUploadId`.
- Assembler integration: in the slide upsert actions (items + job tiers), when the attached model is STEP, `processingStatus` is `Idle`, and the assembler is healthy → `trigger("assembly-convert", { companyId, modelUploadId, userId })`. Non-STEP formats skip conversion.
- MES assembly view: slide carousel mixes pictures and models. Model slide thumbnail = `modelUpload.thumbnailPath` (cube icon fallback); selected model slide renders `<ModelViewer url={getPrivateUrl(glbPath ?? modelPath)} />` — GLB when converted, raw model otherwise, so the feature degrades gracefully when the assembler is not deployed/running.
- get-method copy carries `modelUploadId` verbatim (company-scoped row, same pattern as `imagePath`).

## Tasks

1. **Migration** `pnpm db:migrate:new step-model-slides`: for each of the 3 slide tables — add `modelUploadId` TEXT NULL REFERENCES `modelUpload(id)` ON DELETE CASCADE, `imagePath` DROP NOT NULL, CHECK (`imagePath` IS NOT NULL OR `modelUploadId` IS NOT NULL), index on `modelUploadId`. Apply with `pnpm db:migrate`, then `pnpm run generate:types`.
2. **get-method** (`packages/database/supabase/functions/get-method/index.ts`): `copyStepSlides` select + insert carry `modelUploadId`.
3. **Validators** (`apps/erp/app/modules/shared/shared.models.ts`): `operationStepSlideValidator` — `imagePath` optional, `modelUploadId` optional; slide services pass the new field through.
4. **ERP routes**: items + job `operation.step.slide.new.tsx` accept `modelUploadId`; add STEP+Idle+healthy → `trigger("assembly-convert", …)` after upsert.
5. **ERP UI**: `SlidesEditor.tsx` model-add input (accept `supportedModelTypes`) + model card (thumbnail/name, no Pin); wire upload flow in `BillOfProcess.tsx` (StepSlides + AttributesForm draft) and `JobBillOfProcess.tsx`.
6. **MES**: `operations.service.ts` `getJobOperationProcedure` embeds `modelUpload(id,name,modelPath,glbPath,thumbnailPath,processingStatus)` on slides; `AssemblyView.tsx` renders model slides via `ModelViewer`, keeps pins/zoom for image slides only.
7. **Verify**: `pnpm exec turbo run typecheck --filter=erp --filter=mes` (+ `@carbon/database`), `pnpm run lint`; browser-verify with dev stack if running.

## Verification

- Typecheck ERP + MES + database; lint.
- Manual: in ERP part BOP editor add a `.stp` model slide to a step → row in `methodOperationStepSlide` with `modelUploadId`; with assembler up, `modelUpload.processingStatus` → Processing → Success with `glbPath`. Get method to a job → job slide carries model. MES assembly view for that operation shows the model slide in the carousel and renders it in 3D; picture slides unchanged.

## Status (2026-07-19)

All code tasks implemented. Verified: ERP and MES typechecks match the branch baseline exactly
(13 / 11 pre-existing errors — broken generated `types.ts` duplicate `invoiceSettlement` from the
origin merge, missing react-router `+types` artifacts, documents-package drift — none introduced
by this change); biome diagnostics identical to baseline. Spec §4 updated (non-goal reversed).

**Completed 2026-07-20 (stack up):** migrations applied + types regenerated (bridge-casts
removed), browser-verified end-to-end in the running ERP + MES. Follow-on work shipped in the
same branch: Assembly → BOP sync (`20260720025847_assembly-bop-sync.sql`,
`syncAssemblyInstructionToOperation`, "Sync to BOP" modal), step-aware `AssemblyPlayer`
playback in the MES assembly view (driven by the `assemblyInstructionStepId` marker), and the
BOP steps-source panel (`AssemblyStepsSource`) bridging Assembly operations to the assemblies
module. Still pending: `pnpm lingui:extract` for the two new translated strings
(Converting…, Failed to upload model) next time translations are filled.
