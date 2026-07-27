# Plan: Job Operation Batching — best of both worlds (merge #1137 robustness into our branch)

**Branch:** `feat/job-operation-batching` · **Ref PR:** #1137 (`loop/1010-20260714010219`) · **Closes:** #1010

## Goal

Keep our branch's shape (Scheduling-placed board, single feature migration, lean
476-line edge fn, `assertEligible` gate) and absorb #1137's correctness +
robustness where it is strictly better. Net result: our UX + their completion
safety.

## Keep from ours (no change)
- Batch board in Scheduling: `x+/schedule+/batching.tsx`, `ui/Schedule/Batching/`.
- Edge-fn cases `create` / `add` / `remove` / `update` / `dissolve` + `assertEligible`
  (already rejects started/already-batched/non-batchable ops).
- Single feature migration for the base schema.

## Adopt from #1137 (the correctness delta)
The headline gap: **our completion is non-resumable.** The edge fn commits
slice+quantities+`Done`+`Completed` in one txn, then the MES route does issue()
and GL post as best-effort follow-ups with no `.error` check on GL and no retry
path — a failure strands inventory/GL with the batch already `Completed`. #1137's
two-phase `Completing` workflow fixes this. Both dependencies it needs already
exist in our schema: `productionEvent.postedToGL` and the `sync_finish_job_operation`
Done-flip trigger.

---

## Tasks

### Task 1 — `Completing` status (schema + enums)
- `pnpm db:migrate:new job-operation-batch-completing-status`
- Body (verbatim intent from #1137): `ALTER TYPE "jobOperationBatchStatus" ADD VALUE IF NOT EXISTS 'Completing' BEFORE 'Completed';` (ADD VALUE only — safe in migration txn; value consumed later).
- Add `"Completing"` to the `jobOperationBatchStatus` const arrays in:
  - `apps/erp/app/modules/production/production.models.ts`
  - `apps/mes/app/services/models.ts`
- **Verify:** `pnpm run generate:types` then `grep -n Completing packages/database/src/types.ts` shows the enum value.

### Task 2 — Shared proportional time-split util (supersedes inline `proportional-shares.ts`)
The two-phase completion needs `buildBatchCompletionPlan` / `planBatchCompletion` /
`assertBatchCompletionMembership` / `sliceEventByWeight`. Port #1137's tested util.
- Add `packages/utils/src/batch-time-split.ts` (port from `pr-1137:packages/utils/src/batch-time-split.ts`) + export from `packages/utils/src/index.ts`.
- Add Deno mirror `packages/database/supabase/functions/shared/batch-time-split.ts` (port from `pr-1137:...shared/batch-time-split.ts`).
- Delete `packages/database/supabase/functions/batch-operations/proportional-shares.ts` and `proportional-shares.test.ts` (superseded).
- Add `packages/utils/src/batch-time-split.test.ts` (port from #1137).
- **Verify:** `pnpm --filter @carbon/utils test` green.

### Task 3 — Rewrite edge-fn `complete` case → two-phase resumable `completeBatch()`
File: `packages/database/supabase/functions/batch-operations/index.ts`
- Import `nanoid` + the Deno util (`buildBatchCompletionPlan`, `planBatchCompletion`, `assertBatchCompletionMembership`, types). Drop the `proportionalShares` import.
- Replace `case "complete"` with a `completeBatch(client, {...})` call mirroring #1137:
  - **Phase 1 (one Kysely txn):** `SELECT ... FOR UPDATE` the batch row → `planBatchCompletion(status)`:
    - `resume` (status `Completing`): re-load existing per-member events (`endTime IS NOT NULL`) into `glEvents` with `postedToGL`; do NOT re-slice.
    - `slice` (status `Active`): `assertBatchCompletionMembership`, reject open timers (`endTime IS NULL`), `buildBatchCompletionPlan`, delete aggregate events + insert per-member slices (`postedToGL:false`, `nanoid` ids), insert `productionQuantity` rows, guarded `Active→Completing` (`WHERE status='Active'`, throw if 0 rows).
  - **Phase 2 (post-commit, idempotent):** issue each member's BOM (backflush-capped) with error propagation; flip members `Done` via `.neq("status","Done")`; post GL per event skipping `postedToGL`, propagating errors.
  - **Finalize:** guarded `Completing→Completed` (`WHERE status='Completing'`).
- Move issue + Done + GL entirely into the edge fn (they leave the MES route in Task 4).
- **Verify:** `deno check packages/database/supabase/functions/batch-operations/index.ts` (or the repo's function typecheck path) clean.

### Task 4 — Slim the MES completion route
File: `apps/mes/app/routes/x+/batch.$batchId.complete.tsx`
- Reduce the action to: validate → single `invoke("batch-operations", { type:"complete", ... })` → on `error`/`data.error` flash+return; on success redirect with success flash.
- Remove the issue loop (lines ~57-70) and the GL `Promise.all` (lines ~72-80) — now owned by the edge fn. This is also what makes a failed completion retryable: re-submitting the form re-invokes the resumable edge fn.
- **Verify:** `pnpm exec turbo run typecheck --filter=mes`.

### Task 4b — Port #1137's MES batch page UI (surface `Completing` + live timer + i18n)
Our `batch.$batchId.tsx` renders Start + Complete unconditionally, shows no batch
status, has no live timer, and uses raw strings. #1137's page
(`pr-1137:apps/mes/app/routes/x+/batch.$batchId.tsx`) is the UI counterpart to the
`Completing` status — port it, adapted to OUR loader/route shape. Their board
(`BatchPlanningBoard`) is a subset of ours — take nothing from it.
- **Status Badge** at the card header: `green` Completed / `yellow` Completing /
  `secondary` Active, showing `batch.status`.
- **Timer gating:** `canRunTimer = batch.status === "Active"` — hide Start/End when
  not Active (drop our `hasOpenEvent`-only logic; combine with status).
- **Complete form gating:** enabled while `Active` OR `Completing`; disabled only
  for `Completed`/`Cancelled`. Pass a `resuming = isCompleting` prop.
- **Button relabel:** `resuming ? t\`Retry Completion\` : t\`Complete Batch\``, plus
  the short explanatory line for the Completing state.
- **Live elapsed timer:** `useState`/`useEffect` tick + `formatDurationMilliseconds`
  + running Badge (their `computeElapsed` pattern).
- **i18n:** wrap strings in `<Trans>` / `t` (ours currently raw "Start"/"Stop"/
  "Complete Batch"), feeding Task 7's `mes.po` extraction.
- Keep OUR route action target (`path.to.batchComplete(batch.id)`), OUR
  `completeJobOperationBatchValidator`, and OUR loader (`hasOpenEvent`, member
  shape). Do NOT pull their `batchCompleteValidator` / `toBatchCompleteMembers` /
  `path.to.batchComplete` (no-arg) — map to our equivalents.
- **Verify:** `pnpm exec turbo run typecheck --filter=mes`; batch page renders
  Active/Completing/Completed states correctly.

### Task 5 — RPC started-op guard (board candidate correctness)
Our `get_batchable_operations` lists timer-started-but-unflipped ops as candidates
(edge fn rejects them on drop — UX wart, not a data bug). Close it at the source.
- `pnpm db:migrate:new batchable-operations-rpc-started-guard`
- Re-declare `get_batchable_operations` (copy our current body from `20260707135312_...sql`) adding to the unbatched branch:
  `AND NOT EXISTS (SELECT 1 FROM "productionEvent" pe WHERE pe."jobOperationId" = jo."id" AND pe."companyId" = jo."companyId")`.
- **Verify:** `pnpm run generate:types`; manual read of the new migration matches the edge-fn `assertEligible` gate.

### Task 6 — Port the substantive tests
- `apps/mes/app/services/models.batch.test.ts` — adapt to our `completeJobOperationBatchValidator` / models.
- `apps/erp/test/batching-tenant-scope-and-fk-locks.test.ts` — adapt paths to our tree.
- (batch-time-split covered by Task 2.)
- **Verify:** `pnpm run test` — new tests green.

### Task 7 — MES i18n parity
- Our new MES batch strings aren't extracted (only `erp.po` touched). Run `pnpm lingui:extract` (and `pnpm translate` to LLM-fill) so `mes.po` covers the batch UI; `pnpm lingui:clean`.
- **Verify:** `git status` shows `mes.po` updated across locales; no `.mjs` committed.

### Task 8 — Docs freshness + full gate
- Update `.ai/specs/2026-07-03-job-operation-batching.md` completion section to describe the two-phase `Completing` workflow.
- Update `.ai/playbooks/job-operation-batching.md` + `apps/erp/app/modules/production/AGENTS.md` if they describe the old single-phase completion.
- **Final gate:** `pnpm run generate:types` → `pnpm run lint` → `pnpm exec turbo run typecheck --filter=erp --filter=mes` → `pnpm run test` → `pnpm run build`.

## Skipped (deliberately)
- Moving the board to a Production submodule (ours in Scheduling is better for planners).
- Splitting into 4 migrations / adopting #1137's 787-line edge fn wholesale — we take only the `complete` rewrite.

## Risk notes
- Task 3 changes the edge fn's event handling from update-in-place to delete+reinsert per-member slices — confirm no hard FK from `productionQuantity.{setup,labor,machine}ProductionEventId` points at the deleted aggregate events in our batch flow (our start flow does not set those; the FKs are nullable `ON DELETE SET NULL`).
- `ADD VALUE` enum change cannot be used in the same migration txn that consumes it — kept isolated in Task 1.
- Cannot exercise the RPC/edge fn against a live DB in this worktree; correctness is grounded by the ported tests (time-split, membership, validator) + inspection against the `sync_finish_job_operation` trigger and `postedToGL` infra.
