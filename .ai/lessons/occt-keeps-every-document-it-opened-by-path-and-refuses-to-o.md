---
paths: []
triggers: []
promoted: null
---
# OCCT keeps every document it opened by path, and refuses to open it again

**Context:** The optimize ingest gained a PMI pass (`read_pmi`, `crates/occt-bridge/src/pmi.cc`) that reads the same `.xbf` the optimiser had just tessellated with `read_xbf` (2026-10-26).

**Problem:** `TDocStd_Application::Open(path, doc)` registers the document with the application until `Close(doc)`. `read_xbf` never closes it, so the second open of the same path failed with `PCDM_RS_AlreadyRetrieved` ("could not open XBF document"). The hermetic converter test passed, because it opened the `.xbf` only once; only the assembler's ingest test, which runs both passes, showed it.

**Rule:** A second reader of an `.xbf` opens it from a stream (`Open(std::istream&, doc)`), which skips the path check, and calls `xcaf_app()->Close(doc)` when done. Test any new pass over the ingest's xbf through `run_ingest`, not only through the converter.

**Applies to:** `crates/occt-bridge/src/*.cc` (any function that opens a BinXCAF document), `apps/assembler/src/actions/optimize.rs` (`run_ingest`).
