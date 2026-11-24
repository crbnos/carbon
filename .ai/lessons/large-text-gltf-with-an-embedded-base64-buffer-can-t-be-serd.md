---
paths: ["crates/optimize/src/lib.rs", "apps/assembler/src/actions/optimize.rs"]
triggers: ["gltf_to_glb", "DecoderReader", "serde_json::from_slice"]
promoted: null
---
# Large text `.gltf` with an embedded base64 buffer can't be serde-parsed bounded — stream it into a GLB

**Context:** The assembler optimises uploaded models. Text `.gltf` (the Onshape export shape) carries its single geometry buffer as a base64 `data:` URI. `optimize_gltf` did `serde_json::from_slice(gltf_bytes)` then base64-decoded the URI. GLB (`optimize_glb`) was already bounded — its BIN chunk is a `&[u8]` slice into the mmap.

**Problem:** For a 1.73 GB `.gltf`, serde materialises the base64 as an owned ~1.73 GB `String`, then base64-decode allocates ~1.3 GB more — both live at once → ~3 GB peak. mmap doesn't help because serde copies the string out of the mapped bytes. The assembler failed with "source file exceeds the size limit" (a separate cap) and, once that was lifted, was on track to OOM on parse.

**Rule:** Don't serde-parse a glTF whose buffer is a giant base64 data URI. Repack `.gltf` → `.glb` first with a **streaming** base64 decode: walk the JSON with `struson` (`transfer_to` copies the small structural fields verbatim, dropping the buffer's `uri`), then `next_string_reader()` the base64 value through `base64::read::DecoderReader` straight into the GLB BIN chunk on disk. Then mmap the `.glb` and use the already-bounded `optimize_glb` path — geometry never heaps. Verify decoded length == the buffer's declared `byteLength` (fail loud, never emit a corrupt GLB). `crates/optimize::gltf_to_glb` + `apps/assembler` `load_source` (`Format::Gltf` → repacked temp `.glb` → `Src::MappedTemp`).

**Applies to:** `crates/optimize/src/lib.rs` (`gltf_to_glb`; `optimize_gltf` was removed), `apps/assembler/src/actions/optimize.rs` (`load_source`, `run_optimize` — every source is GLB now); any new large-text-JSON asset with an embedded base64 blob.
