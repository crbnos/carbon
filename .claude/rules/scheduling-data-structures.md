---
paths:
  - "packages/database/supabase/functions/lib/scheduling/**"
  - "apps/erp/app/routes/x+/priority+/**"
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

- **Engine:** `packages/database/supabase/functions/schedule/index.ts` loads a
  **whole LOCATION's** open jobs and runs `new SchedulingEngine(...).run()` once
  per job in one deterministic forward pass (§ Engine pipeline). Modules in
  `packages/database/supabase/functions/lib/scheduling/` (`scheduling-engine.ts`,
  `dependency-manager.ts`, `date-calculator.ts`, `work-center-selector.ts`,
  `apply-work-center-selections.ts`, `priority-calculator.ts`, `material-manager.ts`,
  `duration-calculator.ts`, `assembly-handler.ts`, `master-data-provider.ts`,
  `machine-availability.ts`, `calendar-utils.ts`, `slot-allocator.ts`,
  `conflict-messages.ts`, `types.ts`). All engine READS go
  through the `MasterDataProvider` interface (`KyselyMasterDataProvider` is the
  live impl); writes stay on Kysely. The people reads (`getPeopleAssignments`/`getPeopleAbsences`)
  take the plant `timeZone` so `peopleAssignment.date` range bounds resolve on the
  plant's calendar, not UTC's. `resource-manager.ts` was dead code and
  has been deleted. `machine-availability.ts` / `calendar-utils.ts` /
  `slot-allocator.ts` / `apply-work-center-selections.ts` / `duration-calculator.ts` /
  `date-utils.ts` / `operator-eligibility.ts` / `people-utils.ts` are pure and have Deno
  tests (`deno test lib/scheduling/` from the functions dir), alongside the
  determinism + envelope suites. `date-utils.toIsoDate`
  normalizes pg DATE columns (JS Date at local midnight) to "YYYY-MM-DD" —
  required before any lexicographic date comparison (operator expiry).
- **ERP authoring boards** (`apps/erp/app/routes/x+/priority+/`): `operations.tsx`
  (ops Kanban; drag → `operations.update.tsx` writes `jobOperation.workCenterId` +
  `priority`, no reschedule — the board header carries a tooltip: *"Reorders dispatch
  sequence and work center only — does not reschedule. Change dates on the Dates board."*)
  and `dates.tsx` (jobs-by-due-date Kanban; drag →
  `dates.update.tsx` writes `job.dueDate` + `priority`, **then calls
  `notifyScheduleInputsChanged(companyId, "reorder", …)`** — which only stamps the
  jobs schedule-outdated; the debounced wave regenerates the whole location. There
  is no immediate single-job path). `people.tsx` is the People
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

Rescheduling is **no longer a single-job event** — the old per-job reschedule
trigger, its Inngest task, and the direct-trigger service helpers were all removed.
Every scheduling input change now funnels through one thin emitter,
`notifyScheduleInputsChanged(companyId, kind, reason, entityId?)`
(`production.service.ts`) → `trigger("schedule-inputs-changed", …)` → Inngest event
`carbon/schedule.inputs.changed`. `kind` ∈
`ability | shift | employee-shift | work-center | location | reorder | people`.

Two Inngest functions listen on that event
(`packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts`):

- **MARK** (`markScheduleStaleFunction`, immediate, concurrency 1 per company):
  stamps the affected jobs' `scheduleOutdatedReason` / `scheduleOutdatedAt` (scoped
  per kind — a qualification change in a shop with no gated ops stamps nothing;
  `location` / `reorder` stamp company-wide). Recomputes nothing.
- **WAVE** (`scheduleReplanWaveFunction`, **debounce 30s / timeout 10m**,
  concurrency 1 per company): loads the company's stale jobs, groups them by
  **LOCATION**, and calls `serviceRole.functions.invoke("schedule", { locationId,
  companyId, userId: "system" })` **once per location** — a whole-location regen.
  Each engine run clears its own job's stale stamp (no wave-side flag-clearing).
  There is no pre-clear-reservations step, no batch slicing/chunking, and no
  chain-next-wave continuation. After the regens the wave sends one digest
  `carbon/notify` (`NotificationEvent.JobsProjectedLate`, `documentIds` = the
  newly-late job ids) **per assignee**; unassigned newly-late jobs are skipped in v1.

`nightly-replan.ts` (cron `0 1 * * *`) is the time-passing backstop: it finds
companies that still have schedule-outdated jobs and emits one
`carbon/schedule.inputs.changed` (`kind: "reorder"`, `continuation: true`) per
company; the wave fans that out to the affected locations.

Other direct `invoke("schedule", { locationId, companyId, userId })` callers all
use the whole-location payload: `recalculateJobOperationDependencies`
(`production.service.ts`, resolves the job's `locationId` first), `recalculate.ts`,
`kanban.$id.tsx`, and `job/$jobId.status.tsx`. A `functions/reschedule/` dir exists
but is legacy — the live invoke target is always `"schedule"`.

## Engine pipeline (`scheduling-engine.ts` `run()`)

`initialize → assignMaterials → createDependencies → calculateDates →
selectWorkCenters → calculatePriorities → persistChanges` (the last is skipped when
`persist: false`, i.e. the expedite what-if). **There is no backward JIT pass and no
`initial`/`reschedule` mode split** — everything schedules FORWARD-ASAP, and the
projected finish IS the overdue forecast (slack is real).

- **Whole-location, deterministic run** (`schedule/index.ts`): one `now` is captured
  once and shared across every job in the batch. The location's open jobs
  (`Ready | In Progress | Paused`) are ordered **deadline class first**
  (`DEADLINE_PRIORITY`: ASAP → Hard Deadline → Soft Deadline → No Deadline), then
  `dueDate ASC NULLS LAST → job.priority ASC → createdAt ASC` — so a no-due-date ASAP
  order claims capacity first. Each job's engine run **excludes the jobs not yet run
  (itself + later)** from the reservation snapshot, so it sees non-batch reservations
  plus the just-persisted placements of already-run jobs → sequential capacity
  claiming, no pre-clear step.
- **Sequencing** (`dependency-manager.ts`): the `jobOperation."operationOrder"` enum
  (`methodOperationOrder` = `'After Previous' | 'With Previous'`) decides serial vs
  parallel, plus assembly edges (a sub-make-method's last op feeds the parent's
  consuming op); dependency-free ops are stamped **operation-status** `Ready`. That is
  operation-level status only — the engine is **status-neutral for JOB status** and
  never flips a job to Ready (release is the app's job-status flow).
- **Dates** (`date-calculator.ts` → `buildScheduledOperations`): now just durations +
  pins — `startDate`/`dueDate` start null (a pinned/`manuallyScheduled` op keeps its
  stored dates), and forward-ASAP placement fills them. Duration =
  `setup + max(labor, machine)`.
- **Finite placement** (`work-center-selector.ts`): ops are placed in a **deterministic
  topological order** (`topologicalPlacementOrder`, Kahn's algorithm over the dependency
  edges; the ready set is ordered by `jobOperation."order"` then id). Each op is placed
  forward from `max(now, placed-dependency-ends)` — **no backward-pass floor** — into the
  first feasible span. Two finite resources gate it: the work center (capacity 1 — one op
  at a time, decided by actual `capacityReservation` intervals) AND, for ability-gated
  processes, ≥1 qualified employee on shift and unreserved. **Work-center selection is
  sticky**: an op keeps its `workCenterId` when that work center is in the capacity set;
  an op with no work center (or whose WC has no capacity data, e.g. deactivated) gets
  earliest-finish selection among its process candidates. A placement past the job's
  `dueDate` sets `hasConflict`/`conflictReason` but keeps the placement.
- **Machine availability windows** come from the ladder resolved per work center in
  `machine-availability.ts` (`resolveWorkCenterWindows`) — the provider's
  `getWorkCenterAvailability` does the reads and `buildFiniteContext` sets each WC's
  `windows`: (1) `workCenter.alwaysOn` = one continuous 24×7 window (lights-out);
  (2) explicit `workCenterShift` rows; (3) the union of the work center's LOCATION's
  `shift` rows; (4) the stock Mon–Fri 08:00–16:00 (8h) week in the location tz
  (`STOCK_WEEK_SHIFTS` in `calendar-utils.ts`). **Machine downtime is subtracted**
  (`calendar-utils.subtractIntervals`) from those windows, derived from open maintenance
  dispatches flagged `maintenanceDispatch.takesWorkCenterOffline` (status not
  Completed/Cancelled; outage `[actualStartTime ?? plannedStartTime ?? createdAt,
  actualEndTime ?? plannedEndTime ?? horizon)` on the dispatch's `workCenterId` + its
  `maintenanceDispatchWorkCenter` rows) — no separate downtime table; completing the
  dispatch restores the hours at the next regen. People with no `employeeShift` rows now
  default to the job LOCATION's calendar (rung 3/4 via `getLocationCalendarWindows`),
  not 24×7.
- **Attended-window labor model is UNCHANGED** (`slot-allocator.ts`): ability gating,
  manning-board / team mode, attended windows, wait attribution, absence subtraction
  (`peopleAbsence`), overtime extension (`peopleAssignment.overtimeHours`), split-day
  budgets (`peopleAssignment.hours`), and manual pins behave exactly as before — a team
  still runs one op at a time with labor parallelized across present members, setup and
  machine time never compressed. Machine calendars only *refine* the model: member
  windows are clipped to the machine windows via `intersectWindows`, and the unattended
  remainder accumulates on the machine windows via `addWorkingTime`. A blank people board
  is byte-identical to pre-people behavior.
- **Remaining-work netting** (`duration-calculator.remainingFractions`): a started op
  reserves only the work left — labor + machine scaled by
  `(1 − quantityComplete/operationQuantity)` (clamped ≥ 0), setup counted done once any
  `productionEvent` exists on the op — anchored at `now`.
- **Priority** = per-work-center dispatch sequence number (`priority-calculator.ts`): ops
  grouped by `workCenterId`, sorted by **placed start date ascending** (nulls last),
  tie-broken by `job.priority` then deadline type, then numbered 1, 2, 3…. The dispatch
  sequence IS the forward-ASAP placement order — one source of truth for what runs next.
  Boards sort by `priority` ascending. (Job-level `job.priority` is a separate fractional
  index set at job creation by `calculateJobPriority`.) There is **no configurable
  dispatch-sequencing policy** — the old per-work-center policy table, its rule enum,
  and the FIFO/EDD/SPT/… comparators were all removed; placement order is the only
  sequence.
- **`persistChanges` (one transaction, only when `persist`)** writes each op's
  `startDate`/`dueDate` (`dueDate` omitted for pinned ops) + `priority` + `workCenterId` +
  conflict flags; rebuilds this job's `capacityReservation` rows (delete-by-job where
  `scenarioId IS NULL`, then bulk insert — a materialized OUTPUT, `WorkCenter`/`Employee`
  kinds); and writes `job.projectedCompletionAt` (= the max placed end, the forecast
  finish) while clearing `scheduleOutdatedReason`/`scheduleOutdatedAt` for that job. It
  also computes the **newly-late** flag (was on-time-or-unforecast before, now projected
  past `dueDate` on the location calendar) for the wave's digest.
- **Expedite what-if** (`expediteJobId`): runs only the target job first with the WHOLE
  batch excluded from the snapshot (it claims capacity as if first), `persist: false`,
  and returns `{ projectedCompletionAt, cause }` without touching the database.

## Manual scheduling

`jobOperation."manuallyScheduled" BOOLEAN NOT NULL DEFAULT false`
(`20260525143721_manual-scheduling.sql` — adds only this column). In
`persistChanges()`: when true, the engine writes `startDate, priority, workCenterId,
hasConflict, conflictReason` but **deliberately omits `dueDate`** — preserving the
user's pinned due date across regens. `buildScheduledOperations` (`date-calculator.ts`)
keeps a pinned op's stored `startDate`/`dueDate` (non-pinned ops start null); forward-ASAP
placement then reserves and schedules around the pinned window.

## Conflict detection

`jobOperation."hasConflict" BOOLEAN DEFAULT false` + `"conflictReason" TEXT`
(`20251123000001_job-operation-conflicts.sql`, plus index
`idx_job_operation_wc_priority` on `("workCenterId","priority","status")`). With no
backward pass, conflicts come only from forward-ASAP finite placement: **no feasible
slot** (machine capacity exhaustion, a work center with no resolved availability
windows, missing/expired operator qualification, or calendar exhaustion —
`conflictReason` names the cause), or a placement that **finishes after the job's
`dueDate`** (the overdue verdict; `jobDueDate` is passed into the selector). Conflicts
surface; scheduling never hard-fails. The read RPCs roll it up per job with
`BOOL_OR(...)` so the board shows a red flag.

## Read RPCs (display only; do not compute schedules)

### `get_active_job_operations_by_location(location_id, work_center_ids[])`
Newest: `20260720121629_capacity-planning.sql` (main's definition + `hasConflict` +
`conflictReason` output columns; prior revisions `20260531084723_rework-serial-flow.sql`
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
Newest: `20260720121629_capacity-planning.sql` (PL/pgSQL `RETURNS TABLE`,
**not a view**). TS wrapper `getJobsByDateRange` in
`apps/erp/app/modules/production/production.service.ts`, consumed by
`apps/erp/app/routes/x+/priority+/dates.tsx` loader. Filters jobs with non-null `dueDate`
in range and `status != 'Cancelled'`, ordered by `dueDate`. Returns **27 cols**:
`id, jobId, status, dueDate, completedDate, deadlineType, customerId, customerName,
salesOrderReadableId, salesOrderId, salesOrderLineId, itemId, itemReadableId,
itemDescription, quantity, quantityComplete, quantityShipped, priority, assignee, tags,
thumbnailPath, operationCount, completedOperationCount, hasConflict, jobMakeMethodId,
scheduleOutdatedReason, projectedCompletionAt` — the last two are new in the
capacity-planning migration and drive the dates board's forecast/stale surfaces.

<!-- The capacity-planning migration added scheduleOutdatedReason + projectedCompletionAt
     (25 → 27 cols). The sibling `get_unscheduled_jobs` / `getUnscheduledJobs` was NOT
     touched (newest def `20251213015327_schedule-fixed.sql`), so it does NOT carry those
     two columns. quantityComplete/operationCount/completedOperationCount/hasConflict
     count ONLY the parent make method's operations (jobMakeMethod.parentMaterialId IS
     NULL), not all job operations. -->

## Key types / enums

- `methodOperationOrder`: `'After Previous' | 'With Previous'` (`20240619095417_methods.sql`).
- `jobOperationStatus`: `Canceled | Done | In Progress | Paused | Ready | Todo | Waiting`.
- `deadlineType`: `No Deadline | ASAP | Soft Deadline | Hard Deadline`.
- Engine types (`functions/lib/scheduling/types.ts`): `enum SchedulingStrategy
  { PriorityLeastTime, LeastTime, Random }`. The `SchedulingDirection` /
  `SchedulingMode` types and the `initial`/`reschedule`/`backward`/`forward` plumbing
  are **deleted** — one uniform forward-ASAP rule.
- ERP scheduling zod validators (`apps/erp/app/modules/production/production.models.ts`):
  `scheduleOperationUpdateValidator`, `scheduleJobUpdateValidator`.

## Gotchas

- The engine is **forward-ASAP only** — no backward pass, no Infinite mode.
  Every work center is finite (one op at a time) with **real operating hours**
  from the machine-availability ladder (`workCenterShift` → the location's shifts
  → stock Mon–Fri 8h, or `alwaysOn` = 24×7), minus maintenance-dispatch downtime.
  Qualified people's shifts only additionally gate ability-gated ops. The old
  "no work-center calendar / availability comes from people's shifts" claim is
  **wrong** now. Manually scheduled ops are not reallocated — their existing
  window is reserved as-is.
- `jobOperation."order"` (topo position) vs `"operationOrder"` (serial/parallel enum) are
  distinct columns — easy to confuse; the RPC surfaces them as `operationOrder` and
  `operationOrderType` respectively.
- There is **no `scheduleStatus` enum/column** and no `scheduledStart`/`estimatedEnd`
  columns — computed dates go into `jobOperation.startDate` / `dueDate`; the job-level
  forecast finish is `job.projectedCompletionAt`.
- Editing the ERP ops board (`operations.update.tsx`) does NOT re-run the engine and does
  not even notify — it only re-sequences `workCenterId` + `priority`. The dates board
  notifies (`notifyScheduleInputsChanged`), and the debounced wave regenerates the whole
  location. The MES board is display/drag-only.
