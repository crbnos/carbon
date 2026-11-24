---
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["lockPostedReceipt", "assertReceivedStockOnHand", "assertNoRejectedUntrackedLot", "settleQuantity"]
promoted: null
---
# A void reverses only what is still where the posting put it

**Context:** Voiding a posted purchase receipt with serials and batches (2026-10-16).

**Problem:** The void set every tracked entity back to Available at its received quantity, so a lot that was never received stayed pickable. It also reversed each ledger row at the receipt's bin with only a cost-layer check. A serial moved to another bin, picked to lineside or shipped (Standard and Average cost never draw a layer down) passed that check, so the receipt bin went negative while the unit stayed counted where it went. And the receipt's inspection lot stayed open: Accept made the voided batch Available again, and Reject wrote the reversed stock off a second time.

**Rule:** A reversal checks, inside its transaction, that the stock it removes is still at the position the posting wrote: per serial or batch for tracked rows. It closes every record that hangs off the document (here the inspection lot) or refuses while one has acted. It drains the document's tracked entities to quantity 0. To keep `Rejected` at zero, write the status directly: `settleQuantity` only preserves `Scrapped` and turns `Rejected` into `Consumed`.

**Applies to:** the `postReceipt` void (`lockPostedReceipt`, `assertReceivedStockOnHand`, `assertNoRejectedUntrackedLot` in `inventory.service.ts`), and any other void that reverses item ledger rows (shipments, stock transfers, adjustments).
