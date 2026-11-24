---
paths: ["packages/planning/src/mrp/bom-children.ts", "packages/planning/src/mrp/mrp.ts"]
triggers: ["bomChildren", "methodCorrectionId", "WITH RECURSIVE"]
promoted: null
---
# A copy of an engine's rule reads the engine first

**Context:** The sales order delivery date check walks the bill of materials with its own SQL to add up the cumulative lead time.

**Problem:** MRP's explosion (`bomChildren`, `packages/planning/src/mrp/bom-children.ts`, and the `methodCorrectionId IS NULL` filter in `mrp.ts`) leaves out quantity-0 lines and correction materials. The copy did not. A configured item's other configurations, which sit at quantity 0, added their lead time: one test item went from 67 days to 407.

**Rule:** Before you write a calculation that another engine already does (BOM explosion, stock netting, supply and due dates), read that engine and apply the same filters. Name the engine in a comment beside the copy, so the two stay in step.

**Applies to:** Order promising, quote lead time, and any read outside MRP that walks a BOM or nets stock.
