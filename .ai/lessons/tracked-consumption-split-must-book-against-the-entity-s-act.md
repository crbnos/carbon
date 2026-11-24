---
paths: []
triggers: []
promoted: null
---
# Tracked consumption/split must book against the entity's ACTUAL bin, not an arbitrary ledger row

**Context:** Building "return unused picks at job complete" surfaced a pre-existing bug in the `issue` edge function (`trackedEntitiesToOperation`). Consuming a batch that had been picked to a lineside shelf booked the Consumption + split `itemLedger` rows against `itemLedgers.find(il => il.trackedEntityId === id)?.storageUnitId` — the FIRST row for the entity in a `createdBy`-ordered list, i.e. an arbitrary bin. A picked entity has ledger rows in BOTH its warehouse source and its lineside bin, so consumption landed on the warehouse bin, leaving the entity at −N on-hand in one bin / +N in another: a per-bin-negative, internally inconsistent ledger, and the un-consumed remainder (a split entity) stranded on the wrong bin.

**Problem:** For a tracked entity that has moved between bins (pick/transfer), "which bin holds the stock" is NOT the first ledger row — it's the bin whose net on-hand is positive. Picking any row's `storageUnitId` silently misplaces consumption and breaks any downstream feature that reasons about physical location (e.g. returning lineside remainder to source).

**Rule:** When booking a consumption/split/movement ledger row for a tracked entity, resolve the storage unit from **net on-hand per bin** (the bin with the highest positive net), never `.find(...)?.storageUnitId` over an unordered/`createdBy`-ordered list. See `resolveTrackedEntityBin` (`packages/utils/src/resolve-tracked-entity-bin.ts`, pure + test-covered; exported by `@carbon/utils`). Scope such a fix to the path you can verify — the same `.find` pattern exists in other cases (e.g. `unconsumeTrackedEntities`); don't blanket-replace untested paths.

**Applies to:** `issueMaterial` (`apps/erp/app/modules/inventory/inventory.service.ts`) and any posting inserting `itemLedger` rows for a tracked entity that may hold stock in multiple bins.
