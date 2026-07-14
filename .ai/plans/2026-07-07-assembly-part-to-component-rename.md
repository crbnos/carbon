# Refactor: rename CAD "part" → "component" across the assembly-instructions feature

## Context

On the assembly-instructions page, the 3D pieces of a CAD model are called **parts**. But
"Part" is a distinct concept in Carbon (an item type on the BOM), so the term collides and
confuses. This refactor renames the CAD-geometry concept to **component** everywhere it
surfaces — user-facing text, ERP code, the `@carbon/viewer` API, the DB columns/table, and
the Python geometry service — while deliberately **keeping** "part"/"item" wherever the word
actually refers to a Carbon BOM item (e.g. "Pick a BOM part" → "Pick a BOM **item**", the
`itemId` FK, `bomMaterials`).

Scope confirmed with the user: **everything** (DB + viewer + geometry service + shared viewer
labels); BOM-item references stay accurate.

**Nothing is merged yet**, so this is a straight rename with no migration/deploy gymnastics:
- Edit the **existing** assembly migrations **in place** (rename columns/table directly in their
  `CREATE TABLE` statements) — no rename migration, no idempotency guards, no data back-compat.
  The user rebuilds the database from scratch afterward.
- The app→service `POST /plan` request carries no "part" keys anyway (`options.units[].nodeIds`,
  `sequence`), and there are no stored artifacts to preserve — so app + service just adopt the new
  key names together. No lockstep/back-compat shim needed.

## Canonical naming map

CAD-geometry → component (rename):

| Old | New |
|---|---|
| `partNodeIds` (DB col, validators, types, vars) | `componentNodeIds` |
| `partCount` (DB col, graph.json, convert/status wire, viewer `AssemblyGraph`) | `componentCount` |
| `plan.parts` (plan.json dict) | `plan.components` |
| `PartGroup` (viewer type) / `groupPartNodeIds` (viewer fn) | `ComponentGroup` / `groupComponentNodeIds` |
| `AssemblyPlanPart` / `AssemblyStepGroup.partNodeIds` / `NamedUnit.partNodeIds` / `AssemblyStep.partNodeIds` | `AssemblyPlanComponent` / `.componentNodeIds` (all) |
| `assemblyPartMapping` (table) + `assemblyPartMapping_*_idx` | `assemblyComponentMapping` (+ indexes) |
| svc `getAssemblyPartMappings` / `upsertAssemblyPartMapping` / `deleteAssemblyPartMapping` / `autoMatchAssemblyParts` / `updateAssemblyStepParts` | `…ComponentMapping(s)` / `autoMatchAssemblyComponents` / `updateAssemblyStepComponents` |
| path segments `part-mappings`, `steps/parts`; helpers `newAssemblyPartMapping`, `deleteAssemblyPartMapping`, `autoMatchAssemblyParts`, `assemblyInstructionStepParts` | `component-mappings`, `steps/components`; `…ComponentMapping`, `autoMatchAssemblyComponents`, `assemblyInstructionStepComponents` |
| route files `$id.part-mappings.*.tsx`, `$id.steps.parts.$stepId.tsx` | `$id.component-mappings.*.tsx`, `$id.steps.components.$stepId.tsx` |
| ERP UI ids: `StepPartsEditor`, `onSelectParts`, `onHighlightParts`, `onHideParts`, `onRemoveParts`, `draftPartNodeIds`, `isAddingParts`, `partGroups`, `PartColorSwatch`, `PartDetails`, `BomRow` | `StepComponentsEditor`, `onSelectComponents`, `onHighlightComponents`, `onHideComponents`, `onRemoveComponents`, `draftComponentNodeIds`, `isAddingComponents`, `componentGroups`, `ComponentColorSwatch`, `ComponentDetails`, `ComponentRow` |
| Python internal `_Part`, `PlannedPart`, `plan_parts_payload`, `part_count`, `part_node_ids` | `_Component`, `PlannedComponent`, `plan_components_payload`, `component_count`, `component_node_ids` |

**KEEP as-is** (Carbon BOM item / not CAD): `itemId`, the mapping's target item, `bomMaterials`,
`geometryHash`, `nodeId(s)`, `options.units[].nodeIds`, `plannedCount`, `sequence`, and the
`AssemblyBomTree` / `AssemblyStepBom` names (they concern the **BOM** mapping — Bill of Materials
is a real, separate concept; only the CAD-part sub-identifiers inside them rename).

Display-string BOM exceptions: `"Pick a BOM part"` → `"Pick a BOM item"`; `"Match parts to BOM items"`
→ `"Match components to BOM items"`; `"… mapped to BOM"` unchanged.

## Execution order (each step verifiable before the next)

### 1. Database migrations — edit existing files IN PLACE (user rebuilds)
Edit the `CREATE TABLE` / column definitions directly in:
- `20260610143217_assembly-foundations.sql` — `modelUpload.partCount` → `componentCount`.
- `20260610151942_assembly-instructions.sql` — `assemblyInstructionStep.partNodeIds` → `componentNodeIds`.
- `20260611134652_assembly-editor-parity.sql` — `assemblyUnit.partNodeIds` → `componentNodeIds`.
- `20260611194237_assembly-part-mappings.sql` — table `assemblyPartMapping` → `assemblyComponentMapping`,
  the three `assemblyPartMapping_*_idx` index names, and all in-file references (RLS `CREATE POLICY … ON`,
  grants). Optionally rename the file → `…_assembly-component-mappings.sql` for tidiness.
- No new migration, no idempotency guards (these are the authoritative CREATE statements).
- After the user rebuilds: `pnpm run generate:types` (never hand-edit `packages/database/src/types.ts`;
  don't commit the unrelated 55k-line local diff — see `reference_types_gen_cloud_db`).

### 2. `@carbon/viewer` (types + API + labels)
- Rename exports/fields across `graph.ts` (`PartGroup`→`ComponentGroup`, `groupPartNodeIds`→
  `groupComponentNodeIds`, `AssemblyGraphIndex.groups`), `types.ts` (`AssemblyStep.componentNodeIds`,
  `AssemblyGraph.componentCount`), `plan.ts` (`AssemblyPlanComponent`, `AssemblyPlan.components`,
  `groups[].componentNodeIds`, `AssemblyStepGroup.componentNodeIds`), `describe.ts`
  (`NamedUnit.componentNodeIds`), `steps.ts`, `motion.ts`, `fallback.ts`, and the `index.ts` barrel.
- `AssemblyPlayer.tsx` viewer labels → "Show future components ghosted" / "Hide future components" /
  "Show all components solid" (+ the "plan as one component" docstring wording).
- Verify: `pnpm --filter @carbon/viewer typecheck && test` (update `plan.test.ts` fixtures to new keys).

### 3. ERP services + models + validators (`apps/erp/app/modules/production/`)
- `production.models.ts`: rename `partNodeIds` in the 3 validators; `assemblyInstructionStepPartsValidator`
  → `assemblyInstructionStepComponentsValidator`.
- `production.service.ts`: rename functions (`updateAssemblyStepComponents`, `getAssemblyComponentMappings`,
  `upsertAssemblyComponentMapping`, `deleteAssemblyComponentMapping`, `autoMatchAssemblyComponents`),
  every `.from("assemblyComponentMapping")`, and `componentNodeIds` column refs; leave `itemId`/BOM logic.
- `types.ts`: `AssemblyPartMapping` → `AssemblyComponentMapping` (derives via `Awaited<ReturnType<…>>`,
  follows automatically — `feedback_fullstack_type_chain`). Update the module `index.ts` barrel.

### 4. `@carbon/jobs` Inngest workers
- `assembly-plan.ts` / `plan-units.ts` (`.select("componentNodeIds")`, `PlanUnit`), `assembly-convert.ts`
  (`componentCount`), `generate-assembly-steps.ts` (`group.componentNodeIds` → DB `componentNodeIds`).
  Keep outgoing `options.units[].nodeIds`. Verify: `pnpm --filter @carbon/jobs typecheck`.

### 5. ERP routes + path helpers + UI
- `apps/erp/app/utils/path.ts`: rename the 4 helpers + URL segments (`part-mappings`→`component-mappings`,
  `steps/parts`→`steps/components`).
- Rename route files under `apps/erp/app/routes/x+/assembly+/`: `$id.part-mappings.*.tsx` →
  `$id.component-mappings.*.tsx`, `$id.steps.parts.$stepId.tsx` → `$id.steps.components.$stepId.tsx`;
  update internal action/validator refs.
- UI (`AssemblyBomTree.tsx`, `AssemblyInstructionProperties.tsx`, `AssemblyInstructionExplorer.tsx`,
  `AssemblyStepBom.tsx`, `AssemblyStepMaterials.tsx`, `$id.tsx`, MES `Assembly.tsx`): rename identifiers
  per the map AND update every **display string** (tab "Components", "Search components",
  "Add components", counts `{n} component{s}`, empty states, aria/tooltips) — with the **BOM exceptions**.
- Verify: `pnpm exec turbo run typecheck --filter=erp --filter=mes`; `pnpm run lint`.

### 6. Python geometry service (`services/geometry/`)
- `schemas.py`/`main.py`: response `partCount` → `componentCount` (convert + status). `plan.py`: emit
  `plan["components"]` (was `parts`), `groups[…]["componentNodeIds"]`; rename internal
  `_Part`/`PlannedPart`/`plan_parts_payload`/`part_count`. `convert.py`: graph.json `componentCount`.
  Keep request-side `units[].nodeIds`/`sequence`.
- Verify: `services/geometry` tests (`test_plan.py`) pass.

### 7. Docs / rules / specs
- Update the `/plan` + `/convert` contract field names in
  `.ai/specs/2026-07-04-animated-work-instructions-contracts.md`,
  `.ai/specs/2026-07-06-geometry-service-deployment.md`, the production `AGENTS.md`, and any curated
  `docs/` page describing assembly parts (`feedback_keep_docs_in_sync`).

## Verification (end-to-end, after the user rebuilds the DB)
- `generate:types` clean; scoped typechecks (`@carbon/viewer`, `@carbon/jobs`, `erp`, `mes`) green;
  `pnpm run lint`; viewer + geometry unit tests pass.
- Grep guard: no remaining CAD-sense `partNodeIds` / `PartGroup` / `assemblyPartMapping` / `plan.parts`;
  remaining "part" hits are only BOM/item (`itemId`, `bomMaterials`, "BOM part/item").
- Browser (Electric X session, fresh model after rebuild): create/open an assembly → Parts panel reads
  "Components"; select components, add a step, plan-as-one-component, hide/show; convert + re-run motion
  planning end-to-end against the renamed geometry service; steps render.

## Risks / notes
- Table rename touches RLS/indexes — policies are named `production_*` and don't reference the table
  name in SQL, so they carry over; still confirm all four policies + three indexes read
  `assemblyComponentMapping` after the edit.
- Since migrations are edited in place, the change only takes effect on a DB rebuild — the user owns that
  step; `generate:types` runs after.
- Land DB edits + all code together (one branch); a partial rename would break typechecks by design.
