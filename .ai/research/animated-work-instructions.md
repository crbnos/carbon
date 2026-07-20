# Animated Work Instructions from CAD: Research

## Summary

Research into building automated assembly work instructions: a system that ingests a
CAD assembly (STEP et al.) and automatically generates animated, step-by-step 3D work
instructions — assembly sequence, per-part insertion animations, fastener handling,
exploded views, and step text — with a human-in-the-loop editor for the last 20%
(torque specs, tools, tribal knowledge). Commercial tools in this category automate
roughly 80% of authoring and report order-of-magnitude reductions in authoring time.
Conclusion: the core is **deterministic geometry, not ML** — a tiered
"assembly-by-disassembly" planner built on open-source components (OCCT, trimesh/FCL,
pybullet, MIT-licensed Assemble-Them-All) is buildable, and Carbon already owns the
surrounding product surface (items/revisions, methods, procedures, MES execution,
model uploads, a 3D viewer) that point solutions have to integrate into via connectors.

## Market patterns (point solutions in this category)

- **Input:** STEP plus selected native formats; drag-and-drop, minutes-to-draft.
- **Automated (~80%):** assembly sequence generation; per-part removal/insertion path
  planning rendered as 3D animations, regenerated when the sequence or CAD changes;
  step text; EBOM → MBOM → bill-of-process transformation; clearance/DFM flags;
  recurring-subassembly recognition and reuse.
- **Manual (~20%):** torque specs, adhesives, tools, safety, quality checks, step
  reordering, build-tree reshaping, annotations, custom cameras.
- **Execution layer:** shop-floor playback with cycle-time capture and operator
  feedback, pushing run data to the customer's MES/ERP via connectors.
- **Exports:** interactive web link, PDF/Word/PowerPoint.
- **Positioning pattern:** "deterministic" geometric/physics reasoning rather than
  generative output; standalone tools must bridge into someone else's MES/ERP — a
  native ERP/MES suite can own the loop end-to-end. That is Carbon's wedge.
- **Common gaps:** flexible parts (cables, gaskets) and non-geometric process steps
  (bonding, curing, testing) remain manual; large assemblies stress browser rendering.

## Algorithmic Foundations

### 1. Assembly sequence planning (ASP)
- Standard approach: **assembly-by-disassembly** — repeatedly find a part (or
  subassembly) that can be removed collision-free from the assembled state; reverse the
  order. Theory: Wilson & Latombe non-directional blocking graphs (NDBG), AND/OR graphs.
- State of the art: **Assemble-Them-All** (SIGGRAPH Asia 2022, MIT license,
  github.com/yunshengtian/Assemble-Them-All) — physics-guided disassembly path search
  with point-vs-SDF collision; handles rotational/interlocked removals. **ASAP** (ICRA
  2024, github.com/yunshengtian/ASAP, **no license — contact authors**) adds gravity
  stability with ≤k held parts.
- Practical simplification used by commercial tools: greedy disassembly testing **6–26
  candidate straight-line directions** (axis-aligned + part principal axes + mate/hole
  axes) ≈ a sampled NDBG; covers the vast majority of real assemblies. Escalate
  leftovers to RRT (OMPL) or physics search; flag the rest for the human editor.
- Cost: direction-sampled greedy on a 100-part assembly = seconds–minutes CPU.
  Physics-complete search = minutes–1 h.

### 2. Collision detection
- trimesh `CollisionManager` (MIT) wrapping python-fcl (BSD) is the fastest prototype
  path; Bullet (zlib)/Jolt (MIT) as alternatives; point-vs-SDF sampling (à la
  Assemble-Them-All) is robust to dirty CAD meshes and GPU-parallelizable.
- Don't compute swept volumes explicitly (the best open-source code implements a
  patent-pending method): densely sample the removal path (~100 poses) and run discrete
  checks with a clearance epsilon. Sub-second per part with BVH broadphase.

### 3. Part-removal motion planning
- 3-tier cascade: (1) straight line along candidate axes → (2) two-segment "L" motions
  (lift-then-slide) → (3) OMPL RRT in SE(3) / physics-guided search. Tiers 1–2 resolve
  ~90%+ of steps.
- **Threaded fasteners: don't plan, parameterize.** Once classified as a screw with axis
  and pitch, removal is an analytic helix + linear retraction; for human instructions
  only the axis and turn direction matter — the animation is a canned helix.

### 4. Fastener detection in CAD
- Real STEP files rarely contain thread geometry; fasteners are simplified cylinders.
  Highest-ROI detectors, in order:
  1. **Name regex** against fastener-standard tables (M5, SHCS, DIN 912, ISO 4762,
     McMaster part numbers) — purchased components almost always carry these names.
  2. **Geometry heuristic:** small part dominated by coaxial cylindrical faces + hex/
     socket head, duplicated N times with identical geometry. (OCCT face typing;
     Analysis Situs, BSD-3, is the only OSS CAD feature-recognition framework.)
  3. Insertion axis = common cylinder axis, head→tip, disambiguated by the coaxial hole
     in the mating part. Group identical fasteners into one step ("install 4× M5 SHCS").
- **Mates/constraints do NOT survive STEP export** (AP242 kinematics is unimplemented by
  mainstream CAD). Get real mates only via native APIs — **Onshape's API exposes mates
  with full DOF semantics, and Carbon already has an Onshape integration**. Learned
  joint inference exists (Autodesk JoinABLe/AutoMate, research licenses) as a later
  option.

### 5. Exploded views & cameras
- Canonical: Li/Agrawala SIGGRAPH 2008 explosion graphs. For work instructions the
  shortcut is better: explode along the per-step removal directions the planner already
  computed; offset = bbox clearance × constant.
- Camera per step: viewpoint-entropy style scoring — render ~26–64 candidate views
  offscreen with ID buffers, score visibility of the active part + its destination
  interface, penalize camera jumps between steps.
- FTO note: occlusion-based auto-explode patents exist (US 9,053,258; US 7,295,201);
  disassembly-planning patent US 11,813,756. Worth a freedom-to-operate review.

### 6. Stability
- Modern practice (ASAP): drop the intermediate subassembly in a physics sim (pybullet,
  ~1 s sim time, 10–100 ms wall); if parts displace, it's unstable → emit "hold part
  while fastening" / "do not flip until step N" notes. Heuristic pre-filter: a placed
  part is unstable-until-fastened unless inserted downward into a pocket/onto a pin.

## Engineering Stack

### What Carbon already has (verified in repo)
- `modelUpload` table (`20240630115404_model-uploads.sql`) attached to items, jobs,
  quote/sales/purchase lines; files in Supabase storage; served via
  `apps/erp/app/routes/file+/model+/$id.tsx`.
- `packages/react/src/ModelViewer.tsx` — online-3d-viewer (occt-import-js WASM) +
  three.js 0.163: loads STEP/STL in-browser today (no assembly tree, no animation —
  transforms get baked into vertices, unusable for animation targeting).
- `packages/react/src/AutodeskViewer.tsx` — APS (Forge) viewer with token provider, URN
  loading; `modelUpload.autodeskUrn` column exists.
- `packages/ee/src/onshape/` — live Onshape OAuth + BOM sync into quotes/jobs/items.
- **Inngest** (`packages/jobs/src/inngest/`, inngest ^3.52.7) is the background job
  system. Existing pattern: `tasks/model-thumbnail.ts` calls a Supabase edge function
  to screenshot the viewer.
- Work-instruction backbone: `makeMethod` → `methodOperation` → `methodOperationStep`;
  `procedure`/`procedureStep`; `jobOperation` in MES with a Model tab at
  `apps/mes/app/routes/x+/operation.$operationId.tsx`.
- Deploy target: AWS ECS via SST; Docker images per app.

### Recommended pipeline
1. **Ingest (server-side):** Python worker with OCP (native OCCT bindings; OCCT is
   LGPL-2.1-with-linking-exception, safe for SaaS): `STEPCAFControl_Reader` → XCAF
   (assembly tree, per-node transforms, names, colors) → `BRepMesh_IncrementalMesh` →
   `RWGltf_CafWriter` → GLB. WASM OCCT (OpenCascade.js) has a 4 GB ceiling and ~5×
   slowdown — wrong tool for 1000-part assemblies. Keep occt-import-js for instant
   client preview only.
2. **Web format:** GLB + meshopt compression (`EXT_meshopt_compression` via
   glTF-Transform — GPU-decodable, compresses animation tracks; Draco can't). Stable
   part IDs stamped into node `extras` keyed to the assembly-graph JSON and BOM rows.
   LODs via gltf-transform simplify for >500-part assemblies.
3. **Viewer:** react-three-fiber + drei (three.js already a dependency). Animation as
   **runtime-generated KeyframeTracks from a JSON step plan** (insertion vector / helix
   params per step), NOT baked into the GLB — keeps the plan editable. BatchedMesh for
   unique parts, InstancedMesh for repeated fasteners.
4. **Compute:** Inngest orchestrates; heavy lifting in a dedicated Python container
   (OCCT + trimesh + python-fcl + pybullet) on ECS (matches existing infra) — CPU-bound,
   no GPU needed. Seconds for parts, ~1–10 min for large assemblies.
5. **Fallbacks for native CAD formats:** APS Model Derivative (0.1–0.5 Flex tokens/job;
   viewer already integrated) for SolidWorks/NX/CATIA natives; Onshape API direct glTF +
   mates for Onshape customers. CAD Exchanger has stopped new SDK sales; HOOPS is
   ~$50k+/yr — revisit only if native-format demand justifies it.
6. **Physics:** pybullet (zlib) or MuJoCo (Apache 2.0) in the same worker for stability
   checks; PhysX 5 (BSD-3, GPU) only if search throughput ever demands it.

## Recommended Approach for Carbon

1. **Own the loop point solutions can't:** generate instructions from the model on an
   item revision, attach them to methods/procedures, execute them in MES with real
   time/quantity/quality capture — no connectors needed.
2. **Tiered deterministic planner** (name-regex + geometry fastener detection → greedy
   direction-sampled disassembly → L-motions → physics escalation → human editor) —
   ship value long before research-grade completeness; the market norm is 80/20.
3. **Editor-first product**: the planner produces a draft; the editor (reorder, group,
   annotate, torque/tools/checks) is what makes it shippable. Animations re-derive from
   the plan JSON on every edit.
4. **Revision propagation** as headline feature parity: diff assembly graphs between
   item revisions, remap untouched steps, flag changed ones.
5. Standalone potential: keep planner service + viewer package + instruction schema
   decoupled from ERP routes so a standalone shell app is cheap later.

## Sources

Wilson & Latombe, *Geometric Reasoning About Mechanical Assembly* (AIJ 1994);
github.com/yunshengtian/Assemble-Them-All (MIT) and /ASAP; Li/Agrawala, *Automated
Generation of Interactive 3D Exploded View Diagrams* (SIGGRAPH 2008); Analysis Situs
thread-recognition writeups; OCCT XDE/RWGltf documentation; gltf-transform.dev; Onshape
translation/mates API docs; aps.autodesk.com/pricing; trade press and vendor materials
on automated work-instruction tools.
