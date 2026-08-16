# Forecast-First Finite Scheduling

Last tested: 2026-08-13
Routes: /x/resources/work-centers/:id, /x/job/:id, /x/priority/people?view=capacity

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
