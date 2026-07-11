# assembler — Agent Guide

Rust rewrite of `services/geometry` (Python/FastAPI). Same wire contract; the
motion planner and STEP→GLB converter run in Rust over the **same** C++ FCL and
OpenCASCADE libraries the Python service used, so outputs match byte-for-byte
where they must (nodeIds, geometry hashes, collision truth).

Design + progress: `.ai/plans/2026-07-10-geometry-service-rust-rewrite.md`,
`.ai/runs/2026-07-10-geometry-rust-rewrite.md`.

## Workspace

```
crates/
├── collision/    # cxx bridge over C++ FCL 0.7.0 (Homebrew). collide_pair + distance_pair.
├── occt-bridge/  # cxx bridge over OpenCASCADE 7.9.3 (Homebrew). ONE read_step fn: XCAF walk + tessellation → flat node tree.
├── converter/    # STEP → graph.json + GLB. nodeid (sha1), graph (tree/bbox/source-unit), convert (driver), glb (writer).
├── planner/      # assembly-by-disassembly motion planner. collide/geom/fasteners/greedy/contains/pipeline/pipeline2/steps.
└── server/       # axum HTTP: /health, /convert, /plan (async) + auth + download/upload.
```

Dependency flow: `server → planner → converter → occt-bridge`; `planner → collision`.

## Native deps (macOS / Homebrew)

`brew install fcl opencascade` (pulls libccd, eigen, octomap). Versions **must**
match the Python service's for parity: **FCL 0.7.0** (== python-fcl 0.7.0.11's
bundled FCL) and **OpenCASCADE 7.9.3** (== cadquery-ocp 7.9.3). `build.rs` in each
bridge resolves paths via `brew --prefix` (falls back to `/opt/homebrew/opt`).

## Why bind the same C++ libs (not parry3d / pure-Rust)

The planner's correctness keys off FCL penetration depths at a 0.15mm tolerance;
parry3d's contact model differs structurally and can't match it. nodeIds derive
from a sha1 of quantized tessellation vertices; a different OCCT version tessellates
differently → different nodeIds → existing stored graphs/plans break. So both are
bound via `cxx`, not reimplemented. See the run log's "collision-layer decision".

## Verification (the Python tests are the oracle)

Parity is proven against the Python suite, not asserted. Two mechanisms:

1. **Planner shadow corpus** — `services/geometry/tests/capture_corpus.py` (env
   `ASSEMBLER_CAPTURE_DIR`) captures the exact meshes + params + outcome from every
   `_plan_parts`/`_plan_fixed_sequence`/`_greedy_disassembly` call the real pytest
   makes. The Rust planner replays identical meshes and must reproduce the outcome.
2. **Converter fixture parity** — convert the STEP fixtures in both, diff graph.json
   (nodeId + geometryHash byte-identical) and check GLB nodeIds.

```bash
# regenerate corpus + fixtures (needs the Python venv at services/geometry/.venv)
cd ../geometry && ASSEMBLER_CAPTURE_DIR=/tmp/geom-corpus .venv/bin/python -m pytest tests/test_plan.py
.venv/bin/python tests/fixtures/make_fixtures.py /tmp/geom-fixtures
.venv/bin/python -c "import json;from pathlib import Path;from app.convert import convert_step;[Path('/tmp/geom-fixtures/%s.graph.json'%n).write_text(json.dumps(convert_step(Path('/tmp/geom-fixtures/%s.step'%n),Path('/tmp/geom-fixtures/%s.glb'%n)).graph)) for n in ['box','plates','nested']]"

# run the Rust parity suites
cd ../geometry-rs
cargo test -p collision --test calibration                                   # FCL byte-parity
ASSEMBLER_CORPUS=/tmp/geom-corpus cargo test -p planner --test replay_greedy   # 5 cases
ASSEMBLER_CORPUS=/tmp/geom-corpus cargo test -p planner --test replay_plan_parts  # 22 cases
ASSEMBLER_CORPUS=/tmp/geom-corpus cargo test -p planner --test replay_fixed    # 8 cases
ASSEMBLER_FIXTURES=/tmp/geom-fixtures cargo test -p converter --test convert_parity
ASSEMBLER_FIXTURES=/tmp/geom-fixtures cargo test -p planner --test plan_step_smoke
cargo test    # unit tests (nodeid/source-unit/geom byte-parity, etc.)
```

Status: **35/35 planner corpus cases + FCL parity + converter graph/GLB parity all green.**

Semantic-parity note: the replay harness accepts arbitrary ties (removal-direction
sign flips on symmetric escapes, equal-volume sequence transpositions from
float-noise) — these can't hide real bugs because a *forced* direction/order is
agreed by both same-FCL implementations. See the run log.

## Run

```bash
ASSEMBLER_DEV_MODE=true cargo run -p assembler   # listens on 0.0.0.0:8000 (ASSEMBLER_BIND to override)
```

Env: `ASSEMBLER_SERVICE_API_KEY` (bearer auth), `ASSEMBLER_DEV_MODE=true` (allow
unauth + http + skip TLS verify, local only), `ASSEMBLER_MAX_SOURCE_MB` (250),
`ASSEMBLER_MAX_PARTS` (5000), `ASSEMBLER_MAX_CONCURRENCY` (2),
`ASSEMBLER_ALLOWED_URL_HOSTS`.

## Not yet done

- **meshopt compression** — the converter serves an uncompressed (contract-valid)
  GLB, equivalent to the Python service without gltf-transform. In-process
  `meshopt` + `EXT_meshopt_compression` is a follow-up.
- **Linux Docker image** — must pin OCCT 7.9.3 + FCL 0.7.0 (Debian's OCCT is older
  → different nodeIds). Build from source or a version-matched base.
- **Deployment (SST)** — per `.ai/specs/2026-07-06-geometry-service-deployment.md`.
- Caller `units` are merged for planning but the fastened-member ejection
  refinement (`_eject_fastened_unit_members`) is not yet ported.

## Never

- Never swap the FCL/OCCT bridges for parry3d or a pure-Rust CAD lib — parity breaks.
- Never change nodeId derivation (`crates/converter/src/nodeid.rs`) — stored graphs
  reference these IDs. The byte-parity unit tests guard it.
