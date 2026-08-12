# "Working hours" editor popover for the people surfaces

> Naveen's ask (2026-08-03, with a Connecteam-style "Shift details" screenshot):
> add a popover like this to edit working hours at a station; research the
> direction and where else the pattern should apply.

## What the survey found (7 workforce tools + guidance)

- **Anchor**: every competitor opens the editor from the employee×day grid
  cell (single click, pre-filled person/date). Hover is never the primary
  editor. Existing shifts: click the chip.
- **Time entry**: the shipping consensus is a hybrid combo field (type OR
  pick); NOBODY ships the screenshot's hour/minute spinner as the desktop
  primary — that's a mobile-derived widget. Best keyboard-first pattern per
  React Aria/Spectrum + NN/g: segmented time field (hh · mm · am/pm segments,
  arrow-key steppable) — which @carbon/react's TimePicker already is.
  NN/g: steppers only for small nudges from a good default; long time
  dropdowns are an anti-pattern.
- **Duration vs clock time**: hourly schedulers (Connecteam, Homebase,
  Deputy, When I Work, Sling, 7shifts, QB Time) store clock times; capacity
  planners (Float) store hours/day. The proven bridge is Deputy's
  duration-preserving sub-shift blocks (duration is the invariant, clock
  start/end recompute) and its default-duration → end-time computation. No
  mainstream tool lets a supervisor type "4h at Station A" — Float is the
  direct analogue for our hours-ledger model.
- **OFF-day toggle**: the screenshot's "Set as OFF day" maps to
  Connecteam's absence model (absence days still resolve to default hours
  for capacity math). In most tools unavailability is a separate object; a
  day-state control at the top of the editor is still the right move for us
  (we already have peopleAbsence).
- **Validation**: non-blocking "concern" warnings dominate (When I Work
  lets managers override double-booking/over-hours); hard errors only for
  incoherent input (end<start where overnight is disallowed). Overnight:
  hourly tools auto-wrap end<start to next day with a "+1 day" hint rather
  than erroring.
- **Live totals**: Homebase/7shifts recompute hours/labor live; a footer
  duration echo is standard.
- **Propagation** (copy to other days) lives OUTSIDE the popover (duplicate
  menus, drag-copy, copy week) — inside there's only recurrence.

## Recommended design for Carbon

**Duration-first, times as derived echo** (matches our `hours` ledger and
what the engine actually schedules — sequential dealing from shift start):

`PeopleHoursPopover` (shared component), anchored on the trigger chip/cell:
1. Title "Working hours" + context (person · station/day).
2. Top: **Set as OFF day** toggle → absent/clear-absence intents; flipping
   it disables (not deletes) the rows below.
3. **Station rows** for that person's day: `Station — [hours ±0.5 stepper +
   free typing]` with ✕ per row and **+ Add station** (assign remainder);
   defaults from the shift ladder.
4. Derived clock echo per row ("8:00 – 11:00") computed from shift start +
   sequential offsets — display-only in phase 1 (honest: it is exactly what
   the engine schedules).
5. **Overtime** as an explicit +h field (never a longer clock range) with a
   live footer total: "6h + 2h OT = 8h of 8h"; over-capacity renders as an
   amber non-blocking warning, Save disabled only for incoherent input.
6. Explicit Cancel/Save (atomic submit) — not autosave.

**Where it applies**
- Phase 1 — Day board card: replaces the small hours-stepper popover AND
  absorbs the Absent + Overtime actions (card action row shrinks to
  Note/Remove).
- Phase 2 — Matrix: click an employee×day cell → same popover (the
  grid-cell anchor everyone ships); the matrix becomes editable.
- Phase 3 (only if a shop asks) — real clock-time segments: startTime/endTime
  columns + engine clipping to exact times; the popover's time echo becomes
  editable (Deputy bridge: edit times ⇄ recompute hours).

**Open decision**: stay duration-first (recommended, no schema change) vs
clock-times as the input of record (schema + engine change).

Sources: Connecteam help 8986051/6569813/6470081/6420265, Deputy
4688731978639/4689058471567/10611651590159, When I Work scheduling-a-shift,
7shifts 4417514096915/4417504953491, Sling 511129/1078490, QB Time L6yAda11X,
Homebase 115003397932, Float 4188692, NN/g input-steppers + dropdown
articles, React Aria TimeField, Material 3 time pickers. Flagged: the exact
"Shift details / Set as OFF day" widget isn't in Connecteam's public docs
(model confirmed, anatomy from the screenshot); Homebase/7shifts help pages
partially blocked (indexed summaries).
