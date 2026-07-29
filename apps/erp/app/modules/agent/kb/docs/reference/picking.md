# Picking lists

> Staging a job's materials from the warehouse to the point of use, tracked line by line.

A picking list is a set of instructions to pull a job's materials out of the warehouse and stage them where the work happens. Each line names one material, how much to pick, where it lives now, and where it's going: the lineside bin at the operation's work center. A pick doesn't consume the stock; it *moves* it, so production can draw it down later.

## What a picking list picks against

Picking is driven by production, not by shipping. A list is generated from **job operations** that still have unstaged material. Carbon looks at each operation's materials, checks whether the operation's own lineside bin already holds enough on hand to cover them, and lists only what's genuinely outstanding. An operation already on a non-cancelled picking list won't be offered again, so you can't accidentally pick the same work twice.

Every line ties back to a specific job, job material, and (usually) job operation. There is no picking against a shipment or a sales order here. Shipments pull finished goods out to customers and are their own document; picking stages raw and component material *into* a job.

A material needs picking only when its lineside bin doesn't already cover the operation's issue quantity. Carbon tests the **actual on-hand at that bin**, not where the job material's record happens to point. Material line-stocked at the work center is already staged, not an outstanding pick.

## Header and line status

A picking list header moves through four states. It starts at **"Draft"**, flips to **"In Progress"** on the first pick, and reaches **"Completed"** when every line is resolved. **"Cancelled"** is a terminal off-ramp.

  - **Draft**: Generated and assigned, nothing picked yet.
  - **In Progress**: At least one line has been picked, or the list was reopened with prior progress.
  - **Completed**: Every line is fully picked or Cancelled. The list locks.
  - **Cancelled**: The list is abandoned. It locks, and its lines no longer block re-generating those operations.

The header status is *derived from its lines* by a database trigger, not set by hand: as lines are picked and unpicked, the header recomputes. It only jumps to **"Completed"** once no line is still outstanding, and it never overrides a **"Cancelled"** header.

Each line carries its own status:

  - **Pending**: Not yet picked. Still outstanding work.
  - **Picked**: The pick quantity has been moved to the lineside bin.
  - **Short**: Picked less than required, and the shortage is acknowledged.
  - **Cancelled**: The line's requirement is dropped. It no longer counts as outstanding.

## Short picks don't silently close the list

When there isn't enough stock, a picker enters how many were actually pulled and marks the line **"Short"**. That is a deliberate, human-acknowledged shortage, not an error.

A **"Short"** line that isn't fully picked keeps the list **"In Progress"** — it does *not* count as resolved. The list completes only through the explicit **"Complete"** action, so a shortage is always signed off by a person rather than being finalized in the background. A **"Cancelled"** line is different: its requirement is gone, so it no longer holds the list open.

## Where picking happens

Picking lists are generated and managed from the ERP, and the same lists are worked on the **MES shop floor**, where an operator opens an assigned list, taps **"Start"** to move it to **"In Progress"**, picks each line, and taps **"Finish"** to complete it. Tracked items (serial and batch) are picked by scanning the specific lot.

Once a list is **"Completed"** or **"Cancelled"** it locks: no further picks or unpicks. **Reopening is ERP-only** — it needs the inventory delete permission, so the floor can't reopen a closed list. The MES surface tells the operator to reopen it from the ERP instead. This keeps a finalized pick from being quietly reworked at the station.

## What posting a pick does to stock

A pick is a **transfer**, never a consumption. Posting one writes two balanced item-ledger entries: a negative at the warehouse source bin and an equal positive at the operation's lineside bin. On-hand doesn't drop; it just relocates to the point of use. Carbon also repoints the job material at the lineside bin, so when production backflushes or issues the material, it draws from where the pick just put it.

- **Untracked material** posts the transfer pair and marks the line **"Picked"**.
- **Serial and batch** picks additionally record a tracked-entity movement, so the exact lot is traceable end to end. Picking part of a batch **splits** it: the picked quantity moves to lineside and the remainder stays behind as a new lot.

An **unpick** reverses the transfer, restores the warehouse source as the consumption point, and returns the line to **"Pending"**. And at job complete, any picked-but-unconsumed remainder is walked back from the lineside bin to the warehouse automatically, so leftover staged stock never gets stranded at the line.

Because a pick only moves stock and never checks availability first, on-hand at a bin can go negative — the same way shipping and issuing do. Carbon lets the floor proceed and reconciles later rather than blocking the work.

## Related

  - Inventory & locations Storage units, the ledger, and how on-hand is tracked.
  - Jobs The production work a picking list stages material for.
  - Shipments The outbound counterpart: finished goods out to customers.
  - Run the floor Where operators work picking lists at the station.

## Troubleshooting

Exact errors from picking, unpicking, reopening, and short picks.

### "This picking list is closed. Reopen it to make changes."
The list is **"Completed"** or **"Cancelled"**, so it's locked — no picks or unpicks. Reopen it first. Reopening is ERP-only and needs the **inventory delete** permission; the floor can't do it.

### "Reopen this picking list from the ERP."
The MES surface returns this when an operator tries to work a list that's already **"Completed"** or **"Cancelled"**. The shop floor can't reopen a closed list — go to the ERP, reopen it there (inventory delete permission), then the operator can continue.

### "Tracked items must be picked via the scan flow"
A serial- or batch-tracked line was picked through the plain quantity path. Tracked items are picked by scanning the specific lot, not by entering a number — use the scan flow on the line.

### "No lineside destination is set for this line"
The line has no lineside bin to move stock into, so the transfer has nowhere to land. The operation's work center needs a lineside storage unit configured before the pick can post.

### A short line won't let the list complete
A **"Short"** line that isn't fully picked still counts as outstanding, so the header stays **"In Progress"** and won't auto-complete. Finish the pick, **"Cancel"** that line to drop its requirement, or use the explicit **"Complete"** action to sign off the shortage — completion is always a deliberate human step, never a background finalization.

### The Reopen or Delete action is greyed out
Reopen requires the **inventory delete** permission and a non-Draft status. Delete additionally requires the **employee** role, a **"Draft"** status, and no already-picked lines. Start/Finish/Cancel need **inventory update** and the matching status (Start from Draft, Finish from In Progress).
