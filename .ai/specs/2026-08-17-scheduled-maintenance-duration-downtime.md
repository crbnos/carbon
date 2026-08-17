# Scheduled Maintenance: Expected Duration + Takes-Work-Center-Offline

> Status: implemented (verified locally; not yet merged)
> Author: Brad Barbin (design), agent-assisted
> Date: 2026-08-17

## TLDR

A preventive-maintenance (PM) plan (`maintenanceSchedule`) can already store an
`estimatedDuration` (minutes), but it has no way to declare that the PM **takes
the machine offline**, and the nightly generator throws the duration away — every
generated PM dispatch gets only a `plannedStartTime` (noon UTC), no
`plannedEndTime`, and `takesWorkCenterOffline = false`. On the capacity-planning
branch, an open dispatch flagged `takesWorkCenterOffline` subtracts its
`plannedStartTime → plannedEndTime` window from the work center's scheduling
capacity — so generated PMs currently reserve **no** capacity and describe **no**
expected window. This spec adds a single `takesWorkCenterOffline` boolean to the
schedule and wires the schedule's duration + offline flag into generation, so a PM
plan can say "this blocks the machine for ~45 minutes" and the finite scheduler
honors it ahead of time.

## Problem Statement

The individual maintenance **dispatch** already carries everything needed to
reserve capacity:
- `plannedStartTime` / `plannedEndTime` — the expected window.
- `takesWorkCenterOffline` (BOOLEAN, added `20260720121629_capacity-planning.sql`)
  — the real capacity block. DB comment: *"While this dispatch is open, its work
  center(s) contribute no scheduling capacity between
  (actualStartTime ?? plannedStartTime ?? createdAt) and
  (actualEndTime ?? plannedEndTime ?? open-ended)."*

The **scheduled maintenance** that spawns dispatches does not:
- `maintenanceSchedule` has `estimatedDuration` (INTEGER minutes, nullable) but
  **no** `takesWorkCenterOffline` column — a planner cannot declare that a PM
  makes the machine unavailable for production.
- `packages/jobs/src/inngest/functions/scheduled/dispatch.ts`
  (`generateDispatchesForSchedule`) inserts each dispatch with only
  `plannedStartTime` (the due date at noon UTC). It never reads
  `schedule.estimatedDuration`, never sets `plannedEndTime`, and never sets
  `takesWorkCenterOffline` (it falls to the column default `false`). It does
  hard-code `oeeImpact = 'Planned'`, but `oeeImpact` only feeds the display
  `isBlocked` badge (`status = 'In Progress' AND oeeImpact IN ('Down','Planned')`),
  not the scheduler.

Net effect: a shop can define "tear down and rebuild the press, 3rd Monday of the
month, ~2 hours, machine down" and the finite scheduler will still happily plan
production onto that press during those two hours, because the generated PM
reserves nothing and has no end time.

Concrete example (today, broken): a monthly PM on work center `WC-PRESS` with
`estimatedDuration = 120` generates a dispatch at `2026-09-21T12:00Z` with
`plannedEndTime = null`, `takesWorkCenterOffline = false`. The capacity view shows
`WC-PRESS` fully available on 9/21. After this spec, with the schedule flagged
offline: the dispatch generates with `plannedEndTime = 2026-09-21T14:00Z`,
`takesWorkCenterOffline = true`, and the scheduler subtracts that 2-hour window.

## Proposed Solution

1. Add **one** column to `maintenanceSchedule`:
   `takesWorkCenterOffline BOOLEAN NOT NULL DEFAULT false`.
2. Require `estimatedDuration` on the schedule **only when**
   `takesWorkCenterOffline` is true (zod `superRefine`), so an offline PM always
   produces a **bounded** capacity block — never an open-ended one.
3. In the generator, copy the schedule's `takesWorkCenterOffline` onto each
   generated dispatch, and set
   `plannedEndTime = plannedStartTime + estimatedDuration` whenever the schedule
   has a duration (regardless of the offline flag). `oeeImpact` stays hard-coded
   `'Planned'` for all generated PMs — unchanged, independent of the new flag.
4. Surface the offline toggle on the schedule form; validation enforces the
   duration coupling. Show the flag in the schedules table.

Copy-down is a **snapshot at generation** — consistent with how the generator
already snapshots priority, procedure, and spare-part items. Editing a schedule
affects only **future** generated dispatches; existing open dispatches keep their
copied-down values and remain individually editable on the dispatch form.

Research (`.ai/research/scheduled-maintenance-duration-downtime.md`) confirms this
shape: best-in-class CMMS/EAM (Fiix, UpKeep, Limble, MaintainX, Maximo Job Plans,
SAP PM) store the duration estimate on the PM **template** and copy it down to each
generated work order; where planned maintenance actually reserves production
capacity (Maximo Scheduler, SAP APO), it is modeled as a **fixed start+duration
window** on the resource calendar, and a duration is required precisely because it
bounds that block. Carbon's `takesWorkCenterOffline` window is exactly this
resource-calendar exception.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| How duration becomes the dispatch window | Generator sets `plannedEndTime = plannedStartTime + estimatedDuration` (minutes) | The scheduler blocks `plannedStartTime → plannedEndTime`; without an end an offline PM is an open-ended capacity hole. |
| Duration required when offline? | Required **iff** `takesWorkCenterOffline` is true (`superRefine`) | An offline PM with no duration = unbounded block. Off-line PMs keep duration optional/informational. Matches CMMS/APS: duration is required only when it bounds a scheduler block. |
| Set `plannedEndTime` for non-offline PMs too? | Yes — whenever a duration is present, regardless of the flag | Makes every generated PM self-describing ("~45 min job"); the scheduler only reacts to the window when `takesWorkCenterOffline` is true. Null end only when no duration (only possible for non-offline PMs). |
| Relationship to `oeeImpact` | Independent. Add only `takesWorkCenterOffline`; generator keeps `oeeImpact = 'Planned'` for all generated PMs | A scheduled PM is "Planned" downtime for OEE regardless of whether it fully blocks the center. `oeeImpact` = display/reporting; `takesWorkCenterOffline` = capacity. Keeping them separate matches the existing dispatch model and the research. |
| Propagation on schedule edit | Future-only. No cascade to already-generated open dispatches | Matches copy-once generation (items/procedure/priority are never re-synced); a dispatch is an independent work order once created; avoids silently moving/erasing a capacity block the scheduler already planned around. |
| New column shape & default | `takesWorkCenterOffline BOOLEAN NOT NULL DEFAULT false` | Mirrors the dispatch column exactly; existing schedules backfill to `false` (non-blocking) — safe, no behavior change until a planner opts in. |
| Heuristic 1 (multi-tenancy) | N/A — altering an existing table; `maintenanceSchedule` already has `companyId` + composite-safe PK, RLS, audit | No new table. |
| Heuristic 2 (service shape) | Extend existing `upsertMaintenanceSchedule` (client-first, `{data,error}`) | No new service function. |
| Heuristic 3 (RLS) | N/A — column add inherits table RLS (`resources_*`) | No policy change. |
| Heuristic 4 (permission scoping) | Unchanged — schedule routes already use `resources_create` / `resources_update` | No new route. |
| Heuristic 5 (form pattern) | Existing `ValidatedForm` + `maintenanceScheduleValidator` + existing new/edit route actions | Add one `Boolean` field + a `superRefine`. |
| Heuristic 6 (module layout) | All changes in `resources.models.ts` / `resources.service.ts` / `ui/MaintenanceSchedule/` + the jobs generator | Single module + its generator. |
| Heuristic 7 (backward compatibility) | No FROZEN/STABLE surface touched; `NOT NULL DEFAULT false` backfills silently | Additive column, additive generator logic. |

## Data Model Changes

Single additive migration (`pnpm db:migrate:new scheduled-maintenance-offline`,
randomized HHMMSS). No new table.

```sql
-- Add the offline/production-impact flag to the PM plan, mirroring
-- maintenanceDispatch."takesWorkCenterOffline".
ALTER TABLE "maintenanceSchedule"
  ADD COLUMN "takesWorkCenterOffline" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "maintenanceSchedule"."takesWorkCenterOffline" IS
  'When true, PM dispatches generated from this schedule are created with takesWorkCenterOffline = true and a bounded plannedEndTime (plannedStartTime + estimatedDuration), so the finite scheduler subtracts that window from the work center''s capacity. Requires estimatedDuration to be set.';
```

**View / RPC redefinition (required — see `feedback_view_redefinition`).** The
schedule list reads through the `maintenanceSchedules` view
(`20251226000001_maintenance_schedule_days.sql`) and the
`get_maintenance_schedules_by_location` RPC
(`20251231003301_scheduled-maintenance-fix.sql`). A view/RPC `SELECT` freezes its
column list at definition time, so both must be forked from their **newest**
definitions and recreated to expose `takesWorkCenterOffline` (preserve every
existing attribute — `estimatedDuration`, day-of-week flags, derived `locationId`,
`procedureId`, etc.). Without this, the loader can't read the new column even
though the base table has it.

No enum, no RLS, no audit changes (column inherits the table's existing RLS and
audit columns).

## API / Service Changes

**`apps/erp/app/modules/resources/resources.models.ts`**
- Add `takesWorkCenterOffline: zfd.checkbox()` to `maintenanceScheduleValidator`.
- Add a `.superRefine` (or `.refine`) on the schedule schema:
  when `takesWorkCenterOffline` is true, `estimatedDuration` must be present and
  `> 0`; attach the error to the `estimatedDuration` path
  (message e.g. *"Estimated duration is required when the PM takes the work center
  offline"*). Off-line schedules leave `estimatedDuration` optional.

**`apps/erp/app/modules/resources/resources.service.ts`**
- `upsertMaintenanceSchedule` (insert + update branches): include
  `takesWorkCenterOffline` in the written columns.

**`packages/jobs/src/inngest/functions/scheduled/dispatch.ts`**
- Extend the local `MaintenanceSchedule` interface (currently ~L26–43) with
  `estimatedDuration: number | null` and `takesWorkCenterOffline: boolean`.
- Ensure the schedule-fetching query `select(...)` includes both columns.
- In the dispatch `insert` (~L204–230):
  - `takesWorkCenterOffline: schedule.takesWorkCenterOffline`.
  - Compute `plannedEndTime` from the already-computed noon-UTC start when
    `schedule.estimatedDuration` is set, using `@internationalized/date`:
    `startZdt.add({ minutes: schedule.estimatedDuration }).toAbsoluteString()`
    (reuse the same `targetDate.set({ hour: 12, ... })` ZonedDateTime the start is
    derived from — **no JS `Date`**, per `date-handling.md`). Leave
    `plannedEndTime` unset when `estimatedDuration` is null.
- `oeeImpact` remains `'Planned'` — no change.

No route loader/action signature changes (the new/edit schedule routes already
call `validator(maintenanceScheduleValidator)` and `upsertMaintenanceSchedule`).

## UI Changes

**`apps/erp/app/modules/resources/ui/MaintenanceSchedule/MaintenanceScheduleForm.tsx`**
- Add a `Boolean` field `name="takesWorkCenterOffline"` labelled
  *"Takes Work Center Offline"* (match the dispatch form's wording in
  `MaintenanceDispatchForm.tsx`), placed near `estimatedDuration`.
- The existing `estimatedDuration` `Number` stays; the `superRefine` surfaces the
  "required when offline" error through `ValidatedForm`'s normal validation.
  (Optional polish: show the "(required)" hint on the duration label when the
  toggle is on — not required for correctness since server validation enforces it.)

**`apps/erp/app/modules/resources/ui/MaintenanceSchedule/MaintenanceSchedulesTable.tsx`**
- Add a column/indicator for `takesWorkCenterOffline` (e.g. a "Blocks machine"
  badge or boolean cell), next to the existing `estimatedDuration` ("X min")
  column, so planners can see at a glance which PMs reserve capacity.

No MES changes — schedules are ERP-only; the MES dispatch surface already handles
`takesWorkCenterOffline` on the dispatch itself.

## Acceptance Criteria

- [ ] Migration adds `maintenanceSchedule.takesWorkCenterOffline BOOLEAN NOT NULL
      DEFAULT false`; existing schedules read back `false`. `pnpm run
      generate:types` regenerates `packages/database/src/types.ts` with the column.
- [ ] The `maintenanceSchedules` view and `get_maintenance_schedules_by_location`
      RPC expose `takesWorkCenterOffline` (the schedule list loader returns it).
- [ ] Creating/editing a schedule with **"Takes Work Center Offline" ON and
      Estimated Duration blank** fails validation with the error attached to the
      duration field; with duration set it saves.
- [ ] Creating/editing a schedule with the flag **OFF** saves with or without a
      duration (duration remains optional).
- [ ] Generating from a schedule with `estimatedDuration = 120` and the flag ON
      produces a dispatch with `takesWorkCenterOffline = true`,
      `plannedStartTime` = due date @ noon UTC, and
      `plannedEndTime = plannedStartTime + 120 min` — verified in the DB / on the
      dispatch form's planned window.
- [ ] Generating from a schedule with a duration but the flag OFF produces a
      dispatch with `takesWorkCenterOffline = false` and a populated
      `plannedEndTime` (self-describing window), and the scheduler does **not**
      subtract it.
- [ ] Generating from a schedule with the flag OFF and **no** duration produces a
      dispatch with `plannedEndTime = null` (unchanged from today).
- [ ] An open generated dispatch flagged offline subtracts its
      `plannedStartTime → plannedEndTime` window from the work center's capacity in
      the forecast/scheduler view; editing the parent schedule afterward does
      **not** alter that already-generated dispatch (future-only).
- [ ] `pnpm --filter @carbon/erp typecheck`, `pnpm --filter @carbon/jobs
      typecheck`, and the resources tests pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Forgetting to redefine the view/RPC → loader silently can't read the new column | Med | Explicit acceptance criterion + task; fork newest view/RPC definitions with `SELECT`-column parity. |
| Timezone bug computing `plannedEndTime` (JS `Date` drift) | Med | Reuse the existing ZonedDateTime start and `.add({ minutes })` from `@internationalized/date`; never construct a JS `Date` (`date-handling.md`). |
| Duration units mismatch (schedule stores minutes; someone assumes seconds/hours) | Low | `estimatedDuration` is documented minutes (form label "(minutes)"); `.add({ minutes })` matches. |
| An existing schedule flipped to offline while future dispatches already generated leaves those unchanged, surprising a planner | Low | Documented future-only behavior; planner edits the individual dispatch (matches copy-once model). Consider a form helper note. |
| Client vs server validation drift on the coupling rule | Low | Single source of truth is the zod `superRefine` on `maintenanceScheduleValidator`, used by both `ValidatedForm` (client) and the route action (server). |

## Open Questions

> All resolved with the user on 2026-08-17 before this spec was written.

- [x] **How does the schedule's duration become the dispatch's blocking window, and
      is duration required when offline?** — **Answer:** Generator sets
      `plannedEndTime = plannedStartTime + estimatedDuration`; `estimatedDuration`
      is **required iff `takesWorkCenterOffline` is true** (validator
      `superRefine`), so an offline PM is always a bounded block. Corroborated by
      CMMS/APS research (duration bounds the scheduler block).
- [x] **Should the schedule's offline flag also drive `oeeImpact`?** — **Answer:**
      No — keep them independent. Add only `takesWorkCenterOffline`; the generator
      keeps `oeeImpact = 'Planned'` for all generated PMs. `oeeImpact` is
      display/OEE; `takesWorkCenterOffline` is capacity.
- [x] **On schedule edit, do already-generated open dispatches change?** —
      **Answer:** Future-only. No cascade; existing open dispatches keep their
      snapshotted values and stay individually editable.
- [x] **When a schedule has a duration but is not offline, still set
      `plannedEndTime`?** — **Answer:** Yes — always set `plannedEndTime` when a
      duration is present, regardless of the flag. `plannedEndTime` is null only
      when no duration (non-offline PMs only, per the coupling rule above).
- [x] **New column shape/default?** — **Answer:**
      `takesWorkCenterOffline BOOLEAN NOT NULL DEFAULT false`, mirroring the
      dispatch column; existing schedules backfill to `false`.

## Changelog

- 2026-08-17: Created. Open questions resolved with the user before writing;
  design reflects "duration required iff offline", "oeeImpact independent",
  "future-only propagation", "always set plannedEndTime when duration present",
  and the single `takesWorkCenterOffline` column. Research at
  `.ai/research/scheduled-maintenance-duration-downtime.md`.
- 2026-08-17: Implemented on `naveen/capacity-planning` and verified locally.
  Migration `20260817041453_scheduled-maintenance-offline.sql` applied (column +
  view/RPC recreation; the view recreation also un-froze the schedule's own
  `locationId`/`procedureId` columns and dropped the now-duplicate `wc.locationId`
  alias). `erp` + `@carbon/jobs` typecheck pass; 476 jobs tests pass (erp has no
  unit-test runner). Browser+DB e2e proved: the "Takes Work Center Offline"
  toggle renders; a schedule saved with offline ON + 90 min persists
  `takesWorkCenterOffline=true, estimatedDuration=90`; the "Blocks Machine" column
  shows OFFLINE; offline ON + blank duration surfaces the exact superRefine error;
  and forcing a due occurrence generated dispatch MAIN000001 with
  `takesWorkCenterOffline=true` and `plannedEndTime = plannedStartTime + 90 min`.
  All e2e test data cleaned up. Not yet merged (draft PR).
