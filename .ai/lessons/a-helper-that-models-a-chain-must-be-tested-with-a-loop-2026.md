---
paths: ["apps/erp/app/modules/inventory/supersession-pick.ts", "packages/database/src/supersession-pick.ts"]
triggers: ["buildConsumeFirstHops", "successorItemId", "parentMaterialId"]
promoted: null
---
# A helper that models a chain must be tested with a loop (2026-09-16)

- **Context:** `buildConsumeFirstHops` walked one Consume First hop at a time
  and guarded against loops only while collapsing through non-Consume-First
  hops. A two-item Consume First loop passed straight through, and in the
  engine both items would sit on one cycle level and hand demand to an item
  already planned — silently lost.
- **Problem:** the guard was written for the path being walked, not for the
  property that matters ("does this chain terminate?"), and the first test
  I wrote for it was the one that caught it.
- **Rule:** any function that follows successor / parent / next pointers
  gets a cycle test of the smallest loop (two nodes) before anything else,
  and the guard checks termination of the WHOLE chain, not just the part the
  function happens to traverse.
- **Applies to:** `lib/supersession-pick.ts` chain builders, BOM walkers,
  anything keyed on `successorItemId` or `parentMaterialId`.
