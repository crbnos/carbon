---
paths: ["apps/erp/app/modules/inventory/supersession-pick.ts", "packages/planning/src/mrp/mrp.ts"]
triggers: ["substitutedFromItemId", "redirectedFromItemId", "generatePickingList", "get_picking_schedule"]
promoted: null
---
# A creation-time swap must be keyed by its provenance column at every later lookup

**Context:** Supersession swaps a `jobMaterial` to its successor when the job is created (`substitutedFromItemId` records the predecessor). Picking then looked up `itemSupersession` by `jobMaterial.itemId` — which is now the successor, which has no row — so `resolvePickTarget` returned "pick the item unchanged" and `Consume First` never consumed the predecessor's stock. The picking-side branch was dead code for every job created after the effectivity date, and the unit tests (which passed a material still on the predecessor) could not see it.

**Problem:** The rule lives on the OLD item; the row already names the NEW one. Any later stage that re-reads the rule by the row's current item silently finds nothing, and "no rule" is a valid, quiet outcome.

**Rule:** When a row is rewritten by a rule and carries a provenance column (`substitutedFromItemId`, `redirectedFromItemId`, …), every downstream lookup of that rule must key on `COALESCE(provenance, current)`, in BOTH the TS and SQL mirrors. Test the swapped shape explicitly — a fixture that stops at "rule set, nothing swapped yet" proves nothing about what happens after the swap.

**Applies to:** `apps/erp/app/modules/inventory/supersession-pick.ts` / `generatePickingList`, `get_picking_schedule`, `packages/ee/src/planning/mrp/mrp.ts` (redirected BOM children), any consumer of `jobMaterial.substitutedFromItemId`.
