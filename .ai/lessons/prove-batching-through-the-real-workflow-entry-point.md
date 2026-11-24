---
paths: []
triggers: []
promoted: null
---
# Prove batching through the real workflow entry point

**Context:** The accounting charge supplier lookup was consolidated into one joined batch loader, but the new lifecycle's `pushBatchToAccounting` still called the single-item push for every charge.

**Problem:** A test of `fetchLocalBatch` alone passed while the real QBO batch made four card-source reads for two rows; re-entering the parent single-item workflow also fetched mapped rows again.

**Rule:** Assert query counts through the public multi-item entry point, not only its loader. Load source rows and tenant/provider-scoped mappings once, pass those snapshots into the shared per-item lifecycle, and persist each remote success before advancing. Cover mixed creates, updates, voids, missing rows, and failures to prove batching preserves durability and error isolation.

**Applies to:** accounting sync batches and any workflow refactor that combines per-item remote effects with batched local reads.
