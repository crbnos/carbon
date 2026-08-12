# People planning horizons: day vs week vs month

> Naveen's ask (2026-08-01): supervisors should be able to plan a week and a
> month ahead on the people page, not just today. Research: how real products
> structure day/week/month planning. Full agent findings summarized here.

## What the industry actually does

1. **Week is the editing atom everywhere.** No surveyed product does
   station-level drag-assignment at month grain. 7shifts' month view is
   view-only; When I Work's month view drops drag-and-drop, templates,
   coverage and labor tools ("use month view to review and fine tune");
   Deputy's month view is pitched as coverage-by-area + who-is-on-leave, with
   copy/template creation disabled. UKG has no month toggle at all — it loads
   a multi-WEEK range into the same editable planner with week-header rollups
   (weekly total hours for OT balancing).
2. **Month views render coverage + absence, not editable chips.** Truncated
   shift chips (When I Work, ≤6/day then "view all") or coverage/leave
   indicators (Deputy). Nobody renders an editable month grid of assignments.
3. **The mechanism that makes month planning cheap is PROJECTION, not a
   bigger grid**: copy week → future week(s) (Homebase one-click), save week
   as template + apply to date range with conflict policy (When I Work,
   Deputy, Sling), repeating shifts until an end date (Sling ≤1yr), and UKG's
   rotation templates (cycle of N days/weeks, publish From→To or Forever,
   unfilled rows become open shifts, auto-republish).
4. **Manufacturing capacity at month horizon = weekly buckets.** SAP CM01 is
   the exact shape of our Capacity table (Requirements / Available / Load per
   period) with a day/week/month period toggle — and CM01 is read-only
   (evaluation); dispatching happens in CM21. CRP convention: ~8–16 weeks in
   weekly buckets; monthly buckets only at true RCCP range (3–18 months).
   Oracle RCCP plans hours-per-week-per-resource even long-range.
5. **Month-grain supervisor decisions are:** leave approval against coverage,
   rotation upkeep, OT/headcount posture — driven externally by predictive-
   scheduling laws (14-day posting norms) and ~1-month vacation-request
   practice. Day/week decisions are manning and swaps.
6. Project-resource planners (Float/Runn/Hub Planner) use continuous zoom
   instead — works because their object is a multi-day allocation bar, not a
   per-day person→station row; Runn swaps in utilization charts at coarse
   zoom. Not our shape.

## Recommended design for Carbon (phased)

**Phase 1 — Month as an evaluation view (SAP CM01-shaped):**
- Add `Month` to the people page horizon: Capacity gains a Week | Month period
  toggle — same Demand/Scheduled/Available/Load rows, columns become the 4–6
  Monday-start WEEK buckets covering the month (day math already exists; sum
  per bucket). Click a week column header → drills to that week's view.
- Matrix month mode: employee × week grid — assigned hours + OT per week,
  absence days badged; read-only with click-through to the week. This is the
  leave wall-chart supervisors expect at month grain.
- Add a date-picker jump next to the ‹ › arrows (arrows already reach any
  date; a picker makes far dates cheap).
- Board stays day-only (it's the dispatch surface — CM21 analog).
- Caveat: `Scheduled` (capacityReservation) thins out weeks ahead; `Demand`
  (due-date hours) is the real month-horizon signal — show it as such.

**Phase 2 — Projection tools (what actually fills a month):**
- `Copy week → next week(s)`: extend `copyPeopleBoard` (day-grain today) with a
  week variant: copy all 7 days' assignments to the following week(s), skip
  people with absences on the target dates, land as normal rows. One Kysely
  transaction per target week.
- Absence date-RANGE entry (vacation = one action, not 5 daily rows).

**Phase 3 (defer until asked) — repeating patterns:** person→station
rotation repeating every N weeks until an end date (UKG rotation-lite).
High machinery cost; copy-week covers most shops.

## Sources
When I Work month view + templates (help.wheniwork.com, fetched), Deputy
release notes (whatsnew.deputy.com) + help excerpts (403-flagged), 7shifts KB
(excerpt-flagged), UKG schedule patterns (library.ukg.com) + rotation
templates (customer2.kronos.com, fetched), Sling templates/recurring
(support.getsling.com), Homebase copy-week, SAP CM01 (guru99 + SAP community,
excerpt-flagged), Oracle RCCP (docs.oracle.com, fetched), Float/Runn/Resource
Guru/Hub Planner zoom docs, predictive-scheduling compliance guides
(Rippling/Paycor, secondary-flagged).
