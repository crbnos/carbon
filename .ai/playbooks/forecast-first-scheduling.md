# Forecast-First Finite Scheduling

Last tested: 2026-08-18
Routes: /x/resources/work-centers/:id, /x/job/:id, /x/priority/people?view=capacity,
/x/priority/dates, /x/priority/operations, MES /x/operations + /x/operation/:opId

## Prerequisites
- At least one work center, one job, and location shifts seeded (dev seed has these).
- Slack badge on the job header only shows once `job.projectedCompletionAt` is set
  (requires a regen wave to have run for that job's location). Expedite works regardless.

## Scenarios

### (a) Work center operating hours + alwaysOn
1. Navigate — `/x/resources/work-centers`, click a work-center row → edit form.
2. Verify — the form has an "Operating shifts" multiselect (placeholder "Select" when empty)
   and a "Runs 24×7 (lights-out)" switch below the Processes field.
3. Toggle the 24×7 switch, `requestSubmit` the form whose button reads "Save".
4. Reopen the same work center URL → the switch is `aria-checked=true` (persists).

### (b) Job header — slack badge + Best case what-if
1. Navigate — `/x/production/jobs` (NOT `/x/jobs` — 404), click a job (e.g. J000001).
2. The header renders at `/x/job/:id/details`. A slack badge ("Nd early/late" with a
   "Projected completion" tooltip) shows only when the job has a projectedCompletionAt.
3. Open the "More options" menu → click "Best case…".
4. Verify — a "Best case {jobId}" dialog opens showing "Current projection" and
   "Best case projection" (calls the schedule edge function with expediteJobId, persists
   nothing). A non-released job shows "Not scheduled" gracefully.

### (c) Capacity view — Scheduled vs Available on one basis
1. Navigate — `/x/priority/people?view=capacity`.
2. Verify — SCHEDULED and AVAILABLE series; a station with no assignments shows its
   calendar hours (e.g. "9h free"), NOT 0 (the fallback-cliff fix). Sub-tabs "Load" and
   "Due (by due date)". An assumption banner ("Hours assumed from location shifts" for
   rung 2, or "No shifts configured — assuming Mon–Fri, 8h days" for rung 3).

### (d) Dual dates — op due (need-by) vs projected completion

Prerequisite: a released multi-op job. Seed item BUS-STR-001 (3-op routing) via
/x/job/new (item combobox → "BUS-STR-001", deadline "Medium Priority Soft Deadline"
reveals a month/day/year date field; fill + blur commits hidden `dueDate`), then
Release → "Release Job" confirm. Release itself triggers a schedule run.

1. **BOP rows** — /x/job/:id/details "Bill of Process" card. Each op row: the due-date
   picker is `button[aria-label="Calendar"]` whose text is the date; the forecast is a
   plain span "Projected {date}" — `text-muted-foreground` when on target,
   `text-amber-500` + tooltip "Behind target by N day(s)" when projected > due. The span
   is absent when `projectedCompletionAt` is null (e.g. an op with a placement conflict
   like "No qualified operator" never gets a forecast).
2. **Regen wiring** — any schedule input change fires `carbon/schedule.inputs.changed`
   → `mark-schedule-stale` → `schedule-replan-wave` (~30 s debounce). Poll the DB
   (`jobOperation.dueDate/projectedCompletionAt`) rather than sleeping a fixed 90 s.
3. **Job due-date change** — /x/priority/dates card's own Calendar button posts the same
   update as the drag (dnd-kit drag via `agent-browser mouse` does NOT take). Moving the
   job due earlier tightens op dueDates on the next wave; projections stay byte-identical
   when placement is unchanged.
4. **Pin** — picking a date in a BOP op's Calendar writes `dueDate` + `manuallyScheduled`
   immediately. The pin SURVIVES later waves and upstream ops re-derive from the pinned
   op's target start. NOTE: the pin route (`/x/job/methods/operation/due-date` →
   `updateJobOperationDueDate`) does NOT fire `notifyScheduleInputsChanged` — upstream
   re-derivation only appears after the next wave from some other input. The popover
   "Clear" button unpins (null due + manuallyScheduled=false).
5. **Behind-target amber** — a maintenance dispatch with "Takes work center offline"
   (planned window covering the placement) slips projections past the targets: BOP +
   /x/priority/operations ItemCards + MES op detail all flip to `text-amber-500`
   "Proj. {date}" with the "Behind target by N day(s)" tooltip, while op dueDates stay
   byte-identical. Completing the dispatch reverts projections on the next wave.
6. **Best case dialog** — "First behind target: {op} (due X, projected Y)" is appended to
   the bottleneck sentence ONLY when the JOB itself is late (projected day > job due).
   The expedite call can take ~20 s under the local edge-runtime CPU cap — re-read the
   dialog until "Calculating best case…" resolves.
7. **MES** — /x/operations board cards sort by due date/priority (never projection);
   card link → /x/operation/:opId, whose Due Date card shows the "Proj. {date}" line.

## Selector Notes
- The 24×7 field is `switch "Runs 24×7 (lights-out)"`; check state via
  `button[role=switch][aria-checked=true]`.
- Login: the "Sign in with Email" button stays disabled until the email input registers
  in React state — real keystrokes (`agent-browser type`) enable it; a raw `fill` may not.
- Jobs list is `/x/production/jobs`; job detail is `/x/job/:id`.

## Common Failures
- `/x/jobs` → 404. Use `/x/production/jobs`.
- Best case shows "Not scheduled" for Draft/Planned jobs — correct (the edge function only
  schedules Ready/In Progress/Paused jobs; expedite returns null for others).
- Popovers (BOP date picker, dispatch work-center combobox) close between agent-browser
  CLI invocations (live revalidation re-renders). Do open + option-click in ONE
  `agent-browser eval` (dispatch pointerdown/mousedown/pointerup/mouseup/click on the
  option). The "Takes work center offline" Radix switch also needs that full pointer
  sequence — a bare `.click()` does not toggle it.
- `agent-browser type` silently drops "." characters (e.g. in emails) — use `fill`.
- The shared `default` agent-browser session may be owned by another worktree's agent —
  set `AGENT_BROWSER_SESSION=<name>` for an isolated browser (and close only YOUR session).
- Dev-only hydration failure marks the tab title "Error" on /x/priority/dates while the
  board still renders client-side — read `document.body.innerText`, not the title.
- Seed work centers have zero `workCenterShift` rows: an op whose need-by falls at/before
  today runs away ~1 year per subtracted working day (MAX_CONSECUTIVE_CLOSED_DAYS cap in
  need-by-calculator.ts) — e.g. a first op showing "Aug 10, 2024". Known bug surfaced
  2026-08-18, not a test regression.

## Require-staffing policy (per-location) — verified 2026-08-21

Setting: **Settings → Production → Scheduling** card (`/x/settings/production`) lists
the CURRENT company's locations, each with a "Require staffing" switch
(company-scoped — a same-named location in another company is NOT shown). Backed by
`location.requiresStaffing`, written service-role (settings admins lack resources_update).

### Toggle it (Radix switch needs the full pointer sequence, not `.click()`)
```
sw = [...document.querySelectorAll('button[role=switch]')]  // Scheduling switches are the LAST N (one per location)
// dispatch pointerdown/mousedown/pointerup/mouseup/click at the switch center
```
Verify: toast "Staffing requirement enabled/disabled" + DB `location.requiresStaffing`.

### Verify on the forecast (force regen with the Regenerate button, don't wait 30s)
- Regenerate = IconButton aria-label "Regenerate" inside a fetcher form → `form.requestSubmit(btn)`.
- **ON**: an ungated op on a non-lights-out work center with NO manning on the placement
  date becomes an unschedulable PLACEHOLDER (`capacityReservation.isPlaceholder=t`,
  scheduleNote "No operator assigned"). Forecast header shows "N CAN'T BE SCHEDULED";
  clicking the op row → detail sidebar "Unschedulable / No operator assigned / where it
  would run".
- **Lights-out exempt**: set a work center `alwaysOn=true` → its ops still place (ph=f)
  while non-alwaysOn WCs' ops stay placeholders. (My Deno gate: `capacity.workCenter.alwaysOn`.)
- **OFF**: regen → all ops place again (ph=f), header "no conflicts". Byte-identical to pre-setting.
- WC popover ("How are these hours calculated?" info button) gained a line:
  gated → "runs ability-gated work…", ungated → "runs work with no ability requirement…";
  plus a "Staffing required" section only when the location's policy is ON.

## KEY UX GOTCHA (not a logic bug, but reads as "empty/broken")
The forecast opens on **today's Day view**. Forward-ASAP places Ready jobs at the next
available shift — if today is Friday afternoon/weekend, work lands on **next Monday**, so
the default view shows "0 resources · 0 reservations · 0 jobs" even though work IS
scheduled. Navigate to the week that actually contains the placements
(`?range=week&date=<placement date>`) to see it. Placeholders (unschedulable ops) pin at
`now`, so they appear in the CURRENT week even when the real placements are a future week.

## Test-data note (dev seed, company "Carbon Development" / Manufacturing Plant)
- Jobs J000002 (Ready, 3 ops) + J000004 (Ready, 3 ops) at Manufacturing Plant; all ops
  UNGATED (processes: Machining/Weld/Final assembly — requiresAbility=false). Only "Brake
  Press" is gated, on "Press Brake - 700T" (no job op → the floater/double-booking edge
  cases 1–2 aren't reproducible from seed; they're covered by the Deno suite).
- Manning (`peopleAssignment`) is all PAST (Aug 10–14) at CNC Mill / Press Brake — does not
  cover the Aug-24 placements, which is why require-staffing ON makes everything unschedulable.
