# optimize (crate)

Mesh optimiser for the assembler: parse a glTF/GLB, run meshopt per mesh (weld →
reorder → optional simplify ladder), optionally merge same-material primitives
and quantize normals, then re-encode as plain glTF, `EXT_meshopt_compression`, or
`KHR_draco_mesh_compression`. Codec-agnostic core behind one entry point. Consumed
by `apps/assembler`'s `/v1/optimize` action; the output GLB is rendered by
`@carbon/viewer` (`useAssembly` → three.js `GLTFLoader` + `MeshoptDecoder`).

Geometry-only focus: mesh `POSITION` / `NORMAL` / `TEXCOORD_0` + indices. Non-mesh
bufferViews (images, etc.) are copied through untouched.

## Public API (`src/lib.rs`)

- `optimize_glb(glb_bytes, &Options) -> Result<Optimized, OptimizeError>` — GLB in,
  optimised GLB out. Binary-GLB entry point.
- `gltf_to_glb(gltf, &mut impl Write) -> Result<(), OptimizeError>` — repack a text
  `.gltf` whose single buffer is an embedded base64 `data:` URI (the Onshape export
  shape) into a binary `.glb`, **streaming** the base64 decode (`struson`
  `next_string_reader` + `base64::read::DecoderReader`) so a multi-GB buffer never
  materialises. Callers mmap the `.glb` and use `optimize_glb`. (Replaced
  `optimize_gltf`, whose serde parse held the base64 string + decoded bytes at once
  ≈ 3× the file.) External `.bin` and multi-buffer glTF are rejected.
- `optimize_root(root, bin, input_bytes, &Options) -> …` — lowest level; the two
  above wrap it. Use when you already hold a parsed `json::Root` + BIN slice
  (lets the caller mmap/stream the source — see `examples/optimize_file.rs`).
- `Optimized { glb: Vec<u8>, stats: Stats }`; `Stats` carries in/out vertex &
  triangle counts, byte sizes, `decoded_bytes` (meshopt fallback footprint), and
  `warnings` (e.g. dropped degenerate primitives).
- `OptimizeError { message }`.
- `Codec` (from `src/codec.rs`): `None` | `Meshopt` | `Draco`; `Codec::from_str_opt`.

### `Options`

`codec`, `simplify: Option<f32>` (explicit target ratio), `tolerance: Option<f32>`
(absolute mm, via `simplify_scale`), `auto_error: Option<f32>` (normalized budget,
`DEFAULT_AUTO_ERROR = 0.005`), `simplify_aggressive`, `draco_bits: (pos, norm, uv)`,
`quantize_normals`, `merge_primitives`, `weld`, `reorder`. `Options::default()` =
meshopt off/lossless-ish defaults; the assembler action sets its own.

## Invariants — do not break

- **meshopt vertex stride must be a multiple of 4.** i16 VEC3 normals are 6 bytes,
  which the spec JS `MeshoptDecoder` rejects (`Malformed buffer data: -2`) even
  though the Rust decoder round-trips them. `ViewData::Attr3i16` therefore stores
  `[i16; 4]` (stride 8, 4th lane `0`); the accessor stays VEC3. Any new quantized
  attribute must keep its stride `% 4 == 0`. Guarded by
  `quantized_normals_keep_meshopt_stride_multiple_of_four`.
- **Drop degenerate primitives, don't feed them to meshopt.** `is_encodable`
  requires non-empty verts, `indices.len() >= 3 && % 3 == 0`, and every index in
  range; skipping this segfaults `meshopt::encode_*` on real models. Dropped
  primitives are counted in `Stats::warnings`.
- **Set extension records on the typed `json` structs** (the gltf `extensions`
  feature: `bufferView.extensions.others`) — never round-trip the whole document
  through `serde_json::Value` (that path cost ~1.65 GB on a 27 M-tri model).

## Validation

```bash
cargo test -p optimize                     # unit + codec + stride regression
cargo run --release --example optimize_file -- <path.glb|.gltf> [none|meshopt|draco]
```

The example mmaps the source, streams the base64 decode, and writes
`/tmp/optimized-<codec>.glb` — use it to check real files, then verify the output
loads in a spec JS decoder (three.js `GLTFLoader.setMeshoptDecoder`), not just
that it reparses in Rust.

## Cross-references

- `apps/assembler` — the `/v1/optimize` action + service contract (`AGENTS.md`).
- `crates/draco-bridge` — cxx bridge to static Google Draco (the `Draco` codec).
- `packages/viewer` — `useAssembly` loads these GLBs with `MeshoptDecoder`.
- `.ai/lessons.md` — the meshopt-stride pitfall in full.
