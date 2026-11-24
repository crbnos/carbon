---
paths: []
triggers: []
promoted: null
---
# A mutually-exclusive primary/fallback branch breaks when the primary source can be legitimately empty

**Context:** The MES Issue dialog (`IssueMaterialModal`) pre-selects tracked lots from two sources: `pickedAllocation` (lots a picking list already picked) and `suggestedAllocation` (the FEFO/pickMethod suggestion of what to pick). It gated the suggestion off whenever a picking allocation merely existed (`shouldSuggestAllocation = … && !hasPickingAllocation`) and chose `seedAllocation = hasPickingAllocation ? pickedAllocation : suggestedAllocation`.

**Problem:** `hasPickingAllocation` was true when `quantityToPick > 0` — i.e. the material is ON a picking list — but `pickedAllocation` is only non-empty once something is physically PICKED (pickingListLineTrackedEntity rows are written at pick time, never at allocation). For a material on an In-Progress list that hasn't been picked yet (common in a multi-line list where other lines were picked first), the primary branch was selected but resolved empty, the suggestion was gated off, and the seed effect bailed → operator got the default first lot instead of the recommendation. The two conditions "should we prefer picked lots" and "do picked lots exist" were conflated.

**Rule:** When one data source is the preferred seed and another is the fallback, branch on whether the preferred source actually HAS data (`primary.length ? primary : fallback`), and load the fallback unconditionally — do not gate the fallback off on a proxy signal (here `hasPickingAllocation`) that can be true while the primary is still empty. Verify the "primary exists but is empty" state explicitly, since it's the one static reading and happy-path testing both miss.

**Applies to:** `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx` (picked vs suggested allocation seeding); any picking-list-aware UI that distinguishes allocated-but-not-picked from picked (`pickingListLineTrackedEntity.quantityPicked > 0`).
