# Surface unschedulable operations on the Forecast

> Date: 2026-08-18
> Branch: naveen/capacity-planning
> Problem: an operation that can't be placed (no qualified operator for its ability,
> no feasible slot, horizon-exhausted) leaves NO `capacityReservation` row. The
> Forecast Gantt is built entirely from reservations, so the job "hangs" after the
> last placeable op — no bar, not counted in the conflict badge, and
> `job.projectedCompletionAt` wrongly reports an early finish. On the ops Kanban the
> same conflict IS visible (that path reads `jobOperation.hasConflict` directly).

## Root cause (verified)

- `work-center-selector.ts:536-538` short-circuits the no-qualified-operator case;
  the op falls into the `best === null` branch (`:778-801`) which stamps
  `hasConflict/conflictReason` + a fallback work center but emits **no**
  `plannedReservation`.
- `persistChanges` (`scheduling-engine.ts:1018`) only inserts `capacityReservation`
  rows from `plannedReservations`, so nothing represents the op.
- `projectedCompletionAt` (`scheduling-engine.ts:731-742`) is the max over placed
  ends + planned reservations → excludes the unplaced op.
- Forecast (`forecast.tsx` → `getCapacityReservationsForResources` →
  `buildResourceTimeline`) and its `conflictCount` (`forecast.tsx:394-396`) are
  100% reservation-driven → the op is invisible.
- Bonus bug: an unplaced op sets no `placedEndByOperation`, so its **successors**
  schedule from `now` as if it finished instantly.

## Approach: Option A — engine emits a flagged placeholder reservation

When an op can't be placed, emit a **placeholder** `capacityReservation` at the
earliest feasible start (`earliestStart`, after predecessors) for the op's
work-content duration in calendar time, on the fallback work center, flagged
`isPlaceholder = true`. It:
- renders on the Forecast (distinct "blocked" bar) and folds into the conflict count,
- pushes `job.projectedCompletionAt` to (at least) this op — honest,
- chains successors after it (`placedEndByOperation`),
- but must **NOT** hold capacity against other jobs → `getLiveReservations`
  excludes `isPlaceholder = true`, and it is NOT pushed into the in-run
  `capacity.reservations` blocking set.

### Why a column (not derive from `hasConflict`)

A late-but-placed op is ALSO `hasConflict` yet is a REAL capacity hold. Only a
dedicated marker can distinguish "shown but non-binding." Cheapest correct marker:
one boolean on `capacityReservation`.

## Tasks

1. **Migration** `…_capacity-reservation-placeholder.sql`:
   `ALTER TABLE "capacityReservation" ADD COLUMN "isPlaceholder" BOOLEAN NOT NULL
   DEFAULT false;` + COMMENT. Apply + `pnpm run generate:types`.
2. **Engine types** (`functions/lib/scheduling/types.ts`): add
   `PlannedReservation.isPlaceholder?: boolean`.
3. **`work-center-selector.ts`** `best === null` branch: when `durationHours > 0`
   and a fallback work center exists, compute `end = earliestStart + durationHours`
   (calendar ms, like outside-processing at `:380`), push a placeholder
   `PlannedReservation` (`isPlaceholder: true`, `resourceKind: "WorkCenter"`,
   `resourceId: fallbackWc`, `scheduleNote` = the conflict), and
   `placedEndByOperation.set(op.id, end)`. Do NOT touch `capacity.reservations`.
   Keep the existing selection (conflict + fallback WC, no placed dates).
4. **`scheduling-engine.ts` `persistChanges`**: map `isPlaceholder` on the insert.
   (The `endAt > startAt` filter already lets it through.)
5. **`master-data-provider.ts` `getLiveReservations`**: add
   `.where("cr.isPlaceholder", "is not", true)` so placeholders never occupy
   capacity for other jobs / next regen.
6. **Deno tests** (`work-center-selector.test.ts` / `determinism.test.ts`):
   no-qualified-operator op → a placeholder reservation is emitted, is NOT in the
   capacity blocking set, and successors chain after it. Placement of OTHER jobs is
   byte-identical with/without the placeholder present.
7. **Service** (`production.service.ts` `getCapacityReservationsForResources`):
   select `isPlaceholder`.
8. **`resourceTimeline.ts`**: thread `isPlaceholder` onto
   `ResourceTimelineReservation` → the bar keeps `isError` red but gets a distinct
   `style.icon` (blocked/ban) so "can't be scheduled" reads differently from
   "scheduled but late"; pass `isPlaceholder` into the reservation `detail`.
9. **`timeline.ts` / `TimelineDetail.tsx`**: add `unschedulable` to the detail type;
   a placeholder reservation shows an **"Unschedulable"** status chip (red), renders
   date-only (no fictional booked clock time / relative time), and an explanatory
   line: "This operation can't be scheduled — {reason}. The bar shows where it would
   run once resolved."
10. **`forecast.tsx`**: map `isPlaceholder` through; conflict badge already counts it
    (the reservation now exists). Add a one-line header summary
    "{n} can't be scheduled" next to the conflicts badge (distinct wording).
11. **i18n**: `pnpm lingui:extract` for the new strings (then `/translate` at commit).

## UI mechanism (the "figure out a mechanism" ask)

Three layers, cheapest-first, all riding the existing pipeline:
- **Bar**: distinct icon (blocked) + red — visually separates unschedulable from late.
- **Detail panel**: dedicated "Unschedulable" chip + the reason + "where it would run"
  explanation, date-only (the span is a placeholder, not a booking).
- **Header**: a small "{n} can't be scheduled" count beside the existing conflict badge.

## Verification

- `deno test lib/scheduling/` from the functions dir (new + determinism cases green).
- `pnpm exec turbo run typecheck --filter=@carbon/erp --filter=@carbon/database`.
- Browser (`/auth` + `/test`): a job whose last op needs an ability nobody holds now
  shows a distinct blocked bar right after its previous op, the conflict/"can't be
  scheduled" counts fire, and the detail panel explains it.

## Out of scope (noted for later)

- Whether `projectedCompletionAt` should become a "never" sentinel when a job has an
  unschedulable op (vs. the placeholder end). Current change makes it honest-er
  (extends to the placeholder), which is strictly better than today.
