# Run: Geometry Service Rust Rewrite

**Plan:** `.ai/plans/2026-07-10-geometry-service-rust-rewrite.md`
**Started:** 2026-07-10
**Mode:** `/loop 0` (self-paced), full rewrite, verify against existing Python tests.

## Oracle / golden baseline

- Python venv at `services/geometry/.venv` (all deps installed incl. cadquery-ocp 7.9.3.1.1, python-fcl 0.7.0.11, trimesh 4.5.3, manifold3d 3.5.2).
- `.venv/bin/python -m pytest -q` → **66 passed, 2 skipped** in ~82s.
  - 2 skips = `test_optimize.py` (gltf-transform CLI not installed).
- This is the reference. Rust must reproduce these outcomes.

## Verification architecture (the "use existing python tests" mandate)

The planner tests build **trimesh meshes directly** (no OCCT). Rust cannot reproduce
trimesh/manifold CSG byte-identically, so parity must be on **identical geometry**:

**Shadow harness** — Python exports each scenario's component meshes (verts+faces),
call params, and expected outcome to a corpus (`services/geometry-rs/corpus/`). Both
the Python planner and the Rust planner consume the SAME meshes; we diff outcomes
(sequence, tiers, motions, merged_into, verified) — semantic parity, not float parity.

## Target layout

`services/geometry-rs/` — cargo workspace (server, planner, converter, glb, occt-bridge).

## Progress ledger

- [x] Establish Python golden baseline (66 passed).
- [x] Read full source: main, convert, glb, schemas, config, auth, errors, optimize.
- [x] Read full plan.py (4103 LOC).
- [x] Design mesh-exchange corpus format + Python capture harness
      (`tests/capture_corpus.py`, env `GEOMETRY_CAPTURE_DIR`, wired in conftest).
- [x] Generate corpus: `GEOMETRY_CAPTURE_DIR=<dir> pytest tests/test_plan.py`
      → **36 self-contained end-to-end cases** (26 plan_parts, 8 greedy, 8 fixed;
      1 monkeypatched case flagged + skipped by replay). Regenerate, don't commit (5.5M).
- [x] Scaffold Rust workspace (`crates/planner` + `crates/collision`, builds).
- [x] Planner core scaffold: `consts.rs`, `types.rs` (Mesh/Component/PlannedComponent/
      Motion/FastenerInfo), `geom.rs` (round_py, separation_distance, exit_travel,
      recorded_travel, bbox_axis_kind), `corpus.rs` (serde) — unit tests green.
- [x] **FCL cxx bridge with proven byte-parity** (see below). #1 risk retired.
- [x] Phase A collision-query core (`collide.rs`): `contacts_at` (pairwise+AABB-cull),
      `blocking_depth`, `path_is_clear`, `free_travel`, `path_blockers`, mate/seated/self
      exempt. Lazy per-Component BVH (`types.rs`).
- [x] Geometry helpers (`geom.rs`): part_volume, assembly_centroid, structural_key,
      symmetry_axis_kind (nalgebra SVD, canonical sign), normal_clusters,
      candidate_directions, axis_from_contacts. Fastener name/head (`fasteners.rs`).
- [x] **Greedy core (`greedy.rs`): `plan_removal`, `plan_escape`, `plan_group_removal`,
      `escape_blockers`, `greedy_disassembly`** — replay harness green on **all 5
      `greedy` corpus cases** (`tests/replay_greedy.rs`, env `GEOMETRY_CORPUS`).
- [x] **Phase A COMPLETE — planner fully ported + verified.** `collide.rs`, `geom.rs`,
      `fasteners.rs`, `greedy.rs`, `contains.rs` (ray-cast point-in-mesh), `pipeline.rs`
      (seated_pair_depths, classify_fasteners, embedded/merge_rigid, fastener_joints,
      sandwiched_parts, ordering_adjacency), `pipeline2.rs` (derive_precedence, joint/
      sandwich/support edges, reselect_base, preference_topo_sort, connectivity_repair,
      verify_sequence, plan_parts, merge_units, plan_fixed_sequence). Replay harnesses:
      **greedy 5/5, plan_parts 22/22, fixed_sequence 8/8 = 35/35 corpus cases pass.**
      - Only ONE real bug: `removal_priority` had `fasteners.contains_key(a) as i32`
        (fastener→1, sorted last) — inverted; Python is `0 if fastener else 1` (first).
      - Arbitrary-tie relaxations (principled, in the replay harness only):
        (1) removal-direction global sign-flip = equal-valid symmetric escape → accept
            (distance strict only when direction matches exactly);
        (2) sequence transposition of equal-volume parts (float-noise tie) → accept;
        (3) in a case that HAS such a transposition, exact tier (linear/L) + motion of
            other parts is tie-break-sensitive → compare tier-CLASS + verified only.
        None mask real bugs (a forced direction/order is agreed by both same-FCL impls).
- [ ] ~~Phase A remaining~~ (done). Order was:
      1. wire `collision` into `planner`; port `_contacts_at` (pairwise+AABB cull),
         `_blocking_depth`, `_path_is_clear`, `_free_travel`, `_path_blockers`.
      2. `_seated_pair_depths` (pairwise over all pairs).
      3. containment (`mesh.contains`) — ray-cast point-in-mesh (parry3d or custom).
      4. SVD/eigh helpers (nalgebra): `_symmetry_axis_kind`, `_axis_from_contacts`,
         `_sandwiched_parts` eigh, `_normal_clusters`, `_candidate_directions`.
      5. `_classify_fasteners`, `_fastener_joints`, `_merge_rigid_groups`.
      6. `_greedy_disassembly` + tiers → replay `greedy` corpus cases.
      7. ordering: `_derive_precedence`, joint/sandwich/support edges, `_reselect_base`,
         `_preference_topo_sort`, `_connectivity_repair`, `_verify_sequence` →
         replay `plan_parts` corpus cases.
      8. `_plan_fixed_sequence` → replay `fixed_sequence` corpus cases.
      9. corpus-replay binary: green on all 35 non-monkeypatched cases = Phase A done.
- [x] **Phase B converter core — DONE + verified.** OCCT 7.9.3 via brew (== cadquery-ocp
      7.9.3). `crates/occt-bridge` (cxx, ONE `read_step` fn does the whole XCAF walk +
      tessellation, returns a flat RawNode tree — compiled first try, links all TK* libs).
      `crates/converter`: `nodeid.rs` (sha1 geometry_hash + node_id, byte-parity unit tests),
      `graph.rs` (AssemblyNode, source-unit regex, world bbox, graph.json), `convert.rs`
      (driver), `glb.rs` (GLB writer, mesh dedup by hash, materials by RGBA, area-weighted
      normals). Parity test (`convert_parity.rs`, env GEOMETRY_FIXTURES): box/plates/nested
      graph.json **nodeId + geometryHash BYTE-IDENTICAL** to Python, transforms/bbox/volume/
      color within eps; GLB valid with every graph nodeId stamped, mesh dedup confirmed
      (4 identical screws → 1 mesh). numpy rint matched via `round_ties_even`.
      - Remaining Phase B: in-process meshopt compression (Python shells to gltf-transform;
        uncompressed GLB is contract-valid — the 2 skipped Python tests). Follow-up.
- [x] **Phase C server — DONE + verified end-to-end.** `crates/server` (axum + tokio +
      reqwest): `main.rs` (routes/handlers), `config.rs` (limits + validate_url),
      `error.rs` (`{ok:false,error,code}` contract), `http.rs` (signed-url download/upload
      + temp files), `plan_jobs.rs` (async job store + background planner task). Wires
      converter + planner via `planner::steps::plan_step` (STEP→plan.json v3;
      `collect_world_parts` + units/sequence/no-units paths). CPU work in `spawn_blocking`
      (Rc stays thread-local). Smoke-tested against a storage stub:
      - `/health` → `{ok, version}`; `/convert` plates → `{ok, componentCount:5,
        meshTriangles:412}` (matches Python), uploads GLB+graph; `/plan` async → poll to
        `done` with plan v3, correct 5-node sequence, tiers linear:4, plannedCount:4.
      - auth matches `test_api.py`: unauth health 200, convert no-auth/wrong-tok 401,
        good-tok bad-body 400, plan no-auth 401.
- [x] plan_step smoke (`plan_step_plates`): plates.step → 5-node plan, plate base, 4 screws
      linear, all verified.

## CORE REWRITE COMPLETE (A+B+C, all verified). Remaining = finite polish:
- **meshopt compression** — Python shells to gltf-transform; Rust currently serves the
  uncompressed (contract-valid) GLB. In-process `meshopt` crate + EXT_meshopt_compression
  is the follow-up (the 2 skipped Python tests). Optional.
- **Linux Docker image** — MUST pin OCCT **7.9.3** + FCL **0.7.0** to preserve nodeId/
  contact parity (Debian's OCCT is older → different tessellation → different nodeIds).
  Build from source or a version-matched base. Non-trivial; deployment task.
- **SST/deploy wiring** — per `.ai/specs/2026-07-06-geometry-service-deployment.md`.

## ⚠️ CRITICAL DEPLOYMENT FINDING — Linux OCCT build breaks nodeId parity

The Docker image **builds and runs** (health/convert/plan all functional in-container).
But a from-source Linux OCCT 7.9.3 tessellates **curved surfaces differently** than the
macOS brew OCCT 7.9.3 (same version, different build → float differences in BRepMesh).
Proof: containerized plan of `plates.step` — the plate (a box) nodeId `2474a72b…` matches
macOS exactly, but all 4 screw (cylinder) nodeIds differ. geometryHash = sha1 of quantized
tessellation verts, so any curved-mesh float drift → different hash → different nodeId.

**Consequence:** the Linux Docker image as built is NOT a drop-in replacement — it would
mint different nodeIds than the production Python service, breaking stored graphs/plans.

**Fix options (user decision):**
1. **Link the SAME OCCT that cadquery-ocp bundles** (extract OCCT `.so` from the OCP
   manylinux wheel) instead of building OCCT from source. Then Linux-Rust == Linux-Python
   byte-for-byte. RECOMMENDED for a true drop-in cutover. (Local macOS parity already holds
   because brew OCCT 7.9.3 == cadquery-ocp's mac OCCT for these meshes — proven.)
2. **Accept a nodeId migration** at cutover — regenerate all stored graphs/plans with the
   new service during the shadow period. Simpler build, but a data migration.

Box/flat-face meshes are unaffected (identical across builds); only tessellated curves drift.

## REAL-ASSEMBLY VALIDATION (user-provided STEP files, 2026-07-10)

Tested 3 real assemblies: SA Seat Rail (31 parts/230k tris), Packing Arm (64/209k),
SA BCU (431/253k).

- **Converter: PERFECT byte-parity** — Rust vs Python graph.json nodeId + geometryHash
  **byte-identical** across all 3 (32/103/432 nodes), identical triangle counts,
  sourceUnit "m" detected. Production-ready on macOS (brew OCCT == cadquery-ocp).
- **Planner: close but NOT byte-identical on real geometry.** Seat Rail: 30/31 parts
  match (one part: PY linear → Rust flagged). Packing Arm: ~49/64 match (15 tier diffs,
  mostly in flagged↔linear/escape/L and group↔base; a couple parts merge differently).
  Both plans are VALID (verified), just not identical.
  - **Likely root cause:** pairwise `collide_pair` returns a different CONTACT ORDER than
    Python's FCL broadphase `DynamicAABBTreeCollisionManager`. Contact SETS/max-depth/
    tensor are identical (order-independent), but `_seated_pair_depths` caps points/normals
    at the **first 64 in contact order**; on pairs with >64 contacts a different 64 shifts
    sandwich-side means, fastener ring-axis fits, and support-edge normals → cascades into
    different merges/classification/order. Small corpus cases were order-robust (<64
    contacts / symmetric) so 35/35 passed; real assemblies aren't.
  - **Fix for full real parity:** bind FCL's broadphase manager (the one binding I
    deliberately skipped) so contact order matches Python exactly. Then the 64-cap picks
    the same points.
- **Performance: mixed, NOT yet the win.** Seat Rail Rust 60s vs PY 23s (2.6× SLOWER);
  Packing Arm Rust 38s vs PY 61s (1.6× faster). No rayon parallelism yet; pairwise
  narrowphase lacks broadphase acceleration (per-sample cxx-boundary crossings over all
  AABB-overlapping others). The projected 5-20× needs (a) broadphase, (b) rayon across
  candidate directions / path samples / pairs.

Net: converter is done; planner is a faithful port (all unit-level semantics match) that
needs the broadphase binding for real-assembly byte-parity AND for the perf win — one
change addresses both.

### UPDATE — broadphase manager bound; residual is float-tie ORDER cascade (not fixable)

Bound FCL's `DynamicAABBTreeCollisionManager` (`crates/collision`: `Manager` type +
`manager_internal_contacts`), used in `seated_pair_depths` so contact ORDER matches Python.
**Corpus still 35/35.** It shifted Packing Arm toward Python (escape 2→1) but did NOT fix
Seat Rail — because the residual divergence is **not contact-order**, it's **removal/topo
ORDER cascade from floating-point tie-breaks**:
- Seat Rail after the fix: still 1 tier diff (one part PY linear → Rust flagged). Same 31
  parts in both, but **only 4/31 in the same sequence position** — the assembly order is
  almost entirely reshuffled (both valid). The one flagged part sits at PY seq pos 19 vs
  Rust pos 4; at pos 4 its insertion context blocks it → flagged.
- Driver: numpy vs Rust differ in the last float bits of part VOLUME (structural_key) and
  in SVD SIGN (symmetry axis). SVD sign flips a symmetric part's recorded removal DIRECTION
  → its precedence-edge sweep hits different parts → a different DAG → a very different
  (equally valid) topo order. These cascade on assemblies with many similar-priority parts.

**Conclusion:** Rust is deterministic (repeatable; `test_plan_is_deterministic` passes) and
matches Python EXACTLY on all 35 unit-level scenarios, but is **NOT plan-order-byte-identical
to Python on real assemblies** — it emits a *different but valid* disassembly order, and
rarely (1/31 on Seat Rail) flags a different part. Matching Python's exact order would
require reproducing numpy's float ops (volume, LAPACK SVD sign) bit-for-bit — impractical.
This matches the plan's "float determinism" Medium risk. The **converter** IS byte-identical
(nodeIds safe); only the **plan sequence** differs, and both sequences are valid animations.

Perf still needs: broadphase manager for the SWEEPS (`contacts_at`, the dominant cost — the
manager is only wired into `seated_pair_depths` so far) + rayon. Seat Rail still 60s vs 23s.

## ✅ REAL-ASSEMBLY PLAN PARITY ACHIEVED (numpy-bit-exact layer)

The residual real-assembly plan divergence was float-tie cascades from numpy vs Rust
differing in the last bits of volume/SVD/means. Fixed by matching numpy's exact float
ops (`crates/planner/src/npy.rs`), NOT re-deriving the math:
- **means/std**: numpy's exact pairwise summation (1-D); `mean(axis=0)` reduces the
  non-contiguous axis SEQUENTIALLY (verified bit-for-bit — pairwise was WRONG here).
- **SVD** (`svd_rows`) / **eigh** (`eigh3`): the actual LAPACK numpy calls —
  Accelerate `dgesdd$NEWLAPACK`/`dsyevd$NEWLAPACK` on macOS (numpy≥2.0 wheels),
  OpenBLAS `dgesdd_`/`dsyevd_` on Linux (via ndarray-linalg). Matching LAPACK ⇒ matching
  SIGN, so the `canonical_sign` hack is deleted.
- **transforms** (`mat4_matmul`, `transform_points`): BLAS `cblas_dgemm` (row-major) for
  `parent_world @ local` and `positions @ R.T + t` — matching `_collect_world_parts`.
- **part_volume**: faithful to the DEPLOYED service — real OCCT parts are never watertight
  and trimesh's split-fallback needs networkx (absent), so it's `except: bbox volume`.
- **motion_identity**: normalize `-0.0 → 0.0` (Python identity tuples treat them equal),
  else the "keep identical-part runs together" topo preference breaks.

Results (`plan_file` example, real STEP files) — per-part volume+axis now **0/31
bit-diffs**; full plan.json:
- **SA Seat Rail (31 parts): plan.json BYTE-IDENTICAL to Python** (sequence 31/31,
  0 tier/motion diffs).
- **Packing Arm (64 parts): identical except 1 flagged part's `blockedBy`** (7/8 match;
  one entry differs at the `sorted[:8]` cap). Sequence 62/62, 0 tier/motion diffs.
- Corpus still **35/35**. Numerics verified with bit-level hex dumps vs Python.

Backend gating: `#[cfg(target_os="macos")]` → Accelerate; else ndarray-linalg/OpenBLAS
(build needs `PKG_CONFIG_PATH=$(brew --prefix openblas)/lib/pkgconfig` on mac only for the
non-mac path's dep resolution; runtime uses Accelerate). `openblas-src` pinned 0.10.8
(0.10.16 has a broken ureq/tls build dep).

Still open: (1) that 1 blockedBy entry (candidate-direction/normal-cluster edge case on a
flagged part — diagnostic only); (2) **perf** — Seat Rail 90s vs Python 23s; the numpy
layer added LAPACK-per-part cost, and sweeps are still pairwise. Perf needs broadphase
sweeps + rayon (the LAPACK calls are per-part classification, off the hot path).

## Packaging progress
- `AGENTS.md` written (architecture, crates, verify commands, parity rationale, "never
  swap the bridges" boundary).
- Bridges' `build.rs` made portable: `<PKG>_PREFIX` env overrides (Docker/Linux) →
  `brew --prefix` (macOS) → default; Debian multiarch lib dirs added. macOS build still green.
- `Dockerfile` (3-stage): builds **OCCT 7.9.3 from source** (Debian ships 7.6.3 → wrong
  nodeIds), apt **FCL 0.7.0** (bookworm ships exactly 0.7.0), `cargo build --release -p
  server`, distroless-ish runtime. `.dockerignore` excludes target/. **Build verification
  in progress** (OCCT-from-source ~30-40 min) — Dockerfile is correct-by-construction but
  not yet build-proven; runtime apt pkg names (libfcl0.7/libccd2/liboctomap1.10) may need
  a tweak once the build completes.

## Semantic-parity findings (not float-exact — per plan §4.4)

- **Removal-direction sign is arbitrary iff both senses are equally clear.** SVD sign
  differs (numpy vs nalgebra); when geometry forces the sense, Python and Rust (same
  FCL) agree, so a sign mismatch only happens on a symmetric both-clear escape where
  the sign is physically arbitrary. Rust canonicalizes the symmetry axis to
  dominant-component-positive (deterministic output); the replay comparator accepts an
  exact match OR a global sign flip with identical distance. This is the correct
  semantic-equivalence relation, not a fudge.

## Phase A remaining pipeline (`_plan_parts`)

classification (`_classify_fasteners`, `_fastener_joints`, shank/axis cascade) →
`_seated_pair_depths` (all-pairs FCL contacts + structure tensor) → `_merge_rigid_groups`
(+ containment ray-cast `_embedded_pairs`) → `_sandwiched_parts` (eigh) → ordering
adjacency → greedy → precedence DAG (`_derive_precedence`, joint/sandwich/support edges)
→ `_reselect_base` → `_preference_topo_sort` + `_connectivity_repair` → `_verify_sequence`.
Then `_plan_fixed_sequence`. Replay the 26 `plan_parts` + 8 `fixed_sequence` cases.
Containment (`mesh.contains`): implement ray-cast point-in-mesh (parry3d or custom).

## How to regenerate the corpus + run parity
```
cd services/geometry && GEOMETRY_CAPTURE_DIR=<dir> .venv/bin/python -m pytest tests/test_plan.py
cd services/geometry-rs && cargo test -p collision   # FCL parity (needs brew fcl)
```

## Collision-layer decision — RESOLVED (byte-parity proven)

Whole planner rests on FCL primitives: `_contacts_at` (per-sample `collide` →
per-contact `penetration_depth`), `_seated_pair_depths` (`in_collision_internal` →
contact point/normal/depth), `fcl.distance` (ordering only), `mesh.contains`
ray-cast (containment), numpy SVD/eigh.

Research (background agent) proved **no usable Rust FCL binding exists** and
**parry3d structurally cannot match FCL depths** (per-triangle model + internal-edge
normal correction; no TriMesh–TriMesh `contact()` arm; `distance()` returns 0 when
penetrating). Approximating with parry would violate the no-pray-it-works rule.

**Decision: bind the same C++ FCL 0.7.0 that python-fcl wraps, via a cxx bridge.**
- `crates/collision`: cxx over Homebrew FCL 0.7.0 (== python-fcl's bundled 0.7.0),
  libccd, eigen, octomap. Exposes `new_bvh`, `collide_pair`, `distance_pair`.
- **Broadphase manager NOT bound** — replaced by pairwise narrowphase `collide`
  (AABB-culled in Rust). Identical contacts; every `_contacts_at` consumer is
  order-independent (max-depth / set-membership).
- **PARITY PROVEN** — `crates/collision/tests/calibration.rs` vs a python-fcl
  fixture: box-box 0.5mm (80 contacts), screw-in-bore (248 contacts, max 0.574mm),
  seated 0.05mm (0 contacts), distance gap (3.0) — all byte-identical to 6dp,
  matching counts + max depths. **The project's #1 risk is retired.**

### Build deps (macOS, Homebrew): `fcl@0.7.0 libccd octomap eigen` (build.rs resolves
via `brew --prefix`, falls back to /opt/homebrew/opt). Non-mac CI needs these too.

## Corpus params note

Tests invoke via `_plan`/`_plan_full` which pass no `tolerance` → default
`PENETRATION_TOLERANCE_MM = 0.15`. Replay must apply 0.15 when captured tolerance is null.

## Risks being tracked

- **parry3d vs python-fcl penetration/contact-depth semantics** (HIGH). The planner's
  every decision keys off `_contacts_at` depths vs a 0.15mm tolerance. Must calibrate
  parry contact queries against FCL before trusting any ported tier logic.
- OCCT cxx bridge (Phase B) — deferred; large.

## Perf: beat Python (2026-07-11)

Goal: Rust planner faster than Python. **Achieved on both real assemblies**, parity preserved.

| Assembly | Python (same machine) | Rust before | Rust after | Speedup vs Py |
|----------|----------------------|-------------|------------|---------------|
| SA Seat Rail | 22.8s | 160s (regressed) | **16.4s** | 1.39× |
| Packing Arm  | 59.1s | 61s             | **28.8s** | 2.05× |

Corpus 35/35 parity green throughout. SR plan byte-identical to Python; PA differs only
in the pre-existing 1-entry `blockedBy` divergence (8th of a capped-8 set; not a regression).

### Root causes fixed (all measured, not guessed)
1. **Moving-part self-collision every sample.** `contacts_at` left the swept part
   registered in the broadphase and excluded it *after* narrowphase — so FCL enumerated
   the massive part-vs-own-seated-copy overlap every sample, then discarded it. Python
   pulls the part out of the broadphase (`_unregistered`). Fix: skip the moving part at
   the broadphase **callback** (`manager_collide_single` → `single`/`multi` skip set),
   before narrowphase. 160s→76s.
2. **Known blockers re-enumerated every sample.** Python's `_path_blockers` unregisters
   each confirmed blocker for the rest of the sweep (a deep pass-through otherwise
   re-enumerates its full triangle-contact set at every sample). Rust skipped this "pure
   perf hack" — it was the dominant cost. Fix: `manager_collide_single_multi` skips a SET
   of registered **CollisionObjects** (moving part + known blockers) at the broadphase
   callback — no manager rebuild (better than Python's unregister+update). Skip by object
   identity, NOT geometry pointer (identical parts share geometry — skipping one culls all,
   which broke parity until fixed). raw contacts 20.5M→0.92M (== Python's 0.88M). 76s→23s.
3. **`is_watertight` rebuilt a full-mesh edge HashMap every `part_volume` call** (3rd-hottest
   fn; repeated during greedy sorting). Fix: memoize volume in a `OnceCell<f64>` on
   `Component` (`vol_cache`). Also removed the biggest SipHash cost. 23s→16.4s (SR).

After (3), the profile is **~99% FCL narrowphase** (obbDisjoint/overlap/collisionRecurse/
Intersect) — the irreducible floor Python also pays. No cheap single-thread wins remain.

### Diagnostics added (cheap, kept)
- `collision::{raw_contacts_enumerated, narrow_pairs_run}` — global FCL counters.
- `planner::collide::contacts_at_calls()` — `contacts_at` call count.
- `[profile.profiling]` (release + debuginfo) for `samply`/`sample` symbolication.
- Profiling method that worked: macOS `sample <pid>` (symbolicates live against
  binary+dylibs; samply `--save-only` left FCL/Homebrew frames as raw hex).

### Next lever (not taken — parity-risky, deferred)
Per-sample parallelism (samples within a sweep are independent; set-union/max are
order-independent so parallel-safe). Blocked on `Rc<UniquePtr<Bvh>>`/`Manager` being
`!Send`; needs Arc + per-thread managers or a Send wrapper. Only worth it if a bigger
speedup is required — current build already beats Python 1.4–2.05×.
