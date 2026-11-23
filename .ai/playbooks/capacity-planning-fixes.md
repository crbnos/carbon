# Capacity planning: scheduler, holidays, shifts, qualifications

Last tested: 2026-10-26
Routes: /x/people/shifts, /x/people/holidays, /x/resources/processes, /x/resources/work-centers,
/x/resources/abilities, /x/resources/ability/:id/employee/:eaId, /x/part/new, /x/job/new,
/x/production/batches/new, /x/scheduling/forecast, /x/priority/people?view=capacity|board,
/x/priority/operations, /x/resources/assignments, /x/resources/contractors, MES /x/operations

Covers the 8 fixes in `.ai/plans/2026-10-26-capacity-planning-high-fixes.md` (F1, F5, F6, F10, F12,
F16, F26, F27). Build your own data — do not judge a fix on the demo data's state.

## Prerequisites
- Dev stack up (`crbn up`) INCLUDING the Inngest worker: every input change is applied by the
  debounced replan wave (~30 s). Poll `job.scheduleOutdatedReason IS NOT NULL` to 0 instead of sleeping.
- Demo dataset (satellite) seeded; the Manufacturing Plant location exists.

## Fixture (build it first, all at Manufacturing Plant)
1. Shift — /x/people/shifts/new: Name "QA Shift", Location "Manufacturing Plant", end time 16:00
   (default 08:00–17:00 Mon–Fri; lower the end hour segment once with ArrowDown).
2. Process — /x/resources/processes/new: Name "QA Process", Default Unit "Hours/Piece", Batchable ON.
3. Work centers — /x/resources/work-centers/new twice ("QA Cell A", "QA Cell B"): Processes
   "QA Process", Operating hours "Some Shifts", Shifts "QA Shift".
4. Part — /x/part/new: Part ID "QA-PART-1", Replenishment "Make". Add ONE method operation
   (4 Hours/Piece on QA Process). The BOP editor is hard to drive; inserting the `methodOperation`
   row with SQL is acceptable. Check it shows at /x/part/:itemId/make/:makeMethodId.
5. Jobs — /x/job/new three times (Item QA-PART-1, qty 1, defaults), then release each from the job
   page: button "Release" → dialog button "Release Job".

Expected plan (shift 08:00–16:00, 4 h ops, 2 stations): two jobs start now (one per station) and
finish next morning; the third follows on the first station to free up. Every op's stored
`workCenterId` equals its booking's station.

## Checks
- F1 Capacity (`?view=capacity`): the QA stations' Scheduled split by working time — e.g. a
  13:00 Mon → 09:00 Tue booking reads 3.0 Mon / 1.0 Tue, never hours on nights or weekends.
- F10: set one QA op's stored work center to the other station (SQL), Regenerate (Forecast
  header refresh button, aria-label "Regenerate") → stored station moves to the booked one.
  Ops board and MES columns must equal stored stations.
- F5: edit QA Shift end time → exactly the QA jobs are stamped "Shift hours changed"; after
  the wave no QA booking falls outside the new hours. Deleting QA Shift stamps them
  "Shift removed".
- F16: create a holiday on a weekday (/x/people/holidays/new) → all released jobs stamped
  "Company holidays changed"; no booking starts/ends that day; Capacity Available 0 and no
  "Nh staffed" note that day; Forecast shades it. Edit it to another day, then delete it.
- F6: batch builder `/x/production/batches/new?location=<loc>&process=<QA Process>` → tick two
  QA rows, "Create & Release" → confirm dialog "Create & Release". The Sequential batch
  (≈ 8 h) starts NOW on a QA station (not behind its members' old bookings) and stays put
  across 3 Regenerates.
- F12: /x/resources/abilities/new → Process "QA Process" (makes it gated). Add Test via
  /x/resources/ability/:id/employee/new (Employee "Test", Expires At). Man Test on a QA cell for
  one day (SQL `peopleAssignment`, shiftId = QA Shift to avoid the per-day unique key). Expiry =
  that day → gated op is a placeholder; expiry = next day → booked that day. People board
  `?view=board&range=day&date=<day>` shows the amber "Missing" triangle only when the expiry is
  that day. Abilities table hides the person when expiry is today.
- F26: /x/resources/training/new "QA Training" → header "Publish" → confirm "Publish". Then
  /x/resources/assignments/new: Training "QA Training", assign-to picker → type "Test" → the
  person row. List shows Assigned 1; drawer lists Test; "Mark Complete" records a completion.
- F27: /x/resources/contractors/new (Supplier, Supplier Contact, Hours per Week). No UI adds
  contractor abilities — insert one `contractorAbility` row with SQL. Save the edit drawer
  unchanged and with new hours → abilities stay 1. Help text reads "…for reference. The
  scheduler does not book contractors on operations."

## Cleanup
Delete, in one transaction: QA capacityReservations, the batch (null `jobOperation.jobOperationBatchId`
first), the 3 jobs, trainingCompletion/assignment/training, contractorAbility/contractor,
peopleAssignments, employeeAbility/ability, workCenterShift/workCenterProcess, methodOperation,
work centers, process, shift, item. Then Regenerate.

## Selector Notes
- Shift/holiday/expiry time and date fields are react-aria spinbuttons: focus the segment
  (`[role=spinbutton]`, index by position) and use ArrowUp/ArrowDown or digit key presses;
  `fill` does not reach them. Check the hidden input (`input[name=endTime|date|expiresAt]`).
- Shift weekday toggles are switches with `id="monday"` … `id="sunday"`.
- Process "Requires Ability"/"Batchable" are `button[role=switch]` with that aria-label.
- Drawer forms: submit with `requestSubmit` on the drawer's own form ("Save").
- Board/People: `range=day` is required for the Day board; the Week board shows no
  missing-qualification warning.
- macOS has no `timeout`; if agent-browser hangs, `agent-browser --session <s> close`, then log in
  again at /login with DEV_BYPASS_EMAIL.

## Common Failures
- Pressing Escape inside a drawer combobox closes the whole drawer.
- A notify sent but nothing re-plans → the Inngest worker is not running.
- A station manned on a day books ungated ops inside the manned window even when it is free
  earlier (existing behaviour, same on main) — remove fixture assignments before timing checks.
