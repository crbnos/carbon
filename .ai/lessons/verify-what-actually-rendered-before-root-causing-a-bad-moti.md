---
paths: ["packages/viewer/src/AssemblyPlayer.tsx", "packages/viewer/src/fallback.ts", "packages/viewer/src/validate-motion.ts", "crates/planner/src/**"]
triggers: ["displayMotionForStep", "synthesizeFallbackMotion", "assemblyPlanJob"]
promoted: null
---
# Verify what actually rendered before root-causing a "bad motion" report

**Context:** A user reported step 4's screw+washer "colliding through the 3D MARKETING and seat rail clamp" and asked for a motion-planning refactor. A trimesh/FCL sweep of the STORED motion against the real GLB meshes showed it was collision-free against the entire model — and the only geometrically feasible insertion (the reverse sense jams the washer into the clamp bore by 3.4mm). The visible garbage came from elsewhere: a re-motion job was still running, so steps played stale/"none" motions through the collision-blind AABB display fallback, on top of 26 never-installed components being rendered solid.

**Problem:** A "the animation collides" report conflates at least four layers: the stored plan motion, the display-time fallback synthesis (`displayMotionForStep` → `synthesizeFallbackMotion`), display adjustments (`exaggerateMotion`), and the visibility model (what else is on canvas). Root-causing the planner first is attacking the strongest layer — the geometry service's motion had `verified: true` and meant it.

**Rule:** Before touching planner code for a visual-collision report: (1) check `assemblyPlanJob.status` — Queued/Processing means the user watched placeholder motions; (2) dump the step's stored `motion` from `assemblyInstructionStep` and sweep it against the GLB (the `collision` crate, or a small trimesh script; storage files live in the storage container under `/var/lib/storage/stub/stub/<bucket>/...`); (3) only if the stored motion itself collides is it a planner problem — otherwise it's fallback/visibility/display-layer work in `packages/viewer`.

**Applies to:** assembly-instruction motion bug reports; `packages/viewer/src/{motion,fallback,AssemblyPlayer}`; `crates/planner/src`.
