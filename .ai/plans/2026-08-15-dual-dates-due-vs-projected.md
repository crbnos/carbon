# Dual Dates (backward due vs forward projected) — implementation plan

**Spec:** .ai/specs/2026-08-15-dual-dates-due-vs-projected.md
**Research:** .ai/research/labor-machine-capacity-scheduling.md (+ origin/main archaeology in the spec's audit)
**Branch:** naveen/capacity-planning

Core invariants (spec §2 hard rule): the backward pass writes `jobOperation.dueDate`
targets and is read by NOTHING in placement; forward placement output moves to
`jobOperation.projectedCompletionAt`; `dueDate` is diff-written (only when the
computed need-by differs from the stored value); the engine stays a pure function
of one snapshot with one `now`.

Reference implementation for the backward walk: `git show origin/main:packages/database/supabase/functions/lib/scheduling/date-calculator.ts`
(BackwardSchedulingStrategy, lines ~79–242) — port its logic, do not reinvent it.

## Progress
- [ ] Task 1: New migration — jobOperation.projectedCompletionAt + RPC columns
- [ ] Task 2: Apply migration + regenerate types
- [ ] Task 3: Engine — need-by calculator module (pure, Deno-tested)
- [ ] Task 4: Engine — wire need-by pass into run(), split the persist, un-freeze pins
- [ ] Task 5: Engine — placement-isolation determinism guard + test updates
- [ ] Task 6: Services — promise-date fallback, timeline/capacity selects, MES threading
- [ ] Task 7: UI — BOP dual dates + behind-target state
- [ ] Task 8: UI — ops board ItemCard + MES operation detail projected line
- [ ] Task 9: Engine — behind-target attribution in the job schedule note
- [ ] Task 10: Docs sync
- [ ] Task 11: i18n extraction
- [ ] Task 12: Browser verification via /test

## Dependencies
- Task 2 needs Task 1; everything typed needs Task 2.
- Tasks 3→4→5 sequential (same engine files). Task 9 after Task 4.
- Task 6 needs Task 2; Tasks 7–8 need Tasks 2 and 6 (and Task 4 for live values).
- Tasks 10–12 last; Task 12 needs a running stack (user boots it).

---

## Task 1: New migration — projectedCompletionAt + RPC columns

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_dual-dates.sql` via `pnpm db:migrate:new dual-dates`

**Steps:**
1. `pnpm db:migrate:new dual-dates` (never hand-pick the timestamp; HHMMSS must not be 000000).
2. Migration content:

```sql
-- Dual dates: jobOperation.dueDate becomes the backward demand-anchored
-- need-by target; the forward forecast gets its own column.
ALTER TABLE "jobOperation" ADD COLUMN IF NOT EXISTS "projectedCompletionAt" TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN "jobOperation"."projectedCompletionAt" IS
  'Forward finite simulation: when this operation is projected to finish. Volatile (rewritten every regen).';
COMMENT ON COLUMN "jobOperation"."dueDate" IS
  'Backward demand-anchored need-by: finish by this day or the job slips. Stable (changes only when job dueDate, routing, or lead times change). manuallyScheduled = a human owns this value.';
```

3. Recreate `get_active_job_operations_by_location`: fork the FULL definition verbatim from `packages/database/supabase/migrations/20260720121629_capacity-planning.sql` (the newest), add `"projectedCompletionAt" TIMESTAMP WITH TIME ZONE` to the RETURNS TABLE and `jo."projectedCompletionAt"` to the SELECT (keep `ORDER BY jo."startDate", jo."priority"`). `DROP FUNCTION IF EXISTS get_active_job_operations_by_location;` first.
4. Recreate `get_job_operation_by_id`: fork the FULL definition verbatim from `20260721004140_operation-type-consolidation.sql` (main-owned newest — this is WHY the change ships as a new migration), add the same column. `DROP FUNCTION IF EXISTS` first. Diff your forked bodies against the sources (`git diff --no-index` on extracted copies) to prove only the new column differs — the forked-function-drops-siblings lesson applies.
5. No backfill statements — the next regen rewrites both date columns for every open op.

**Verify:**
```bash
grep -c "projectedCompletionAt" packages/database/supabase/migrations/*dual-dates.sql
# Expected: >= 5 (column + comment + 2 RPC decls + 2 selects)
```

**Out of scope:** any edit to `20260720121629` or `20260721004140` themselves; the three employee RPCs (`get_active_job_operations_by_employee` etc. — MES lists don't show projections in v1).

## Task 2: Apply migration + regenerate types

**Depends on:** Task 1

**Steps:**
1. `pnpm db:migrate` (applies the new migration to the local DB and regenerates types + swagger). If the local DB is unreachable, STOP and report — never boot or reset it yourself.
2. `pnpm exec turbo run typecheck --filter=@carbon/database`

**Verify:**
```bash
grep -c "projectedCompletionAt" packages/database/src/types.ts
# Expected: >= 2 (job + jobOperation)
```

**Out of scope:** fixing erp/mes typecheck (they don't reference the new column yet).

## Task 3: Engine — need-by calculator module

**Depends on:** Task 2
**Files:**
- Create: `packages/database/supabase/functions/lib/scheduling/need-by-calculator.ts`
- Create: `packages/database/supabase/functions/lib/scheduling/need-by-calculator.test.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts` — add `operationLeadTime` to the operation select; add `types.ts` field
- Copy from (precedent): `git show origin/main:packages/database/supabase/functions/lib/scheduling/date-calculator.ts` — port `BackwardSchedulingStrategy.calculateDates` (~L79–242)

**Steps:**
1. Pure export:
   ```ts
   export function computeNeedByDates(args: {
     operations: ScheduledOperation[];          // durations already computed
     graph: DependencyGraph;                    // DependencyGraphImpl instance
     jobDueDate: string | null;                 // "YYYY-MM-DD"
     calendarHoursPerDay: (workCenterId: string | null) => number; // ladder-derived; location fallback
     workingDayTest: (workCenterId: string | null, isoDate: string) => boolean; // zero-hour days skipped
   }): Map<string, string | null>               // operationId -> need-by "YYYY-MM-DD"
   ```
   Port main's walk exactly: `jobDueDate` null → every op maps to null; reverse topological order; leaf ops (no dependents) → due = jobDueDate; else per dependent constraint = dependent's need-by START minus that dependent's `operationLeadTime` working days, minus `op.assemblyLeadTime` working days when the edge crosses make methods (`op.jobMakeMethodId !== depOp.jobMakeMethodId`); due = min over constraints. Need-by start = due minus `ceil(durationHours / calendarHoursPerDay(wc))` working days (min 1 day; `workingDayTest` replaces main's hardcoded Sat/Sun skip). `"With Previous"` ops copy their predecessor's target dates. `manuallyScheduled` ops with a stored `dueDate`: the map returns the stored value unchanged AND upstream ops derive their constraints from it (the pin propagates). NO conflict flags, NO writes — pure map out.
2. Provider: add `jo."operationLeadTime"` to the operation select in `master-data-provider.ts` (same query that loads times/quantities); add `operationLeadTime: number | null` to the operation type in `types.ts`. `assemblyLeadTime` plumbing already exists (`assignAssemblyLeadTimes`).
3. Ladder helpers: derive `calendarHoursPerDay`/`workingDayTest` from the Task-3-existing `getWorkCenterAvailability` windows (hours per weekday = window minutes on that weekday / 60; a day with zero window minutes is non-working). Location fallback for ops with null `workCenterId`. Implement as a small pure adapter in `need-by-calculator.ts` taking the windows map — no new DB reads.
4. Tests (port main's two `date-calculator.test.ts` cases as a base, then add): leaf-anchor; min-dependent constraint with two consumers; `operationLeadTime = 2` pulls feeders 2 working days earlier; assembly-edge lead time applies only across make methods; With Previous copy; calendar day-lengths (16h WC halves the day count of an 8h WC for the same hours); zero-hour-day skipping (a WC closed Fridays lands targets on Thursday); pin passthrough + upstream propagation; null jobDueDate → all null.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-check lib/scheduling/need-by-calculator.test.ts
# Expected: all pass (>= 9 tests)
```

**Out of scope:** wiring into the engine (Task 4); any placement file.

## Task 4: Engine — wire the pass, split the persist, un-freeze pins

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/apply-work-center-selections.ts` (+ its test)
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/date-calculator.ts` — pinned-op seed
- Modify: `packages/database/supabase/functions/lib/scheduling/types.ts` — `ScheduledOperation.projectedCompletionAt`

**Steps:**
1. `run()`: after dependencies + duration map are built and BEFORE `selectWorkCenters`, compute `needByByOperation = computeNeedByDates(...)` using the same availability windows the finite context loads (load them once, share). Store on the engine.
2. `apply-work-center-selections.ts:49-50`: keep `startDate = businessDay(placedStart)`; REPLACE the `dueDate = businessDay(placedEnd)` write with `projectedCompletionAt = placedEnd.toISOString()` (exact instant, new `ScheduledOperation` field). Update its tests: assert `projectedCompletionAt` (instant) instead of `dueDate`; keep the tz/business-day assertions for `startDate`.
3. `persistChanges` (`scheduling-engine.ts:977-1006`): single unified branch for all ops — write `startDate`, `projectedCompletionAt`, `priority`, `workCenterId`, `hasConflict`, `conflictReason`; write `dueDate` = `needByByOperation.get(op.id)` ONLY when it differs from the loaded `op.dueDate` AND the op is not `manuallyScheduled` (diff-write; quiet regens touch zero dueDate values). Delete the manual/non-manual branch split.
4. Un-freeze pins: in `work-center-selector.ts`, delete the `manuallyScheduled` frozen-window branch (~L404-407 reservation of pinned `startDate→dueDate`); pinned ops flow through normal placement (sticky WC rule still applies via their `workCenterId`). In `date-calculator.ts` `buildScheduledOperations`, pinned ops no longer seed `startDate` from storage (placement fills it); they DO keep `dueDate` (the pin). Outside-processing ops unchanged.
5. Audit the engine for any placement read of `op.dueDate` after these changes: `grep -n '\.dueDate' lib/scheduling/work-center-selector.ts lib/scheduling/slot-allocator.ts` — remaining hits must be only the outside-op window (~L356) and job-level `jobDueDate` verdicts. Add the hard-rule comment at the `earliestMs` computation: "NEVER floor placement on op.dueDate — targets are outputs, not constraints (spec 2026-08-15)."
6. Update `work-center-selector.test.ts` pinned-op cases: pins no longer reserve windows; assert the pinned op gets placed and keeps its `dueDate`.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-check lib/scheduling/
# Expected: all pass (previous 130+ plus new/updated cases; zero failures)
```

**Out of scope:** newly-late/job-verdict logic (unchanged — job-level); the expedite path (returns job-level projection; untouched).

## Task 5: Placement-isolation determinism guard

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/determinism.test.ts`

**Steps:**
1. Add a test: run the fixture batch twice — once with `computeNeedByDates` active, once with the need-by map forced empty (null jobDueDate or a bypass arg) — and assert the placement multisets (`{resourceId, operationId, startAt, endAt}`) are deeply equal. This pins the spec's hard rule: targets never influence placement.
2. Add a stability test: two identical runs produce identical need-by maps; changing only a reservation/downtime input leaves the need-by map byte-identical while placements move.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-check lib/scheduling/determinism.test.ts
# Expected: all pass including the two new tests
```

**Out of scope:** envelope test (backward pass adds negligible cost; no threshold change).

## Task 6: Services — promise fallback, selects, MES threading

**Depends on:** Task 2 (Task 4 for live values)
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts`
- Modify: `apps/mes/app/services/operations.service.ts`, `apps/mes/app/services/display.service.ts`

**Steps:**
1. `getJobPromiseDate` (`production.service.ts:3594-3638`): delete the `max(op.dueDate)` fallback (it would now return ≈ the job due date — circular); return `{ promiseDate: job.projectedCompletionAt ?? null, basis: "schedule", confidence }` (confidence logic unchanged). Function is currently uncalled — safe.
2. `getJobOperationsForTimeline` (`:1039-1052`): add `projectedCompletionAt` to the select.
3. MES: thread the new RPC column — `get_job_operation_by_id` consumer in `operations.service.ts` picks up `projectedCompletionAt` via regenerated types; `display.service.ts` passes it through to the operation-detail shape (`:375` area) WITHOUT touching the sort (`compareDueDates` stays on `operationDueDate ?? jobDueDate` — now need-by, which is the point).
4. ERP ops-board loader `apps/erp/app/routes/x+/priority+/operations.tsx:240`: map `projectedCompletionAt: op.projectedCompletionAt` alongside `dueDate` onto the ItemCard item type (`Kanban/types.ts`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit 0
```

**Out of scope:** capacity view (`getPeopleCapacityOperations` / `peopleCapacity.server.ts`) — its dueDate keying is now semantically correct as-is; the picking RPC; employee RPCs.

## Task 7: UI — BOP dual dates + behind-target state

**Depends on:** Tasks 4, 6
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx` (op rows ~L178, 301-304)
- Modify: `apps/erp/app/modules/production/ui/Jobs/OperationDueDatePicker.tsx`
- Copy from (precedent): the existing due-date rendering in the same rows; amber styling from `JobCard.tsx` `scheduleOutdatedReason` tooltip (L268-277 pattern)

**Steps:**
1. Op rows render both dates: due (need-by, existing position) plus a secondary muted `t`Projected {formatDate(projectedCompletionAt.slice(0,10))}``. When `businessDay(projected) > dueDate`, style the projected text amber with a Tooltip `t`Behind target by {n} day(s)`` — day math via `parseDate` diff, never JS Date arithmetic.
2. `OperationDueDatePicker`: add a tooltip/description line `t`The date this operation must finish to keep the job on schedule. Pinning it overrides the calculated target.`` No mechanical change (still writes `dueDate` + `manuallyScheduled`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** forcing placement from pins (removed behavior — do not re-add); dates board; JobHeader.

## Task 8: UI — ItemCard + MES operation detail projected line

**Depends on:** Tasks 4, 6
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Schedule/Kanban/components/ItemCard.tsx` (due display L363-367, overdue L139)
- Modify: `apps/erp/app/modules/production/ui/Schedule/Kanban/types.ts`
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` (due render ~L631-634, 741-752)
- Copy from (precedent): each file's existing due-date line; MES sizing convention `size="lg"`

**Steps:**
1. ItemCard: under the existing due-date line add muted `t`Proj. {date}``; amber when behind target (same test as Task 7). The overdue test at L139 stays on `dueDate` — that is now correct semantics.
2. MES operation detail: same secondary line in the header/date block, `size="lg"` per MES convention; `isOverdue` (`useOperation.tsx:360`) untouched.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit 0
```

**Out of scope:** MES queue sort; employee list cards (no projection column in their RPCs, v1).

## Task 9: Behind-target attribution in the schedule note

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts` (job-level persist, near the newly-late computation ~L948-957)
- Modify: `packages/database/supabase/functions/lib/scheduling/conflict-messages.ts` (+ test)

**Steps:**
1. When the job-level verdict is late, find the FIRST op in topological order with a non-null need-by whose `projectedCompletionAt` business day exceeds it; append to the job's late-conflict sentence: `` `First behind target: ${opDescription} (due ${needBy}, projected ${projectedDay})` `` via a small pure `composeBehindTarget` helper in `conflict-messages.ts` with a unit test (present/absent/no-needby cases).
2. Ops-level: no `hasConflict` change (spec: informational only).

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-check lib/scheduling/conflict-messages.test.ts
# Expected: all pass including the new composeBehindTarget cases
```

**Out of scope:** notification content changes (digest stays job-level).

## Task 10: Docs sync

**Depends on:** Tasks 1–9
**Files:**
- Modify: `.claude/rules/scheduling-data-structures.md`, `apps/erp/app/modules/production/AGENTS.md`, `.ai/specs/2026-08-15-dual-dates-due-vs-projected.md` (changelog), `.ai/plans/2026-08-15-forecast-first-adoption-test-plan.md`

**Steps:**
1. Rule + AGENTS.md: document the dual-date semantics (dueDate = need-by, diff-written by the backward pre-step; projectedCompletionAt = forecast; pins = target ownership, no frozen window; placement never reads op dueDate). Verify every sentence against the code as written.
2. Adoption test plan: X1 determinism drill gains "need-by values byte-identical across capacity-only changes"; add a dual-dates drill row (pin an op → upstream targets shift; downtime → projections move, targets don't).
3. Spec changelog: implementation-landed entry.

**Verify:**
```bash
grep -rn "frozen window\|dueDate.*forward finish" .claude/rules/scheduling-data-structures.md apps/erp/app/modules/production/AGENTS.md
# Expected: no output (stale semantics scrubbed)
```

## Task 11: i18n extraction

**Depends on:** Tasks 7–8

**Steps:**
1. `pnpm run lingui:extract`, then invoke `/translate` for the new strings ("Projected …", "Behind target by …", picker description), then `pnpm run lingui:clean`.

**Verify:**
```bash
grep -c 'msgstr ""' packages/locale/locales/es/erp.po
# Expected: 0
```

## Task 12: Browser verification via /test

**Depends on:** all prior; needs the running stack (user boots it — STOP if down).

**Steps:**
1. Scenarios: (a) open a released job's BOP — every op shows Due + Projected; drag the job's due date earlier on the dates board → after regen, op due dates tighten while projected dates hold; (b) pin an op's due date → upstream ops' due dates re-derive from the pin; regen does not overwrite the pin; (c) add downtime to the op's work center → projected dates slip and go amber against unchanged due dates; job schedule note names the first behind-target op; (d) MES operation detail shows the projected line; queue order unchanged.
2. Screenshots per playbook convention; update the cached forecast-first playbook.

**Verify:** /test report, all scenarios passing.
