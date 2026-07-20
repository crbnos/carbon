# Geometry Service Rust Rewrite — Feasibility & Phased Plan

**Date:** 2026-07-10
**Status:** Draft — design decisions need sign-off before execution
**Scope:** `services/geometry` (Python/FastAPI → Rust), callers in `packages/jobs`, deployment

---

## 0. TL;DR / Recommendation

- **Do not adopt `opencascade-rs` as-is.** It has zero XCAF/assembly support (no `STEPCAFControl_Reader`, no `XCAFDoc_ShapeTool`/`ColorTool` — names, instance transforms, colors are all missing). The service's core value is assembly-structured STEP ingestion; opencascade-rs only reads STEP collapsed to a single shape.
- **Do not use napi-rs to embed the pipeline into `packages/jobs`.** Planning runs 10+ minutes of saturated CPU; the Inngest functions run *inside the ERP app* on a 2 vCPU / 4 GB Fargate task. Embedding would starve the web app, balloon its image with OCCT, and tie multi-minute jobs to ERP deploy lifecycle. Details in §6.
- **Recommended shape:** single static Rust binary (axum), same HTTP contract as today (`/health`, `/convert`, `/plan`, `/plan/{jobId}`), delivered in two phases:
  - **Phase A — Rust planner, no OCCT at all.** Change `/plan` to consume the **GLB + graph.json that `/convert` already produced** instead of re-reading the STEP. The planner becomes pure Rust (parry3d, rstar, nalgebra, rayon). This is 76% of the code (`plan.py` = 4,103 of 5,410 app LOC) and essentially 100% of the performance pain.
  - **Phase B — Rust converter.** Write a small, owned cxx bridge over `occt-sys` exposing the ~15 OCCT classes `convert.py` actually uses (inventory in §3). Write GLB with `gltf-json` + in-process `meshopt` crate — this also deletes the Node 20 + gltf-transform shell-out.
- **Deployment simplification is real but bounded:** the service is *not deployed anywhere today* (CI builds the Docker image with `push: false`; no SST entry, no compose entry). The draft spec `.ai/specs/2026-07-06-geometry-service-deployment.md` plans a Fargate service either way. Rust changes the *image* (Python 3.12 + OCCT wheel + Node 20 + gltf-transform → one ~50–100 MB static binary in distroless), not the topology.
- **Fallback option (smallest blast radius):** keep the Python service, rewrite only the planning hot core as a PyO3 extension. Captures most of the perf win, none of the deployment win. See §7.

---

## 1. Ground truth (verified 2026-07-10)

### Current service
- 5,410 app LOC Python: `plan.py` 4,103 · `convert.py` 594 · `main.py` 354 · `glb.py` 180 · rest small.
- OCCT usage is **confined to `convert.py`** (+ test fixtures). `plan.py` never imports OCP directly — it re-reads the STEP through convert.py's reader to get world-space meshes.
- Perf hot spots are **all in planning**, per in-code profiling notes:
  - Per-sample fcl narrowphase collision during removal-path sweeps (up to 400 samples/path, `num_max_contacts=100000`). One past profile: ~86% of total plan time, 53M contact constructions on a real assembly.
  - `mesh.contains` ray-casts (embedded solids, fastener ring probes), `fcl.distance` adjacency (budget-capped at 20k pairs), SVD/eigh for fastener axes and sandwich tensors.
  - No SDFs, no convex decomposition, no voxelization — every primitive maps 1:1 onto mature Rust crates.
- Conversion is OCCT-bound (C++ already); Python only adds per-face tessellation loop overhead and the GLB assembly. The gltf-transform compression is a `subprocess.run("gltf-transform meshopt in.glb out.glb")` with Node startup cost.
- scipy and rtree are **transitive deps only** — zero direct call sites. Nothing to port for them.

### Callers & deployment
- Exactly two callers, both Inngest tasks in `packages/jobs`:
  - `assembly-convert.ts` → `POST /convert` (synchronous; payload: signed GET url for STEP + signed PUT urls for GLB/graph; Inngest `retries: 2`; upload urls minted with `upsert: true` for idempotent retries).
  - `assembly-plan.ts` → `POST /plan` (202) then polls `GET /plan/{jobId}` every 15 s, 30-min budget, 60 s per-request timeout, handles 404-after-restart with up to 3 re-submits. Plan JSON returned inline in the poll response; the *job* uploads `plan.json` to storage.
- Jobs run inside the ERP app (`apps/erp/app/routes/api+/inngest.ts`, `inngest/remix` serve), deployed by SST to Fargate (2 vCPU / 4 GB, `node:22-slim`).
- `/plan` job store is an in-process dict (1 h TTL) — restart loses jobs; callers recover by re-submitting.
- Contract consumers: `packages/viewer` (`types.ts` mirrors graph.json; `useAssembly.ts` joins GLB nodes to graph via `extras.nodeId`; `plan.ts` expects plan version 3). Contract doc: `.ai/specs/2026-07-04-animated-work-instructions-contracts.md`.
- Test suite: 68 tests; 45 in `test_plan.py` encode the planning semantics (fastener order, sandwich gaskets, captive parts, escape BFS, determinism). Fixtures generated programmatically with OCP; storage faked with an in-process HTTP stub.

### Rust ecosystem (researched 2026-07)
- **opencascade-rs** (bschwind): active but hobby-paced, one maintainer, no releases since 0.2.0 (Aug 2023) — you'd pin a git rev. Binds via hand-written cxx bridges per OCCT module. Has: `STEPControl_Reader` (single-shape only), good per-face `BRepMesh_IncrementalMesh` tessellation. **Missing: the entire XCAF/STEPCAF surface.** Known hazard: OCCT exceptions can abort across the cxx boundary (issue #172) — needs defensive wrapping.
- **Mitigating fact:** its `occt-sys` crate already **compiles and links `TKXCAF`, `TKDESTEP`, `TKRWMesh`, `TKDEGLTF`** in the static OCCT build (pinned OCCT 7.8.1; upstream is 8.0.0). Exposing `STEPCAFControl_Reader` + XCAF tools is cxx bridge work only — no build-system surgery. Estimate 1–3 weeks focused FFI, permanently owned by us.
- **Pure-Rust STEP is a dead end for assemblies:** fornjot archived; truck's STEP *input* immature, no assembly/color support; ruststep is a schema parser, not an evaluatable B-rep (foxtrot tried and died). OCCT stays mandatory for ingestion.
- **Post-tessellation ecosystem is strong:** parry3d 0.29 (Dimforge, active) covers narrowphase contact manifolds, exact distance, ray-cast containment, BVH; rstar replaces rtree; `meshopt` crate binds meshoptimizer with full encoder surface (the EXT_meshopt_compression *codec*), but the document-level pipeline (quantize → reorder → encode → rewrite bufferViews/extension JSON) must be hand-written (~days); `gltf-json` can write GLB but it's low-level DIY.
- **napi-rs v3** (Jul 2025) has a mature prebuild story, but nobody publicly ships native OCCT through it; the Node world uses emscripten/WASM (occt-import-js) instead. Statically linked `.node` with OCCT ≈ 30–100 MB per platform, built natively per-OS on CI.
- **No public prior art** for "STEP→glTF in Rust" or "OCCT microservice in Rust" — we'd be first. Existing converters are C++ (Mayo, step2gltf) or WASM (occt-import-js).

---

## 2. Target architecture

One Rust crate workspace, one binary, same wire contract:

```
services/geometry-rs/
├── Cargo.toml                 # workspace
├── crates/
│   ├── server/                # axum: /health, /convert, /plan, /plan/{jobId}
│   │   └── (auth bearer, url validation, semaphore slots, httpx-equivalent via reqwest)
│   ├── planner/               # Phase A: pure Rust port of plan.py
│   │   └── (parry3d, rstar, nalgebra, rayon)
│   ├── converter/             # Phase B: STEP→tree+meshes via occt-bridge
│   ├── glb/                   # GLB write (gltf-json) + meshopt compression pipeline
│   └── occt-bridge/           # Phase B: owned cxx bridge over occt-sys (~15 classes)
└── Dockerfile                 # 2-stage: rust builder → distroless/cc, single binary
```

Crate choices:

| Concern | Today | Rust |
|---|---|---|
| HTTP server | FastAPI + uvicorn | axum + tokio |
| Wire schemas | Pydantic v2 (camelCase) | serde with `#[serde(rename_all = "camelCase")]` |
| Download/upload signed URLs | httpx (streamed, size-capped) | reqwest (streamed, size-capped) |
| Collision narrowphase + contacts | trimesh → python-fcl | parry3d (`TriMesh`, contact manifolds, BVH) |
| Exact pair distance | fcl.distance | parry3d distance queries |
| Point-in-mesh containment | `mesh.contains` (ray-cast) | parry3d point projection / ray-cast parity |
| Spatial index | rtree (via trimesh) | rstar |
| Linear algebra (SVD, eigh) | numpy | nalgebra |
| Parallelism | none (single-threaded Python) | rayon (across candidate directions / path samples / pairs) |
| STEP + XCAF read, tessellation | cadquery-ocp (OCP) | owned cxx bridge over occt-sys |
| GLB write | pygltflib (hand-built) | gltf-json (hand-built, same 1:1 nodeId contract) |
| meshopt compression | shell-out to gltf-transform (Node 20) | in-process `meshopt` crate + hand-written glTF pipeline |
| SHA-1 nodeIds | hashlib | `sha1` crate (byte-identical scheme) |

**Invariants that must hold bit-for-bit or contract-for-contract:**
- `nodeId = sha1("{geometryHash}:{parentPath}:{siblingOrdinal}")[:16]` — same string construction, same hex slice. Existing stored graphs/plans reference these IDs.
- graph.json shape (`version: 1`, `unit: "mm"`, col-major 4×4 transforms, RGBA colors, bbox, volume).
- GLB: every node has `extras.nodeId`, identical `geometryHash` shares one mesh, materials deduped by RGBA, no node-graph rewriting during compression (this is why only `meshopt`-style compression is allowed, never join/flatten/dedup).
- plan.json version 3 contract (`sequence`, `components{motion, tier, confidence, groupId, mergedInto}`, `groups`, `warnings`), fixed-sequence mode included.
- Determinism: same input → same plan (`test_plan_is_deterministic` parity).

---

## 3. Phase B dependency: the owned OCCT bridge surface

Exact classes `convert.py` uses today (must be bridged; nothing more):

- Reader/doc: `STEPCAFControl_Reader` (SetColorMode/SetNameMode/SetLayerMode/SetMatMode/ReadFile/Transfer), `Interface_Static::SetCVal("xstep.cascade.unit","MM")`, `IFSelect_ReturnStatus`, `TDocStd_Document`
- XCAF: `XCAFDoc_DocumentTool::ShapeTool`, `XCAFDoc_ShapeTool` (IsAssembly, GetComponents, GetReferredShape, GetLocation, GetShape, GetFreeShapes), `XCAFDoc_ColorTool::GetColor` (+ `XCAFDoc_ColorSurf`/`ColorGen`)
- Labels/attrs: `TDF_Label`, `TDF_LabelSequence`, `TDF_Tool::Entry`, `TDataStd_Name`, `TCollection_*`
- Topology: `TopoDS_Shape`, `TopoDS::Face`, `TopExp_Explorer`, `TopAbs_FACE`, `TopAbs_REVERSED`, `TopLoc_Location`
- Mesh/props: `BRepMesh_IncrementalMesh` (linear + angular deflection — angular needs a trivial bridge addition upstream lacks), `BRep_Tool::Triangulation` (+ node/triangle iteration), `BRepGProp::VolumeProperties` + `GProp_GProps`, `Bnd_Box` + `BRepBndLib::Add`, `Quantity_ColorRGBA`
- Test fixtures additionally need: `BRepPrimAPI_MakeBox/MakeCylinder`, `gp_Trsf/gp_Vec`, `STEPCAFControl_Writer`, XCAF SetColor/AddShape/NewShape/AddComponent/UpdateAssemblies

Notes:
- Source-unit detection is a **regex over raw STEP text** in Python, not an OCCT call — ports as plain Rust.
- Wrap every OCCT call in exception guards (`OCC_CATCH_SIGNALS` / try-catch in the C++ shim returning Result) — opencascade-rs #172 shows aborts are real.
- Decide: vendor the bridge in-repo (recommended — small, auditable, no upstream dependency on one busy maintainer) vs. PR upstream (nice-to-have later).
- occt-sys pins OCCT 7.8.1. Acceptable; note 8.0.0 exists if we ever need it (would mean owning the occt-sys fork too).

---

## 4. Phased execution plan

### Phase A — Rust planner (biggest win, no OCCT) — est. 4–6 weeks
1. **Contract change (small, jobs-side):** `/plan` payload gains `source: { glbUrl, graphUrl }` instead of the STEP url. `assembly-plan.ts` already runs strictly after convert (lazy, on-demand) and `modelUpload` has `glbPath`/`graphPath` — mint signed GET urls for those instead. Version the payload so old/new services can coexist during rollout.
2. **GLB ingestion in planner:** decode meshopt-compressed GLB (meshopt crate has decoders; gltf-rs won't decode `EXT_meshopt_compression` natively — hand-roll the bufferView decode, same code we need for Phase B encode anyway). Join meshes to graph.json by `extras.nodeId`, apply world transforms.
   - **Risk to burn down first (spike, week 1):** quantization error from meshopt vs `PENETRATION_TOLERANCE_MM = 0.15` (scaled to 2.5× linearDeflection). Measure on real assemblies. Mitigations if it bites: raise position quantization bits at encode time, or have `/convert` also upload an uncompressed GLB variant for the planner. Decide by measurement, not vibes.
3. **Port planning pipeline** in dependency order, mirroring `plan.py`'s phases: seated broadphase pair depths → ordering adjacency → fastener classification (name regex + SVD axis cascade) → rigid merge (union-find + containment ray-casts) → fastener ring joints → sandwich detection (eigh of contact tensor) → greedy disassembly (tier 1 linear / tier 2 "L" / tier 3 escape BFS / group extraction) → base re-selection → precedence DAG + preference topo sort → forward verification.
4. **Tests first, as golden:** port all 45 `test_plan.py` cases before/alongside each phase (most build synthetic meshes in-memory — no OCCT needed, translate to parry TriMesh builders). Add a **shadow-comparison harness**: run Python and Rust planners on the same real assemblies, diff sequences/tiers/warnings. Semantic parity gate, not float parity.
5. **Parallelize** with rayon only after parity: candidate directions per part, path samples, pair loops. Keep determinism (ordered reduction / stable sort of results).
6. **fcl → parry3d calibration:** penetration depth and contact manifold conventions differ between FCL and parry. Write a small calibration test set (box-box, cyl-in-bore, coplanar contact) asserting the tolerance semantics the planner depends on. Budget real time here — this is the subtle-bugs zone.
7. Ship as `/plan` v2 route in the Rust binary; Python service keeps serving `/convert`. Two containers during transition (or one Rust binary proxying `/convert` to Python — simpler: run both behind the jobs-side env urls, `GEOMETRY_PLAN_SERVICE_URL` temporary override).

### Phase B — Rust converter + GLB/meshopt in-process — est. 3–4 weeks
1. Build `occt-bridge` (surface in §3) against occt-sys. CI-cache the OCCT static build (~20–25 min cold; cache makes it minutes).
2. Port `convert.py`: XCAF walk → per-unique-part tessellation cache (keyed by label entry) → nodeId assignment → world bboxes → GLB write via `gltf-json` (1:1 node contract) → in-process meshopt encode (quantize + reorder + `EXT_meshopt_compression`, v0 encoding for decoder compat).
3. Port fixture generator (`make_fixtures.py`) using the bridge's BRepPrimAPI subset; port `test_convert.py` (nodeId stability across runs is the key test) + endpoint/limit/api tests.
4. Byte-diff gate: same STEP in → Rust vs Python graph.json semantically identical (nodeIds byte-identical, floats within epsilon); GLB loads in `packages/viewer` with identical `nodesById` join.
5. Per-part tessellation failure → bbox proxy + warning (preserve the never-abort behavior).
6. Retire the Node stage from the image.

### Phase C — cutover + deployment — est. 1 week
1. Single Rust image: `FROM rust:… AS build` (static OCCT via occt-sys) → `FROM gcr.io/distroless/cc` (or debian-slim if OCCT needs fontconfig etc. — verify; the Python image needed libgl/fontconfig, static OCCT may not). Target: one binary, ~50–100 MB image vs today's Python+OCCT+Node stack.
2. Wire into the deployment plan that already exists (`.ai/specs/2026-07-06-geometry-service-deployment.md`): add to `deploy.yml` matrix, SST `CarbonGeometryService` on `CarbonCluster`, `/health` checks, `GEOMETRY_SERVICE_API_KEY` injection. The Rust rewrite slots into that spec unchanged — smaller image, faster cold start, lower memory.
3. Optional (carried over from that spec): externalize the `/plan` job store to Redis. In Rust it's a `DashMap` with TTL initially — same restart semantics as today; callers already recover via re-submit. Don't couple this to the rewrite.
4. Shadow period: run Python and Rust side by side on real conversions/plans (jobs-side env flag per company or percentage), compare outputs, then flip `GEOMETRY_SERVICE_URL` and delete `services/geometry` (Python).

---

## 5. Expected gains (honest estimates)

- **Planning:** the dominant costs are per-contact Python object construction (53M contacts on one profile) and single-threaded orchestration of native calls. Rust removes marshaling entirely and rayon parallelizes candidate sweeps. Realistic **5–20× wall-clock** on real assemblies, more on many-core boxes; the 10-minute plans are the target. (Narrowphase itself is native in both — the win is overhead removal + parallelism, not "Rust is faster than C++ FCL".)
- **Conversion:** OCCT dominates; expect **1.5–3×** from removing the per-face Python loops, the numpy round-trips, and the Node subprocess (startup + double file I/O). Memory footprint drops materially.
- **Image/deploy:** Python 3.12 + 70 MB OCP wheel + Node 20 + gltf-transform + numpy/scipy/trimesh/fcl → one static binary. Faster cold start, smaller attack surface, one runtime to patch.
- **What Rust does NOT buy:** STEP parsing speed (same OCCT), fewer OCCT bugs (same OCCT), simpler service topology (still a sidecar service — see §6 for why that's correct).

---

## 6. napi-rs option — evaluated, rejected (for the pipeline)

Considered: compile the Rust pipeline as a Node native addon consumed directly by `packages/jobs`, deleting the microservice.

Rejected because:
1. **Placement:** Inngest functions execute inside the ERP app (Fargate 2 vCPU / 4 GB). A 10-minute CPU-saturating plan inside the web app's task starves request handling; convert spikes would do the same. We'd end up carving out a dedicated worker service anyway — which is just the microservice again, with harder packaging.
2. **Image coupling:** ERP image would carry OCCT (30–100 MB native addon) and redeploying ERP would kill in-flight plans; today's poll/re-submit protocol survives geometry restarts independently.
3. **No prior art:** nobody ships native OCCT via napi; the Node ecosystem uses WASM (occt-import-js) for a reason. First-mover cost with no upside vs. a plain Rust HTTP service.
4. **Scaling:** a sidecar service scales independently of ERP (the concurrency semaphore + 429 protocol already exists for this).

Where napi-rs *could* make sense later: exposing the pure-Rust **planner** crate to Node for local/dev tooling or unit tests in `packages/viewer` — cheap because that crate has no OCCT. Not part of this plan.

## 7. Fallback option — PyO3 hot-core (if appetite shrinks)

Keep the Python service and OCCT via cadquery-ocp; rewrite only the collision/path-sweep core (`_contacts_at`, `_path_is_clear`, `_path_blockers`, `_seated_pair_depths`, BVH cache) as a Rust extension with PyO3/maturin using parry3d + rayon.

- Captures the large majority of the perf win at ~2–3 weeks effort.
- Zero contract risk, zero OCCT FFI, tests stay green as-is.
- Buys nothing on deployment (still Python + Node + OCP wheel image).
- Reasonable as Phase 0 / de-risking step, or as the endpoint if the full rewrite loses priority.

---

## 8. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| parry3d vs FCL penetration-depth/contact semantics differ → planner behavior drift | High | Calibration test set + 45 golden tests + shadow comparison on real assemblies before cutover |
| meshopt quantization vs 0.15 mm penetration tolerance (Phase A plans from compressed GLB) | High | Week-1 spike; raise quantization bits or upload uncompressed variant if needed |
| Owning the OCCT cxx bridge forever (one-off FFI, exceptions abort across boundary) | Medium | Small pinned surface (~15 classes), exception guards in C++ shim, vendored in-repo |
| opencascade-rs/occt-sys unversioned (git-rev pin, OCCT 7.8.1) | Medium | Pin rev + vendor; we depend on occt-sys build only, not their API surface |
| Float determinism across platforms (plan determinism test) | Medium | Stable sorts, ordered rayon reductions, fixed candidate ordering; determinism test in CI |
| 4,103 LOC of dense geometric heuristics silently mis-ported | High | Port test-first, phase by phase; shadow-compare; never port two phases without green goldens |
| OCCT build time in CI (~25 min cold) | Low | Cache occt-sys artifact; only rebuilds on rev bump |
| plan.py evolves on this branch while port is in flight | Medium | Freeze planner semantics before Phase A port starts, or rebase goldens deliberately |

## 9. Open decisions (need sign-off)

1. **Phase A plan-from-GLB contract change** — planner consumes GLB+graph instead of STEP (recommended; enables the OCCT-free phase). Alternative: keep STEP input and pull the OCCT bridge into Phase A (merges A and B risk).
2. **Vendor the cxx bridge in-repo vs. fork/PR opencascade-rs** — recommend vendor in `services/geometry-rs/crates/occt-bridge`.
3. **PyO3 fallback as explicit Phase 0** — do the 2–3 week hot-core extension first to bank the perf win, then continue the full rewrite? Or straight to Phase A?
4. **Service location/name** — `services/geometry-rs` during transition, renamed to `services/geometry` after Python deletion?
5. Total estimate **8–11 weeks** for A+B+C (single senior dev, Rust+C++ comfortable). Acceptable?
