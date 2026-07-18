# Inventory & locations

> Where stock lives, how on-hand is tracked, and how it moves.

Stock in Carbon lives at a **location** and, within it, in a **storage unit**. What's actually on hand is derived from a ledger of movements, not a single editable number, so every quantity has a trail behind it.

## Locations and storage units

A **location** is a site or warehouse. Within one, stock sits in **storage units**: bins and shelves that can nest (aisle › shelf › bin) and be typed (cold, hazardous, returns). A storage unit attached to a work center is a **lineside** bin, used to stage material at the point of use; everything else is a warehouse bin.

## On hand is a ledger

The **item ledger** is the source of truth. On-hand is the sum of its signed movements: receipts and outputs add, sales and consumption subtract, transfers move between places. A cached per-location quantity exists for quick reads, but the ledger is what's authoritative.

| Entry type | Effect |
| --- | --- |
| Purchase / Output | Goods received or produced into stock. |
| Sale / Consumption | Goods shipped or issued to a job. |
| Positive / Negative Adjustment | Manual corrections. |
| Transfer | Movement between locations or storage units. |

Read on-hand from the **ledger**, not the cached quantity table. The ledger is the truth, and it's status-aware (it can separate what's on hold or rejected from what's truly available).

On hand can go **negative**. Shipping, issuing to a job, and picking all post their movements without first checking availability. Carbon would rather let the work proceed and reconcile later than block the floor. Only manual negative adjustments are guarded against overdraw.

## Movements

Two kinds of transfer move stock. A **warehouse transfer** moves it between locations, and is carried out as a shipment out of one and a receipt into the other. A **stock transfer** moves it within a single location, between storage units. A manual **adjustment** posts a positive or negative entry to the ledger, or a *Set Quantity* that books the difference to a target. When accounting is enabled, every adjustment also posts a journal: a loss debits the inventory adjustment account and credits inventory, a gain is the mirror image, valued at the item's current cost. Inventory count variances post the same way. Moving stock between storage units posts no journal, because the value never left the location.

## Value

Inventory value is on-hand quantity times the item's unit cost, summed per item and location. The Valuation report shows it by location or by item, and its **"Tie-Out"** panel compares that subledger value to the GL inventory account balances. If the two disagree (adjustments made before the books were turned on are the usual reason), **"Reconcile"** drafts an adjusting journal for an accountant to review and post.

## Related

  - Items The tracking type that decides how an item's stock is counted.
  - Receipts How goods enter inventory in the first place.
