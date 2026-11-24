---
paths: []
triggers: []
promoted: null
---
# Penetration tolerances must stay far below sample spacing

**Context:** The planner allowed 1.5mm "thread depth" penetration along a fastener's axis versus ALL parts, with collision samples every 2.0mm, to make solid-thread models removable through their nuts.

**Problem:** Tolerance ≈ spacing means a thin blocker (1mm washer, flange, cover) can pass between samples entirely below the allowance — the part "removes" through solid metal, which scrambles the greedy disassembly order downstream. A blanket allowance also applies to parts that have nothing to do with the threads.

**Rule:** Scope allowances to the specific mating pair that justifies them (fastener ↔ its detected threaded mate, capped at the seated interference + margin), keep the global tolerance an order of magnitude below sample spacing, and locally refine sampling near any contact that approaches the tolerance.

**Applies to:** `crates/planner/src` collision sampling; any sampled sweep/clearance check.
