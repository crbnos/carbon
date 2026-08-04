# Plan: Picked-material return timing (job vs operation)

Spec: `.ai/specs/2026-08-04-picked-material-return-timing.md`
Research: `.ai/research/material-staging-return-timing.md`

Owed formula (final): `owed = (jobMaterial.estimatedQuantity ÷ job.quantity) × op.quantityComplete`
(includes scrap allowance). Op scope only; job scope owed = 0 (backflush ran first).

## Tasks

- [x] **T1 — Migration** `packages/database/supabase/migrations/<ts>_picked-material-return-timing.sql`
  - `companySettings.returnPickedMaterialTiming TEXT NOT NULL DEFAULT 'job' CHECK IN ('job','operation')`
  - `pickingListLine.quantityReturned NUMERIC NOT NULL DEFAULT 0`
  - `backflush_job_materials` verbatim fork of `20260713190909:131` + lineside clamp:
    after bin resolution, if bin has `workCenterId`, clamp qty to
    `GREATEST(SUM(itemLedger.quantity) WHERE itemId/storageUnitId/locationId/companyId AND trackedEntityId IS NULL, 0)`; `CONTINUE` at ≤ 0.
  - Verify: SQL review. **User runs `pnpm db:migrate`** (regenerates types). Never rebuild DB.

- [x] **T2 — post-picking edge fn** `packages/database/supabase/functions/post-picking/index.ts`
  - Extract `returnTrackedAllocationRemainder(trx, ...)` from `returnPickedRemainder` body
    (:737-903): line update becomes `quantityReturned += totalReturned` (drop `quantityPicked`
    decrement + status reset :884-900; keep allocation decrement/delete :853-882); drop
    unconditional `restoreJobMaterialSource` (:902) — repoint decided per material by sweep.
  - New `returnUntrackedMaterialRemainder(trx, ...)`: per-jobMaterial returnable =
    `max(0, Σ(line.picked − line.returned) − max(quantityIssued, owed))`, newest-first line
    allocation, per-line cap picked−returned, target bin `line.storageUnitId` → pickMethod
    default → NULL; untracked transfer pairs (hand-built inserts, transferPair requires
    trackedEntityId); increment `quantityReturned`.
  - New cases `returnOperationRemainders {jobOperationId,userId,companyId}` (reads
    `returnPickedMaterialTiming`, no-op on 'job'; owed per formula; lines WHERE
    jobOperationId=op, line status ≠ Cancelled, list not Draft/Cancelled) and
    `returnJobRemainders {jobId,userId,companyId}` (guard job.status='Completed'; owed=0;
    all non-Cancelled lines incl. NULL-op). Both derive locationId from job; conditional
    repoint: job scope always restore; op scope restore only when net lineside ≤ 0.
  - Keep legacy `returnPickedRemainder` case as wrapper.
  - Verify: `pnpm run lint`.

- [x] **T3 — MES wiring**
  - `apps/mes/app/services/operations.service.ts`: replace
    `returnAllocatedRemaindersAtJobComplete` (:213-277) with `returnPickedRemainders`:
    read op.jobId + job.status → Completed ? `returnJobRemainders` : `returnOperationRemainders`;
    keep log-on-error. `finishJobOperation:195` call unchanged.
  - `apps/mes/app/routes/x+/inspection-lot.$id.complete-passed.tsx`: after postings succeed,
    re-read op status; if 'Done' → `returnPickedRemainders(serviceRole, ...)`.
  - Verify: `pnpm exec turbo run typecheck --filter=mes` (post-migrate), `pnpm run lint`.

- [x] **T4 — ERP wiring**
  - `production.service.ts`: add `returnPickedRemainders` (op) + `returnPickedJobRemainders`
    (job) helpers, barrel export.
  - `x+/job+/methods+/operation.status.tsx`: after update success, status==='Done' →
    op sweep via `getCarbonServiceRole()`.
  - `x+/job+/$jobId.complete.tsx`: after RPC success → job sweep; failure = warning flash,
    completion stands (sweep idempotent).
  - `$jobId.status.tsx` direct-Completed bypass: comment only.
  - Verify: `pnpm exec turbo run typecheck --filter=erp` (post-migrate), `pnpm run lint`.

- [x] **T5 — Settings surface (ERP)**
  - `settings.models.ts`: `returnPickedMaterialTimings = ["job","operation"] as const` + validator.
  - `settings.service.ts`: `updateReturnPickedMaterialTimingSetting`.
  - `x+/settings+/inventory.tsx`: intent case + ChoiceSelect card (incompletePickingListPolicy
    pattern). `pnpm lingui:extract` after.
  - Verify: typecheck erp (post-migrate), lint.

- [x] **T6 — Net-picked consumers**
  - MES `getPickedQuantitiesByJobMaterial` (inventory.service.ts:363): expose
    `quantityReturned`; staged-at-lineside math uses picked − returned.
  - Optional ERP PickingListLines "Returned" column.

- [x] **T7 — Docs/rules sync**
  - `.claude/rules/traceability-model.md` (pick→consume→return paragraph),
    `.claude/rules/inventory-system.md`, `.ai/lessons.md` entry (quantityPicked decrement
    trips status trigger — use quantityReturned for returns).

## Gate (after user runs `pnpm db:migrate`)

`pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp --filter=mes`
`pnpm run lint`
Manual /test: pick → partial issue → op Done under 'operation' → remainder returned,
header stays Completed → complete job → backflush clamped + final sweep + storageUnitId restored.

## Risks (accepted)

- Untracked newest-first allocation is bookkeeping, not physical truth.
- Op un-Done after sweep: not reversed; re-pick.
- Crash between completion and sweep: strands until re-invoke (idempotent) — same as today.
- Deploy edge fn before app (legacy case kept for skew).
