# Assembler Model Pipeline — formats, optimize gates, storage, viewer

> Status: design (open questions resolved 2026-07-15)
> Author: Claude (with Sid Rathi)
> Date: 2026-07-15
> Related: PR #1092 (Onshape asset sync — to consolidate), `.ai/rules/workflow-edge-function.md`

## TLDR

The assembler (`apps/assembler`, `crates/*`) is the single home for CAD →
web-viewable-model work. This spec locks its shape: an action-RPC `/v1` API with
an **explicit format registry** + **content auto-detection** (`format: "auto"`
via the `file-format` crate), a **hard size gate** on optimize output (simplify
ladder until it fits the bucket, `cannot_fit_budget` if it can't), **snake_case**
JSON in and out, a **staging + served bucket** storage model that respects a
**50 MB served-bucket cap**, three artifact tiers (poster / preview / assembly),
and a **performance-over-quality** default policy. Onshape PR #1092's Node
gltfpack+Draco compressor is retired in favor of this optimizer.

Carbon is a **viewer + animator**, not a CAM/inspection tool — precision lives in
the CAD system. So aggressive lossy optimization is the correct default; the only
things we must preserve are **assembly structure** (per-part `nodeId`s, for
animation) and **silhouette at screen resolution**.

## Current state (grounded)

- **Optimizer** — `crates/optimize` (`optimize_glb`/`optimize_gltf`/`optimize_root`,
  `Options`, `Codec` = None|Meshopt|Draco). meshopt weld/reorder/simplify + merge
  same-material primitives + i16-normal quant; Draco via `crates/draco-bridge`.
- **Tessellation / structure** — `crates/converter` (`convert::convert_step`) via
  `crates/occt-bridge` (OCCT). Produces the **structured** GLB + `graph.json`
  (nodeIds, unit, hierarchy) for the assembly viewer.
- **Assembler actions** — `apps/assembler/src/actions/{convert,optimize,plan}.rs`.
  `convert.rs:84` already has an `optimize_glb()` hook that runs
  `optimize::optimize_glb` on the converted GLB when the `optimize` flag is set —
  **this is where the structure-preserving "assembly tier" plugs in.**
- **Format support today (implicit)** — `run_optimize` (`optimize.rs`) matches only
  `step|stp` (OCCT tessellate) / `glb|gltf` (mmap); everything else →
  `Err("unsupported format")`. Client `optimizableModelFormat` (`packages/utils`)
  mirrors it by hand. Upload (`supportedModelTypes`) accepts **18** formats but
  only **4** ever optimize — the gap this spec closes.
- **Wire format today** — camelCase (`json!` responses in `convert.rs`/`plan.rs`/
  `optimize.rs`: `componentCount`, `outputBytes`, `simplifyRatioUsed`, …).
  Request structs default to snake. **Inconsistent** → standardize on snake_case.
- **Jobs** — `packages/jobs/.../tasks/{assembly-convert,assembly-plan,model-optimize}.ts`
  + shared `assembler-client.ts`. `model-optimize` triggered on every attach point
  (upload, part/new, quote/rfq drag); derives format from the stored file; skips
  non-mesh.
- **Storage today** — one `private` bucket. Dev `FILE_SIZE_LIMIT` was 50 MiB (413'd
  CAD uploads); raised in `docker-compose.dev.yml` / `config.toml`. **Prod bucket
  cap is 50 MB** (the real constraint this spec designs around).

## Design

### Roles (what we keep vs derive)

- **STEP / structured source** = kept, but **not** as a fidelity master — for
  (a) re-deriving artifacts later, (b) users **downloading their original CAD
  file** (a real ERP need). Precision is the CAD system's job.
- **glTF / GLB** = the derived viewer format (triangulated, lossy, one-way).

### Formats — explicit registry + auto-detect

Single source of truth in the assembler; surfaced via `GET /v1`; the client reads
it instead of hand-maintaining lists.

| Format | loader | exact | structured | `/optimize` | `/convert` |
|---|---|---|---|---|---|
| step, stp | occt | ✓ | ✓ | ✓ | ✓ |
| iges, brep | occt | ✓ | ✓ (iges weaker) | ✓ | ✓ |
| glb, gltf | mesh | — | ✓ (scene graph) | ✓ | ✓ (extract graph) |
| obj | mesh | — | partial (groups) | ✓ | ⚠️ shallow |
| stl, ply, off | mesh | — | ✗ | ✓ | ✗ `no_structure` |

- **Easy adds (mesh loaders, no OCCT):** STL first, then OBJ/PLY/OFF → parse →
  build glTF → existing optimize.
- **Auto-detect** — `format: "auto"` (or omit): **`file-format` crate** for
  magic/content, plus our supplements: `.gltf` JSON check, binary-STL size formula
  (`84 + N*50` — check *before* the ASCII `"solid"` prefix), extension fallback.
  Sniff-verify even when a format is declared. Unknown → `ambiguous_format` /
  `unsupported_format` (fail loud, never guess into OCCT).

### Quality policy — performance first

Defaults aggressive; the bar is "reads right on screen + animates smoothly."

- **Target small, not the cap** — aim ~2–10 MB per preview; 50 MB is the safety
  net, not the goal.
- Coarse tessellation (high linear/angular deflection), **defeature** small
  features (fillets/holes/chamfers/threads), per-part LOD (tiny→primitive).
- **meshopt** default codec (GPU-fast decode) + zstd transport; **draco** only when
  bandwidth-bound. Never stack the two (mutually exclusive per primitive).
- **Preserve only:** per-part `nodeId`s (animation) + silhouette. Geometry
  precision is expendable.
- Optional per-model `high_fidelity` opt-in for hero parts.

### The size gate (the core algorithm)

```
for rung in [full, 0.75, 0.5, 0.25, …]:
    cand = optimize(mesh, codec, simplify=rung)
    if cand.bytes <= max_bytes AND cand.render_weight <= max_render_weight_bytes:
        return cand, rung
return error("cannot_fit_budget")   # never store an over-cap blob
```

Two caps: **file size** (storage/transfer) **and** decoded **render weight**
(a small Draco file with a huge decoded mesh still hangs the viewer — #1092's
lesson). Record `simplify_ratio_used` and surface it.

### Artifact tiers (app orchestrates 3 focused actions)

| Tier | Producer | Notes |
|---|---|---|
| **Poster** | `model-thumbnail` | instant paint; Onshape's render feeds it |
| **Preview** | `/optimize` (meshopt, gated) | the 95% case; merges/flattens OK |
| **Assembly** | `/convert` (structure-preserving optimize) | per-node simplify, **no cross-node merge**, keeps `nodeId`s + graph — the `convert.rs:84` hook, made structure-preserving |

### Storage model

- **`served`** bucket — per-bucket cap **50 MB**: poster, preview, assembly GLB,
  graph. (Global `FILE_SIZE_LIMIT` stays high; `min(global, bucket)` enforces the
  cap on `served` only.)
- **`staging`** bucket — high limit, **TTL lifecycle** (orphan backstop): raw lands
  here via the normal resumable browser→storage upload; the job reads it via signed
  URL (no streaming through the assembler).
- **`cold`** (optional) — cheap tier for manual raws worth re-deriving.
- **Retention by provenance:** Onshape → source is Onshape, drop the raw (re-pull to
  re-derive). Manual → keep raw if ≤50 MB (fits `served`, convert always possible);
  else stage-and-drop (only genuinely-too-big models lose their lossless source).
- After dropping a raw, point `modelPath` at the optimized artifact (don't dangle).

### API (`/v1`, snake_case, `Authorization: Bearer`)

Envelope `{ ok, job }` | `{ ok: false, error }`; job `{ id, action, status,
result?, stats?, error? }`; status `queued|running|succeeded|failed|canceled`.
Headers: `Idempotency-Key`, `X-Carbon-Upload-Urls` (late-mint), `Accept-Encoding:
identity` bypasses zstd.

- `GET /health` → `{ ok, version }`
- `GET /v1` → discovery: `actions`, `input_formats` (loader/exact/structured),
  `codecs`, `limits` (`max_output_bytes`, `max_source_bytes`, …).
- `POST /v1/optimize` → `{ source:{url,format}, output:{path,codec,max_bytes,
  max_render_weight_bytes}, quality:{simplify,auto_error,tolerance_mm,
  quantize_normals,merge_primitives,weld,reorder} }` → 202 job. Result:
  `{ detected_format, detected_via, outputs:{glb:{path,bytes,codec}} }` + stats
  (`input/output_triangles`, `input/output_bytes`, `simplify_ratio_used`,
  `render_weight_bytes`, `warnings`).
- `POST /v1/convert` → `{ source, outputs:{glb,graph}, tessellation:{…},
  quality:{defeature_below_mm,unify_faces,per_part_simplify,max_bytes,…} }` →
  result `{ outputs:{glb,graph}, component_count, unit }`.
- `POST /v1/plan` → `{ source, graph_url, output }`.
- `GET /v1/jobs/{id}?wait=25` (long-poll), `POST /v1/jobs/{id}/cancel`,
  `POST /v1/cache/invalidate` (`{ model_upload_id }` | `{ source_hash }`).

**Error codes** (`error.code`): `unsupported_format`, `ambiguous_format`,
`no_structure`, `source_too_large`, `tessellation_failed`, `optimize_failed`,
`cannot_fit_budget`, `busy`, `invalid_input`, `not_found`, `unauthorized`.
`unsupported_format` includes `supported: [...]`.

### Onshape #1092 consolidation

- Onshape attach → `trigger("model-optimize")` (same as other attach points).
- **Delete** `onshape-compress-model.ts` + deps (`GLTFPACK_PATH` binary,
  `draco3dgltf`, `@gltf-transform/*`). One optimizer.
- Its Onshape-rendered thumbnail → the poster tier.
- Merge viewers: keep `ModelPreview` (progressive tiers + WASM fallback), adopt
  #1092's **explicit click-to-load** gate for large models.
- Conflict files to reconcile on merge: `CadModel.tsx`, `shared.service.ts`,
  `sales.service.ts`, `jobs/AGENTS.md`, the `$lineId.details.tsx` routes.

## Implementation slices

1. **Formats + auto-detect + STL + snake_case + gate** — registry enum + `file-format`
   sniff + STL mesh loader; add `max_bytes`/`max_render_weight_bytes` gate +
   simplify ladder + `cannot_fit_budget`; switch `json!` responses to snake_case +
   `#[serde(rename_all="snake_case")]` on request structs; update TS readers.
   Discovery lists it all. (First, highest value.)
2. **Storage split** — `served` @ 50 MB per-bucket + `staging` w/ TTL; job reads raw
   from `staging`; provenance field + retention rules; keep-raw-if-≤50 MB.
3. **Assembly tier** — make `convert.rs:84` optimize structure-preserving
   (per-node simplify, no cross-node merge) + defeature/unify/deflection knobs +
   the same gate.
4. **Viewer** — retire WASM-raw to last resort; poster + poll + meshopt tiers +
   click-to-load gate (partly done in `ModelPreview`).
5. **Onshape consolidation** — after #1092 lands (or rebase): swap its compressor
   for `model-optimize`, delete deps, merge viewers.
6. **IGES/BREP** — OCCT reader dispatch alongside `convert_step`.

## GLB-always roadmap (decided 2026-07-18, Sid)

**Doctrine: when the assembler is enabled, EVERY accepted upload format is
optimised into GLB and the viewer uses that artifact.** The browser WASM raw
tier stays exactly as built — the bridge for optimise-in-flight, assembler-off,
and job-failure states — but is never the steady state for any format. Each
format added server-side automatically demotes its WASM path to
first-seconds-preview: the trigger derives format from the stored file
(`optimizableModelFormat` widens in lockstep) and `model.reoptimize` backfills.

Accepted-format coverage to build, in cost order:

| Phase | Formats | Status |
|---|---|---|
| **F1** ✅ 2026-07-18 | iges, brep (OCCT readers, shared `doc_to_tree` walk) + obj, ply, off, bim (parsers → `build_triangle_glb`, `crates/optimize/src/ingest.rs`) | implemented; IGES/BREP runtime proof at staging (no hermetic fixtures) |
| **F2** ✅ 2026-07-18 | 3mf (zip + build/components + 4x3 transforms), amf (XML, zip-unwrapped; constellations not applied) | implemented (zip 8 + quick-xml deps) |
| **F3 (on demand)** | fbx, dae, 3ds, 3dm | each needs a real import dep (assimp binding / opennurbs) — only on customer evidence |

ifc/fcstd stay out (dropped from the accept list 2026-07-18).

## Open / deferred

- Content-addressed dedup by `geometry_hash` (share artifacts across item revisions)
  — noted, not scoped here.
- Surfacing optimized size in **doc-list tables** (needs summary-view recreation) —
  viewer badge is done; tables deferred.

## Changelog

- 2026-07-15 — spec written; decisions resolved in design thread.
- 2026-07-15 — **slice 1 core implemented** (assembler + optimize crate):
  - `crates/optimize::stl_to_glb` — binary + ASCII STL ingest → weldable GLB (2 tests).
  - `apps/assembler/src/formats.rs` — explicit `Format` registry + `file-format`-backed
    content auto-detect with supplements (gltf-JSON, binary-STL size formula, ext
    fallback) + `resolve(auto|declared)` → typed `unsupported_format`/`ambiguous_format`
    (4 tests).
  - `optimize` action: format resolve + STL load + typed errors + **`cannot_fit_budget`**
    (fails instead of storing an over-cap blob) + `detected_format`/`detected_via`;
    request reshaped to `output`/`quality`, **snake_case** request + response; default
    aggressive simplify ladder `[none,0.5,0.25,0.1]` + 50 MiB output / 400 MiB
    render-weight default gates.
  - `GET /v1` discovery: `input_formats` (loader/exact/structured) + `codecs` + snake_case
    `limits` (incl. `max_output_bytes`, `max_render_weight_bytes`).
  - HTTP error codes → snake_case (`invalid_input`/`unauthorized`/`not_found`).
  - TS: `optimizableModelFormat` accepts `stl`; `model-optimize` sends `output.path`.
  - **Remaining in slice 1** (deferred — orthogonal, needs a live convert test):
    `convert`/`plan` action responses + request keys still camelCase (`componentCount`,
    `linearDeflection`, `contentHash`, `planPath`, `pathSamples`, `nodeIds`) and their TS
    readers (`assembly-convert.ts`/`assembly-plan.ts`) + `cache/invalidate`
    (`modelUploadId` → `model_upload_id`). IGES/BREP/OBJ/PLY/OFF are detected + advertised
    but their loaders error `unsupported_format` until slice 6 / mesh-loader follow-ups.
- 2026-07-15 — **slice 2 foundation**: `temp-staging` storage bucket created
  (`20260715150742_temp-staging-bucket.sql`) — high size limit (inherits the global
  cap), private, company-scoped RLS mirroring the `private` model policies. `private`
  is intentionally NOT yet capped to 50 MB (the lossless assembly-convert GLB exceeds
  it for big assemblies until the slice-3 structure-preserving tier gates it).
  **Remaining in slice 2**: route raw uploads to `temp-staging` (CadModel/PartForm/
  drag + `model.upload`); job reads raw from `temp-staging`, writes the artifact to
  `private`, drops the staged raw (keep-raw-if-≤50 MB in `private`); `provenance`
  column + retention rules; scheduled TTL cleanup of staged orphans.
