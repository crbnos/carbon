---
paths: []
triggers: []
promoted: null
---
# A tested `assert*` helper that is never imported is worse than none — it reads as a guard that is not there

**Context:** `batch-time-split.ts` exported `assertAllOperationsClaimed` (concurrent-claim race guard) and `assertBatchWorkCenterMutable` (completed-batch immutability guard), both unit-tested. Neither was ever imported by the `batch-operations` edge function — the `update` branch happily re-pointed a Completed batch's work center, and the claim had no `IS NULL` race guard.

**Problem:** The presence of a well-named, tested guard function signals "this invariant is enforced." A reviewer (and the author) reads the export list and assumes coverage. Dead safety helpers give false confidence precisely where the risk is highest.

**Rule:** Wire a safety `assert*` into its call site in the same change that introduces it, or don't write it yet. When reviewing, grep every exported `assert*`/guard for a real importer — an unused one is a finding, not dead weight to leave. Duplicated cross-runtime logic (Node + Deno copies) should re-export one source (`precision.ts` / `batch-time-split.ts` pattern) rather than rely on "keep in sync" comments.

**Applies to:** `packages/utils/src/**`, `packages/database/src/**`, any exported guard/assert helper.
