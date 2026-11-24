---
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["postReceipt", "postShipment", "receiptLinesByPurchaseOrderLineId", "trackedEntityUpdates"]
promoted: null
---
# A skip inside a posting loop does not cover maps built before the loop

**Context:** Making `postReceipt` (PO path) ignore a receipt line received at 0 (receipt quantities can start at zero, 2026-10).

**Problem:** The fix added `if (receivedQuantity === 0) continue;` to the per-line ledger loop. Three side-effect maps were built earlier from every line: `receiptLinesByPurchaseOrderLineId` (PO line `receivedDate`, outside-processing operation status) and `trackedEntityUpdates` (entity status and the Receive activity). A zero line still stamped its PO line received today, and a batch left on it became Available at its full quantity with no item ledger row. Review caught it, not the tests.

**Rule:** When a posting must ignore a line, filter it where every per-line collection is built, not only in the loop that writes the ledger. List every map or array derived from the lines and check each. Pin the skipped line's absence in a test: assert the side effects did not happen, not only that the ledger row is missing.

**Applies to:** `postReceipt` / `postShipment` and every posting in `inventory.service.ts` that builds update maps before its write loop.
