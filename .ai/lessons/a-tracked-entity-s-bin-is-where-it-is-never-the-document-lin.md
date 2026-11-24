---
paths: ["apps/erp/app/modules/shared/shared.service.ts"]
triggers: ["resolveTrackedEntityBin", "getTrackedEntityBins", "p_filter_storage_unit", "assertInSourceBin"]
promoted: null
---
# A tracked entity's bin is where it IS, never the document line's bin — and "no storage unit" is a bin

**Context:** Sales order shipments booked every serial and batch against `shipmentLine.storageUnitId` (copied from the sales order line, which defaults to the item's default bin). A unit picked from any other bin drove the line's bin negative and left its real bin showing stock that had already shipped. The stock transfer picker had the matching gap: it listed every lot at the location, not the line's source bin, and an empty source (`fromStorageUnitId` null — the wizard's "No storage unit") meant "any bin".

**Problem:** A document line's bin is a default for untracked stock. For a serial or batch the ledger already knows the bin, and ignoring it corrupts two bins at once. `resolveTrackedEntityBin` skips the unassigned bin (`null`), so a unit moved into "no storage unit" resolves back to the named bin it left. And `NULL` as a filter value cannot also mean "no filter".

**Rule:** Book a tracked entity's outbound row against its actual bin: `resolveTrackedEntityBins` (`@carbon/utils`, null-aware) through `getTrackedEntityBins` (`apps/erp/app/modules/shared/shared.service.ts`). Refuse when it has no stock anywhere rather than falling back to the line's bin. A void reverses into the bin the posting used (read the posted `itemLedger` rows), not the line's. A bin filter that must express "no storage unit" takes an explicit switch (`p_filter_storage_unit` on `get_available_tracked_entities`) and compares with `IS NOT DISTINCT FROM`.

**Applies to:** `post-shipment` (Sales Order post/void, serial + batch), `post-stock-transfer` (`assertInSourceBin`), the stock transfer picker. Return and outbound-transfer shipments still use the line's bin.
