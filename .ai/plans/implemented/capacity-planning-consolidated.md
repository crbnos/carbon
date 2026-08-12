# Capacity Planning — Current Implementation

The implemented capacity-planning system on branch `naveen/capacity-planning`:
finite scheduling with attended-window labor, process-gated abilities,
durable capacity reservations, reactive replanning, and the schedule/Gantt
surfaces. This document describes the system **as built** — verified against
the squashed migration
`packages/database/supabase/migrations/20260720121629_capacity-planning.sql`
(the branch's entire schema delta vs main) and the code.

Consolidated from three implementation plans (originals removed from
`.ai/plans/`; full history in git). Concepts from the earlier plans that were
superseded during development are omitted here — see "Explicitly not built"
at the end.

| Origin plan | Scope |
|-------------|-------|
| `2026-07-06-finite-capacity-scheduling.md` | Capability model, finite scheduler core, dynamic lead time |
| `2026-07-16-reactive-replan.md` | Stale flags, debounced replan waves, net-change nightly |
| `2026-07-17-attended-window-labor-scheduling.md` | Employee capacity resources, attended slot allocation with relay, timeline UI |

Specs: `.ai/specs/2026-07-05-finite-capacity-scheduling.md`,
`.ai/specs/2026-07-17-attended-window-labor-scheduling.md`.
Related playbook: `.ai/playbooks/attended-scheduling-manual-test.md`.

---

## 1. Model overview

- **Capability model is process-level and binary.** A process can require an
  ability (`process.requiresAbility`); the ability is linked 1:1 to the
  process (`ability.processId`, auto-created when the toggle is turned on).
  Employee qualification lives in `employeeAbility` — effectively a map of
  the processes each person can do. Qualification is **binary**: active,
  training completed, not expired. There is no proficiency score, no learning
  curve evaluated by the scheduler, and no per-operation ability table.
- **Work centers are finite with capacity 1 and always open.** One operation
  at a time, decided purely by actual reservation intervals
  (`machineIsFree` in `slot-allocator.ts`). Work centers have **no**
  calendars, capacity knobs, or scheduling modes — machines run 24/7
  wall-clock time.
- **People are the shift-constrained resource.** A qualified employee's
  availability = their assigned shifts (`employeeShift` ⋈ `shift`) expanded
  into concrete UTC windows in the shift location's timezone. No shift
  assignment ⇒ always available.
- **Attended-window labor.** A gated op reserves its machine for the full
  span; **named people** are reserved only for the attended window
  (`attended = setup + labor`) at the start, accumulating whenever ANY
  eligible person is on shift and un-booked, handing off at boundaries
  (relay), pausing (machine still reserved) when nobody is free. The
  unattended remainder (`max(0, machine − labor)`) runs on calendar time
  24/7 (lights-out). `labor ≥ machine` ⇒ fully attended. `attended = 0` ⇒ no
  person reservation. Ungated ops are machine-only.
- **Reservations are durable and authoritative across jobs/runs.**
  `capacityReservation` rows of kind `WorkCenter` (full span) and `Employee`
  (per-person attended segments, `resourceId` = employee/user id). The
  `OperatorPool` enum value remains legal for legacy rows; the engine never
  writes it and ignores it on read.
- **Reactive replanning.** Scheduling-input mutations stamp affected jobs
  stale (`job.scheduleOutdatedReason`/`scheduleOutdatedAt`) and fire one
  event; a debounced per-company wave clears stale jobs' reservations and
  reschedules them in due-date order; a nightly net-change cron backstops
  anything missed.

---

## 2. Database schema

Everything lives in the single squashed migration
`20260720121629_capacity-planning.sql`. House conventions apply throughout:
composite PK `("id", "companyId")`, `id('prefix')` defaults, audit columns,
indexes on `companyId` and FKs, four RLS policies named
`SELECT`/`INSERT`/`UPDATE`/`DELETE`, bare `NUMERIC`.

### 2.1 Process abilities + eligibility columns

```sql
-- A process can require an ability. The ability is linked 1:1 to the process
-- (created automatically when "requiresAbility" is toggled on) and employee
-- qualification stays in "employeeAbility" — effectively a map of the
-- processes each person can do.
ALTER TABLE "process" ADD COLUMN "requiresAbility" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ability" ADD COLUMN "processId" TEXT REFERENCES "process"("id") ON DELETE SET NULL;
CREATE INDEX "ability_processId_idx" ON "ability" ("processId");
-- One ability per process per company
CREATE UNIQUE INDEX "ability_processId_companyId_key" ON "ability" ("processId", "companyId")
  WHERE "processId" IS NOT NULL;

-- Eligibility columns: qualification can expire (recertification)
ALTER TABLE "employeeAbility" ADD COLUMN "expiresAt" DATE;
ALTER TABLE "ability" ADD COLUMN "recertifyEveryDays" INTEGER;
```

The `processes` view is recreated (frozen column list) to surface
`requiresAbility` alongside the existing work-center and supplier
aggregations.

### 2.2 Capacity reservations + scheduling policy

```sql
-- 'WorkCenter' = machine-window bookings. 'Employee' = named-person
-- attended-window bookings (resourceId = employee/user id). 'OperatorPool'
-- remains legal for old rows; the engine no longer writes it.
CREATE TYPE "capacityResourceKind" AS ENUM ('WorkCenter', 'OperatorPool', 'Employee');
CREATE TYPE "schedulingDispatchRule" AS ENUM ('FIFO', 'EDD', 'SPT', 'WSPT', 'CR', 'MinSlack');

-- Durable slot allocations written by the scheduler (authoritative across jobs/runs)
CREATE TABLE "capacityReservation" (
    "id" TEXT NOT NULL DEFAULT id('cres'),
    "companyId" TEXT NOT NULL,
    "resourceKind" "capacityResourceKind" NOT NULL,
    "resourceId" TEXT NOT NULL, -- workCenter.id, employee/user id (Employee), or ability.id (OperatorPool)
    "operationId" TEXT NOT NULL REFERENCES "jobOperation"("id") ON DELETE CASCADE,
    "jobId" TEXT NOT NULL REFERENCES "job"("id") ON DELETE CASCADE,
    "startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "scenarioId" TEXT, -- null = live plan; scenario engine is a later phase
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    -- Per-placement explanation for the schedule timeline. The engine knows why
    -- every operation starts when it does (queued behind other jobs, waiting on
    -- a predecessor, waiting for an operator); these columns keep it for every
    -- placed operation so the Gantt can draw the wait (ghost segment from
    -- earliestStartAt to startAt) and say the reason in plain words.
    "earliestStartAt" TIMESTAMP WITH TIME ZONE,
    "scheduleNote" TEXT,
    -- A reservation's [startAt, endAt) is WALL-CLOCK span: for ability-gated
    -- operations it includes off-shift pauses, so a 6h solder can span 22h. The
    -- panel needs the actual work content to say "6h of work across 22h"
    -- instead of a misleading 22h duration. The engine knows the work hours at
    -- placement time; persist them alongside the interval.
    "workHours" NUMERIC,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CHECK ("endAt" > "startAt")
);
CREATE INDEX "capacityReservation_companyId_idx" ON "capacityReservation" ("companyId");
CREATE INDEX "capacityReservation_resource_window_idx" ON "capacityReservation" ("resourceId", "startAt", "endAt");
CREATE INDEX "capacityReservation_operationId_idx" ON "capacityReservation" ("operationId");
CREATE INDEX "capacityReservation_jobId_idx" ON "capacityReservation" ("jobId");
CREATE INDEX "capacityReservation_createdBy_idx" ON "capacityReservation" ("createdBy");

-- Dispatch-rule policy: one company default row (workCenterId null) + per-WC overrides
CREATE TABLE "schedulingPolicy" (
    "id" TEXT NOT NULL DEFAULT id('spol'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "dispatchRule" "schedulingDispatchRule" NOT NULL DEFAULT 'EDD',
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "schedulingPolicy_company_wc_key"
    ON "schedulingPolicy" ("companyId", COALESCE("workCenterId", ''));
```

Both tables carry the four-policy RLS block scoped `production_*`. Column
comments document `earliestStartAt` (start − earliestStart = time spent
waiting), `scheduleNote` (human-readable placement reason, English,
engine-generated, null when the op started as early as it could), and
`workHours` (work content = wall-clock span minus off-shift pauses; null on
legacy rows and manual pins).

### 2.3 readyAt + queue time

```sql
ALTER TABLE "jobOperation" ADD COLUMN "readyAt" TIMESTAMP WITH TIME ZONE;

-- Stamp the instant an operation becomes Ready. Ready-transitions are written
-- from multiple functions (dependency triggers, finish interceptor, scheduler),
-- so a single BEFORE trigger is the one reliable point.
CREATE OR REPLACE FUNCTION set_job_operation_ready_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."status" = 'Ready' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'Ready') AND NEW."readyAt" IS NULL THEN
    NEW."readyAt" = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ready_at_on_job_operation ON "jobOperation";
CREATE TRIGGER set_ready_at_on_job_operation
BEFORE INSERT OR UPDATE OF "status" ON "jobOperation"
FOR EACH ROW EXECUTE FUNCTION set_job_operation_ready_at();

-- Queue time: Ready -> first production event
CREATE OR REPLACE VIEW "jobOperationQueueTime" WITH(SECURITY_INVOKER=true) AS
SELECT
  jo."id", jo."companyId", jo."jobId", jo."workCenterId", jo."readyAt",
  MIN(pe."startTime") AS "firstEventAt",
  EXTRACT(EPOCH FROM (MIN(pe."startTime") - jo."readyAt")) / 3600.0 AS "queueHours"
FROM "jobOperation" jo
LEFT JOIN "productionEvent" pe ON pe."jobOperationId" = jo."id"
WHERE jo."readyAt" IS NOT NULL
GROUP BY jo."id", jo."companyId", jo."jobId", jo."workCenterId", jo."readyAt";
```

Historical operations have no `readyAt` backfill (the data was never
captured). Plain BEFORE triggers coexist with the production interceptor
architecture on `jobOperation`.

### 2.4 Training → ability bridge

```sql
ALTER TABLE "training"
  ADD COLUMN "grantsAbilityId" TEXT REFERENCES "ability"("id") ON DELETE SET NULL;
CREATE INDEX "training_grantsAbilityId_idx" ON "training" ("grantsAbilityId");
```

An `AFTER INSERT` trigger on `trainingCompletion`
(`grant_ability_on_training_completion`) resolves the assignment's training →
`grantsAbilityId` (join to `ability` for `recertifyEveryDays`) and upserts the
`employeeAbility` row on conflict `("employeeId", "abilityId")`: `active =
TRUE`, `trainingCompleted = TRUE`, `lastTrainingDate = completedAt::date`
(default `CURRENT_DATE`), `expiresAt = lastTrainingDate + recertifyEveryDays`
(null when the ability has no recertification period).

### 2.5 Conflict + stale surfacing (RPCs and columns)

- `get_active_job_operations_by_location(location_id, work_center_ids)` is
  recreated with two appended output columns: `hasConflict BOOLEAN`
  (`COALESCE(jo."hasConflict", FALSE)`) and `conflictReason TEXT` — the
  schedule operations board shows scheduling conflicts inline.
- Reactive-replanning stamps on `job`:

```sql
ALTER TABLE "job"
  ADD COLUMN "scheduleOutdatedReason" TEXT,
  ADD COLUMN "scheduleOutdatedAt" TIMESTAMP WITH TIME ZONE;
```

  `scheduleOutdatedReason` column comment: 'Why the stored schedule may be
  stale (e.g. "Qualification changed: Solder"). Null = schedule current.'
  Cleared by the next successful reschedule of the job.
- `get_jobs_by_date_range(location_id, start_date, end_date)` (dates board)
  is recreated to carry `scheduleOutdatedReason` through `relevant_jobs` and
  append it as the last output column (it also aggregates `hasConflict` via
  `BOOL_OR` over the parent make method's operations).

### 2.6 employeeShift RLS fix

`employeeShift` RLS previously resolved the company via
`get_company_id_from_foreign_key("employeeId", 'employee')`, an unordered
lookup — `employee` has a composite PK `(id, companyId)`, so for a person
employed in several companies the helper returned an arbitrary row, making
the policies pass or fail nondeterministically. The `updateEmployeeJob` shift
sync then errored after `employeeJob` was already updated, leaving the
scheduler blind to the assignment. The four policies are recreated to scope
directly on the table's own NOT NULL `companyId` (with
`people_view`/`people_create`/`people_update`/`people_delete` permissions),
like every other tenant table.

---

## 3. Capability management (ERP)

### 3.1 Process toggle → 1:1 ability

- `apps/erp/app/modules/resources/ui/Processes/ProcessForm.tsx` has a
  `<Boolean name="requiresAbility">` toggle — "Requires Ability", "Only
  qualified employees can be scheduled for and run this process"
  (`zfd.checkbox()` in `resources.models.ts`).
- On save, `processes.$processId.tsx` (edit) and `processes.new.tsx`
  (create) call `ensureProcessAbility`
  (`apps/erp/app/modules/resources/resources.service.ts`) when
  `requiresAbility` is true. It find-or-creates: selects the `ability` with
  `processId = process.id` for the company; if absent, inserts one named
  after the process with `processId` set, default curve
  `{ data: [{ week: 0, value: 100 }] }`, `shadowWeeks: 0`.
- Toggling **off** does nothing to the linked ability — it is not deleted,
  deactivated, or unlinked; the scheduler simply stops requiring it
  (`process.requiresAbility = false` excludes the process from
  `getProcessRequirements`).

### 3.2 Ability admin + rosters + person panel

Routes under `apps/erp/app/routes/x+/resources+/`: `abilities.tsx`,
`abilities.new.tsx`, `abilities.delete.$id.tsx`, `ability.$id.tsx`,
`ability.$id.details.tsx`, `ability.$id.employee.new.tsx`,
`ability.$id.employee.$employeeAbilityId.tsx`,
`ability.$id.employee.delete.$employeeAbilityId.tsx`,
`person.$personId.ability.new.tsx`. Components in
`apps/erp/app/modules/resources/ui/Abilities/`: `AbilitiesTable.tsx`,
`AbilityEmployeesTable.tsx`, `AbilityForm.tsx`, `EmployeeAbilityForm.tsx`,
`EmployeeAbilityStatus.tsx`.

- **`AbilityForm`**: `name` (Input), "Weeks to Full Proficiency" (Number,
  create-only — builds the default learning curve; no visible curve editor),
  `shadowWeeks` (Number), `recertifyEveryDays` (Number, helper
  "Qualification expires this many days after training; blank = never").
- **Ability-scoped roster** (`AbilityEmployeesTable`): the people qualified
  for an ability, with add/edit/delete drawer routes. The person details
  panel (`apps/erp/app/modules/people/ui/Person/PersonAbilities.tsx` +
  `person.$personId.ability.new.tsx`) provides the per-person view. (This
  roster + person-panel design replaced an earlier person × ability
  skills-matrix idea; no skills-matrix route exists.)
- **`EmployeeAbilityForm`** fields: `employeeId` or `abilityId`
  (mode-dependent), `active` (Boolean), `trainingCompleted` (Boolean),
  `lastTrainingDate` (DatePicker), `expiresAt` (DatePicker, helper "Blank =
  computed from the ability's recertification period"). Validator
  `employeeAbilityCellValidator` in `resources.models.ts`.
- **Server-side expiry default**: `resolveEmployeeAbilityExpiresAt`
  (`resources.service.ts`) — explicit `expiresAt` wins; else with a
  `lastTrainingDate` and an ability `recertifyEveryDays`, computes
  `lastTrainingDate + recertifyEveryDays` (UTC, `YYYY-MM-DD`); else null
  (never expires). The DB training-completion trigger applies the same rule.
- **Nav** (`useResourcesSubmodules.tsx`): People group contains Abilities
  (`path.to.abilities`), Training, Assignments, Suggestions; Infrastructure
  contains Locations, Processes, Work Centers.
- Mutations on these routes fire `notifyScheduleInputsChanged` (see §7).

### 3.3 Work centers

The work-center form is unchanged from main apart from removing a dead
commented-out `requiredAbilityId` field. Work centers have **no capacity
knobs or calendars** — capacity is implicit (one op at a time) and gating is
per-process via abilities.

---

## 4. Scheduling engine

Deno modules under `packages/database/supabase/functions/lib/scheduling/`,
driven by the `schedule` edge function (`schedule/index.ts`). Pipeline
(`SchedulingEngine.run`): initialize → assignMaterials → createDependencies →
calculateDates (backward/forward pass) → selectWorkCenters (finite
placement) → calculatePriorities (dispatch rules) → persistChanges.

`SCHEDULING_HORIZON_DAYS = 365`.

### 4.1 MasterDataProvider — the read seam

`master-data-provider.ts`. All master/transactional **reads** go through the
`MasterDataProvider` interface so the engine can later be pointed at "live ⊕
scenario overrides" without touching placement logic; **writes** stay on the
concrete Kysely client. `KyselyMasterDataProvider(db, client, companyId,
options?)` implements it (the job-method-tree RPC uses the supabase client).

Interface:

```typescript
export interface MasterDataProvider {
  getJob(jobId): Promise<Job | undefined>;
  getOperations(jobId, opts?: { includeDone?: boolean }): Promise<BaseOperation[]>;
  getDependencies(jobId): Promise<JobOperationDependency[]>;
  getReworkDependencies(jobId, reworkOpIds): Promise<JobOperationDependency[]>;
  getMaterialsWithMakeMethod(makeMethodIds): Promise<JobMaterialWithMakeMethod[]>;
  getUnassignedMakeToOrderMaterials(makeMethodIds): Promise<UnassignedMaterial[]>;
  getUnlinkedMaterials(jobId): Promise<UnlinkedMaterial[]>;
  getRootMakeMethod(jobId): Promise<RootMakeMethod | undefined>;
  getJobMethodTree(methodId): Promise<{ data; error }>;
  getProcessesWithWorkCenters(): Promise<ProcessWorkCenters[]>;
  getActiveWorkCenters(locationId): Promise<ActiveWorkCenter[]>;
  getCrossJobOperationsAtWorkCenters(workCenterIds): Promise<CrossJobOperation[]>;
  // ---- finite-capacity reads ----
  getLiveReservations(fromDate, excludeJobId): Promise<LiveReservation[]>;
  getSchedulingPolicies(): Promise<SchedulingPolicyRow[]>;
  getProcessRequirements(processIds): Promise<ProcessRequirementRow[]>;
  getQualifiedEmployees(abilityIds): Promise<QualifiedEmployeeRow[]>;
  getEmployeeShiftWindows(employeeIds): Promise<EmployeeShiftRow[]>;
}
```

Key read semantics:

- `getJob` normalizes `dueDate` to a `"YYYY-MM-DD"` string (pg returns DATE
  as a JS Date; every consumer compares lexicographically — `string > Date`
  is always false) and defaults `timezone` to `"UTC"` from the job's
  location.
- `getLiveReservations(fromDate, excludeJobId)`: `scenarioId IS NULL`, other
  jobs only, `endAt > fromDate`, joined to `job` to carry `readableJobId`
  (e.g. J000001) for conflict messages, and **excluding
  Cancelled/Completed/Closed jobs** — reservations are only deleted when
  their job is rescheduled, so a terminal job's lingering rows must not hold
  capacity.
- `getCrossJobOperationsAtWorkCenters` likewise excludes terminal jobs (ops
  can outlive their job's lifecycle — cancelling a job does not cancel its
  ops).
- `getProcessRequirements(processIds)`: `process ⋈ ability ON ability.
  processId = process.id AND ability.active`, filtered
  `requiresAbility = true` → `{ processId, abilityId, abilityName }`.
- `getQualifiedEmployees(abilityIds)`: `employeeAbility` rows
  (`employeeId`, `active`, `trainingCompleted`, `expiresAt` normalized to
  ISO date).
- `getEmployeeShiftWindows(employeeIds)`: `employeeShift ⋈ shift` (active
  shifts) ⋈ `location` for the timezone; the shift's weekday booleans are
  flattened into `{ employeeId, dayOfWeek (0 = Sunday), startTime, endTime,
  timezone }` rows.
- **Batch company cache**: with `options.cacheCompanyData` (used by batched
  replan waves), company-STATIC reads (processes, work centers,
  qualifications, shift windows, dispatch policies) are promise-cached on
  first read. Job-scoped reads and **live reservations are never cached** —
  each job in a batch must see the previous jobs' just-persisted placements.

### 4.2 calendar-utils — people's availability windows

`calendar-utils.ts` (pure, no DB). Work centers are always open (24/7);
availability constraints come from PEOPLE.

- `CalendarShiftRow = { dayOfWeek, startTime, endTime }` (times local to the
  shift's timezone), `CalendarWindow = { start: Date; end: Date }`.
- `expandCalendar(shifts, rangeStart, rangeEnd, timezone)` expands a weekly
  pattern into concrete, disjoint, sorted UTC windows. Empty `shifts` ⇒ one
  24×7 window covering the whole range (no shift assignment = always
  available). An overnight row (`endTime <= startTime`) runs into the next
  local day. Iteration pads one day each side so overnight shifts and tz
  offsets can't clip boundary days.
- `shiftTimeToDate(dayDate, time, timezone)` converts local wall-clock time
  on a local calendar day to the UTC instant using `Intl.DateTimeFormat`
  offset math with two-pass DST correction (no external deps).
- `unionWindows(windowLists)` unions several members' windows into one
  disjoint list (time where at least one member is available);
  `coversInstant(windows, at)`; `countOverlaps(reservations, start, end)`.
- `findSlot({ windows, durationHours, earliestStart, isFree })` walks
  forward accumulating working time across windows, consulting
  `isFree(start, end)` per candidate interval and resuming from
  `nextTryAfter` on rejection — used by the ungated (machine-only) path.

### 4.3 duration-calculator

`duration-calculator.ts`. `convertToHours(time, unit, quantity)` handles the
full `factor` unit set (Total Hours/Minutes, Hours|Minutes per piece /100
/1000, Pieces per Hour/Minute, Seconds/Piece).

- `calculateDurationHours(op) = setup + max(labor, machine)` (labor and
  machine overlap).
- `calculateAttendedHours(op) = setup + labor` — hours a person is hands-on
  at the START of the op; the machine runs the remaining
  `max(0, machine − labor)` unattended. When `labor ≥ machine` this equals
  `calculateDurationHours` (fully attended).

### 4.4 operator-eligibility

`operator-eligibility.ts`:

```typescript
export type QualifiedEmployee = {
  employeeId: string;
  active: boolean;
  trainingCompleted: boolean | null;
  expiresAt: string | null;
};

export function isEligibleOperator(employee, earliestStart, timeZone = "UTC"): boolean
```

Qualification is binary: `active && trainingCompleted && (expiresAt === null
|| expiresAt > startDate)`. Expiry is a calendar date at the factory —
compared against the operation start's date in the factory's zone
(`toIsoDateInTimeZone`), not UTC's. Expired-as-of-start is excluded;
expiring after the start still counts.

### 4.5 slot-allocator — machine capacity 1 + attended relay

`slot-allocator.ts` (pure — no DB, fully testable with fixtures).

```typescript
export type ReservationInterval = {
  startAt: Date;
  endAt: Date;
  readableJobId?: string; // set on live rows from other jobs; in-run pushes
                          // for the job being scheduled stay untagged, which
                          // excludes them from blocker attribution
};
export type ResourceCapacityData = {
  workCenter: { id: string };
  windows: CalendarWindow[];           // the scheduling horizon (always open)
  reservations: ReservationInterval[]; // other jobs + earlier ops this run
};
export type EligibleMember = {
  employeeId: string;
  windows: CalendarWindow[]; // from the person's shifts; 24/7 when unassigned
};
export type AttendedSegment = { employeeId: string; startAt: Date; endAt: Date };
export type AttendedAllocationSuccess = {
  start: Date;         // first attended instant (op start)
  attendedEnd: Date;   // when hands-on work completes (== start when 0h)
  end: Date;           // attendedEnd + the unattended remainder on calendar time
  segments: AttendedSegment[]; // person-by-person booking; empty when 0h
  wait: WaitAttribution | null;
};
export type AllocationConflict = { conflict: string };
```

**`machineIsFree(capacity, start, end)`** (module-private): capacity is 1,
so any overlapping reservation makes the interval busy; returns the earliest
overlapping reservation's end as the retry hint.

**`simulateAttended`** (module-private, pure) accumulates `attendedHours` of
hands-on work starting no earlier than `from`:

- Availability can only change at member window or busy-interval boundaries,
  so the walk is event-driven over those points (clipped to
  `[from, horizonEnd)`). A member is available at an instant when some shift
  window covers it AND no busy interval of theirs covers it.
- Attended time accumulates only while ≥ 1 member is available (a stretch
  with nobody free is a pause). Continuity: the **incumbent** keeps the work
  while available; otherwise the available member with the fewest total busy
  ms takes over (tie → lexicographic employeeId, for determinism).
- One segment per (person, contiguous stretch); adjacent same-person
  touching segments merge. Attended ms are rounded to whole ms so fractional
  hours (5 min = 1/12 h) don't drift under floating point.
- `attendedHours <= 0` ⇒ `{ segments: [], start: from, attendedEnd: from }`.
  Horizon exhaustion before completion ⇒ `null`.

**`allocateAttendedOperation({ attendedHours, totalHours, earliestStart,
horizonEnd, capacity, members, busyByEmployee, timeZone? })`** — gated ops.
The machine is held for the whole span; people are booked only for the
attended window.

- `attendedHours > 0 && members.length === 0` ⇒ conflict
  `"No qualified operator available"` (backstop only — the selector normally
  pre-empts with a message naming the ability).
- Main loop (guard 100 000 iterations): run `simulateAttended` from the
  cursor; `null` ⇒ conflict `` `No qualified operator availability before
  ${toIsoDateInTimeZone(horizonEnd, timeZone)}` ``. Compute
  `end = attendedEnd + remainder` (remainder = `(totalHours −
  attendedHours)` on calendar time); `end > horizonEnd` ⇒ the exhaustion
  conflict (later starts only finish later — no point walking on). Check
  `machineIsFree(capacity, sim.start, end)`: on busy, hop the cursor to the
  blocking reservation's end (with a 60 s defensive forward-progress floor)
  and re-run the simulation.
- Exhaustion conflict wording: gated ⇒ `` `No slot with both an open work
  center and a qualified operator available before <date>` ``; `attendedHours
  === 0` ⇒ `` `No work center capacity available before <date>` ``. Dates in
  conflict messages are worded in the factory's IANA zone.
- **Wait attribution** on success (`waitedMs = start − earliestStart > 0`),
  last-blocker-wins: `resource = "operator"` when the people simulation
  pushed the start past the final machine hop (`sim.start > cursor`) or no
  machine hop ever happened; else `"machine"`. `source` =
  `capacity.reservations` (machine) or the flattened members'
  `busyByEmployee` lists (operator); `blockers = formatBlockingJobs(source,
  earliestStart, start)`; `ownJobAhead` = an untagged interval in `source`
  overlaps the wait region.

**`formatBlockingJobs(reservations, from, to)`** names the jobs whose tagged
reservations occupy the wait region, ranked by op count (max 3 listed, then
`+N more`): e.g. `"queued behind J000001 (3 ops), J000007 (1 op)"`; null
when no other job's work overlaps.

**`allocateOperation({ durationHours, earliestStart, horizonEnd, capacity,
timeZone? })`** — ungated ops, machine-only: `findSlot` over the capacity
windows with `machineIsFree` as the freeness check (also rejecting intervals
past the horizon). Conflicts: `` `No working time available at work center
before <date>` `` (no windows) / `` `No work center capacity available
before <date>` ``. Waits are always attributed `resource: "machine"`.

### 4.6 work-center-selector — placement

`work-center-selector.ts`. Two finite resources gate every placement: the
work center (capacity 1, held for the full span) and, for ability-gated
operations, PEOPLE.

```typescript
export type ProcessRequirement = { abilityId: string; abilityName: string };
export type PoolEmployee = QualifiedEmployee & { windows: CalendarWindow[] };

export type FiniteSchedulingContext = {
  capacityByWorkCenter: Map<string, ResourceCapacityData>;
  requirementByProcess: Map<string, ProcessRequirement>; // only requiresAbility processes
  employeesByAbility: Map<string, PoolEmployee[]>;
  reservationsByEmployee: Map<string, ReservationInterval[]>; // Employee-kind, cross-ability
  dependencies: JobOperationDependency[];
  now: Date;
  horizonDays: number;
  timeZone: string;          // factory zone: lateness judged in ITS calendar day
  stickyWorkCenters: boolean; // reschedule mode: assigned WCs are kept
};
```

Reservation arrays are mutated in-run as operations are placed so later
operations see earlier placements. `selectWorkCentersForOperations(
operations, { jobDueDate })` iterates operations sorted by start date
(approximating DAG order so predecessors' in-run reservations are visible to
successors):

- **Outside operations** consume no internal capacity but occupy calendar
  time: placed after their predecessors, `end = start + durationHours` on
  the supplier's 24/7 clock, so successors wait for the outsourced
  turnaround and the timeline shows real dates. Late vs the job due date ⇒
  `outside-processing` conflict. Manually pinned Outside ops keep their
  dates; successors still chain after the pinned end.
- **Manually scheduled operations** keep their pinned dates and work center;
  their existing `[startDate, dueDate + 1d)` window is pushed as a
  WorkCenter reservation (in-run and planned) so their capacity still
  counts. No Employee segments are booked for pins.
- **Sticky work centers**: in reschedule mode, an operation that already has
  a work center keeps it (setups/fixtures/operators live there) — only
  timing/conflicts are recomputed. Falls back to the full process-candidate
  list when the assigned WC has no capacity data (e.g. deactivated since
  assignment). Work centers are only (re)selected at initial scheduling or
  manually on the operations board.
- **Earliest feasible start** = max(now, DAG-computed `startDate`, latest
  in-run predecessor placement end). The binding predecessor is tracked
  (`dominantDepId`) for inherited-delay attribution. `horizonEnd =
  earliestStart + horizonDays`.
- **Requirement resolution**: the op's PROCESS supplies the single required
  ability via `requirementByProcess`. `buildEligibleMembers(requirement,
  earliestStart, ctx)` filters `employeesByAbility` through
  `isEligibleOperator` (as of the op's start, factory zone) and maps to
  `{ employeeId, windows }`. Empty member list with `attendedHours > 0` ⇒
  named conflict `` `No qualified operator for ${abilityName}` `` — no walk
  needed.
- `durationHours = op.durationHours ?? calculateDurationHours(op)`;
  `attendedHours = min(calculateAttendedHours(op), durationHours)`.
- **Candidate loop**: gated ops call `allocateAttendedOperation` (with
  `busyByEmployee: ctx.reservationsByEmployee`); ungated ops call
  `allocateOperation` and the result is normalized to the attended shape
  (`segments: []`, `attendedEnd = end`). The first conflict encountered is
  remembered for the fallback message.
- **Selection**: candidate with the **earliest finish** wins — a busy
  machine yields a later finish, so this load-balances naturally; tie →
  least total reserved ms (the emptier machine).
- **Commit** of the best candidate:
  - WorkCenter reservation for the full span, planned with
    `earliestStartAt`, `scheduleNote = composePlacementNote(cause,
    waitedMs)`, `workHours = durationHours`.
  - Per attended segment: pushed into
    `ctx.reservationsByEmployee[employeeId]` (untagged = own-job) so no
    later op double-books that person **on any ability**, and planned as
    `{ resourceKind: "Employee", resourceId: employeeId, operationId,
    startAt, endAt, workHours: <segment hours> }`.
  - `placedEndByOperation` records the end for successors.
- **Lateness** is judged against the JOB's due date (`placedEnd` as a
  factory-zone date > `jobDueDate` ⇒ `conflict =
  composeLateConflict(placedEndDate, jobDueDate, cause)`). The
  backward-computed per-op due dates are NOT used for lateness: they round
  every step up to a whole business day, landing far earlier than the real
  requirement, and would flag on-time placements. Jobs with no due date are
  never flagged late.
- **All candidates conflicted** (machine, skill, or shift coverage): the op
  still gets a work center — the least-reserved candidate — and the first
  conflict string surfaces (fallback `"No feasible capacity slot"`).
  Selection errors (`"No process ID provided"`, `` `No work centers found
  for process ${processId}` ``) surface on the selection; nothing fails
  hard.

### 4.7 Engine context, application, persistence

`scheduling-engine.ts`:

- **`buildFiniteContext()`** runs just before selection (so the rebuilt
  dependency DAG is final), in `selectWorkCenters`. It gathers candidate WC
  ids (process candidates + current assignments so manual pins reserve on
  their existing WC), then loads in parallel: `getLiveReservations(now,
  thisJobId)` and `getProcessRequirements(processIds)`; then
  `getQualifiedEmployees(abilityIds)` and
  `getEmployeeShiftWindows(employeeIds)`.
  - Work centers: `windows = [{ start: now, end: now + (365 + 7)d }]`
    (capacity 1, always open across the horizon); their reservations are the
    WorkCenter-kind live rows (with `readableJobId`).
  - People: each employee's shift rows are grouped **by timezone**, each
    group expanded via `expandCalendar`, and the lists unioned
    (`unionWindows`). No shift rows ⇒ one always-open window.
  - `reservationsByEmployee` buckets Employee-kind live rows per person
    (with `readableJobId` for blocker naming). **Legacy OperatorPool rows
    are ignored deliberately**: they can't be attributed to a person, and
    they stop existing after each job's next replan (the reactive stale-wave
    refreshes everything).
  - `stickyWorkCenters = (mode === "reschedule")`.
- **`applyWorkCenterSelections`** (`apply-work-center-selections.ts`, pure)
  writes placements onto the date-only operation columns as the **factory's
  calendar day** (`toIsoDateInTimeZone`) — an op ending 03:04 local on the
  21st must not be stored as due the 20th. A finite placement overrides the
  backward-pass dates and clears the pass-1 date conflict it replaced; a
  selection conflict sets `hasConflict`/`conflictReason`.
- **`persistChanges()`**:
  - Per-op `jobOperation` updates: `startDate`, `dueDate` (manually
    scheduled ops keep their `dueDate` — only `startDate`, `priority`,
    `workCenterId`, conflict fields update), `priority`, `workCenterId`,
    `hasConflict`, `conflictReason`, audit fields. Sequential statements on
    the Kysely client (not wrapped in a single transaction).
  - Reservations are **rebuilt**: `DELETE FROM "capacityReservation" WHERE
    "jobId" = ? AND "companyId" = ? AND "scenarioId" IS NULL`, then a bulk
    insert of the run's planned reservations (WorkCenter + Employee, with
    `earliestStartAt`/`scheduleNote`/`workHours`, `createdBy = userId`).
    Zero-duration placements (`endAt === startAt`, from all-zero-time ops)
    are filtered out — they occupy no capacity and would violate the
    `endAt > startAt` check.
  - Initial mode also flips the job to `Ready`. The result includes
    `reservationsWritten`.

### 4.8 Dispatch rules (priorities)

`priority-calculator.ts` + `resolveDispatchRules()` in the engine. Dispatch
rules order the per-work-center **priority numbers** (the operations board /
dispatch order), not the placement walk.

- Resolution: per-WC `schedulingPolicy` row → company default row
  (`workCenterId` null) → `'EDD'`. Cached per engine instance.
- `calculatePriorities()` merges this job's freshly scheduled ops with other
  jobs' active ops at the affected work centers
  (`getCrossJobOperationsAtWorkCenters`) and applies
  `calculatePrioritiesByWorkCenter(ops, resolveRule)`.
- `sortOperationsByPriority(ops, rule = "EDD")`: primary sort =
  `compareByDispatchRule`, ties fall through to the legacy chain (startDate
  asc nulls-last → jobPriority asc → deadline type ASAP > Hard > Soft > No
  Deadline). Rule keys (nulls last): FIFO = createdAt; EDD = op dueDate (the
  default; for backward-scheduled jobs this closely mirrors the legacy
  startDate-first ordering); SPT = duration asc (floored at 0.01 h); WSPT =
  jobPriority × duration asc (lower job priority number = more important, so
  important+short work leads); CR = (dueDate − now) / duration asc;
  MinSlack = (dueDate − now) − duration asc.
- The `schedulingPolicy` table is consumed only by the engine — there is
  **no ERP UI** to view or edit policies yet; companies without rows get EDD.

### 4.9 Conflict-message taxonomy

`conflict-messages.ts` (pure; strings stored in
`jobOperation.conflictReason` and shown verbatim on the schedule boards —
English by design, not i18n'd).

- `WaitAttribution = { resource: "machine" | "operator"; blockers: string |
  null; ownJobAhead: boolean }` — built by the allocator; `resource` is the
  check that failed on the LAST probe before the successful placement (the
  binding constraint).
- `LatePlacementCause` kinds: `machine-queue` (blockers), `machine-own-job`,
  `machine-wait`, `operator-queue` (blockers), `own-job-queue`,
  `operator-wait` (nobody on shift in the gap), `inherited-delay`
  (predecessor finished late; names it), `no-runway` (nothing delayed it —
  not enough time before the due date), `outside-processing`.
- `classifyLatePlacement({ waitedMs, wait, dominantDep })` maps attribution
  → cause. A null `wait` with `waitedMs > 0` on a gated op means a
  shift-gap snap — nobody qualified was on shift — classified
  `operator-wait`.
- `composePlacementNote(cause, waitedMs)` produces the always-stored
  `scheduleNote` (e.g. "Waited 14h for the work center — queued behind
  J000010 (2 ops)"); `composeLateConflict(placedEnd, dueDate, cause)`
  produces the late-only `conflictReason`. `formatWaitDuration` renders
  "45m" / "14h" / "2d 3h" — coarse on purpose; it labels a Gantt bar.

#### Complete conflict-class reference

Everything that can land in `jobOperation.conflictReason` falls into three
families. A conflict, strictly, is: **couldn't place the op, or placed it
past the job's due date.** Flags are snapshots written at scheduling time —
stale until the job's next run (the reactive stale-wave exists to refresh
them when inputs change through the app; direct SQL edits fire no event).

**A. Unplaceable** (selector/allocator; in escalating order of how far the
search got):

| Message | Meaning |
|---|---|
| `No qualified operator for <ability>` | Process requires the ability and ZERO people currently qualify (active ∧ trainingCompleted ∧ unexpired). No slot search happens (`work-center-selector.ts:396`). |
| `No qualified operator availability before <date>` | Qualified people exist but none is free + on shift within the horizon. |
| `No working time available at work center before <date>` | No open working window at the station within the horizon. |
| `No work center capacity available before <date>` | Machine (capacity 1) reserved solid through the horizon. |
| `No feasible capacity slot` | Selector fallback when no candidate produced a slot and nothing more specific was captured. |
| `No process ID provided` / `No work centers found for process <id>` | Selection data errors — surfaced, never hard-fail. |

**B. Placed but late** — all start `Finishes <date> but the job is due
<date> — …`; the suffix is the cause attribution (binding constraint on the
last failed probe):

| Suffix | Cause kind | Actionable reading |
|---|---|---|
| `waited for the work center, <blockers>` | `machine-queue` | Named jobs held the machine — resequence or add capacity |
| `waited for the work center, busy with earlier operations in this job` | `machine-own-job` | Own routing serializes on one station |
| `waited for the work center to be available` | `machine-wait` | Machine busy, no attributable blockers |
| `waited for a qualified operator, <blockers>` | `operator-queue` | Qualified people were on other jobs |
| `waited for a qualified operator, busy with earlier operations in this job` | `own-job-queue` | Own earlier ops held the operators |
| `waited for a qualified operator to be available` | `operator-wait` | Shift-gap waiting — nobody qualified on shift |
| `starts late because it waits for "<op>" earlier in this job; its own work center was free` | `inherited-delay` | Critical path is upstream — fixing this station is a dead end |
| `not enough time remains before the due date` | `no-runway` | Nothing waited; more work than calendar left |
| `outside processing pushes it past the due date` | `outside-processing` | Subcontract turnaround alone overruns the date |

**C. Backward-pass lateness** (`date-calculator.ts`, pass 1): `Operation
must start on <date> but current date is <today>` — the backward walk from
the due date lands in the past. Requires a real job due date (synthetic
anchors never flag); a manually-pinned variant exists. Finite placement
normally overwrites these with a family-B message.

**Not conflicts** (same taxonomy, neutral surfaces): `scheduleNote` /
wait-ghost text ("Waited 14h for the work center — queued behind …") appears
on ON-TIME ops and explains timing; Gantt group-row roll-ups ("N operations
at this work center have scheduling conflicts") are UI aggregation, not
stored reasons.

---

## 5. MES eligibility gate

`getOperationEligibility` in `apps/mes/app/services/operations.service.ts`,
called from the start loader
`apps/mes/app/routes/x+/start.$operationId.tsx` (beside the existing
maintenance-block and storage-rule checks, before `startProductionEvent`).

Logic (service-role client): fetch the op's `processId` (none ⇒ eligible) →
fetch `process.name, requiresAbility` (`!requiresAbility` ⇒ eligible) →
fetch the active `ability` with `processId = op.processId` (none ⇒ eligible;
treated as a data anomaly, not a block) → fetch the employee's
`employeeAbility (active, trainingCompleted, expiresAt)`. Blocks with:

- no row or `!active` → `"Requires {ability} — not qualified"`
- `!trainingCompleted` → `"Requires {ability} — training not completed"`
- `expiresAt <= today` → `"Requires {ability} — qualification expired {date}"`

**Fails open** on every query error (logged): the scheduler is the primary
enforcement; this gate is a best-effort backstop. On block, the loader
redirects to `path.to.operation(operationId)` with
`flash(error(..., eligibility.reason))` — the same mechanics as the
maintenance block. Blocking mid-operation events for an already-started
operator is out of scope; the ERP assignee remains a soft field.

---

## 6. Promise-date service (predictLeadTime v1)

`getJobPromiseDate(client, jobId, companyId)` in
`apps/erp/app/modules/production/production.service.ts`: selects
`jobOperation(id, dueDate, hasConflict)` for the job (companyId-scoped,
status in Todo/Waiting/Ready/In Progress/Paused); `promiseDate` = max
`dueDate` (the scheduled finish of the job's last operation, or null);
returns `{ promiseDate, basis: "schedule", confidence: hasConflict ? "low" :
"scheduled" }`. Recomputed implicitly on every reschedule because it reads
live operation dates. The quoting-time `predictLeadTime(item, quantity)`
variant and any ML layer are later work.

---

## 7. Reactive replanning

Flow: detect → mark → badge → debounce → wave → fresh. Stale state lives on
`job` (two nullable columns, §2.5); affected-set computation lives in
TypeScript (an Inngest mark function), not SQL triggers — mutation sites
fire one event and the nightly sweep backstops anything missed.
`manuallyScheduled` pins stay untouched (the engine honors them).

### 7.1 Event + app wiring

- Event (`packages/lib/src/events.ts`): `"carbon/schedule.inputs.changed"`,
  payload `{ companyId, kind, reason, entityId? }` with
  `kind: "ability" | "shift" | "employee-shift" | "work-center" |
  "location" | "reorder"`. `entityId` is optional — "the changed record for
  precise scoping". Trigger mapping `"schedule-inputs-changed"` in
  `packages/lib/src/trigger.ts`.
- Helper `notifyScheduleInputsChanged(companyId, kind, reason, entityId?)`
  in `production.service.ts` (dynamically imports `@carbon/jobs` and calls
  `trigger`). Call sites: the employee-ability routes
  (`ability.$id.employee.new/.edit/.delete`), shift hours update
  (`x+/people+/shifts.$shiftId.tsx`), person job/shift assignment
  (`x+/person+/$personId.job.tsx`), and dates-board reordering
  (`x+/schedule+/dates.update.tsx`, kind `"reorder"`).

### 7.2 Inngest functions

`packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts` —
both listen on the event.

- **`markScheduleStaleFunction`** (id `mark-schedule-stale`, retries 2,
  concurrency `{ limit: 1, key: companyId }`) — immediate. Kind-scoped
  affected-set: `ability` + entityId → jobs with unfinished ops on that
  ability's process; `ability`/`shift`/`employee-shift` without entityId →
  jobs on any `requiresAbility` process (zero gated ops ⇒ stamps nothing);
  `work-center` + entityId → jobs with unfinished ops at that WC;
  `location`/`reorder` → company-wide. Stamps
  `scheduleOutdatedReason = reason`, `scheduleOutdatedAt = now` on active
  jobs.
- **`scheduleReplanWaveFunction`** (id `schedule-replan-wave`, retries 1) —
  **debounce `{ key: companyId, period: "3m", timeout: "30m" }`**,
  concurrency `{ limit: 1, key: companyId }` (same lane as user
  reschedules, so one wave = one consistent queue). Loads active jobs with
  `scheduleOutdatedReason IS NOT NULL`, ordered **dueDate asc → priority asc
  → createdAt asc**, capped at `WAVE_BATCH_SIZE = 500` (a remainder chains a
  follow-up event, kind `"reorder"`). One up-front step deletes all live
  reservations for the stale jobs (`scenarioId IS NULL`); then chunks of
  `INVOKE_CHUNK_SIZE = 25` invoke the `schedule` edge function per job
  (`mode: "reschedule"`, `direction: "backward"`, `userId: "system"` — the
  batched provider cache applies, §4.1). After each successful chunk, that
  chunk's stamps are cleared; failed chunks stay stamped for the next wave
  or the nightly sweep.

### 7.3 Nightly net-change backstop

`packages/jobs/src/inngest/functions/scheduled/nightly-replan.ts` (id
`nightly-replan`, retries 2, cron `0 1 * * *`): finds companies that still
have active jobs with `scheduleOutdatedReason` set and emits one
`carbon/schedule.inputs.changed` per company (kind `"location"`, reason
"Nightly replan (net change)") — the wave functions do the actual work. It
never reschedules directly; no unbounded selects or serial loops.

### 7.4 Stale badge

The dates board (`x+/schedule+/dates.tsx` loader →
`get_jobs_by_date_range`) plumbs `scheduleOutdatedReason` into the job card
(`.../Schedule/Kanban/components/JobCard.tsx`): an amber warning icon with
tooltip "Schedule outdated — {reason}", next to the red conflict indicator.
The badge exists only on the dates-board card (not on JobHeader).

Non-goals: what-if scenarios, per-work-center replan modes, DB-trigger
detection (backstopped by the nightly sweep), i18n of DB reason strings.

---

## 8. Schedule timeline / Gantt UI

Shared Gantt components under `apps/erp/app/components/Gantt/`; timeline
builders + detail panel under
`apps/erp/app/modules/production/ui/Schedule/`.

- **Job Gantt** (`apps/erp/app/routes/x+/scheduling+/gantt.tsx`): loader
  lists active jobs, then for the selected job loads operations,
  `capacityReservation` rows, and `productionEvent` rows in parallel;
  resolves display names from `workCenter`, `ability`, `user`, and
  `jobMaterial` (subassembly nesting); `timeline.ts#buildJobTimeline` nests
  operations → reservations → production events. Reservation naming by
  kind: `WorkCenter` → work-center name, `Employee` → `user.fullName`,
  legacy `OperatorPool` → ability name.
- **Resource contention view** (`x+/scheduling+/resources.tsx`): loads
  cross-job `capacityReservation` rows for the company, resolves
  work-center/ability/person names (`Employee` lanes are named people,
  falling back to "Operator"), and renders
  `resourceTimeline.ts#buildResourceTimeline`: one lane per resource,
  reservations as children, lanes ordered by kind rank
  `{ WorkCenter: 0, Employee: 1, OperatorPool: 2 }` then name. Legacy
  OperatorPool lanes render as `"{ability} operators"`.
- **`TimelineDetail.tsx`** switches on `resourceKind` for labels (an
  `Employee` row shows the person). The `earliestStartAt` / `scheduleNote`
  columns let the Gantt draw the wait as a ghost segment from
  `earliestStartAt` to `startAt` with the reason in plain words; the
  `workHours` column lets the panel say "6h of work across 22h" instead of a
  misleading wall-clock duration for gated ops that pause off-shift.
- Local `resourceKind` unions in `timeline.ts` / `resourceTimeline.ts` /
  `TimelineDetail.tsx` include all three kinds; legacy `OperatorPool` rows
  must still render.

---

## 9. Verification

The Deno suite under
`packages/database/supabase/functions/lib/scheduling/` (`deno test
lib/scheduling/`) covers the pure modules with fixtures: calendar expansion
(overnight shifts, DST, empty-pattern 24×7, unions), attended allocation
(relay handoff at shift boundaries, pause with the machine held across the
gap, lights-out remainder overnight, `labor ≥ machine` fully attended, zero
attended hours, one person tending two machines with interleaved attended
windows, cross-ability double-booking, machine-vs-operator wait
attribution, horizon conflicts), machine capacity-1 serialization, blocker
formatting, and dispatch-rule ordering. App-side vitest covers
`timeline.test.ts` / `resourceTimeline.test.ts` (including Employee-kind
rendering). Scoped typecheck: `pnpm exec turbo run typecheck --filter=erp`
(whole-repo typecheck OOMs); lint via Biome.

Live verification runs against the dev stack with **user-triggered**
replans (never mutate the DB directly — propose SQL, let the user run it).
Overlap invariants (each query must return 0 rows):

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

Spot-checks: gated ops hold their operator only for `setup + labor`
(compare an op's Employee segment lengths vs its WorkCenter span); jobs
with small labor times overlap machine-wise across work centers where one
person serves both.

---

## 10. Explicitly not built (superseded or deferred)

Planned at some point on this branch but **absent from the shipped schema
and code** — do not document or rely on these:

- **Resource calendars / work-center shifts**: no `resourceCalendar`,
  `resourceCalendarShift`, `resourceCalendarException`, or
  `workCenterCapacity` tables; no work-center `parallelCapacity` /
  `efficiencyFactor` / `schedulingMode` / `resourceCalendarId` columns and
  no calendar CRUD UI. Machines are capacity-1 and always open; shifts
  apply to people via main's existing `shift` / `employeeShift` tables.
- **Per-operation ability requirements**: no `processAbility`,
  `methodOperationAbility`, or `jobOperationAbility` tables; no Abilities
  multi-select on operation editors; get-method/rework copy nothing
  ability-related (a comment in `get-method` marks the quote path). The
  requirement is purely the operation's process.
- **Proficiency in scheduling**: no `deriveProficiency`, no
  `proficiencyOverride` column, no `minimumProficiency` — qualification is
  binary (the ability's curve/`shadowWeeks` remain training-UI concepts
  only).
- **Skills matrix UI**: replaced by ability-scoped rosters + the person
  abilities panel.
- **`workCenterUtilization` table + capacity-rollup cron**: never shipped;
  no references anywhere. Queue-time inputs exist (`readyAt`,
  `jobOperationQueueTime`), but the rollup/VUT lens does not.
- **Scenario engine**: `capacityReservation.scenarioId` is a nullable
  placeholder; no scenario tables and all reads/writes filter
  `scenarioId IS NULL`.
- **`schedulingPolicy` admin UI**: the table drives engine dispatch order
  but has no ERP surface.
- **OperatorPool reservations**: enum value retained for legacy rows only;
  never written, ignored by the engine, rendered by the timeline for
  leftovers.
