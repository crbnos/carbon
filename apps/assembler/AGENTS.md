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
apps/assembler/  # axum HTTP: /health, /convert, /plan (async; long-poll GET /plan/{id}?wait=),
                 #   /cache/invalidate; Memory|Redis job+result store (ASSEMBLER_REDIS_URL)
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
                 # stability.rs adds a support-polygon check (part CoM outside the hull of the
                 # contact points below it ⇒ `needsSupport`); pipeline2 `compute_waves` levels
                 # the precedence DAG into parallel-buildable `wave`s. Both purely additive to
                 # plan.json — the linear `sequence` is unchanged.
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
`ASSEMBLER_SHUTDOWN_GRACE_S` (600), `ASSEMBLER_ALLOWED_URL_HOSTS`,
`ASSEMBLER_REDIS_URL` (unset ⇒ in-memory store), `ASSEMBLER_JOB_TTL_SECS`
(86400), `ASSEMBLER_RESULT_TTL_SECS` (86400), `ASSEMBLER_PENDING_TTL_SECS` (300),
`ASSEMBLER_MAX_LONG_POLL_S` (25).

## Completion & lifecycle

`/plan` is async: POST returns 202, the plan runs in a background task holding a
concurrency slot. Callers **long-poll** `GET /plan/{jobId}?wait=<secs>` — the
request is held open (server-capped at `ASSEMBLER_MAX_LONG_POLL_S`) until the job
reaches a terminal state, so completion is near-immediate and a whole plan costs
a handful of checkpointed Inngest steps rather than ~180 short polls (`?wait`
absent ⇒ immediate return, back-compat).

**Job status + pointers live in a backend-selectable store** (`plan_jobs.rs`),
chosen at boot by `ASSEMBLER_REDIS_URL`:
- unset ⇒ `Memory` (process-local DashMaps, single-process behavior);
- set + reachable ⇒ `Redis` (a set-but-unreachable URL logs and falls back to
  memory — never refuses to boot).
Redis holds **only status + pointers, never plan/glb bytes**: `asm:job:{jobId}` →
`{status, planPath, stats, …}` (TTL `ASSEMBLER_JOB_TTL_SECS`). This is what makes
the service **stateless** — a restart or a sibling replica can still answer the
poll (no 404-on-restart loss).

**The plan artifact is offloaded to storage (late-mint).** The service has **no
persistent storage credentials**; instead the app mints a FRESH signed upload URL
on *each* long-poll and sends it as the `X-Plan-Upload-Url` header. On completion
the service marks the job `uploading` and parks the plan bytes in a short-TTL
hand-off buffer (`asm:pending:{jobId}` hash in Redis, or in-process in memory
mode); the next poll carrying a URL drains it — PUTting plan.json with a
seconds-old token, then returning the `{planPath, stats}` pointer. Minting late
(not at submit) keeps the token short-lived instead of needing one that outlives
the whole plan; buffering in Redis (not one replica's memory) means **any**
replica's poll can finalize, so it's not single-process/sticky. A plan not drained
within `ASSEMBLER_PENDING_TTL_SECS` is abandoned (the job re-plans). (Legacy: a job
with no `planPath` in meta returns the plan inline for the app to upload.)

**Content-hash result cache** (`asm:result:{model}:{contentHash}:{optsHash}:v{CODE_VERSION}`
→ pointer, TTL `ASSEMBLER_RESULT_TTL_SECS`): a repeat of the same model + bytes +
options + code version reuses the prior plan's storage pointer, skipping the FCL
compute. `CODE_VERSION` (`cache.rs`, shared with the convert LRU) is the single
version lever — **bump it on any converter OR planner behavior change** to
auto-invalidate every cache. `optsHash` includes `units`/`sequence`, so a fresh
regenerate that drops auto-swarm units misses automatically. `POST /cache/invalidate`
`{modelUploadId}` is the central explicit bust (called best-effort from the app's
`invalidateAssemblyPlanCache`/`invalidateAssemblyModelCache`).

On SIGTERM/SIGINT the service stops accepting requests, drains in-flight converts
and plan jobs, then force-exits after `ASSEMBLER_SHUTDOWN_GRACE_S`.

## Not yet done

- **CI + registry** — no workflow yet builds/publishes the `carbon-occt` base or
  the `carbon-assembler` image, or deploys the container.

## meshopt / Draco compression

`meshopt` + `EXT_meshopt_compression` (and optional `KHR_draco_mesh_compression`)
live in the **`/v1/optimize`** action (`crates/optimize`), NOT the converter. The
**convert** action still serves an uncompressed, contract-valid, lossless GLB (it
feeds the animated assembly viewer); optimise produces the separate compact
preview GLB. Gotcha grounded in `crates/optimize`: the meshopt vertex codec
requires every attribute stride be a multiple of 4 — i16 VEC3 normals are padded
to i16 VEC4 (8 bytes), or the spec JS decoder rejects the output.

## Never

- Never swap the FCL/OCCT bridges for parry3d or a pure-Rust CAD lib — parity breaks.
- Never change nodeId derivation (`crates/converter/src/nodeid.rs`) — stored graphs
  reference these IDs. The byte-parity unit tests guard it.
