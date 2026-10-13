# assembler — Agent Guide

The geometry service: STEP → GLB + assembly graph (`/convert`), collision-free
disassembly motion planning (`/plan`), the compact preview GLB (`/optimize`), raw
compaction (`/compact`) and the PNG preview thumbnail (`/thumbnail`), as a Rust
**axum** HTTP service. It runs
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
                 #   /cache/invalidate; Redis job+result store (REDIS_URL)
                 # + bearer auth, URL validation, admission by memory, graceful shutdown
crates/
├── collision/   # cxx bridge over C++ FCL 0.7.0. new_bvh / collide_pair / distance_pair.
├── occt-bridge/ # cxx bridge over OpenCASCADE. read_step: XCAF walk + tessellation → flat node tree.
│                # Flat multi-body products (one PRODUCT, ≥2 solids, no assembly tree — the common
│                # Fusion/SolidWorks export) split into per-solid child components; guarded so any
│                # sheet/surface geometry beside the solids keeps the merged mesh (nothing vanishes).
│                # write_test_step generates hermetic multi-solid STEP fixtures for tests.
├── converter/   # STEP → graph.json + GLB. nodeid (sha1), graph (tree/bbox/source-unit), convert, glb.
├── thumbnail/   # GLB → PNG preview, on the CPU: reads plain or EXT_meshopt_compression GLBs,
│                # z-buffer rasteriser through the viewer's camera (45° perspective, Z up; home
│                # direction unless the caller names one),
│                # material base colours, transparent background, hand-written PNG encoder.
│                # `cargo run --release -p thumbnail --example render -- in.glb out.png` to eyeball one.
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
REDIS_URL=redis://localhost:6379 ASSEMBLER_DEV_MODE=true cargo run -p assembler   # listens on 0.0.0.0:8000 (PORT to override)
```

Env: `REDIS_URL` (required — the job store; boot fails without it),
`ASSEMBLER_SERVICE_API_KEY` (bearer auth), `ASSEMBLER_DEV_MODE=true` (allow
unauth + http + skip TLS verify, local only), `PORT` (8000). Every other limit is
a constant or derived in `config.rs` (max parts 5000, shutdown grace 600 s, job
and result TTLs 24 h, pending TTL 5 min, long-poll cap 25 s) — deliberately not
env-tunable.

## Tracing

`src/telemetry.rs` — OpenTelemetry traces over OTLP/HTTP, off unless
`OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) is set.
It reads the same variables as the Node apps (`packages/logger`):
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_SERVICE_NAME`
(default `assembler`), `OTEL_TRACES_SAMPLER[_ARG]`. Traces only — no metrics or
logs; `eprintln!` stays the log.

One trace per job: the caller's `traceparent` → the request span
(`POST /v1/convert`, named by matched route; `/health` has none) → `job <action>`
→ `download source` / `compute` / `upload artifact` / `callback`.

- **A job is spawned with `telemetry::spawn_job`, never bare `tokio::spawn`.**
  The job outlives its request, so the span context has to travel with the task;
  a bare spawn starts a job whose spans belong to no trace.
- **Across the Lambda self-invoke the parent rides in the run-job spec**
  (`traceparent`, written by `telemetry::inject` in `lambda_dispatch`, restored
  by `telemetry::attach` in `run::spawn_from_spec`). A spec built anywhere else
  can carry the same key.
- **Outbound requests go through `http::{download_hashed, upload, post_json}`**,
  which record the host only. The URLs are signed, and error text that quotes
  one is reduced to its origin before it is put on a span (`without_urls`).
- **Export uses the reqwest already in the binary** (`ExportClient`), not the
  exporter's bundled client: that one is reqwest 0.13 and brings a second TLS
  stack (aws-lc) beside ours (ring).
- **On Lambda every request flushes before it responds** — the process freezes
  once the response is sent. That adds one export round trip to each response
  there, capped at 3 s (`LAMBDA_FLUSH_WAIT`) so a slow collector cannot push a
  25 s job poll past API Gateway's 30 s; ECS and local runs export on the batch
  timer.
- **Every exit path calls `telemetry::shutdown()`** — `process::exit` runs no
  destructors, so a path that skips it drops the last batch.

`apps/assembler/sst.config.ts` forwards the `OTEL_*` variables that are set at
deploy time; `ci/src/assembler.ts` does not set any yet.

## Completion & lifecycle

Every action is an async job: POST returns 202 and the job runs in a background
task. Callers pass signed upload URLs at submit (`X-Carbon-Upload-Urls`) and a
`callback_url`; the job uploads its outputs and POSTs the terminal envelope the
moment compute ends. `GET /v1/jobs/{id}?wait=<secs>` long-polls (capped at 25 s)
and is the fallback when the callback is lost.

**Job status + pointers live in Redis** (`jobs.rs`): `asm:job:{jobId}` →
`{status, result, stats, …}`. Redis is required, so a restart, a sibling replica
or another Lambda invocation can answer a poll. It holds pointers, never artifact
bytes — with one exception below.

`GET /health` pings Redis (2 s limit) and answers 503 when it does not reply:
without Redis no job can be recorded or polled, so the instance is not healthy
and the container healthcheck / load balancer replaces it. The client
(`connect` in `jobs.rs`) bounds every connect (5 s) and reply (15 s) and
retries a lost connection with delays that double from 1 s to 5 s, so the
service is healthy again within seconds of Redis returning. The crate's
defaults wait forever and back off to a minute or two.

**Outputs go from memory to storage.** The service has no storage credentials.
When the submit carried a URL for every output, `finish()` PUTs them straight
from `Bytes` and stores nothing. Otherwise (no URLs at submit, or that upload
failed) the outputs are **parked** and the job stays `uploading` until a poll
brings fresh URLs (late-mint):

- on a standing service, as files under `<tmp>/asm-pending/<hash of job id>/`,
  memory-mapped for the upload and swept after the pending TTL;
- on Lambda, in Redis (`asm:pending:{jobId}`, same TTL), because the poll there
  is answered by a different invocation than the one that computed.

A parked job not drained within the TTL is abandoned (the caller resubmits).
Disk parking is per instance: with more than one standing replica a late-mint
poll must reach the replica that computed, so pass the URLs at submit. (Legacy:
a plan with no `planPath` returns the plan inline in the job record.)

**Content-hash result cache** (`asm:result:{model}:{contentHash}:{optsHash}:v{CODE_VERSION}`
→ pointer, 24 h): a repeat of the same model + bytes + options + code version
reuses the prior plan's storage pointer, skipping the FCL compute.
`CODE_VERSION` (`cache.rs`, shared with the convert cache) is the single version
lever — **bump it on any converter OR planner behavior change** to
auto-invalidate every cache. `optsHash` includes `units`/`sequence`, so a fresh
regenerate that drops auto-swarm units misses automatically. `POST /cache/invalidate`
`{modelUploadId}` is the central explicit bust (called best-effort from the app's
`invalidateAssemblyPlanCache`/`invalidateAssemblyModelCache`).

On SIGTERM/SIGINT the service stops accepting requests, waits for the whole
memory budget to come back (every compute done), then force-exits after the
shutdown grace.

## Memory

Built to sit as a small always-on pod beside other workloads.

- **Admission is by memory** (`admission.rs`), not by core. The budget is the
  container's limit (`/sys/fs/cgroup/memory.max`, cgroup v1's
  `memory.limit_in_bytes`, else `/proc/meminfo`) less a 300 MB baseline. Each
  compute holds its estimate out of it: 8× the source bytes for convert,
  optimize, compact and thumbnail; for a plan, 10× the source until the model is
  read, then 8 MB per part (`plan_step_observed` reports the count). Jobs that
  fit run together; one that does not waits in arrival order; one estimated
  above the whole budget takes all of it and runs alone. Nothing is rejected.
  The reservation covers the compute only, not the download or the upload. CPU
  is bounded separately by the blocking pool (cores + 2).
- **The estimate is not a limit.** Nothing stops a job from using more than it
  was admitted for, and geometry can be far heavier than its file size: a
  5 MB plate with 1,200 drilled holes still peaks at 840 MB, thirteen times its
  estimate. Such a job can still get the pod OOM-killed.
- **Flat faces with many holes are meshed lean** (`mesh()` in
  `crates/occt-bridge/src/occt.cc`). BRepMesh's default algorithm for a plane
  runs an interior-node pass whose memory grows with the square of the hole
  count; that 1,200-hole plate peaked at 6.2 GB. A part with more than 64 wires
  on one face is meshed with that pass off for planes only: 840 MB, and faster.
  The vertices are the same, so graph.json, nodeIds and geometry hashes do not
  change; the triangle wiring in the GLB can (co-circular ties on a regular hole
  pattern), and with it the contact-derived details of a plan for parts that
  touch such a face (one `needsSupport` flag flipped on a test assembly; the
  sequence, motions and contact graph did not). That is why parts under the
  threshold keep the default path and stay byte-identical. `ASSEMBLER_LEAN_PLANES=0` turns it off. OCCT's other
  mesher (Delabella) is not an answer: lean on memory, but minutes on the same
  plates.
- **The allocator** on Linux is jemalloc for the whole process (unprefixed, so
  OCCT and FCL use it too) with a background thread that returns freed pages
  after a second (`malloc_conf` in `main.rs`). `MALLOC_CONF=stats_print:true`
  prints its settings at exit.
- **The convert result cache** is files under `<tmp>/asm-cache` (2 GiB LRU, off
  on Lambda), memory-mapped when a hit is served and cleared at startup.
- **`<tmp>` must be real disk** with room for the cache, parked outputs and
  downloaded sources. A memory-backed `emptyDir` would charge all of it to the
  pod's memory limit. The server clears downloaded sources (`geometry-*`) left
  by an earlier process when it starts: a killed container skips its own
  cleanup and the volume outlives the restart.

## Not yet done

- **CI + registry** — no workflow yet builds/publishes the `carbon-occt` base or
  the `carbon-assembler` image, or deploys the container.

## Thumbnails

`POST /v1/thumbnail` `{ source: { url }, output: { path?, size?, direction? } }`
renders the GLB at `source.url` to a square PNG (300 px unless `size` says
otherwise) and late-mint uploads it as the `thumbnail` output.

The camera is the viewer's: a 45° perspective looking at the centre of the
bounding box, standing back far enough to fit the bounding sphere (`FOV_DEGREES`
/ `FIT_MARGIN` in `crates/thumbnail`, mirroring `AssemblyViewer`'s camera and
`frameBox` in `packages/viewer/src/ModelCanvas.tsx` — change one and change the
other). `direction` is `[x, y, z]` from the model towards the camera, Z up;
absent or unusable, it is the viewer's home view `[1, -1, 1]`. The viewer's
camera button (`ModelPreview` `onCaptureThumbnail`) sends the direction its
camera stands at, through `api+/model.thumbnail.ts` and the
`carbon/model-thumbnail` event. Only the direction travels: the image is always
re-framed to fit the whole model, whatever the viewer's zoom or pan. The caller is `@carbon/jobs`
`tasks/model-thumbnail.ts`, which hands it the model's optimised GLB (else the
lossless `convert` GLB). It replaced a headless-browser screenshot of the viewer
page. A Draco-compressed GLB is refused (`thumbnail_failed`); textures and vertex
colours are ignored in favour of the material colour.

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
