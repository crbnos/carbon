# Retained-raw compaction: zstd + OCCT XBF

> **STATUS: implemented** (2026-07-15). Both phases landed together (D2).
> occt-bridge `step_to_xbf`/`read_xbf` (magic `BINFILE`), converter `build_tree`
> content-sniff + `convert_xbf`, assembler transparent-zstd `download_hashed` +
> `Format::Xbf` + `compact` action, `model-optimize.ts` compact step. XBF↔STEP
> parity proven (`crates/converter/tests/xbf_parity.rs`). All Rust suites +
> jobs/utils typecheck green.
>
> **Revision (same day):** default compaction changed to **all optimisable
> uploads, any size, mode `zstd`, original format preserved** (`raw.<ext>.zst`) —
> the user wanted every STEP compacted while staying a downloadable, openable
> file. The `file+/preview` route zstd-decompresses `.zst` on download
> (`node:zlib`). Compact path is FLAT (`${id}.step.zst`) so `modelIdFromPath`
> still resolves; TTL prune excludes `.zst` (compacted raws are permanent).
> `xbf` mode remains available in the `compact` action + full xbf read path, but
> is **not used by default** (kept for a possible future "xbf for big hidden
> raws" optimisation — those parse the full STEP on every plan today).
> Pending: `generate:types` (optimizedSize), `db:migrate` + assembler redeploy.

**Goal:** stop hoarding fat raw STEP. After eager optimise, replace the raw with a
compact, lossless artifact that lazy planning + reoptimise can still consume. Two
mechanisms, both requested: (1) transparent **zstd**, (2) OCCT **XBF** (XCAF binary
document — B-rep + assembly tree + names + colors, smaller + faster to parse than
ASCII STEP).

Retained target evolves: `raw.step` → Phase 1 `raw.step.zst` → Phase 2 `raw.xbf.zst`.

Nothing downstream changes contract: every action fetches its source through
`http::download_hashed`, so transparent zstd + an xbf loader make `.zst` / `.xbf`
sources "just work" for optimize, convert, plan, reoptimize.

---

## Phase 1 — zstd (no OCCT; ships the storage win)

1. **Transparent zstd input** — `apps/assembler/src/http.rs` `download_hashed`:
   sniff the zstd magic (`28 B5 2F FD`) on the first bytes; if present, stream the
   body through a zstd decoder into the temp file. Hash the **decompressed** bytes
   (content-hash cache key must track true geometry, not the container). Keep the
   decompressed-size guard on the `written` counter (compressed `content_length`
   can't gate it). Dep: `async-compression` (tokio + zstd feature).

2. **`compress` action** — new `POST /v1/compress` (register in `actions/mod.rs`,
   advertise in `GET /v1`): streaming download → zstd (level ~19) → streaming PUT to
   a caller-supplied dest URL. No late-mint, no RAM buffer (pre-minted dest). Typed
   errors like the others.

3. **Wire into `packages/jobs/.../tasks/model-optimize.ts`** — after `persist`
   (optimise Success), add `step.run("compact-raw")`: mint an upload URL for
   `${companyId}/models/${modelUploadId}/raw.step.zst`, invoke assembler `compress`
   (source = signed raw URL, dest = that URL), then set
   `modelUpload.modelPath = raw.step.zst` and `.remove()` the original raw `.step`
   from `temp-staging`. Only for OCCT/large formats; skip mesh/tiny + already-`.zst`.

4. **Keep the big-raw TTL prune** (`scheduled/cleanup.ts`) as the **failure**
   safety net — models whose optimise never succeeded never get compacted. Reword
   the comment to say so.

## Phase 2 — XBF (replaces STEP as retained artifact + planner input)

5. **occt-bridge** (`crates/occt-bridge/src/occt.{h,cc}`, `lib.rs`): factor the
   doc→`Tree` walk out of `read_step`; add cxx fns:
   - `step_to_xbf(step_path, xbf_path) -> bool` — `STEPCAFControl_Reader` → doc →
     `BinXCAFDrivers` document-storage write.
   - `read_xbf(xbf_path, lin, ang) -> Tree` — `BinXCAFDrivers` retrieve → same walk.
   build.rs already links all `TK*`; confirm `TKBinXCAF`/`TKBinL`/`TKBin` present in
   the OCCT build (add to allowlist if the toolkit scan filters them).

6. **converter** (`crates/converter`): `convert_xbf(path, lin, ang)` mirroring
   `convert_step`, calling `read_xbf`. Planner `build_tree` accepts an xbf path.

7. **assembler formats** (`formats.rs`): add `Format::Xbf` (loader `Occt`, `exact`,
   `structured`); sniff the BinXCAF header magic; extend `SUPPORTED`/`ALL`/`from_name`.
   `load_source` + convert route `Xbf → convert_xbf`.

8. **`compress` → `compact` (Phase-2 form)**: for OCCT sources produce `.xbf`
   (occt, whole-file — not streaming) then zstd → `.xbf.zst`. `model-optimize.ts`
   compact step requests xbf mode and sets `modelPath = raw.xbf.zst`. STEP fully
   retired from storage post-optimise; ASCII STEP only transient pre-optimise.

## Verify

- **Rust**: `cargo test -p optimize -p converter -p planner`; `cargo build -p assembler`.
  New tests: zstd roundtrip through `download_hashed`; `read_xbf` vs `read_step`
  `Tree` parity (nodeIds + geometryHash) on the shadow corpus (reuse the
  byte-parity harness from the geometry rewrite).
- **TS**: `turbo run typecheck --filter=@carbon/jobs --filter=erp`.
- **Manual**: upload STEP → optimise → raw replaced by `.xbf.zst`; viewer preview
  ok; "Generate Steps" (plan) runs off the compacted raw; reoptimise runs.

## Decisions (locked)

- **D1** standalone `compact` action (streaming download → xbf → zstd → streaming
  upload; no RAM buffer). Not folded into optimize.
- **D2** build Phase 1 + Phase 2 together, ship as one change. Retained artifact
  goes straight to `raw.xbf.zst` (no interim `.step.zst` shipped).
- **D3** hash decompressed bytes in `download_hashed` so the plan cache keys on
  geometry regardless of container.
