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
  `assembly-handler.ts`, `resource-manager.ts`, `types.ts`).
- **ERP authoring boards** (`apps/erp/app/routes/x+/schedule+/`): `operations.tsx`
  (ops Kanban; drag → `operations.update.tsx` writes `jobOperation.workCenterId` +
  `priority`, no reschedule) and `dates.tsx` (jobs-by-due-date Kanban; drag →
  `dates.update.tsx` writes `job.dueDate` + `priority`, **then calls
  `triggerJobSchedule(...)`** to re-run the engine).
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
- **Dates** = **infinite-capacity backward scheduling** (`date-calculator.ts`): anchor on
  `job.dueDate`, walk reverse-topo, each op `dueDate` = min dependent constraint − lead
  time, `startDate` = `dueDate` − duration in **business days** (`subtractBusinessDays`,
  skips weekends). Duration = `setup + max(labor, machine)`, ceil to 8-hour days.
  Work-center capacity is **never** consulted for dates — only to pick *which* WC.
- **Priority** = per-work-center dispatch sequence number (`priority-calculator.ts`): ops
  grouped by `workCenterId`, sorted by start date → job priority → deadline type, then
  numbered 1, 2, 3…. Boards sort by `priority` ascending. (Job-level `job.priority` is a
  separate fractional index set at job creation by `calculateJobPriority`.)

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
`idx_job_operation_wc_priority` on `("workCenterId","priority","status")`). A conflict
means **the computed start date is in the past** (`startDate < today` in
`date-calculator.ts`) — it is NOT capacity/overlap detection. The read RPCs roll it up
per job with `BOOL_OR(...)` so the board shows a red flag.

## Read RPCs (display only; do not compute schedules)

### `get_active_job_operations_by_location(location_id, work_center_ids[])`
Newest: `20260304000000_add-operation-due-date-to-functions.sql`. TS wrappers (identical):
`apps/mes/app/services/operations.service.ts` `getActiveJobOperationsByLocation` and
`apps/erp/app/modules/production/production.service.ts`. Returns 36 cols incl.:
`id, jobId, jobMakeMethodId, operationOrder` (← `jo."order"`)`, priority, processId,
workCenterId, description, setup/labor/machineTime+Unit, operationOrderType` (←
`jo."operationOrder"`, serial/parallel enum)`, jobReadableId, jobStatus, jobDueDate,
jobDeadlineType, jobCustomerId, customerName, parentMaterialId, itemReadableId,
itemDescription, operationStatus` (`'Paused'` if job paused)`, targetQuantity,
operationQuantity, quantityComplete, quantityScrapped, salesOrderId/LineId/ReadableId,
assignee, tags, thumbnailPath, operationDueDate`.

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

- The engine schedules **infinite-capacity, backward** from `job.dueDate`. Capacity is
  only used to choose the work center, never the timing. There is no finite scheduling.
- `jobOperation."order"` (topo position) vs `"operationOrder"` (serial/parallel enum) are
  distinct columns — easy to confuse; the RPC surfaces them as `operationOrder` and
  `operationOrderType` respectively.
- There is **no `scheduleStatus` enum/column** and no `scheduledStart`/`estimatedEnd`
  columns — computed dates go into `jobOperation.startDate` / `dueDate`.
- Editing the ERP ops board (`operations.update.tsx`) does NOT re-run the engine; only the
  dates board does (`triggerJobSchedule`). The MES board is display/drag-only.
