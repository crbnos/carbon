---
paths:
  - "packages/database/supabase/functions/lib/scheduling/**"
  - "apps/erp/app/routes/x+/schedule+/**"
  - "apps/mes/app/routes/x+/operations.tsx"
  - "packages/database/supabase/migrations/*schedul*.sql"
---

# Production Scheduling: data structures + flow

How job operations get sequenced onto work centers, scheduled with dates, and
displayed. The **actual scheduling computation runs in a Supabase Deno edge
function (`schedule`)** — not in MES, not in a DB function. The boards only read
results and feed inputs. Migrations are timestamp-ordered; **newest wins** and
these functions/columns have been revised many times — read the newest, not the
first match.

## Where it lives

- **Engine:** `packages/database/supabase/functions/schedule/index.ts` →
  `new SchedulingEngine(...).run()`. Modules in
  `packages/database/supabase/functions/lib/scheduling/` (`scheduling-engine.ts`,
  `dependency-manager.ts`, `date-calculator.ts`, `work-center-selector.ts`,
  `priority-calculator.ts`, `material-manager.ts`, `duration-calculator.ts`,
  `assembly-handler.ts`, `master-data-provider.ts`, `calendar-utils.ts`,
  `slot-allocator.ts`, `types.ts`). All engine READS go
  through the `MasterDataProvider` interface (`KyselyMasterDataProvider` is the
  live impl); writes stay on Kysely. The people reads (`getPeopleAssignments`/`getPeopleAbsences`)
  take the plant `timeZone` so `peopleAssignment.date` range bounds resolve on the
  plant's calendar, not UTC's. `resource-manager.ts` was dead code and
  has been deleted. `calendar-utils.ts` / `slot-allocator.ts` /
  `date-utils.ts` / `operator-eligibility.ts` / `people-utils.ts` are pure and have Deno tests
  (`deno test lib/scheduling/` from the functions dir). `date-utils.toIsoDate`
  normalizes pg DATE columns (JS Date at local midnight) to "YYYY-MM-DD" —
  required before any lexicographic date comparison (operator expiry).
- **ERP authoring boards** (`apps/erp/app/routes/x+/schedule+/`): `operations.tsx`
  (ops Kanban; drag → `operations.update.tsx` writes `jobOperation.workCenterId` +
  `priority`, no reschedule — the board header carries a tooltip: *"Reorders dispatch
  sequence and work center only — does not reschedule. Change dates on the Dates board."*;
  only the Dates board calls `triggerJobSchedule`) and `dates.tsx` (jobs-by-due-date Kanban; drag →
  `dates.update.tsx` writes `job.dueDate` + `priority`, **then calls
  `triggerJobSchedule(...)`** to re-run the engine). `people.tsx` is the People
  page with a segmented view switcher (`?view=`): the People **board** (manning
  board: drag employees onto work-center columns per date; Unassigned column
  is `position: sticky` — needs `min-w-max` on the shared `BoardContainer`
  row and `MeasuringStrategy.Always` on the DndContext; mutations via
  `people.update.tsx`, which fires
  `notifyScheduleInputsChanged(companyId, "people", ..., workCenterId)`), a
  week **matrix** (`PeopleMatrix.tsx`: employee×day grid + assigned-vs-needed
  coverage as sub-tabs, department filter), and a week **capacity** board
  (`PeopleCapacity.tsx`). Capacity math: Demand = open `jobOperation` hours by
  due date via `makeDurations` (Draft/Planned jobs excluded — released work
  only; ops overdue up to 28 days land in a Past-due column); Scheduled =
  `capacityReservation.workHours` distributed across each reservation's span
  per day; Available = people headcount × real shift hours resolved through
  the ladder assignment `shiftId` → the person's `employeeShift` →
  most-common shift duration at the location → 8h (unassigned stations fall
  back to the location's per-weekday shift calendar); Load renders as hours
  over/free (+Xh / Xh free), not %. Shift + location filters live in header
  popovers; the shift filter's "All shifts" option (`shiftId` null on
  drag) creates shift-less assignments that resolve hours via the ladder.
  The Board has Day | Week period tabs — Week renders `PeopleWeekBoard`
  (drag once = assigned all week via `assign-week`/`unassign-week`/`move-week`
  → `assignPeopleWeek` etc., one row per working day from the shift's weekday
  flags; matrix/capacity are week-only, no month range — removed on
  request). Header also has a Calendar date-jump popover (Calendar is
  exported from @carbon/react for this), copy previous day/week
  (`copy`/`copy-week` — day copy preserves split `hours`, overtime never
  copies), and a "Time off" range dialog
  (`absent-range` → `setPeopleAbsenceRange`). The route delegates its pieces to
  `ui/Schedule/People/`: `PeopleHeader` (filters/tabs/date nav/copy/menu),
  `OvertimeDialog` + `TimeOffDialog` (conditionally mounted), `PeopleCard` +
  `PeopleColumn` (extracted from `PeopleBoard`), with the shift-hours/time ladders
  shared via `peopleShared.ts`; the Capacity view's demand/scheduled buckets are
  computed server-side by `buildPeopleCapacityBuckets`
  (`modules/production/peopleCapacity.server.ts`).
- **MES display** (`apps/mes/app/routes/x+/operations.tsx`): the "Schedule" page is
  a **Kanban** (columns = work centers, cards = operations sorted by `priority`),
  not a Gantt. Read-only re display; operators execute via `operation.$operationId.tsx`.
  `apps/erp/app/routes/x+/scheduling+/gantt.tsx` is a placeholder Gantt with
  hard-coded sample `trace` data in its loader — not wired to the engine.
  MES `dispatch.*.tsx` routes are **maintenance dispatch** (machine breakdowns), unrelated.

## Trigger chain (verified)

`dates.update.tsx` → `triggerJobSchedule()` (`production.service.ts`) → Inngest event
`carbon/reschedule-job` → `packages/jobs/src/inngest/functions/tasks/reschedule-job.ts`
→ `serviceRole.functions.invoke("schedule", { jobId, companyId, userId, mode, direction })`.
(`recalculate.ts` also invokes `"schedule"`. A `functions/reschedule/` dir exists but the
live invoke target is always `"schedule"` — treat `reschedule/` as legacy.)

## Engine pipeline (`scheduling-engine.ts` `run()`)

`initialize → assignMaterials → createDependencies → calculateDates →
selectWorkCenters → calculatePriorities → persistChanges`.

- **Sequencing** (`dependency-manager.ts`): ops sorted by numeric `jobOperation."order"`.
  The `jobOperation."operationOrder"` enum (`methodOperationOrder` =
  `'After Previous' | 'With Previous'`, default `'After Previous'`) decides serial vs
  parallel — `With Previous` copies the predecessor's start/due dates (parallel);
  `After Previous` chains sequentially. Plus assembly edges (a sub-make-method's last
  op feeds the parent's consuming op). Final order = topological sort.
- **Dates, pass 1** = infinite-capacity backward scheduling (`date-calculator.ts`): anchor on
  `job.dueDate`, walk reverse-topo, each op `dueDate` = min dependent constraint − lead
  time, `startDate` = `dueDate` − duration in **business days** (`subtractBusinessDays`,
  skips weekends). Duration = `setup + max(labor, machine)`, ceil to 8-hour days.
- **Dates, pass 2 (finite placement)** — `selectWorkCenters` builds a
  `FiniteSchedulingContext` (live `capacityReservation` rows excluding this
  job, per-process ability requirements via `process.requiresAbility` +
  `ability.processId`, qualified employees with their shift windows from
  `employeeShift` ⋈ `shift` — no shift assignment = always available) and,
  per op, walks **forward** from max(backward start, now, in-run predecessor
  finish) to the first feasible interval. Two finite resources gate the
  placement: the work center itself (capacity 1 — one op at a time, decided
  by actual `capacityReservation` intervals, no concurrency knob) AND, for
  ability-gated processes, ≥1 qualified employee on shift and unreserved
  (`slot-allocator.ts`; the accumulation windows for gated ops are the union
  of the pool members' shift windows, so work pauses while nobody qualified
  is on shift; ungated ops need only the machine). **People assignments**
  (the manning board: `peopleAssignment` / `peopleAbsence` tables) also feed the
  context (`peopleByWorkCenter` + `windowsByEmployee`, built in
  `buildFiniteContext` via `getPeopleAssignments`/`getPeopleAbsences`). A assigned
  station works as a TEAM (`allocateAttendedOperation`'s `team` option →
  `simulateAttendedTeam` in `slot-allocator.ts`): still one op at a time,
  but every people member present is booked on that op together — labor
  accumulates at n× wall-clock (n = people present in the stretch; rate drops
  when someone leaves), setup accumulates at 1×, and machine time is never
  compressed (unattended remainder = machineHours − labor wall-clock run
  concurrently). Gated ops team-book people∩qualified with windows clipped to
  their assigned dates (`clipWindowsToDates`); pass 2 falls back softly to
  the full qualified pool in classic single-person relay mode. Ungated ops
  at a assigned station are manned the same way with machine-only fallback.
  Absences subtract the person's windows for that date everywhere
  (`subtractAbsences`). Authorized overtime (`peopleAssignment.overtimeHours`)
  extends the person's last window on that date (`extendWindowsByOvertime`),
  and split days (`peopleAssignment.hours`, several stations per shift) deal
  the person's attended day out sequentially per station
  (`buildPeopleBudgets` + `clipWindowsToStation` — a sole whole-shift row is
  byte-identical to the old `clipWindowsToDates`). A blank board is byte-identical to pre-people
  behavior (single-member team mode ≡ legacy relay). The allocator attributes
  each wait to its binding resource (machine queue vs operator pool vs the
  assigned people — `people-wait` cause) for the
  schedule note / conflict message. Picks the earliest-finish
  candidate (tie → least reserved). Placement overwrites `startDate`/`dueDate`;
  placements past the backward due date set `hasConflict`/`conflictReason`
  but keep the placement. In `mode: "reschedule"` selection is **sticky**: an
  op with an assigned `workCenterId` keeps it (`ctx.stickyWorkCenters`); free
  selection happens only at `mode: "initial"` or via the ops board drag.
  Reservations persist to `capacityReservation` (delete-by-job + bulk insert
  per run, `scenarioId IS NULL` = live plan).
- **Priority** = per-work-center dispatch sequence number (`priority-calculator.ts`): ops
  grouped by `workCenterId`, sorted by the work center's **dispatch rule**
  (`schedulingPolicy`: per-WC row → company default row → `EDD`; rules
  FIFO/EDD/SPT/WSPT/CR/MinSlack) with the legacy chain (start date → job
  priority → deadline type) as tie-break, then numbered 1, 2, 3…. Boards sort
  by `priority` ascending. (Job-level `job.priority` is a separate fractional
  index set at job creation by `calculateJobPriority`.)

## Manual scheduling

`jobOperation."manuallyScheduled" BOOLEAN NOT NULL DEFAULT false`
(`20260525143721_manual-scheduling.sql` — adds only this column). In
`persistChanges()`: when true, the engine writes `startDate, priority, workCenterId,
hasConflict, conflictReason` but **deliberately omits `dueDate`** — preserving the
user's pinned due date across reschedules. `date-calculator.ts` derives only the start
date from the pinned due date in that case.

## Conflict detection

`jobOperation."hasConflict" BOOLEAN DEFAULT false` + `"conflictReason" TEXT`
(`20251123000001_job-operation-conflicts.sql`, plus index
`idx_job_operation_wc_priority` on `("workCenterId","priority","status")`). Two
sources now: (1) pass-1 date calc — computed start date in the past
(`startDate < today` in `date-calculator.ts`); (2) finite placement — no
feasible slot (machine capacity, missing/expired operator qualification, or
calendar exhaustion — `conflictReason` names the cause), or a placement that
finishes after the backward-computed due date. Conflicts surface; scheduling
never hard-fails. The read RPCs roll it up per job with `BOOL_OR(...)` so the
board shows a red flag.

## Read RPCs (display only; do not compute schedules)

### `get_active_job_operations_by_location(location_id, work_center_ids[])`
Newest: `20260707143131_operation-conflicts-in-schedule-rpc.sql` (adds
`hasConflict` + `conflictReason`; prior revisions `20260531084723_rework-serial-flow.sql`
added `quantityReworked`/`reworkId`, `20260304000000` added `operationDueDate`).
TS wrappers (identical): `apps/mes/app/services/operations.service.ts`
`getActiveJobOperationsByLocation` and
`apps/erp/app/modules/production/production.service.ts`. Returns 40 cols incl.:
`id, jobId, jobMakeMethodId, operationOrder` (← `jo."order"`)`, priority, processId,
workCenterId, description, setup/labor/machineTime+Unit, operationOrderType` (←
`jo."operationOrder"`, serial/parallel enum)`, jobReadableId, jobStatus, jobDueDate,
jobDeadlineType, jobCustomerId, customerName, parentMaterialId, itemReadableId,
itemDescription, operationStatus` (`'Paused'` if job paused)`, targetQuantity,
operationQuantity, quantityComplete, quantityReworked, quantityScrapped,
salesOrderId/LineId/ReadableId, assignee, tags, thumbnailPath, operationDueDate,
reworkId, hasConflict` (COALESCEd, never null)`, conflictReason`. The ERP ops board
(`schedule+/operations.tsx` → `ItemCard`) and MES schedule loader map
`hasConflict`/`conflictReason` onto Kanban items (red border + triangle tooltip on
the ERP card).

<!-- The old cache said customerName is NOT returned (must join) — WRONG now.
     customerName (← customer.name LEFT JOIN) was added 20251123000000, plus
     operationDueDate, targetQuantity, salesOrder*, thumbnailPath, jobMakeMethodId. -->

### `get_jobs_by_date_range(location_id, start_date, end_date)`
Newest: `20260119140000_schedule-quantity-from-parent-only.sql` (PL/pgSQL `RETURNS TABLE`,
**not a view**). TS wrapper `getJobsByDateRange` in
`apps/erp/app/modules/production/production.service.ts`, consumed by
`apps/erp/app/routes/x+/schedule+/dates.tsx` loader. Sibling `get_unscheduled_jobs` /
`getUnscheduledJobs` shares the column list. Filters jobs with non-null `dueDate` in
range and `status != 'Cancelled'`, ordered by `dueDate`. Returns 25 cols:
`id, jobId, status, dueDate, completedDate, deadlineType, customerId, customerName,
salesOrderReadableId, salesOrderId, salesOrderLineId, itemId, itemReadableId,
itemDescription, quantity, quantityComplete, quantityShipped, priority, assignee, tags,
thumbnailPath, operationCount, completedOperationCount, hasConflict, jobMakeMethodId`.

<!-- Old cache listed 23 cols and missed hasConflict + jobMakeMethodId (added
     20251212234857). Also: quantityComplete/operationCount/completedOperationCount/
     hasConflict now count ONLY the parent make method's operations
     (jobMakeMethod.parentMaterialId IS NULL), not all job operations. -->

## Key types / enums

- `methodOperationOrder`: `'After Previous' | 'With Previous'` (`20240619095417_methods.sql`).
- `jobOperationStatus`: `Canceled | Done | In Progress | Paused | Ready | Todo | Waiting`.
- `deadlineType`: `No Deadline | ASAP | Soft Deadline | Hard Deadline`.
- Engine types (`functions/lib/scheduling/types.ts`): `SchedulingDirection =
  "backward" | "forward"`, `SchedulingMode = "initial" | "reschedule"`,
  `enum SchedulingStrategy { PriorityLeastTime, LeastTime, Random }`.
- ERP scheduling zod validators (`apps/erp/app/modules/production/production.models.ts`):
  `scheduleOperationUpdateValidator`, `scheduleJobUpdateValidator`.

## Gotchas

- The engine backward-computes target dates, then **finite forward placement**
  decides actual timing. Every work center is finite (one op at a time);
  there is no Infinite mode and no work-center calendar — availability
  constraints come from qualified people's shifts. Manually scheduled ops are
  not reallocated — their existing window is reserved as-is.
- `jobOperation."order"` (topo position) vs `"operationOrder"` (serial/parallel enum) are
  distinct columns — easy to confuse; the RPC surfaces them as `operationOrder` and
  `operationOrderType` respectively.
- There is **no `scheduleStatus` enum/column** and no `scheduledStart`/`estimatedEnd`
  columns — computed dates go into `jobOperation.startDate` / `dueDate`.
- Editing the ERP ops board (`operations.update.tsx`) does NOT re-run the engine; only the
  dates board does (`triggerJobSchedule`). The MES board is display/drag-only.
