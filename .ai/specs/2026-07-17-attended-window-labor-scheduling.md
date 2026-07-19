# Attended-Window Labor Scheduling (named-people booking + lights-out runs)

> Status: draft (design final — ready for /plan)
> Author: naveen + Claude
> Date: 2026-07-17
> Research: [.ai/research/labor-machine-capacity-scheduling.md](../research/labor-machine-capacity-scheduling.md)

## TLDR

Stop holding an operator for an operation's full duration. Reserve the **machine** for the whole operation, but reserve a **named person** only for the *attended window* — setup + labor time at the start of the op — after which the machine runs unattended on calendar time (lights-out, through nights/weekends). The engine picks the person at schedule time from the work center's qualified, on-shift, un-booked people and books him by name (new `Employee` reservation kind), which makes one operator genuinely able to tend N machines with staggered loads and fixes the existing cross-ability double-booking bug. No new tables, no new UI to configure — nothing for shops to forget to maintain. Manual employee→work-center assignment was considered and deliberately deferred (see Open Questions).

## Problem Statement

Today (branch `naveen/capacity-planning`) the engine gates ops on two finite resources: the work center (capacity 1) and an anonymous ability pool ("2 of 3 welders busy") whose members must be on shift. The operator is held for the **entire** op duration. Concretely:

- A job with 5 min of labor and 1 h of machine time holds the operator for the full ~1 h. With one qualified guy and two mills, mill 2 sits dark for an hour at a time even though he's free after loading mill 1 — the schedule claims he's busy when he isn't.
- A 20 h run loaded Friday at 15:00 pauses at shift end and resumes Monday — even when nobody needs to be present for the run.
- Pool bookings are anonymous, so a person qualified in two abilities can be double-booked across them (known gap), and the pool math cannot express "Sam is taken but Alex is free."

Industry consensus (research file): machine = finite primary resource; labor = a skill-matched *secondary* constraint consumed **per phase** (setup/load, not the whole run) — Preactor "Constraint Usage: setup", Asprova sub-resource setup capacity, Infor VISUAL concurrent resources with Setup✓/Run✗, SAP PP/DS secondary resource on the setup activity. Unconfigured labor never stalls scheduling anywhere (Epicor: <5% of installs ever run finite scheduling).

## Proposed Solution

### Model

For a gated operation (process `requiresAbility = true`) with times `setup`, `labor`, `machine`:

| Quantity | Formula | Semantics |
|---|---|---|
| Total work | `total = setup + max(labor, machine)` | unchanged (duration-calculator) |
| Attended window | `attended = setup + labor` | person hands-on, at the START of the op |
| Unattended remainder | `total − attended = max(0, machine − labor)` | machine runs, nobody present |

- **Machine** reserved for the op's whole elapsed span (it's occupied by the workpiece even while paced by shifts).
- **Person** reserved only for the attended window. The attended window **accumulates only during the chosen person's shift windows** (it can span a shift break — the machine sits loaded-idle overnight mid-setup). The unattended remainder accumulates on **calendar time, 24/7** — a run loaded Friday 15:00 finishes over the weekend.
- `labor ≥ machine` ⇒ remainder 0 ⇒ person held throughout — today's behavior degenerates out naturally. Shops whose runs need supervision express it as `labor = machine`.
- `setup = 0 ∧ labor = 0` on a gated process ⇒ attended window is zero ⇒ **no person reservation** (unattended op; respect the data — mirrors E2's "Unattended Operation").
- Ungated ops: machine only, unchanged.

### Named-people booking with shift relay (replaces anonymous pool counts)

At placement the engine accumulates the attended window over time, booking **whoever is actually doing each stretch**:

1. The machine must be free for the whole op span (existing `machineIsFree`).
2. Attended time accumulates at any instant where **at least one eligible person** (qualified for the process's ability — `active ∧ trainingCompleted ∧ not expired`, per `operator-eligibility.ts`) is on shift AND has no overlapping **`Employee` reservation** (any ability, any work center — this kills cross-ability double-booking).
3. Each contiguous stretch is booked to a specific person (`resourceKind: 'Employee', resourceId: employeeId`); at shift boundaries the op **hands off** to the next available person (relay). Continuity heuristic: keep the incumbent while he remains on shift and free; on a boundary prefer the person yielding the earliest continuation (tie → fewest reserved hours).
4. When **nobody** eligible is available (no night shift, everyone booked, vacation), the op **pauses** — the machine stays loaded and reserved so nothing else can take it — and resumes at the next instant someone qualified is free. The pause shows up in the finish date and the schedule note ("Waited Nh for a qualified operator"). Zero eligible people at all ⇒ placement conflict, as today.

A 20 h fully-attended op in a two-shift shop books as Sam 08:00–16:00 → Dave 16:00–24:00 → Sam 08:00–12:00 — three named segments, one op, continuous progress. The names are a *plan*, not a lock — the floor can still swap people at execution; MES gating (qualification to start an op) is unchanged.

One guy, two mills, 5-min loads: the engine books Sam 8:00–8:05 on mill 1 (runs to 9:05) and 8:05–8:10 on mill 2 (runs to 9:10). Both machines live, one person, zero configuration.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Operator hold | Attended window = setup + labor at op start; machine full span | User decision; consensus pattern (VISUAL Setup✓ + front-loaded Duration%, Preactor setup usage, SAP secondary-on-setup) |
| Unattended remainder pacing | Calendar time 24/7 (lights-out) | User decision (Sam-goes-home-at-16:00 example); `labor = machine` is the opt-out |
| Attended pacing | Chosen person's shift windows only | The hands-on part needs the hands; machine sits loaded-idle across his breaks |
| Who is booked | Named people (`Employee` reservation kind), engine-picked, **one reservation row per person-segment** | User decision; anonymous pool math breaks across machines and double-books across abilities |
| Long attended ops across shifts | **Relay** — hand off to the next available qualified person at shift boundaries; pause (machine stays loaded) when nobody is available | User decision (2026-07-17); preserves today's continuous-progress behavior for multi-shift shops |
| Person choice heuristic | Keep the incumbent while on shift & free; at boundaries earliest continuation, tie → least reserved hours | Continuity first; matches existing WC candidate heuristic; fair spread |
| Manual employee→WC assignment | **Deferred** (not in v1) | User decision after seeing auto-pick covers the 1-guy-N-machines case with zero config; industry ships assignment only as an optional restriction layer |
| Zero attended window on gated op | No person reservation | Respect the data (E2 "Unattended Operation"); avoids phantom holds |
| Schema (heuristic 1) | **No new table.** One enum value: `ALTER TYPE "capacityResourceKind" ADD VALUE 'Employee'` | `capacityReservation` already has `resourceKind + resourceId`; `resourceId` = employee id for the new kind |
| `OperatorPool` kind | Enum value kept (can't drop enum values); engine **stops writing** pool rows; old rows age out via delete-by-job on each replan | Zero-migration data path; readers must tolerate both kinds during transition |
| RLS (heuristic 3) | Unchanged — `capacityReservation` policies already exist | No new table |
| Service shape / forms / module layout (heuristics 2,5,6) | N/A — engine + timeline only; no new routes/forms/services | v1 has no UI writes |
| Permissions (heuristic 4) | Unchanged — `schedule` edge fn auth path untouched | No new surface |
| Backward compat (heuristic 7) | `resourceTimeline`/timeline UI and `getCapacityReservationsForResources` read reservation kinds — update to recognize `Employee` (render like today's pool rows, but groupable by person) | The only consumers of `OperatorPool` rows |
| Staleness | No new event kinds | Qualification/shift edits already stamp stale; there is no assignment entity to watch |
| Conflict messages | Taxonomy unchanged (`operator-*` arms); blocker attribution reads the chosen person's `Employee` reservations | Person-naming in messages ("waiting for Sam") is a later nicety |

## Data Model Changes

```sql
-- Migration: add the Employee reservation kind (no table changes)
ALTER TYPE "capacityResourceKind" ADD VALUE IF NOT EXISTS 'Employee';
-- For kind 'Employee', capacityReservation.resourceId = employee ("user") id.
-- OperatorPool remains a legal value; the engine no longer writes it.
```

Run `pnpm run generate:types` after applying. No RLS/index changes (existing `(resourceId, startAt, endAt)` index serves person lookups).

## Engine Changes (`packages/database/supabase/functions/lib/scheduling/`)

1. **`duration-calculator.ts`** — export `calculateAttendedHours(op) = setup + labor` (hours, same unit conversions as total).
2. **`slot-allocator.ts`** — two-phase allocation replacing pool logic:
   - `allocateOperation` gains person-segmented accumulation: phase 1 walks forward from `earliestStart` accumulating `attended` hours over instants where the machine is free AND some eligible member is on shift and un-booked, emitting one segment per (person, contiguous stretch) with the continuity heuristic at boundaries; phase 2 extends the span by the unattended remainder on calendar time (machine free throughout; no person check). Returns the segment list (`employeeId`, start, end), full span, and `WaitAttribution` (machine vs operator, as today; operator blockers drawn from the eligible members' `Employee` reservations in the wait region).
   - `poolIsFree`/union-window accumulation retired for gated ops; ungated path unchanged (machine only, calendar windows).
3. **`work-center-selector.ts`** — candidate loop unchanged in shape (per work center, earliest finish wins); commits planned reservations per gated op: one WorkCenter row (full span) + **one `Employee` row per attended segment** (`resourceId = employeeId`). In-run bookkeeping keyed per employee (`reservationsByEmployee`), replacing `poolReservationsByAbility`.
4. **`scheduling-engine.ts`** — `buildFiniteContext` buckets live `Employee`-kind rows per employee id (tolerating legacy `OperatorPool` rows by mapping them into every member's busy-set is **not** attempted — they simply stop constraining after each job's first replan, acceptable because the reactive-replan wave refreshes everything); persistChanges unchanged (delete-by-job + insert).
5. **`master-data-provider.ts`** — `getLiveReservations` already returns all kinds; no query change.
6. **Timeline UI** (`apps/erp/.../Schedule/timeline.ts`, `resourceTimeline.ts`) — treat `Employee` rows where `OperatorPool` rows were consumed; person lanes become possible (name from employee id) but v1 only needs parity rendering.

## API / Service Changes

None (no new routes/services; the `schedule` edge function payload is unchanged).

## UI Changes

Timeline parity only (above). No forms, no new pages. (The deferred assignment feature would add a work-center "assigned operators" editor — out of scope.)

## Acceptance Criteria

- [ ] Two ops (5 min labor, 1 h machine) at two different work centers, one qualified employee: both machines run **in parallel**; the person's two `Employee` reservations are back-to-back 5-min windows that never overlap.
- [ ] 20 h fully-attended op (`labor = machine = 20h`) with two qualified people on complementary shifts: work continues across the shift boundary with a handoff — multiple `Employee` segments, distinct people, no gap.
- [ ] Same op with only ONE qualified person (day shift): op pauses at his shift end (machine reservation continuous, no `Employee` reservation overnight) and resumes next shift.
- [ ] Same two ops at **one** work center: they queue on the machine (capacity 1) — machine reservations never overlap.
- [ ] Op with 5 min labor + 20 h machine loaded at 15:00 before a 16:00 shift end: finishes ~11:05 next day (runs overnight); the person's reservation is only 15:00–15:05.
- [ ] Op with `labor = machine`: person reserved for the whole span; run pauses off-shift (current behavior preserved).
- [ ] Gated op with `setup = 0, labor = 0`: no `Employee` reservation; machine-only placement.
- [ ] Person qualified in TWO abilities: ops needing different abilities can never book him at overlapping times (cross-ability regression).
- [ ] SQL invariants after replanning the fixture jobs: zero overlapping WorkCenter reservations per machine (non-manual, live); zero overlapping Employee reservations per person.
- [ ] Conflict/schedule notes still attribute waits correctly (machine-queue vs operator arms) with the person's bookings as the operator-blocker source.
- [ ] Deno suite green (`deno test lib/scheduling/`), timeline vitest green, no new type errors in touched files.

## Open Questions

- [x] Machine run after the attended window — pause on shifts or run 24/7? — **Answer:** run 24/7 (lights-out); shops needing supervision set `labor = machine`. (User, 2026-07-17)
- [x] Can one employee cover multiple work centers? — **Answer:** yes — moot for v1 (no manual assignment), and auto-pick naturally interleaves one person across machines. (User, 2026-07-17)
- [x] Booking granularity — anonymous pool counts vs named people? — **Answer:** named people (`Employee` kind); fixes per-machine correctness and cross-ability double-booking; name is a plan, not a lock. (User, 2026-07-17)
- [x] v1 scope — build manual employee→work-center assignment now? — **Answer:** no; auto-assign only. Assignment ships later as a restriction layer (assigned set narrows the eligible people per work center; an assigned person leaves other machines' pools) if station discipline is requested. (User, 2026-07-17)
- [x] Attended window contiguity across shift breaks? — **Answer (design):** attended time accumulates across eligible people's shift windows (machine loaded-idle in gaps); enforced by phase-1 accumulation.
- [x] Long attended op when the person's shift ends mid-op — hold him, pause, or hand off? — **Answer:** hand off (relay) to whoever qualified is available next; when nobody is available the op pauses with the machine still reserved, resuming at the next free qualified person; never assume overtime. (User, 2026-07-17)

## Out of Scope (v1)

Manual employee→work-center assignment (+ its board/editors); fractional attention (< whole person during run); machine maintenance calendars; person-naming in conflict messages; MES "suggested operator" display; costing changes (labor cost math untouched).

## Changelog

- 2026-07-17 — Spec written after research (14 systems) and user interview (6 questions resolved, incl. scope cut of manual assignment and shift-relay handoff for long attended ops). Design final; ready for /plan.
