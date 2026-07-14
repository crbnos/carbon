# Geometry Service Rust Rewrite — implementation plan

**Spec:** .ai/plans/2026-07-10-geometry-service-rust-rewrite.md (feasibility plan; §9 decisions resolved — see Locked Decisions)
**Research:** embedded in the spec (§1 ground truth, ecosystem survey)
**Branch:** `feat/geometry-rs` (create from `main`)
**Executor:** Claude Opus — this plan is self-contained; no session memory assumed.

## Locked decisions (do not re-litigate)

1. `/plan` consumes the **GLB + graph.json** that `/convert` produced (signed GET URLs), not the STEP file. New payload shape, new service.
2. The OCCT cxx bridge is **vendored in-repo** at `services/geometry-rs/crates/occt-bridge`. No fork of opencascade-rs; depend on `occt-sys` for the OCCT build only.
3. **No PyO3 phase 0.** Straight to Phase A.
4. New code lives at `services/geometry-rs/` during transition. Python `services/geometry/` stays untouched and running until the final cutover tasks.
5. Python planner semantics are **frozen** for the duration of the port. If `services/geometry/app/plan.py` changes on `main` mid-port, STOP and report — goldens must be re-based deliberately.

## Rust conventions (apply to every task)

From `.ai/skills/rust-best-practices` (read `references/chapter_01.md`, `chapter_04.md`, `chapter_05.md` before writing code):

- Errors: `thiserror` enums in library crates (`planner`, `converter`, `glb`, `geometry-types`, `occt-bridge`); `anyhow` only in the `server` binary.
- **Never `unwrap()`/`expect()` outside `#[cfg(test)]`.** OCCT and mesh data are hostile inputs.
- `&str`/`&[T]` parameters over owned types; no clones in loops; iterators over manual index loops where clarity allows.
- Test names describe behavior: `seated_pair_depths_reports_max_penetration_for_overlapping_boxes()`.
- Lint gate for every task: `cargo clippy --all-targets --locked -- -D warnings` must pass.
- Use the `nalgebra` version re-exported by parry3d (`use parry3d::na`) — never a separately-pinned nalgebra (version skew breaks the math types).
- `//` comments only for non-obvious *why* (mirrors repo-wide comment rule).

## Hard rules from `.ai/lessons.md` (encoded as task constraints, but read them: lines 114–220)

- **Never fabricate a motion.** No tier-4 "forced removal". Unsolvable part ⇒ `motion: "none"` + `blockedBy` + warning.
- **Tolerance ≪ sample spacing.** `PENETRATION_TOLERANCE_MM = 0.15` vs `MAX_SAMPLE_SPACING_MM = 2.0` — allowances are pair-scoped and axis-gated, never global.
- **Fail-closed heuristics.** Classification with out-of-range evidence rejects; it never grants an allowance.
- **BVH per mesh, built once.** Never rebuild per query. "Excluding" a part during its own sweep = unregister the same collision object from the broadphase (rebuilds nothing), re-register after. Blocker discovered mid-sweep ⇒ unregister for the rest of that sweep.
- **Fastener names:** no ambiguous single tokens (`pin` is out); name match + physical sanity cap (`max(100mm, 0.35 × assembly diagonal)`).
- **GLB↔graph join must be validated by bbox** against graph.json (authoritative), asserting full coverage with max error < 1 mm.

---

## Progress

- [ ] Task 1: Scaffold the cargo workspace
- [ ] Task 2: Wire types crate (`geometry-types`)
- [ ] Task 3: Fixture generation script (Python-side, emits GLB/graph/STEP test data)
- [ ] Task 4: GLB reader with meshopt decode (`glb` crate, read half)
- [ ] Task 5: SPIKE — meshopt quantization error vs penetration tolerance (GO/NO-GO gate)
- [ ] Task 6: Planner scaffolding — constants, `Component`, world-part collection
- [ ] Task 7: Parity tracker (`PARITY.md`) enumerating all Python plan tests
- [ ] Task 8: Collision layer — broadphase manager + calibration suite
- [ ] Task 9: Seated pair depths + ordering adjacency
- [ ] Task 10: Fastener classification
- [ ] Task 11: Rigid merge + embedded pairs
- [ ] Task 12: Fastener ring joints
- [ ] Task 13: Sandwich detection
- [ ] Task 14: Removal planning — tier 1 linear + tier 2 "L"
- [ ] Task 15: Tier 3 escape BFS + group removal
- [ ] Task 16: Greedy disassembly loop + base re-selection
- [ ] Task 17: Precedence DAG, preference topo sort, forward verification
- [ ] Task 18: Fixed-sequence mode + units
- [ ] Task 19: `plan_step` orchestration + plan.json v3 output parity
- [ ] Task 20: Determinism test, then rayon parallelization
- [ ] Task 21: Server binary — axum `/health`, `/plan`, `/plan/{jobId}`
- [ ] Task 22: Shadow-comparison harness + large-noisy-model gate
- [ ] Task 23: Jobs-side switch — `assembly-plan.ts` calls the Rust planner
- [ ] Task 24: Dev-stack wiring for the Rust planner
- [ ] Task 25: `occt-bridge` crate — build skeleton + exception guards
- [ ] Task 26: Bridge surface — STEP/XCAF document read
- [ ] Task 27: Bridge surface — tessellation, volume, bbox, colors
- [ ] Task 28: Converter crate — XCAF walk, nodeIds, graph.json parity
- [ ] Task 29: GLB writer (`glb` crate, write half)
- [ ] Task 30: meshopt encode pipeline (replaces gltf-transform)
- [ ] Task 31: Server `/convert` route + endpoint tests
- [ ] Task 32: Rust fixture generator (drop Python from geometry-rs CI)
- [ ] Task 33: Converter parity gate (Python vs Rust on fixtures + real STEP)
- [ ] Task 34: Dockerfile + CI workflow
- [ ] Task 35: Full cutover + Python removal (**requires user approval**)

## Dependencies

- Tasks 1→2→{3,4}→5 are strictly sequential. **Task 5 is a GO/NO-GO gate.**
- Tasks 6–8 after 5. Tasks 9–13 depend on 8; 9 must precede 10–13 (they consume pair depths). Tasks 10, 11, 12, 13 are mutually independent (parallelizable).
- 14→15→16→17→18→19→20 sequential. 21 needs 19. 22 needs 21. 23 needs 22 pass. 24 needs 23.
- Phase B: 25→26→27→28→29→30→31; 32 after 26; 33 needs 31+32. Phase B can start any time after Task 1 (independent of Phase A beyond scaffolding) if parallel capacity exists.
- 34 needs 31. 35 needs 22 AND 33 green + user sign-off.

---

## Task 1: Scaffold the cargo workspace

**Depends on:** none
**Files:**
- Create: `services/geometry-rs/Cargo.toml` (workspace)
- Create: `services/geometry-rs/rust-toolchain.toml`
- Create: `services/geometry-rs/.gitignore` (`/target`)
- Create: `services/geometry-rs/crates/geometry-types/{Cargo.toml,src/lib.rs}`
- Create: `services/geometry-rs/crates/glb/{Cargo.toml,src/lib.rs}`
- Create: `services/geometry-rs/crates/planner/{Cargo.toml,src/lib.rs}`
- Create: `services/geometry-rs/crates/server/{Cargo.toml,src/main.rs}`

**Steps:**
1. Verify toolchain: `rustc --version`. If rustc is missing or < 1.80, STOP and report — do not install toolchains silently.
2. Workspace `Cargo.toml`: `[workspace]` with `members = ["crates/*"]`, `resolver = "2"`. Central `[workspace.dependencies]`: `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`, `thiserror = "2"`, `parry3d-f64 = "0.29"` (f64 — the Python planner is float64 throughout; f32 would shift every tolerance), `rstar = "0.13"`, `meshopt = "0.6"`, `sha1 = "0.10"`, `hex = "0.4"`, `rayon = "1"`, `tokio = { version = "1", features = ["full"] }`, `axum = "0.8"`, `reqwest = { version = "0.12", features = ["stream"] }`, `anyhow = "1"`, `dashmap = "6"`, `tracing = "0.1"`, `tracing-subscriber = "0.3"`. If a pinned version doesn't resolve, use the nearest compatible latest and note it in the commit message.
3. Workspace lints in root `Cargo.toml`:
   ```toml
   [workspace.lints.clippy]
   unwrap_used = "deny"
   expect_used = "deny"
   [workspace.lints.rust]
   missing_docs = "allow"
   ```
   Each crate adds `[lints] workspace = true`. In test modules, use `#[allow(clippy::unwrap_used, clippy::expect_used)]` at the module top.
4. `rust-toolchain.toml`: `[toolchain] channel = "stable" components = ["rustfmt", "clippy"]`.
5. Each crate compiles empty (`lib.rs` with `//! doc line`; `server/src/main.rs` printing nothing, returning `Ok(())` from `fn main() -> anyhow::Result<()>`).

**Verify:**
```bash
cd services/geometry-rs && cargo build --locked 2>&1 | tail -2 && cargo clippy --all-targets --locked -- -D warnings 2>&1 | tail -2
# Expected: "Finished `dev` profile" twice, zero warnings/errors
```

**Out of scope:** occt-bridge and converter crates (Phase B, Task 25). No CI workflow yet (Task 34).

## Task 2: Wire types crate (`geometry-types`)

**Depends on:** Task 1
**Files:**
- Create: `services/geometry-rs/crates/geometry-types/src/{graph.rs,plan.rs,wire.rs,lib.rs}`
- Copy from (precedent): `packages/viewer/src/types.ts` (graph + motion types), `packages/viewer/src/plan.ts` (plan v3), `services/geometry/app/schemas.py` (wire request/response)

**Steps:**
1. `graph.rs`: `AssemblyGraph { version: u32 /* =1 */, unit: String /* "mm" */, source_unit: String, component_count: u32, root: AssemblyGraphNode }`; `AssemblyGraphNode { node_id, name, is_assembly, geometry_hash: Option<String>, transform: [f64; 16] /* col-major */, bbox: Bbox { min: [f64;3], max: [f64;3] }, volume: Option<f64>, color: Option<[f32;4]>, children: Vec<AssemblyGraphNode> }`. All types `#[derive(Debug, Clone, Serialize, Deserialize)]` + `#[serde(rename_all = "camelCase")]`.
2. `plan.rs`: mirror `packages/viewer/src/plan.ts` exactly — `AssemblyPlan` (version 3, unit "mm", `sequence: Vec<String>`, `components: BTreeMap<String, PlannedComponent>` — **BTreeMap, not HashMap**, for deterministic JSON key order), `Motion` as a `#[serde(tag = "type")]` enum with variants `linear`, `l` (serde rename `"L"`), `helix`, `path`, `none`, plus `groups`, `warnings`, per-component `confidence/tier/verified/groupId/mergedInto`. Read the TS file field-by-field; every field present there must exist here.
3. `wire.rs`: `PlanRequest` (NEW shape — this is the contract change): `{ jobId: String, source: PlanSource { glbUrl: String, graphUrl: String }, options: PlanOptions }`. `PlanOptions` ports `services/geometry/app/schemas.py` `PlanOptions` verbatim: `linearDeflection=0.1, angularDeflection=0.5, clearance=0.5, pathSamples=60, units: Option<Vec<PlanUnit>>, sequence: Option<Vec<Vec<String>>>` with defaults via `#[serde(default = "...")]`; `PlanUnit { id, name: Option<String>, nodeIds }`. Also `PlanStartResponse`, `PlanStatusResponse`, `PlanStats { planMs, tiers: BTreeMap<String, u32>, warnings, verifiedCount }`, `HealthResponse` — mirror schemas.py field-for-field, camelCase on the wire.
4. Reject empty `sequence` groups on deserialize (custom `Deserialize` or a `validate()` method returning `Result<(), TypesError>`), matching the Pydantic `field_validator`.
5. Tests: round-trip a hand-written graph.json sample and a plan.json v3 sample (embed as `include_str!` string literals — take real output shapes from `packages/viewer/src/plan.ts` doc comments and `services/geometry/tests/test_convert.py` expectations); assert unknown fields are ignored (serde default behavior) and camelCase renames hold (`assert!(json.contains("\"nodeId\""))`).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p geometry-types 2>&1 | tail -3
# Expected: "test result: ok." with 0 failed
```

**Out of scope:** ConvertRequest/Response wire types (Phase B, Task 28 adds them to this crate).

## Task 3: Fixture generation script (Python-side)

**Depends on:** Task 1
**Files:**
- Create: `services/geometry-rs/scripts/make_fixtures.py`
- Copy from (precedent): `services/geometry/tests/fixtures/make_fixtures.py` (STEP generation), `services/geometry/app/convert.py` (`convert_step`), `services/geometry/app/optimize.py` (`compress_glb`)

**Steps:**
1. Script runs with the Python service's venv: it imports `app.convert.convert_step` and `app.optimize.compress_glb` via `sys.path.insert(0, "../geometry")` (adjust to actual relative path from the script's location).
2. It generates the three STEP fixtures the Python tests use (`box.step`, `plates.step`, `nested.step` — reuse the functions in `services/geometry/tests/fixtures/make_fixtures.py`) into `services/geometry-rs/fixtures/`, then runs `convert_step` on each producing `<name>.glb` + `<name>.graph.json`, then `compress_glb` producing `<name>.meshopt.glb`. Keep BOTH compressed and uncompressed GLBs — Task 5 needs the pair.
3. Add `services/geometry-rs/fixtures/` to `services/geometry-rs/.gitignore` (generated, never committed — repo rule: no binary files).
4. Rust tests that need fixtures must `skip` cleanly when `fixtures/` is absent (check path, print `"fixtures missing — run scripts/make_fixtures.py"`, return early). Document this at the top of the script.

**Verify:**
```bash
cd services/geometry && source .venv/bin/activate && cd ../geometry-rs && python scripts/make_fixtures.py && ls fixtures/
# Expected: box.step plates.step nested.step + .glb, .graph.json, .meshopt.glb for each (12 files total minimum)
# If services/geometry/.venv does not exist, STOP and report — do not pip install into the system.
```

**Out of scope:** Rust-native fixture generation (Task 32). Committing any fixture binary.

## Task 4: GLB reader with meshopt decode (`glb` crate, read half)

**Depends on:** Tasks 2, 3
**Files:**
- Create: `services/geometry-rs/crates/glb/src/{read.rs,meshopt_decode.rs,error.rs}`
- Modify: `services/geometry-rs/crates/glb/src/lib.rs` — export `read_assembly_glb`

**Steps:**
1. Parse GLB container manually (12-byte header, JSON chunk, BIN chunk — the format is trivial; do NOT pull the full `gltf` crate import machinery, parse the JSON chunk with `serde_json::Value` plus small typed structs for the parts we need: nodes/meshes/accessors/bufferViews/extensions). Rationale: we need `extras.nodeId` (typed gltf crates drop or complicate extras) and `EXT_meshopt_compression` bufferViews (unsupported by gltf-rs).
2. `meshopt_decode.rs`: decode `EXT_meshopt_compression` bufferViews using the `meshopt` crate decoders (`decode_vertex_buffer`, `decode_index_buffer`, plus filter decoders for OCTAHEDRAL/QUATERNION/EXPONENTIAL). If the `meshopt` crate does not expose a needed decode function, call the corresponding `meshopt-sys` FFI function directly behind a safe wrapper — check `meshopt-sys` docs first; if neither exposes it, STOP and report.
3. Public API: `read_assembly_glb(bytes: &[u8]) -> Result<GlbAssembly, GlbError>` where `GlbAssembly { parts: Vec<GlbPart> }`, `GlbPart { node_id: String, vertices: Vec<[f64; 3]> /* world-space */, indices: Vec<[u32; 3]> }`. Compute world transforms by walking the scene node tree (node.matrix or TRS), multiply into vertices. Note: the converter bakes vertices in world space with identity node transforms — but do NOT rely on that; apply transforms anyway (correct in both cases).
4. **Join validation (mandatory, from lessons):** `validate_against_graph(assembly: &GlbAssembly, graph: &AssemblyGraph) -> Result<(), GlbError>` — every graph leaf (non-assembly node) has a GLB part with matching `node_id`; each part's computed AABB matches the graph node's world bbox within 1.0 mm max component error; error lists every mismatched nodeId. Callers must run this before planning.
5. Tests (fixture-gated per Task 3): read `plates.meshopt.glb` + `plates.graph.json` → validation passes, part count matches `componentCount`, 4 plate screws share... (don't assert mesh sharing here — after decode each part has its own vertex copy; assert counts and bbox validation only). Same for uncompressed `plates.glb` (reader must handle both).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p glb 2>&1 | tail -3
# Expected: "test result: ok." 0 failed (tests skip with a message if fixtures/ absent — run Task 3 first)
```

**Out of scope:** GLB writing (Task 29), meshopt encoding (Task 30).

## Task 5: SPIKE — quantization error vs penetration tolerance (GO/NO-GO)

**Depends on:** Task 4
**Files:**
- Create: `services/geometry-rs/crates/glb/tests/quantization_spike.rs`
- Create: `services/geometry-rs/SPIKE-QUANTIZATION.md` (findings)

**Steps:**
1. For each fixture pair (`<name>.glb` vs `<name>.meshopt.glb`): decode both, match parts by nodeId, compute per-vertex position error (max + p99 across all parts).
2. Threshold: the planner's collision truth uses `PENETRATION_TOLERANCE_MM = 0.15` (scaled up to `2.5 × linearDeflection`). Quantization error must be **≤ 0.05 mm max** (one order below the scaled floor is not achievable; a third of the base tolerance is the bar).
3. Write measured numbers into `SPIKE-QUANTIZATION.md` with the verdict.
4. **If error > 0.05 mm:** STOP and report with the numbers. The fallback (Python `/convert` also uploads an uncompressed `model.raw.glb` for the planner) is a contract change that needs user sign-off — do not implement it unilaterally.
5. If available, also run one real customer GLB (ask the user; the "seat rail" and "SA Mando harness" models are the known references) — record in the same doc.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p glb --test quantization_spike -- --nocapture 2>&1 | tail -5
# Expected: printed max/p99 error per fixture, all max ≤ 0.05, "test result: ok."
```

**Out of scope:** Any change to the Python service.

## Task 6: Planner scaffolding — constants, `Component`, world-part collection

**Depends on:** Task 5 (GO)
**Files:**
- Create: `services/geometry-rs/crates/planner/src/{constants.rs,component.rs,collect.rs,error.rs}`
- Copy from (precedent): `services/geometry/app/plan.py` lines 61–173 (constants), `_collect_world_parts` (line 2195), `_part_volume` (line 1110)

**Steps:**
1. `constants.rs`: transcribe EVERY module-level constant from `services/geometry/app/plan.py` lines 61–173 with identical names (Rust SCREAMING_SNAKE, same values): `PLAN_VERSION=3`, `PENETRATION_TOLERANCE_MM=0.15`, `EXIT_MARGIN_MM=5.0`, `MAX_SAMPLE_SPACING_MM=2.0`, `MAX_PATH_SAMPLES=400`, `MATE_MIN_DEPTH_MM=0.2`, `MATE_DEPTH_MARGIN_MM=0.3`, `ORDERING_CONTACT_MM=0.5`, `MAX_ADJACENCY_DISTANCE_PAIRS=20000`, `SANDWICH_*` (4), `MAX_FASTENER_DIAGONAL_FRACTION=0.35`, `MAX_FASTENER_EXTENT_MM=100.0`, `MAX_ESCAPE_SEGMENTS=3`, `MAX_ESCAPE_EXPANSIONS=24`, `MIN_HOP_FRACTION=0.25`, `MAX_GROUP_SIZE=4`, `MAX_GROUP_TESTS=40`, `GROUP_PROXIMITY_MM=2.0`, `WORLD_AXES`, the `FASTENER_NAME_RE` regex (port to the `regex` crate — add `regex = "1"` to workspace deps; copy the pattern character-for-character from plan.py line 138, including the deliberate absence of a bare `pin` token), and `_mesh_tolerance(linear_deflection)` (line 73). Read the actual file — do not trust this list to be exhaustive.
2. `component.rs`: `Component` port of `_Component` (find the dataclass/class definition in plan.py; fields include node_id, name, mesh (parry `TriMesh`), world bbox, volume, plus the caches the Python code hangs on the mesh — `bvh`/volume become owned struct fields instead of monkey-patched attributes).
3. `collect.rs`: `collect_world_parts(glb: &GlbAssembly, graph: &AssemblyGraph) -> Result<Vec<Component>, PlannerError>` — port `_collect_world_parts` semantics: leaves only, world-space `TriMesh` from GLB parts (join by nodeId — GLB is the mesh source in Rust; Python re-tessellated from STEP), volume via `_part_volume` port: watertight → mesh volume; non-watertight → split into watertight components and sum, else bbox-volume fallback. parry3d `TriMesh` has orientation/topology flags; if watertightness cannot be determined from parry, implement a closed-mesh check (every edge shared by exactly 2 triangles) in this crate — small and deterministic.
4. Unit tests with hand-built meshes (a unit cube TriMesh helper in `#[cfg(test)]` — this helper gets reused by every later task; give it `subdivided(size)` support now, mirroring the `subdivide_to_size(5.0)` lesson for sliding-contact tests).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** Any collision logic (Task 8).

## Task 7: Parity tracker

**Depends on:** Task 6
**Files:**
- Create: `services/geometry-rs/PARITY.md`

**Steps:**
1. Run `grep -n "^def test_" services/geometry/tests/test_plan.py` (and the class-based variants if any: `grep -n "def test_" services/geometry/tests/test_plan.py`). List EVERY test name in `PARITY.md` as a checkbox table: `| Python test | Rust test | Task | Status |`, status one of `pending / ported / n-a (reason)`.
2. Assign each test to one of Tasks 9–19 by subject (read each test's body to classify: seated/adjacency → 9, fastener classification → 10, merge/embedded → 11, joints → 12, sandwich → 13, removal tiers → 14/15, greedy/base → 16, precedence/topo/verify → 17, fixed-sequence/units → 18, end-to-end/determinism → 19/20).
3. Rule for all subsequent tasks: a task is NOT done until its assigned PARITY.md rows are `ported` and green. `n-a` requires a written reason (e.g. tests Python-internal monkey-patching).

**Verify:**
```bash
grep -c "^def test_" services/geometry/tests/test_plan.py && grep -c "| test_" services/geometry-rs/PARITY.md
# Expected: two equal numbers (every Python test has a row)
```

**Out of scope:** porting any test yet.

## Task 8: Collision layer — broadphase manager + calibration suite

**Depends on:** Task 6
**Files:**
- Create: `services/geometry-rs/crates/planner/src/collision.rs`
- Create: `services/geometry-rs/crates/planner/tests/calibration.rs`
- Copy from (precedent): `services/geometry/app/plan.py` — `_mesh_bvh` (3121), `_unregistered` (3138), `_contacts_at` (3168), `_seated_pair_depths` (2226), `_blocking_depth` (3835)

**Steps:**
1. Design a `CollisionWorld` owning: per-part parry3d `TriMesh` (its internal QBVH is the BVH-built-once), an `rstar::RTree` of part AABBs as the broadphase (replaces fcl's DynamicAABBTreeCollisionManager), and a registered/unregistered flag set (`HashSet<usize>`) so unregister/re-register is O(1) bookkeeping, never a rebuild — this implements the two lessons (self-exempt sweep, blocker-unregister-mid-sweep) structurally.
2. `Contact { part_a: usize, part_b: usize, point: [f64;3], normal: [f64;3], depth: f64 }`. Narrowphase via parry3d mesh-mesh contact manifolds at a transformed pose (`parry3d::query::contact` / `contact_manifolds` on TriMesh pairs). **Semantic risk lives here:** FCL reports per-triangle-pair local penetration; parry manifolds aggregate differently. The calibration suite defines the required semantics; adapt the extraction (e.g. per-manifold-point depth) until calibration passes.
3. Calibration tests (all with the Task 6 cube helper, subdivided where sliding contact is sustained — lesson from `.ai/lessons.md` "Synthetic box meshes fake huge penetration"):
   - two 10 mm cubes overlapping 0.05 mm face-on → max depth ∈ [0.04, 0.06] (below tolerance ⇒ "seated, not colliding")
   - overlapping 1.0 mm → depth ∈ [0.9, 1.1]
   - disjoint by 0.1 mm → no contacts
   - 5 mm cylinder (tessellated ~32 segments, helper) inside 5.05 mm bore → radial depths all < PENETRATION_TOLERANCE_MM
   - subdivided slider seated 0.05 mm into a channel floor, sampled while translating tangentially → depth stays < 0.15 at every sample (the FCL artifact this guards against reported 29.8 mm)
   - exact distance between two cubes 0.3 mm apart → ∈ [0.29, 0.31] (parry `distance`)
   - point-containment: centroid of a cube → inside; point 0.1 mm outside a face → outside (parry point projection; this replaces `mesh.contains` ray-casts)
4. If any calibration bound cannot be met by any parry contact-extraction strategy, STOP and report with the failing case and measured values — this invalidates the parry choice and the user must decide (options: different query strategy, or wrapping the C++ FCL — do not choose unilaterally).
5. `seated_pair_depths(world) -> PairData` port (plan.py 2226): one broadphase pass over all registered pairs; per pair: max depth, contact points capped at 64, **uncapped** normal structure tensor `Σ n·nᵀ`, contact AABB.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner --test calibration 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** path sampling / sweeps (Task 14 builds on `contacts_at`).

## Task 9: Seated pair depths + ordering adjacency

**Depends on:** Task 8
**Files:**
- Create: `services/geometry-rs/crates/planner/src/adjacency.rs`
- Modify: `services/geometry-rs/crates/planner/src/lib.rs` — exports
- Copy from (precedent): `services/geometry/app/plan.py` `_ordering_adjacency` (1632), `_rollup_adjacency` (1702), `_separation_distance` (grep for it)

**Steps:**
1. Port `_ordering_adjacency`: inflated-AABB prefilter → exact parry distance for pairs within `ORDERING_CONTACT_MM = 0.5`; budget cap `MAX_ADJACENCY_DISTANCE_PAIRS = 20000`, past budget degrade to bbox-only adjacency exactly as Python does (read the degradation branch carefully).
2. Port `_rollup_adjacency` (post-merge unit adjacency) and the analytic per-axis `_separation_distance`.
3. Port PARITY.md rows assigned to Task 9. Python tests that build synthetic `_Component`s translate to the Task 6 helper; keep the Python test names as Rust test names (snake-case as-is).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner adjacency 2>&1 | tail -3
# Expected: "test result: ok." 0 failed; PARITY.md Task-9 rows flipped to ported
```

**Out of scope:** precedence edges (Task 17).

## Task 10: Fastener classification

**Depends on:** Task 9
**Files:**
- Create: `services/geometry-rs/crates/planner/src/fasteners.rs`
- Copy from (precedent): `services/geometry/app/plan.py` `_classify_fasteners` (2287), `_is_fastener` (170), `_shank_radius` (2364), `_symmetry_axis_kind` (2721), `_symmetry_axis` (2758), `_axis_from_contacts` (2543), `_bbox_axis_kind` (2584), `_normal_clusters` (2763), `_head_direction` (3217)

**Steps:**
1. Port the full cascade: name regex (+ the structural-size sanity cap `max(MAX_FASTENER_EXTENT_MM, MAX_FASTENER_DIAGONAL_FRACTION × assembly diagonal)` — lesson: "Electronics Box - 36 Pin") → SVD symmetry axis (rod vs disc from singular-value ratios; use `parry3d::na::SVD` on the centered vertex matrix) → bbox-extent kind → contact-ring PCA → dominant contact-normal cluster. Read each Python function fully before porting; the singular-value ratio thresholds are load-bearing.
2. `_shank_radius`: mate-contact radial mean, falling back to vertex-radial 25th percentile (implement percentile by sorting — no numpy; nearest-rank method, verify against numpy's default `linear` interpolation on a test vector and match Python's result for the test inputs).
3. Port PARITY.md Task-10 rows.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner fasteners 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** joint detection (Task 12), removal ordering (Task 16).

## Task 11: Rigid merge + embedded pairs

**Depends on:** Task 9
**Files:**
- Create: `services/geometry-rs/crates/planner/src/merge.rs`
- Copy from (precedent): `services/geometry/app/plan.py` `_embedded_pairs` (2605), `_merge_rigid_groups` (2637), `_merge_units` (479), `_eject_fastened_unit_members` (412)

**Steps:**
1. `_embedded_pairs`: bbox containment prefilter → point-containment on ≤ 24 sampled inner vertices, > 80 % inside ⇒ embedded (uses Task 8 containment).
2. `_merge_rigid_groups`: union-find (implement inline — 20 lines; no crate) over deep-interpenetration pairs + embedded pairs; merged cluster becomes one concatenated `TriMesh` (rebuild QBVH once for the merged mesh).
3. `_merge_units` / `_eject_fastened_unit_members`: caller-specified `PlanUnit` pre-grouping + the fastener-ejection rule (fasteners named in a unit get ejected back out — read the Python for the exact condition).
4. Port PARITY.md Task-11 rows (embedded-logo test et al.).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner merge 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** group removal (Task 15).

## Task 12: Fastener ring joints

**Depends on:** Tasks 10, 11
**Files:**
- Create: `services/geometry-rs/crates/planner/src/joints.rs`
- Copy from (precedent): `services/geometry/app/plan.py` `_fastener_joints` (2391), `_axis_span` (2523), `_mate_exempt` (3259), `_seated_exempt` (3278), `_self_exempt` (3201)

**Steps:**
1. Ring-containment probe: 8 points on circle of `shankRadius × 1.2` (+ clearance radius) at 3 heights along the axis; candidate surrounding ≥ 6/8 ⇒ through-part. Point-containment from Task 8.
2. Exemption model: port `_mate_exempt` / `_seated_exempt` / `_self_exempt` as a single `Exemptions` struct consulted by `contacts_at` filtering. **Lesson constraint:** every exemption is pair-scoped and axis-gated with a depth cap (seated interference + `MATE_DEPTH_MARGIN_MM`); no global allowances. If the Python code has a branch that looks like a blanket allowance, port it exactly anyway (parity first) but flag it in PARITY.md notes.
3. Port PARITY.md Task-12 rows (unscrew-through-mate, washer-before-bolt, snug counterbore, stud-clamping, never-tunnel-thin-cover…).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner joints 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** sweep mechanics (Task 14).

## Task 13: Sandwich detection

**Depends on:** Task 9
**Files:**
- Create: `services/geometry-rs/crates/planner/src/sandwich.rs`
- Copy from (precedent): `services/geometry/app/plan.py` `_sandwiched_parts` (1382)

**Steps:**
1. Port `_sandwiched_parts`: symmetric eigendecomposition (`parry3d::na::SymmetricEigen`) of the pair structure tensor; thickness caps BOTH ratio (`SANDWICH_MAX_THICKNESS_RATIO=0.3`) AND absolute (`SANDWICH_MAX_THICKNESS_MM=6.0`); axis alignment ≥ 0.9; squish cap `SANDWICH_MAX_SQUISH_MM=0.6`. These dual caps exist because ratio-only classification produced a 33 mm "gasket" (lesson: "Ordering heuristics must be gated on a large noisy model") — do not weaken them.
2. Port PARITY.md Task-13 rows (gasket ordering, axis-gating, thickness/depth negatives).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner sandwich 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** the soft ordering edges it feeds (Task 17).

## Task 14: Removal planning — tier 1 linear + tier 2 "L"

**Depends on:** Tasks 8, 12
**Files:**
- Create: `services/geometry-rs/crates/planner/src/sweep.rs`
- Create: `services/geometry-rs/crates/planner/src/removal.rs`
- Copy from (precedent): `services/geometry/app/plan.py` `_contacts_at` (3168), `_path_is_clear` / `_path_blockers` (1178), `_plan_removal` (3301), `_candidate_directions` (2789), `_free_travel` (3856), `_recorded_travel` (3890), `_removal_segments` (1162)

**Steps:**
1. `sweep.rs`: `contacts_at(world, part, pose, exemptions)` (narrowphase at a sampled pose, exemption-filtered), `path_is_clear` (dense sampling: spacing ≤ `MAX_SAMPLE_SPACING_MM=2.0`, ≤ `MAX_PATH_SAMPLES=400`, bounded by AABB `separation_distance` + `EXIT_MARGIN_MM`), `path_blockers` with the **blocker-unregister optimization**: once a partner exceeds tolerance it is recorded and unregistered for the remainder of that sweep, re-registered before return (lesson: this was the 8× win; the mechanism is the Task 8 flag set).
2. `removal.rs`: `plan_removal` tier 1 (candidate directions: symmetry axis ± , contact-normal clusters, world axes — port `_candidate_directions` ordering exactly; the `entanglement` sort closure at 3370 decides candidate order and hence output determinism) and tier 2 "L" (lift-then-slide two-segment motions). Motion output = ordered `(direction, travel)` segments; the recorded plan motion is the reversed removal (port `_removal_segments_to_planned`, 3803).
3. Port PARITY.md Task-14 rows (top-down stack, pin-in-bore, rod-axis-preference…). Sliding-contact synthetic tests use the subdivided helper.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner removal 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** escape BFS + groups (Task 15), the greedy loop (Task 16).

## Task 15: Tier 3 escape BFS + group removal

**Depends on:** Task 14
**Files:**
- Create: `services/geometry-rs/crates/planner/src/escape.rs`
- Modify: `services/geometry-rs/crates/planner/src/removal.rs` — tier 3 + group hooks
- Copy from (precedent): `services/geometry/app/plan.py` `_plan_escape` (3477), `_plan_group_removal` (3621), `_group_exempt` (3584)

**Steps:**
1. `_plan_escape`: axis-aligned hop BFS, ≤ `MAX_ESCAPE_SEGMENTS=3` segments, ≤ `MAX_ESCAPE_EXPANSIONS=24` expansions, hop length ≥ `MIN_HOP_FRACTION` of part extent. Deterministic expansion order (BTreeMap/sorted frontier — no HashMap iteration order anywhere in planner logic; enforce with a grep in the Verify step).
2. `_plan_group_removal`: proximity-graph subassembly groups ≤ `MAX_GROUP_SIZE=4`, ≤ `MAX_GROUP_TESTS=40`, proximity `GROUP_PROXIMITY_MM=2.0`; group treated as one rigid body for the sweep.
3. **No tier 4.** If the Python file still contains any forced-removal remnant, do not port it; unsolvable ⇒ flagged (`motion: none`, `blockedBy`, warning) per lesson "Never fabricate a best-effort motion".
4. Port PARITY.md Task-15 rows (blind-pocket multi-segment escape, group extraction, captive-part flag-or-merge).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner escape 2>&1 | tail -3 && ! grep -rn "HashMap" services/geometry-rs/crates/planner/src/{escape,removal,sweep}.rs
# Expected: tests ok; grep exits non-zero (no HashMap in planning-order code paths)
```

**Out of scope:** ordering of removal attempts (Task 16).

## Task 16: Greedy disassembly loop + base re-selection

**Depends on:** Tasks 10, 11, 13, 15
**Files:**
- Create: `services/geometry-rs/crates/planner/src/greedy.rs`
- Copy from (precedent): `services/geometry/app/plan.py` `_greedy_disassembly` (2815), `removal_priority` (2868), `_reselect_base` (1735), `_structural_key` (1138), `_assembly_centroid` (1156)

**Steps:**
1. Port `_greedy_disassembly` (~300 LOC): the removal_priority ordering (read the closure carefully — priority ranking schedules expensive attempts AND picks flag/merge victims; a mis-ported comparator silently wrecks quality per the "preferences don't belong in removal_priority" lesson), per-part `plan_removal` attempts, merge-on-failure and flag-on-failure paths.
2. Port `_reselect_base` scoring (`mate-degree × volume`, exact tuple ordering from the `score` closure at 1763).
3. All orderings sort with explicit stable keys ending in `node_id` as the final tiebreak (determinism).
4. Port PARITY.md Task-16 rows.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner greedy 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** final sequence ordering (Task 17).

## Task 17: Precedence DAG, preference topo sort, forward verification

**Depends on:** Task 16
**Files:**
- Create: `services/geometry-rs/crates/planner/src/ordering.rs`
- Copy from (precedent): `services/geometry/app/plan.py` `_derive_precedence` (1248), `_add_joint_edges` (1290), `_add_sandwich_edges` (1483), `_add_support_edges` (1561), `_preference_topo_sort` (1861), `_connectivity_repair` (1816), `_verify_sequence` (2129), `_motion_travel` (1371)

**Steps:**
1. Port hard precedence edges (`_derive_precedence`, `_add_joint_edges` with its `reaches` cycle guard) and soft preference edges (`_add_sandwich_edges`, `_add_support_edges` — soft edges are preferences consulted only inside the topo sort's tie-break, never hard constraints).
2. Port `_preference_topo_sort` (~270 LOC: connected-growth constraint, `is_securing`/`is_weakly_secured` predicates, the `sort_key` closure at 2075 verbatim) + `_connectivity_repair`.
3. Port `_verify_sequence`: replay each insertion against parts present at that step; failure demotes to flagged, sets `verified: false`.
4. Port PARITY.md Task-17 rows (topo connectivity, washer/bolt/nut ordering end-cases that live at this layer).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner ordering 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** wire output (Task 19).

## Task 18: Fixed-sequence mode + units

**Depends on:** Task 17
**Files:**
- Create: `services/geometry-rs/crates/planner/src/fixed.rs`
- Copy from (precedent): `services/geometry/app/plan.py` `_plan_fixed_sequence` (844)

**Steps:**
1. Port `_plan_fixed_sequence`: caller-supplied ordered groups, each installed as one rigid body against previously-installed groups only; no reordering; forward-collision insertion motion per group. Validation of group membership against graph leaves (unknown nodeId ⇒ error listing the ids, matching the Python behavior — read what it does with unknowns and mirror exactly).
2. Port PARITY.md Task-18 rows (the entire fixed-sequence and unit merge/eject test set).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner fixed 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** re-motion callers in `packages/jobs` (no TS change in this task).

## Task 19: `plan_step` orchestration + plan.json v3 output parity

**Depends on:** Tasks 17, 18
**Files:**
- Create: `services/geometry-rs/crates/planner/src/plan.rs` (public `plan_assembly(glb, graph, options) -> Result<PlanOutcome, PlannerError>`)
- Copy from (precedent): `services/geometry/app/plan.py` `plan_step` (270), `_plan_parts` (537), `_tally_tiers` (1080), `_part_to_dict` (2179)

**Steps:**
1. Wire the pipeline in `_plan_parts` order: collect → seated depths → adjacency → fasteners → merge → joints → sandwich → greedy → base re-selection → precedence/topo → verify → output. `PlanOutcome { plan: AssemblyPlan, component_count, planned_count, stats: PlanStats }`.
2. Output must serialize to the exact plan.json v3 shape (`geometry-types::plan`); tiers tally keys match Python's `_tally_tiers` strings.
3. End-to-end fixture test: run `plan_assembly` on `plates.meshopt.glb` + graph; assert the 4 screws are planned before/after per current Python behavior — generate the Python reference by running the Python planner on the same fixture from `services/geometry-rs/scripts/make_fixtures.py` (extend the script to also emit `<name>.plan.json` via `app.plan.plan_step`); compare `sequence`, per-component `tier` and `motion.type` (NOT float travel values — epsilon-free fields only).
4. Port remaining PARITY.md end-to-end rows. All PARITY.md rows must now be `ported` or `n-a` with reasons.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner 2>&1 | tail -3 && ! grep -n "pending" services/geometry-rs/PARITY.md
# Expected: tests ok; grep exits non-zero (no pending rows left)
```

**Out of scope:** HTTP layer (Task 21), parallelism (Task 20).

## Task 20: Determinism test, then rayon parallelization

**Depends on:** Task 19
**Files:**
- Modify: `services/geometry-rs/crates/planner/src/{sweep.rs,greedy.rs,plan.rs}` — rayon
- Create: `services/geometry-rs/crates/planner/tests/determinism.rs`

**Steps:**
1. FIRST commit the determinism test single-threaded: run `plan_assembly` twice on `plates` fixture, assert byte-identical `serde_json::to_vec` of the plan (port `test_plan_is_deterministic`).
2. THEN parallelize with rayon, preserving determinism: parallel over candidate directions within `plan_removal` (collect all results, pick by the same `entanglement` comparator — an ordered reduction, not first-wins), parallel over pairs in `seated_pair_depths` and `_embedded_pairs` (collect then sort by pair key). Do NOT parallelize across greedy iterations (order-dependent).
3. `CollisionWorld` must be `Sync` for read-only narrowphase; the unregister flag-set becomes a per-sweep local exclusion list passed by value into parallel closures instead of shared mutation.
4. Determinism test re-run 5× under `--release`; add a timing print (`--nocapture`) for the fixture plan to document the speedup in the task commit message.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p planner --release --test determinism -- --nocapture 2>&1 | tail -4
# Expected: "test result: ok.", identical-bytes assertion passing, printed timing
```

**Out of scope:** micro-optimizations beyond rayon (profile first — lesson: "Profile the planner before optimizing").

## Task 21: Server binary — axum `/health`, `/plan`, `/plan/{jobId}`

**Depends on:** Task 19
**Files:**
- Create: `services/geometry-rs/crates/server/src/{main.rs,auth.rs,config.rs,jobs.rs,routes.rs,fetch.rs}`
- Copy from (precedent): `services/geometry/app/main.py` (routes, semaphore, job dict), `app/auth.py` (auth semantics), `app/config.py` (env vars)

**Steps:**
1. `config.rs`: same env vars, same defaults — `GEOMETRY_SERVICE_API_KEY`, `GEOMETRY_DEV_MODE` (only consulted when the key is unset: `"true"` ⇒ allow unauthenticated, anything else ⇒ 401; also disables https-required and TLS-verify), `GEOMETRY_MAX_CONCURRENCY` (default 2), `GEOMETRY_MAX_SOURCE_MB` (250), `GEOMETRY_ALLOWED_URL_HOSTS` (comma list), `PORT` (default 8000).
2. `auth.rs`: `Authorization: Bearer <key>` check as an axum middleware/extractor; constant-time comparison (`subtle` crate or length-then-`ct_eq`).
3. `fetch.rs`: reqwest streaming GET with size cap enforced on both Content-Length and streamed bytes; URL validation (https unless dev mode; host allowlist); `danger_accept_invalid_certs(true)` only when dev mode (mirrors `verify_tls`).
4. `jobs.rs`: `DashMap<String, PlanJob>` keyed by jobId, states `pending|running|done|error`, 1 h TTL sweep (spawned tokio interval task). Semaphore: `tokio::sync::Semaphore` with `try_acquire` ⇒ 429 `{"error":"BUSY"}` when full. Planner runs in `tokio::task::spawn_blocking` (CPU-bound; rayon inside).
5. `routes.rs`: `GET /health` → `{"ok":true,"version":<CARGO_PKG_VERSION>}` unauthenticated; `POST /plan` → validate `PlanRequest` (new glbUrl/graphUrl shape), 202 + `PlanStartResponse`; `GET /plan/{jobId}` → `PlanStatusResponse` with inline `plan` on done (NEVER an upload URL — lesson: 60 s signed-upload expiry). Unknown jobId ⇒ 404 (callers treat as service-restarted and re-submit).
6. Endpoint tests with a local hyper/axum stub server serving fixture GLB/graph bytes (port the `StorageStub` idea from `services/geometry/tests/conftest.py`): submit → poll → done with a valid plan; auth matrix (5 cases from `services/geometry/tests/test_api.py`); 429 when slots exhausted; https/allowlist/size-cap rejections (from `test_limits.py`).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p server 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** `/convert` (Task 31). Redis job store (explicitly deferred; DashMap matches Python semantics).

## Task 22: Shadow-comparison harness + large-noisy-model gate

**Depends on:** Task 21
**Files:**
- Create: `services/geometry-rs/scripts/shadow_compare.py`
- Create: `services/geometry-rs/SHADOW-RESULTS.md`

**Steps:**
1. Script inputs: a directory of `{model.glb, graph.json}` pairs (downloaded from real company storage by the user, or the fixture set). For each: run Python `plan_step` (via `services/geometry/.venv`, importing `app.plan`) and the Rust planner (`cargo run --release -p server` is not needed — add a tiny `cargo run --release -p planner --example plan_file <glb> <graph>` example binary that prints the plan JSON) and diff: sequence order, per-component tier, motion type, flagged set, warning count. Report per-model PASS/DIVERGENCE with the diff.
2. Timing both sides per model into `SHADOW-RESULTS.md` (this is the perf-claim evidence).
3. **Gate (lesson: seat rail is best-case):** the comparison set MUST include one large noisy model (the 118-part "SA Mando & Battery Harness" class or the "SA BCU"). Ask the user to provide the GLB/graph pair from a real environment; if unavailable, STOP and report — do not sign off shadow parity on fixtures alone.
4. Acceptance: identical sequences OR divergences individually reviewed and explained in SHADOW-RESULTS.md (e.g. equal-priority tie broken differently is acceptable ONLY if the Rust side is internally deterministic and the tie is provably equal-cost; anything else is a bug).

**Verify:**
```bash
cd services/geometry-rs && python scripts/shadow_compare.py fixtures/ && head -20 SHADOW-RESULTS.md
# Expected: PASS for every fixture model; SHADOW-RESULTS.md has a per-model table with timings
```

**Out of scope:** production traffic mirroring.

## Task 23: Jobs-side switch — `assembly-plan.ts` calls the Rust planner

**Depends on:** Task 22 (fixtures PASS at minimum)
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts` — payload + URL
- Modify: `packages/env/src/index.ts` — add `GEOMETRY_PLAN_SERVICE_URL` (optional)
- Copy from (precedent): `packages/jobs/src/inngest/functions/tasks/assembly-convert.ts` (signed URL minting with `createSignedUrl`)

**Steps:**
1. `packages/env/src/index.ts`: add optional `GEOMETRY_PLAN_SERVICE_URL` next to `GEOMETRY_SERVICE_URL` (same pattern; not secret). Empty ⇒ fall back to `GEOMETRY_SERVICE_URL` (transition switch; removed in Task 35).
2. `assembly-plan.ts`: before submit, read `modelUpload.glbPath` and `graphPath` for the row. **If either is missing** (convert never succeeded), fail the job with the existing failure path and message `"model not converted yet"` — do not fall back to the STEP payload. Mint signed GET URLs for both via `client.storage.from("private").createSignedUrl(path, SIGNED_URL_EXPIRY)` (same call pattern the file already uses for the STEP source — replace it). New payload: `{ jobId, source: { glbUrl, graphUrl }, options }` (options unchanged: units/sequence/deflections pass through). Re-submit path (404 recovery) re-mints both URLs — keep that behavior, it exists for expiry.
3. Poll loop, timeouts (`AbortSignal.timeout(60_000)`), re-submit cap, inline-plan persistence: **unchanged**.
4. Escape hatch: if `assembly-plan.ts` has drifted from the structure described here (grep for `createSignedUrl` and the poll loop first), STOP and re-read the whole file before editing.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs 2>&1 | tail -3
# Expected: "Tasks: 1 successful" (or the package's typecheck task exiting 0)
```

**Out of scope:** `assembly-convert.ts` (unchanged until Phase B cutover). Any ERP route.

## Task 24: Dev-stack wiring for the Rust planner

**Depends on:** Task 23
**Files:**
- Modify: `packages/dev/src/services/apps.ts` — spawn the Rust planner alongside uvicorn
- Modify: `packages/dev/src/env.ts` — write `GEOMETRY_PLAN_SERVICE_URL` into `.env.local`

**Steps:**
1. Read `packages/dev/src/services/apps.ts` lines ~240–282 (the existing geometry uvicorn spawn) — copy its pattern: spawn `services/geometry-rs/target/release/server` (or `cargo run --release -p server` if the binary is absent — prefer checking for the built binary and printing a skip message `"geometry-rs not built — cargo build --release"` when missing, mirroring the `.venv` skip message). Env: `PORT` = a new `PORT_GEOMETRY_RS` (default 54008 — check `packages/dev/src/env.test.ts` / wherever `PORT_GEOMETRY` 54007 is defined and register the new port the same way), `GEOMETRY_SERVICE_API_KEY: "dev-local-key"`, `GEOMETRY_DEV_MODE: "true"`.
2. `packages/dev/src/env.ts`: write `GEOMETRY_PLAN_SERVICE_URL=http://localhost:54008` (or the portless-domain form if that's what the sibling `GEOMETRY_SERVICE_URL` line does — mirror it exactly, lines ~101–103).
3. Escape hatch: if the dev package's service-spawning structure differs from this description, STOP, read the file, and follow its actual conventions.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/dev 2>&1 | tail -3
# Expected: typecheck exits 0. Manual smoke (user-run): pnpm dev, then trigger a re-plan in the ERP assembly editor and watch the Rust service logs.
```

**Out of scope:** production deployment (Task 34/35).

## Task 25: `occt-bridge` crate — build skeleton + exception guards

**Depends on:** Task 1 (parallel-safe with Phase A)
**Files:**
- Create: `services/geometry-rs/crates/occt-bridge/{Cargo.toml,build.rs,src/lib.rs,src/bridge/mod.rs,cpp/guard.hpp,cpp/guard.cpp}`

**Steps:**
1. `Cargo.toml`: `occt-sys = "0.6"` (build-dep + dep as its docs prescribe), `cxx = "1"`, build-dep `cxx-build = "1"`. If occt-sys 0.6 fails to build on this machine, try the git rev used by opencascade-rs `main` and record the pin; if that also fails, STOP with the build log tail.
2. `build.rs`: `cxx_build::bridge` over the bridge modules; add OCCT include path + static libs from `occt-sys` (follow `https://github.com/bschwind/opencascade-rs/blob/main/crates/opencascade-sys/build.rs` as the reference for which `TK*` libs to link — must include `TKXCAF TKLCAF TKCAF TKDESTEP TKXDESTEP` equivalents for the pinned OCCT version; the exact TK names for STEP+XCAF in OCCT 7.8 are `TKSTEP TKSTEPAttr TKSTEPBase TKSTEP209 TKXDESTEP TKXCAF TKLCAF TKCDF TKVCAF` plus core `TKernel TKMath TKBRep TKGeomBase TKGeomAlgo TKG2d TKG3d TKTopAlgo TKShHealing TKMesh TKPrim` — verify against the occt-sys lib dir listing at build time and adjust).
3. `cpp/guard.hpp`: every bridged OCCT call goes through a `GUARDED(expr)` macro wrapping `OCC_CATCH_SIGNALS` + `try { ... } catch (Standard_Failure const& e) { return err(e.GetMessageString()); } catch (...) { return err("unknown OCCT failure"); }` returning a `Result`-shaped struct cxx can pass (`struct OcctResult { bool ok; rust::String error; }` pattern). NO OCCT exception may cross the FFI boundary (opencascade-rs issue #172: aborts).
4. Smoke bridge: one function `occt_version() -> String` returning `OCC_VERSION_COMPLETE`, tested from Rust.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p occt-bridge 2>&1 | tail -3
# Expected: "test result: ok." (first build takes ~20-25 min — occt-sys compiles OCCT; do not kill it)
```

**Out of scope:** any real OCCT class (Tasks 26–27).

## Task 26: Bridge surface — STEP/XCAF document read

**Depends on:** Task 25
**Files:**
- Create: `services/geometry-rs/crates/occt-bridge/src/bridge/{step.rs,xcaf.rs}` + matching `cpp/*.cpp` shims
- Copy from (precedent): `services/geometry/app/convert.py` `_read_step` and the XCAF walk (the class list below is the verified inventory), and `https://github.com/bschwind/opencascade-rs/blob/main/docs/writing_bindings.md` for cxx mechanics

**Steps:**
1. Bridge exactly this surface (verified against `convert.py` — nothing speculative): `STEPCAFControl_Reader` (SetColorMode/SetNameMode/SetLayerMode/SetMatMode/ReadFile/Transfer), `Interface_Static::SetCVal("xstep.cascade.unit","MM")`, `IFSelect_ReturnStatus`, `TDocStd_Document` creation, `XCAFDoc_DocumentTool::ShapeTool`, `XCAFDoc_ShapeTool::{IsAssembly, GetComponents, GetReferredShape, GetLocation, GetShape, GetFreeShapes}`, `XCAFDoc_ColorTool::GetColor` (ColorSurf + ColorGen), `TDF_Label`/`TDF_LabelSequence`/`TDF_Tool::Entry`, `TDataStd_Name` (GetID/FindAttribute/Get), `TopLoc_Location::Transformation` + `gp_Trsf::Value(i,j)`, `Quantity_ColorRGBA` accessors.
2. Expose a Rust-idiomatic layer on top of the raw bridge: `read_step_document(path) -> Result<XcafDocument, OcctError>`; `XcafDocument::free_shapes() -> Vec<Label>`; `Label::{entry(), name(), is_assembly(), components(), referred_shape(), location_matrix() -> [f64;16], shape()}`; `color_for(label/shape) -> Option<[f32;4]>`. Handle<T> template instantiations need per-type C++ typedefs (writing_bindings.md covers this).
3. Test (fixture-gated): read `fixtures/plates.step` → free shapes count, assembly flags, component names include `M5-SHCS`, a color is present. Compare counts against `fixtures/plates.graph.json` (produced by Python from the same file).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p occt-bridge step 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** tessellation (Task 27), STEP writing (Task 32).

## Task 27: Bridge surface — tessellation, volume, bbox

**Depends on:** Task 26
**Files:**
- Create: `services/geometry-rs/crates/occt-bridge/src/bridge/mesh.rs` + shim
- Copy from (precedent): `services/geometry/app/convert.py` `_tessellate` (per-face loop), and `https://github.com/bschwind/opencascade-rs/blob/main/crates/opencascade/src/mesh.rs` (the reference tessellation walk)

**Steps:**
1. Bridge: `BRepMesh_IncrementalMesh` with **both** linear AND angular deflection (the opencascade-rs high-level API only exposes linear — bind the full constructor), `TopExp_Explorer` over `TopAbs_FACE`, `BRep_Tool::Triangulation` + node/triangle iteration with `TopLoc_Location` transform applied to nodes, `TopAbs_REVERSED` winding flip, `BRepGProp::VolumeProperties` + `GProp_GProps::Mass`, `Bnd_Box` + `BRepBndLib::Add`.
2. Rust API: `tessellate(shape, linear_deflection, angular_deflection) -> Result<MeshData, OcctError>` (`MeshData { vertices: Vec<[f64;3]>, triangles: Vec<[u32;3]> }`), `volume(shape) -> Result<f64, OcctError>`, `bbox(shape) -> Result<([f64;3],[f64;3]), OcctError>`.
3. Test: tessellate the box from `fixtures/box.step` at deflection 0.1/0.5 → triangle count within ±20 % of the count recorded in `fixtures/box.graph.json`-adjacent stats (extend `scripts/make_fixtures.py` to dump a `<name>.stats.json` with Python's per-part triangle counts if not already available); volume of a 10 mm box ∈ [999, 1001] mm³.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p occt-bridge mesh 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** proxy-bbox fallback policy (converter concern, Task 28).

## Task 28: Converter crate — XCAF walk, nodeIds, graph.json parity

**Depends on:** Task 27
**Files:**
- Create: `services/geometry-rs/crates/converter/{Cargo.toml,src/lib.rs,src/{tree.rs,node_ids.rs,units.rs}}`
- Modify: `services/geometry-rs/crates/geometry-types/src/wire.rs` — add `ConvertRequest/ConvertResponse/ConvertOptions/ConvertStats` (mirror `services/geometry/app/schemas.py` exactly, including defaults `linearDeflection=0.1, angularDeflection=0.5, compress=true`)
- Copy from (precedent): `services/geometry/app/convert.py` — the whole file (594 LOC), function-by-function

**Steps:**
1. Port `_read_step` → `_count_leaf_instances` (max_parts limit → typed `LimitExceeded` error) → `_build_tree` (recursive XCAF walk; per-unique-part tessellation cached by label entry string; per-part tessellation failure ⇒ bbox-proxy mesh + warning, never abort) → `_assign_node_ids` (SHA1 of `"{geometryHash}:{parentPath}:{siblingOrdinal}"`, first 16 hex chars — the STRING construction must match Python byte-for-byte; read `_assign_node_ids` and `_geometry_hash` (grep for it) and replicate the exact hash-input formatting including separators and ordinal formatting) → `_compute_world_bboxes`.
2. Port `_detect_source_unit` (regex over raw STEP text — pure Rust `regex`, copy the pattern).
3. Parity test (fixture-gated): convert `fixtures/plates.step` → produced graph must equal `fixtures/plates.graph.json` with: nodeIds **byte-identical**, tree shape identical, floats within 1e-6 relative (transforms/bboxes/volumes), colors identical. Any nodeId mismatch is a hard failure — print both hash inputs on mismatch.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p converter 2>&1 | tail -3
# Expected: "test result: ok." 0 failed, including graph parity for box, plates, nested
```

**Out of scope:** GLB output (Task 29).

## Task 29: GLB writer (`glb` crate, write half)

**Depends on:** Task 28
**Files:**
- Create: `services/geometry-rs/crates/glb/src/write.rs`
- Copy from (precedent): `services/geometry/app/glb.py` (180 LOC — the entire file)

**Steps:**
1. Port `write_glb`: node tree mirrors the graph 1:1; every node `extras: {"nodeId": ...}`; identical `geometryHash` shares one glTF mesh; materials deduped by RGBA; area-weighted smooth vertex normals (port the `np.add.at` accumulation as an index loop); buffers laid out as pygltflib does (positions f32, indices u32, ARRAY_BUFFER/ELEMENT_ARRAY_BUFFER targets). Write the GLB container (header + JSON + BIN, 4-byte padding).
2. Vertices are baked world-space with identity node transforms — replicate exactly (the viewer and the Task 4 reader both tolerate either, but parity means matching Python's choice).
3. Round-trip test: `converter` output for `plates.step` → `write_glb` → Task 4 `read_assembly_glb` → `validate_against_graph` passes; triangle totals equal the converter's tessellation totals; two of the four `M5-SHCS` nodes reference the same mesh index (parse the JSON chunk to assert mesh sharing).

**Verify:**
```bash
cd services/geometry-rs && cargo test -p glb write 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** compression (Task 30).

## Task 30: meshopt encode pipeline

**Depends on:** Task 29
**Files:**
- Create: `services/geometry-rs/crates/glb/src/meshopt_encode.rs`
- Copy from (precedent): behavior of `gltf-transform meshopt` (the only mode used — see `services/geometry/app/optimize.py`); spec `https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md`

**Steps:**
1. Implement quantize (positions per gltf-transform defaults) → vertex-cache reorder (`meshopt::optimize_vertex_cache` + `optimize_vertex_fetch`) → `encode_vertex_buffer` / `encode_index_buffer` (**encode version 0** for decoder compatibility — set via `encode_gltf`/`encode_index_version` equivalents in the meshopt crate) → rewrite bufferViews with `EXT_meshopt_compression` extension JSON + `extensionsRequired`.
2. HARD CONSTRAINT: node graph untouched — no join/flatten/dedup/prune (that's why Python never used `gltf-transform optimize`). Only bufferView-level rewriting.
3. Tests: (a) encode `plates` GLB → Task 4 reader decodes it → `validate_against_graph` passes and max vertex error vs pre-encode ≤ the Task 5 measured bound; (b) compressed size < 60 % of uncompressed for the plates fixture (gltf-transform achieves well under this); (c) `extras.nodeId` preserved on every node (port `test_optimize.py::compression preserves extras`).
4. Escape hatch: if quantization here exceeds the Task 5 bound, raise quantization bits until it passes and record final settings in `SPIKE-QUANTIZATION.md`.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p glb meshopt_encode 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** other gltf-transform features (simplification, texture handling — the pipeline has no textures).

## Task 31: Server `/convert` route + endpoint tests

**Depends on:** Tasks 21, 30
**Files:**
- Modify: `services/geometry-rs/crates/server/src/routes.rs` — add `/convert`
- Copy from (precedent): `services/geometry/app/main.py` `/convert` handler (line 68 onward) and `services/geometry/tests/{test_endpoint.py,test_limits.py}`

**Steps:**
1. `POST /convert`: auth → URL validation (all three URLs) → semaphore try-acquire (429 BUSY) → tempdir (`tempfile` crate) → streamed download with size cap → `converter::convert(...)` in `spawn_blocking` (413 `LIMIT_EXCEEDED` for part cap; per-part warnings pass through) → meshopt encode (failure ⇒ keep uncompressed + warning, mirroring `compress_glb` fallback) → PUT GLB then graph.json with `Content-Type` + `x-upsert: true` headers (upload failure ⇒ 502 `UPLOAD_FAILED`) → `ConvertResponse { ok, componentCount, unit, stats: { convertMs, meshTriangles, warnings } }`.
2. Endpoint tests against the Task 21 storage stub: full round-trip on `plates.step` (assert the stub captured both PUTs and the graph parses), read-failure 4xx, size-cap rejection, part-cap 413, busy 429.

**Verify:**
```bash
cd services/geometry-rs && cargo test -p server convert 2>&1 | tail -3
# Expected: "test result: ok." 0 failed
```

**Out of scope:** switching `assembly-convert.ts` (Task 35).

## Task 32: Rust fixture generator

**Depends on:** Task 26
**Files:**
- Create: `services/geometry-rs/crates/occt-bridge/src/bridge/primitives.rs` + shim (BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, gp_Trsf/gp_Vec transforms, STEPCAFControl_Writer, XCAF SetColor/AddShape/NewShape/AddComponent/UpdateAssemblies)
- Create: `services/geometry-rs/crates/converter/src/bin/make_fixtures.rs`
- Copy from (precedent): `services/geometry/tests/fixtures/make_fixtures.py` (133 LOC)

**Steps:**
1. Bridge the fixture-writing surface (listed above — it's the test-only half of the §3 inventory in the spec).
2. Port `make_fixtures.py` to a Rust bin producing the same `box.step`/`plates.step`/`nested.step` into `services/geometry-rs/fixtures/`.
3. Cross-check: Rust-generated `plates.step` fed through the Rust converter yields the same component count/names as the Python-generated one (nodeIds may differ if STEP entity ordering differs — assert on names/counts/structure here, NOT hashes).

**Verify:**
```bash
cd services/geometry-rs && cargo run -p converter --bin make_fixtures && ls fixtures/*.step
# Expected: box.step plates.step nested.step regenerated
```

**Out of scope:** deleting the Python fixture script (Task 35).

## Task 33: Converter parity gate

**Depends on:** Tasks 31, 32
**Files:**
- Create: `services/geometry-rs/scripts/convert_compare.py`
- Modify: `services/geometry-rs/SHADOW-RESULTS.md` — converter section

**Steps:**
1. Script: for each STEP in a given directory (fixtures + any real customer STEP files the user provides), run Python `convert_step` and the Rust converter binary; diff graph.json (nodeIds byte-equal, floats 1e-6) and GLB structure (node count, mesh sharing, triangle totals, extras.nodeId set equality). Record timings both sides.
2. Same gate rule as Task 22: at least one real customer STEP (ask the user) or STOP.
3. Viewer smoke: load one Rust-produced meshopt GLB + graph in the running dev app (user-assisted via the `/test` skill if a browser check is wanted) — the join in `packages/viewer/src/useAssembly.ts` must produce a full `nodesById` map.

**Verify:**
```bash
cd services/geometry-rs && python scripts/convert_compare.py fixtures/ && grep -A5 "## Converter" SHADOW-RESULTS.md
# Expected: PASS per model, nodeId sets byte-identical, timings recorded
```

**Out of scope:** production cutover.

## Task 34: Dockerfile + CI workflow

**Depends on:** Task 31
**Files:**
- Create: `services/geometry-rs/Dockerfile`
- Create: `.github/workflows/geometry-rs.yml`
- Copy from (precedent): `.github/workflows/geometry.yml` (triggers/structure), `services/geometry/Dockerfile` (healthcheck pattern)

**Steps:**
1. Dockerfile: stage 1 `rust:1-bookworm` — `cargo build --release -p server` (OCCT builds inside; use BuildKit cache mounts for `/usr/local/cargo/registry` and `target/`); stage 2 — try `gcr.io/debian12:latest`-class minimal (`debian:bookworm-slim`): copy the binary, `EXPOSE 8000`, `HEALTHCHECK CMD curl -f http://localhost:8000/health` (install curl or use a tiny healthcheck binary — simplest: `wget -qO-` from busybox layer or compile a `--health` flag into the server that curls itself; pick the simplest that works and note it). Check at build time whether the binary needs `libfontconfig`/`libgl` (OCCT sometimes links them even headless): `ldd` the binary in stage 1; add only the apt packages `ldd` proves are needed.
2. CI workflow: on PR/push touching `services/geometry-rs/**`: jobs `test` (cargo test --release with `Swatinem/rust-cache@v2` — first uncached run ~25 min, note the timeout at 45 min; fixture-dependent tests skip in CI since fixtures are ungenerated — that's the designed behavior; unit + calibration + parity-on-synthetic still run) and `docker` (build only, `push: false`, GHA cache — mirror `geometry.yml`).
3. Do NOT add to `deploy.yml` matrix or `sst.config.ts` — deployment topology belongs to `.ai/specs/2026-07-06-geometry-service-deployment.md` and Task 35's approval.

**Verify:**
```bash
docker build -t geometry-rs-test services/geometry-rs 2>&1 | tail -3 && docker run --rm -d -p 54019:8000 -e GEOMETRY_DEV_MODE=true --name geomrs geometry-rs-test && sleep 2 && curl -s http://localhost:54019/health && docker rm -f geomrs
# Expected: build succeeds; health returns {"ok":true,"version":"..."}
```

**Out of scope:** pushing images, SST resources, prod env vars.

## Task 35: Full cutover + Python removal — **requires explicit user approval before starting**

**Depends on:** Tasks 22 + 33 green on real models, user sign-off
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts` — remove `GEOMETRY_PLAN_SERVICE_URL` fallback (single `GEOMETRY_SERVICE_URL`)
- Modify: `packages/env/src/index.ts` — remove `GEOMETRY_PLAN_SERVICE_URL`
- Modify: `packages/dev/src/services/apps.ts` + `packages/dev/src/env.ts` — spawn only the Rust service on the primary geometry port
- Delete: `services/geometry/` (entire Python service), `.github/workflows/geometry.yml`
- Rename: `services/geometry-rs/` → `services/geometry/` (update workflow paths, dev spawn paths, script relative paths)
- Modify: `.ai/rules/*` and any AGENTS.md referencing the Python service (grep `services/geometry` across `.ai/` and `*/AGENTS.md`; update per `.ai/rules/keep-sources-in-sync.md`)

**Steps:**
1. Confirm with the user: shadow results accepted, real-model gates passed, deployment story (per the deployment spec) agreed.
2. Execute the file moves/deletes above; re-run the full Rust suite + `pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/dev`.
3. Update `.ai/lessons.md` with any port lessons learned (format: Context → Problem → Rule → Applies to).

**Verify:**
```bash
cd services/geometry && cargo test 2>&1 | tail -3 && pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/dev 2>&1 | tail -3 && ! grep -rn "geometry-rs" .github/workflows/ packages/dev/src/
# Expected: all green; no stale geometry-rs references
```

**Out of scope:** SST/production deployment execution (separate spec), Redis job store.
