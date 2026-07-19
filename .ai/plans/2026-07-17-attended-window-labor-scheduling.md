# Attended-window labor scheduling — implementation plan

**Spec:** .ai/specs/2026-07-17-attended-window-labor-scheduling.md
**Research:** .ai/research/labor-machine-capacity-scheduling.md
**Branch:** naveen/capacity-planning

Model recap (from spec, do not re-derive): gated op ⇒ machine reserved for the full span; **named people** reserved only for attended segments (`attended = setup + labor`), accumulating whenever ANY eligible person is on shift and un-booked, handing off at boundaries (relay), pausing (machine still reserved) when nobody is free; the unattended remainder (`max(0, machine − labor)`) runs on **calendar time 24/7**. `labor ≥ machine` ⇒ held throughout (current behavior). `attended = 0` ⇒ no person reservation. Ungated ops unchanged (machine only). New reservation kind `Employee` (`resourceId` = employee/user id); engine stops writing `OperatorPool` rows.

## Progress
- [x] Task 1: Migration — add `Employee` to `capacityResourceKind` (20260717105744; applied; side quest: repaired 6 restore-trap-missed main migrations with user approval)
- [x] Task 2: Regenerate DB types (clean diff after repair: Employee enum + FK-order noise)
- [x] Task 3: `calculateAttendedHours` in duration-calculator (+ 4 tests)
- [x] Task 4: Attended allocation with relay in slot-allocator (+ 11 attended tests; pool logic removed)
- [x] Task 5: Selector: eligible members, per-employee bookkeeping, segment commits
- [x] Task 6: Engine context: bucket `Employee` reservations per person (legacy OperatorPool rows ignored)
- [x] Task 7: Timeline UI parity for `Employee` kind (+ 2 tests; loader resolves person names; lane sort ranked)
- [x] Task 8: Full validation gates (deno 75/75, turbo typecheck erp ok, lint 32/32)
- [ ] Task 9: Live verification (fixture jobs + SQL invariants) — BLOCKED on user-triggered replans

## Dependencies
- Task 2 needs Task 1. Tasks 3–4 are pure TS — independent of Tasks 1–2, can run in parallel with them.
- Task 5 needs Tasks 3–4 (and Task 2 only at runtime, not for typecheck — `PlannedReservation.resourceKind` is a hand-written union in `types.ts`).
- Task 6 needs Task 5. Task 7 independent of 5–6 (UI types are local unions). Task 8 needs 1–7. Task 9 needs 8 and a running stack (user-triggered).

---

## Task 1: Migration — add `Employee` to `capacityResourceKind`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_add-employee-capacity-resource-kind.sql` (via CLI, do not hand-pick the timestamp)

**Steps:**
1. Run `pnpm db:migrate:new add-employee-capacity-resource-kind` from the repo root.
2. File content (this single statement only — `ALTER TYPE ... ADD VALUE` must not share a transaction with usages of the new value):
```sql
-- capacityReservation.resourceKind gains 'Employee': named-person attended-window
-- bookings (resourceId = employee/user id). 'OperatorPool' remains legal for old
-- rows; the engine no longer writes it.
ALTER TYPE "capacityResourceKind" ADD VALUE IF NOT EXISTS 'Employee';
```
3. Apply locally: `pnpm db:migrate`.

**Verify:**
```bash
grep -rn "ADD VALUE IF NOT EXISTS 'Employee'" packages/database/supabase/migrations/
# Expected: the new migration file, exactly one hit
```

**Out of scope:** no table/RLS/index changes; do NOT touch existing enum values or the capacityReservation table.

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated — never hand-edit): `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts` (whichever paths `pnpm run generate:types` rewrites)

**Steps:**
1. `pnpm run generate:types` from the repo root.

**Verify:**
```bash
grep -n '"WorkCenter" | "OperatorPool" | "Employee"\|Employee' packages/database/src/types.ts | grep -i capacityResourceKind | head -3
# Expected: capacityResourceKind union/enum now includes "Employee"
```

**Out of scope:** any manual edit to generated files. If generate:types produces unrelated diffs (schema drift), STOP and report — do not commit drift.

## Task 3: `calculateAttendedHours` in duration-calculator (+ tests)

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/duration-calculator.ts` — add exported function
- Create: `packages/database/supabase/functions/lib/scheduling/duration-calculator.test.ts`

**Steps:**
1. Next to `calculateDurationHours` (which returns `setup + max(labor, machine)`), add, reusing the SAME `convertToHours` helpers and operation field names (`setupTime/setupUnit`, `laborTime/laborUnit`):
```ts
/** Hours a person is hands-on at the START of the op: setup + labor. */
export function calculateAttendedHours(operation: <same param type as calculateDurationHours>): number {
  const setupHours = convertToHours(operation.setupTime, operation.setupUnit, /* same extra args as in calculateDurationHours */);
  const laborHours = convertToHours(operation.laborTime, operation.laborUnit, /* same */);
  return setupHours + laborHours;
}
```
Match the existing function's exact signature/typing — copy its parameter type verbatim. If `convertToHours` takes quantity args in `calculateDurationHours`, pass them identically.
2. Tests (deno, mirror the assertion style of `date-utils.test.ts`):
   - `attended = setup + labor` (e.g. 30 min setup + 5 min labor ⇒ 35/60 h)
   - `labor ≥ machine ⇒ attended === calculateDurationHours(op)` (e.g. setup 1h, labor 20h, machine 20h)
   - `zero setup and labor ⇒ 0`

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/duration-calculator.test.ts
# Expected: all new tests pass
```

**Out of scope:** do not change `calculateDurationHours` or `convertToHours`.

## Task 4: Attended allocation with relay in slot-allocator (+ tests)

**Depends on:** Task 3 (uses attended vs total hours as inputs; no import needed — caller passes numbers)
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/slot-allocator.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/slot-allocator.test.ts`

**Steps:**
1. New exported types (keep `ReservationInterval`, `ResourceCapacityData`, `machineIsFree`, `formatBlockingJobs`, `AllocationConflict`, `isConflict` as-is):
```ts
export type EligibleMember = {
  employeeId: string;
  windows: CalendarWindow[]; // person's shift windows; 24/7 when unassigned
};
export type AttendedSegment = { employeeId: string; startAt: Date; endAt: Date };
export type AttendedAllocationSuccess = {
  start: Date;           // first attended instant (or op start when attended = 0)
  attendedEnd: Date;     // when hands-on work completes (== start when attended = 0)
  end: Date;             // attendedEnd + remainder on calendar time
  segments: AttendedSegment[]; // empty when attendedHours = 0
  wait: WaitAttribution | null;
};
```
2. New pure helper `simulateAttended` (module-private):
```ts
function simulateAttended(args: {
  from: Date;                       // candidate op start
  attendedHours: number;
  members: EligibleMember[];
  busyByEmployee: Map<string, ReservationInterval[]>; // Employee-kind bookings, cross-ability
  horizonEnd: Date;
}): { segments: AttendedSegment[]; start: Date; attendedEnd: Date } | null
```
Algorithm (event-driven; boundaries = member window starts/ends and busy starts/ends, all clipped to `[from, horizonEnd)`):
   - Walk time from `from`. At each instant, a member is *available* iff some window of his covers the instant AND no busy interval of his covers it.
   - Accumulate attended time only while ≥1 member is available. Track an *incumbent*: at each stretch start, keep the previous segment's person if he is available; otherwise pick the available member with the fewest total busy ms (tie → lexicographic employeeId, for determinism).
   - Emit one segment per (person, contiguous stretch); merge adjacent segments with the same person and touching times.
   - Stop when accumulated == attendedHours; return `{ segments, start: segments[0].startAt, attendedEnd: last.endAt }`. If `attendedHours === 0`, return `{ segments: [], start: from, attendedEnd: from }`. Return `null` if the horizon exhausts first.
3. New exported `allocateAttendedOperation`:
```ts
export function allocateAttendedOperation(args: {
  attendedHours: number;
  totalHours: number;               // >= attendedHours; remainder = total - attended
  earliestStart: Date;
  horizonEnd: Date;
  capacity: ResourceCapacityData;
  members: EligibleMember[];        // already eligibility-filtered by caller
  busyByEmployee: Map<string, ReservationInterval[]>;
  timeZone?: string;
}): AttendedAllocationSuccess | AllocationConflict
```
   - `members.length === 0` ⇒ conflict `` `No qualified operator for <caller supplies name via message? NO — keep this check in the SELECTOR (it has abilityName); here require members.length > 0 and document it. If called with empty members, throw is wrong — return conflict "No qualified operator available".` `` — concretely: return `{ conflict: "No qualified operator available" }` and let the selector keep its existing named message for the empty-pool case before calling.
   - Loop (guard 100_000 iterations, mirroring `findSlot`): `sim = simulateAttended({from: cursor, ...})`; if null ⇒ conflict `` `No qualified operator availability before ${toIsoDateInTimeZone(horizonEnd, timeZone)}` ``. Compute `end = attendedEnd + (totalHours - attendedHours) * HOUR_MS`. If `end > horizonEnd` ⇒ conflict (same wording as machine exhaustion below). Check `machineIsFree(capacity, sim.start, end)`: if busy, set `lastBlocked = "machine"`, `cursor = nextTryAfter`, continue. A sim start later than the previous cursor means people caused the wait — set `lastBlocked = "operator"` when `sim.start > cursor` at the iteration where the machine check passes AND no machine hop happened in this iteration... **simpler, deterministic rule (use this):** track `machineBlocked = false`; every machine hop sets it. On success: `waitedMs = sim.start − earliestStart`; `resource = machineBlockedOnFinalApproach ? "machine" : "operator"` where `machineBlockedOnFinalApproach` = the LAST cursor advance before success came from a machine hop. (Same "last blocker wins" semantics as the current `lastBlocked` closure.)
   - Wait attribution on success (`waitedMs > 0`): `resource` as above; `source` = machine ⇒ `capacity.reservations`, operator ⇒ flatten of all members' `busyByEmployee` lists; `blockers = formatBlockingJobs(source, earliestStart, start)`; `ownJobAhead` = untagged interval in `source` overlapping the wait region (same predicate as today).
   - Machine-exhaustion conflict wording: `` `No slot with both an open work center and a qualified operator available before ${toIsoDateInTimeZone(horizonEnd, timeZone)}` ``.
4. Keep `allocateOperation` for **ungated** ops but simplify: it no longer takes `operatorPool` (delete `OperatorPool`, `PoolMember`, `poolIsFree`, and the pool branches; delete the `AllocationSuccess.wait` operator fallback — ungated waits are machine or window-snap ⇒ `resource: "machine"`). Update its doc comment.
5. Rewrite the module doc: machine capacity 1 (unchanged) + attended-segment relay model.
6. Tests — replace pool tests, keep machine + formatBlockingJobs tests. Reuse `weekdayWindows`/`alwaysOpen` fixtures. New/updated (names + key assertions):
   - `"one person tends two machines — attended windows interleave, both machines run in parallel"`: two capacities, one member (alwaysOpen), shared busy map; op A (attended 5/60 h, total 65/60 h) then op B same, both earliest 08:00. Assert A: start 08:00, attendedEnd 08:05, end 09:05; B: start 08:05 (person busy 08:00–08:05), end 09:10. Push A's segment into the busy map between calls.
   - `"relay: attended work hands off at the shift boundary"`: members Sam (Mon 08–16) + Dave (Mon 16–24, via expandCalendar day windows), attended 12h, total 12h, earliest Mon 08:00. Assert segments = [Sam 08–16, Dave 16–20], end Mon 20:00.
   - `"pause: single person, attended spans two shifts, machine reserved across the gap"`: Sam only (Mon–Fri 08–16), attended 12h ⇒ segments [Mon 08–16, Tue 08–12], end Tue 12:00, attendedEnd == end.
   - `"lights-out: remainder runs on calendar time overnight"`: Sam (Mon–Fri 08–16), attended 5/60, total 20h5m, earliest Mon 15:00. Assert start 15:00, attendedEnd 15:05, end Tue 11:05 — even though Sam is off-shift from 16:00.
   - `"labor >= machine: person held throughout (remainder zero)"`: attended == total 10h, Sam weekday shift ⇒ end pauses off-shift (Mon 08 start ⇒ end Tue 10:00 for earliest Sat, mirroring the old shift-pause test values).
   - `"zero attended hours: no segments, machine-only placement"`: attended 0, total 2h ⇒ segments [], start == earliestStart when machine free.
   - `"cross-ability double-booking: a person busy via ANOTHER ability's booking is unavailable"`: busyByEmployee entry for Sam 08:00–12:00 (tagged "J000009"), attended 2h ⇒ start 12:00, `wait.resource === "operator"`, `wait.blockers === "queued behind J000009 (1 op)"`.
   - `"machine busy blocks the attended start (attribution machine)"`: capacity reservation 08–10 tagged J000009, Sam free ⇒ start 10:00, `wait.resource === "machine"`.
   - Keep/adjust: existing machine hop test, horizon-booked conflict, ungated queue tests (drop `wait.resource` operator expectations for ungated).

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/slot-allocator.test.ts
# Expected: all tests pass, including the 8 new attended/relay tests
```

**Out of scope:** `calendar-utils.ts` (`findSlot` stays for ungated path), conflict-messages taxonomy (unchanged — arms already exist).

## Task 5: Selector — eligible members, per-employee bookkeeping, segment commits

**Depends on:** Tasks 3–4
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/types.ts` — `PlannedReservation.resourceKind: "WorkCenter" | "OperatorPool" | "Employee"` (line ~154; keep "OperatorPool" in the type for legacy reads)

**Steps:**
1. `FiniteSchedulingContext`: replace `poolReservationsByAbility: Map<string, ReservationInterval[]>` with `reservationsByEmployee: Map<string, ReservationInterval[]>` (Employee-kind bookings, cross-ability). Keep `employeesByAbility` (it supplies members).
2. Replace `buildOperatorPool` with `buildEligibleMembers(requirement, earliestStart, ctx): EligibleMember[]` — same eligibility filter (`isEligibleOperator`), mapping to `{ employeeId, windows }`. Empty list ⇒ keep the existing named conflict path (`No qualified operator for ${requirement.abilityName}`) BEFORE calling the allocator.
3. Gated branch of the candidate loop: compute `attendedHours = op.attendedHours ?? calculateAttendedHours(op)` (mirror how `durationHours` falls back) and call `allocateAttendedOperation({attendedHours, totalHours: durationHours, earliestStart, horizonEnd, capacity, members, busyByEmployee: ctx.reservationsByEmployee, timeZone: ctx.timeZone})`. Ungated branch keeps `allocateOperation` (machine only).
4. On commit of the best candidate:
   - WorkCenter reservation: unchanged (full span `slot.start → slot.end`, carries `earliestStartAt`, `scheduleNote`, `workHours`).
   - Per attended segment: push `{ startAt, endAt }` into `ctx.reservationsByEmployee.get(employeeId)` (create list if absent — untagged, own-job) AND `this.plannedReservations.push({ resourceKind: "Employee", resourceId: segment.employeeId, operationId: op.id, startAt, endAt, workHours: <segment hours> })`.
   - `classifyLatePlacement` input unchanged (`wait` comes from the allocator result).
5. Update the class/method docs to the attended-relay model.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/ && deno check lib/scheduling/slot-allocator.ts lib/scheduling/conflict-messages.ts lib/scheduling/apply-work-center-selections.ts lib/scheduling/duration-calculator.ts
# Expected: full suite green; deno check clean on the pure modules
```

**Out of scope:** manual-scheduling branch, Outside branch, candidate earliest-finish/tie-break logic, sticky mode, `apply-work-center-selections.ts`.

## Task 6: Engine context — bucket Employee reservations per person

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts` — `buildFiniteContext` (~lines 440–576)

**Steps:**
1. Where OperatorPool rows were bucketed into `poolReservationsByAbility`, instead bucket `resourceKind === "Employee"` rows into `reservationsByEmployee: Map<employeeId, ReservationInterval[]>` (carry `readableJobId` for blocker naming). **Ignore legacy `OperatorPool` rows entirely** (comment: they stop constraining after each job's next replan; the reactive wave refreshes all jobs).
2. Thread the new map through `setFiniteContext`. Update the builder doc comment.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check schedule/index.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -cE "slot-allocator|work-center-selector|duration-calculator" 
# Expected: 0 (no new type errors in touched files; ~23 pre-existing baseline errors elsewhere are OK)
```

**Out of scope:** `persistChanges` (already generic over `resourceKind`), `getLiveReservations` (returns all kinds already), dispatch/priority logic.

## Task 7: Timeline UI parity for `Employee` kind

**Depends on:** none (local type unions), but run after 5–6 for coherence
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Schedule/timeline.ts` (lines ~46, ~84 — union), `resourceTimeline.ts` (~18, ~45 — union), `TimelineDetail.tsx` (~52–57 — label)
- Modify: `apps/erp/app/modules/production/ui/Schedule/timeline.test.ts`, `resourceTimeline.test.ts`
- Copy from (precedent): the existing `OperatorPool` handling in those exact files — `Employee` renders the same way

**Steps:**
1. Extend every `"WorkCenter" | "OperatorPool"` union in the four files to include `"Employee"`.
2. `TimelineDetail.tsx`: label `Employee` rows `` t`Operator` `` (OperatorPool keeps `` t`Operator Pool` ``); reuse the same icon/branch as OperatorPool.
3. `resourceTimeline.ts`: wherever lanes/names resolve for OperatorPool rows (ability name map), route `Employee` rows through the same shape; if lane naming requires an employee-name map that the loader does not currently provide, name lanes with the raw `resourceId` for now and add a `// TODO(person-names)` — do NOT redesign the loader in this task. If that fallback turns out to break a test's expectations, STOP and report.
4. Update the two test files: duplicate one OperatorPool fixture case as `resourceKind: "Employee"` asserting identical rendering behavior; keep OperatorPool cases (legacy rows must still render).
5. Run `/translate`-relevant check only if new user-facing strings were added (the `t\`Operator\`` label is new — note it for the check-and-commit gate).

**Verify:**
```bash
cd apps/erp && pnpm vitest run app/modules/production/ui/Schedule/
# Expected: all tests pass, including new Employee-kind cases
```

**Out of scope:** person-name lane resolution via loader changes; Gantt visual redesign; MES.

## Task 8: Full validation gates

**Depends on:** Tasks 1–7
**Files:** none (verification only)

**Steps / Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/
# Expected: full suite green (69 tests pre-change; expect ~80 after)
cd /Users/naveenkashyap/Documents/carbon-org/carbon-naveen-capacity-planning && pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm run lint
# Expected: no new Biome errors in touched files
```

**Out of scope:** whole-repo typecheck (OOMs — never run).

## Task 9: Live verification (fixture jobs + SQL invariants)

**Depends on:** Task 8; requires the running dev stack and the USER to trigger replans (do not mutate the DB directly — propose SQL, let the user run it).

**Steps:**
1. Ask the user to replan J000009–J000011 (dates-board drag/release) after restarting the edge-runtime container if warm isolates linger.
2. Overlap invariants (expect 0 rows each):
```sql
-- machines: no overlapping WorkCenter reservations (non-manual, live)
SELECT r1.id, r2.id FROM "capacityReservation" r1
JOIN "capacityReservation" r2 ON r1."resourceKind"='WorkCenter' AND r2."resourceKind"='WorkCenter'
 AND r1."resourceId"=r2."resourceId" AND r1.id < r2.id
 AND r1."startAt" < r2."endAt" AND r2."startAt" < r1."endAt"
JOIN "jobOperation" o1 ON o1.id = r1."operationId" AND NOT o1."manuallyScheduled"
JOIN "jobOperation" o2 ON o2.id = r2."operationId" AND NOT o2."manuallyScheduled"
WHERE r1."scenarioId" IS NULL AND r2."scenarioId" IS NULL;
-- people: no overlapping Employee reservations per person
SELECT r1.id, r2.id FROM "capacityReservation" r1
JOIN "capacityReservation" r2 ON r1."resourceKind"='Employee' AND r2."resourceKind"='Employee'
 AND r1."resourceId"=r2."resourceId" AND r1.id < r2.id
 AND r1."startAt" < r2."endAt" AND r2."startAt" < r1."endAt"
WHERE r1."scenarioId" IS NULL AND r2."scenarioId" IS NULL;
```
3. Spot-check: Battery Test Rig ops now hold their operator only for `setup + labor` (compare an op's Employee segment lengths vs its WorkCenter span); jobs with small labor times overlap machine-wise across work centers where one person serves both.
4. Optional (user-approved only, per repo rule): `/test` browser pass over the schedule timeline to see Employee rows render.

**Out of scope:** seeding new fixture data without the user's approval; committing (only via /check-and-commit and only when the user asks).
