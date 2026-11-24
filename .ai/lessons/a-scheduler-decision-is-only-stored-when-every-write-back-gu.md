---
paths: ["packages/planning/src/scheduling/apply-work-center-selections.ts", "packages/planning/src/scheduling/run-overlay.ts", "packages/planning/src/scheduling/scheduling-engine.ts"]
triggers: ["applyWorkCenterSelections", "placementWrites", "buildWrites"]
promoted: null
---
# A scheduler decision is only stored when every write-back guard agrees

**Context:** The scheduler balances an operation that has not started onto any work center of its process (F10, 2026-10-26).

**Problem:** Two separate "never overwrite a stored work center" guards sat between the decision and the database: one in `applyWorkCenterSelections`, one in the engine's `buildWrites`. Fixing the first one alone changed nothing in the database. The `capacityReservation` row named the chosen station while `jobOperation.workCenterId` kept the old one, and every unit test still passed.

**Rule:** When you change what the scheduler decides, trace the value to the write (`placementWrites`, `run-overlay.ts`). Test the decision and the write together, then remove the write fix and confirm a test goes red.

**Applies to:** `packages/planning/src/scheduling/` — `apply-work-center-selections.ts`, `run-overlay.ts`, `scheduling-engine.ts`.
