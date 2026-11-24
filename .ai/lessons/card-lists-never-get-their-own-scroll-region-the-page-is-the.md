---
paths: ["apps/erp/app/modules/items/ui/**/BillOf*.tsx", "apps/erp/app/modules/**/JobBillOf*.tsx", "apps/erp/app/modules/**/QuoteBillOf*.tsx"]
triggers: ["ScrollArea", "max-h-[60dvh]"]
promoted: null
---
# Card lists never get their own scroll region — the page is the only scroll surface

**Context:** The Bill of Material / Bill of Process cards were capped at `max-h-[60dvh]` with an internal ScrollArea (PR #1230) so long lists wouldn't grow the page unbounded. Brad asked for the scrollbars to be removed; hiding the bar but keeping the capped region was the wrong reading.

**Problem:** A nested scroll region doesn't reduce scrolling — the same rows still have to be scrolled through — it just hijacks the wheel whenever the cursor crosses the card, so the user gets two scroll surfaces, scroll-trapping at the region's edges, and a janky feel. "Remove the scroll bars" meant remove the *scrolling*, not restyle the bar.

**Rule:** Card lists (BoM, BoP, and anything similar) render at natural height; the page-level container is the only scroll surface. Don't add `max-h` + `overflow-y-auto` to a card's content to tame its length — if a long list is a problem, solve it with collapse/pagination/virtualization, never a nested scroll region.

**Applies to:** `BillOfMaterial.tsx` / `BillOfProcess.tsx` (items), `JobBillOfMaterial.tsx` / `JobBillOfProcess.tsx`, `QuoteBillOfMaterial.tsx` / `QuoteBillOfProcess.tsx`, and any new card-embedded list in `apps/erp`.
