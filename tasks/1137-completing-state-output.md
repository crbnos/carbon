# PR #1137 — `Completing` intermediate state for batch completion

## CodeRabbit critical addressed
Batch completion set `status = 'Completed'` inside the Kysely transaction, then
ran post-commit effects (material issue, member Done, GL posting) outside it. Any
post-commit failure left the batch permanently `Completed` with **partial
effects**, a retry was rejected (`only an active batch can be completed`), and GL
invocation errors were silently swallowed in the final for-loop. No recovery path.

Fixed with a two-phase, idempotent, **resumable** completion workflow using a new
`Completing` intermediate status.

## Changes

### Schema
- `packages/database/supabase/migrations/20260714144500_job-operation-batch-completing-status.sql`
  — `ALTER TYPE "jobOperationBatchStatus" ADD VALUE IF NOT EXISTS 'Completing' BEFORE 'Completed'`
  (ADD VALUE only, not consumed in the same migration → transaction-safe).
- `packages/database/src/types.ts` — hand-updated the two generated spots (the
  union and the runtime enum array) to
  `"Active" | "Completing" | "Completed" | "Cancelled"` (no local DB to regenerate
  against; matches what `generate:types` would emit).
- `apps/erp/app/modules/production/production.models.ts` — added `"Completing"` to
  the `jobOperationBatchStatus` list.

### Edge function — `packages/database/supabase/functions/batch-operations/index.ts`
- **Phase 1 (transaction):** on an `Active` batch, slice the recorded timers into
  per-member `productionEvent` + `productionQuantity` rows and guard-flip
  `Active → Completing` (FOR UPDATE lock retained for serialization).
- **Phase 2 (post-commit, idempotent):**
  - issue each member's BOM (backflush-capped → re-issue computes 0 remaining);
  - flip Done **only for members not already Done** (`.neq("status","Done")`), so a
    resume doesn't re-fire the `sync_finish_job_operation` trigger;
  - post GL **only for events not already `postedToGL`**, and **propagate GL
    errors** (previously swallowed).
- **Finalize:** flip `Completing → Completed` only after every phase-2 effect
  succeeds (guarded so a concurrent finalizer is a no-op).
- **Resume:** a retry on a `Completing` batch re-loads the already-sliced events
  and re-runs phase 2 alone — it never re-slices or re-writes quantities.

### Pure guard (both copies, kept in sync)
- `planBatchCompletion(status)` → `"slice" | "resume"`, rejects terminal
  (`Completed`/other). Added to `packages/utils/src/batch-time-split.ts`
  (canonical) and `packages/database/supabase/functions/shared/batch-time-split.ts`
  (Deno mirror). `assertBatchWorkCenterMutable` already rejects non-`Active`, so
  `Completing` batches remain immutable for work-center changes.

### MES UI — `apps/mes/app/routes/x+/batch.$batchId.tsx`
- `Completing` treated as in-flight: **yellow** badge, Start/End timer hidden
  (`canRunTimer = status === "Active"`), Complete form kept **enabled** with a
  `Retry Completion` label (disabled only for terminal `Completed`/`Cancelled`).
- `getJobOperationBatches` still filters `status = 'Active'`, so a `Completing`
  batch correctly does not reappear on the planning board as editable.

### Tests
- `packages/utils/src/batch-time-split.test.ts` — new `planBatchCompletion` suite:
  Active→slice, Completing→resume (the mid-flight-failure recovery case),
  Completed rejected, Cancelled rejected.

## Verification
- `pnpm --filter @carbon/utils run test` → **80 passed** (incl. new cases).
- `pnpm --filter @carbon/config build` → OK (conformance floor).
- typecheck green: `@carbon/utils`, `@carbon/database`, `mes`, `erp`.
- Biome lint clean on changed files.
- (No local Supabase/Deno in this worktree → migration not applied and edge fn not
  `deno check`ed here; logic reviewed manually.)

## Commits (branch `loop/1010-review-1`)
- `940a5bee8` loop(1010-review-1): scope endProductionEvent update by companyId
  (pre-existing working-tree fix on the branch, committed separately)
- `0a0d0289b` loop(1010-review-1): two-phase resumable batch completion via
  'Completing' status

## Push
Fast-forwarded PR #1137's head branch `loop/1010-20260714010219`
(`bd2c64730..0a0d0289b`, not a force-push — the PR head was an ancestor of local
HEAD). Posted a summary comment on the PR
(https://github.com/crbnos/carbon/pull/1137#issuecomment-4969776022).

**Final SHA: `0a0d0289b`**
