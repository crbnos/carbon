---
paths: []
triggers: []
promoted: null
---
# A degenerate-input guard on a scheduling surface is a silent-vanish bug, not defensive coding

**Context:** The batch pre-pass had `if (durationSeconds <= 0) continue;` — a released batch whose member operations all carry zero setup/labor/machine time (routinely true for freshly-authored routings) was skipped entirely: no reservation, no auto work-center selection, nothing on the reservation-driven Forecast. The user released BAT000005 and it simply didn't exist anywhere schedule-shaped, indistinguishable from the (separate) dead-Inngest failure being debugged at the same time.

**Problem:** Zero/empty/unsized work still EXISTS. On surfaces whose only rendering source is a derived row (the Forecast draws `capacityReservation` rows and nothing else), a "skip nonsense input" guard doesn't degrade gracefully — it erases the entity, and the erasure reads as any of five other failures (event bus down, filter bug, RLS, wrong week, stale registration).

**Rule:** In the scheduling engine, degenerate input never `continue`s past a persistence step — it emits the flagged placeholder shape (`isPlaceholder = true`, honest `workHours`, a `conflictReason` naming the DATA gap and its fix) so the entity stays visible and self-diagnosing. Match the unplaceable-op precedent; give the placeholder a nominal drawable window when true content is zero.

**Applies to:** `packages/ee/src/planning/scheduling/batch-scheduler.ts`, `work-center-selector.ts` placeholder branches, and any future pre-pass/what-if that turns entities into reservations or timeline rows.
