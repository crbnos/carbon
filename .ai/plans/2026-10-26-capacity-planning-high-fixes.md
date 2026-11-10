# Capacity planning: fix the 8 high findings

Source: the browser test of 2026-10-24 (findings F1, F5, F6, F10, F12, F16, F26, F27).
Decisions from the user on 2026-10-26:

- Scope is the 8 high findings only.
- F10: save the work center that the scheduler picks.
- F26: change the `users_for_groups` guard.
- F27: stop the data loss and correct the help text. No scheduler work for contractors.

Each fix gets a test at its seam (see `.claude/rules/testing.md`), then a browser check.

## Tasks

- [x] **F6 — a batch is placed against bookings that the run will replace.**
  1. In `packages/planning/src/scheduling/batch-scheduler.ts`, add a pure function `batchBlockingReservations`.
     It keeps the bookings that block a released batch.
     It drops this location's own batch rows and every non-batch row of a job that the run re-plans.
  2. Call it from `placeReleasedBatches` with `orderedJobIds`.
  3. Test: `batch-scheduler.test.ts`.
- [x] **F10 — the chosen work center is not saved.**
  1. Add `isOperationStarted(op)` to `apply-work-center-selections.ts`. The selector uses it too.
  2. `applyWorkCenterSelections` writes the selected work center when the op is placed and not started.
     A started op and a placeholder keep the stored work center.
  3. `buildWrites` writes the applied work center.
  4. Test: `apply-work-center-selections.test.ts`.
- [x] **F12 — an operator is booked after the qualification expires.**
  1. In `operator-eligibility.ts`, add `clipToQualification(windows, expiresAt, timeZone)`.
     The qualification ends at the start of the `expiresAt` day in the plant timezone.
  2. `buildEligibleMembers` clips each member's windows. A member with no window left is dropped.
  3. The People board treats the expiry day as expired (`<=`), like the engine and MES.
  4. Test: `operator-eligibility.test.ts`.
- [x] **F16 — holidays are ignored.**
  1. Add `closeHolidays` to `machine-availability.ts` and `withHolidays` to `people-utils.ts`.
     Both use `subtractDates`, which cuts whole days in the plant timezone.
  2. The provider reads the company's holidays once (`getHolidayDates`).
  3. The provider removes holidays from every work center that is not lights-out, and from the location default calendar.
  4. `buildFiniteContext` adds each holiday as an absence for every person.
  5. The Forecast shades holidays. The Capacity view shows 0 Available on a holiday.
  6. The holiday operations notify the scheduler. The 3 holiday routes call those operations.
  7. Tests: `machine-availability.test.ts`, `people-utils.test.ts`, `forecast.test.ts`, `capacity-buckets.test.ts`.
- [x] **F5 — a shift change does not re-plan ungated work.**
  1. `createShift`, `updateShift` and `deleteShift` notify kind `shift` with the shift id. The delete route calls `deleteShift`.
  2. Add a pure function `workCentersOnShift` to the jobs package.
     It returns the work centers whose hours come from the shift: explicit links, plus unlinked, not lights-out stations at the shift's location.
  3. The mark step stamps the jobs with open ops on those work centers, plus the gated jobs as before.
  4. Test: a unit test for `workCentersOnShift`.
- [x] **F1 — the Capacity view puts hours on nights and weekends.**
  1. `buildPeopleCapacityBuckets` takes each work center's working windows.
  2. It divides a booking's `workHours` by the working time inside each day.
     If the booking has no working time, it uses the clock time as before.
  3. The People loader builds the windows with `resolveWorkCenterWindows` and the holidays.
  4. Test: `production` unit test with the Potting Station example (8h booking Mon 12:00 → Tue 11:30 = 2.5h + 5.5h).
- [x] **F26 — a training assigned to one person is invisible.**
  1. Main fixed this first (`699d31dc28`, migration `20261026114317_users-for-groups-identity-groups.sql`). This branch drops its own migration and keeps that fix.
  2. The browser check of F26 runs against main's fix.
- [x] **F27 — a contractor save deletes the abilities.**
  1. `upsertContractor` replaces the abilities only when the caller sends `abilities`.
  2. The edit route stops sending an empty list.
  3. Correct the glossary text for `contractor-hours-per-week`.
- [x] **Docs:** update `.claude/rules/scheduling-data-structures.md` and the production and resources `AGENTS.md` for F6, F10, F12, F16.
- [x] **Verify:** typecheck (planning, jobs, erp), Biome, unit tests, the SQL test, and a browser check of each finding.

## Result (2026-10-26)

| Check | Result |
|---|---|
| Typecheck: `@carbon/planning`, `@carbon/jobs`, `erp` | Pass |
| Unit tests: planning (358), jobs scheduled (70), ERP (8) | Pass |
| `@carbon/checks` conformance (403) and `clobbers` | Pass |
| Biome on the 32 changed files | No errors |
| `rpc-privileges.test.sql` (main's version) | Pass |
| Browser check of each finding | Pass. Details below. |

- F6: 4 regenerates in a row give the same order and work center per station.
- F10: 0 of 81 bookings name a station other than the op's work center (42 before).
- F1: Capacity for 26 Oct to 1 Nov shows 0 overloaded (8 before), and no weekend hours.
- F5: adding a shift stamped 5 jobs. Editing Swing Shift stamped 11 jobs, and no booking runs past the new end.
- F12: an operator whose qualification ends on 28 Oct is not booked on 29 Oct.
- F16: the holiday stamped 13 jobs. Capacity shows 0 Available on that day, and the Forecast shades it.
- F26: the Assignments list and drawer show the training assigned to one person.
- F27: two contractor saves wrote the hours, and the ability stayed.

The test data is restored: 85 reservations, 0 placeholders, 0 stale jobs.

## Self-review follow-ups (2026-10-26)

1. The `placeReleasedBatches` doc comment is back on its function.
2. `placementWrites` (`run-overlay.ts`) now builds the placement writes, and `buildWrites` calls it. A new test applies a selection and checks the write. With the old rule put back, that test fails.
3. The ERP uses the engine's `closeHolidays` and `subtractDates` (now exported from `@carbon/planning`). It has no copy of its own.
4. The Forecast loader reads holidays in parallel with its other reads.
5. The abilities table takes today from the browser's calendar, not the UTC day.
6. `people.mdx` and `scheduling.mdx` describe holidays. Two lessons are in `.ai/lessons.md`.
