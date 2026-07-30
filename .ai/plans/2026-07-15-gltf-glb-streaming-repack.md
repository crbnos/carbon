# Plan: Streaming glTF→GLB repack (bounded-memory optimize for large text glTF)

Date: 2026-07-15
Area: `apps/assembler`, `crates/optimize` (Rust)
Owner: assembler CAD pipeline

## Problem

A multi-GB **text `.gltf`** (Onshape export shape: single buffer as a base64
data URI) OOMs / spikes the assembler during optimise. The 1.73 GB upload now
downloads fine (internal-URL fix + source-size limit disabled), but the parse is
not bounded.

## Root cause (verified)

`crates/optimize/src/lib.rs::optimize_gltf` (L155):

```rust
let mut root: json::Root = serde_json::from_slice(gltf_bytes)   // materialises the
    ...                                                          // ~1.73 GB base64 String
let bin = base64::...STANDARD.decode(&uri.as_bytes()[comma+1..]) // + ~1.3 GB decoded Vec
```

serde owns the entire base64 data-URI as a `String`, then base64-decode allocates
the geometry `Vec` — both live at once → **~3 GB peak** (the code comments on the
"~1.3x base64 string").

By contrast `optimize_glb` (L141) is **already bounded**: `Glb::from_slice` over
the mmap gives `bin` as a **`&[u8]` slice into the mmap** — geometry stays on disk,
never heaps. The assembler already mmaps glTF/GLB sources
(`apps/assembler/src/actions/optimize.rs::load_source`, L294-300).

## Design

**Repack text `.gltf` → `.glb` with a streaming base64 decode, then reuse the
already-bounded GLB path.** No general JSON-in-RAM parse; the only large field
(the buffer's base64 URI) is streamed byte→byte into the GLB BIN chunk on disk.

Two-pass over the mmap'd source (file-backed, second pass is page-cache-cheap):

- **Pass 1** — walk the JSON with `struson`, copying every top-level member
  **verbatim** via `JsonReader::transfer_to(writer)` **except** `buffers`, which is
  rebuilt dropping each buffer's `uri` (GLB embeds the buffer, so it carries no
  URI). Output: a small in-RAM GLB-ready JSON `Vec` + the buffer's `byteLength`.
  Everything transferred is small (accessors/bufferViews/meshes/…); the base64 is
  never materialised.
- **Assemble** — write the GLB header + JSON chunk to `out`, then the BIN chunk
  header. JSON size and `byteLength` are both known after Pass 1, so `out` needs no
  seek (write-only).
- **Pass 2** — walk again to `buffers[0].uri`, take `JsonReader::next_string_reader`
  (streams the string, never buffers it), consume the `data:…;base64,` prefix up to
  the first `,`, wrap the remainder in `base64::read::DecoderReader` (decodes on
  read), and `io::copy` it into `out` (the BIN payload). Pad to 4 bytes with `0x00`.

Peak memory = small structural JSON + the optimiser's own working set. The 1.3 GB
geometry lives on disk in the temp `.glb`, mmap'd, and `optimize_glb` reads it as a
borrowed slice — never heaped.

### Why struson + base64 DecoderReader

- `struson::reader::JsonReader::next_string_reader() -> impl Read` — streams a
  string value without materialising it (the crux). Also `transfer_to(writer)`
  (copy small values verbatim), forward walk (`begin_object`/`next_name`/`has_next`/
  `end_object`, `begin_array`/`end_array`), `skip_value`. `JsonStreamReader::new(R:
  Read)` over `Cursor(&mmap)`. `JsonStreamWriter` for the rewritten JSON.
- `base64::read::DecoderReader` (base64 0.22, already a dep) — `Read` adapter that
  base64-decodes incrementally. `io::copy(decoder, out)` streams, bounded.

### GLB container format (write correctly)

- Header (12 B): `b"glTF"` + `2u32_le` (version) + `total_len u32_le`.
- Chunk: `chunkLen u32_le` + `chunkType(4)` + `chunkData[chunkLen]`. `chunkLen`
  **includes** trailing padding; data is 4-byte aligned.
- JSON chunk: type `b"JSON"`, pad with `0x20` (spaces).
- BIN chunk: type `b"BIN\0"` (`[0x42,0x49,0x4E,0x00]`), pad with `0x00`.
- `total_len = 12 + 8 + json_padded + 8 + bin_padded`.
- `bufferView.byteOffset` are buffer-relative → unchanged (decoded bytes are
  byte-identical to the original buffer); offsets stay valid.

## Tasks

### 1. Dependencies
- [ ] `crates/optimize/Cargo.toml` — add `struson = "0.6"`.
- [ ] `apps/assembler/Cargo.toml` — add `tempfile = "3"` (temp `.glb` to mmap).
      (Confirm the source-download temp path can't be reused for the repacked glb;
      it holds the raw `.gltf`. A sibling temp is needed.)

### 2. `crates/optimize/src/lib.rs` — `gltf_to_glb`
- [ ] Add `pub fn gltf_to_glb(gltf: &[u8], out: &mut impl std::io::Write) -> Result<(), OptimizeError>`.
- [ ] Pass 1: `JsonStreamReader::new(Cursor::new(gltf))` + `JsonStreamWriter` into a
      `Vec<u8>`. Walk the root object:
  - member `"buffers"` → `begin_array`; for each buffer object copy every field via
    `writer.name(n)? + reader.transfer_to(writer)?` **except** `"uri"` (call
    `reader.skip_value()` / consume it — do NOT transfer). Capture `byteLength` of
    buffer 0.
  - any other member → `writer.name(n)? + reader.transfer_to(writer)?`.
  - Guards (fail loud): exactly one buffer; buffer 0 has a `uri` starting `data:`
    with `;base64,`. External `.bin` (uri not `data:`) or >1 buffer → `OptimizeError`
    ("external .bin unsupported" / "multi-buffer glTF unsupported").
- [ ] Compute `json_padded` (pad to 4 with `0x20`), `bin_len = byteLength`,
      `bin_padded` (pad to 4 with `0x00`), `total`.
- [ ] Write header + JSON chunk (bytes + space pad) + BIN chunk header to `out`.
- [ ] Pass 2: fresh `JsonStreamReader` over `gltf`; navigate root→`buffers`→array→
      buffer 0→`"uri"`; `next_string_reader()`; read bytes until first `,`
      (prefix); wrap the rest in `base64::read::DecoderReader::new(reader,
      &base64::engine::general_purpose::STANDARD)`; `let n = io::copy(&mut dec,
      out)?`; assert `n == byteLength` (else `OptimizeError` — never emit a corrupt
      GLB); write `bin_padded - bin_len` zero bytes.
- [ ] Small navigation helper to reach `buffers[0].uri` (skip other members with
      `skip_name`/`skip_value`).

### 3. `crates/optimize/src/lib.rs` — retire `optimize_gltf`
- [ ] Remove `optimize_gltf` (superseded — all glTF now repacked to GLB upstream of
      the optimiser). Remove/repoint any test that called it.

### 4. `apps/assembler/src/actions/optimize.rs` — wire the repack
- [ ] Split the `Format::Glb | Format::Gltf` arm of `load_source`:
  - `Format::Glb` → mmap the source directly (unchanged).
  - `Format::Gltf` → mmap the `.gltf`; create a sibling temp `.glb`
    (`tempfile::NamedTempFile`); `optimize::gltf_to_glb(&gltf_mmap, &mut
    BufWriter::new(&mut tmp))`; flush; mmap the temp `.glb`; return it.
- [ ] `Src` must keep the temp file alive for the mmap's lifetime. Add a variant
      (e.g. `Src::MappedTemp(memmap2::Mmap, tempfile::TempPath)`) or hold the
      `TempPath` beside the `Mmap`; update `Src::bytes()`.
- [ ] `run_optimize`: every `Src` is now GLB (STEP→`build_triangle_glb`,
      STL→`stl_to_glb`, GLB→mmap, glTF→repacked). Drop the `is_glb ? optimize_glb :
      optimize_gltf` branch → always `optimize::optimize_glb`. Remove the `is_glb`
      probe (or keep as a debug assert).
- [ ] Update the module doc (L3): "mmapping a GLB (text glTF is repacked to GLB via
      a streaming base64 decode first)".

### 5. Tests
- [ ] `crates/optimize` unit test `gltf_to_glb_repacks_embedded_base64`: build a
      tiny `.gltf` (one triangle, buffer as base64 data URI) → `gltf_to_glb` → output
      starts `b"glTF"`, is a valid GLB, and `optimize_glb` on it succeeds with the
      mesh intact (positions round-trip).
- [ ] `crates/optimize` test `gltf_to_glb_rejects_external_bin` (uri not `data:` →
      `OptimizeError`).
- [ ] Existing assembler format/loader tests still pass (STEP/STL/GLB unaffected).

### 6. Docs
- [ ] `crates/optimize/AGENTS.md` — note glTF is repacked to GLB (streaming base64)
      before optimise; `optimize_gltf` removed, `gltf_to_glb` added.
- [ ] `apps/assembler/AGENTS.md` — update the load path description if it mentions
      glTF handling.
- [ ] `.ai/lessons.md` — add: "large text glTF base64 buffers must be streamed
      (struson `next_string_reader` + base64 `DecoderReader`), not serde-materialised
      — a multi-GB data URI is ~3 GB peak otherwise."

### 7. Verify + roll out
- [ ] `cargo test -p optimize` (new + existing green).
- [ ] `cargo build --release -p assembler`.
- [ ] Restart the assembler (it runs `cargo run --release -p assembler`; recompiles
      on next spawn — user restarts, not me).
- [ ] Re-fire optimise on the 1.73 GB `.gltf` (viewer Retry / the model-optimize
      event) → assembler RSS stays bounded (structural JSON + optimiser working set,
      not ~3 GB), job → `Success`, GLB renders.

## Notes / edge cases

- Single embedded buffer only (the Onshape/GLB shape). External `.bin` and
  multi-buffer glTF are explicitly rejected (they already were).
- Data-URI media type varies (`application/octet-stream`, `gltf-buffer`, or empty) —
  key on the first `,`, not the media type.
- `byteLength` mismatch vs decoded byte count → hard error (fail loud; never store a
  corrupt GLB). Aligns with the "verify + fail loud, no pray-it-works" rule.
- Two mmaps briefly (source `.gltf` + temp `.glb`) — both file-backed, off RSS.
- The disabled source-size limit (`ASSEMBLER_MAX_SOURCE_MB` default 0) stays; this
  removes the reason it OOMs, not the cap.
- The temp `.glb` roughly doubles transient disk (raw gltf + repacked glb). Cleaned
  when `Src`/`TempPath` drops.

## Out of scope

- Having the exporter/browser emit GLB directly (would remove the repack entirely) —
  separate upstream change; this keeps `.gltf` uploads working regardless.
- Bounding the optimiser's own per-primitive working set (a separate concern from
  the base64 parse).
```
