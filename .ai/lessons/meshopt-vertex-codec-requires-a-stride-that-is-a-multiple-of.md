---
paths: ["crates/optimize/src/lib.rs", "crates/optimize/src/codec.rs", "packages/viewer/src/useAssembly.ts"]
triggers: ["byteStride", "EXT_meshopt_compression", "MeshoptDecoder", "ViewData"]
promoted: null
---
# meshopt vertex codec requires a stride that is a multiple of 4 — i16 VEC3 normals break it

**Context:** `crates/optimize` quantizes normals to i16 (SHORT, normalized) to shrink the optimised GLB, encoding each attribute as its own `EXT_meshopt_compression` vertex buffer. An i16 VEC3 normal is 6 bytes, so the normal view was emitted with `byteStride: 6`. The GLB reparsed and round-tripped fine through the Rust `meshopt` decoder, and all crate tests passed.

**Problem:** `meshopt_encodeVertexBuffer`/`decodeVertexBuffer` require the vertex size be a **multiple of 4** (`assert(vertex_size % 4 == 0)`); the Rust binding doesn't assert in release, so it emitted a 6-byte-stride stream that only its own decoder round-trips. The spec-compliant JS `MeshoptDecoder` (three.js / `three-stdlib`) rejects it with `Malformed buffer data: -2`, so the viewer showed a black screen — and because the failure is inside the decoder, no obvious app-level error surfaced. Positions (stride 12) and indices were fine; only the 6-byte normal stream broke.

**Rule:** Any attribute encoded as a meshopt vertex buffer must have a stride divisible by 4. Pad i16 VEC3 normals to i16 VEC4 (8 bytes, 4th lane `0`) — the accessor stays VEC3 (reads x,y,z; the 8-byte stride skips the pad) and the constant pad lane compresses to ~nothing. Never trust "reparses + Rust-decoder round-trips" as proof a meshopt GLB is valid; validate against the spec JS decoder (`GLTFLoader.setMeshoptDecoder`). The regression test `quantized_normals_keep_meshopt_stride_multiple_of_four` asserts every `ATTRIBUTES` view stride is `% 4 == 0`.

**Applies to:** `crates/optimize/src/lib.rs` (`ViewData`, the meshopt assemble path); any new quantized attribute type added to the optimiser; the `@carbon/viewer` `useAssembly` loader that consumes these GLBs.
