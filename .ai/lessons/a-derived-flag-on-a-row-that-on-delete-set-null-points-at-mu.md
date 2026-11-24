---
paths: []
triggers: []
promoted: null
---
# A derived flag on a row that `ON DELETE SET NULL` points at must be released before the delete

**Context:** `itemStockQuantities.quantityNonNettable` counts the stock in storage units whose `effectiveNettable` is false. `itemLedger.storageUnitId` references `storageUnit` with `ON DELETE SET NULL` (2026-10-28).

**Problem:** Deleting a non-nettable unit sets its ledger rows' `storageUnitId` to NULL, and the ledger's statement handler then sees rows that point at no unit, which count as nettable. It cannot tell the stock was non-nettable, because the unit row is already gone, so `quantityNonNettable` keeps the stock forever. An AFTER interceptor on the unit is too late as well: the foreign key's own trigger has already nulled the rows.

**Rule:** When an aggregate is keyed on a property of a row that an `ON DELETE SET NULL` foreign key points at, undo that row's contribution in a BEFORE DELETE interceptor (`storage_unit_release_non_nettable_stock`), while the referencing rows still point at it. Prefer recomputing an aggregate from its source over adjusting it by deltas wherever the input can change without a write to the aggregated table (`util.refresh_storage_unit_nettable`).

**Applies to:** `packages/database/src/event-system/handlers/`, any derived total over `itemLedger` keyed on a `storageUnit` property.
