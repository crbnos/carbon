# Animated Work Instructions ("Assembly") — Design

## Summary

Automated assembly work instructions inside Carbon: upload a CAD assembly (STEP first),
and Carbon automatically drafts step-by-step, animated 3D work instructions — build
sequence, per-part insertion animations, grouped fastener steps, exploded views, camera
framing, and step text — which an engineer then refines in an editor (reorder, group,
add tools/torque/notes/quality checks) and publishes to MES for operator playback with
cycle-time and quality capture. The system is deterministic geometry + physics
heuristics (no generative model in the planning loop), with an LLM used only to phrase
step text from structured step facts.

Strategy: build it as a Carbon module with three deliberately decoupled layers —
**geometry service** (Python/OCCT planner workers), **instruction schema + editor**
(TypeScript, new tables), and **viewer** (`packages/viewer`, react-three-fiber) — so it
can later ship as a standalone product (point solutions sell standalone; Carbon's advantage is
native MES execution, but the standalone wedge "upload CAD → shareable animated
instructions" must not depend on ERP internals).

## Research

From `.ai/research/animated-work-instructions.md`:

- Commercial tools in this category automate ~80% (sequence, animations, text,
  EBOM→MBOM) and leave ~20% to a human editor; revision propagation and subassembly
  reuse are the differentiators; standalone tools must push run data into someone
  else's MES — Carbon owns that loop natively.
- The proven algorithmic core is **assembly-by-disassembly**: repeatedly find a part
  removable without collision, reverse the order. A direction-sampled greedy planner
  (6–26 candidate axes per part) + analytic helices for fasteners + physics drop-tests
  for stability covers the bulk of real assemblies; OMPL/physics search is the
  escalation tier (Assemble-Them-All is MIT-licensed reference code).
- Mates don't survive STEP. Fastener detection = name regex + coaxial-cylinder
  geometry heuristics; Onshape API (already integrated in Carbon) is the one source of
  real mates.
- Carbon already has: `modelUpload` on items/jobs/lines, an in-browser STEP viewer
  (preview-only), an APS viewer, Onshape OAuth + BOM sync, Inngest jobs, Supabase
  storage, methods/procedures/jobOperation, and an MES Model tab.
- Server pipeline: Python + native OCCT (XCAF → tessellate → `RWGltf_CafWriter` GLB),
  meshopt-compressed GLB with stable part IDs in node extras, react-three-fiber
  playback with runtime-generated keyframe tracks from an editable JSON step plan.

## Decisions

### 1. Standalone product vs. Carbon module
**Question:** Build inside Carbon ERP, or as a separate app?
**Research:** point solutions are standalone and integrate outward via connectors; their weakness
is not owning execution. Carbon's monorepo already has multi-tenant auth, storage,
permissions, and two apps (ERP/MES) sharing packages.
**Approach:** Carbon module first (`assembly` module in ERP + playback in MES), with
hard boundaries: planner service speaks a JSON contract (no Carbon DB access except via
API), viewer lives in `packages/viewer` with zero ERP imports, instruction tables keyed
to `modelUpload`/`itemId` but not entangled with method internals. A standalone shell
app (`apps/assemble`) becomes a later packaging exercise, not a rewrite.

### 2. Geometry processing: where and with what
**Question:** WASM in browser, TypeScript server, or Python workers? OCCT vs. commercial?
**Research:** WASM OCCT hits a 4 GB ceiling and ~5× slowdown; OCCT native (LGPL +
linking exception) extracts assembly hierarchy/transforms/names and writes glTF
directly; all the planning libraries (trimesh, python-fcl, pybullet, OMPL,
Assemble-Them-All) are Python/C++.
**Approach:** New containerized **Python geometry service** (`services/geometry/`),
deployed on ECS alongside the apps, with a small HTTP API + job queue semantics.
Inngest functions orchestrate: upload event → enqueue convert → enqueue plan →
write artifacts to Supabase storage → update DB rows. Browser keeps occt-import-js
preview for instant feedback while the server pipeline runs. STEP only at first; APS
Model Derivative as the native-format fallback later (viewer already integrated);
Onshape direct glTF + mates for Onshape-connected tenants.

### 3. Planner architecture
**Question:** Research-grade physics planning (ASAP) or tiered heuristics?
**Research:** the market norm is 80/20 automation with deterministic geometry + heuristics. Tiered
approach resolves ~90% of steps in tiers costing milliseconds–seconds; physics-complete
search costs minutes–hours and ASAP's code is unlicensed.
**Approach:** Tiered deterministic pipeline, every tier emitting confidence + failure
reasons so the editor can surface "couldn't sequence these 3 parts — drag them where
you want":
1. Fastener classification (name regex + coaxial-cylinder heuristic + duplicate
   geometry clustering); fastener groups become single steps with analytic helix motions.
2. Contact/blocking graph from mesh proximity.
3. Greedy assembly-by-disassembly: candidate directions = 6 axis-aligned + part
   principal axes + hole/mate axes; path-sampled collision checks (trimesh/FCL).
4. Two-segment "L" motions for tier-3 failures.
5. Physics-guided escape search (Assemble-Them-All approach, MIT) for stubborn parts,
   budget-capped.
6. pybullet drop-test stability gate per reversed step → hold/fixture warnings.
7. Exploded views and per-step cameras derived from removal directions + viewpoint
   scoring.
CAD subassembly tree (XCAF) constrains the sequence by default (designers already
encode modules); users can regroup in the editor.

### 4. Data model: artifacts vs. rows
**Question:** What lives in Postgres vs. storage?
**Approach:** Geometry artifacts (GLB, assembly-graph JSON, plan JSON) live in Supabase
storage, immutable per processing run. Postgres holds what users query and edit:
instruction sets, steps, part metadata needed for lists/search, processing job status.
Steps reference parts by stable node IDs that appear in both the GLB extras and the
graph JSON.

### 5. Relationship to existing methods/procedures
**Question:** Extend `procedureStep`/`methodOperationStep`, or new tables?
**Research:** Existing steps are flat rich-text/parameter records with no notion of 3D
state, part sets, or motions; jamming animation data into them would contort both.
**Approach:** New `assemblyInstruction` + `assemblyInstructionStep` tables (versioned,
keyed to `itemId`/`modelUploadId`). Integration by reference: a `methodOperationStep`
or `jobOperation` can link to an instruction (new nullable FK), and the MES operation
view renders the player when present. EBOM→step mapping reuses Onshape/manual BOM rows
where available.

### 6. Step text generation
**Approach:** Planner emits structured facts per step (verb class, part names,
quantities, fastener spec, target, direction, warnings). A small Inngest task phrases
them via the existing AI infrastructure, with deterministic template fallback. No LLM
in the geometric loop.

### 7. Revision propagation (the moat feature)
**Approach:** Assembly-graph diff between two processed models (match nodes by name +
geometry hash + position): unchanged parts keep their steps and user annotations;
changed/added/removed parts flag affected steps for review. Ship in Phase 3; design the
node-ID scheme for it from day one (content-addressed part hashes, not array indices).

## Data Model

All tables follow Carbon golden rules (composite PK with `companyId`, `id('prefix')`,
audit columns, standard RLS policies).

```
modelUpload (existing — add columns)
  + processedAt, glbPath, graphPath, partCount, processingStatus
    ('idle'|'queued'|'processing'|'success'|'failed'), processingError

assemblyPlanJob          -- one row per planner run (convert / plan / replan)
  id, companyId, modelUploadId FK, kind ('convert'|'plan'), status, tiersCompleted,
  planPath (storage), stats JSONB (per-tier counts, timings), error, audit cols

assemblyInstruction      -- the editable, publishable instruction set
  id, companyId, itemId FK?, modelUploadId FK, assemblyPlanJobId FK?,
  name, status ('draft'|'published'|'archived'), version INT, publishedAt,
  settings JSONB (units, default camera, branding), audit cols

assemblyInstructionStep
  id, companyId, assemblyInstructionId FK, sortOrder (fractional),
  parentStepId FK? (subassembly grouping),
  partNodeIds TEXT[]           -- stable node IDs in GLB extras/graph JSON
  motion JSONB                 -- {type:'linear'|'L'|'helix'|'path', vector, pitch, keyframes?}
  camera JSONB                 -- {position, target, fov} | null = auto
  explode JSONB?               -- per-step exploded offsets
  title, instructionText, notes JSON (rich text),
  fastener JSONB?              -- {spec:'M5 SHCS', count:4, torqueNm?, tool?}
  toolIds TEXT[]?, durationSeconds?,
  warnings JSONB               -- planner stability/clearance flags
  planConfidence ('high'|'low'|'manual'), audit cols

jobOperation / methodOperationStep (existing)
  + assemblyInstructionId FK?  -- opt-in linkage for MES playback

assemblyInstructionFeedback   -- Phase 3: operator notes per step from MES
  id, companyId, stepId FK, jobOperationId FK?, userId, type, body, audit cols
```

Storage layout (`private` bucket):
```
{companyId}/models/{modelUploadId}.step                  (existing upload convention)
{companyId}/models/{modelUploadId}/{runId}/model.glb     (meshopt-compressed)
{companyId}/models/{modelUploadId}/{runId}/graph.json    (tree, transforms, bboxes,
                                                          contacts, fastener classes,
                                                          part hashes)
{companyId}/models/{modelUploadId}/{runId}/plan.json     (raw planner output)
```

## Architecture

```
ERP route (upload/replan)
   └─ Inngest event: assembly/model.process
        └─ Inngest fn → POST services/geometry /convert   (OCCT: STEP→GLB+graph.json)
        └─ Inngest fn → POST services/geometry /plan      (tiered planner → plan.json)
        └─ writes artifacts to Supabase storage, updates modelUpload/assemblyPlanJob
        └─ Inngest fn → step-text generation (AI, template fallback)
        └─ creates draft assemblyInstruction + steps from plan.json

packages/viewer (new)
   AssemblyPlayer: loads GLB, builds KeyframeTracks at runtime from step motion JSON,
   step scrubber, part highlight/ghost, exploded toggle. Used by:
   - ERP editor route (x/assembly/...): timeline, reorder, regroup, annotate, publish
   - MES operation view: read-only player synced to operation steps
   - share+ route: public/customer link (standalone wedge)

services/geometry (new, Python/FastAPI container on ECS)
   /convert: OCP (OCCT) XCAF read → tessellate → RWGltf GLB → glTF-Transform meshopt
   /plan:    trimesh + python-fcl collision, greedy disassembly tiers, pybullet
             stability, exploded offsets + camera scoring
   Stateless; reads/writes storage via signed URLs passed in the job payload.
```

Permissions: new `assembly` module permission set (view/create/update/delete), wired
into the standard module/permission system. MES playback requires only production view.

## Workflows

1. **Author:** Engineer opens an item revision → Model tab → "Generate instructions".
   Status chips show convert/plan progress (Inngest). Draft opens in the editor:
   left = step list (tree, drag-reorder, group), center = AssemblyPlayer, right = step
   detail (text, fastener spec, torque, tools, warnings). Low-confidence steps are
   flagged. Engineer edits, publishes → version N.
2. **Execute (MES):** Operation links an instruction. Operator sees the player inline:
   current step animation loops, parts-to-pick highlighted, fastener callouts ("4× M5
   SHCS, 8 N·m"), next/prev synced with step completion; time per step captured on
   existing jobOperation infrastructure.
3. **Share:** Publish generates a `share+` link rendering the read-only player (PDF
   export later via existing documents package).
4. **Revise (Phase 3):** New model upload on the next item revision → graph diff →
   steps remapped, changed steps flagged "needs review" → republish.

## Edge Cases

- **Dirty/huge CAD:** tessellation failures per-part shouldn't kill the run — degrade
  to bbox proxies, flag the part. Cap planner budgets per part/assembly; >1000-part
  assemblies get LOD meshes and coarser collision proxies.
- **Unsequenceable parts** (press fits, flexible parts, interlocks beyond tier 5):
  always emit them as manual steps at the end with a clear reason — never block the
  draft. This is the 80/20 contract.
- **Parts with no geometry role** (adhesive, grease, harnesses) and process-only steps
  (cure, test, torque pattern): editor supports geometry-less steps.
- **Fastener misclassification:** classification is a suggestion — editor can mark/
  unmark a part group as fasteners and the plan re-derives.
- **Single-part models** (most current Carbon uploads): pipeline still runs convert
  (better viewer) and skips planning gracefully.
- **Identical siblings** (4 identical brackets): stable node IDs must disambiguate by
  position, not just geometry hash, or revision diff and step references break.
- **Units/coordinate systems:** STEP is mm-typical but not guaranteed; normalize in
  convert, store unit in graph.json.
- **FTO:** before GA, review patents US 11,813,756 (disassembly-based planning),
  US 9,053,258 / US 7,295,201 (auto-explode), and avoid the patent-pending swept-volume
  method (use sampled discrete checks).

## Phasing (summary — full plan in .ai/plans/2026-07-04-animated-work-instructions.md)

- **Phase 0 — Foundations:** geometry service skeleton, STEP→GLB+graph pipeline,
  schema, AssemblyPlayer with manual step authoring. Valuable alone: assembly-aware
  viewer + manually-authored animated instructions in ERP/MES.
- **Phase 1 — Auto-draft:** fastener detection, greedy disassembly planner, helix
  motions, draft instruction generation, step text. The "3-minute demo".
- **Phase 2 — Editor depth + MES:** grouping/subassemblies, exploded views, camera
  auto-framing, stability warnings, MES operator playback + time capture, share links.
- **Phase 3 — Moats:** revision propagation (graph diff), physics escalation tier,
  Onshape mates, APS native-format ingest, operator feedback loop, PDF export.
