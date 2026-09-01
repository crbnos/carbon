---
paths:
  - "packages/ee/src/planning/scheduling/**"
  - "apps/erp/app/routes/x+/priority+/**"
  - "apps/mes/app/routes/x+/operations.tsx"
  - "packages/database/supabase/migrations/*schedul*.sql"
---

# Production Scheduling: data structures + flow

How job operations get sequenced onto work centers, scheduled with dates, and
displayed. The scheduling engine lives in
`packages/ee/src/planning/scheduling/` (relocated from the Supabase edge runtime)
and runs **IN-PROCESS in Node** — the ERP app (route actions,
`production.service.ts`) and `@carbon/jobs` (the replan wave, the recalculate
task) import `runLocationSchedule` / `runExpediteWhatIf` from
**`@carbon/ee/planning`** and execute it in-process, eliminating the edge
cold-start + HTTP round-trip that made a regen take >2s on trivial data. The
`schedule` Deno **edge function** was **DELETED** — there is no remaining edge
wrapper; every caller goes through the in-process engine. Not MES,
not a DB function. The boards only read results and feed inputs. Migrations are
timestamp-ordered; **newest wins** and these functions/columns have been revised
many times — read the newest, not the first match.

Spec/plan: `.ai/specs/2026-08-19-schedule-in-process-node.md` +
`.ai/plans/2026-08-19-schedule-in-process-node.md`.

## Where it lives

- **Orchestration:** `packages/ee/src/planning/scheduling/run-schedule.ts`
  (`runLocationSchedule` / `runExpediteWhatIf`) loads a **whole LOCATION's** open
  jobs and runs `new SchedulingEngine(...).run()` once per job in one
  deterministic forward pass (§ Engine pipeline). Every Node caller goes through
  it — one orchestration, zero drift. It is exported via
  `@carbon/ee/planning`; its shared edge-lib deps are reached through the
  `@carbon/database` subpath barrels (types → `@carbon/database`, postgres →
  `@carbon/database/client`). Modules in
  `packages/ee/src/planning/scheduling/` (`scheduling-engine.ts`,
  `dependency-manager.ts`, `date-calculator.ts`, `need-by-calculator.ts`,
  `work-center-selector.ts`,
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
  `date-utils.ts` / `operator-eligibility.ts` / `people-utils.ts` /
  `need-by-calculator.ts` are pure and have unit
  tests (`pnpm --filter @carbon/ee test`, vitest — colocated `*.test.ts`),
  alongside the determinism + envelope suites. `date-utils.toIsoDate`
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
  `notifyScheduleInputsChanged(companyId, "people", ..., workCenterId)` — a MOVE
  notifies BOTH the destination and the source work center (via
  `movePeopleAssignment`'s `previousWorkCenterId`), so the station the person left
  re-plans too instead of keeping a stale booking), a
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
  **LOCATION**, and calls `runLocationSchedule({ db: getJobDatabaseClient(),
  client: serviceRole, locationId, companyId, userId: "system" })` IN-PROCESS
  **once per location** — a whole-location regen (was
  `serviceRole.functions.invoke("schedule", …)`).
  Each engine run clears its own job's stale stamp (no wave-side flag-clearing).
  There is no pre-clear-reservations step, no batch slicing/chunking, and no
  chain-next-wave continuation. After the regens the wave sends one digest
  `carbon/notify` (`NotificationEvent.JobsProjectedLate`, `documentIds` = the
  newly-late job ids) **per assignee**; unassigned newly-late jobs are skipped in v1.

`nightly-replan.ts` (cron `0 1 * * *`) is the time-passing backstop, and it now
handles TWO staleness classes: (1) jobs still stamped schedule-outdated (the event
path dropped them), AND (2) **aged schedules** — a `stamp-aged-schedules` step
stamps any active job whose earliest open op `startDate` is before today (UTC-day
threshold), because a forward plan anchored to an earlier day's `now` keeps
DISPLAYING a past start until it re-anchors (placement itself always floors at
`now` — it never schedules in the past). Both are then drained the same way: one
`carbon/schedule.inputs.changed` (`kind: "reorder"`, `continuation: true`) per
company; the wave fans that out to the affected locations. NOTE: in local dev the
Inngest worker (`pnpm --filter @carbon/jobs dev:jobs`) must be running or none of
the reactive/nightly replan fires — a common cause of "my schedule went stale" /
"my `requiresAbility` change didn't reschedule" locally (the change IS wired:
`processes.$processId.tsx` fires `notifyScheduleInputsChanged("ability", …, abilityId)`
on any `requiresAbility` flip, and the MARK function scopes to that ability's
process ops).

**Terminal-job reservation cleanup** (`20260819050906_cleanup-reservations-on-terminal-job.sql`):
an `AFTER UPDATE OF status ON "job"` trigger (`delete_capacity_reservations_on_terminal_job`,
SECURITY DEFINER) deletes a job's live (`scenarioId IS NULL`) `capacityReservation`
rows when it transitions to `Cancelled`/`Completed`/`Closed`. Reservations are a
materialized output for active jobs only; before this, a cancelled/completed job's
rows lingered as orphans (invisible to the forecast/capacity reads, which filter
terminal jobs, but resurfacing as past-dated bars for any read that forgot the
filter). The trigger is the one chokepoint every terminal path funnels through
(the status route's `updateJobStatus`, and `complete_job_to_inventory` for
Completed); SECURITY DEFINER because a cancel only holds `production_update` while
the DELETE policy needs `production_delete`.

Other whole-location regen callers now run `runLocationSchedule(...)` IN-PROCESS
(no edge invoke): `recalculateJobOperationDependencies` (`production.service.ts`,
resolves the job's `locationId` first — it dynamic-imports `@carbon/ee/planning`
+ `@carbon/database/client` (via `getSchedulingDb`) and uses a lazy Node pool, because
`production.service.ts` is also client-bundled and must not STATICALLY pull `pg`/`.server`
code), `recalculate.ts`, `kanban.$id.tsx`, and `job/$jobId.status.tsx` (the last two are
route actions, which CAN import `@carbon/ee/planning` + `~/services/database.server`
directly since React Router strips their server code from the client bundle). The
expedite what-if uses `runExpediteWhatIf`. A `functions/reschedule/` dir exists but
is legacy.

## Engine pipeline (`scheduling-engine.ts` `run()`)

`initialize → assignMaterials → createDependencies → calculateDates →
computeNeedBys → selectWorkCenters → calculatePriorities → persistChanges` (the last
is skipped when `persist: false`, i.e. the expedite what-if). **There is no backward
JIT pass in PLACEMENT and no `initial`/`reschedule` mode split** — everything places
FORWARD-ASAP, and the projected finish IS the overdue forecast (slack is real). The
backward need-by pass (`computeNeedBys`, below) computes demand-anchored TARGETS
only; its output is read by nothing in the placement path (spec
`.ai/specs/2026-08-15-dual-dates-due-vs-projected.md`).

- **Whole-location, deterministic run** (`run-schedule.ts`, called by every Node caller): one `now` is captured
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
  pins — `startDate`/`projectedCompletionAt` start null and forward-ASAP placement
  fills them for EVERY op, pinned included. `dueDate` (the backward need-by target)
  also starts null and is seeded from storage only for a pinned/`manuallyScheduled`
  op, whose value the need-by pass takes as-is. Duration =
  `setup + max(labor, machine)`.
- **Backward need-by pass** (`computeNeedBys()` → `computeNeedByDates` in
  `need-by-calculator.ts`, pure): demand-anchored per-op TARGETS diff-written to
  `jobOperation.dueDate` every regen. Walk = reverse topological order from
  `job.dueDate` (null due date ⇒ all-null targets); leaves are due on the job due
  date; an op with dependents is due at the earliest dependent constraint — the
  dependent's need-by START minus that dependent's `operationLeadTime` working
  days, minus this op's `assemblyLeadTime` at assembly edges (a sub-make-method
  feeding its parent); "With Previous" ops copy their partner's target dates; a
  pinned op's stored `dueDate` is taken as-is AND propagates upstream. Day math
  runs on real calendars via `calendarAdapters` over the SAME availability-ladder
  windows placement uses (one shared `loadAvailabilityWindows()` fetch):
  `calendarHoursPerDay(wc)` sizes duration-in-days, `workingDayTest` skips that
  calendar's zero-hour days. HARD RULE: targets are outputs, never placement
  constraints — placement never floors/delays on `op.dueDate` (comments at the
  floor sites in `work-center-selector.ts`; `determinism.test.ts` pins placement
  invariance with/without the need-by pass; the one remaining read is the pinned
  OUTSIDE-PROCESSING passthrough, which keeps its stored window and chains
  successors after the pinned end). The pass also produces no conflict flags.
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
  is byte-identical to pre-people behavior. **One deliberate change:** the gated
  any-qualified fallback (pass 2 in `work-center-selector.ts`) now treats a manning
  assignment as a whole-horizon COMMITMENT — the fallback relay may only draw on true
  FLOATERS: qualified people with NO board assignment anywhere in the horizon
  (`assignmentsByEmployee.has(id)`, built from `peopleByWorkCenter`; on the finite
  context). A person manned ANYWHERE is spoken for and is never pulled to a station they
  weren't assigned to. So moving your only qualified operator off a station makes that
  station's op an in-window unschedulable **placeholder** (surfaced on the Forecast),
  rather than double-booking the operator OR shoving the op onto the unmanned
  nights/weekends a per-date clip would leave open (the bug an earlier per-date version
  caused — the op landed on a future Saturday and fell out of the current-week view).
  Blank board => every qualified person is a floater => fallback unchanged.
- **Require-staffing policy** (`location.requiresStaffing`, `20260820151847_location-requires-staffing.sql`;
  per-location, default false; edited on the Production settings page): when ON, the finite scheduler
  places work ONLY where an operator is manned. `buildFiniteContext` reads it
  (`provider.getLocationRequiresStaffing`) + the set of lights-out stations
  (`provider.getAlwaysOnWorkCenterIds`) and puts `requiresStaffing` on the context +
  `alwaysOn` on each `capacity.workCenter`. Two gates in `work-center-selector.ts`: a
  **gated** op's any-qualified floater fallback is skipped entirely (pass 1 assigned+qualified
  only); an **ungated** op's machine-only fallback is skipped too — EXCEPT on `alwaysOn`
  (lights-out) stations, which keep running unattended. An op with no manned coverage (and
  not lights-out) becomes an unschedulable placeholder on the Forecast. This is exactly how
  "route everything to the one staffed work center, nothing to the unstaffed ones during
  staffed periods" falls out — an unstaffed non-lights-out station has no way to place, so
  earliest-finish selection naturally routes to the staffed candidate. OFF => the fallbacks
  stay (pre-setting behavior, byte-identical). "Staffing defined for a period" is derived
  purely from manning-board presence — there is no separate resource-plan status entity.
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
- **`persistChanges` (one transaction, only when `persist`)** writes, for every op, the
  forward placement's results — `startDate` (projected start, business day) +
  `jobOperation.projectedCompletionAt` (exact placed-end instant, timestamptz) +
  `priority` + `workCenterId` + conflict flags. `dueDate` is the backward need-by and
  is DIFF-written: only when the computed target differs from the stored value (a
  quiet regen touches zero `dueDate`s), and never for a `manuallyScheduled` op — a
  human owns that target. It rebuilds this job's `capacityReservation` rows
  (delete-by-job where `scenarioId IS NULL`, then bulk insert — a materialized OUTPUT,
  `WorkCenter`/`Employee` kinds); and writes `job.projectedCompletionAt` (= the max
  placed end, the forecast finish) while clearing
  `scheduleOutdatedReason`/`scheduleOutdatedAt` for that job. It also computes the
  **newly-late** flag (was on-time-or-unforecast before, now projected past `dueDate`
  on the location calendar) for the wave's digest.
- **Behind-target attribution (informational only):** when the JOB's verdict is late,
  `getCause()` appends `composeBehindTarget` (`conflict-messages.ts`) — "First behind
  target: {op} (due X, projected Y)", the first op in topological order whose
  projected finish passes its need-by. It rides the job-level cause sentence
  (expedite dialog) and NEVER sets per-op `hasConflict`; the UI's amber
  behind-target states (BOP rows, ops-board `ItemCard`, MES operation detail) are
  computed from the two dates, not from conflicts.
- **Expedite what-if** (`expediteJobId`): runs only the target job first with the WHOLE
  batch excluded from the snapshot (it claims capacity as if first), `persist: false`,
  and returns `{ projectedCompletionAt, cause }` without touching the database.

## Manual scheduling

`jobOperation."manuallyScheduled" BOOLEAN NOT NULL DEFAULT false`
(`20260525143721_manual-scheduling.sql` — adds only this column). Under dual dates a
pin means **a human owns the need-by TARGET**, not the placement: the backward pass
takes the pinned op's stored `dueDate` as-is and derives upstream ops' targets from
it (the pin propagates), and `persistChanges()` never writes `dueDate` for a pinned
op. Forward placement schedules pinned ops **normally** — the old frozen-window
branch (reserve the pinned span, skip placement) was REMOVED with the dual-dates
split, so a pinned op's `startDate`/`projectedCompletionAt` are re-projected every
regen and may differ from its pin. The one exception is a pinned OUTSIDE-PROCESSING
op, which skips placement and keeps its stored window (successors chain after the
pinned end). Pins are set via `updateJobOperationDueDate` (`production.service.ts`,
sets `manuallyScheduled`) from `OperationDueDatePicker` on the BOP.

## Conflict detection

`jobOperation."hasConflict" BOOLEAN DEFAULT false` + `"conflictReason" TEXT`
(`20251123000001_job-operation-conflicts.sql`, plus index
`idx_job_operation_wc_priority` on `("workCenterId","priority","status")`). Conflicts
come only from forward-ASAP finite placement: **no feasible
slot** (machine capacity exhaustion, a work center with no resolved availability
windows, missing/expired operator qualification, or calendar exhaustion —
`conflictReason` names the cause), or a placement that **finishes after the job's
`dueDate`** (the overdue verdict; `jobDueDate` is passed into the selector — the
per-op need-by targets are NOT a lateness input and NEVER set `hasConflict`; an op
behind its target only gets the informational amber state). Conflicts
surface; scheduling never hard-fails. The read RPCs roll it up per job with
`BOOL_OR(...)` so the board shows a red flag.

**Unplaceable ops leave a placeholder (`work-center-selector.ts` `best === null`
branch).** An op that could not be placed at all (no qualified operator, no
feasible slot, horizon-exhausted) has `hasConflict/conflictReason` stamped and a
fallback work center — and now also emits a **non-binding placeholder**
`capacityReservation` (`isPlaceholder = true`, `20260818044654_…`): pinned at the
op's earliest start for its work-content duration in calendar time, on the
fallback WC. It exists so the **Forecast** (which is 100% reservation-driven)
shows the op instead of the job silently ending after its last placeable op, and
so `job.projectedCompletionAt` extends to it and successors chain after it
(`placedEndByOperation`). It is deliberately NOT added to the in-run
`capacity.reservations` blocking set, and `getLiveReservations` filters
`isPlaceholder IS NOT true`, so it never holds the machine against other jobs or
the next regen. The Forecast surfaces it with a red "can't be scheduled" alert
(`LuBan`) in the TREE status column — via `GanttEvent.data.isUnschedulable`, set
on BOTH the work-center lane (any unplaceable child) and the operation row, so it
reports at the work-center level AND per operation; clicking either row opens the
detail sidebar ("Unschedulable" chip + reason + "where it would run"
explanation). Plus a separate "{n} can't be scheduled" header count. (Placed-but
-LATE ops keep a real reservation, show the generic `isError` triangle, and are
the "conflict" count.)

## Read RPCs (display only; do not compute schedules)

### `get_active_job_operations_by_location(location_id, work_center_ids[])`
Newest: `20260818031629_dual-dates.sql` (forked from `20260720121629_capacity-planning.sql`
+ a `projectedCompletionAt TIMESTAMPTZ` output column; prior revisions:
capacity-planning added `hasConflict`/`conflictReason`,
`20260531084723_rework-serial-flow.sql`
added `quantityReworked`/`reworkId`, `20260304000000` added `operationDueDate`).
TS wrappers (identical): `apps/mes/app/services/operations.service.ts`
`getActiveJobOperationsByLocation` and
`apps/erp/app/modules/production/production.service.ts`. Returns 41 cols incl.:
`id, jobId, jobMakeMethodId, operationOrder` (← `jo."order"`)`, priority, processId,
workCenterId, description, setup/labor/machineTime+Unit, operationOrderType` (←
`jo."operationOrder"`, serial/parallel enum)`, jobReadableId, jobStatus, jobDueDate,
jobDeadlineType, jobCustomerId, customerName, parentMaterialId, itemReadableId,
itemDescription, operationStatus` (`'Paused'` if job paused)`, targetQuantity,
operationQuantity, quantityComplete, quantityReworked, quantityScrapped,
salesOrderId/LineId/ReadableId, assignee, tags, thumbnailPath, operationDueDate`
(← `jo."dueDate"`, the need-by target)`,
reworkId, hasConflict` (COALESCEd, never null)`, conflictReason,
projectedCompletionAt` (← `jo."projectedCompletionAt"`, the projected finish
instant). The ERP ops board
(`schedule+/operations.tsx` → `ItemCard`) and MES schedule loader map
`hasConflict`/`conflictReason` onto Kanban items (red border + triangle tooltip on
the ERP card); the dual dates drive the amber behind-target state (projected day >
need-by). The same dual-dates migration also forks `get_job_operation_by_id`
(newest was `20260721004140_operation-type-consolidation.sql`) to add
`projectedCompletionAt` for the MES operation detail.

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
- Engine types (`packages/ee/src/planning/scheduling/types.ts`): `enum SchedulingStrategy
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
  **wrong** now. So is the old "manually scheduled ops keep their window" claim:
  pinned ops are placed normally every regen (the pin owns only the need-by
  target; see § Manual scheduling).
- `jobOperation."order"` (topo position) vs `"operationOrder"` (serial/parallel enum) are
  distinct columns — easy to confuse; the RPC surfaces them as `operationOrder` and
  `operationOrderType` respectively.
- There is **no `scheduleStatus` enum/column** and no `scheduledStart`/`estimatedEnd`
  columns. Dual dates (`20260818031629_dual-dates.sql`): the forward projection goes
  into `jobOperation.startDate` (projected start day) +
  `jobOperation.projectedCompletionAt` (projected finish instant, timestamptz);
  `jobOperation.dueDate` is the backward demand-anchored need-by target (DATE, stable
  — changes only when the job due date, routing, or lead times change; a pinned op's
  is human-owned). The job-level forecast finish is `job.projectedCompletionAt`.
  Consumers that key urgency on op `dueDate` (MES queue sort + overdue flags,
  the People Capacity view's Demand buckets, `get_picking_schedule` ordering) are
  deliberately unchanged — they now honestly read "when work is needed", not the
  sim's last forecast. `getJobPromiseDate` returns `job.projectedCompletionAt` or
  null (its old max-op-dueDate fallback would now just echo the job due date and
  was removed).
- Editing the ERP ops board (`operations.update.tsx`) does NOT re-run the engine and does
  not even notify — it only re-sequences `workCenterId` + `priority`. The dates board
  notifies (`notifyScheduleInputsChanged`), and the debounced wave regenerates the whole
  location. The MES board is display/drag-only.
