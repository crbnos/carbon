# Job Operation Batching — implementation plan

**Spec:** `.ai/specs/2026-08-21-job-operation-batching.md` (all questions resolved; status in-progress)
**Research:** `.ai/research/job-operation-batching.md`
**Branch:** `feat/job-operation-batching-v2` (cut from `main` 2026-08-21)

## Executor ground rules

1. **Salvage sources are git refs, not merge targets.** Never `git merge` or
   `git cherry-pick` from them. Two refs:
   - `SRC=feat/job-operation-batching` (tip `8f7fc8a67`) — has the board/UX AND
     the already-ported two-phase completion, `batch-time-split`, RPC guard,
     status-aware i18n'd MES page.
   - `PR1137=origin/loop/1010-20260714010219` (tip `5bc2c86ce`) — used ONLY for
     one test file (Task 9).
   - **New files** (paths that don't exist on this branch): copy wholesale with
     `git show $SRC:<path> > <path>`, then apply the edits the task lists.
   - **Modified files** (paths that exist here): view the salvage diff with
     `git diff $(git merge-base main $SRC) $SRC -- <path>` and re-apply its
     hunks to the CURRENT file by hand (main has moved since July; do not
     overwrite).
2. **Never rebuild the database.** `pnpm db:migrate` applies pending migrations;
   if the local DB is unreachable, STOP and tell the user.
3. Typecheck is always scoped: `pnpm exec turbo run typecheck --filter=erp` /
   `--filter=mes` / `--filter=@carbon/utils`. Never whole-repo (OOMs).
4. Commit per task via `/check-and-commit`. Never push without explicit approval.
5. Spec wins over plan; code wins over both — surface conflicts, don't improvise.
6. The banned-term gate applies to everything this plan produces:
   `git grep -inE 'st[i]tch' -- ':!*.po'` on changed files must return nothing.
7. After any migration change: `pnpm run generate:types` BEFORE typechecking.
   Lesson (`.ai/lessons.md`): generated types must come from a migration-built
   database. After generating, run
   `git diff --stat packages/database/src/types.ts` — if the diff is dominated
   by deletions of tables unrelated to this feature, STOP and ask the user
   (their local DB may be stale) instead of committing mass deletions.

## Conflict watch — capacity planning (PR #1151, `origin/naveen/capacity-planning`)

An open 39k-line PR overlaps this feature. It will likely merge first — expect
to rebase onto it. Known collisions (verified 2026-08-21 against tip `f17db29ab`):

1. **`processes` view — guaranteed migration collision.** Their
   `20260720121629_capacity-planning.sql` recreates the view with an **explicit
   column list** (no more `p.*`). If they land first, our Task-2 view SQL must
   be rebuilt from THEIR list + `"batchable"`. If we land first, warn their PR:
   their explicit list will silently drop `batchable` from the view.
2. **`get_active_job_operations_by_location` — signature change.** They
   `DROP FUNCTION` and re-declare with a new param (`work_center_ids TEXT[]`)
   plus `hasConflict`/`conflictReason` columns. Whoever lands second merges
   BOTH column sets onto the surviving signature (ours adds `processBatchable`,
   `jobOperationBatchId`, `batchReadableId`). Task 2's pre-flight (expected
   newest file `20260531084723`) will fail loudly if theirs landed — that is
   the signal to rebase the RPC, not a plan bug.
3. **Same-hunk UI conflicts:** they add `requiresAbility` at the exact
   insertion points where we add `batchable` — `ProcessForm.tsx` (after the
   `completeAllOnScan` Boolean) and `components/Form/Process.tsx` initialValues.
   Resolution is always "keep both fields".
4. **Compatible column adds (no action):** `process.requiresAbility` vs
   `process.batchable`; `jobOperation.readyAt` vs
   `jobOperation.jobOperationBatchId`.
5. **Shared-file churn (mergeable, noisy):** `ScheuleNavigation.tsx`, schedule
   Kanban `ItemCard.tsx`/`types.ts`, `x+/schedule+/operations.tsx`,
   `production.models.ts`/`production.service.ts`, `resources.models.ts`, both
   `path.ts` files, MES `operations.tsx`/`operations.service.ts`/Kanban files.
   Generated types conflict too — resolve by regenerating, never by hand-merge.
6. **Semantic interplay (post-merge follow-up, NOT in this plan's scope):**
   their `capacityReservation` is per `operationId` and their scheduling engine
   has zero batch awareness — N batch members would each reserve the full
   shared run (N× over-booking), and their work-center-selector could re-assign
   one member off the batch's work center during nightly replan, physically
   splitting the batch. Their `schedule-inputs-changed` listener also reacts to
   `jobOperation` writes, so batch tagging will trigger replans. When both
   features are on `main`, the engine needs: (a) coalesce reservations for ops
   sharing `jobOperationBatchId`, (b) never re-assign a batched op's work
   center independently. Tracked as a spec risk; raise it on PR #1151 review.

## Progress

- [ ] Task 1: Port the batch-time-split util (+ tests + Deno mirror)
- [ ] Task 2: One consolidated migration + sequence seed + config.toml
- [ ] Task 3: Regenerate DB types
- [ ] Task 4: Resources module — process `batchable` flag end-to-end
- [ ] Task 5: ERP production models + services
- [ ] Task 6: `batch-operations` edge function (+ resume quantity contract)
- [ ] Task 7: ERP batch planning board + schedule integration
- [ ] Task 8: MES — kanban collapse, batch page, complete route
- [ ] Task 9: Port and adapt the tests
- [ ] Task 10: i18n extraction + translation fill
- [ ] Task 11: AGENTS.md + spec changelog sync
- [ ] Task 12: Full verification gate
- [ ] Task 13: Browser verification via /test

## Dependencies

- Task 1 independent (start any time).
- Task 2 → Task 3 → everything DB-typed (4, 5, 6, 7, 8).
- Task 6 needs 1 (Deno mirror) + 3. Task 7 needs 5. Task 8 needs 5 + 6.
- Tasks 4, 5 independent of each other. Task 9 needs 2 (reads migration text).
- Task 10 needs 7 + 8. Tasks 11–13 last, in order.

---

## Task 1: Port the batch-time-split util (+ tests + Deno mirror)

**Depends on:** none
**Files:**
- Create: `packages/utils/src/batch-time-split.ts`
- Create: `packages/utils/src/batch-time-split.test.ts`
- Create: `packages/database/supabase/functions/shared/batch-time-split.ts`
- Modify: `packages/utils/src/index.ts` — add the export line
- Copy from (precedent): same paths on `$SRC`

**Steps:**
1. `git show $SRC:packages/utils/src/batch-time-split.ts > packages/utils/src/batch-time-split.ts`
2. Same for the test file and the Deno mirror
   (`packages/database/supabase/functions/shared/batch-time-split.ts`).
3. Add to `packages/utils/src/index.ts` the export the salvage diff shows:
   `git diff $(git merge-base main $SRC) $SRC -- packages/utils/src/index.ts`
   (one `export * from "./batch-time-split";` style line — copy it verbatim).
4. Read both copied TS files once; confirm exports include
   `buildBatchCompletionPlan`, `planBatchCompletion`,
   `assertBatchCompletionMembership`, `sliceEventByWeight` (the edge fn imports
   these). If any is missing, STOP and report — do not improvise.

**Verify:**
```bash
pnpm --filter @carbon/utils test
# Expected: batch-time-split.test.ts listed, all tests pass, 0 failures
```

**Out of scope:** any change to the util's math or API; `proportional-shares`
(does not exist on this branch — nothing to delete).

## Task 2: One consolidated migration + sequence seed + config.toml

**Depends on:** none (but Task 3 follows immediately)
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_job-operation-batching.sql`
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — BAT sequence entry
- Modify: `packages/database/supabase/config.toml` — `[functions.batch-operations]`
- Copy from (precedent): `$SRC:packages/database/supabase/migrations/20260707135312_job-operation-batching.sql`
  and `$SRC:packages/database/supabase/migrations/20260716120250_batchable-operations-rpc-started-guard.sql`

**Steps:**
1. Pre-flight — confirm the two "newest definitions" the salvage SQL was built
   on are still newest on `main` (both were re-verified 2026-08-21; this
   re-checks in case `main` moved again):
   ```bash
   git grep -l "get_active_job_operations_by_location" origin/main -- packages/database/supabase/migrations/ | tail -1
   # Expected: 20260531084723_rework-serial-flow.sql
   git grep -l 'VIEW "processes"' origin/main -- packages/database/supabase/migrations/ | tail -1
   # Expected: 20260721004140_operation-type-consolidation.sql
   ```
   The `processes` view def in `20260721004140` is textually identical to the
   one in the salvage migration (`p.*` + workCenters + suppliers joins) — so
   the salvage SQL is current. If either expected filename differs, STOP and
   report: the ported function/view bodies must be rebased onto the newer
   definition first.
2. `pnpm db:migrate:new job-operation-batching` (never hand-pick the timestamp).
3. Fill the new file with the salvage base:
   `git show $SRC:packages/database/supabase/migrations/20260707135312_job-operation-batching.sql`
   then apply exactly these edits:
   a. **Enum** — replace the type creation with the 3-value enum (no
      `Cancelled`, `Completing` from day one):
      ```sql
      DO $$ BEGIN
        CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completing', 'Completed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      ```
   b. **RPC** — replace the base `get_batchable_operations` body with the
      version from
      `git show $SRC:packages/database/supabase/migrations/20260716120250_batchable-operations-rpc-started-guard.sql`
      (it has the started-op `NOT EXISTS "productionEvent"` guard and the
      `batchStatus` return column), with ONE further edit for the spec's
      read-only `Completing` lanes — the lane branch
      `OR b."status" = 'Active'` becomes:
      ```sql
      OR b."status" IN ('Active', 'Completing')
      ```
      Keep `SECURITY INVOKER` (the tenant-scoping mechanism — Task 9's test
      pins it).
   c. Keep everything else from the base file verbatim: `process.batchable`
      column + `processes` view recreation, `jobOperationBatch` table (RLS
      policies, composite PK, audit columns), `jobOperation.jobOperationBatchId`
      + partial index, `productionEvent.jobOperationBatchId` + partial index,
      the `sequence` INSERT for existing companies, and the additive
      `get_active_job_operations_by_location` re-declaration.
   d. Do NOT port `20260716115259_job-operation-batch-completing-status.sql`
      (its `ADD VALUE` is obsolete — 'Completing' is in the initial enum).
4. Re-apply the salvage hunks to `seed.data.ts` (new-company BAT sequence) and
   `config.toml` (`[functions.batch-operations]`, `enabled = true`,
   `verify_jwt = true`):
   `git diff $(git merge-base main $SRC) $SRC -- packages/database/supabase/functions/lib/seed.data.ts packages/database/supabase/config.toml`
5. `pnpm db:migrate`

**Verify:**
```bash
grep -c "Cancelled" packages/database/supabase/migrations/*_job-operation-batching.sql
# Expected: 0
grep -n "IN ('Active', 'Completing')" packages/database/supabase/migrations/*_job-operation-batching.sql
# Expected: 1 match (the lane branch)
grep -n "NOT EXISTS" packages/database/supabase/migrations/*_job-operation-batching.sql | head -3
# Expected: includes the productionEvent started-op guard
pnpm db:migrate
# Expected: migration applies with no error
```

**Out of scope:** any other table; any change to `issue`, `post-production-event`,
or existing triggers; the deprecated v1 migration filenames.

## Task 3: Regenerate DB types

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/types.ts` (generated)
- Modify: `packages/database/supabase/functions/lib/types.ts` (generated)

**Steps:**
1. NOTE: both files already carry uncommitted local changes from unrelated work
   (licensing). Before generating, save the current diff:
   `git diff packages/database/src/types.ts > /tmp/pre-existing-types.diff` and
   tell the user if regeneration clobbers unrelated hunks.
2. `pnpm run generate:types`
3. `git diff --stat packages/database/src/types.ts` — additive batch tables/
   enum expected. If dominated by unrelated deletions → ground rule 7: STOP.

**Verify:**
```bash
grep -n '"Completing"' packages/database/src/types.ts | head -2
# Expected: jobOperationBatchStatus enum includes "Completing" (and no "Cancelled" in that enum)
grep -n "jobOperationBatch" packages/database/src/types.ts | head -3
# Expected: table + relationship types present
```

**Out of scope:** hand-editing either generated file.

## Task 4: Resources module — process `batchable` flag end-to-end

**Depends on:** Task 3
**Files (all Modify — re-apply salvage hunks per ground rule 1):**
- `apps/erp/app/modules/resources/resources.models.ts` — `batchable: zfd.checkbox()` on `processValidator`
- `apps/erp/app/modules/resources/ui/Processes/ProcessForm.tsx` — Boolean field (precedent in-diff: clone of `completeAllOnScan`)
- `apps/erp/app/modules/resources/ui/Processes/ProcessesTable.tsx` — Batchable boolean column
- `apps/erp/app/routes/x+/resources+/processes.$processId.tsx` + `processes.new.tsx` — pass the field through
- `apps/erp/app/components/Form/Process.tsx` + `Processes.tsx` — salvage hunks (select components carry the flag)

**Steps:**
1. For each file: `git diff $(git merge-base main $SRC) $SRC -- <path>` and
   re-apply the hunks to the current file.
2. If `upsertProcess` in `resources.service.ts` needs no change (v1 passed the
   field through the validator spread — the salvage diff shows no service hunk),
   leave the service untouched. If typecheck complains about the insert shape,
   STOP and report rather than casting.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** any other resources entity; work-center schema.

## Task 5: ERP production models + services

**Depends on:** Task 3
**Files (Modify — re-apply salvage hunks):**
- `apps/erp/app/modules/production/production.models.ts`
- `apps/erp/app/modules/production/production.service.ts`

**Steps:**
1. Re-apply the salvage hunks (validators: `createJobOperationBatchValidator`,
   `updateJobOperationBatchValidator`, `completeJobOperationBatchValidator`,
   status const; services: `getJobOperationBatch`, `getBatchableOperations`,
   `getActiveBatchesByProcess`, create/add/remove/dissolve invoke wrappers).
2. **Enum edit:** in the ported `jobOperationBatchStatus` const array, keep
   exactly `["Active", "Completing", "Completed"]` — the salvage version
   includes `"Cancelled"`; drop it. (Careful: `production.models.ts` has other
   `"Cancelled"` entries for JOB status consts — touch only the batch const.)
3. Validators keep int quantities ≥ 0 and NO max-size rule anywhere.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -A3 "jobOperationBatchStatus" apps/erp/app/modules/production/production.models.ts | head -5
# Expected: exactly Active, Completing, Completed
```

**Out of scope:** deadline/scheduling services; any non-batch validator.

## Task 6: `batch-operations` edge function (+ resume quantity contract)

**Depends on:** Tasks 1, 3
**Files:**
- Create: `packages/database/supabase/functions/batch-operations/index.ts`
- Copy from (precedent): `$SRC:packages/database/supabase/functions/batch-operations/index.ts` (604 lines — already two-phase + fail-fast)

**Steps:**
1. `git show $SRC:packages/database/supabase/functions/batch-operations/index.ts > packages/database/supabase/functions/batch-operations/index.ts`
2. Confirm the ported file already has (grep, don't rewrite): `FOR UPDATE`
   batch lock, `planBatchCompletion` slice/resume branch, guarded
   `Active → Completing` and `Completing → Completed` flips, `postedToGL`
   skip, and throws-on-first-error Phase 2 (this IS the spec's fail-fast).
3. **Add the resume payload contract** (spec: "reject changed quantities
   loudly"). In Phase 1's `phase === "resume"` branch, BEFORE returning, insert:
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
   Adapt identifier names to the ported file's actual locals (`members` is the
   validated payload array). Assumption: batch members were unstarted at batch
   time and batch completion is the only `productionQuantity` writer between
   `Active` and `Completing`, so per-op sums equal Phase-1 inserts. If the
   ported file shows another writer in that window, STOP and report.
4. Confirm the import path of the Deno `batch-time-split` mirror resolves
   (`../shared/batch-time-split.ts` from Task 1).

**Verify:**
```bash
cd packages/database/supabase/functions && deno check batch-operations/index.ts; cd -
# Expected: no type errors (if deno is not installed locally, run
# `pnpm exec turbo run typecheck --filter=@carbon/database` if such a target exists;
# otherwise note the skip in the run log and rely on Task 12's gates)
grep -n "already recorded" packages/database/supabase/functions/batch-operations/index.ts
# Expected: 1 match (the new resume contract)
```

**Out of scope:** the `issue` fn, `post-production-event`, any other function;
error aggregation (fail-fast is the locked decision).

## Task 7: ERP batch planning board + schedule integration

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/modules/production/ui/Schedule/Batching/BatchingBoard.tsx`, `types.ts`, `index.ts`
- Create: `apps/erp/app/routes/x+/schedule+/batching.tsx`, `batching.update.tsx`
- Modify (re-apply salvage hunks): `apps/erp/app/utils/path.ts`,
  `apps/erp/app/routes/x+/schedule+/operations.tsx`,
  `apps/erp/app/modules/production/ui/Schedule/Kanban/ScheuleNavigation.tsx` (file name sic),
  `.../Kanban/components/ItemCard.tsx`, `.../Kanban/types.ts`
- Copy from (precedent): same paths on `$SRC`

**Steps:**
1. Copy the three new `Batching/` files and the two new routes wholesale from
   `$SRC`; re-apply hunks to the five modified files. Known v1 gotchas already
   fixed in the salvage (keep them): route imports concrete files
   (`/BatchingBoard`, `/types`), never a new directory barrel (Vite SSR cache
   bug); shared UI types live in `ui/Schedule/Batching/types.ts`, never in the
   route file (tsgo inference bug); array form fields use `zfd.repeatable`.
2. **Add `Completing` read-only lanes** (spec decision; the salvage board is
   Active-only):
   a. In `Batching/types.ts`, add `status: "Active" | "Completing"` to
      `BatchLaneData`.
   b. In `batching.tsx`'s loader lane-partition block (builds `batchMap` from
      RPC rows), thread the RPC's `batchStatus` column into the lane:
      `status: r.batchStatus ?? "Active"`.
   c. In `BatchingBoard.tsx`: for a lane with `status === "Completing"` —
      do not register it as a droppable, hide the dissolve and work-center
      controls, render `<Badge variant="yellow">Completing</Badge>` (copy the
      badge idiom from the MES batch page salvage,
      `$SRC:apps/mes/app/routes/x+/batch.$batchId.tsx` lines ~201–211), and
      render an external link "Completion in progress — retry in Shop Floor"
      to `path.to.external.mesBatch(lane.id)`.
   d. In `apps/erp/app/utils/path.ts`, next to the existing
      `mesJobOperation: (id) => \`${MES_URL}/x/operation/${id}\`` external
      helper (line ~896 on main), add:
      `mesBatch: (id: string) => \`${MES_URL}/x/batch/${id}\``.
   e. Member cards inside a `Completing` lane render without drag handles
      (not draggable out).
3. Schedule kanban ItemCard hunks: BAT badge + "Batch planning" / guarded
   "Remove from batch" menu items — straight from the salvage diff.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "mesBatch" apps/erp/app/utils/path.ts
# Expected: 1 helper
grep -n "Completing" apps/erp/app/modules/production/ui/Schedule/Batching/BatchingBoard.tsx | head -3
# Expected: read-only lane gating present
```

**Out of scope:** redesigning board layout/filters; MRP or auto-suggestions;
the operations schedule board's drag logic beyond the salvage hunks.

## Task 8: MES — kanban collapse, batch page, complete route

**Depends on:** Tasks 5, 6
**Files:**
- Create: `apps/mes/app/routes/x+/batch.$batchId.tsx` (331 ln — already status-aware, gated timers, "Retry Completion", live timer, `<Trans>` i18n)
- Create: `apps/mes/app/routes/x+/batch.$batchId.complete.tsx` (62 ln — single invoke, no issue/GL loop)
- Modify (re-apply salvage hunks): `apps/mes/app/services/models.ts`,
  `apps/mes/app/services/operations.service.ts`, `apps/mes/app/utils/path.ts`,
  `apps/mes/app/routes/x+/operations.tsx`,
  `apps/mes/app/components/Kanban/components/ItemCard.tsx`,
  `apps/mes/app/components/Kanban/types.ts`
- Copy from (precedent): same paths on `$SRC`

**Steps:**
1. Copy the two new batch routes wholesale; re-apply hunks to the six modified
   files (`operations.tsx` has 108 changed lines and main has moved — apply
   hunk-by-hunk, typecheck after).
2. If the MES `models.ts` status const includes `"Cancelled"`, reduce it to
   `["Active", "Completing", "Completed"]` (mirror of Task 5 step 2). Then
   `grep -n "Cancelled" apps/mes/app/routes/x+/batch.$batchId.tsx` — remove any
   dead branch (the salvage page gates on `Completing`/`Active` only, so
   expected: 0 matches).
3. Keep the salvage page's completion pre-fill based on `operationQuantity`
   (NOT `targetQuantity ?? operationQuantity` — v1 bug: targetQuantity is 0,
   not null, so `??` pre-filled 0) and `NumberControlled` for the per-member
   fields. Both fixes are already in the salvage tip; verify they survived the
   port.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
grep -n "operationQuantity" apps/mes/app/routes/x+/batch.\$batchId.tsx | head -3
# Expected: pre-fill reads operationQuantity
grep -cn "Trans\b" apps/mes/app/routes/x+/batch.\$batchId.tsx
# Expected: > 5 (page is i18n'd)
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
1. Copy all three (`git show <ref>:<path> > <path>`).
2. `batching-migration-guards.test.ts` reads migration files by NAME — update
   every `read("20260707135312_job-operation-batching.sql")` /
   `read("20260716...")` reference to the single Task-2 filename (glob it:
   `ls packages/database/supabase/migrations/*_job-operation-batching.sql`).
   Add two assertions: the enum line contains no `Cancelled`; the lane branch
   matches `IN \('Active', 'Completing'\)`.
3. `batching-tenant-scope-and-fk-locks.test.ts`: adapt its migration-file
   references the same way; keep its FK/`SECURITY INVOKER` assertions. If an
   assertion targets #1137-only SQL that our migration legitimately does
   differently (e.g. their 4-migration split), rewrite the assertion against
   our consolidated file — do not delete the property being tested.
4. `models.batch.test.ts`: validator import paths should match our
   `apps/mes/app/services/models.ts` exports; adjust names only if typecheck
   demands.

**Verify:**
```bash
pnpm run test
# Expected: the three new test files run and pass; no previously-green test breaks
```

**Out of scope:** DB-connected integration tests (no live-DB testing in this
plan; browser verification is Task 13).

## Task 10: i18n extraction + translation fill

**Depends on:** Tasks 7, 8
**Files:**
- Modify: `packages/locale/locales/*/erp.po`, `packages/locale/locales/*/mes.po` (generated)

**Steps:**
1. `pnpm lingui:extract`
2. Invoke `/translate` to fill the new empty `msgstr` entries.
3. `pnpm lingui:clean` if the repo scripts define it (v1 flow did).

**Verify:**
```bash
git status --short packages/locale | head
# Expected: mes.po AND erp.po updated across locales; no compiled .mjs staged
```

**Out of scope:** adding/renaming strings (that happened in Tasks 7–8); locale
list changes.

## Task 11: AGENTS.md + spec changelog sync

**Depends on:** Tasks 7, 8
**Files:**
- Modify: `apps/erp/app/modules/production/AGENTS.md` — re-apply the salvage
  hunk (Operation Batch domain concept), then EDIT it: the salvage text says
  status `Active → Completing → Completed` "(plus `Cancelled`)" — delete the
  parenthetical; add one sentence for the resume contract (retry must resubmit
  the recorded quantities).
- Modify: `apps/erp/app/modules/resources/AGENTS.md` — salvage hunk (batchable flag).
- Modify: `.ai/specs/2026-08-21-job-operation-batching.md` — changelog entry:
  "Implemented on `feat/job-operation-batching-v2` (Tasks 1–11), migration
  `{timestamp}_job-operation-batching.sql`."

**Verify:**
```bash
grep -c "Cancelled" apps/erp/app/modules/production/AGENTS.md
# Expected: only job-status mentions remain (lines about Job statuses); zero in the Operation Batch paragraph
```

**Out of scope:** `.claude/rules/` (no durable convention changed); glossary.

## Task 12: Full verification gate

**Depends on:** Tasks 1–11
**Files:** none

**Steps (in order; stop at first failure and fix before proceeding):**
```bash
pnpm run generate:types        # no-op if Task 3 committed cleanly
pnpm run lint
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/utils
pnpm run test
pnpm run build
git grep -inE 'st[i]tch' -- ':!*.po' ':!.ai/' | grep -i batch
# Expected: no output (banned term absent from feature code)
```

**Verify:** every command exits 0; paste the tail of each into the run log.

**Out of scope:** deploying; pushing (ask first).

## Task 13: Browser verification via /test

**Depends on:** Task 12; requires the user's running dev stack (`crbn up`) — if
no stack is reachable, STOP and ask the user to start it (never boot or rebuild
it yourself).
**Files:** none (playbook may be cached to `.ai/playbooks/`)

**Steps:** invoke `/test` with this scenario list (ERP then MES; `/auth` first):
1. Resources → Processes: toggle Batchable on a process; table shows the badge;
   DB row has `batchable = t`.
2. Schedule → Batching board: candidates listed with material chips; facet
   filter narrows (substance filter drops non-matching ops); drag 2 ops → "New
   batch" creates `BAT…`; drag one out; drag back; assign work center →
   members' `workCenterId` updated; dissolve works pre-start.
3. Eligibility: an op with a recorded productionEvent does NOT appear as a
   candidate (start a timer on one op in MES first).
4. MES: batch card collapse on the kanban; batch page Start → batch-tagged
   event; Stop; Complete with pre-filled quantities → members Done, batch
   Completed, per-member sliced events sum to the recorded span ∝ quantity.
5. Resume path: complete a second batch but simulate a Phase-2 failure if
   fake-able cheaply (e.g. temporarily misconfigure so `issue` fails), else
   verify by direct edge-fn invocation that a `Completing` batch (a) shows the
   yellow badge + "Retry Completion" in MES, (b) shows a read-only lane on the
   ERP board, (c) rejects a retry with changed quantities naming the recorded
   values, (d) completes on retry with the same values. Cleanup any seeded data.

**Verify:** `/test` run report green on scenarios 1–4; scenario 5 evidence
(screenshots or response bodies) attached to the run log. Any failure → fix,
re-run, only then check the box.

**Out of scope:** GL posting verification against real accounting config (needs
accounts + work-center rates; note as follow-up if the environment lacks them).
