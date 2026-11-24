---
paths: ["crates/planner/src/**"]
triggers: ["path_blockers", "contacts_at"]
promoted: null
---
# Profile the planner before optimizing — the flood was pass-through, not self-collision

**Context:** Motion planning took ~3 min (seat rail) / >30 min (harness). A micro-benchmark showed a 2,000× per-sample cost for a part colliding with its own seated copy (it stays registered in the manager), so the "obvious" fix was to unregister the moving part during its own sweeps. Implemented, byte-identical output — and **zero real-model speedup** (191→211s). cProfile told the truth: 86% of total time was `_contacts_at` under `_path_blockers`, dominated by **pass-through enumeration** — sweeping a part THROUGH its blockers enumerates the blocker's full triangle-contact set (53M contact objects on a 31-part model) at every sample for the whole travel, when all `_path_blockers` needs is each blocker's identity, discovered once.

**Problem:** Micro-benchmarks measure the mechanism you built them around, not the workload. Self-collision flooding is real but self-overlap ends early in most sweeps; deep pass-throughs persist for hundreds of samples and were the actual cost. The two look identical from the outside (both are "too many contacts").

**Rule:** For planner performance work, cProfile the real model FIRST (`cProfile.run('plan_step(...)')` — 30s of setup) and read cumtime by caller before choosing a lever. The winning fix: in `_path_blockers`, once a partner is recorded as a blocker, unregister it from the broadphase for the remainder of the sweep and re-register before returning (`registerObject`/`unregisterObject` on the SAME CollisionObject rebuilds nothing — the BVH lives on the geometry). Seat rail 191–211s → 20–26s (8×), harness >30min → 9.5min, byte-identical sequences. Keep the self-unregister too (it's what makes the synthetic test suite 8× faster), but don't mistake it for the fix.

**Applies to:** `crates/planner/src` sweep functions (`_path_blockers`, `_contacts_at`, `_unregistered`); any future "collect all X along a path" collision query.
