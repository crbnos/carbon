---
paths: ["packages/viewer/src/visibility.ts", "packages/viewer/src/AssemblyPlayer.tsx"]
triggers: ["visualForComponent", "occluderWeight", "futureMode"]
promoted: null
---
# "What is drawn" and "what blocks the view" must be derived from one predicate

**Context:** Adding `installedMode` to the assembly viewer (`packages/viewer/src/visibility.ts`). Two pieces of code answered questions about the same timeline: `visualForComponent` decided how a component renders, while the camera's AABB view-direction scorer decided how much it counts as an obstacle. The scorer was written inline inside `AssemblyPlayer`, hundreds of lines away.

**Problem:** They disagreed on one input. `visualForComponent` treats a component that **no step installs** exactly like a future-step one ("never already there"), so under the MES default `futureMode: "hidden"` it rendered hidden. The inline scorer computed `isFuture = stepIndex !== undefined && stepIndex > activeStepIndex` — `undefined` failed that test, so the same component kept full occluder weight. The camera picked view angles that dodged geometry it was not drawing. Silent: no error, nothing visibly broken, just subtly worse framing that no test covered because the logic was un-extractable inline.

**Rule:** When one fact (here: a component's position relative to the active step) drives both what the user sees and what the system reasons about, derive both from a single exported predicate in the same module, and assert the invariant that links them — *anything invisible is never an obstacle* — over the full cross-product of modes, not over hand-picked cases. The cross-product test is what caught this; a case-by-case test would have encoded the bug. Extracting the inline logic is the fix, not adding a comment telling the next person to keep them in sync.

**Applies to:** `packages/viewer/src/visibility.ts` (`visualForComponent` / `occluderWeight`), `packages/viewer/src/AssemblyPlayer.tsx`; any pair of render-vs-reason helpers over the same state.
