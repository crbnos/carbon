---
paths: []
triggers: []
promoted: null
---
# pdfjs rejects Node Buffer by constructor check

**Context:** `@carbon/files/pdf` and the shared image pipeline feed bytes from `fs.readFile` / `storage.download().arrayBuffer()` into pdfjs (via unpdf) and jSquash codecs.

**Problem:** pdfjs throws `Please provide binary data as 'Uint8Array', rather than 'Buffer'` — it checks the constructor, and Node's `Buffer` fails despite being a `Uint8Array` subclass. The failure only appears in Node (tests, jobs), never in the browser or Deno.

**Rule:** Normalize at the boundary: wrap as a plain view over the same memory — `new Uint8Array(data.buffer, data.byteOffset, data.byteLength)` — before handing bytes to a wasm codec or pdfjs. `@carbon/files` does this in its `toBytes` helpers; new entry points must too.

**Applies to:** `packages/files/src/pdf/pdf.ts`, `packages/files/src/media/image-pipeline.ts`, any future wasm codec wrapper.
