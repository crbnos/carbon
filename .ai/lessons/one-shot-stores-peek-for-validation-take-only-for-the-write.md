---
paths: []
triggers: []
promoted: null
---
# One-shot stores: peek for validation, take only for the write

**Context:** The Onshape panel's plan/apply split stores a reviewed plan in Redis and consumes it with GETDEL so a double-submitted apply cannot write twice.

**Problem:** Taking the plan before validating the user's edits meant a 422 (one bad field) destroyed the review; the corrected retry hit 410 and forced a fresh Onshape read. The one-shot guarantee and the validation step were fighting over the same read.

**Rule:** For any GETDEL-style one-shot record, validate against a peek (plain GET) and take the record only immediately before the first write. A rejected request must leave the record exactly as it was.

**Applies to:** `packages/ee/src/onshape/lib/panel-plan-store.ts`, any Redis-backed one-shot token/plan/challenge consumed by a request that also validates input.
