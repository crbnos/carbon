# Supplier return: tracked-entity pre-select, flow-through, and partial splits

Branch: `returns-module`

## Problem

On a purchase return order (supplier return), tracked entities (batches/serials)
don't move through the flow:

1. **No pre-selection.** Adding a return line from a specific receipt never
   auto-selects the batch, even when the receipt line has exactly one entity.
2. **Batch doesn't reach the shipment.** `create → shipmentFromPurchaseReturnOrder`
   never copies `purchaseReturnOrderLineTrackedEntity` onto the shipment's tracked
   entities, so the shipment's batch box starts empty.
3. **No splits.** `post-shipment`'s `Purchase Return Order` case requires the linked
   entities to sum exactly to `shippedQuantity` and consumes them whole — a partial
   return (ship 2 of a batch of 3) throws.

## Decisions (from user)

- Pre-selection is **persisted at line creation** (not UI-only).
- **Full support**: partial-batch splits, mirroring the Sales Order path.

## Reference facts (grounded)

- Entities from a receipt carry `attributes["Receipt"]` (receiptId) AND
  `attributes["Receipt Line"]` (receiptLineId) — set by receipt tracking / create.
- Shipment tracking is `trackedEntity.attributes["Shipment"]/["Shipment Line"]`
  (no join table). `post-shipment` reads entities via `attributes ->> Shipment`.
- `buildBatchSplitRecords` (`functions/shared/batch-split.ts`): parent keeps its id
  and is decremented; a new `nanoid` child departs with the drawn qty, `childStatus`
  `"Consumed"`, carrying `"Split From Entity ID"`. Emits a `Split` activity + two
  net-zero `Batch Split` itemLedger rows. Throws unless `0 < draw < parent.quantity`.
- SO post split loop = the reference (post-shipment ~880-1006): builds a parent
  `"Shipment"` activity, splits, decrements + strips shipment attrs off the parent,
  pushes the Batch-Split ledger pair, and **retargets** the outbound relief ledger
  row from parent → child. PRO books its own per-entity `Purchase Return Shipment`
  negative row, so that retarget is required (unlike the PO path, which books none).
- **Void needs no change.** SO/PRO voids flip every `attributes ->> Shipment` entity
  back to `Available` (status only); after a split those are the Consumed children,
  and the retargeted reversing ledger row already targets the child. Parent stays
  decremented — same fragmented-but-whole outcome SO already accepts. No merge.

## Changes

### 1. Pre-select single entity, persisted (Fix C)

- `purchasing.service.ts`: add `getReturnableEntitiesForReceiptLine(client, companyId,
  itemId, receiptLineId)` — `trackedEntity` where `itemId`, `status = "Available"`,
  `attributes ->> Receipt Line = receiptLineId`, `companyId`.
- `routes/x+/purchase-return-order+/$id.new.tsx`: after the line is created, if no
  `trackedEntityIds` were submitted and the line has a `receiptLineId`, call the new
  fn; if it returns **exactly one** entity, persist it via
  `setPurchaseReturnOrderLineTrackedEntities`. Covers both the line form and the
  "Add lines from receipt" modal (both route through this action). Non-tracked items
  return `[]` → no-op.

### 2. Flow-through to the shipment (Fix A)

- `create/index.ts` `shipmentFromPurchaseReturnOrder`:
  - Before the txn, read `purchaseReturnOrderLineTrackedEntity` (embed
    `trackedEntity(id, attributes)`) for the return lines, grouped by return line id;
    and (re-source path) read entities currently tagged with this shipment id.
  - Change the `shipmentLine` insert to `.returning(["id", "lineId"])`.
  - In the txn: strip `Shipment`/`Shipment Line`/`Shipment Line Index` from any stale
    entity, then stamp `Shipment = shipmentId`, `Shipment Line = <new line id>` onto
    each return line's selected entities (merging existing attributes).

### 3. Partial splits at post (Fix B)

- `post-shipment/index.ts` `Purchase Return Order` post case:
  - Declare `trackedEntitySplits` and `splitChildEdges` alongside the existing maps.
  - Replace the batch/serial `else` block: require `entitySum >= shippedQuantity`
    (else throw "assign tracking"), then **draw** `shippedQuantity` across the linked
    entities. Each fully-drawn entity → full consume (existing behavior); the entity
    drawn partially → record a split (negative ledger row at the drawn qty, remember
    its index to retarget). `itemShipmentQuantities` accumulates the drawn amount.
  - In the txn, before the `itemLedger` insert: for each split call
    `buildBatchSplitRecords` (`activitySourceDocument "Shipment"`, `childStatus
    "Consumed"`, `bin` from `shipmentLine.storageUnitId` + `shipment.data.locationId`),
    insert the child + `Split` activity + input/output edges, decrement the parent and
    strip its shipment attrs, push the Batch-Split ledger pair, and retarget the
    captured negative `Purchase Return Shipment` row to the child id.
  - Extend the `Return Shipment` activity block to run when there are splits too, and
    add a `trackedActivityInput` edge (child @ drawn qty) for each split child.
- Void: no change (analysis above).

## Verification

- `pnpm exec turbo run typecheck --filter=erp`
- `deno check` is not wired locally; rely on typecheck of shared types + careful review.
- Browser (user, after stack up): add a return line from a receipt with one batch →
  batch pre-selected; create shipment → batch present on the shipment line; post a
  partial (2 of 3) → posts, parent batch keeps 1 Available, child 2 Consumed; void →
  both Available.

## Out of scope

- `purchaseReturnOrderLineTrackedEntity.quantity` stays hardcoded `1` (not read by the
  shipment flow; splits are driven off `shippedQuantity`).
- No merge-on-void (matches SO).
