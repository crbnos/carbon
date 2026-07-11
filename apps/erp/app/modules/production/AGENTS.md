# Production Module

Work orders (jobs), scheduling, routings (operations), bill of materials, procedures, production events/quantities, maintenance dispatches/schedules, demand forecasting, and MRP integration.

## Key Domain Concepts

- **Job** — production work order. Statuses: Draft → Planned → Ready → In Progress → Paused → Completed → Closed → Cancelled. `isJobLocked(status)` returns true for Completed/Closed/Cancelled. MUST check before allowing edits.
- **Job Make Method** — a job's manufacturing method (BOM + routing). Root method has `parentMaterialId = null`; sub-assemblies nest via `parentMaterialId`. Created by the `get-method` edge function.
- **Job Operation** — routing step within a make method. Types: Inside (in-house) or Outside (subcontracted). Statuses: Todo → Ready → In Progress → Done. Ordered by `order` column.
- **Job Material** — BOM line within a make method. Each has a `methodType` (Pull from Inventory, Purchase to Order, Make to Order) that drives procurement.
- **Production Event** — time tracking (Labor/Machine/Setup) against an operation.
- **Production Quantity** — output recording (Production/Scrap/Rework) against an operation with optional `scrapReason`.
- **Procedure** — versioned work instructions linked to operations via `processId`. Statuses: Draft/Active/Archived.
- **Assembly Instructions are internal-only** (feature flag) while the module matures: the nav entry is in `internalOnlyRoutes` (`useProductionSubmodules.tsx`, via `useFlags().isInternal`), and `requireAssembliesInternal` (`production.server.ts`) redirects non-internal users out of `production/assemblies`, `production/assemblies/new`, and every `x+/assembly+` route (layout loader). Mirrors the settings backups gate; drop the gates to ship publicly.
- **Maintenance Dispatch** — reactive/scheduled repair for work centers with comments, events, items, and linked work centers.
- **Scheduling** — infinite-capacity backward scheduling via `schedule` edge function. MUST use `triggerJobSchedule` to reschedule, never direct date writes.

## Safety

### Always
- MUST use `recalculateJobRequirements` after changing job materials or operations — it recalculates quantities and costs.
- MUST use `triggerJobSchedule` to reschedule — it invokes the scheduling engine via Inngest.
- MUST check `isJobLocked(status)` before allowing edits — Completed/Closed/Cancelled jobs are locked.
- MUST scope queries by `companyId`; jobs are also scoped by `locationId`.
- MUST use `calculateJobPriority` for priority — it computes from deadline type and due date. Never set `job.priority` manually.

### Ask First
- Deleting jobs that have posted production events or inventory movements.
- Changing job status backwards (e.g., Completed → In Progress).
- Running MRP (`runMRP`) — it can create/modify planned orders system-wide.

### Never
- Directly modify `jobOperation.startDate`/`dueDate` — MUST go through the scheduling engine.
- Delete job operations that have production events recorded against them.
- Set `job.priority` manually — it's calculated by `calculateJobPriority`.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `job` / `jobs` (view) | Work order header: item, quantity, dates, status, priority |
| `jobMakeMethod` | Manufacturing method instance; tree via `parentMaterialId` |
| `jobOperation` | Routing step: process, times, work center, status, scheduling dates |
| `jobMaterial` | BOM line: item, quantity, methodType, unitCost |
| `jobOperationStep` / `jobOperationParameter` / `jobOperationTool` | Work instruction details on operations |
| `jobOperationDependency` | Operation sequencing dependencies |
| `productionEvent` | Time tracking: type (Labor/Machine/Setup), start/end, employee |
| `productionQuantity` | Output: type (Production/Scrap/Rework), quantity, scrapReason |
| `procedure` / `procedureStep` / `procedureParameter` | Versioned work instructions |
| `assemblyInstruction` / `assemblyInstructionStep` | 3D model-based assembly instructions (Draft/Published/Archived); steps carry `componentNodeIds` + `motion`/`camera` JSON for the viewer AND the typed-step fields mirrored from `jobOperationStep` (`type` `procedureStepType`, tiptap `description` with derived `instructionText`, `required`, UoM/min/max, `listValues`) for eventual copy into job operations. `motion`/`camera` are authored directly in the 3D viewer (drag the red waypoint path → relative `linear`/`L` motion; "Set view" captures the camera pose), autosaved via `updateAssemblyStepMotion` / the `steps/motion/$stepId` route — separate from the step form's `upsertAssemblyInstructionStep` (which rewrites `title`/typed fields). There is no numeric motion editor. Playback visibility is presence-based (`@carbon/viewer` `visualForComponent`): a component exists on the canvas only once its step has run; components no step installs render like future-step ones (hidden during playback, future-components toggle while paused). AABB fallback motions for `"none"`-motion steps consider only PRIOR-step components as obstacles and fade in when no collision-free path exists or when the component interpenetrates a present component (mated parts — sliders on rails, fasteners in bores — never get fabricated paths; the planner is the only authority for those) |
| `assemblyInstructionStepMaterial` | BOM parts consumed at a step (`stepId` → `itemId` + optional quantity; stored by itemId so links survive make-method re-versioning; picker limited to the item's make-method BOM; UNIQUE `(stepId, itemId)`). Auto-populated from `assemblyComponentMapping` via `syncAssemblyStepMaterialsFromMappings` — additive only (manual quantities/deletions survive), triggered on step generation, component add, mapping create, and "Match BOM" |
| `assemblyInstructionStepRequirement` / `assemblyStandardNote` | Per-step tools/fixtures/consumables/notes/media; reusable note templates |
| `assemblyComponentMapping` / `assemblyUnit` / `assemblyPlanJob` | Geometry↔BOM item mapping, authored planner units (model-scoped "plan as one component" overrides), and geometry-service plan/convert job tracking. Planning is LAZY — conversion does not chain a plan run; the first "Generate Steps" click (or an explicit re-plan) starts it, pre-creating a Queued `assemblyPlanJob` row the worker adopts via `planJobId`. The clicking tab polls and auto-generates the steps when the plan lands |
| `maintenanceDispatch` / `maintenanceSchedule` | Equipment maintenance tracking |
| `demandForecast` / `demandProjection` | Demand planning data |
| `scrapReason` / `maintenanceFailureMode` | Reference data for production and maintenance |

## Key Service Functions

- `convertSalesOrderLinesToJobs` — creates jobs from sales order Make to Order lines
- `getJob` / `getJobs` / `getJobMethodTree` / `getJobMethodTreeArray` — job reads with method hierarchy
- `getJobMaterialsWithQuantityOnHand` — BOM with on-hand for shortfall visibility
- `getJobMaterialShortfallByItem` — priority-adjusted shortfall calculation
- `getJobOrderStatusMap` — procurement status indicators per material
- `recalculateJobRequirements` / `recalculateJobOperationDependencies` — recalculation after changes
- `triggerJobSchedule` — fires the scheduling engine via Inngest
- `runMRP` — triggers Material Requirements Planning via `mrp` edge function
- `calculateJobPriority` — computes priority from deadline type and due date
- `getActiveJobOperationsByLocation` — schedule board data (RPC `get_active_job_operations_by_location`)
- `getProductionPlanning` — MRP-driven production planning (RPC `get_production_planning`)
- `upsertMaintenanceDispatch` / `upsertMaintenanceSchedule` — maintenance management
- `getAssemblyInstruction(s)` / `upsertAssemblyInstructionStep` / `getAssemblyInstructionStepMaterials` — assembly instruction authoring; the step upsert derives `instructionText` from the tiptap `description` (viewer/MES consume the plain text)
- `updateAssemblyStepMotion` — partial `motion`/`camera` patch for one step, used by the 3D path/camera editor's autosave (never touches `title`/typed fields); `camera: null` clears the pose (return to auto-framing). Deleting an instruction also drops the model's cached plan via `deleteAssemblyInstruction` → `invalidateAssemblyPlanCache`
- `generateAssemblyStepsFromPlan` — plan.json → draft steps via `buildAssemblyStepGroups` (`@carbon/viewer`): sequence order, consecutive identical components merged, subassembly `groups` one step (titled by the unit `name`), `mergedInto` components riding their host's step; planner-flagged components (blockedBy / failed verification) store motion "none" + `warnings: { flagged, blockedBy }` (the viewer fades them in — no fabricated paths); a **floater fold** using the plan's `contacts` graph merges a placed-but-detached part with the immediately-following step that attaches to it (collision precedence forces the part in first, so it would otherwise render as a lone floating island for one step) — the pair installs as one rigid step along the detached part's motion; skipped on older plans lacking `contacts`; `mode: "regenerate"` replaces existing steps, refused while any step is `planConfidence: "manual"` or status `Done`. Also seeds each step's materials from the component→BOM mappings (best-effort)
- `syncAssemblyStepMaterialsFromMappings` — adds mapped BOM items (`assemblyComponentMapping`) to steps' materials from their `componentNodeIds` (quantity = instance count in the step); additive + best-effort, never updates or removes rows; scopable by `stepIds` / `geometryHashes` / `onlyComponentNodeIds`. Called from the step-components autosave route (newly added nodes only), the mapping-create route (that hash only), and the "Match BOM" route (full backfill)
- `getAssemblyUnits` / `upsertAssemblyUnit` / `deleteAssemblyUnit` — model-scoped "plan as one component" overrides (`assemblyUnit`: `componentNodeIds[]` + optional `itemId`), authored from the BOM tree
- **Unit derivation** (`deriveAssemblyUnits`, `@carbon/utils`, pure): CAD exports are usually FLAT, so the planner's rigid bodies come from BOM membership, not tree position — an LLM (`assignComponentsToBom`, gpt-4o-mini, `@carbon/jobs`) assigns each distinct component name to a BOM line (electronic footprints → the PCB line), leaves group by line, and a line collapses into one body only at quantity ≤ 1 with ≥ 2 leaves. Authored `assemblyUnit` rows always collapse. The `assembly-plan` worker (`loadPlanUnits`) derives these and sends multi-leaf units as `options.units` to the geometry `/plan` endpoint, which merges them for planning and expands them back to member leaves
- `getFlattenedBomMaterials` — the item's engineering BOM flattened through Make subassemblies; feeds the assembly BOM tree and the per-step material picker

## Key Exports

```typescript
import { getJob, insertJob, triggerJobSchedule, runMRP } from "~/modules/production";
import { jobValidator, isJobLocked, jobStatus } from "~/modules/production";
```

## Related Modules

- **sales** — jobs created from sales order lines; `job.salesOrderLineId` links back
- **items** — `job.itemId` references item master; methods come from item make methods
- **inventory** — materials issued from inventory; finished goods post on job completion
- **purchasing** — outside operations and purchased materials create PO lines via `jobId`
- **resources** — operations run on work centers; scheduling assigns to work centers
- **quality** — production quantities can trigger quality inspections; scrap reasons overlap

## Rules References

- `.ai/rules/scheduling-data-structures.md` — scheduling engine architecture, trigger chain, RPCs
- `.ai/rules/mrp-system.md` — MRP run flow, planning data model, and planning UI
- `.ai/rules/method-material-sourcing.md` — how material methodType drives procurement
