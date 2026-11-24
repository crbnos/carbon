---
paths: []
triggers: []
promoted: null
---
# Copying child rows onto a new record can make that record undeletable

**Context:** A new item revision now inherits the source revision's supplier parts and their
price breaks (`copyItemPlanningAndPurchasing`, called by `createRevision`). A change notice
discards its draft revision by deleting the draft item.

**Problem:** `supplierPart.itemId → item` is `ON DELETE CASCADE`, but
`supplierPartPrice → supplierPart` is `ON DELETE RESTRICT`. An item delete therefore cascades
into a supplier part that a price break refuses to let go, and the whole delete fails with
`23503`. Before the copy, a fresh revision had no supplier parts, so nothing exercised that
path; after it, every revision of an item with price breaks carries the blocker: the Item
Master delete was refused, and the change notice's draft discard ignored the delete's error,
so the draft would have survived silently. Reading the migrations for the table being copied
was not enough; the constraint that mattered sat on its child.

**Rule:** Before copying rows onto a record, list the delete rule of every FK that points at
the copied tables (`pg_constraint.confdeltype`, or `grep REFERENCES` for the table name) and
walk every path that deletes the parent. A `RESTRICT`/`NO ACTION` child turns a copy into a
delete blocker. Either delete the child first on that path, in the same transaction as the
parent so a refused parent delete does not lose the child, or change the rule in a migration.
And a delete whose failure the caller ignores is not a delete: return the error.

**Applies to:** `apps/erp/app/modules/items/items.service.ts` (`createRevision`,
`deleteItemsWithPriceBreaks`, `deleteItem`, `discardChangeNoticeDrafts`,
`deleteSupplierPart`), and any copy/duplicate of `supplierPart`.
