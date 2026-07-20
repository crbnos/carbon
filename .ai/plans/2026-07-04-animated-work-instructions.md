# Animated Work Instructions — Implementation Plan

Spec: `.ai/specs/2026-07-04-animated-work-instructions-design.md`
Research: `.ai/research/animated-work-instructions.md`
Conventions: `.ai/rules/conventions-database.md`, `conventions-services.md`,
`conventions-forms.md`, `conventions-ui.md`

Working name for the module: **assembly**.

---

## Phase 0 — Foundations (assembly-aware viewer + manual animated instructions)

Goal: STEP upload → server-converted GLB with assembly hierarchy → new AssemblyPlayer
component → manually authored animated steps, playable in ERP and MES. No planner yet.
This phase is shippable on its own and de-risks the whole stack.

### 0.1 Geometry service skeleton
**Files:** create `services/geometry/` (Dockerfile, `pyproject.toml`, FastAPI app)
1. FastAPI app with `/health`, `/convert` (accepts signed source URL + signed PUT URLs
   for artifacts, plus options: deflection, units), API-key auth via shared secret env.
2. Dependencies: `cadquery-ocp` (OCCT), `trimesh`, `pygltflib`; pin versions.
3. Local dev: docker-compose entry; document `npm run dev` interplay in README.
4. Commit.

### 0.2 STEP → GLB + graph.json conversion
**Files:** `services/geometry/app/convert.py`, tests with 2–3 sample STEP fixtures
1. `STEPCAFControl_Reader` → XCAF doc → walk assembly tree: per-node name, local
   transform, product vs instance, color.
2. `BRepMesh_IncrementalMesh` (configurable deflection) → `RWGltf_CafWriter` GLB.
3. Generate stable node IDs: `hash(geometryHash + parentPath + siblingOrdinal)`; write
   into glTF node `extras` (post-pass with pygltflib) and into `graph.json` (tree,
   transforms, bboxes, volume, unit).
4. Unit-normalize to mm; record source unit.
5. Pytest over fixtures: node count, ID stability across two runs, GLB loads in
   three.js (validate with `gltf-validator` in CI).
6. Commit.

### 0.3 Meshopt compression pass
**Files:** `services/geometry/app/optimize.py` (or Node sidecar step in the Inngest fn
using `@gltf-transform/cli`)
1. Apply quantize + `EXT_meshopt_compression`; preserve node extras.
2. Verify size reduction and round-trip of extras in test.
3. Commit.

### 0.4 Database migration: processing columns + plan job table
**Files:** `packages/database/supabase/migrations/<ts>_assembly-foundations.sql`
1. Follow `.ai/rules/conventions-database.md`. Alter `modelUpload`: add `processingStatus`,
   `processingError`, `glbPath`, `graphPath`, `partCount`, `processedAt`.
2. Create `assemblyPlanJob` per spec (kind: 'convert' now, 'plan' later) with RLS.
3. `npm run db:build`; commit.

### 0.5 Inngest convert pipeline
**Files:** `packages/jobs/src/inngest/tasks/assembly-convert.ts`, event in
`packages/jobs/src/events.ts`
1. Event `assembly/model.process` {modelUploadId, companyId, userId}.
2. Function: mark queued → create signed URLs → POST geometry `/convert` → poll/await →
   update `modelUpload` + `assemblyPlanJob` → emit `assembly/model.processed`.
3. Failure path writes `processingError`; retries per existing Inngest patterns (mirror
   `model-thumbnail.ts`).
4. Trigger from the existing model upload path for `.step/.stp` files (find the upload
   action that writes `modelUpload`).
5. Commit.

### 0.6 packages/viewer: AssemblyPlayer
**Files:** create `packages/viewer/` (package.json, tsup config) with
`AssemblyViewer.tsx`, `AssemblyPlayer.tsx`, `useAssembly.ts`, `motion.ts`
1. Deps: `three` (catalog), `@react-three/fiber`, `@react-three/drei`,
   `three-stdlib` meshopt decoder. No imports from apps.
2. `useAssembly(glbUrl, graphUrl)`: loads GLB, indexes nodes by stable ID, exposes
   tree + setters (highlight, ghost/wireframe, hide, transform offset).
3. `motion.ts`: build three.js KeyframeTracks from step motion JSON
   ({linear|L|helix|path}); reverse for insertion playback; per-step clip cache.
4. `AssemblyPlayer`: props = {glbUrl, graphUrl, steps, activeStepIndex,
   onStepChange, readOnly}; renders canvas, step scrubber, play/pause, part
   highlight for active step, prior parts solid / future parts hidden or ghosted.
5. Storybook-style demo route or vite playground inside the package for development.
6. Commit.

### 0.7 Instruction schema migration
**Files:** `packages/database/supabase/migrations/<ts>_assembly-instructions.sql`
1. `assemblyInstruction`, `assemblyInstructionStep` per spec (fractional `sortOrder`,
   JSONB motion/camera/fastener/warnings, `partNodeIds TEXT[]`,
   `planConfidence`), RLS, indexes on (companyId, modelUploadId) and
   (assemblyInstructionId, sortOrder).
2. Nullable `assemblyInstructionId` FK on `jobOperation` and `methodOperationStep`.
3. New `assembly` module permissions wired like existing modules (check how `quality`
   or similar module registers permissions).
4. `npm run db:build`; commit.

### 0.8 Assembly module: models + service
**Files:** `apps/erp/app/modules/assembly/assembly.models.ts`, `assembly.service.ts`
1. Zod validators (instruction, step upsert with motion JSON schema) per
   `.ai/rules/conventions-forms.md`; service CRUD per `conventions-services.md` (Kysely transaction for
   bulk step writes/reorder — see `database-transactions` skill notes).
2. Commit.

### 0.9 ERP routes: instruction editor (manual authoring MVP)
**Files:** `apps/erp/app/routes/x+/assembly+/` (list, `$id.tsx` editor), path entries
in `apps/erp/app/utils/path.ts`
1. List route: instructions table (status, item, model, updated).
2. Editor route: three-pane layout — step list (drag reorder via fractional sortOrder),
   AssemblyPlayer center, step detail form right (title, text, partNodeIds via
   click-to-select in viewer, motion editor: direction gizmo + distance, helix params).
3. "New instruction from model" action on item Model tab when
   `processingStatus = success`.
4. `requirePermissions` with `assembly` module throughout.
5. Commit.

### 0.10 MES playback (read-only)
**Files:** `apps/mes/app/routes/x+/operation.$operationId.tsx` (+ JobOperation
component)
1. If linked instruction exists, render AssemblyPlayer (readOnly) in/next to the Model
   tab; step next/prev controls sized for gloved touch.
2. Commit.

### 0.11 Phase 0 verification
1. `/login` + `/test`: upload a multi-part STEP fixture, watch convert succeed, author
   3 manual steps, play in editor, link to a job operation, view in MES.
2. Record findings; fix; commit.

---

## Phase 1 — Auto-draft (the planner)

Goal: "Generate instructions" produces a complete draft: fastener groups, sequence,
motions, text.

### 1.1 Contact/blocking graph
`services/geometry/app/contacts.py`: trimesh-based proximity/contact pairs (distance <
ε), per-pair contact normals + blocked direction cones; persisted into graph.json.
Tests on fixtures (stacked plates, pin-in-hole).

### 1.2 Fastener classification
`services/geometry/app/fasteners.py`:
1. Name regex table (ISO/DIN/ANSI/McMaster patterns) over node names.
2. Geometry heuristic: small bbox, ≥80% lateral surface from coaxial cylinders (OCCT
   face typing), hex/socket head detection; duplicate clustering by geometry hash.
3. Axis + insertion direction from coaxial hole in contacting part; emit fastener
   groups {spec?, count, axis, targetNodeIds}.
4. Tests: fixture with named + unnamed screws; false-positive guard (dowel pins
   classified as pins not screws is acceptable Phase 1).

### 1.3 Greedy disassembly sequencer
`services/geometry/app/sequence.py`:
1. Candidate directions per part: ±XYZ, principal axes, hole/fastener axes.
2. Removability: sample path (~100 poses × clearance ε) collision checks
   (trimesh.CollisionManager); fasteners removed first per group (analytic helix +
   retract).
3. Greedy loop respecting XCAF subassembly boundaries; tie-break: top-down, outside-in,
   small-parts-last reversed to small-parts-first on assembly.
4. Tier-4 "L" motions (lift-then-slide two-segment search) for failures.
5. Unresolved parts → manual steps with reason codes.
6. Output plan.json: ordered steps {partNodeIds, motion, confidence, warnings}.
7. Budget caps + structured timing stats. Tests on 3 fixtures incl. one designed
   failure.

### 1.4 `/plan` endpoint + Inngest wiring
1. `/plan` on geometry service (inputs: graph.json + GLB or mesh cache; output:
   plan.json to signed URL).
2. Inngest `assembly-plan.ts`: chain after convert when user requests generation;
   `assemblyPlanJob` kind 'plan'; on success, transactional draft creation:
   `assemblyInstruction` + steps from plan.json (motion, partNodeIds, fastener,
   warnings, confidence).

### 1.5 Step text generation
`packages/jobs/src/inngest/tasks/assembly-step-text.ts`: structured facts → existing AI
infra (small prompt, batch) with deterministic template fallback ("Install 4× M5 SHCS
into mounting plate (8 N·m)"). Editor regenerate button per step.

### 1.6 Editor: draft triage UX
Confidence filter (low-confidence/manual-needed queue), accept/fix flows, re-plan
button (re-runs planner preserving user-edited steps by partNodeIds match).

### 1.7 Phase 1 verification
End-to-end on 3 real assemblies (find public STEP assemblies: gearbox, vise, enclosure)
— measure: % steps auto-accepted, planner wall time. Target: >70% steps accepted
unedited, <5 min for ≤200 parts.

---

## Phase 2 — Editor depth + MES execution

- 2.1 Subassembly grouping UI (parentStepId tree; collapse groups into single steps).
- 2.2 Exploded view generation (offsets along removal directions; explode slider in
  player; per-step explode JSON).
- 2.3 Auto-camera: offscreen ID-buffer scoring of ~26 candidate views per step in the
  geometry service or client; temporal smoothness penalty; stored in step camera JSON.
- 2.4 Stability gate: pybullet drop-test per reversed step → hold/fixture warnings
  surfaced as step callouts.
- 2.5 MES execution: step-complete events, per-step durations on jobOperation, parts/
  fastener pick callouts; gloved-touch UI polish.
- 2.6 `share+` public player route (signed, revocable) — the standalone wedge.
- 2.7 Tool/torque libraries: link `methodOperationTool`/resources; torque field on
  fastener JSON surfaced in player.

## Phase 3 — Moats

- 3.1 Revision propagation: graph diff (name + geometry hash + position matching),
  step remap, "needs review" flags, instruction version bump flow.
- 3.2 Physics escalation tier (Assemble-Them-All-style force-guided search, MIT code as
  reference; budget-capped, behind a flag).
- 3.3 Onshape: pull mates + native glTF for connected tenants; mate axes feed the
  sequencer.
- 3.4 APS Model Derivative fallback for native formats (SLDASM/NX/CATIA) using existing
  AutodeskViewer/urn plumbing.
- 3.5 Operator feedback loop: `assemblyInstructionFeedback` from MES → editor inbox.
- 3.6 PDF/static export via `packages/documents` (per-step rendered frames).
- 3.7 FTO review (US 11,813,756; US 9,053,258; US 7,295,201) before GA marketing.

## Risks / open questions

1. **OCCT learning curve + dirty CAD** — mitigate with per-part failure isolation and
   a fixture corpus collected from real customer files early.
2. **Planner quality on real assemblies** is the product risk; Phase 1.7 metrics gate
   further investment in tiers vs. editor ergonomics.
3. **ECS sizing/cost** for geometry workers (CPU/mem heavy, bursty) — start with one
   modest service + queue depth alarm; Modal/Fly escape hatch documented.
4. **Single new language in the monorepo** (Python service) — CI, lint, deploy
   pipelines need an owner; keep the service API tiny.
5. **Naming**: "assembly" module vs. product name (decide before routes ship).

## Review

(to be filled in during execution)
