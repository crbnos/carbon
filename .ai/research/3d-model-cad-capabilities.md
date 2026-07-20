# 3D Model / CAD Capabilities (verified 2026-06)

## Storage: `modelUpload` table

Created in `packages/database/supabase/migrations/20240630115404_model-uploads.sql`:
`id` (xid), `name`, `size`, `modelPath`, `autodeskUrn` (legacy APS translation URN),
`itemId` FK, `companyId`, audit cols. Referenced by `item`, `job`, `salesOrderLine`,
`quoteLine`, `purchaseOrderLine` etc. via `modelUploadId` columns (see many view
migrations, e.g. `20250109000722_increase-numeric-values.sql`).

Files live in Supabase storage (`private` bucket, `models/` path), served via
`apps/erp/app/routes/file+/model+/$id.tsx` and `file+/model+/public.$.tsx`.

## Viewers (packages/react)

- `packages/react/src/ModelViewer.tsx` — built on **online-3d-viewer** (`OV.EmbeddedViewer`)
  + three.js 0.163 (pinned in `packages/react/package.json`). Loads STEP/STL/etc.
  client-side via occt-import-js WASM. Computes bbox/surface area/volume, recolors
  meshes, adds lights. Limitations: no assembly tree exposure, no animation —
  occt-import-js bakes transforms into vertices.
- `packages/react/src/AutodeskViewer.tsx` (+ `autodesk.d.ts`) — Autodesk Platform
  Services (Forge) viewer: token provider context, URN-based loading. Pairs with
  `modelUpload.autodeskUrn`.

## Onshape integration (active, not removed)

`packages/ee/src/onshape/` (`client.ts`, `data.ts`) + routes
`apps/erp/app/routes/api+/integrations.onshape.*`. OAuth, documents/versions/elements,
BOM sync into Quotes/Jobs/Items (`QuoteBoMExplorer.tsx`, `JobBoMExplorer.tsx`,
`BoMExplorer.tsx`). Metadata/BOM only — no geometry export. (Earlier cache notes said
Onshape code was removed — wrong; `ONSHAPE_SECRET_KEY` in `packages/auth/src/config/env.ts`.)

## Background jobs: Inngest (NOT Trigger.dev)

`packages/jobs/src/inngest/` with `inngest` ^3.52.7 in `packages/jobs/package.json`
(also `events.ts`, `schemas.ts`, `trigger.ts` in `packages/jobs/src/`). Existing
model-related pattern: `packages/jobs/src/inngest/tasks/model-thumbnail.ts` calls a
Supabase edge function (`thumbnail`) that screenshots the viewer page and stores a PNG.
Older cache references to Trigger.dev are stale.

## MES model display

`apps/mes/app/components/JobOperation/JobOperation.tsx` renders a "Model" tab on
`/x/operation/:operationId` using ModelViewer when the job/item has a model.

## Assembly instructions (animated work instructions) — production module

Part of the **production** module (not a standalone module): permissions are
`production_<view|create|update|delete>`; there is no `Assembly` module enum
value or `assembly_*` permission family.

- Docs: `.ai/research/animated-work-instructions.md`,
  `.ai/specs/2026-07-04-animated-work-instructions-design.md` (+ `-contracts.md`,
  `.ai/plans/2026-07-04-animated-work-instructions.md`,
  `.ai/specs/2026-07-04-assembly-editor-requirements.md`).
- `services/geometry/` — Python/FastAPI + OCCT (cadquery-ocp): POST /convert turns a
  STEP file (signed GET URL) into a meshopt-compressed GLB + graph.json (signed PUTs).
  POST /plan (app/plan.py) runs greedy assembly-by-disassembly motion planning
  (trimesh + python-fcl collision; tier 1 straight-line along world axes + part
  principal axis, tier 2 lift-then-slide L motions, leftovers flagged with
  blockedBy) and uploads plan.json (insertion motions by nodeId + assembly
  sequence). Stable nodeIds in glTF node extras. Limits via GEOMETRY_* env vars;
  bearer auth; GEOMETRY_DEV_MODE also disables TLS verification (portless CA).
  CI: `.github/workflows/geometry.yml` (pytest + docker build).
- `packages/viewer` (@carbon/viewer) — react-three-fiber v8 AssemblyViewer (with drei
  GizmoViewcube) / AssemblyPlayer (ghost/hidden/solid future-parts modes, overlay nav
  arrows, `onGraphLoaded`, `highlightedNodeIds`, `hiddenNodeIds`); steps form one
  continuous timeline (LoopOnce auto-advance, global-seconds scrubber with step
  ticks, m:ss elapsed/total display, `stepTimelineSeconds`); AssemblyStep has
  optional `durationSeconds`; runtime keyframes from step motion JSON
  (linear/L/helix/path/none); pure utils `graph.ts` (indexAssemblyGraph,
  groupPartNodeIds) and `describe.ts` (describeStep auto-titles) with vitest coverage.
- DB: `assemblyPlanJob`, `assemblyInstruction`, `assemblyInstructionStep` (status enum
  Todo/Review/Done, groupIds), `assemblyInstructionStepRequirement`
  (Tool/Fixture/Consumable/Note/Media; itemId FK → item, name snapshot, severity),
  `assemblyStandardNote`, `assemblyGroup` (Cluster/Kit/Combination/Subassembly);
  `modelUpload` gained processingStatus/glbPath/graphPath/partCount/processedAt;
  `jobOperation`/`methodOperation` gained nullable `assemblyInstructionId`.
  All RLS via `get_companies_with_employee_permission('production_*')`.
- Inngest `assembly-convert` + `assembly-plan` (`packages/jobs/src/inngest/functions/tasks/`)
  auto-trigger from `apps/erp/app/routes/api+/model.upload.ts` for .step/.stp uploads.
  Env: GEOMETRY_SERVICE_URL / GEOMETRY_SERVICE_API_KEY (packages/env).
- ERP: code lives in `apps/erp/app/modules/production/` (assembly functions appended to
  production.service.ts/.models.ts/types.ts; UI in `ui/Assemblies/`). List route
  `x+/production+/assemblies.tsx` (/x/production/assemblies) + `assemblies.new.tsx`,
  mirroring procedures; full-screen editor stays at `x+/assembly+/$id`
  (/x/assembly/:id) with `handle.module: "production"` like `x+/procedure+/`.
  Editor: Steps|Parts left tabs — step search/filter, status dots, "N steps · est."
  footer; Parts tab is the BOM tree with click-to-highlight, hide-parts, a Groups
  section, and a selection toolbar + right-click context menu that creates
  clusters/kits/combinations/subassemblies (subassembly auto-creates a child
  instruction via `$id.groups.new`); Details|BOM|Requirements right tabs
  (tools/notes/standard notes/media, per-step timeline length display);
  auto-generated step titles; header shows version badge ("Edit N", bumped on
  publish) + "By you · edited <relative>". Nav: "Assemblies" in the Production
  sidebar group (useProductionSubmodules); create-instruction button on item Model
  tab (gated on production_create). MES: Assembly tab in
  `apps/mes/app/components/JobOperation/` (read-only playback + active step's
  notes/tools/media via requirements in getJobOperationAssembly; serviceRole read).
- BOM mapping: `assemblyPartMapping` table maps distinct model parts
  (geometryHash, per modelUploadId) to engineering BOM items;
  `getFlattenedBomMaterials` walks makeMethod → methodMaterial →
  materialMakeMethodId (Make subassemblies) multiplying quantities;
  `autoMatchAssemblyParts` does greedy token-similarity name matching with a
  unique-quantity fallback. Editor Parts tab: "Match BOM" button, coverage
  count, mapped readable-ID under each row with BOM-vs-model quantity
  mismatch warnings, map/unmap in the part popover
  (routes `$id.part-mappings.{new,auto,delete.$mappingId}`).
- Planner consumption (the core flow — authors never hand-author motions):
  "Generate Steps" on an empty step list creates draft steps from plan.json
  (route `$id.steps.generate` → `generateAssemblyStepsFromPlan`: sequence
  order, consecutive identical parts grouped, planConfidence + status Review;
  triggers the assembly-plan Inngest pipeline when no plan exists). Assigning
  parts to a step auto-fills its motion via `planMotionForParts`
  (@carbon/viewer plan.ts) with a "Planned automatically" indicator; the
  manual motion form is the override. plan.json loads in the editor loader
  via `getAssemblyPlanJson`. The step camera frames the full insertion travel.
- Test playbook: `llm/test-playbooks/assembly-instructions-editor.md`.
  Verified e2e on the seat-rail seed: convert → plan (22 linear + 1 L + 8
  flagged) → 27 generated steps → animated 1:01 timeline. Status/requirement/
  group CRUD verified against a fully migrated local db.
- Not yet done: share link, PDF export, undo/redo, annotations, kit-aware
  step animation semantics, helix motions for detected fasteners (planner
  emits linear for screws), deploy config for the geometry container.
