# @carbon/viewer

3D model + animated assembly-instruction rendering (three.js / react-three-fiber). Backs the ERP assembly editor and the MES shop-floor player.

## Key Domain Concepts

- **graph.json** (`AssemblyGraph`) — assembly tree written by the geometry service `/convert`; leaf nodes carry a stable `nodeId` (also baked into GLB node extras as `userData.nodeId`). All joins between steps, plans, and scene objects are by `nodeId`.
- **plan.json** (`AssemblyPlan`) — per-component insertion `Motion`, sequence, subassembly `groups`, and body-level `contacts`, written by the geometry service `/plan`. `CURRENT_PLAN_VERSION` (currently `3`) — stored plans below it are STALE and must be treated as absent so the pipeline re-plans.
- **Step** (`AssemblyStep`) — one build instruction: `componentNodeIds`, a `Motion`, optional `camera`, `fastener`, per-step `hiddenComponentNodeIds`, and the sub-assembly fields `isSubAssembly` / `parentStepId` / `usedInStepId`. Built from a plan by `buildAssemblyStepGroups`.
- **Sub-assemblies** (`subassembly.ts`) — a header step (`isSubAssembly`) groups the steps whose `parentStepId` points at it; those steps sit directly before it in play order and are BUILT ON THEIR OWN: while one is active the player isolates its sub-assembly's parts (focus-style, ancestors kept, not cleared by playback, framed on their own bounds). A header's `usedInStepId` names the later step that carries the finished unit in. A header whose `motion` is not `none` has a path of its own: the unit plays it (`buildStepClip`'s `units`, one after another in sub-assembly order) before the step's own parts move — a step with no animation of its own fades its parts in only after those units seat (`fadeProgress`). `buildCarryPlans` is THE per-step answer to which units fly, which glide, and whether an unused header joins on its own path. Otherwise it glides from beside the build (`CARRY_IN_GLIDE_SECONDS` / `buildStepClip`'s `glide.nodeIds`), then rides the step's insertion; without one the header itself is where the unit joins the main build, and a USED header plays nothing (0-length segment, skipped by prev/next). No nesting — a step USES a finished sub-assembly instead, so chains of any length work. `arrivalIndexByNode(steps, world)` is THE answer to "when does this part appear in the build on screen" and drives visibility; `validateSubAssemblies` is THE structural rule the ERP service and editor share. `scopeStepIds` limits the timeline to an opened sub-assembly.
- **Motion** — discriminated union `linear | L | helix | path | waypoints | none`. `waypoints` is editor-authored: poses relative to the seated pose, turning about the moving set's seated bounds center (`seatedBoundsCenter`), so one motion fits a part, a rigid group or a sub-assembly. The path editor saves `linear`/`L` until a waypoint is turned (`editorWaypointsToMotion`); it has a Move / Rotate tool (`pathToolLabels` on the player, host-translated — no labels, no switch): Rotate shows drei `TransformControls` rings on the selected waypoint and stops the spheres dragging, because the rings' invisible free-rotation grip sits over the sphere. Insertion motion; the player derives removal (reverse) and start poses. `flagged`/`blockedBy` steps use `none` and fade in (no collision-free path exists — a synthesized path would clip through geometry).
- **Artifact tiers** — a model renders from best-available: LOD GLB → optimised GLB → lossless GLB → raw WASM (in-browser occt-import-js) fallback.

## Always

- MUST key everything by `nodeId` — scene objects (`useAssembly` `nodesById`), plan components, and steps all join on it. Stale/unknown nodeIds (post re-upload) are skipped, never assumed.
- MUST keep the three-free import path clean: server/Inngest code imports plan logic from `@carbon/viewer/steps` (re-exports `buildAssemblyStepGroups`, `assignStepPhases`, `indexAssemblyGraph`, `CURRENT_PLAN_VERSION`), NOT the barrel `.` — the barrel pulls in three.js/R3F.
- MUST treat plans below `CURRENT_PLAN_VERSION` as absent (re-plan), never resurrect their motions.
- MUST keep this package free of `@carbon/react` router/i18n peers in the pure/motion/plan modules — `cn` is re-implemented locally in `utils.ts` for that reason. (`ModelPreview.tsx` is the one component that does import `@carbon/react`.)
- MUST prefer server artifacts over the raw tier — the raw WASM fallback renders only when there is no server GLB.
- MUST keep `visualForComponent` and `occluderWeight` (`visibility.ts`) in agreement: anything the first renders `"hidden"` the second must score `null` (not an occluder). They are two views of the same timeline — what the operator sees, and what the camera's AABB view-direction scoring treats as in the way. When they drift, the camera frames around geometry it is not drawing. `visibility.test.ts` asserts the invariant across every mode combination; a component **no step installs** counts as future in BOTH (it is never "already there"), which is exactly where the two previously disagreed.
- MUST expose visibility to the user as the named views in `ASSEMBLY_VIEWS` / `VIEW_MODES` (`visibility.ts`), not as the two raw axes. The axes are the renderer's model; nine combinations, most of them meaningless, is not a control anyone can read — an earlier two-icon-triplet toolbar was rejected for exactly that. A new view means a new entry in that table (and `VIEW_LABELS` in `AssemblyPlayer.tsx`), never a new axis or a fourth rendering mode. The table is Build / Focus / Full: an `isolate` view (both sides hidden) was dropped — Focus shows the step in place, and the author's per-step hidden parts (`hiddenComponentNodeIds`) remove the clutter they choose. `viewForModes` seats the initial view from the still-axis-shaped `default*Mode` props, falling back to `"build"` for an unnamed pair.

## Ask First

- Changing `types.ts` (`Motion`, `AssemblyGraph`, `AssemblyPlan`, `AssemblyStep`) — these are a shared contract with the geometry service and the ERP/Inngest layer; change all three together (see the header comment in `types.ts`).
- Bumping `CURRENT_PLAN_VERSION` — it invalidates every stored plan and forces a re-plan across the fleet; coordinate with the geometry service's `PLAN_VERSION`. (Note: the heuristic step-building in `plan.ts` is tuned freely and is NOT a version event.)

## Never

- Never fabricate a motion for a `flagged`/`blockedBy` component — it must stay `none` and fade in at the seated pose.
- Never add ordering assumptions between components sharing a `wave` — they are parallel-buildable by definition.
- Never let a step animate two components whose swept `motionCorridor`s overlap simultaneously — they must take separate steps (subassembly `groupId` members are the one exempt rigid-body case).

## Validation Commands

```bash
pnpm --filter @carbon/viewer test        # vitest — camera, fallback, graph, motion, plan, subassembly, visibility
pnpm --filter @carbon/viewer typecheck   # tsgo --noEmit
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` | `AssemblyPlayer` (+ `AssemblyPlayerHandle`/`Props`), `AssemblyViewer`, `ModelCanvas`, all plan/motion/graph/camera/describe/visibility helpers and types |
| `./steps` | Three-free plan→steps logic for server code: `buildAssemblyStepGroups`, `assignStepPhases`, `indexAssemblyGraph`, `CURRENT_PLAN_VERSION` |
| `./canvas` | `ModelCanvas` — standalone static GLB viewer (orbit + view, no steps) |
| `./model-preview` | `ModelPreview` — progressive multi-tier preview (LOD → optimised → raw WASM), lazy-loads three.js on scroll-into-view |
| `./optimize-progress` | `OptimizeProgress` — optimise-status chip |
| `./use-optimized-model` | `useOptimizedModel` — TanStack Query polling of the model optimise lifecycle (shared by ERP `CadModel` + MES model tab) |

Key non-exported building blocks: `useAssembly` (loads meshopt GLB + graph.json, indexes nodes by nodeId), `motion.ts` (`buildStepClip`, `motionToKeyframes`, `naturalizeMotion`), `fallback.ts` (`synthesizeFallbackMotion` — AABB escape for legacy `none` motions), `subassembly.ts` (`buildSubAssemblyPlan` / `arrivalIndexByNode` / `validateSubAssemblies` / `usableSubAssemblies` / `displayOrder` — also on `./steps`), `camera.ts` (`fitFraming` — live frustum fit around the planner's baked view direction), `raw/` (WASM fallback tier: `loadRawModel` via occt-import-js).

## Cross-References

- **Consumers**: ERP `apps/erp/app/components/CadModel.tsx`, `apps/erp/app/modules/production/ui/Assemblies/*`, route `apps/erp/app/routes/x+/assembly+/$id.tsx`; MES `apps/mes/app/components/AssemblyView.tsx` + `JobOperation`; Inngest `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts` (imports `@carbon/viewer/steps`).
- **Contracts**: `src/types.ts` is the contract itself (the `docs/specs/animated-work-instructions-contracts.md` it once mirrored no longer exists). The ERP mirrors `Motion` as zod in `motionSchema` (`apps/erp/app/modules/production/production.models.ts`); the MES checks raw rows with `isPlayableMotion`.
- **Model paths / raw limits**: `@carbon/utils` (`modelPathOptimizeFormat`, `MODEL_RAW_KEEP_MAX_BYTES`).
</content>
</invoke>
