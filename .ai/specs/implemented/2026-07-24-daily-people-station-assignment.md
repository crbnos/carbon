# Daily People / Station Assignment (People Board)

> Status: implemented (pending browser verification + translations)
> Author: Claude + Naveen
> Date: 2026-07-24
> Research: `.ai/research/daily-people-station-assignment.md`

## TLDR

A **People board** in the Schedule area where a manager assigns each worker to a
work center for a date (optionally per shift) before the day starts — the
digital manning board. Assignments are consumed three ways: (1) the board
itself replaces the whiteboard/huddle artifact, (2) MES opens each operator's
screen on their assigned station (default, not a lock), and (3) the
**scheduling engine consumes assignments in v1**: people members are *preferred*
labor at their station (soft semantics), and a assigned station becomes
**manned** — its operations consume the assigned person's hours via the
existing attended-window mechanics, even for ability-ungated processes. A
one-click **absent today** flag removes a person from the day's labor supply
and triggers the existing reactive replan. Research found this closes a loop
no surveyed competitor closes (manning board → finite scheduler).

## Problem Statement

Real shops start the day with a supervisor assigning every worker to a
station (physical magnetic manning boards + skills matrix + huddle — see
research). Carbon has no representation of this:

- Operators self-select their work-center filter in MES; the manager's
  decision lives on a whiteboard or in their head.
- The scheduler books people only at ability-gated stations; everywhere else
  it reserves machines and treats people as unlimited air. In a typical job
  today, every reservation is a machine reservation and none is a person —
  a station with 12h of hands-on work and one real operator schedules as
  "done by 5 PM".
- A call-out (absence) has no system representation; the scheduler keeps
  counting the absent person as available.

## Proposed Solution

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Granularity | `date` + optional `shiftId` (null = whole day) | User Q1→C. Single-shift shops never see shift UI; multi-shift shops get per-shift boards. Matches SAP DM shift plan + physical 3-shift boards. |
| One station per person | Unique per (employee, date, shift); drag = move | User Q2→A. "One magnet per person" — board always answers "where is everyone". Keeps engine semantics unambiguous. |
| Scheduler consumption | **In v1** | User Q3. A board the scheduler ignores "doesn't make sense". |
| Consumption semantics | **Soft ("prefer")**: people booked first, any-qualified fallback; hard-obey is a future per-company setting | User Q3a. Half-filled boards degrade gracefully instead of flooding the schedule with phantom "no operator" conflicts. |
| Peopleed station is manned | **Yes** (Q3b→B): ops at a assigned WC consume assigned people's hours via attended-window allocation, gated or not; blank stations behave exactly as today | The manager's act means "this station runs on this person's hours". Fixes the observed unheld-operator gap using the existing attended allocator. |
| MES behavior | Default station filter + visible chip; override = one tap; no lock | User Q4→A. Research consensus: assignment is a default, not a cage; hard locks exist only for qualification (already enforced at Start). "Lock to station" can become a setting later. |
| Absence | **v1 includes "absent today" flag** (person × date, no T&A module) | User Q5→B. The call-out is the board's highest-value moment; flag excludes the person from the day's labor supply + fires replan. |
| Qualification at assignment | Advisory (amber badge when the person lacks a station's gated abilities); hard gate stays at MES start | Research consensus (two-layer enforcement: filter/warn at planning, enforce at execution). Stations host multiple processes, so assignment-time hard blocks would over-block. |
| Plan vs actuals | `peopleAssignment` is the plan; `productionEvent` remains the actual; no merge | Universal competitor pattern (SAP shift plan vs Labor On/Off; Epicor schedule vs labor detail). |
| Module / permissions | `production` module; board requires `production_update` to edit, employee-role read | Board lives beside the other Schedule views which use production scoping. |
| Multi-tenancy / table shape | `companyId`, composite PK, `id('people')`, audit columns, indexed FKs, 4 standard RLS policies | Heuristics 1–3 / `conventions-database.md`. |
| Service shape | Functions in `production.service.ts`, client-first, `{data,error}`; validators in `production.models.ts`; barrel export | Heuristics 2, 6. |
| Replan wiring | People/absence changes fire `carbon/schedule.inputs.changed` with new `kind: "people"` (entityId = workCenterId); existing mark→wave pipeline absorbs them | Reuses shipped reactive-replan infra; consistent with `work-center` kind scoping. |
| Backward compatibility | New tables + additive engine inputs only; no frozen surface touched | Heuristic 7. Blank board ⇒ byte-identical scheduling behavior. |
| Terminology | "People" (view), "people assignment" (row), "Absent" (flag) | Industry speech ("people deployment", "manning board") without inventing vocabulary. |

## Data Model Changes

Two new tables. Migration via `pnpm db:migrate:new people-assignments`.

```sql
-- Planned person→station per date (the manning board row)
CREATE TABLE "peopleAssignment" (
    "id" TEXT NOT NULL DEFAULT id('people'),
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL REFERENCES "location"("id") ON DELETE CASCADE,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
    "date" DATE NOT NULL,
    -- null = whole day (single-shift shops never set it)
    "shiftId" TEXT REFERENCES "shift"("id") ON DELETE SET NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
-- One magnet per person per day/shift (Q2→A)
CREATE UNIQUE INDEX "peopleAssignment_person_day_key"
    ON "peopleAssignment" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX "peopleAssignment_board_idx"
    ON "peopleAssignment" ("companyId", "locationId", "date");
CREATE INDEX "peopleAssignment_workCenter_idx"
    ON "peopleAssignment" ("workCenterId", "date");
CREATE INDEX "peopleAssignment_createdBy_idx" ON "peopleAssignment" ("createdBy");

-- Person is out for the date (person-level, not station-bound)
CREATE TABLE "peopleAbsence" (
    "id" TEXT NOT NULL DEFAULT id('crab'),
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
    "date" DATE NOT NULL,
    "shiftId" TEXT REFERENCES "shift"("id") ON DELETE SET NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "peopleAbsence_person_day_key"
    ON "peopleAbsence" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX "peopleAbsence_companyId_date_idx" ON "peopleAbsence" ("companyId", "date");
CREATE INDEX "peopleAbsence_createdBy_idx" ON "peopleAbsence" ("createdBy");
```

RLS: standard four policies on both tables — SELECT via
`get_companies_with_employee_role()` (operators must read their assignment),
INSERT/UPDATE/DELETE via
`get_companies_with_employee_permission('production_{create|update|delete}')`.

No changes to existing tables. `capacityReservation` already supports
`resourceKind = 'Employee'` — assigned-station bookings reuse it unchanged.

## API / Service Changes

`apps/erp/app/modules/production/production.service.ts` (+ models + barrel):

- `getPeopleBoard(client, companyId, locationId, date, shiftId?)` — assignments
  + absences for the day, joined with employee names; plus the assignable
  people list (employees at the location via `employeeJob.locationId`) and
  each person's ability set (for the advisory badge).
- `upsertPeopleAssignment(client, {...})` — move-semantics: replaces the
  person's existing row for that date/shift (Q2→A).
- `deletePeopleAssignment(client, id)`.
- `setPeopleAbsence(client, {...})` / `clearPeopleAbsence(client, id)`.
- `copyPeopleBoard(client, {fromDate, toDate, locationId, shiftId?})` — Kysely
  transaction (multi-row write; skips people absent on target date or already
  assigned).
- `getMyPeopleAssignment(client, {employeeId, companyId, date})` — MES loader
  helper (also exposed in `apps/mes/app/services/operations.service.ts`
  following MES service conventions).
- All mutations call `notifyScheduleInputsChanged(companyId, "people", reason,
  workCenterId)`; absence mutations notify once per station the person was
  assigned at that date (fallback: ability-style scoping when unassigned).

`packages/lib/src/events.ts`: extend `kind` union with `"people"`.
`packages/jobs` mark function: `"people"` scopes affected jobs like
`"work-center"` (jobs with unfinished ops at that WC).

### Scheduling engine changes (`functions/lib/scheduling/`)

- `MasterDataProvider` gains `getPeopleAssignments(dateRange)` and
  `getPeopleAbsences(dateRange)` (company-scoped; not cached across batch —
  they're date-sensitive but static within a run, so cacheable per run).
- `buildFiniteContext`:
  - Build `peopleByWorkCenterDate: Map<wcId, Map<date, employeeId[]>>` and
    `absentByDate: Map<date, Set<employeeId>>` over the scheduling horizon.
  - **Absences** (Q5→B): subtract the absent person's availability windows on
    that date everywhere (both people-preferred and qualified-fallback paths).
- Selector/allocator (soft prefer + manned stations, Q3a/Q3b):
  - **Gated ops:** eligible members at a WC on a date = people∩qualified when
    the WC has people that date (pass 1); if no feasible slot from people alone,
    fall back to the full qualified-on-shift set (pass 2, today's behavior).
  - **Ungated ops at a assigned WC:** treated as attended — members = that
    day's people at the WC, attended hours = setup + labor
    (`calculateAttendedHours`), machine holds the full span; relay/handoff
    mechanics unchanged. If the people can't cover it, fall back to
    machine-only placement (soft), keeping the schedule complete.
  - **Ungated ops at an unassigned WC:** byte-identical to today (machine
    only). A blank board changes nothing.
  - People-sourced bookings persist as ordinary `Employee` reservations
    (wait attribution and conflict messages work unchanged; add a
    placement-note variant "Waited …for the assigned people").
- Horizon semantics: people only exists for dates managers filled in; beyond
  the last assigned date every station reverts to default behavior. No new
  conflicts can originate from an empty board.

## UI Changes

### ERP — People board (new Schedule view)

Route `apps/erp/app/routes/x+/schedule+/people.tsx`; added to
`ScheduleNavigation` ("People", `LuUsers`); breadcrumb `Production › People`.

- Header: date picker (default today) with prev/next-day arrows; shift tabs
  only when the location has >1 active shift (Q1→C); location from the
  standard location context; headcount per column; **Copy previous day**
  button.
- Board: Kanban-style grid reusing the schedule boards' drag-and-drop —
  first column **Unassigned** (all employees at the location not yet placed,
  absent people grayed at the bottom), then one column per active work
  center. Cards = people (avatar + name), with:
  - amber qualification badge when the station has gated processes the
    person lacks (advisory only — tooltip lists the missing ability);
  - card menu: *Mark absent today* / *Clear absence*, *Remove from station*,
    *Note*.
- Drag person → station = move (their previous station empties, Q2→A).
- All strings via Lingui (`useLingui`/`<Trans>`); board data via loader,
  mutations via fetcher actions per forms conventions.

### MES — assigned station default

- `operations.tsx` loader: resolve today's assignment for the operator;
  when present and the user has no explicit filter override this session,
  default the work-center filter to their station and render a chip
  ("Your station: Drill Press") with a one-tap clear (Q4→A).
- No change to the Start gate — qualification enforcement is untouched.

## Acceptance Criteria

- [ ] Manager with `production_update` opens Schedule › People, drags employee
      A onto Work Center X for today; a `peopleAssignment` row exists; dragging
      A onto Y removes them from X (single row per person/day).
- [ ] At a single-shift location no shift UI is shown; at a location with two
      active shifts, shift tabs appear and assignments are per-shift.
- [ ] Assigning a person to a station whose gated process they lack shows the
      amber badge + tooltip but succeeds; MES Start for that gated op still
      blocks them.
- [ ] Copy previous day reproduces yesterday's board for today, skipping
      people marked absent today.
- [ ] Operator assigned to X logs into MES: operations view opens filtered to
      X with the station chip; tapping the chip clears the filter; an
      unassigned operator sees today's default behavior.
- [ ] Scheduling a job whose ungated op runs at assigned station X books
      `Employee` reservations for the assigned person covering setup+labor,
      machine reservation covering the full span; the same op at an unassigned
      station books machine-only (unchanged vs pre-feature run).
- [ ] With 12h of hands-on work at a station assigned by one 8h-shift person,
      the schedule spills work past their shift (visible in the Timeline)
      instead of compressing into the day.
- [ ] Gated op at a assigned station books the people member when feasible; when
      the people member's day is full, it falls back to another qualified
      on-shift person (soft), not a conflict.
- [ ] Marking a person absent fires `schedule.inputs.changed` (`kind:
      "people"`); affected jobs get the stale badge and the replan wave
      reschedules without the absent person's hours that date.
- [ ] Empty board for a date ⇒ engine output identical to pre-feature
      behavior for that date (regression-tested).
- [ ] All new strings extracted; 12 locales filled via /translate.

## Open Questions

- [x] Granularity: per day or per shift? — **Answer (user):** C — date +
      optional `shiftId` (null = whole day); shift UI only for multi-shift
      locations.
- [x] Can one person hold multiple stations per day/shift? — **Answer
      (user):** A — one station per person, unique-enforced; drag = move.
- [x] Does the scheduler consume assignments in v1? — **Answer (user):**
      Yes — "it doesn't make sense if scheduler is not taking this into
      account".
- [x] Prefer (soft) or obey (hard)? — **Answer (user):** Soft prefer;
      hard-obey later as a per-company setting.
- [x] Does people make ungated stations manned? — **Answer (user):** B — a
      assigned station runs on the assigned person's hours (attended
      mechanics); blank stations unchanged.
- [x] MES: default or lock? — **Answer (user):** A — default with one-tap
      override; qualification gate unchanged.
- [x] Absence in v1? — **Answer (user):** B — "absent today" flag that
      excludes the person from the day's labor supply and triggers replan;
      no time-and-attendance module.

## Out of Scope (v1)

Within-shift rotation segments; overtime equalization / union rules; a real
time-and-attendance module; hard "obey the board" mode (future per-company
setting); locking MES to the assigned station (future setting); kiosk/print
board view (cheap follow-up).

## Implementation Phases

1. **Schema + board + MES default** — migration, services, People view,
   MES chip. Ships standalone value (digital whiteboard).
2. **Engine consumption** — provider reads, people-preferred eligibility,
   manned assigned stations, absence exclusion, `kind: "people"` replan wiring,
   deno tests for the new allocator paths + empty-board regression test.

Note for phase 2 verification: the local Inngest dev server cannot execute
`debounce` functions (`.ai/lessons.md`) — validate the replan trigger by
watching the mark function + DB stamps, not the wave, locally.

## Changelog

- 2026-07-24 — Spec created after research
  (`.ai/research/daily-people-station-assignment.md`) and a 7-question design
  interview with Naveen; all questions resolved before writing (see Open
  Questions).
- 2026-07-24 — Implemented per `.ai/plans/2026-07-24-daily-people-station-assignment.md`
  (both phases in one pass): migration `20260723212028_people-assignments.sql`,
  people services + People board (`x+/schedule+/people.tsx` + `people.update.tsx`),
  MES station default + dismissible chip (session cookie
  `mes-people-override`), engine consumption (provider reads, pure
  `people-utils.ts` with 9 deno tests, two-pass gated eligibility, manned
  ungated assigned stations, absence subtraction, `people-wait` placement note),
  `kind: "people"` replan wiring. Divergences:
  **People semantics revised after review with Naveen (team mode):** a assigned
  station works ONE op at a time and its whole present people works that op
  TOGETHER — labor is parallelized across the present people (n× wall-clock),
  setup and machine time are never compressed
  (`simulateAttendedTeam`, `allocateAttendedOperation`'s `team` option).
  Gated ops team-book people∩qualified on their assigned dates; the soft
  fallback to the classic any-qualified single-person relay remains
  (unqualified people never speed up gated work). This supersedes the spec's
  original "people booked first via single-person attended allocation"
  wording. Other divergences: `getPeopleBoard` was split into
  small read functions (`getPeopleAssignments`/`getPeopleAbsences`/
  `getPeopleEmployees`/`getWorkCenterRequiredAbilities`/
  `getActiveEmployeeAbilities`) per services conventions;
  `getMyPeopleAssignment` lives in MES `operations.service.ts` only (no ERP
  duplicate needed). Non-English translations NOT yet filled — `pnpm run
  translate` failed on the local LLM endpoint; en catalogs extracted.
  Browser verification pending.
- 2026-07-29 — People page extended with a segmented view switcher (`?view=`):
  **Board** (original day kanban), **Matrix** (employee×day week grid with
  department/shift filters and an assigned-vs-needed coverage block), and
  **Capacity** (work-center week grid: Demand from open `jobOperation` hours
  bucketed by due date incl. a Past-due column, Scheduled from
  `capacityReservation` overlap, Available from people×8h with weekday fallback,
  Load% with green ≤100 / amber ≤120 / red >120 bands). Grounded in
  `.ai/research/work-center-capacity-people-matrix.md` and the Excel prototype
  `.ai/research/people-capacity-prototype.xlsx`.
- 2026-07-30 — Iteration round with Naveen on live data:
  - Real shift hours replace all hardcoded 8s: hour ladder = assignment
    `shiftId` → person's `employeeShift` → most-common shift duration at the
    location → 8h; unassigned Available = the location's per-weekday shift
    calendar (`getShiftsWithTimes` + `getEmployeeShifts`).
  - Capacity view: Scheduled distributes `capacityReservation.workHours`
    across the reservation span (no more 24h/day from spanning bookings);
    Load renders hours over/free (+Xh red / Xh free green, % in tooltip);
    per-work-center `<tbody>` groups with series dividers; row-scoped hover
    with the name cell static (base Td ships `group-hover:bg-muted` — see
    lessons); Demand excludes Draft/Planned jobs (released load only).
  - Matrix: one table at a time (Assignments | Coverage sub-tabs), sticky
    header + first column, department filter.
  - Board: sticky Unassigned column (scroll-conditional shadow,
    `MeasuringStrategy.Always`, `min-w-max` on the shared BoardContainer row).
  - Header: shift filter is a dedicated clock-icon popover ("All shifts"
    replaces "All day"; active-filter dot); location stays in ⚙; controls wrap
    on small screens.
- 2026-07-31 — Within-shift SPLIT allocation implemented per the drag-UX
  research (`.ai/research/people-split-allocation-departments.md`):
  - Schema: `peopleAssignment.hours NUMERIC NULL` (null = whole shift) and the
    person/day uniqueness now includes `workCenterId` (one row per station per
    shift; migration `20260731192616_people-split-hours.sql`, applied directly —
    `crbn migrate` hung).
  - Board cards are now ASSIGNMENT-identified (a split person appears in two
    columns); Unassigned is the free-hours pool — untouched people show as
    plain cards, partially-allocated people reappear with an "Xh free" chip
    whose drag assigns the remainder.
  - Dropping an assigned card on a second station opens the Move-or-Split
    dialog: [Move] [Split evenly] [Custom hours…] (WhenToWork-style semantic
    fork; splits are single Kysely transactions with same-station merge).
  - New intents move/split; assign accepts optional hours (remainder);
    matrix/capacity/coverage math and chips honor per-row hours.
  - Typecheck pending the DB-repair + types-regen blocker (columns exist,
    runtime verified paths; generated types stale).
- 2026-08-01 — Move-or-Split dialog REMOVED after UX research round 2
  (user: "modal feels overwhelming"; findings in
  `.ai/research/people-split-allocation-departments.md`, Float/Runn/NN-g
  consensus: drops act immediately, hours edited on the artifact, N-way
  splits are independent blocks not a split operation):
  - Drag now always MOVES an assigned card (instant, success toast); the
    `split` intent, `peopleSplitValidator`, and `splitPeopleAssignment` txn were
    deleted.
  - Splitting = the hours chip on every assigned card (blue `{h}h`, always
    visible) → anchored popover with a ±0.5h stepper (capped at shift minus
    the person's other rows), Apply, and Whole shift (sole-row only, stores
    null). Lowering hours releases the remainder to the Unassigned
    free-hours pool; dragging the "Xh free" card to stations 2…N completes
    an N-way split — one light gesture per station, no dialogs.
  - New `hours` intent (`peopleHoursValidator` → `setPeopleAssignmentHours`).
  - Typecheck still gated on the stale-generated-types blocker (15 errors,
    all the missing hours/overtimeHours column class).
- 2026-08-01 — Planning-horizon expansion (research:
  `.ai/research/people-planning-horizons.md` — industry consensus: week is the
  editing atom, month is a read-only coverage/absence overview, months are
  filled by projecting weeks forward):
  - Header date label is now a DatePicker (jump to any date); arrows step
    day (Board), week, or month with matching aria labels.
  - `?range=month` on Matrix/Capacity (Week | Month tabs): Capacity renders
    the same Demand/Scheduled/Available/Load table with WEEK-bucket columns
    (SAP CM01-shaped; `CapacityColumn[]` prop generalizes the table); Matrix
    renders the new read-only `PeopleMonthMatrix` (person × week: hours, +OT,
    days off, week/month totals). Week headers drill down to the week view.
    Loader loads the month's full Monday-aligned span (28–42 days).
  - "Copy previous week" button on week-range Matrix/Capacity → `copy-week`
    intent → `copyPeopleWeek` (one txn, per-day skip rules shared with the day
    copy via `copyPeopleDayInTransaction`; day copy now preserves split
    `hours`, overtime intentionally never copies).
  - "Time off" header button → `absent-range` intent → `setPeopleAbsenceRange`
    (employee + from/to ≤62 days, one `peopleAbsence` row per date, existing
    dates skipped).
  - Typecheck: 16 errors, all still the stale-generated-types class.
- 2026-08-01 (later) — Week-basis assignment + horizon tab fixes (feedback:
  "why do I get redirected to matrix when I select week", "assign per week
  basis"):
  - Period tabs are now per-view: Board shows Day | Week (both editable),
    Matrix/Capacity show Week | Month — no cross-view redirects.
  - New `PeopleWeekBoard` (Board + Week): drag a person onto a station once =
    assigned there all week. `assign-week` inserts one row per working day
    (shift's weekday flags, Mon–Fri fallback; absent/already-assigned days
    skipped), `unassign-week` clears the station's week, `move-week` moves
    the week station-to-station (target-day collisions keep the target row).
    All Kysely txns. Cards show "Nd" day counts + "Nd off"; day detail
    (splits/OT/notes) stays on the Day board.
  - Header date button now opens the real `Calendar` (newly exported from
    @carbon/react — additive barrel change, flagged to Naveen) in a plain
    popover; the DatePicker inline-preview misrender is gone.
- 2026-08-01 (latest) — Month range REMOVED on Naveen's request ("remove the
  month date filter"): `PeopleMonthMatrix` deleted, `?range=month` and the
  Month tab gone, `PeopleCapacity`'s column override prop reverted to an
  internal per-day shape. Horizons now: Board = Day | Week (both editable),
  Matrix/Capacity = week only. Date-picker jump, copy previous day/week,
  and the Time off range dialog all stay.
- 2026-08-02 — ENGINE CONSUMPTION of overtime + splits (the deferred part 3
  of the overtime/split/department build) implemented as pure window edits —
  zero allocator changes:
  - `people-utils.ts`: `buildOvertimeByEmployee` (per person/date sum),
    `extendWindowsByOvertime` (the date's last window ends OT hours later;
    merges if it reaches the next window), `buildPeopleBudgets` +
    `clipWindowsToStation` (a split day's attended time dealt out
    sequentially in row order; sole whole-shift row = identical to
    `clipWindowsToDates`). 12 new deno tests; suite 100/100.
  - `master-data-provider` selects `overtimeHours`/`hours` (stable
    date+id order); `scheduling-engine.buildFiniteContext` extends windows
    after absence subtraction and exposes `peopleBudgets` on the context;
    `work-center-selector` clips people members per STATION via
    `clipWindowsToStation` in both the gated and ungated team paths.
  - `deno check` on the three DB-touching engine files fails until types
    regen (stale `functions/lib/types.ts` lacks the columns) — no CI runs
    deno, runtime unaffected; clears with the DB repair regen.
- 2026-08-03 — "Working hours" editor popover (Connecteam-shaped,
  duration-first per `.ai/research/people-hours-editor-popover.md`):
  - New `PeopleHoursPopover`: Set-as-OFF-day toggle (absent/clear-absence),
    one row per station (hours + OT inputs, ✕, "+ Add station" with
    remainder default), derived clock-time echo from the shift start
    (sequential — matches engine dealing), live footer total with amber
    non-blocking over-capacity warning, atomic Save via new `day-hours`
    intent → `peopleDayValidator` (jsonField rows) → `setPeopleDay` (one Kysely
    txn reconciling update/insert/delete of the person's day, shift-scoped).
  - Day board: the hours chip opens the editor; the per-card Overtime modal,
    Absent action (assigned cards), and the Actions expander are gone —
    cards show Note + Remove inline. Loader now threads shift START times
    (`shiftStartById`/`employeeShiftStart`/`defaultShiftStart`).
  - Matrix: employee×day cells are click targets opening the same editor
    (grid-cell anchor) — the matrix is now an editing surface; absences prop
    carries ids for the OFF-day toggle.
  - Typecheck 18 errors — all stale-generated-types class (+2 from
    setPeopleDay's hours/overtimeHours writes).
