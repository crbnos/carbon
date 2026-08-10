# Refactor — Cut Lists on top of Job Operation Batching

**Branch:** feat/cut-lists
**Depends on:** Job Operation Batching (issue #1010) — `jobOperationBatch` table,
`batch-operations` edge function, `process.batchable`. Built on `origin/loop/1010-*`
(26 commits) / `origin/feat/job-operation-batching`; **not yet on `main`**.
**Prerequisite to executing:** the batching primitive must be present in the working
tree (merge batching into this branch, or rebase this branch onto it) **and** the
local Supabase stack must be up (migrations + `generate:types` + typecheck + tests).

## Why

Brad, #planning: *"Cut lists are a special case of the work Sid is doing with batch
processing (aka work order stitching). It would work better if it was built on top of
that instead of in addition to that. Otherwise we have two systems that do the same
thing."*

Our cut-list implementation independently rebuilt the batching concept, scoped to
cutting. The two overlap almost completely:

| Cut lists (ours, today) | Batching (`jobOperationBatch`) |
|---|---|
| `cutting-runs` board pools operations across jobs by material characteristic | batch planning board + `batchable-operations` RPC |
| `cutListLine.jobOperationId` carries operation membership | `jobOperation.jobOperationBatchId` |
| confirm posts `productionQuantity` per operation, closes it | `batch-operations` `complete` |
| confirm splits setup/machine time across operations (`productionEvent`) | `batch-operations` `complete` |
| per-job material split by nested length | batch issues material per each job's BOM |

This refactor makes a **cut list a specialization of a `jobOperationBatch`**: the batch
owns the grouping, membership, per-operation completion, and shared time/cost split; the
cut list adds only the cutting-specific layer (dimensioned stock, the 1D optimizer,
`cutPattern`, length-aware consumption, remnant/heat return).

## What stays vs goes

**Keep (the genuine cut-list layer, sits on top):**
- `itemStockDimension` (numeric stock length/width/thickness + unit)
- `cutList` header saw params (`kerf`, `endTrim`, `gripMargin`, `minRemnantLength`, `unitOfDimension`)
- `cutListLine.pieceLength` / `pieceWidth` (cut demand) + `jobId` / `jobMaterialId` (traceability)
- the 1D optimizer `functions/lib/cutting/ffd.ts` + `units.ts`, `optimize-cuts`, `cutPattern`
- length-aware stock consumption + **remnant/heat return** in the `issue` `cutListComplete` case
- unit conversion, the operator sheet PDF, `process.isCuttingProcess` + saw defaults

**Remove / delegate (the duplicate of batching):**
- the cross-job grouping board `x+/production+/cutting-runs.tsx` + `getOpenCutDemand` +
  `getMaterialCharacteristics` — the batch planning board (filtered to cutting processes)
  replaces it
- operation completion (`operationCompletions`) in `issue/cut-list-confirm.ts` + the
  `productionQuantity` inserts in the `cutListComplete` case
- run-time split (`timeAllocations`) in `cut-list-confirm.ts` + the `productionEvent`
  inserts in the `cutListComplete` case
- `cutListLine.jobOperationId` + `piecesPerParent` as the **completion driver** (membership
  moves to the batch)

## Target data model

```
jobOperationBatch (Sid)  ── owns grouping, membership, completion, time/cost split
    ▲
    │ cutList.jobOperationBatchId  (nullable FK)
    │
cutList  ── adds saw params + optimizer + patterns + remnants
    │
cutListLine (pieceLength, quantity, jobId, jobMaterialId)  ── cut demand only
```

- A cut list that stitches work orders is **backed by one `jobOperationBatch`**.
- Member operations join via `jobOperation.jobOperationBatchId` (batching's column),
  **not** `cutListLine.jobOperationId`.
- Completion + time/cost split come from `batch-operations` `complete`; the cut list's
  own confirm keeps only material consumption + remnant/heat.

---

## Tasks

### Task 0 — bring the dependency in (prerequisite, not a code change)
Merge the batching branch into `feat/cut-lists` (or rebase onto it) once it is stable /
merged to `main`. Resolve conflicts in the shared files both features touch:
`production.service.ts`, `issue/index.ts`, `production/types.ts`, `process` form +
validator, `path.ts`, `useProductionSubmodules.tsx`, generated `types.ts` (regenerate,
don't hand-merge). Apply migrations, `pnpm generate:types`.
**Verify:** `pnpm exec turbo run typecheck --filter=erp` green; `jobOperationBatch` in
`packages/database/src/types.ts`.

### Task 1 — migration: link cutList → jobOperationBatch, retire the completion columns
`pnpm db:migrate:new cut-list-on-operation-batch`
- `ALTER TABLE "cutList" ADD COLUMN "jobOperationBatchId" TEXT;` + composite FK
  `("jobOperationBatchId","companyId") → jobOperationBatch("id","companyId") ON DELETE SET NULL` + index.
- Drop the completion-driver columns now owned by the batch:
  `ALTER TABLE "cutListLine" DROP COLUMN "jobOperationId";`
  `ALTER TABLE "cutListLine" DROP COLUMN "piecesPerParent";`
  (Keep `jobId`, `jobMaterialId` for traceability.)
- Leave `cutList.plannedYieldPct`/`actualYieldPct` (cut-list-specific).
Then `pnpm db:migrate` + `pnpm generate:types`.
**Verify:** types show `cutList.jobOperationBatchId`, no `cutListLine.jobOperationId`.

### Task 2 — confirm helper: drop the batch-owned logic
`packages/database/supabase/functions/issue/cut-list-confirm.ts`
- Remove `OperationCompletion` + `operationCompletions` (the parts-not-pieces block).
- Remove `TimeAllocation` + `timeAllocations` + `splitTime` + `setupSeconds`/`machineSeconds`.
- `ConfirmLineRow` loses `jobOperationId` / `piecesPerParent`.
- Keep: line-quantity clamping, `allocations` (material split — still useful for the
  cut list's own material posting), remnant/scrap sorting, `status`, `actualYieldPct`.
- Delete the corresponding tests in `cut-list-confirm.test.ts` (operation-completion +
  run-time-allocation `Deno.test`s); keep material/remnant/yield tests.
**Verify:** `pnpm exec tsx` engine check (material split, remnants, yield) still green.

### Task 3 — issue `cutListComplete` case: stop posting operation quantity + time
`packages/database/supabase/functions/issue/index.ts`
- Remove the `productionQuantity` insert loop (operation completion).
- Remove the `productionEvent` insert loop + the post-commit `post-production-event`
  invokes + the `setupSeconds`/`machineSeconds` payload fields.
- After the cut list's material/remnant posting commits, **invoke the batch complete**
  for the cut list's `jobOperationBatchId` so the operations close + time splits the
  batching way: `client.functions.invoke("batch-operations", { body: { type: "complete", jobOperationBatchId, … } })`.
  (Exact payload from the batching function's `complete` schema — read it at execute time.)
**Verify:** `deno check` on the issue function; the case returns without the removed logic.

### Task 4 — creation: a cutting run creates a batch, not a parallel board
`apps/erp/app/routes/x+/production+/cutting-runs.tsx` + `production.service.ts`
- Preferred: **delete** `cutting-runs.tsx`, `getOpenCutDemand`, `getMaterialCharacteristics`,
  and the `cuttingRuns` nav entry + paths. Cutting demand is planned on the **batch
  board**, filtered to `isCuttingProcess` processes.
- Where a cut list needs a batch: when creating a cut list for a set of operations,
  call `batch-operations` `create` (processId = the cutting process, members = the
  selected `jobOperation`s), store the returned `jobOperationBatchId` on the cut list.
- `upsertCutListLine` / the builder no longer set `jobOperationId` / `piecesPerParent`.
**Verify:** typecheck; no references to the removed functions remain (`grep`).

### Task 5 — cut list detail + confirm modal
`apps/erp/app/routes/x+/cut-list+/$id.tsx`, `CutListCompleteModal.tsx`,
`production.models.ts` (`cutListCompleteValidator`), `production.service.ts` (`confirmCutList`)
- Drop the setup/run-minutes inputs from the confirm modal + `setupSeconds`/`machineSeconds`
  from the validator/service (time now belongs to the batch's completion UI).
- Show the linked batch (`BAT…`) on the cut list header; link to the batch.
**Verify:** typecheck; confirm still posts material + remnants.

### Task 6 — docs + rules sync
- Rewrite `.claude/rules/cut-list-system.md`: cut list is a specialization of
  `jobOperationBatch`; completion + time split are the batch's, not the cut list's.
- Update `apps/erp/app/modules/production/AGENTS.md` cut-list entry.
- Move `.ai/specs/2026-08-04-cut-lists.md` note: reconciled with batching (supersedes the
  "keep the models separate" decision — they are now layered).
**Verify:** `pnpm run lint`; grep the rule for stale claims.

### Task 7 — full gate + push
`pnpm exec turbo run typecheck --filter=erp --filter=mes` · `pnpm run lint` ·
engine tsx checks · `/test` the batch→cut-list→confirm flow once the stack is up.
Commit per task; push to `feat/cut-lists`. **No PR.**

## Sequencing / risk
- Tasks 2–6 do not compile until Task 0 (batching present) + Task 1 (migration) land,
  because they reference `jobOperationBatch` / `batch-operations`.
- This is why it cannot be executed until batching is on `main` and the local DB is up.
- Keep each task a separate commit so the delegation is reviewable and reversible.
