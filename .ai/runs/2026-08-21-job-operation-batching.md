# Run log — Job Operation Batching v2

**Branch:** `feat/job-operation-batching-v2`
**Plan:** `.ai/plans/2026-08-21-job-operation-batching.md`
**Executor:** Opus (headless)
**Started:** 2026-08-21

Refs: `SRC=feat/job-operation-batching` (tip `8f7fc8a67`),
`PR1137=origin/loop/1010-20260714010219` (`5bc2c86ce`),
merge-base(main,SRC)=`9150e2524`.

Working-tree files to never touch: `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`,
`packages/database/src/types.ts` (pre-existing licensing edits),
`packages/database/supabase/functions/lib/types.ts`,
`.ai/specs/2026-08-19-licensing-entitlement-system.md`,
`.ai/research/2026-08-19-licensing-entitlement-models.md`.

---

## Task 1: Port the batch-time-split util (+ tests + Deno mirror)

- Ported 3 files from `$SRC` (no conflicts — all new files):
  `packages/utils/src/batch-time-split.ts` (338 ln),
  `packages/utils/src/batch-time-split.test.ts` (246 ln),
  `packages/database/supabase/functions/shared/batch-time-split.ts` (286 ln).
- Added `export * from "./batch-time-split";` to `packages/utils/src/index.ts`
  (alphabetical, before `./bom`).
- All 4 required exports present in both TS files (`buildBatchCompletionPlan`,
  `planBatchCompletion`, `assertBatchCompletionMembership`, `sliceEventByWeight`).
- Verify: `pnpm --filter @carbon/utils test` → **13 files, 199 tests passed**.
- Banned term: none.
- Commit: `1615715e3`

## Task 2: Consolidated migration + sequence seed + config.toml

- Pre-flight PASSED: `get_active_job_operations_by_location` newest on
  origin/main = `20260531084723_rework-serial-flow.sql`; `processes` view newest
  = `20260721004140_operation-type-consolidation.sql`. Capacity planning has NOT
  landed. Also confirmed the salvage `processes` view body is byte-identical to
  main's `20260721004140` definition (both `p.*` + workCenters + suppliers).
- Migration created: `20260821024449_job-operation-batching.sql` (from the
  salvage base `20260707135312`). Three edits made:
  - enum → `('Active', 'Completing', 'Completed')` (dropped `Cancelled`);
  - `get_batchable_operations` WHERE gained the started-op `NOT EXISTS
    productionEvent` guard (from the salvage guard migration);
  - lane branch → `OR b."status" IN ('Active', 'Completing')`.
  - also: header spec ref → 2026-08-21; view comment → newest def 20260721004140.
- seed.data.ts: BAT sequence row added (3-way apply, clean).
- config.toml: `[functions.batch-operations]` block added. 3-way apply
  CONFLICTED (main added post-inventory-adjustment/correct-stock-movement/
  post-nonconformance after post-inventory-count where salvage added
  batch-operations) → resolved by keeping main's 3 blocks AND appending
  batch-operations.
- Note: `git diff` uses an external driver (`difft`); patches generated with
  `--no-ext-diff` for `git apply`.
- Verify: `Cancelled`=0, `IN ('Active', 'Completing')`=1, `NOT EXISTS`=12 in the
  migration; `pnpm db:migrate` applied with no error + regenerated types.
- Banned term: none.

## Task 3: Regenerate DB types

- `pnpm db:migrate` regenerated both `src/types.ts` and
  `functions/lib/types.ts` (Tasks 2 and 3 land in one commit — db:migrate
  regenerates atomically).
- Diff: +502/-8. The 8 deletions are the PRE-EXISTING generator churn (an FK
  column-order swap `customerCountryCode`/`invoiceCountryCode`, mislabeled
  "licensing" in the executor brief — the actual diff is generator
  non-determinism, saved to scratchpad). NOT unrelated table deletions, so
  ground rule 7 does not trigger a stop.
- To honor hard rule 6 ("never commit the pre-existing generated-type edits"),
  staged ONLY the batch hunks of both types files via a filtered `git apply
  --cached` (dropped the 2 FK-swap hunks). The FK-swap remains in the working
  tree, unstaged and untouched. Both generated files are biome-ignored, so the
  pre-commit hook can't disturb the partial staging.
- Committed via a path-less `git commit` of the reviewed index — `git commit --
  <path>` would override the index with the working-tree file and re-include the
  FK-swap, which the rule forbids.
- Verify: `jobOperationBatchStatus: "Active" | "Completing" | "Completed"`
  present, no `Cancelled` in that enum; 42 `jobOperationBatch` refs in types.ts.
  Confirmed `HEAD~1..HEAD` has 0 `CountryCode` changes (no churn committed).
- Commit (Tasks 2+3): `ac3032254`

## Task 4: Resources — process `batchable` flag end-to-end

- 7 files ported via 3-way (all clean, no conflicts): `resources.models.ts`
  (`batchable: zfd.checkbox()`), `ProcessForm.tsx` (Boolean field), 
  `ProcessesTable.tsx` (Batchable column + `LuLayers`/`Checkbox`),
  `processes.$processId.tsx` + `processes.new.tsx` (pass-through),
  `Form/Process.tsx` + `Form/Processes.tsx` (initialValues).
- `upsertProcess` needed no change — typecheck confirms the validator spread
  carries the field.
- Verify: `pnpm exec turbo run typecheck --filter=erp` → exit 0. Banned: none.
- Commit: _pending_
