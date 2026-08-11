# Inventory & locations

> Where stock lives, how on-hand is tracked, and how it moves.

Stock in Carbon lives at a **location** and, within it, in a **storage unit**. What's actually on hand is derived from a ledger of movements, not a single editable number, so every quantity has a trail behind it.

## Locations and storage units

A **location** is a site or warehouse. Within one, stock sits in **storage units**: bins and shelves that can nest (aisle › shelf › bin) and be typed (cold, hazardous, returns). A storage unit attached to a work center is a **lineside** bin, used to stage material at the point of use; everything else is a warehouse bin.

## On hand is a ledger

The **item ledger** is the source of truth. On-hand is the sum of its signed movements: receipts and outputs add, sales and consumption subtract, transfers move between places. A cached per-location quantity exists for quick reads, but the ledger is what's authoritative.

| Entry type | Effect |
| --- | --- |
| `Purchase` · `Output` · `Assembly Output` | Goods received or produced into stock. |
| `Sale` · `Consumption` · `Assembly Consumption` | Goods shipped or issued to a job. |
| `Positive Adjmt.` · `Negative Adjmt.` | Manual corrections. |
| `Transfer` | Movement between locations or storage units. |

Read on-hand from the **ledger**, not the cached quantity table. The ledger is the truth, and it's status-aware (it can separate what's on hold or rejected from what's truly available).

On hand can go **negative**. Shipping, issuing to a job, and picking all post their movements without first checking availability. Carbon would rather let the work proceed and reconcile later than block the floor. Only manual negative adjustments are guarded against overdraw.

## Movements

Two kinds of transfer move stock. A **warehouse transfer** moves it between locations, and is carried out as a shipment out of one and a receipt into the other. A **stock transfer** moves it within a single location, between storage units. A manual **adjustment** posts a positive or negative entry to the ledger, or a *Set Quantity* that books the difference to a target. When accounting is enabled, every adjustment also posts a journal: a loss debits the inventory adjustment account and credits inventory, a gain is the mirror image, valued at the item's current cost. Inventory count variances post the same way. Moving stock between storage units posts no journal, because the value never left the location. `docs/reference/scrap` stock is a negative adjustment with a reason, offset to the scrap account instead of the adjustment account.

## Correcting a movement

The ledger is append-only — a posted movement is never edited or deleted. To fix one, use **"Correct Quantity"** on the movement in the Stock Movements screen and enter the quantity it should have been. Carbon books one **opposite movement for the difference**, linked to the original and dated with the original's posting date, so both sit in the right time period. The correction appears as its own row, flagged with a **Correction** badge that links it back to the movement it fixes. The journal for the correction posts into the original's accounting period. A **locked** period refuses the correction until it's unlocked; a **closed** period is permanent — once a movement's period has closed, it can no longer be corrected. Correcting the same movement again measures against what it currently nets to, so repeated corrections converge instead of stacking.

## Value

Inventory value is on-hand quantity times the item's unit cost, summed per item and location. The Valuation report shows it by location or by item, and its **"Tie-Out"** panel compares that subledger value to the GL inventory account balances. If the two disagree (adjustments made before the books were turned on are the usual reason), **"Reconcile"** drafts an adjusting journal for an accountant to review and post.

## Related

  - Items The tracking type that decides how an item's stock is counted.
  - Receipts How goods enter inventory in the first place.

## Troubleshooting

### "Insufficient quantity for negative adjustment"
The decrease (or *Set Quantity* reduction) exceeds what's on hand in that storage unit. Manual adjustments are the one movement guarded against overdraw. Check on-hand for the exact item/location/storage unit (and lot, if tracked) and adjust by no more than that.

### "Serial number not found"
The serial or batch number entered for a negative adjustment doesn't exist in the selected storage unit. Verify the number and the storage unit — the stock may sit in a different bin.

### "Multiple tracked entities in this storage unit — select a specific row to adjust"
A negative adjustment on a tracked item was ambiguous: several lots/serials sit in that storage unit. Select the specific tracked-entity row (or enter its number) so Carbon knows which one to reduce.

### "Cannot edit expiry of a consumed tracked entity"
Expiration dates can't be changed on stock that's already **Consumed**. Only live entities (Available, On Hold) accept an expiry override.

### "The original movement's accounting period is closed — its movements can no longer be corrected."
A stock-movement correction posts its journal into the **original movement's** accounting period, and that period is closed. Closing is permanent — there is no reopening — so the movement stays as posted. The **locked** variant of this message is recoverable: unlock the period and correct again.

### "Corrected quantity matches the current effective quantity — nothing to correct"
The corrected quantity you entered equals what the movement already nets to (original plus any prior corrections). There's no difference to book.

### "Corrections on serial-tracked items must be whole numbers"
The correction delta on a serial-tracked item wasn't an integer. Serial stock moves in whole units.

### Storage unit hierarchy errors
- "Parent storage unit … is in location …, but this unit is in location …; they must match" — parent and child bins must share a location; pick a parent in the same location.
- "Cannot change locationId of storage unit … because it has child units" — move or delete the children first, then move the parent.
- "Cycle detected in storage unit hierarchy at …" — the chosen parent is a descendant of this unit; pick one that doesn't loop back.
