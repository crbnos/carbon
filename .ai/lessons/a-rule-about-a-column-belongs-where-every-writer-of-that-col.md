---
paths: ["packages/database/src/event-system/handlers/sync_item_tracking_type_change.sql"]
triggers: ["itemTrackingType", "sync_item_tracking_type_change", "setItemTrackingType"]
promoted: null
---
# A rule about a column belongs where every writer of that column passes

**Context:** An item's tracking type (Inventory, Batch, Serial) is copied onto job
materials, job make methods and open document lines when they are made. Draws read the
copy to choose untracked or tracked stock. `setItemTrackingType` updated the copy, but
only on Draft and Planned jobs, and it did not check stock.

**Problem:** Six code paths write `item.itemTrackingType` on an existing item: the
properties panel, `updateItem`, `updatePart` and its siblings, CSV import, the Onshape
field writer and the bulk update. Only two of them updated the copy, and none checked
stock or released jobs. An item changed from Batch to Inventory kept its lots, which no
untracked draw can see, so the next issue drove the bin negative. A released job kept
the old copy, so its issues selected materials by the copy and moved stock by the item.

**Rule:** When a column change must be checked or carried to other rows, put that rule
in the database (a statement handler on the table), not in one service function. Before
you choose the place, list every writer of the column with `git grep`. A rule in one
writer is a rule the other writers skip.

**Applies to:** `sync_item_tracking_type_change`
(`packages/database/src/event-system/handlers/`), and any flag copied from a master
record onto open documents.
