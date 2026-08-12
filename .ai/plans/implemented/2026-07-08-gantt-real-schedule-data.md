# Gantt page: real schedule data (job timeline lens)

Replace the mock data in `/x/scheduling/gantt` with the real schedule for a selected
job: when each operation starts/ends (clock-precise from `capacityReservation`),
how long it runs, conflicts (red bars + reason), machine + operator-pool
reservations, and actual timecards (production events).

Component: the vendored Trigger.dev trace viewer at `apps/erp/app/components/Gantt/`
(`GanttEvent = {id, parentId, children, level, data:{offset, duration(ms), message,
isError, isPartial, style:{icon, accessory(person)}}}`; icons: job, assembly,
operation, timecard, inspection, wait). Axis stays relative-duration (vendored code
untouched); wall-clock times go in the selected-span detail panel.

Constraints: no commit; typecheck via `pnpm exec turbo run typecheck --filter=erp`;
do NOT regenerate DB types (local DB is missing recent-main tables); task 5
(work-center lens) deferred until asked.

## Tasks

- [x] **Task 1 — service functions** (`apps/erp/app/modules/production/production.service.ts`)
  - `getJobOperationsForTimeline(client, jobId)` — jobOperation + workCenter(name) +
    jobMakeMethod(parentMaterialId, item readableId) embeds, incl. hasConflict/conflictReason.
  - `getCapacityReservationsByJob(client, jobId)` — scenarioId is null.
  - `getProductionEventsByJobId(client, jobId)`.
  - Verify: typecheck.

- [x] **Task 2 — pure mapper + tests**
  (`apps/erp/app/modules/production/ui/Schedule/timeline.ts` + `timeline.test.ts`)
  - `buildJobTimeline(input)` → `{ events: GanttEvent[], totalDuration, windowStart }`.
  - Window = min/max over reservations, events, op dates (date-only dueDate is
    inclusive → +1 day). Root = job; assembly nodes when >1 make method; op rows
    (offset/duration from WorkCenter reservation, else dates → isPartial;
    isError = hasConflict); children per op: machine reservation row, operator-pool
    row (ability name), timecard rows (person accessory; open event → isPartial).
  - Verify: `pnpm --filter erp exec vitest run app/modules/production/ui/Schedule/timeline.test.ts` green.

- [x] **Task 3 — route rewrite** (`apps/erp/app/routes/x+/scheduling+/gantt.tsx`)
  - Loader: `view: "production"`; `?jobId=` (default = latest Ready/In Progress/Paused
    job at company); fetch job + task-1 data + names (users for assignee/timecards,
    abilities for pool reservations); return trace built by mapper + `detailsById`.
  - Component: job Combobox picker; `<Gantt>` fed real events; selected-span right
    panel (was commented-out SpanView) shows local start/end datetimes, elapsed
    duration, work center, status, red conflictReason, link to job.
  - Breadcrumb handle on `scheduling+/_layout.tsx` (mirror `schedule+/_layout.tsx`).
  - Verify: typecheck.

- [x] **Task 4 — wiring**
  - `path.to.scheduleGantt(jobId?)` helper in `apps/erp/app/utils/path.ts`.
  - `ScheduleNavigation` (Kanban/ScheuleNavigation.tsx): "Timeline" view option.
  - `ItemCard` dropdown: "View Timeline" → scheduleGantt(item.jobId).
  - `JobHeader`: "Timeline" action → scheduleGantt(jobId).
  - Verify: typecheck; grep no unused helper.

- [ ] **Task 5 — DEFERRED: work-center lens** (root = work center for a date window,
  children = reservations across jobs; gaps = availability). Do not build until asked.

## Final verification

- `pnpm exec turbo run typecheck --filter=erp` → no errors in touched files
  (baseline invoicing/payments/documentExtraction errors are pre-existing).
- Mapper vitest green.
- Load `/x/scheduling/gantt?jobId=<J000008 id>` in the dev app: Welding op bar
  (Fri 08:00 → Mon 10:30 window), Deburr after weekend, operator-pool child row,
  conflict renders red with reason in detail panel.
