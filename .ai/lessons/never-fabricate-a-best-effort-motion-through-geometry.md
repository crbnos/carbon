---
paths: ["crates/planner/src/**", "packages/viewer/src/fallback.ts", "packages/viewer/src/AssemblyPlayer.tsx"]
triggers: ["generateAssemblyStepsFromPlan", "blockedBy"]
promoted: null
---
# Never fabricate a "best-effort" motion through geometry

**Context:** The assembly motion planner (`crates/planner/src`) had a tier-4 "forced removal" that gave unsolvable parts a straight-line motion through whatever blocked them, so every part animated. On the seat-rail assembly 6/30 parts got 48–647mm fly-through motions early in the sequence — the whole animation read as wrecked.

**Problem:** A fabricated path is worse than no path: it renders as a collision, erodes trust in every other step, and hides the real geometric finding (interlocked unit, embedded solid, missing mate exemption) behind a fake answer.

**Rule:** When a solver can't prove a result, emit an explicit flagged state (`motion: "none"` + `blockedBy` + warning) and give the UI a degraded-but-honest rendering (fade-in at the seated pose). Never ship a fabricated approximation of a geometric/physical claim. Same for display fallbacks: an AABB "least-blocked direction" guess may only be used where it's labeled as a guess, never silently for planner output.

**Applies to:** `crates/planner/src`, `packages/viewer` (fallback.ts, AssemblyPlayer), `generateAssemblyStepsFromPlan`.
