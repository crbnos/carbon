---
paths: []
triggers: []
promoted: null
---
# Loader-computed "current unit" must match the component's, or per-unit attribution credits the wrong unit

**Context:** The MES assembly view resolves the unit on screen twice: the loader (`apps/mes/app/routes/x+/assembly.$operationId.tsx`) computes `unitIndex` from `?unit`/`?trackedEntityId`, and `AssemblyView.currentUnitIndex` computes it again client-side. Per-unit material issue attribution (batch parents) was moved into the loader, keyed off the loader's `unitIndex`.

**Problem:** The two defaults diverged. When there's no `?unit` param, `AssemblyView` lands on the NEXT unit still to build (`min(quantityComplete, units.length-1)`) — and the auto-complete effect DELETES `?unit` after finishing a unit — but the loader defaulted `unitIndex` to `0`. So on unit 2 (default landing) the loader attributed unit 1's stamped consumes (`Unit=1`) to the unit-2 view: parts showed `1/1`/`2/1` though nothing was issued to unit 2, and the scan gate (which reads the same values) let the operator Mark done. Serial parents were unaffected (attribution is per-entity, and both default to 0).

**Rule:** When a loader and its component both compute the same "current X" and one feeds data the other renders, their resolution logic — including the no-param default — must be identical. For the assembly loader, mirror `AssemblyView.currentUnitIndex`: index-paged (batch/untracked) parents default to `min(quantityComplete, opQty-1)`, serial parents to `0`. If you make a loader-computed index load-bearing for attribution, re-derive it the exact same way the UI does.

**Applies to:** `apps/mes/app/routes/x+/assembly.$operationId.tsx` (`unitIndex`) ↔ `apps/mes/app/components/AssemblyView.tsx` (`currentUnitIndex`); any loader/component pair where one computes an index the other renders.
