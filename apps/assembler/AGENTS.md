# assembler — Agent Guide

The geometry service: STEP → GLB + assembly graph (`/convert`) and collision-free
disassembly motion planning (`/plan`), as a Rust **axum** HTTP service. It runs
over the C++ **FCL** (collision) and **OpenCASCADE** (CAD) libraries via `cxx`
bridges. Ported from a former Python/FastAPI service; the byte-for-byte outputs
(nodeIds, geometry hashes, collision truth) are preserved so previously stored
graphs and plans stay valid.

Design + history: `.ai/plans/2026-07-10-geometry-service-rust-rewrite.md`,
`.ai/runs/2026-07-10-geometry-rust-rewrite.md`.

## Workspace

The service binary is `apps/assembler`; the heavy lifting lives in workspace crates:

```
apps/assembler/  # axum HTTP: /health, /convert, /plan (async; poll GET /plan/{id})
                 # + bearer auth, URL validation, concurrency semaphore, graceful shutdown
crates/
├── collision/   # cxx bridge over C++ FCL 0.7.0. new_bvh / collide_pair / distance_pair.
├── occt-bridge/ # cxx bridge over OpenCASCADE. read_step: XCAF walk + tessellation → flat node tree.
│                # Flat multi-body products (one PRODUCT, ≥2 solids, no assembly tree — the common
│                # Fusion/SolidWorks export) split into per-solid child components; guarded so any
│                # sheet/surface geometry beside the solids keeps the merged mesh (nothing vanishes).
│                # write_test_step generates hermetic multi-solid STEP fixtures for tests.
├── converter/   # STEP → graph.json + GLB. nodeid (sha1), graph (tree/bbox/source-unit), convert, glb.
└── planner/     # assembly-by-disassembly motion planner: greedy/geom/fasteners/collide/steps.
                 # view.rs bakes a mesh-precise per-step camera DIRECTION into plan.json
                 # (`viewDirection`): Fibonacci-hemisphere candidates scored by ray-vs-triangle
                 # sight lines (Möller–Trumbore + AABB broadphase) against the bodies installed
                 # earlier in the sequence, so a part seating inside a hollow enclosure gets a
                 # view through the open side. The viewer fits the frame live at the real aspect.
```

Dependency flow: `apps/assembler → planner → converter → occt-bridge`; `planner → collision`.

## Native deps

**Dev (macOS):** `brew install fcl opencascade` (pulls libccd, eigen, octomap).
Each bridge's `build.rs` resolves the lib prefix from `<PKG>_PREFIX` env, else a
fixed per-target default (macOS-arm `/opt/homebrew/opt/<pkg>`, Linux `/usr`) — no
`brew` shell-out, so the build is reproducible.

**Deploy (Docker):** OCCT and FCL/ccd are **static-linked into the binary**, so the
runtime image is just the ~24 MB binary + OpenBLAS/libstdc++ (no collision or OCCT
shared objects). `occt.Dockerfile` builds a kept base image `carbon-occt` (OCCT
**V8_0_0_p1** static + the thread_local allocator patch in `occt-patches/`);
`Dockerfile` builds FCL 0.7 + libccd static (`FCL_STATIC_LIBRARY=ON`, no octomap)
and links it all in. Build the base image once; app-image builds then take minutes.

## Why bind the same C++ libs (not parry3d / pure-Rust)

The planner's correctness keys off FCL penetration depths at a 0.15mm tolerance;
parry3d's contact model differs structurally and can't match it. nodeIds derive
from a sha1 of quantized tessellation vertices; a different OCCT version tessellates
differently → different nodeIds → existing stored graphs/plans break. So both are
bound via `cxx`, not reimplemented.

## Verification

Self-contained Rust tests (no live Python):

```bash
cargo test -p collision -p converter -p planner --tests
```

- **`collision/tests/calibration.rs`** — the FCL byte-parity guard: replays a
  committed fixture (`calibration.json`, generated from python-fcl 0.7.0.11 /
  FCL 0.7.0) and asserts identical contacts/distances. This is what proves the
  C++ collision layer stays faithful.
- **`planner/tests/{synthetic_plan,plan_step_smoke}.rs`** — planner behaviour over
  in-code synthetic geometry + a smoke plan.
- **`converter`** unit tests (nodeid / source-unit / geom byte-parity).
- `converter/tests/convert_parity.rs` diffs graph.json against Python reference
  fixtures — **dormant**: it skips unless `ASSEMBLER_FIXTURES` points at a fixture
  dir (the former Python service produced these; only regenerate if re-establishing
  cross-impl parity).

## Run

```bash
ASSEMBLER_DEV_MODE=true cargo run -p assembler   # listens on 0.0.0.0:8000 (ASSEMBLER_BIND to override)
```

Env: `ASSEMBLER_SERVICE_API_KEY` (bearer auth), `ASSEMBLER_DEV_MODE=true` (allow
unauth + http + skip TLS verify, local only), `ASSEMBLER_MAX_SOURCE_MB` (250),
`ASSEMBLER_MAX_PARTS` (5000), `ASSEMBLER_MAX_CONCURRENCY` (2),
`ASSEMBLER_SHUTDOWN_GRACE_S` (600), `ASSEMBLER_ALLOWED_URL_HOSTS`.

## Completion & lifecycle

`/plan` is async: POST returns 202, the plan runs in a background task holding a
concurrency slot, and the result stays in memory at `GET /plan/{jobId}`. The
service has **no storage credentials** — it never uploads artifacts; the app's
`assembly-plan` Inngest function polls `GET /plan` and persists plan.json itself
with the service role. On SIGTERM/SIGINT the service stops accepting requests,
drains in-flight converts and plan jobs, then force-exits after
`ASSEMBLER_SHUTDOWN_GRACE_S`.

## Not yet done

- **meshopt compression** — the converter serves an uncompressed (contract-valid)
  GLB. In-process `meshopt` + `EXT_meshopt_compression` is a follow-up.
- **CI + registry** — no workflow yet builds/publishes the `carbon-occt` base or
  the `carbon-assembler` image, or deploys the container.

## Never

- Never swap the FCL/OCCT bridges for parry3d or a pure-Rust CAD lib — parity breaks.
- Never change nodeId derivation (`crates/converter/src/nodeid.rs`) — stored graphs
  reference these IDs. The byte-parity unit tests guard it.
