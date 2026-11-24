---
paths: []
triggers: []
promoted: null
---
# Aging report previews need seeded open documents

**Context:** Sharing a local AR/AP aging UI preview.

**Problem:** The dev server rendered the reports, but the default test company had no sales or purchase invoices, so both reports appeared empty. The dataset seed then failed on `inspectionDocument.drawingNumber`: the local database carried a newer schema from `main` than the branch's own code.

**Rule:** Check the report RPCs for open rows before handing off a preview. Seed an isolated company when the current test company contains unrelated records, and verify both report counts after seeding. When a seed fails on a column, compare the branch's generated types with the local database before editing the dataset: merge `main` (or migrate a clean database) rather than changing the tier.

**Applies to:** Local aging report previews and `packages/database/src/datasets/`.
