---
paths: []
triggers: []
promoted: null
---
# A supply figure that includes scrap cannot be written back as the order quantity

**Context:** Planning actions measure each open job against demand and suggest Decrease /
Increase. The job's supply came from `openProductionOrders.quantityToReceive`, which is
`productionQuantity − received`, and `productionQuantity` is the generated `quantity + scrapQuantity`.

**Problem:** Apply writes the suggested figure to `job.quantity`, the good units. A job of 80
with scrap 4 counted as 84 against a demand of 80: "Only 80 of 84 is required", every run, for
every job on an item with a scrap rate — and applying it changed nothing, so it came back.
An Increase was 4 too high the same way. No test covered a job with scrap.

**Rule:** Measure a document in the unit the action will WRITE. If the engine reads a derived
total (with scrap, with a conversion factor), either convert at the boundary or read the base
column. And when a write changes a base quantity, restate what rides on it (the scrap
allowance), as the insert path does — a patch that sets one column of a pair is the bug class
`.claude/rules/supersession-system.md` describes for `itemScrapPercentage`.

**Applies to:** `generatePlanningActions` (`packages/planning/src/mrp/planning-actions.ts`),
`updatePlanningJob` (`production.service.ts`), any engine that reads `openProductionOrders`
or `openPurchaseOrderLines` and writes a document quantity back.
