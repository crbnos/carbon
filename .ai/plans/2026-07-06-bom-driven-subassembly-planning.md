# BOM-Driven Subassembly Planning — Plan Nested Units, Not Leaf Soup

## Problem

A real customer model ("431 parts") planned for **11 minutes** and produced
hundreds of junk steps. The assembly is really **7 BOM lines** — one of them a
purchased PCB whose 3D model carries hundreds of tiny child solids (chips,
caps, connectors). Today the planner flattens every leaf mesh into an
independent rigid body (`_collect_world_parts` in `services/geometry/app/plan.py`
discards the hierarchy), so it fights 400+ bodies that can never separate in
real life, then step generation surfaces them all.

Everything needed to fix this already exists in the system:

| Signal | Where it lives | State |
|---|---|---|
| CAD hierarchy (PCB = one subassembly node) | `graph.json` (`convert.py` preserves `isAssembly` + `children`) | built, ignored by planner |
| Engineering BOM (7 items) | `getFlattenedBomMaterials(client, itemId, companyId)` | built |
| Geometry ↔ BOM item mapping | `assemblyPartMapping` (geometryHash → itemId), auto-matched by `autoMatchAssemblyParts` (nameSimilarity ≥ 0.45 greedy) | built |
| Persisted "these nodes are one unit" | `assemblyGroup` table (becomes lean `assemblyUnit` per D0) | built, display-only |
| One-step-per-unit playback | plan.json v2 `groups: { gN: { partNodeIds, motion } }` → `buildAssemblyStepGroups` makes a group ONE step; AssemblyPlayer animates it | built |

The change is therefore mostly **wiring**: derive the planned units in TS from
BOM + hierarchy + authored units, hand them to the planner, and let the
planner treat each unit as a single rigid body. Collapsing 431 → ~7 bodies also
collapses the O(N²) collision work — this should take the 11-minute run back
to well under a minute.

## Prerequisite (uncommitted work in tree)

The async `/plan` refactor (submit → 202 + poll `GET /plan/{jobId}`, worker
polls via `step.sleep`) is already implemented and typechecked in the working
tree (`services/geometry/app/main.py`, `schemas.py`,
`packages/jobs/src/inngest/functions/tasks/assembly-plan.ts`). It fixes the
`UND_ERR_HEADERS_TIMEOUT` retry-storm on long plans. Commit it first (or with
Task 3) — this plan builds on that flow.

## Design

### D0. One grouping concept: the Subassembly (drop the parity taxonomy)

The `assemblyGroup` types `Cluster` / `Kit` / `Combination` are leftovers of
the abandoned feature-parity direction: all three are display-only (nothing
consumes them), kitting belongs on the materials side if it ever returns, and
"Combination = parts treated as one unit" is superseded by BOM-driven unit
derivation. `assemblyInstructionStep.groupIds` is a dead column (no reads or
writes anywhere).

`childInstructionId` goes too (user-confirmed): instructions attach to
**items**, and each BOM level is its own item — a Make subassembly's item gets
its own `assemblyInstruction` with its own model. The parent instruction never
spawns or links child instructions; it just consumes the subassembly as one
part. With that gone, nothing about the override is instruction-specific, so
the row rescopes from `assemblyInstructionId` to **`modelUploadId`** — the same
scoping (and survival semantics across instruction delete/recreate) as
`assemblyPartMapping`. The worker also only has `modelUploadId`, so derivation
reads it directly.

Simplify while the branch is unshipped (user-confirmed):

- **Schema** — edit migration `20260611134652_assembly-editor-parity.sql` in
  place: replace `assemblyGroup` with a lean **`assemblyUnit`** table —
  `id, modelUploadId (FK modelUpload, CASCADE), name, partNodeIds TEXT[],`
  `itemId TEXT NULL (mapped BOM item), companyId, audit fields`. Drop the
  `assemblyGroupType` enum, `childInstructionId`, `partNumber`, and
  `assemblyInstructionStep.groupIds` (dead column). Local DB patch (no
  rebuild): drop `assemblyGroup` + the enum + the `groupIds` column, create
  `assemblyUnit` (exact SQL written at execution time from the edited
  migration). Then regenerate DB types (`pnpm run generate:types`) BEFORE
  typechecking.
- **Models/service** — `assemblyUnitValidator`, `get/upsert/deleteAssemblyUnit`
  replace the group equivalents (mechanical rename + simplification; routes
  `$id.groups.*` → `$id.units.*`).
- **UI** — BOM tree "Groups" section becomes **"Subassemblies"** (label stays
  in manufacturing language even though the table is `assemblyUnit`); the
  four-option Group dropdown becomes one "Create subassembly" action.

### D1. Unit derivation is a pure TS function (BOM is the source of truth)

New `deriveAssemblyUnits` in `packages/viewer/src/units.ts` (pure — no DB, no
IO — so it unit-tests trivially and both the worker and the UI can call it):

```ts
type AssemblyUnit = {
  id: string;            // subtree root nodeId (or authored unit id)
  name: string;          // BOM item name > node name
  nodeIds: string[];     // member LEAF nodeIds (what the planner merges)
  itemId?: string;       // BOM item this unit maps to, when known
  source: "authored" | "bom" | "hierarchy";
};

function deriveAssemblyUnits(args: {
  graph: AssemblyGraph;
  bomMaterials: { itemId: string; name: string | null }[];
  partMappings: { geometryHash: string; itemId: string }[];
  authoredUnits: { id: string; partNodeIds: string[] }[]; // assemblyUnit rows
}): AssemblyUnit[];
```

Rules, in precedence order:

1. **Authored** `assemblyUnit` rows are explicit units (the user's
   override — both "collapse this" and, by deleting the unit, "expand
   this").
2. **Unwrap wrappers**: descend through single-child assembly chains from the
   root (STEP exports often nest `Product → Assembly → actual children`).
3. **Top-level candidates**: the (unwrapped) root's direct children. A leaf
   child is a unit of itself.
4. **BOM refinement** for assembly-node candidates:
   - If the node (or its subtree) corresponds to **≤ 1 BOM item** — via
     `nameSimilarity(nodeName, bomName)` at the threshold `autoMatchAssemblyParts`
     already uses, or because every mapped leaf inside it maps to the same
     item — **collapse** it into one unit (the PCB case).
   - If the node does NOT correspond to a BOM item but its children match
     several BOM items, **descend one level** and re-apply (handles gratuitous
     grouping layers).
   - No BOM / no matches → keep the top-level-only fallback (collapse the
     subassembly node as one unit). Flat models (all leaves at root) behave
     exactly as today.

`nameSimilarity` moves from `production.service.ts` to a shared pure module
(`packages/viewer/src/similarity.ts` or `@carbon/utils`) and is re-imported by
the service — one implementation, not two.

### D2. Planner contract: `options.units`, plan version 3

`POST /plan` request gains an optional field (geometry service stays dumb —
it receives geometry decisions, it doesn't make BOM decisions):

```jsonc
"options": {
  "units": [ { "id": "nodeId-of-subtree", "name": "PCB Assembly", "nodeIds": ["leaf1", "leaf2", ...] } ]
}
```

In `plan_step` / `_collect_world_parts`: leaves listed in a unit concatenate
into **one `_Part`** (single trimesh, `node_id = unit.id`). Contacts inside a
unit are self-exempt by construction. Multi-member units emit into plan.json
as the **existing v2 `groups` shape** (`partNodeIds` = member leaves, shared
motion) plus an additive optional `name` — downstream step generation and the
viewer already handle groups as one step.

Bump `PLAN_VERSION` (plan.py) and `CURRENT_PLAN_VERSION`
(`packages/viewer/src/plan.ts`) **2 → 3** so pre-grouping plans are treated as
absent and auto-replan — same staleness mechanism that retired v1.

### D3. Worker derives units before submitting

`assembly-plan.ts` `start-plan` step, before the POST: download `graph.json`
(small), load BOM (`modelUpload → assemblyInstruction.itemId →
getFlattenedBomMaterials` equivalent via service role), `assemblyPartMapping`
rows, and `assemblyUnit` rows (all `modelUploadId`-scoped); call `deriveAssemblyUnits`;
pass `options.units`. No instruction/BOM found → pass only hierarchy-derived
units (the function handles empty inputs).

### D4. UI: units in the BOM tree + re-run

`AssemblyBomTree.tsx` gains a subassembly-node view: an assembly node that was
(or would be) collapsed renders as one row — name, member count, mapped BOM
item — with a **"Plan as one part" toggle** that upserts/deletes the
`assemblyUnit` (`partNodeIds` = subtree leaf ids). This
also de-noises the current distinct-parts list (the PCB's 300 internals fold
into one row). The existing **Re-run plan** action
(`$id.plan.rerun.tsx`) already covers "apply my change".

### D5. Step generation niceties

`buildAssemblyStepGroups` passes the group `name` through so the draft step
titles read "Install PCB Assembly" instead of a 300-part enumeration
(`describeStep` prefers the group name when present). Auto-linking the step's
`assemblyInstructionStepMaterial` to the unit's mapped `itemId` is a natural
follow-up — noted, **not in this pass**.

## Tasks

- [x] **T0 — Commit the async /plan prerequisite** already in tree.
  Verify: `pnpm exec turbo run typecheck --filter=@carbon/jobs` green;
  `services/geometry/.venv/bin/python -m pytest -q` green.

- [x] **T0.5 — Simplify the group model (D0)**
  Files: `packages/database/supabase/migrations/20260611134652_assembly-editor-parity.sql`
  (in-place edit), local psql patch (SQL in D0), `pnpm run generate:types`,
  `production.models.ts`, `production.service.ts`,
  `AssemblyBomTree.tsx` (Subassemblies section, single create action),
  routes `$id.groups.*` → `$id.units.*` (no child-instruction creation).
  Verify: `pnpm exec turbo run typecheck --filter=erp` green; BOM tree renders
  and creates a subassembly locally.

- [x] **T1 — `deriveAssemblyUnits` + shared `nameSimilarity`**
  Files: `packages/viewer/src/units.ts` (new), `packages/viewer/src/units.test.ts`
  (new), move `nameSimilarity` out of `production.service.ts`, export from
  `packages/viewer/src/index.ts`.
  Tests: wrapper unwrap; flat model → per-leaf units; PCB-like fixture
  (7 children, one with 300 leaves + BOM of 7) → 7 units; authored unit
  precedence; descend-when-no-BOM-match.
  Verify: `pnpm --filter @carbon/viewer test` and typecheck green.

- [x] **T2 — Geometry service: units + PLAN_VERSION 3**
  Files: `services/geometry/app/schemas.py` (`PlanOptions.units`),
  `services/geometry/app/plan.py` (`plan_step(units=...)`, merge in
  `_collect_world_parts`, emit `groups` with `name`, `PLAN_VERSION = 3`),
  `services/geometry/tests/test_plan.py` (nested fixture via
  `tests/fixtures/make_fixtures.py`: enclosure + board-with-children →
  collapsed unit plans as one body, group payload carries members + name).
  Verify: `services/geometry/.venv/bin/python -m pytest -q` green.

- [x] **T3 — Worker passes units**
  File: `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts` —
  fetch graph/BOM/mappings/groups, call `deriveAssemblyUnits`, send
  `options.units`.
  Verify: typecheck green; local run (see T6).

- [x] **T4 — Viewer/step-gen: v3 + names**
  Files: `packages/viewer/src/plan.ts` (`CURRENT_PLAN_VERSION = 3`, parse
  optional group `name`, title passthrough in `buildAssemblyStepGroups`),
  `packages/viewer/src/plan.test.ts`.
  Verify: `pnpm --filter @carbon/viewer test` green.

- [x] **T5 — BOM tree unit rows + toggle**
  Files: `apps/erp/app/modules/production/ui/Assemblies/AssemblyBomTree.tsx`,
  `production.service.ts` (group upsert already exists — reuse), route for the
  toggle if one doesn't fit an existing action.
  Verify: typecheck; browser check in T6.

- [x] **T6 — End-to-end on the real model**
  Re-upload (or plan.rerun) the 431-part model: expect ~7 planned units,
  plan runtime **≪ 11 min** (target < 2 min), Generate Steps produces ~7 draft
  steps with sane titles, PCB animates as one unit.
  Verify: `assemblyPlanJob` row Success + timing; steps count; visual check.

- [x] **T7 — Spec + docs sync**
  Update `.ai/specs/2026-07-04-animated-work-instructions-contracts.md`
  (units option, v3, group name) and the production module `AGENTS.md` row for
  `generateAssemblyStepsFromPlan`/plan pipeline.

## Risks / notes

- **Name-similarity misgrouping**: a subassembly wrongly collapsed hides real
  steps. Mitigations: only subtree candidates are eligible (never arbitrary
  node sets), the BOM tree shows what collapsed and why, and the toggle undoes
  it per model. The failure mode is conservative (fewer, coarser steps), not
  corrupt motion.
- **No instruction/BOM at plan time** (model uploaded standalone): derivation
  degrades to hierarchy-only — still strictly better than today's flat soup.
- **Collision cost of merged meshes**: a collapsed PCB keeps its full
  triangle count in one body; pair count drops quadratically so net runtime
  falls sharply. If a pathological model is still slow, decimating unit
  collision meshes is the follow-up lever (not in this pass).
- **Plan v3 staleness bump** auto-invalidates every existing v2 plan —
  intended (they're leaf-soup plans), but note reruns will trigger on next
  Generate Steps for existing models.
- **`assemblyUnit.partNodeIds` vs re-uploads**: nodeIds are stable per the
  nodeId contract for the same geometry; a changed model re-derives units
  fresh (authored units referencing vanished nodeIds are skipped by
  derivation).

- **Two meanings of "group"**: plan.json `groups` (wire format for a
  multi-part planned unit) is unrelated to the `assemblyUnit` table (persisted
  subassembly override). Post-D0 nothing DB-side is called a "group", which
  dissolves the collision.

## Revision — CAD is flat, group by BOM membership (2026-07-06)

Inspecting the real model (SA-BCU, 431 leaves) disproved the nesting
assumption: the STEP export is **completely flat** — all 431 solids are direct
children of the root, no subassembly nodes. The PCB's ~400 component solids
(`R_0402`, `SOT-23`, `PG-TSDSO`, `minimalBCU_gen2_PCB`, …) are top-level
siblings of the enclosure, seal, and screws. The BOM has 7 lines including
**`BCU PCB` (qty 1)**.

So units cannot come from the tree. `deriveAssemblyUnits` is rewritten to group
by **BOM membership**:
- The LLM (`assignPartsToBom`, gpt-4o-mini) assigns each distinct part *name* to
  a BOM line — electronic footprints → the PCB line — since text similarity
  can't (`minimalBCU_gen2_PCB` vs `BCU PCB` scores 0.25; `R_0402` shares nothing
  with `BCU PCB`). Exact geometry↔BOM mappings win over the LLM guess.
- Leaves group by assigned item. A group **collapses into one rigid body only
  when quantity ≤ 1 and it has ≥ 2 leaves** (a single subassembly shown in
  detail — the PCB). Multi-quantity lines (8 screws, 4 clips) stay separate
  bodies; the viewer's identical-part grouping still merges them into a step.
- The qty≤1 heuristic is imperfect (user: "1 seems most correct… may not be
  true in other instances") — the T5 manual override (`assemblyUnit`) is the
  escape hatch for the exceptions.

Replaces the hierarchy-unwrap/descend rules and `assemblyUnitCandidates` from
the original D1. `AssemblyUnit.source` is now `authored | bom | loose`. The
worker sends only collapsed (multi-leaf) units as `options.units`.

## T6 result — verified on SA-BCU (2026-07-06)

Triggered a fresh plan for the real 431-leaf model end-to-end:
- LLM assigned all 431 leaves, 0 unmatched: 412 → BCU PCB, 8+4 screws, 4 clips,
  seal/lid/box (~1s, gpt-4o-mini).
- Geometry planned **~20 bodies in 105s** (was 431 bodies / ~11 min).
- plan.json v3 with two collapsed units: `BCU PCB` (411 members) and
  `Electronics Box - 36 Pin` (2 members).
- buildAssemblyStepGroups over the real graph → **431 parts render as 11 steps**,
  the PCB one step titled "BCU PCB".
- Caveat: the merged PCB and Box bodies flag (motion "none", fade in) — no
  collision-free insertion into the sealed enclosure. Structurally correct;
  motion quality is a follow-up (manual motion or an authored split).

## Execution log (running)

- 2026-07-06 — Plan drafted; rule = BOM-driven with top-level hierarchy
  fallback + authored-group override (user-confirmed).
- 2026-07-06 — D0 added: collapse the parity taxonomy to Subassembly-only,
  in-place migration edit + local psql patch (user-confirmed).
- 2026-07-06 — D0 revised: no child instructions at all (instructions attach
  to items; each BOM level's item has its own instruction), so the override
  rescopes to `modelUploadId` as lean `assemblyUnit` (user-confirmed).
