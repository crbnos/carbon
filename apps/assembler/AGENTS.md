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
- **Across the Lambda self-invoke the parent rides in the worker spec**
  (`traceparent`, written by `telemetry::inject` in `lambda_dispatch`, restored
  by `telemetry::attach` in `main::spawn_traced`). A spec built anywhere else
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
moment compute ends. `GET /v1/jobs/{id}` is the fallback when the callback is
lost. It accepts `?wait=<secs>` (a long poll, capped at 25 s), but
`runAssemblerJob` never sends it: a long poll is an executing Inngest step, so
it held a slot of the shared concurrency key for its whole wait. The runner
polls once per wake and waits between polls in `waitForEvent`, which holds no
slot. A 5xx poll counts as unreachable, not as a lost job. When the runner gives
up on a job that is still queued or running, it calls
`POST /v1/jobs/{id}/cancel` (best effort) so the job does not keep its memory.

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

**Outputs go from memory to storage, never through Redis.** The service has no
storage credentials: the caller signs one upload URL per output at submit
(`X-Carbon-Upload-Urls`), and `finish()` PUTs each output straight from `Bytes`.
A PUT that fails is retried after 1, 2 and 4 s; still failing (or a missing
URL), the job fails with `UPLOAD_FAILED` and the caller resubmits with fresh
URLs. Outputs are never parked for a later poll: a late-mint hand-off used to
keep them on disk, or in Redis on Lambda, which put whole models in a shared
Redis.

**One parser per action** (`src/request.rs`). `POST /v1/{action}` and the
Lambda worker both parse the body through `request::parse`, so a default
cannot differ between runtimes. Convert and plan share one tessellation
(`config::TESSELLATION_*`): nodeIds hash the tessellated positions, so a
graph.json and a plan.json made at different deflections disagree. A plan
needs `meta.planPath` (400 without); there is no inline plan result, no
`?sync` mode and no `run-job` CLI.

**Job state is a Redis hash, changed only while the job is active.** A
record is `asm:job2:{id}` (fields `action`, `status`, `result`, `stats`,
`error`, `upload_urls`, `callback_url`). Every status change goes through one
Lua script (`TRANSITION`) that checks the job is still pending, starting,
running or uploading before it writes, so a finish can never overwrite a cancel
that landed meanwhile.

**Leases: who is running a job.** A working job (not `pending`) holds
`asm:lease:{id}` (30 s), renewed every 10 s by the process's `heartbeat` for
every job `jobs::track` lists (`telemetry::spawn_job` tracks each job). A poll
that finds a working job with no lease ends it `WORKER_LOST`, which the caller
resubmits: the process running it died. On Lambda the lease is the worker's
claim (`SET NX`): of two deliveries one runs, and a redelivery after a crashed
or timed-out invocation takes the job over; the request body stays in
`asm:req:{id}` until the job ends so it can.

**Cancel stops transfers.** `track` gives each job a cancel token; `cancel`
fires it at once on the replica running the job, and the heartbeat fires it on
any other within 10 s. Downloads and uploads race it (`http::unless_canceled`)
and fail `canceled`.

**A compute has a deadline** (`compute.rs`, 60 min; Lambda's 900 s comes
first there). OCCT and FCL cannot be interrupted and a blocking thread cannot
be killed, so past the deadline, or on a cancel, the job ends at once
(`COMPUTE_TIMEOUT` / `canceled`) and the thread finishes in the background
still holding the job's memory grant: admission never hands out memory a
stuck thread may still be using. A plan's grant lives inside its work (it is
resized as parts are counted), so it is released the same way.

**Secrets stay out of payloads, records and errors.**
- The Lambda self-invoke spec is `{ action, job_id, traceparent }` and nothing
  else. The request body waits in Redis (`asm:req:{id}`, 2 h) and the worker
  reads it (`GET`); it is deleted when the job ends (`ended()`), so a
  redelivery can take over a job whose worker died. No signed URL, caller
  token or service key rides in the Invoke payload, which AWS keeps for its
  async retries, but the stored body holds them, a `fetch`'s `authorization`
  included, until the job ends.
- `/events` is mounted only on Lambda, where only an IAM-signed Invoke reaches
  it; a spec names a job, so a delivery can only start a pending job with the
  body its create stored.
- A job's upload URLs are cleared when it ends. Its `callback_url` stays (the
  worker re-sends the callback; it only reports that one job).
- Every reqwest error goes through `without_url()`: signed URLs keep their
  token in the query string, and the message is logged, stored on the job and
  returned to the caller.
- The shared HTTP client follows no redirects: a redirect would reach a host
  `validate_url` never checked.

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
- **Downloaded sources are bounded too** (`source.rs`). A job takes one of
  `cores + 2` source slots before it downloads and holds it until its `Source`
  drops, which deletes the file on every path (a panic included). A queue past
  that waits with no file on disk; it used to hold every queued job's source
  at once.
- **Every transfer has a deadline**: a download 1 h end to end (the 60 s read
  timeout only catches a stalled one), an upload 2 min plus 2 MB/s of body, the
  Lambda self-invoke 10 s. A create claims `asm:create:{id}` (`SET NX`, 30 s,
  released when done) so two POSTs with one key cannot both spawn; a Lambda
  worker claims the job's lease (`claim_lease`, `SET NX`), so of two live
  deliveries exactly one runs. Callbacks from `set_error`/`cancel` go out in their own task.
- **A waiting job is `pending` or `starting`, not `running`.** Each action sets
  `running` only after `admission.acquire` returns. On Lambda the worker inlet
  sets `starting` when it takes a `pending` job, before the download and the
  admission wait, so a second delivery of the same job finds it taken and does
  not run it again. The job API reports both `pending` and `starting` as
  `queued`, and both count as active for cancel. A job cancelled while it
  waited for memory is dropped right after admission, before any compute.
  `runAssemblerJob` (`@carbon/jobs`, `tasks/assembler-client.ts`) starts an
  action's time budget at `running`, so time spent queued behind other jobs never
  fails a job. The optimize action's own deadline (`opts.deadline`) also starts
  after admission, not at the download.
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
- **`<tmp>` must be real disk** with room for the cache and downloaded
  sources. A memory-backed `emptyDir` would charge all of it to the
  pod's memory limit. The server clears downloaded sources (`geometry-*`) left
  by an earlier process when it starts: a killed container skips its own
  cleanup and the volume outlives the restart.

## Not yet done

- **CI + registry** — no workflow yet builds/publishes the `carbon-occt` base or
  the `carbon-assembler` image, or deploys the container.

## Fetch

`POST /v1/fetch` `{ source: { url, authorization? }, maxBytes?, output: { path?,
contentType? } }` copies the file at `source.url` into storage unchanged, as the
`raw` output, and returns `{ contentHash, outputs: { raw: { path, bytes } } }`
(`contentHash` = xxh3-128 hex). It exists so a caller never holds a large file:
the Onshape sync has the assembler pull a STEP export straight from Onshape into
staging instead of streaming it through the app's function.

- `authorization` is sent as the `Authorization` header (marked sensitive) and
  lives only in the request: never in the job record, a log or a span. On
  Lambda the request is the stored body (`asm:req:{id}`), so the token sits in
  Redis until the job ends, at most the request's 2 h.
- `fetch` alone follows redirects, at most five and each to a URL that passes
  `validate_url`; reqwest drops `Authorization` on a redirect to another host.
- Outside dev mode `fetch` connects only to public addresses: its resolver
  (`PublicOnly`) drops private, loopback, link-local, CGNAT and IPv6
  unique-local results and refuses a host with none left. Its URL is the one a
  third party decides (an Onshape Government tenant URL is the customer's to
  set); every other action reaches our own signed storage URLs, which a
  self-hosted install may serve from a private network. `validate_url` checks
  IP literals by the same rule (`config::is_public_ip`).
- `maxBytes` fails the job `LIMIT_EXCEEDED` (413), from `Content-Length` when
  sent, else as the bytes cross it.
- No zstd decoding: the stored bytes are exactly what the source served.
- No memory grant (no compute); it takes a source slot like every download.

## Thumbnails

`POST /v1/thumbnail` `{ source: { url }, output: { path?, size?, direction? } }`
renders the GLB at `source.url` to a square PNG (300 px unless `size` says
otherwise) and uploads it as the `thumbnail` output.

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

## Ingest (optimize with compact and thumbnail)

A new model is processed by ONE `/v1/optimize` job, which reads the raw once.
Two optional request fields add outputs:

| Field | Output | What it writes |
|---|---|---|
| `compact: { path? }` | `raw` (`application/zstd`) | A STEP is converted to BinXCAF once; the optimiser tessellates from that xbf, and the xbf is compressed (`.xbf.zst`). A mesh source is compressed as it is. An xbf source needs nothing. |
| `thumbnail: { path?, size?, direction? }` | `thumbnail` (`image/png`) | Rendered from the optimised GLB in memory, with the camera of `/v1/thumbnail`. |

Neither extra can fail the job: a failed compaction or render becomes a warning
and the output is left out. The caller is `@carbon/jobs` `tasks/model-optimize.ts`.
It asks for `compact` only while the raw is still in `temp-staging`; without a
`raw` output it copies the raw out of staging as it is. `/v1/compact` and
`/v1/thumbnail` stay for the cases outside ingest: a raw left in staging with the
assembler off, and a thumbnail from a captured camera direction.

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
