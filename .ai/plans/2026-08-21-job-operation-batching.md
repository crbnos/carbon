# Job Operation Batching — implementation plan

**Spec:** `.ai/specs/2026-08-21-job-operation-batching.md` (all questions resolved; status in-progress)
**Research:** `.ai/research/job-operation-batching.md`
**Branch:** `feat/job-operation-batching-v2` (cut from `main` 2026-08-21)
**Replanned:** 2026-08-21 (v2 of this plan — deterministic salvage mechanics)

## Executor ground rules

1. **Refs.** `SRC=feat/job-operation-batching` (tip `8f7fc8a67`) is the salvage
   source: it already contains the two-phase completion, `batch-time-split`,
   the guarded RPC, and the status-aware i18n'd MES page.
   `PR1137=origin/loop/1010-20260714010219` is used for exactly one test file.
   Never `git merge` or `git cherry-pick` from either.
2. **Porting a NEW file** (does not exist on this branch):
   `git show $SRC:<path> > <path>`, then apply the edits the task lists.
3. **Porting changes to an EXISTING file** (main has drifted since July):
   ```bash
   git diff $(git merge-base main $SRC) $SRC -- <path> | git apply --3way
   ```
   Clean apply → done. Conflict markers → resolve using the task's "intent"
   line (each task states what the change accomplishes, so you resolve toward
   that outcome, keeping main's surrounding code). `git apply` refuses entirely
   → make the change by hand from the intent line, using
   `git diff $(git merge-base main $SRC) $SRC -- <path>` as reference.
4. **Never rebuild the database.** `pnpm db:migrate` applies pending
   migrations; if the local DB is unreachable, STOP and tell the user.
5. Typecheck is always scoped (`--filter=erp`, `--filter=mes`,
   `--filter=@carbon/utils`). Never whole-repo (OOMs).
6. Commit per task via `/check-and-commit`. Never push without explicit approval.
7. After any migration: `pnpm run generate:types` BEFORE typechecking. Then
   `git diff --stat packages/database/src/types.ts` — if the diff is dominated
   by deletions of tables unrelated to this feature, STOP and ask the user
   (stale local DB) instead of committing mass deletions.
8. Banned term: `git grep -inE 'st[i]tch' -- ':!*.po' ':!.ai/'` over your
   changed files must return nothing.
9. Spec wins over plan; code wins over both — surface conflicts, don't improvise.

## Conflict watch — capacity planning (PR #1151, `origin/naveen/capacity-planning`)

Open 39k-line PR, likely to merge first. Verified collisions (tip `f17db29ab`):

1. `processes` view: both migrations recreate it; theirs uses an explicit
   column list (no `p.*`). If it lands first, Task 2's view SQL must be rebuilt
   from THEIR list plus `"batchable"`. If we land first, tell their PR to add
   `"batchable"` to the list.
2. `get_active_job_operations_by_location`: theirs changes the signature (adds
   `work_center_ids TEXT[]`) and adds `hasConflict`/`conflictReason`. Task 2's
   pre-flight fails loudly if theirs landed — that's the rebase signal, not a
   plan bug. Second-lander merges both column sets.
3. Same-hunk UI conflicts: they add `requiresAbility` at the same spots we add
   `batchable` (`ProcessForm.tsx` after `completeAllOnScan`;
   `components/Form/Process.tsx` initialValues). Resolution: keep both fields.
4. Compatible column adds (no action): `process.requiresAbility` vs
   `batchable`; `jobOperation.readyAt` vs `jobOperationBatchId`.
5. Shared-file churn (schedule Kanban, both `path.ts`, MES operations files,
   production/resources models): mergeable. Generated types: regenerate, never
   hand-merge.
6. Semantic follow-up (NOT this plan's scope): their `capacityReservation` is
   per-operation with zero batch awareness → batch members would N×-over-book a
   work center, and nightly replan could re-assign one member's work center,
   splitting the batch. Raise on #1151 review; post-merge fix is coalescing
   reservations per `jobOperationBatchId` and pinning batched ops.

## Progress

- [x] Task 1: Port the batch-time-split util (+ tests + Deno mirror)
- [x] Task 2: Consolidated migration + sequence seed + config.toml
- [x] Task 3: Regenerate DB types
- [x] Task 4: Resources — process `batchable` flag end-to-end
- [x] Task 5: ERP production models + services
- [x] Task 6: `batch-operations` edge function + resume quantity contract
- [x] Task 7: ERP batch planning board + schedule integration
- [x] Task 8: MES — kanban collapse, batch page, complete route
- [ ] Task 9: Port and adapt the tests
- [ ] Task 10: i18n extraction + translation fill
- [ ] Task 11: AGENTS.md + spec changelog sync
- [ ] Task 12: Full verification gate
- [ ] Task 13: Browser verification via /test

## Dependencies

Task 1 independent. Task 2 → 3 → {4, 5, 6}. Task 6 also needs 1.
Task 7 needs 5. Task 8 needs 5 + 6. Task 9 needs 2. Task 10 needs 7 + 8.
Tasks 11 → 12 → 13 close out. Tasks 4 and 5 may run in parallel.

---

## Task 1: Port the batch-time-split util (+ tests + Deno mirror)

**Depends on:** none
**Files:**
- Create: `packages/utils/src/batch-time-split.ts`
- Create: `packages/utils/src/batch-time-split.test.ts`
- Create: `packages/database/supabase/functions/shared/batch-time-split.ts`
- Modify: `packages/utils/src/index.ts` — add `export * from "./batch-time-split";`
- Copy from (precedent): the same three paths on `$SRC`

**Steps:**
1. Copy all three files per ground rule 2.
2. Add the export line to `packages/utils/src/index.ts` alongside the existing
   `export * from` lines.
3. Confirm both TS files export `buildBatchCompletionPlan`,
   `planBatchCompletion`, `assertBatchCompletionMembership`,
   `sliceEventByWeight` (the edge fn imports all four). Missing export → STOP
   and report.

**Verify:**
```bash
pnpm --filter @carbon/utils test
# Expected: batch-time-split.test.ts runs, all tests pass, 0 failures
```

**Out of scope:** changing the util's math or API.

## Task 2: Consolidated migration + sequence seed + config.toml

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_job-operation-batching.sql` (via `pnpm db:migrate:new`)
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — intent: add the new-company sequence row `{ table: "jobOperationBatch", name: "Operation Batch", prefix: "BAT", next: 0, size: 6, step: 1 }` to the sequences array
- Modify: `packages/database/supabase/config.toml` — intent: add `[functions.batch-operations]` with `enabled = true`, `verify_jwt = true`
- Copy from (precedent): `$SRC:packages/database/supabase/migrations/20260707135312_job-operation-batching.sql` (base) and `$SRC:packages/database/supabase/migrations/20260716120250_batchable-operations-rpc-started-guard.sql` (RPC body)

**Steps:**
1. Pre-flight — confirm the definitions the salvage SQL was built on are still
   newest (they were on 2026-08-21; this catches capacity-planning landing):
   ```bash
   git fetch origin main
   git grep -l "get_active_job_operations_by_location" origin/main -- packages/database/supabase/migrations/ | tail -1
   # Expected: 20260531084723_rework-serial-flow.sql
   git grep -l 'VIEW "processes"' origin/main -- packages/database/supabase/migrations/ | tail -1
   # Expected: 20260721004140_operation-type-consolidation.sql  (def is textually identical to the salvage SQL's)
   ```
   Either expectation fails → STOP: rebase the ported view/RPC bodies onto the
   newer definitions first (see Conflict watch).
2. `pnpm db:migrate:new job-operation-batching` (never hand-pick a timestamp).
3. Fill the file with the salvage base migration, then make exactly three edits:
   a. Replace the enum creation with:
      ```sql
      DO $$ BEGIN
        CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completing', 'Completed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      ```
      (3 values — no `Cancelled`, `Completing` from day one.)
   b. Replace the base file's `get_batchable_operations` function with the
      version from the guard migration (it adds the started-op
      `NOT EXISTS (SELECT 1 FROM "productionEvent" …)` predicate and the
      `batchStatus` return column). Keep `SECURITY INVOKER` — it is the
      tenant-scoping mechanism and Task 9's test pins it.
   c. In that function's lane branch, change `OR b."status" = 'Active'` to:
      ```sql
      OR b."status" IN ('Active', 'Completing')
      ```
   Everything else from the base file stays verbatim: `process.batchable`
   column + `processes` view recreation, `jobOperationBatch` table (composite
   PK, RLS, audit columns), `jobOperation.jobOperationBatchId` FK + partial
   index, `productionEvent.jobOperationBatchId` FK + partial index, the
   existing-company `sequence` INSERT, and the additive
   `get_active_job_operations_by_location` re-declaration. Do NOT port the
   old `..._completing-status.sql` migration (obsolete — the enum already has
   the value).
4. Apply the seed.data.ts and config.toml intents (ground rule 3; both hunks
   are small and should apply cleanly).
5. `pnpm db:migrate`

**Verify:**
```bash
grep -c "Cancelled" packages/database/supabase/migrations/*_job-operation-batching.sql
# Expected: 0
grep -n "IN ('Active', 'Completing')" packages/database/supabase/migrations/*_job-operation-batching.sql
# Expected: exactly 1 match
grep -c "NOT EXISTS" packages/database/supabase/migrations/*_job-operation-batching.sql
# Expected: >= 1 (started-op guard present)
pnpm db:migrate
# Expected: applies with no error
```

**Out of scope:** other tables; the `issue` / `post-production-event` functions;
existing triggers.

## Task 3: Regenerate DB types

**Depends on:** Task 2
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. Both files carry uncommitted local edits from unrelated licensing work.
   Save `git diff packages/database/src/types.ts` to the scratchpad first and
   tell the user if regeneration clobbers those hunks.
2. `pnpm run generate:types`
3. Ground rule 7 check on the diff.

**Verify:**
```bash
grep -n '"Completing"' packages/database/src/types.ts | head -2
# Expected: jobOperationBatchStatus = "Active" | "Completing" | "Completed" (no "Cancelled" in this enum)
grep -c "jobOperationBatch" packages/database/src/types.ts
# Expected: > 0
```

**Out of scope:** hand-editing generated files.

## Task 4: Resources — process `batchable` flag end-to-end

**Depends on:** Task 3
**Files (all Modify, ground rule 3; intent per file):**
- `apps/erp/app/modules/resources/resources.models.ts` — `processValidator` gains `batchable: zfd.checkbox()`
- `apps/erp/app/modules/resources/ui/Processes/ProcessForm.tsx` — a `Boolean` field `name="batchable"`, label "Batchable", description "Multiple jobs can run on this process at the same time (laser table, furnace, plating bath)", inserted after the `completeAllOnScan` Boolean (same idiom)
- `apps/erp/app/modules/resources/ui/Processes/ProcessesTable.tsx` — a Batchable boolean badge column (same idiom as the Complete All On Scan column)
- `apps/erp/app/routes/x+/resources+/processes.$processId.tsx` and `processes.new.tsx` — pass `batchable` through insert/update payloads
- `apps/erp/app/components/Form/Process.tsx` — `batchable: false` in the create-modal initialValues
- `apps/erp/app/components/Form/Processes.tsx` — carry the flag in the select's row type

**Steps:**
1. Port each file per ground rule 3.
2. `upsertProcess` in `resources.service.ts` needs no change (the validator
   spread carries the field — the salvage diff has no service hunk). If
   typecheck disagrees, STOP and report rather than casting.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "batchable" apps/erp/app/modules/resources/resources.models.ts
# Expected: 1 line in processValidator
```

**Out of scope:** work centers; abilities; any other resources entity.

## Task 5: ERP production models + services

**Depends on:** Task 3
**Files (Modify, ground rule 3; intent per file):**
- `apps/erp/app/modules/production/production.models.ts` — add
  `jobOperationBatchStatus = ["Active", "Completing", "Completed"] as const`
  (the salvage version also has `"Cancelled"` — drop it; do NOT touch the JOB
  status consts that legitimately contain `"Cancelled"`), plus
  `createJobOperationBatchValidator`, `updateJobOperationBatchValidator`
  (add/remove/dissolve intents), `completeJobOperationBatchValidator` (member
  rows, int quantities ≥ 0, `zfd.repeatable` for array fields, no max-size rule)
- `apps/erp/app/modules/production/production.service.ts` — add
  `getJobOperationBatch`, `getBatchableOperations` (rpc wrapper),
  `getActiveBatchesByProcess`, and the four invoke wrappers
  `createJobOperationBatch` / `addToJobOperationBatch` /
  `removeFromJobOperationBatch` / `dissolveJobOperationBatch`, all
  `(client, ...) → {data, error}` shape

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -A3 "jobOperationBatchStatus" apps/erp/app/modules/production/production.models.ts | head -4
# Expected: exactly Active, Completing, Completed
```

**Out of scope:** scheduling/deadline services; non-batch validators.

## Task 6: `batch-operations` edge function + resume quantity contract

**Depends on:** Tasks 1, 3
**Files:**
- Create: `packages/database/supabase/functions/batch-operations/index.ts`
- Copy from (precedent): `$SRC:packages/database/supabase/functions/batch-operations/index.ts` (604 lines, already two-phase)

**Steps:**
1. Copy wholesale (ground rule 2).
2. Confirm by grep (do not rewrite): `FOR UPDATE` batch lock,
   `planBatchCompletion` slice/resume branch, guarded `Active → Completing`
   and `Completing → Completed` flips, `postedToGL` skip, Phase 2 throwing on
   first error (that IS the spec's fail-fast).
3. Add the resume payload contract. In Phase 1's `phase === "resume"` branch,
   BEFORE the existing event reload/return, insert (adapt local names — the
   validated payload array is the task's `members`):
   ```ts
   // Resume contract: the payload must match what Phase 1 already recorded —
   // an edited quantity on retry is rejected, never silently ignored.
   const recorded = await trx
     .selectFrom("productionQuantity")
     .select(["jobOperationId", "type", "quantity"])
     .where("jobOperationId", "in", members.map((m) => m.jobOperationId))
     .where("companyId", "=", companyId)
     .execute();
   const sums = new Map<string, { produced: number; scrap: number }>();
   for (const r of recorded) {
     const s = sums.get(r.jobOperationId) ?? { produced: 0, scrap: 0 };
     if (r.type === "Production") s.produced += Number(r.quantity);
     if (r.type === "Scrap") s.scrap += Number(r.quantity);
     sums.set(r.jobOperationId, s);
   }
   const mismatches = members.filter((m) => {
     const s = sums.get(m.jobOperationId) ?? { produced: 0, scrap: 0 };
     return s.produced !== m.quantity || s.scrap !== (m.scrapQuantity ?? 0);
   });
   if (mismatches.length > 0) {
     const detail = mismatches
       .map((m) => {
         const s = sums.get(m.jobOperationId) ?? { produced: 0, scrap: 0 };
         return `${m.jobOperationId}: ${s.produced} produced / ${s.scrap} scrap`;
       })
       .join(", ");
     throw new Error(
       `Quantities were already recorded for this batch (${detail}). ` +
         `Retry with the recorded values; corrections happen after completion.`
     );
   }
   ```
   Assumption: batch members were unstarted at batch time and batch completion
   is the only `productionQuantity` writer between `Active` and `Completing`,
   so per-op sums equal Phase-1 inserts. If the ported file shows another
   writer in that window, STOP and report.
4. Confirm the import of `../shared/batch-time-split.ts` resolves (Task 1).

**Verify:**
```bash
cd packages/database/supabase/functions && deno check batch-operations/index.ts; cd -
# Expected: no type errors. If deno is not installed, note the skip in the run
# log and rely on Task 12's gates.
grep -n "already recorded" packages/database/supabase/functions/batch-operations/index.ts
# Expected: 1 match
```

**Out of scope:** `issue`, `post-production-event`, other functions; error
aggregation (fail-fast is locked).

## Task 7: ERP batch planning board + schedule integration

**Depends on:** Task 5
**Files:**
- Create (ground rule 2): `apps/erp/app/modules/production/ui/Schedule/Batching/BatchingBoard.tsx`, `Batching/types.ts`, `Batching/index.ts`, `apps/erp/app/routes/x+/schedule+/batching.tsx`, `batching.update.tsx`
- Modify (ground rule 3; intent per file):
  - `apps/erp/app/utils/path.ts` — `scheduleBatching` + `scheduleBatchingUpdate` route paths, and in the `external` block next to `mesJobOperation` (line ~896): `mesBatch: (id: string) => \`${MES_URL}/x/batch/${id}\``
  - `apps/erp/app/routes/x+/schedule+/operations.tsx` — loader passes the RPC's new batch columns through to the kanban items
  - `.../Schedule/Kanban/ScheuleNavigation.tsx` (filename sic) — "Batching" nav entry
  - `.../Schedule/Kanban/components/ItemCard.tsx` — `BAT…` badge for batched ops; card menu gains "Batch planning" (nav, process pre-filtered) for batchable unbatched ops and a guarded "Remove from batch" for batched ones
  - `.../Schedule/Kanban/types.ts` — `processBatchable` / `jobOperationBatchId` / `batchReadableId` on the item type
- Copy from (precedent): same paths on `$SRC`; badge idiom for step 2c from `$SRC:apps/mes/app/routes/x+/batch.$batchId.tsx` (~lines 201–211)

**Steps:**
1. Port all files. Keep three v1 bug fixes that are already in the salvage:
   route imports concrete files (`./BatchingBoard`, `./types`), never a new
   directory barrel (Vite SSR cache bug); shared UI types live in
   `Batching/types.ts`, not the route (tsgo inference bug); array form fields
   use `zfd.repeatable`.
2. Add `Completing` read-only lanes (new work — salvage board is Active-only):
   a. `Batching/types.ts`: `status: "Active" | "Completing"` on `BatchLaneData`.
   b. `batching.tsx` loader, lane-partition block: thread the RPC's
      `batchStatus` into each lane (`status: r.batchStatus ?? "Active"`).
   c. `BatchingBoard.tsx`: when `lane.status === "Completing"` — don't register
      the lane as a droppable, hide dissolve + work-center controls, render a
      yellow `Completing` Badge, render an external link "Completion in
      progress — retry in Shop Floor" to `path.to.external.mesBatch(lane.id)`,
      and render member cards without drag handles.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "mesBatch" apps/erp/app/utils/path.ts
# Expected: 1 helper
grep -c "Completing" apps/erp/app/modules/production/ui/Schedule/Batching/BatchingBoard.tsx
# Expected: >= 2 (lane gating + badge)
```

**Out of scope:** board redesign; MRP/auto-suggestions; the operations board's
drag logic beyond the listed intents.

## Task 8: MES — kanban collapse, batch page, complete route

**Depends on:** Tasks 5, 6
**Files:**
- Create (ground rule 2): `apps/mes/app/routes/x+/batch.$batchId.tsx` (already status-aware: badge, `canRunTimer = status === "Active"`, "Retry Completion" relabel, live timer, `<Trans>` i18n), `apps/mes/app/routes/x+/batch.$batchId.complete.tsx` (single `invoke("batch-operations", { type: "complete" })`, no issue/GL loop)
- Modify (ground rule 3; intent per file):
  - `apps/mes/app/services/models.ts` — batch status const (3 values — drop `"Cancelled"` if the salvage hunk has it) + `completeJobOperationBatchValidator`
  - `apps/mes/app/services/operations.service.ts` — `getJobOperationBatch`, `startBatchProductionEvent`, batch-aware event helpers
  - `apps/mes/app/utils/path.ts` — `batch` + `batchComplete` path helpers
  - `apps/mes/app/routes/x+/operations.tsx` — loader collapses rows sharing `jobOperationBatchId` into one kanban card (member count, summed quantity, batch readableId)
  - `apps/mes/app/components/Kanban/components/ItemCard.tsx` — batch card renders the BAT badge and links to the batch view
  - `apps/mes/app/components/Kanban/types.ts` — batch fields on the item type
- Copy from (precedent): same paths on `$SRC`

**Steps:**
1. Port everything. `operations.tsx` has the largest drifted hunk (108 lines vs
   capacity-adjacent churn on main) — expect a 3-way conflict; resolve toward
   the collapse intent while keeping main's newer loader code.
2. Keep two v1 bug fixes already in the salvage page: completion pre-fill reads
   `operationQuantity` (NOT `targetQuantity ?? operationQuantity` — target is
   0, not null, so `??` pre-filled 0), and per-member fields use
   `NumberControlled`.
3. `grep -n "Cancelled" apps/mes/app/routes/x+/batch.\$batchId.tsx` — expected
   0; remove any dead branch found.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
grep -n "operationQuantity" "apps/mes/app/routes/x+/batch.\$batchId.tsx" | head -3
# Expected: pre-fill reads operationQuantity
grep -c "Trans" "apps/mes/app/routes/x+/batch.\$batchId.tsx"
# Expected: > 5
```

**Out of scope:** per-operation MES flows (`x+/complete.tsx`, start/end
routes); picking/issue UI.

## Task 9: Port and adapt the tests

**Depends on:** Task 2
**Files:**
- Create: `apps/erp/test/batching-migration-guards.test.ts` — from `$SRC`
- Create: `apps/erp/test/batching-tenant-scope-and-fk-locks.test.ts` — from `$PR1137`
- Create: `apps/mes/app/services/models.batch.test.ts` — from `$SRC`

**Steps:**
1. Copy all three (ground rule 2).
2. Both migration-reading tests reference old migration filenames
   (`20260707135312_...`, `20260716...`). Point every `read(...)` at the single
   Task-2 file (find it: `ls packages/database/supabase/migrations/*_job-operation-batching.sql`).
3. In the guards test, add two assertions: the enum line contains no
   `Cancelled`; the lane branch matches `IN \('Active', 'Completing'\)`.
4. In the tenant-scope test, keep every property it pins (`SECURITY INVOKER`,
   FK/lock behavior); where an assertion targets #1137's 4-migration split,
   rewrite it against our consolidated file — never delete the property.
5. `models.batch.test.ts`: align validator import names with our
   `apps/mes/app/services/models.ts` exports if they differ.

**Verify:**
```bash
pnpm run test
# Expected: all three new test files run and pass; no previously-green test breaks
```

**Out of scope:** DB-connected integration tests.

## Task 10: i18n extraction + translation fill

**Depends on:** Tasks 7, 8
**Files:**
- Modify (generated): `packages/locale/locales/*/erp.po`, `packages/locale/locales/*/mes.po`

**Steps:**
1. `pnpm lingui:extract`
2. Invoke `/translate` to fill new empty `msgstr` entries.
3. `pnpm lingui:clean` if the script exists.

**Verify:**
```bash
git status --short packages/locale | head
# Expected: erp.po AND mes.po updated across locales; no compiled .mjs staged
```

**Out of scope:** adding/renaming strings; locale list changes.

## Task 11: AGENTS.md + spec changelog sync

**Depends on:** Tasks 7, 8
**Files:**
- Modify: `apps/erp/app/modules/production/AGENTS.md` — port the salvage
  "Operation Batch" domain-concept paragraph, then delete its
  "(plus `Cancelled`)" parenthetical and add one sentence: a `Completing` retry
  must resubmit the recorded quantities (mismatches are rejected).
- Modify: `apps/erp/app/modules/resources/AGENTS.md` — port the salvage
  `batchable` flag mention.
- Modify: `.ai/specs/2026-08-21-job-operation-batching.md` — changelog entry:
  "Implemented on `feat/job-operation-batching-v2` (Tasks 1–11), migration
  `{timestamp}_job-operation-batching.sql`."

**Verify:**
```bash
grep -n "Cancelled" apps/erp/app/modules/production/AGENTS.md
# Expected: matches only in Job-status lines; zero in the Operation Batch paragraph
```

**Out of scope:** `.claude/rules/` (no durable convention changed); glossary.

## Task 12: Full verification gate

**Depends on:** Tasks 1–11

**Steps (in order; stop at first failure, fix, restart the failed step):**
```bash
pnpm run generate:types
pnpm run lint
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/utils
pnpm run test
pnpm run build
git grep -inE 'st[i]tch' -- ':!*.po' ':!.ai/' | grep -i batch
# Expected: every command exit 0; final grep prints nothing
```

**Verify:** paste the tail of each command's output into the run log.

**Out of scope:** deploying; pushing (ask first).

## Task 13: Browser verification via /test

**Depends on:** Task 12. Needs the user's running dev stack (`crbn up`) — if
unreachable, STOP and ask; never boot or rebuild it yourself.

**Steps:** invoke `/test` (which uses `/auth` first) with these scenarios:
1. Processes: toggle Batchable on a process → table badge shows; DB row
   `batchable = t`.
2. Batching board: candidates with material chips; a substance facet filter
   drops non-matching ops; drag 2 ops into "New batch" → `BAT…` created; drag
   one out; assign work center → members' `workCenterId` updated; dissolve
   works pre-start.
3. Eligibility: start a timer on an op in MES → it disappears from board
   candidates (RPC guard).
4. MES: kanban batch card; batch page Start → batch-tagged event; Stop;
   Complete with pre-filled quantities → members Done, next ops Ready, batch
   Completed, sliced per-member events sum to the recorded span ∝ quantity.
5. Resume: put a batch into `Completing` (cheapest simulated Phase-2 failure,
   or direct edge-fn invocation) and verify: yellow badge + "Retry Completion"
   in MES; read-only lane on the ERP board; retry with CHANGED quantities is
   rejected naming the recorded values; retry with the same values lands
   `Completed` with no duplicated issues/quantities/events/GL. Clean up seeded
   data.

**Verify:** `/test` report green on scenarios 1–4; scenario-5 evidence
(screenshots or response bodies) in the run log. Any failure → fix and re-run
before checking the box.

**Out of scope:** GL posting against real accounting config (needs accounts +
work-center rates; note as follow-up if the dev environment lacks them).
