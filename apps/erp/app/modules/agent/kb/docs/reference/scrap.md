# Scrap and unscrap

> Writing off defective or lost material, and restoring it if the write-off was a mistake.

Scrap is how Carbon records material you can't recover: a unit ruined at an operation, a subcomponent that failed, or stock lost in the warehouse. Every scrap names a **reason**, moves the value off inventory or out of work-in-process, and (when accounting is on) posts a journal. If you scrapped in error, **Unscrap** puts it back exactly as it was.

There are three places you can scrap, and they behave differently. What they share: the affected tracked entity ends at status **"Scrapped"**, which keeps its quantity as the record of what was lost and, unlike **"Consumed"** or **"Rejected"**, can be reversed.

## Scrapping a unit on the floor

When the unit you're building goes bad, an operator taps **"Log Scrap"** on the operation, enters a quantity, and picks a required **"Scrap Reason"**. For a Serial part the currently selected serial is the one scrapped.

Carbon records a **Scrap** production quantity, backflushes the unit's bill of material into WIP (the material really was consumed making the ruined unit), flips the serial to **"Scrapped"**, and spawns a fresh replacement serial for you to keep working.

A scrapped unit is not treated as output. Its quantity never counts toward the operation's target, completed operations reopen to **"Ready"**, and a replacement serial is spawned automatically, so the job keeps producing until the *good* quantity meets the target. The planned quantity itself is never rewritten; Carbon only tops up the operation's run quantity when cumulative scrap runs past the allowance you planned for.

## Scrapping a subcomponent

A component that was picked or already issued into the unit is scrapped from the **"Scrap"** tab of the issue-material dialog, which lists that material's **Available** and **Consumed** tracked entities. Each row's **"Scrap"** button opens a dialog for the reason and, for a make-to-order component, an optional **"Make a replacement"**.

What posts depends on the entity's *state*, not the item's method:

An **Available** part is scrapped straight out of its bin as a negative adjustment, and the job's issued quantity is left untouched. A **Consumed** part is relieved from the job's WIP at its unit cost, and the material's issued quantity is decremented so the requirement reopens for a replacement. Either way the entity ends at **"Scrapped"**; make-to-order can additionally reopen the subassembly's routing and spawn a replacement with a rework row.

## Scrapping stock

Warehouse stock that never reached a job is scrapped from the storage-unit adjustment form: set the adjustment type to **"Scrap"** and pick a **"Scrap Reason"**. This books a negative movement at the item's cost. A serial flips to **"Scrapped"** and keeps its quantity; scrapping part of a batch splits the lot, and only the scrapped portion becomes **"Scrapped"**.

## Unscrap

Unscrap reverses a scrap. On the tracked-entities table, the **"Unscrap"** action appears on any row at status **"Scrapped"** (filter the status column to **"Scrapped"** to find them). It restores the entity to **"Available"** at the same bin, and asks only for an optional comment.

Unscrap restores the entity at the exact cost it was scrapped from, read back from the original scrap's cost layers, so a scrap-then-unscrap nets to nothing in the ledger. You don't re-enter the reason either; Carbon inherits it from the scrap movement it's reversing, and links the restoring entry back to that movement. (Untracked stock is the one exception: it comes back at current cost and needs a location.)

## Accounting for scrap

Scrap posts to the ledger only when `docs/reference/accounting` is enabled; the stock and cost layers move regardless. Every path debits a single **scrap account** (`accountDefault.scrapAccount`, which falls back to the inventory adjustment variance account). Where the credit lands depends on where the value was:

| Scrap path | Debit | Credit |
| --- | --- | --- |
| Unit on the floor | Scrap | Work-in-process |
| Consumed subcomponent | Scrap | Work-in-process |
| Available subcomponent, or stock | Scrap | Inventory |
| Unscrap | Inventory | Scrap |

Carbon deliberately posts all scrap to one account rather than a per-reason chart of accounts. It tags each scrap journal line with **ScrapReason**, **WorkCenter**, and **Employee** dimensions (work center only where there's an operation behind the scrap), so you slice scrap by reason, cell, or operator in reporting without proliferating accounts. The ScrapReason dimension reads its values live from your scrap-reason list, so a new reason is immediately reportable.

This scrap is distinct from a quality **disposition** of *Scrap*: closing a quality `docs/reference/issues` with a Scrap disposition writes the material off to a cost-of-quality account and flips the entity to **"Rejected"**, not **"Scrapped"**.

## Related

  - Traceability The tracked-entity statuses, including Scrapped, and the Unscrap action.
  - Jobs Production quantities and how scrap is reported against an operation.
  - Inventory The item ledger and manual adjustments scrap posts against.
  - Accounting The journal, the scrap account, and posting dimensions.
