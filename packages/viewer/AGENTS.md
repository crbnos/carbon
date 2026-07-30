# @carbon/viewer

3D model + animated assembly-instruction rendering (three.js / react-three-fiber). Backs the ERP assembly editor and the MES shop-floor player.

## Key Domain Concepts

- **graph.json** (`AssemblyGraph`) — assembly tree written by the geometry service `/convert`; leaf nodes carry a stable `nodeId` (also baked into GLB node extras as `userData.nodeId`). All joins between steps, plans, and scene objects are by `nodeId`.
- **plan.json** (`AssemblyPlan`) — per-component insertion `Motion`, sequence, subassembly `groups`, and body-level `contacts`, written by the geometry service `/plan`. `CURRENT_PLAN_VERSION` (currently `3`) — stored plans below it are STALE and must be treated as absent so the pipeline re-plans.
- **Step** (`AssemblyStep`) — one build instruction: `componentNodeIds`, a `Motion`, optional `camera`, `fastener`, and subassembly `phase`. Built from a plan by `buildAssemblyStepGroups`.
- **Motion** — discriminated union `linear | L | helix | path | none`. Insertion motion; the player derives removal (reverse) and start poses. `flagged`/`blockedBy` steps use `none` and fade in (no collision-free path exists — a synthesized path would clip through geometry).
- **Artifact tiers** — a model renders from best-available: LOD GLB → optimised GLB → lossless GLB → raw WASM (in-browser occt-import-js) fallback.

## Always

- MUST key everything by `nodeId` — scene objects (`useAssembly` `nodesById`), plan components, and steps all join on it. Stale/unknown nodeIds (post re-upload) are skipped, never assumed.
- MUST keep the three-free import path clean: server/Inngest code imports plan logic from `@carbon/viewer/steps` (re-exports `buildAssemblyStepGroups`, `assignStepPhases`, `indexAssemblyGraph`, `CURRENT_PLAN_VERSION`), NOT the barrel `.` — the barrel pulls in three.js/R3F.
- MUST treat plans below `CURRENT_PLAN_VERSION` as absent (re-plan), never resurrect their motions.
- MUST keep this package free of `@carbon/react` router/i18n peers in the pure/motion/plan modules — `cn` is re-implemented locally in `utils.ts` for that reason. (`ModelPreview.tsx` is the one component that does import `@carbon/react`.)
- MUST prefer server artifacts over the raw tier — the raw WASM fallback renders only when there is no server GLB.

## Ask First

- Changing `types.ts` (`Motion`, `AssemblyGraph`, `AssemblyPlan`, `AssemblyStep`) — these are a shared contract with the geometry service and the ERP/Inngest layer; change all three together (see the header comment in `types.ts`).
- Bumping `CURRENT_PLAN_VERSION` — it invalidates every stored plan and forces a re-plan across the fleet; coordinate with the geometry service's `PLAN_VERSION`. (Note: the heuristic step-building in `plan.ts` is tuned freely and is NOT a version event.)

## Never

- Never fabricate a motion for a `flagged`/`blockedBy` component — it must stay `none` and fade in at the seated pose.
- Never add ordering assumptions between components sharing a `wave` — they are parallel-buildable by definition.
- Never let a step animate two components whose swept `motionCorridor`s overlap simultaneously — they must take separate steps (subassembly `groupId` members are the one exempt rigid-body case).

## Validation Commands

```bash
pnpm --filter @carbon/viewer test        # vitest — camera, fallback, graph, motion, plan, visibility
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

Key non-exported building blocks: `useAssembly` (loads meshopt GLB + graph.json, indexes nodes by nodeId), `motion.ts` (`buildStepClip`, `motionToKeyframes`, `naturalizeMotion`), `fallback.ts` (`synthesizeFallbackMotion` — AABB escape for legacy `none` motions), `camera.ts` (`fitFraming` — live frustum fit around the planner's baked view direction), `raw/` (WASM fallback tier: `loadRawModel` via occt-import-js).

## Cross-References

- **Consumers**: ERP `apps/erp/app/components/CadModel.tsx`, `apps/erp/app/modules/production/ui/Assemblies/*`, route `apps/erp/app/routes/x+/assembly+/$id.tsx`; MES `apps/mes/app/components/AssemblyView.tsx` + `JobOperation`; Inngest `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts` (imports `@carbon/viewer/steps`).
- **Contracts**: `docs/specs/animated-work-instructions-contracts.md` (mirrored by `types.ts`).
- **Model paths / raw limits**: `@carbon/utils` (`modelPathOptimizeFormat`, `MODEL_RAW_KEEP_MAX_BYTES`).
</content>
</invoke>
