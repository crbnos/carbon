# Forecast-First Finite Scheduling — implementation plan (complete)

**Status:** complete — all tasks landed 2026-08-13.
**Spec:** .ai/specs/implemented/2026-08-12-forecast-first-finite-scheduling.md (the single as-built spec for the whole capacity-planning feature)
**Branch:** naveen/capacity-planning

Read the spec first. Core invariants that every task must respect (spec §2, §7):
the engine is a pure function of one pre-built input snapshot (no DB reads during
placement), deterministic (no `Date.now()`/`Math.random()` inside the engine —
`now` is an input), simulate and persist are separable, and machine availability
comes from the ladder: explicit `workCenterShift` rows (or `workCenter.alwaysOn`)
→ all shifts at the location → stock Mon–Fri 08:00–17:00 in the location tz.

## Progress
- [x] Task 1: Revise the capacity-planning migration in place (drop schedulingPolicy; add workCenterShift, alwaysOn, projectedCompletionAt)
- [x] Task 2: Apply the schema delta to the local DB and regenerate types
- [x] Task 3: Engine — machine-availability ladder in the provider and finite context
- [x] Task 4: Engine — slot allocator honors machine windows for attended ops and the unattended remainder
- [x] Task 5: Engine — forward-ASAP placement, topo order, single mode, priority = placement order, delete dispatch rules
- [x] Task 6: Engine — remaining-work netting for started operations
- [x] Task 7: Edge function — whole-location regeneration payload + expedite simulate-only + projectedCompletionAt persistence
- [x] Task 8: Jobs layer — wave regenerates locations, 30s debounce, delete reschedule-job path, single dispatch from the dates board
- [x] Task 9: Resources — workCenterShift service/validator/form + work-center schedule events
- [x] Task 10: Job forecast surfaces — promise date from projectedCompletionAt, slack badges on JobHeader and dates-board JobCard
- [x] Task 11: Expedite what-if — service, route, and "Best case" UI
- [x] Task 12: Capacity view — Scheduled vs Available on one date basis
- [x] Task 13: Engine determinism + performance-envelope Deno tests (at the selector level — see note)
- [x] Task 17: Machine downtime derived from maintenance dispatches
- [x] Task 18: Newly-late digest notification
- [x] Task 14: Docs sync — scheduling rule + AGENTS.md files
- [x] Task 15: i18n extraction for new UI strings
- [x] Task 16: Browser verification via /test (scenarios a–c verified live; d–g covered by automated tests — see note)

## Dependencies
- Task 2 needs Task 1 (migration file). Everything with types needs Task 2.
- Tasks 3→4→5→6 are sequential (same engine files).
- Task 7 needs Tasks 3–6. Task 8 needs Task 7.
- Task 9 needs Task 2 only — independent of Tasks 3–8 (parallel OK).
- Tasks 10, 11 need Task 7. Task 12 needs Tasks 2 and 9 (workCenterShift reads).
- Task 13 needs Tasks 3–7.
- Task 17 needs Tasks 2–3 (ladder subtraction); its form/emitter steps can run parallel with Tasks 4–8.
- Task 18 needs Tasks 7–8 (newlyLate response + wave).
- Tasks 14–16 last (14 covers 1–13 + 17–18); Task 16 needs a running stack (user boots it).

---

## Task 1: Revise the capacity-planning migration in place

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/migrations/20260720121629_capacity-planning.sql`

This branch owns its entire schema delta vs main (precedent: spec 07-05 changelog
2026-07-13, "branch migrations rewritten in place (unmerged)"). Do NOT create a
new migration file and do NOT touch any migration that exists on origin/main.

**Steps:**
1. Delete from the migration: the `CREATE TYPE "schedulingDispatchRule"` statement (~L58), the entire `CREATE TABLE "schedulingPolicy"` block with its `schedulingPolicy_company_wc_key` unique index and three other indexes (~L96–112), and the `schedulingPolicy` RLS block (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + four policies, ~L128–140). Keep the comment header of the section but reword it to "Capacity reservations" only. Verify nothing else in the file references `schedulingPolicy` afterward.
2. In the same file, after the `capacityReservation` RLS block, add:

```sql
-- ============================================================================
-- Work center operating hours (availability ladder rung 1)
-- ============================================================================
-- Which shifts a work center operates. No rows = rung 2 (all shifts at the
-- work center's location); no shifts at the location = rung 3 (stock Mon-Fri
-- 08:00-17:00 in the location timezone). "alwaysOn" = lights-out, 24x7.
ALTER TABLE "workCenter" ADD COLUMN "alwaysOn" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "workCenterShift" (
    "id" TEXT NOT NULL DEFAULT id('wcsh'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "shiftId" TEXT NOT NULL REFERENCES "shift"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "workCenterShift_companyId_idx" ON "workCenterShift" ("companyId");
CREATE INDEX "workCenterShift_workCenterId_idx" ON "workCenterShift" ("workCenterId");
CREATE INDEX "workCenterShift_shiftId_idx" ON "workCenterShift" ("shiftId");
CREATE INDEX "workCenterShift_createdBy_idx" ON "workCenterShift" ("createdBy");
ALTER TABLE "workCenterShift" ADD CONSTRAINT "workCenterShift_wc_shift_key"
    UNIQUE ("workCenterId", "shiftId", "companyId");

ALTER TABLE "public"."workCenterShift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."workCenterShift" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."workCenterShift" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."workCenterShift" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."workCenterShift" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

-- ============================================================================
-- Machine downtime via maintenance dispatches (derived windows, no new table)
-- ============================================================================
ALTER TABLE "maintenanceDispatch"
  ADD COLUMN "takesWorkCenterOffline" BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN "maintenanceDispatch"."takesWorkCenterOffline" IS
  'While this dispatch is open, its work center(s) contribute no scheduling capacity between (actualStartTime ?? plannedStartTime ?? createdAt) and (actualEndTime ?? plannedEndTime ?? open-ended).';

-- ============================================================================
-- Forecast output on the job
-- ============================================================================
ALTER TABLE "job" ADD COLUMN "projectedCompletionAt" TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN "job"."projectedCompletionAt" IS
  'Simulated finish of the job''s last operation (forward-ASAP finite schedule). Null until first regen.';
```

3. The `workCenters` view must expose `alwaysOn`. Find the NEWEST definition of the `workCenters` view: `grep -rln 'CREATE OR REPLACE VIEW "workCenters"' packages/database/supabase/migrations/ | sort | tail -1`. If it selects explicit columns (not `wc.*`), append a `DROP VIEW IF EXISTS "workCenters"; CREATE OR REPLACE VIEW "workCenters" WITH(SECURITY_INVOKER=true) AS ...` block at the end of `20260720121629_capacity-planning.sql`, forked verbatim from that newest definition with `wc."alwaysOn"` added (lesson: fork from the newest definition, never an older one). If the newest definition already uses `wc.*` (or `SELECT *`), no view change is needed. Do the same check for `workCentersWithBlockingStatus`.
4. Confirm the later branch migrations (`20260723212028_people-assignments.sql`, `20260731124240_people-overtime.sql`, `20260731192616_people-split-hours.sql`, `20260812153418_simplify-employee-ability.sql`) contain no reference to `schedulingPolicy`: `grep -l schedulingPolicy packages/database/supabase/migrations/*.sql` must list only files you already edited (expect zero matches after step 1).

**Verify:**
```bash
grep -c "schedulingPolicy\|schedulingDispatchRule" packages/database/supabase/migrations/20260720121629_capacity-planning.sql
# Expected: 0
grep -c "workCenterShift" packages/database/supabase/migrations/20260720121629_capacity-planning.sql
# Expected: >= 10 (table + indexes + policies)
```

**Out of scope:** any migration file that exists on origin/main; seed data (none references schedulingPolicy — verified).

## Task 2: Apply the schema delta to the local DB and regenerate types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts` (generated — via command only, never by hand)

The local dev DB already has the OLD version of `20260720121629` applied, so
`pnpm db:migrate` will not re-run it. Apply the delta directly, then reload the
PostgREST schema cache (lesson: direct psql DDL requires `NOTIFY pgrst`).
Never rebuild/reset the database — the delta below is sufficient.

**Steps:**
1. Read `PORT_DB` from `.env.local` at the repo root. If the DB is not reachable at `127.0.0.1:$PORT_DB`, STOP and report — do not start or reset the stack yourself.
2. Write the delta to a temp file `/tmp/ffs-delta.sql` containing, in order: `DROP TABLE IF EXISTS "schedulingPolicy";`, `DROP TYPE IF EXISTS "schedulingDispatchRule";`, then the full ADD/CREATE block from Task 1 step 2 verbatim, then the view recreation from Task 1 step 3 if one was needed, then `NOTIFY pgrst, 'reload schema';`.
3. Apply: `psql "postgresql://postgres:postgres@127.0.0.1:${PORT_DB}/postgres" -v ON_ERROR_STOP=1 -f /tmp/ffs-delta.sql`. If authentication fails, retry with user `supabase_admin`. If both fail, STOP and report.
4. `pnpm run generate:types`
5. `pnpm exec turbo run typecheck --filter=@carbon/database`

**Verify:**
```bash
grep -c "workCenterShift" packages/database/src/types.ts
# Expected: >= 1
grep -c "schedulingPolicy" packages/database/src/types.ts
# Expected: 0
grep -c "projectedCompletionAt" packages/database/src/types.ts
# Expected: >= 1
```

**Out of scope:** fixing unrelated typecheck errors in other packages (expected at this point — engine code still references schedulingPolicy until Task 5).

## Task 3: Engine — machine-availability ladder in the provider and finite context

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts` — `buildFiniteContext`
- Modify: `packages/database/supabase/functions/lib/scheduling/calendar-utils.ts` — add `intersectWindows`, `stockWeekShifts`
- Create: `packages/database/supabase/functions/lib/scheduling/machine-availability.test.ts`

**Steps:**
1. In `calendar-utils.ts` add two pure exports:
   - `export function intersectWindows(a: CalendarWindow[], b: CalendarWindow[]): CalendarWindow[]` — pairwise interval intersection of two disjoint sorted lists (walk both lists; standard two-pointer). Update the file's header comment: work centers are no longer "always open" — availability comes from the machine-availability ladder; people windows refine it.
   - `export const STOCK_WEEK_SHIFTS: CalendarShiftRow[]` — Mon–Fri (`dayOfWeek` 1–5), `startTime "08:00"`, `endTime "17:00"` (rung 3; the 9-hour wall span matches the UI's 8h + 1h break convention — use exactly these times).
2. In `master-data-provider.ts` add to the `MasterDataProvider` interface and `KyselyMasterDataProvider`:
   ```ts
   getWorkCenterAvailability(
     workCenterIds: string[],
     rangeStart: Date,
     rangeEnd: Date
   ): Promise<Map<string, CalendarWindow[]>>
   ```
   Implementation (one query set, no per-WC loops — N+1 rule):
   a. Load `workCenter` rows for the ids: `id`, `alwaysOn`, `locationId`.
   b. Load all `workCenterShift` rows for the ids joined to `shift` (`s.startTime`, `s.endTime`, weekday booleans, `s.active = true`) and to `location` for `timezone` — mirror the exact join/select shape of `getEmployeeShiftWindows` (same file, ~L556).
   c. Load all active `shift` rows for the distinct `locationId`s (rung 2), with the location timezone.
   d. Per work center resolve: `alwaysOn` → `[{start: rangeStart, end: rangeEnd}]`; else if it has `workCenterShift` rows → `expandCalendar(itsShiftRows, rangeStart, rangeEnd, tz)`, unioning multiple shifts via `unionWindows`; else if its location has shifts → same over the location's shifts; else → `expandCalendar(STOCK_WEEK_SHIFTS, rangeStart, rangeEnd, tz)` where `tz` is the location timezone (fall back to `"UTC"` only if the location has no timezone).
3. In `scheduling-engine.ts` `buildFiniteContext` (~L503–520): replace `windows: [{ start: rangeStart, end: rangeEnd }]` with the ladder result — call `this.provider.getWorkCenterAvailability([...workCenterIds], rangeStart, rangeEnd)` alongside the existing `Promise.all` reads, and set each `capacityByWorkCenter` entry's `windows` from the map. Update the comment ("capacity 1, open per the availability ladder").
4. Same function, people fallback (~L561–567 and the `employeesByAbility` fallback ~L612): replace the always-available default `[{ start: rangeStart, end: rangeEnd }]` with the **job location's calendar** — compute once: `locationDefaultWindows` = rung 2/3 result for the job's location (reuse the same location-shift data; add a small provider method `getLocationCalendarWindows(locationId, rangeStart, rangeEnd)` if cleaner). Both fallback sites must use it. A person with `employeeShift` rows keeps their expanded shift windows exactly as today.
5. Write `machine-availability.test.ts` (Deno) against a fixture provider or the pure pieces: rung 1 (two shifts on one WC unions), rung 2 (no WC rows → location shifts), rung 3 (no shifts anywhere → Mon–Fri 08:00–17:00 windows, zero-width on Sat/Sun), `alwaysOn` (single continuous window), and `intersectWindows` (overlap, containment, disjoint → empty).

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/machine-availability.test.ts lib/scheduling/calendar-utils.test.ts
# Expected: all tests pass
```

**Out of scope:** slot-allocator behavior (Task 4); removing the 24×7 semantics of `expandCalendar([], ...)` itself — that pure function keeps its contract; callers change instead.

## Task 4: Engine — slot allocator honors machine windows

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/slot-allocator.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/slot-allocator.test.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts` — member-window clipping

`allocateOperation` (ungated) already accumulates across `capacity.windows` via
`findSlot` — it needs no change and becomes hours-bounded automatically. Two
gaps remain:

**Steps:**
1. `allocateAttendedOperation`: the unattended remainder currently extends flat calendar time (`end = attendedEnd + unattendedMs`, ~L505–508). Replace with accumulation across the machine's windows: add a pure helper in `calendar-utils.ts` — `export function addWorkingTime(from: Date, durationMs: number, windows: CalendarWindow[]): Date | null` (walk windows from `from`, count only in-window time, return the finish instant; null if the windows run out) — and compute `end = addWorkingTime(sim.attendedEnd, unattendedMs, capacity.windows)`; a null result is the existing `exhausted` conflict. When `unattendedMs === 0`, `end === sim.attendedEnd` must hold exactly.
2. Attended simulation must not book people while the machine is closed: in `work-center-selector.ts`, at each of the four `allocateAttendedOperation` call sites (gated pass 1 ~L488, gated pass 2 ~L506, manned ungated ~L547 — and the corresponding member-list constructions), intersect every member's windows with the machine's windows via `intersectWindows(memberWindows, capacity.windows)` before passing `members`. Do this at the selector level (per candidate WC), not inside the allocator.
3. Also intersect the `earliestStart` walk implicitly: no change needed — `simulateAttended`/`simulateAttendedTeam` only accumulate inside member windows, which are now machine-clipped.
4. Update `slot-allocator.test.ts`: existing lights-out tests that assume a 24×7 machine must construct `capacity.windows` as one full-range window explicitly (representing `alwaysOn`) — assert unchanged behavior. Add: (a) an 8h-window machine with a 10h ungated op spans two days; (b) an attended op whose 4h unattended remainder starts 1h before window close finishes 3h into the next window; (c) a member on a 24×7 personal window clipped by an 8h machine window accumulates only 8h/day.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/slot-allocator.test.ts lib/scheduling/calendar-utils.test.ts
# Expected: all tests pass, including the three new cases
```

**Out of scope:** team-mode rate math, wait attribution logic, `machineIsFree`.

## Task 5: Engine — forward-ASAP, topo order, single mode, priority = placement order

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/priority-calculator.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/date-calculator.ts` (reduce)
- Modify: `packages/database/supabase/functions/lib/scheduling/types.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts` — delete `getSchedulingPolicies`/`loadSchedulingPolicies`/`SchedulingPolicyRow`
- Modify: `packages/database/supabase/functions/lib/scheduling/apply-work-center-selections.ts` + its test
- Delete: `packages/database/supabase/functions/lib/scheduling/date-calculator.test.ts` (backward-pass tests)

**Steps:**
1. **Remove the backward floor.** In `work-center-selector.ts` `selectWorkCentersForOperations`: delete the `if (op.startDate) { backwardMs... }` block (~L394–399). `earliestMs = max(ctx.now, placed dependency ends)` only. Keep the manual-pin and outside-processing branches exactly as they are.
2. **Topological placement order.** Replace the sort-by-`startDate` (~L271–276) with a deterministic topological order over `ctx.dependencies` (Kahn's algorithm; ready set ordered by `jobOperation.order` then id). Pinned and outside ops participate in the same order.
3. **Reduce the date pass.** In `scheduling-engine.ts` `calculateDates()`: stop calling `calculateOperationDates` for backward targeting. It must still produce `this.scheduledOperations` (the working map with durations, pins, flags) — extract the map-building (id→`ScheduledOperation` with `durationHours` etc.) into a plain builder (either simplify `date-calculator.ts` to just that builder, or inline it in the engine and delete the file). `startDate`/`dueDate` stay null pre-placement except for `manuallyScheduled` ops, which keep their stored dates. Delete `BackwardSchedulingStrategy`, `ForwardSchedulingStrategy`, `getSchedulingStrategy`, `subtractBusinessDays`/`addBusinessDays` re-exports if nothing else imports them (verified: nothing does). Delete the pass-1 `hasConflict` counting from `calculateDates`.
4. **Single mode.** Remove `SchedulingMode`/`SchedulingDirection` from `types.ts`, the `mode`/`direction` constructor args and fields from `SchedulingEngine`, and `ctx.stickyWorkCenters`. Candidate rule becomes unconditional (current sticky behavior): an op with a `workCenterId` present in `capacityByWorkCenter` keeps it; otherwise full process candidates (this is how new/unassigned ops get selection — there is no "initial" mode anymore).
5. **Priority = placement order.** In `priority-calculator.ts`: delete `compareByDispatchRule`, the `rule`/`resolveRule` parameters, and the `DispatchRule` import. `sortOperationsByPriority` sorts by placed start date (then job priority, then deadline type — keep the legacy tie-break chain). In `scheduling-engine.ts` delete `resolveDispatchRules` and `dispatchRuleByWorkCenter`; `calculatePriorities` numbers ops per work center by placed `startDate` ascending. In `master-data-provider.ts` delete `getSchedulingPolicies`, `loadSchedulingPolicies`, and `SchedulingPolicyRow`. In `types.ts` delete `DispatchRule`.
6. **Reconciliation.** `apply-work-center-selections.ts`: placements now always carry dates; remove any branch that preserved pass-1 backward dates or pass-1 conflicts for non-pinned, non-outside ops. Update `apply-work-center-selections.test.ts` accordingly (placed dates win; pinned op keeps `dueDate`; outside ops keep their computed span).
7. Sweep: `cd packages/database/supabase/functions && grep -rn "DispatchRule\|schedulingPolic\|stickyWorkCenters\|SchedulingMode\|SchedulingDirection" lib/ schedule/ | grep -v test` must return nothing. Then fix the tests the sweep breaks (`work-center-selector.test.ts` still covers sticky/apply behavior — update names/args, keep coverage).

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/
# Expected: all tests pass; no test file references DispatchRule or backward strategies
```

**Out of scope:** the edge-function payload (Task 7); `conflict-messages.ts` (wait attribution unchanged); `job.priority` (job-level fractional index — untouched).

## Task 6: Engine — remaining-work netting

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/duration-calculator.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/duration-calculator.test.ts`

**Steps:**
1. Provider: `getOperations` already selects `quantityComplete` or can — ensure the operation rows carry `quantityComplete` and `operationQuantity`. Add one batched read `getOperationsWithEvents(operationIds: string[]): Promise<Set<string>>` — `SELECT DISTINCT "jobOperationId" FROM "productionEvent" WHERE "jobOperationId" IN (...)` (chunk the IN list at 200, one query per chunk, never per-row).
2. `duration-calculator.ts`: add
   ```ts
   export function remainingFractions(op: { operationQuantity: number | null; quantityComplete: number | null }, hasProductionEvent: boolean): { setup: number; work: number }
   ```
   `work = clamp(1 - (quantityComplete ?? 0) / max(operationQuantity ?? 1, 1), 0, 1)`; `setup = hasProductionEvent ? 0 : 1`. Apply in the selector where `durationHours` / `attendedHours` / `teamComponents` are computed (~L424–442): scale labor and machine by `work`, setup by `setup`. Ops with `work === 0` and `setup === 0` get no reservation (same handling as existing zero-duration filtering in `persistChanges`).
3. Tests: fraction math (0%, 50%, 100% complete; event vs no event; null quantities), and a selector-level case showing a half-complete op books half the hours.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/duration-calculator.test.ts lib/scheduling/work-center-selector.test.ts
# Expected: all tests pass
```

**Out of scope:** deriving remaining time from productionEvent durations (quantity-proportional only, per spec); MES quantity recording.

## Task 7: Edge function — whole-location regeneration + expedite + projectedCompletionAt

**Depends on:** Tasks 5, 6
**Files:**
- Modify: `packages/database/supabase/functions/schedule/index.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts` — dry-run + projectedCompletionAt
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts` — `getLiveReservations` exclusion list

**Steps:**
1. New payload validator:
   ```ts
   const payloadValidator = z.object({
     locationId: z.string(),
     companyId: z.string(),
     userId: z.string(),
     expediteJobId: z.string().optional(),
   });
   ```
   Remove `jobId`/`jobIds`/`mode`/`direction`. Handler: load the job set — `job` where `locationId`, `companyId`, `status IN ('Ready','In Progress','Paused')`, ordered **deadline class first** (`deadlineType`: ASAP=0, Hard Deadline=1, Soft Deadline=2, No Deadline/null=3 — the `DEADLINE_PRIORITY` ranking in `priority-calculator.ts`; sort in TS after the select), then `dueDate ASC NULLS LAST, priority ASC, createdAt ASC`. This ordering is why a no-due-date ASAP job leads the queue instead of trailing on NULLS LAST. If `expediteJobId` is set and present in the set, move it to index 0.
2. Determinism seam: capture `const now = new Date()` ONCE in the handler and pass it into every engine run (add a `now` constructor arg to `SchedulingEngine`; replace every internal `new Date()` used for scheduling decisions with it — grep the engine files for `new Date()` and audit each; timestamps for audit columns may keep `new Date().toISOString()` at persist time).
3. Reservation snapshot: change `getLiveReservations(fromDate, excludeJobId)` to `getLiveReservations(fromDate, excludeJobIds: string[])` and pass the FULL batch's job ids from the edge function through to every engine run (thread via constructor). This removes the need for any pre-clear: each engine sees only non-batch reservations plus the in-run placements of already-run batch jobs. Update the one call site in `buildFiniteContext`.
4. Dry-run: add `persist: boolean` (default true) to the engine options. When false, `run()` skips `persistChanges` entirely and returns `{ jobId, projectedCompletionAt, conflictsDetected, cause }` where `projectedCompletionAt` = max placed end across the job's operations and `cause` = the job's first conflict/schedule note if any. Expedite flow: run job 0 (the expedited one) with `persist: false`, return its result immediately as the response `{ expedite: { jobId, projectedCompletionAt, cause } }` — do NOT run the rest of the batch, do NOT write anything.
5. Normal flow (no `expediteJobId`): run every job sequentially with `persist: true`. In `persistChanges`, additionally write `job.projectedCompletionAt` (max placed end; null if no operations) and clear `scheduleOutdatedReason`/`scheduleOutdatedAt` on that job, inside the same transaction. `persistChanges` must also compute a **newly-late flag** before writing: read the job's prior `projectedCompletionAt` (already loaded on `this.job`), and set `newlyLate = true` when (prior was null OR prior business day ≤ `dueDate`) AND new business day > `dueDate` (business days via the existing `businessDay(iso, timezone)` helper; jobs with no `dueDate` are never late). Response: `{ locationId, jobsScheduled: n, conflictsDetected: total, newlyLate: [{ jobId, readableJobId, assignee, projectedCompletionAt }] }` — `readableJobId` = `job.jobId`, `assignee` = `job.assignee` (may be null). Task 18 consumes this.
6. Sweep ALL other invokers of the `schedule` function to the new payload: `grep -rn 'invoke("schedule"' packages/ apps/` — known sites: `packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts` (Task 8 rewrites it), `packages/jobs/src/inngest/functions/tasks/reschedule-job.ts` (deleted in Task 8), and any `recalculate`/job-release task that passes `mode: "initial"` — for those, resolve the job's `locationId` (one select) and invoke with `{ locationId, companyId, userId }`. If a caller cannot supply a locationId, STOP and report — do not invent a fallback.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/
# Expected: all pass
grep -rn "mode:\s*\"initial\"\|direction:" packages/jobs/src apps/erp/app | grep -v node_modules | wc -l
# Expected: 0
```

**Out of scope:** Inngest wiring (Task 8); UI for expedite (Task 11).

## Task 8: Jobs layer — location regen wave, 30s debounce, delete reschedule-job path

**Depends on:** Task 7
**Files:**
- Modify: `packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/nightly-replan.ts` — comment/behavior check only
- Delete: `packages/jobs/src/inngest/functions/tasks/reschedule-job.ts`
- Modify: `packages/jobs/src/inngest/functions/index.ts` and `packages/jobs/src/inngest/index.ts` — remove the deleted function's registration/exports
- Modify: `packages/lib/src/events.ts` — remove `carbon/reschedule-job`; `packages/lib/src/trigger.ts` — remove `"schedule-job"` key
- Modify: `apps/erp/app/modules/production/production.service.ts` — `triggerJobSchedule` removal
- Delete the duplicate: `apps/erp/app/modules/production/production.server.ts` `triggerJobSchedule` + deprecated `triggerJobReschedule` (remove the functions; keep the file if it has other exports)
- Modify: `apps/erp/app/routes/x+/schedule+/dates.update.tsx`

**Steps:**
1. `scheduleReplanWaveFunction` rewrite: keep id `schedule-replan-wave`, retries 1, `onFailure` recovery event, and the env-scoped concurrency `{ limit: 1, scope: "env", key: '"schedule:" + event.data.companyId' }`. Change debounce to `{ key: "event.data.companyId", period: "30s", timeout: "10m" }`. New body: step `"get-stale-locations"` — select distinct `locationId` from `job` where `companyId` and `scheduleOutdatedAt IS NOT NULL` and status in Ready/In Progress/Paused; then one step per location `` `regen-${locationId}` `` invoking `serviceRole.functions.invoke("schedule", { body: { locationId, companyId, userId: "system" } })` sequentially. Delete `WAVE_BATCH_SIZE`, `IN_FILTER_CHUNK_SIZE`, `INVOKE_CHUNK_SIZE`, the `"clear-stale-reservations"` step (the engine's exclusion list replaced it), the chunking loop, the `"chain-next-wave"` continuation, and the wave-side flag-clearing (the engine clears stamps per job in Task 7 step 5).
2. `markScheduleStaleFunction`: unchanged except delete the `continuation` early-return only if the wave no longer emits continuations (it doesn't) — keep the field tolerated in the zod schema for the nightly emitter.
3. Delete `reschedule-job.ts`; remove its export/registration; remove the event from `events.ts` and the trigger key from `trigger.ts`. Typecheck will surface any missed reference.
4. `production.service.ts`: delete `triggerJobSchedule` (and its barrel export in `apps/erp/app/modules/production/index.ts` if listed). Every remaining caller must use `notifyScheduleInputsChanged`. Grep for `triggerJobSchedule` repo-wide afterward — zero code hits (docs updated in Task 14).
5. `dates.update.tsx`: remove the `triggerJobSchedule` import/call; keep the single `notifyScheduleInputsChanged(companyId, "reorder", "Schedule reordered")`. Also replace `new Date().toISOString()` in `updateData` with `datetime.timestamp()` from `@carbon/utils` if the date-handling check flags it (it is an instant column — acceptable either way; prefer `datetime.timestamp()`).
6. `nightly-replan.ts`: no structural change (it emits one `reorder` event per company; the wave now fans to locations). Update its comment to say "wave regenerates each location".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/lib --filter=erp
# Expected: exit 0
grep -rn "reschedule-job\|triggerJobSchedule" packages/jobs/src packages/lib/src apps/erp/app --include="*.ts" --include="*.tsx" | grep -v ".test."
# Expected: no output
```

**Out of scope:** `notifyScheduleInputsChanged` call sites in ability/shift/people routes (unchanged); the mark function's scoping queries.

## Task 9: Resources — workCenterShift service, validator, form, and schedule events

**Depends on:** Task 2 (parallel with Tasks 3–8)
**Files:**
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — `workCenterValidator`
- Modify: `apps/erp/app/modules/resources/resources.service.ts` — `upsertWorkCenter`, `getWorkCenter(s)` reads
- Modify: `apps/erp/app/modules/resources/ui/WorkCenters/WorkCenterForm.tsx`
- Create: `apps/erp/app/components/Form/Shifts.tsx` (multiselect)
- Modify: `apps/erp/app/components/Form/index.ts` — export it
- Modify: `apps/erp/app/routes/x+/resources+/work-centers.new.tsx` and `work-centers.$id.tsx`
- Copy from (precedent): `apps/erp/app/components/Form/Processes.tsx` (multiselect), `resources.service.ts:1879` `upsertWorkCenter` processes join pattern

**Steps:**
1. Validator: add `alwaysOn: zfd.checkbox()` and `shifts: z.array(z.string().min(1)).optional()` to `workCenterValidator`.
2. `Shifts.tsx`: copy `Processes.tsx` verbatim and adapt to shifts — options from `getShiftsList`-backed data (follow whatever data source `Processes` uses; if it uses a store/hook, mirror it with the shifts equivalent; accept an optional `locationId` prop to filter options by location). Export from the Form barrel.
3. `upsertWorkCenter`: mirror the `processes` join maintenance exactly for `shifts` → `workCenterShift` rows (insert branch: map + insert; update branch: delete-all-by-workCenterId then reinsert; same audit fields, same error-return style).
4. Work-center reads: wherever the form's edit loader fetches the work center (the `$id` route loader / `getWorkCenter`), also fetch its `workCenterShift` rows (`select shiftId`) and pass `shifts: string[]` into `initialValues`. If the list view (`workCenters` view) is used for the form seed instead, adjust there — follow how `processes` reaches `initialValues` today and do the identical thing.
5. `WorkCenterForm.tsx`: below the `Processes` field add
   ```tsx
   <Shifts name="shifts" label={t`Operating shifts`} locationId={selectedLocationId} />
   <Boolean name="alwaysOn" label={t`Runs 24×7 (lights-out)`} description={t`Ignore shift calendars — this machine can run unattended around the clock.`} />
   ```
   with a helper line under the shifts field: ``t`Empty = all shifts at the location` `` (follow the form's existing helper-text pattern; use `Boolean` from `~/components/Form`).
6. Both work-center routes' actions: after a successful `upsertWorkCenter`, emit `await notifyScheduleInputsChanged(companyId, "work-center", "Work center hours changed", workCenterId)` (import from `~/modules/production`). This wires the dead `work-center` event kind — the mark scoping for it already exists.
7. Deactivation/reactivation: find the route(s) whose actions call `deleteWorkCenter` (soft delete, `active: false`) and `activateWorkCenter` in `resources.service.ts` (grep `deleteWorkCenter\|activateWorkCenter` under `apps/erp/app/routes/x+/resources+/`). Add the same `notifyScheduleInputsChanged(companyId, "work-center", "Work center deactivated"|"Work center reactivated", workCenterId)` emit to each after a successful write — a deactivated WC drops out of `capacityByWorkCenter` at the next regen, so its sticky ops re-select automatically.
7. `pnpm run lingui:extract` is deferred to Task 15 — do not run it here.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -rn "notifyScheduleInputsChanged" apps/erp/app/routes/x+/resources+/work-centers.new.tsx apps/erp/app/routes/x+/resources+/work-centers.\$id.tsx
# Expected: one hit in each file
```

**Out of scope:** shift CRUD (people module, unchanged); the engine ladder (Task 3); seeding workCenterShift rows (none — empty = rung 2 by design).

## Task 10: Job forecast surfaces — promise date + slack badges

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `getJobPromiseDate`
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx`
- Modify: `apps/erp/app/modules/production/ui/Schedule/Kanban/components/JobCard.tsx`
- Copy from (precedent): `JobCard.tsx` L258–277 (conflict/outdated Tooltip pattern), `JobHeader.tsx` L231–244 (JobStatus badge block)

**Steps:**
1. `getJobPromiseDate(client, jobId, companyId)`: reimplement to read `job.projectedCompletionAt` (single select). Keep the return shape `{ promiseDate, basis: "schedule", confidence }` — `confidence: "low"` when the job has any conflicted op or a non-null `scheduleOutdatedReason`, else `"scheduled"`. Fall back to the old max-op-dueDate computation ONLY when `projectedCompletionAt` is null (pre-first-regen). This is the §7 `{date, confidence?}` contract — callers must accept confidence as optional.
2. `JobHeader.tsx`: in the badge block, when the job is active and `projectedCompletionAt` is set, render a slack badge: compute `slackDays` = calendar-day difference between `formatDate(projectedCompletionAt.slice(0,10))`-style business day and `job.dueDate` using `parseDate` from `@internationalized/date` (never JS `Date` arithmetic — see `.claude/rules/date-handling.md`; slice the timestamptz to its date part per the repo pattern). Render `<JobStatus status="On Track" />`-style badge text: `{n}d early` (green/muted) or `{n}d late` (destructive) with a Tooltip showing `t`Projected completion` + formatted date. Follow the exact JSX shape of the existing Due Today/Overdue badges.
3. `JobCard.tsx` (dates board): next to the existing outdated/conflict triangles add the same compact slack indicator (text-only, e.g. `+2d` red / `-3d` muted with tooltip "Projected {date}") when the card's job row carries `projectedCompletionAt`. The loader RPC `get_jobs_by_date_range` must return it: add `"projectedCompletionAt" timestamp with time zone` to the RETURNS TABLE + SELECT of the function in `20260720121629_capacity-planning.sql` (in-place, same file already being edited — coordinate with Task 1 if run in parallel; if Task 1 is merged, edit the migration again and re-apply the function body via the Task 2 psql method: `DROP FUNCTION IF EXISTS get_jobs_by_date_range(TEXT, DATE, DATE);` + recreate + `NOTIFY pgrst`), then re-run `pnpm run generate:types` and thread the field through the dates board loader types.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "projectedCompletionAt" apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx apps/erp/app/modules/production/ui/Schedule/Kanban/components/JobCard.tsx
# Expected: >= 1 hit in each
```

**Out of scope:** Monte Carlo bands (confidence stays a string enum); MES surfaces.

## Task 11: Expedite what-if — service, route, "Best case" UI

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — add `getJobExpediteForecast`
- Create: `apps/erp/app/routes/x+/job+/$jobId.expedite.tsx` (action-only route)
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx` — menu action + result modal
- Modify: `apps/erp/app/utils/path.ts` — `path.to.jobExpedite(jobId)`
- Copy from (precedent): an existing action-only job route in `apps/erp/app/routes/x+/job+/` (e.g. the job status/recalculate action route — pick the nearest action-only sibling and mirror its `requirePermissions` + flash shape); JobHeader's existing dropdown menu items for the trigger.

**Steps:**
1. Service:
   ```ts
   export async function getJobExpediteForecast(
     client: SupabaseClient<Database>,
     jobId: string,
     companyId: string,
     userId: string
   )
   ```
   — reads the job's `locationId`, then `client.functions.invoke("schedule", { body: { locationId, companyId, userId, expediteJobId: jobId } })`; returns `{ data: { projectedCompletionAt, cause }, error }` from the response's `expedite` object.
2. Route: POST-only; `requirePermissions(request, { view: "production" })` (read-only what-if — no writes happen); call the service; return the result as `data(...)` for a fetcher (no redirect).
3. UI: add a "Best case…" item to JobHeader's existing actions menu (visible for active jobs). On click, `useFetcher().submit` to the route; while loading show the fetcher spinner pattern used elsewhere in the header; on data, open a small `Modal` (copy the nearest confirm-modal in the Jobs UI) showing: current projection, expedited projection, and `cause` ("bottleneck" sentence) — plain `formatDate` rendering, both with day-part slices.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** persisting expedite results; auto-repriotizing the job (the modal only informs); quote-level CTP (v1.x per spec §7).

## Task 12: Capacity view — Scheduled vs Available on one date basis

**Depends on:** Tasks 2, 9
**Files:**
- Modify: `apps/erp/app/modules/production/peopleCapacity.server.ts`
- Modify: `apps/erp/app/modules/production/ui/Schedule/People/PeopleCapacity.tsx`
- Modify: `apps/erp/app/routes/x+/schedule+/people.tsx` — loader inputs
- Modify: `apps/erp/app/modules/production/production.service.ts` — `getPeopleCapacityOperations` lookback

**Steps:**
1. Server ladder resolver in `peopleCapacity.server.ts`: `getWorkCenterCalendarHoursByDay(workCenters, workCenterShifts, locationShifts, weekDates, timezone): Map<workCenterId, Map<date, number>>` — pure TS mirror of the engine ladder at day granularity: `alwaysOn` → 24; WC shifts → Σ shift hours whose weekday flag covers that date; else location shifts; else 8 on Mon–Fri / 0 weekend. The loader (`people.tsx`) fetches `workCenterShift` rows for the location's work centers (one `.in()` query) and passes them in. Note in a comment that the engine (Deno) owns the authoritative ladder; this is display math.
2. `Scheduled` series: in the reservation fold, replace `workMs = workHours != null ? workHours * HOUR_MS : spanMs` with `workMs = workHours != null ? workHours * HOUR_MS : min(spanMs, calendarMsWithinSpan)` where `calendarMsWithinSpan` uses the day-hours map — fixes the legacy null-workHours overcount.
3. `Available` in `PeopleCapacity.tsx`: base = the calendar hours map (never people-derived). When the station has assignments that day, show people-hours as a secondary annotation (small text under the cell: `{peopleHours}h staffed`), NOT as a replacement — this removes the fallback cliff at L179–182.
4. `Load` verdict: `delta = scheduledHours − availableHours` per day (was demand − available). Keep the `+Xh / Xh free` rendering. Move the due-date Demand series to a "Due" sub-tab (the component already has sub-tab structure for coverage — follow it), clearly labeled `t`Due (by due date)`.
5. Assumption badge: when every work center resolved via rung 2 render `t`Hours assumed from location shifts``; rung 3 → `t`No shifts configured — assuming Mon–Fri, 8h days`` (single banner above the grid; use the existing banner/Alert pattern from `@carbon/react` — grep `Alert` usage in `ui/Schedule/`).
6. Past-due truncation: in `people.tsx` change `lookbackStart` from `weekStart − 28d` to the earliest open-op due date — simplest correct form: drop the `startDate` floor from `getPeopleCapacityOperations` when computing the past-due bucket (pass `startDate: null` → service omits the `.gte("dueDate", ...)` filter; released-only status filters already bound the set).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test -- resourceTimeline
# Expected: typecheck exit 0; existing resourceTimeline tests still pass
```

**Out of scope:** `PeopleMatrix` needed-count ladder unification and the browser-tz "today" highlight (pre-existing, noted in the critique — separate cleanup); the People board/week views.

## Task 13: Engine determinism + performance-envelope tests

**Depends on:** Tasks 3–7
**Files:**
- Create: `packages/database/supabase/functions/lib/scheduling/determinism.test.ts`
- Create: `packages/database/supabase/functions/lib/scheduling/envelope.test.ts`

**Steps:**
1. Build a fixture `MasterDataProvider` (in-memory, no DB) — the interface is constructor-injected everywhere, so implement it over plain objects: ~6 work centers on the ladder's three rungs, 2 gated processes, 4 employees with shifts, a manning-board day, 20 jobs / ~120 ops with dependencies. If `SchedulingEngine` still requires a live `db`/`client` for non-read work in the run path (it should not after Task 7's dry-run flag — dry-run must touch neither), STOP and report rather than mocking Kysely.
2. `determinism.test.ts`: run the whole batch twice in dry-run with the same injected `now`; assert the two runs' planned reservations are deeply equal (same multiset of `{resourceKind, resourceId, operationId, startAt, endAt}`) and every job's projected completion matches. Also assert zero placements fall outside the machine windows of their work center (spot-check a rung-3 WC: no reservation minutes on Saturday/Sunday).
3. `envelope.test.ts`: generate 2,000 ops across 200 jobs / 20 work centers programmatically; assert the full dry-run batch completes in under 10_000 ms (`performance.now()` bracketing). Mark it so it can be skipped in constrained CI if needed (`Deno.test({ name, ignore: Deno.env.get("SKIP_ENVELOPE") === "1", fn })`).

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/determinism.test.ts lib/scheduling/envelope.test.ts
# Expected: both pass; envelope reports elapsed < 10000ms
```

**Out of scope:** load-testing the deployed edge function; Monte Carlo sampling.

## Task 17: Machine downtime derived from maintenance dispatches

**Depends on:** Tasks 2, 3 (ladder); form/emitter parts parallel with Tasks 4–8
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/calendar-utils.ts` — add `subtractIntervals`
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts` — downtime read + ladder subtraction
- Modify: `packages/database/supabase/functions/lib/scheduling/machine-availability.test.ts` — downtime cases
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — dispatch validator
- Modify: the ERP maintenance-dispatch form + its create/edit routes (grep `insertMaintenanceDispatch\|updateMaintenanceDispatch` under `apps/erp/app/routes/x+/resources+/` and the form under `apps/erp/app/modules/resources/ui/`)
- Modify: the MES dispatch write routes (`apps/mes/app/routes/x+/dispatch*.tsx` — the maintenance-dispatch routes) and `apps/mes/app/services/` for the notify helper
- Copy from (precedent): `subtractAbsences` in `people-utils.ts` (window subtraction), `Boolean` field usage in `WorkCenterForm.tsx` (Task 9)

**Steps:**
1. `calendar-utils.ts`: add `export function subtractIntervals(windows: CalendarWindow[], outages: CalendarWindow[]): CalendarWindow[]` — pure interval subtraction over disjoint sorted lists (split windows around outage overlaps; drop empty remainders). Unit-test alongside `intersectWindows`.
2. Provider: in `getWorkCenterAvailability`, after resolving the ladder windows per work center, load open offline dispatches in ONE query: `maintenanceDispatch` where `companyId`, `takesWorkCenterOffline = true`, `status NOT IN ('Completed','Cancelled')`, and (`workCenterId IN (ids)` OR id IN (select `maintenanceDispatchId` from `maintenanceDispatchWorkCenter` where `workCenterId IN (ids)`)) — two selects unioned in TS is fine; never per-WC queries. Each dispatch contributes an outage `[actualStartTime ?? plannedStartTime ?? createdAt, actualEndTime ?? plannedEndTime ?? rangeEnd)` to its `workCenterId` AND every joined work center. Apply `subtractIntervals(windows, outages)` per affected WC. `alwaysOn` machines are subtracted too (a broken lights-out machine is still broken).
3. Tests in `machine-availability.test.ts`: (a) an outage with a `plannedEndTime` splits the week's windows and an op flows around it; (b) an open-ended outage (no end estimate) empties the WC's windows to the horizon → ungated allocation returns the "No working time available" conflict; (c) a Completed dispatch contributes nothing.
4. Dispatch validator + form: add `takesWorkCenterOffline: zfd.checkbox()` to the maintenance-dispatch validator in `resources.models.ts`; add a `Boolean` field to the ERP dispatch form — label `t`Takes work center offline``, description `t`While this dispatch is open, the work center is unavailable to the schedule (until the planned end time, or until the dispatch is completed).`` Place it next to the planned start/end time fields.
5. Emitters (the schedule must react to downtime edits): in the ERP dispatch create/edit/status routes, after a successful write where `takesWorkCenterOffline` is set OR was just cleared OR the status moved to/from Completed/Cancelled OR planned/actual times changed on a flagged dispatch, emit `notifyScheduleInputsChanged(companyId, "work-center", "Machine downtime changed", workCenterId)` once per affected work center id (primary + join rows). For MES: the maintenance-dispatch write routes need the same emit — copy the 6-line `notifyScheduleInputsChanged` helper from `production.service.ts:5403` into `apps/mes/app/services/operations.service.ts` (same dynamic `@carbon/jobs` import pattern) and call it from the MES dispatch actions. If MES routes turn out not to write dispatch status/timing (display-only), skip the MES emit and note it in the task checklist — verify by grepping the MES dispatch routes for `.update(` / `insertMaintenanceDispatch`.
6. Do not create any downtime table or scheduled sync — the windows are derived at snapshot-build time, which is what makes dispatch completion self-healing.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/machine-availability.test.ts lib/scheduling/calendar-utils.test.ts
# Expected: all pass, including the three downtime cases
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit 0
```

**Out of scope:** maintenance scheduling/PM plans (`maintenanceSchedule` — future: planned PM windows could pre-book downtime, note only); OEE math; any change to dispatch statuses.

## Task 18: Newly-late digest notification

**Depends on:** Tasks 7, 8
**Files:**
- Modify: `packages/notifications/src/index.ts` — new `NotificationEvent` member + topic/heading/CTA registrations
- Modify: `packages/jobs/src/inngest/functions/notifications/content.ts` — content case
- Modify: `packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts` — notify step
- Copy from (precedent): an existing digest-capable event in the same files — grep `documentIds` in `packages/jobs/src/inngest/functions/notifications/` and follow whichever event already builds a multi-document digest (e.g. the gauge-calibration or quote-expired flow); `carbon/notify` payload shape is defined in `packages/lib/src/events.ts:16`

**Steps:**
1. `packages/notifications`: add `JobsProjectedLate = "jobs-projected-late"` to `NotificationEvent`; register it in every exhaustive map the package keeps (`getNotificationTopic`, `getNotificationEmailHeading`, `getNotificationEmailCtaLabel`, and any `isRecurringNotificationEvent`/destination map the compiler forces) — heading `"Jobs projected late"`, CTA `"View job"`. Do NOT add it to `defaultDestinations` in `notify.ts` (in-app only by default; email/Slack stay opt-in).
2. `content.ts`: add the `JobsProjectedLate` case following the digest precedent — title `` `${n} job(s) newly projected late` `` (singular/plural), body listing readable job ids (comma-joined, cap at 10 + "+n more") and the triggering reason when provided; link target = the first job (`documentId ?? documentIds[0]` convention per the payload comment).
3. Wave: in `scheduleReplanWaveFunction`, collect each location invoke's `newlyLate` array (Task 7 response). After all regens, add step `"notify-newly-late"`: group entries by `assignee`, drop null assignees, and for each assignee `step.sendEvent("notify-newly-late-" + userId, { name: "carbon/notify", data: { event: NotificationEvent.JobsProjectedLate, companyId, documentIds: jobIds, recipient: { type: "user", userId }, body: reason } })` — one digest per assignee per wave. Pass the wave event's `reason` through. Send nothing when the array is empty.
4. Idempotency note: "newly late" is edge-triggered by construction (prior vs new projection inside `persistChanges`), so a second identical regen produces no entries — no dedup table needed. Do not add one.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/notifications --filter=@carbon/jobs
# Expected: exit 0 (exhaustive NotificationEvent maps force every registration point)
grep -n "JobsProjectedLate" packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts packages/jobs/src/inngest/functions/notifications/content.ts packages/notifications/src/index.ts
# Expected: >= 1 hit in each file
```

**Out of scope:** email/Slack default delivery (opt-in only); a configurable planner recipient group (follow-up, per spec); notifying on jobs that *recovered* to on-time.

## Task 14: Docs sync

**Depends on:** Tasks 1–12, 17, 18
**Files:**
- Modify: `.claude/rules/scheduling-data-structures.md`
- Modify: `apps/erp/app/modules/production/AGENTS.md`
- Modify: `apps/erp/app/modules/resources/AGENTS.md`
- Modify: `.ai/specs/2026-08-12-forecast-first-finite-scheduling.md` — changelog entry

**Steps:**
1. Rewrite the affected sections of `scheduling-data-structures.md`: engine pipeline (no backward pass, no modes, whole-location payload, ladder windows incl. maintenance-dispatch downtime subtraction, remaining-work netting, projectedCompletionAt, expedite), trigger chain (no `carbon/reschedule-job`; wave = location regen, 30s debounce, newly-late digest notification), job ordering (deadline class → due date), and delete the dispatch-rule paragraph. Only document what the code now does — verify each claim against the files as written.
2. `production/AGENTS.md`: replace `triggerJobSchedule` guidance with `notifyScheduleInputsChanged`; update the Scheduling concept paragraph (ladder, forward-ASAP, projectedCompletionAt, priority = placement order); remove `schedulingPolicy` from the data-model table; add `workCenterShift` mention.
3. `resources/AGENTS.md`: update the Work Center concept ("always open 24×7 — no capacity knobs" is now wrong): operating shifts via `workCenterShift`, `alwaysOn`, ladder defaults.
4. Spec changelog: add "2026-08-12: implementation landed via .ai/plans/2026-08-12-forecast-first-finite-scheduling.md" once Tasks 1–13 are checked (leave unchecked items accurate if the run stops early).

**Verify:**
```bash
grep -rn "triggerJobSchedule\|schedulingPolicy\|dispatch rule" .claude/rules/scheduling-data-structures.md apps/erp/app/modules/production/AGENTS.md apps/erp/app/modules/resources/AGENTS.md
# Expected: no output (except historical changelog lines, which should not exist in these files)
```

**Out of scope:** the customer docs site (`docs/`) — the feature ships behind ERP screens already documented at concept level; flag for a follow-up instead of authoring here.

## Task 15: i18n extraction for new UI strings

**Depends on:** Tasks 9–12
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (generated by extract)

**Steps:**
1. `pnpm run lingui:extract`
2. Invoke the `/translate` skill to fill the new empty `msgstr` entries (it fans out to Haiku subagents and merges deterministically).
3. `pnpm run lingui:clean` if `/translate` did not already run it.

**Verify:**
```bash
grep -c 'msgstr ""' packages/locale/locales/es/erp.po
# Expected: 0 (no untranslated strings remain)
```

**Out of scope:** adding locales; MES catalog (no MES strings changed).

## Task 16: Browser verification via /test

**Depends on:** all prior tasks; requires the local stack running (`crbn up`) and the schema delta applied (Task 2). If the stack is not running, STOP and ask the user to boot it — never boot or reset it yourself.

**Steps:**
1. Invoke the `/test` skill scoped to this branch's diff with this scenario list:
   a. Resources → Work Centers → edit one: set "Operating shifts" to one shift, save, reopen — selection persists. Toggle "Runs 24×7", save, reopen — persists.
   b. Schedule → Dates board: drag a job to a new due-date column — the card shows the amber "outdated" triangle, and within ~1 minute (30s debounce + regen) the stamp clears on reload and the card shows a slack indicator.
   c. Open a job header: slack badge renders with a tooltip showing the projected completion date; "Best case…" runs and the modal shows current vs expedited projections.
   d. Schedule → People → Capacity: Load compares Scheduled vs Available; a station with no assignments shows calendar hours (not 0/24); the assumption banner appears if the dev company lacks shifts; the "Due" sub-tab still shows due-date demand.
   e. Confirm no reservation bars on the resource timeline fall on a weekend for a non-`alwaysOn` work center (dev-seed shifts permitting).
   f. Maintenance downtime: create a dispatch against a busy work center with "Takes work center offline" and a planned end 2 days out — after the regen, that WC's reservations vacate the outage window (resource timeline) and Capacity shows reduced Available; complete the dispatch — hours return at the next regen.
   g. Newly-late notification: with a job assigned to the test user, create the downtime from (f) sized to push that job past its due date — the in-app notification bell shows one "jobs newly projected late" digest naming the job; re-running the same regen adds no duplicate.
2. Capture screenshots per the playbook convention; cache the successful playbook.

**Verify:** /test run report with all scenarios passing (or precise failure notes fed back into the relevant task).

**Out of scope:** load/perf testing in the browser; MES flows.

---

## Extension: Dual Dates (2026-08-15 → 2026-08-18, complete)

Absorbed from the standalone `2026-08-15-dual-dates-due-vs-projected` plan at
consolidation; full task text in git history of that file. All 12 tasks landed,
one commit per task:

- [x] D1 Migration `20260818031629_dual-dates.sql` (projectedCompletionAt + RPC outputs)
- [x] D2 Apply + regenerate types
- [x] D3 `need-by-calculator.ts` (pure backward walk + calendarAdapters, 13 tests)
- [x] D4 Engine wiring: need-by pre-pass, unified diff-writing persist, pins un-frozen
- [x] D5 Placement-isolation + target-stability determinism guards (mutation-tested)
- [x] D6 Services: promise-date fallback removed, projection threaded to boards/MES
- [x] D7 BOP dual dates + behind-target amber
- [x] D8 Ops-board ItemCard + MES operation detail projected line
- [x] D9 `composeBehindTarget` first-behind-target attribution on the job cause
- [x] D10 Docs sync (rule + AGENTS.md + adoption test plan)
- [x] D11 i18n (96 strings across 12 locales)
- [x] D12 Browser verification — 5/5 PASS; found+fixed: weekly-pattern working-day
      test (year-runaway) and pin's missing `schedule.inputs.changed` emit

Engine suite after extension: 155 passed / 0 failed.
