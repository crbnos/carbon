# Inventory Module

Tracks item quantities across locations and storage units. Manages receipts, shipments, stock transfers, warehouse transfers, kanbans, picking lists, serial/batch/lot tracking, storage types, and traceability (lineage graphs).

## Key Domain Concepts

- **Storage Unit** — hierarchical container (bin, shelf, rack, zone) within a location. Tree structure via `parentId`. Renamed from `shelf` in migration `20260417000100`. MUST use `storageUnit` naming, never `shelf`.
- **Tracked Entity** — serial/batch/lot-tracked item instance with `readableId` (serial or batch number), `status` (Available/Reserved/On Hold/Consumed/Rejected), `quantity`, and `expirationDate`. Batch items have `batchProperty` definitions.
- **Item Ledger** — append-only log of every inventory movement (`itemLedger` table). Source of truth for on-hand quantities. MUST never INSERT directly — always go through service functions.
- **Receipt** — inbound inventory from POs or production. Lines link to `purchaseOrderLine` or jobs. Posting creates ledger entries and tracked entities.
- **Shipment** — outbound inventory to customers. Lines link to sales order lines.
- **Stock Transfer** — moves inventory between storage units within the same location.
- **Warehouse Transfer** — moves inventory between locations (inter-location).
- **Picking List** — generated pick instructions with FEFO/FIFO ordering and tracked entity allocation.
- **Kanban** — pull-based replenishment signal between storage units.
- **Inventory Count** — physical/cycle count. Created with an optional scope (`storageUnitIds` + `itemType`) recorded in the header's `scope` JSONB (written at create; not yet read back). `generateInventoryCountLines` snapshots on-hand into `inventoryCountLine` rows, **excluding Rejected AND Consumed tracked lots**. The count **detail** table filters lines by item type / storage unit / storage type / tags / material attributes via the `inventoryCountLines` **view** (line → item → subtype tables → storageUnit, flattened) — the same generic column-filter set the quantities screen uses. There is no material-attribute scope at create time.

## Safety

### Always
- MUST use `insertManualInventoryAdjustment` for quantity changes — it creates proper ledger entries and handles tracked entity updates.
- MUST scope by `companyId` and `locationId` — inventory is location-scoped.
- MUST use `getInventoryItems` (calls `get_inventory_quantities` RPC) for current quantities — never sum ledger entries manually.
- MUST use `generatePickingList` for pick operations — it handles FEFO/FIFO ordering and tracked entity allocation.

### Ask First
- Deleting storage units (`deleteStorageUnitCascade` cascade-deletes all children).
- Manual adjustments on tracked (serial/batch) items — these create/modify tracked entities.
- Changing `warehouseTransferStatus` — it triggers inventory movements.

### Never
- Directly INSERT into `itemLedger` — always go through service functions.
- Delete receipt lines that have posted tracked entities without cleaning up entities first.
- Reference `shelf` or `shelfId` — always use `storageUnit` / `storageUnitId`.

## Validation Commands

```bash
pnpm exec turbo run typecheck --filter=erp   # the app's package name is "erp", not "@carbon/erp"
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `itemLedger` / `itemLedgers` (view) | Append-only movement log: item, location, quantity, document ref, trackedEntityId |
| `storageUnit` | Hierarchical bins/shelves via `parentId`; scoped to location |
| `storageType` | Storage unit type definitions (capacity, constraints) |
| `trackedEntity` | Serial/batch/lot instances with readableId, status, quantity, expirationDate |
| `receipt` / `receiptLine` | Inbound documents from POs or production |
| `shipment` / `shipmentLine` | Outbound documents to customers |
| `stockTransfer` / `stockTransferLine` | Intra-location moves between storage units |
| `warehouseTransfer` / `warehouseTransferLine` | Inter-location moves |
| `kanban` | Pull-based replenishment signals |
| `batchProperty` | Custom property definitions for batch-tracked items |
| `pickingList` / `pickingListLine` | Pick instructions with tracked entity allocation |
| `pickMethod` | Default storage unit and pick strategy per item at a location |

## Key Service Functions

- `getInventoryItems` / `getInventoryItemsCount` — calls `get_inventory_quantities` RPC for on-hand quantities
- `getItemLedgerPage` / `getItemLedgerActivity` — paginated ledger history
- `insertManualInventoryAdjustment` — adjustments with tracked entity handling; wraps the `post-inventory-adjustment` edge function, which also maintains cost layers and posts GL journals (5310 vs RM/FG) in one transaction when accounting is enabled
- `getStorageUnit(s)` / `getStorageUnitTree` / `getStorageUnitsTreeForLocation` — storage hierarchy
- `getAvailableTrackedEntities` — calls `get_available_tracked_entities` RPC
- `getReceipts` / `getReceiptLines` / `reconcileReceiptSerialEntities` — receipt management
- `getShipments` / `getShipmentLines` / `getShipmentRelatedItems` — shipment management
- `generatePickingList` / `getPickingListAvailability` / `getPickingSchedule` — picking operations
- `getDefaultStorageUnitOrStorageUnitWithHighestQuantity` — picking defaults
- `getTrackedEntities` / `getTrackedEntityExpirations` / `getShelfLifeForItems` — tracking and expiry
- `generateInventoryCountLines` — Kysely; aggregates `itemLedger` on-hand into `inventoryCountLine` rows, scoped by the optional `storageUnitIds` + `itemType`. Excludes `Rejected` and `Consumed` tracked lots (status-aware, matching `quantityOnHand`); non-tracked rows (NULL status) always included. `getInventoryCountLines` reads the `inventoryCountLines` view (joins item + subtype tables on `id = item."readableId"` — the same predicate `get_inventory_quantities` uses, all LEFT — + `storageUnit`) so the detail table can apply generic column filters on flat columns.

## Key Exports

```typescript
import { getInventoryItems, insertManualInventoryAdjustment } from "~/modules/inventory";
import { inventoryAdjustmentValidator, receiptValidator } from "~/modules/inventory";
```

## Related Modules

- **purchasing** — receipts consume PO lines; receipt posting updates `purchaseOrderLine.quantityReceived`
- **production** — job completion posts finished goods; materials issued from inventory
- **items** — `itemTrackingType` (Inventory/Serial/Batch/Non-Inventory) determines tracking behavior
- **sales** — shipments fulfill sales order lines
- **quality** — inbound inspections triggered on receipt for items with `requiresInspection`

## Rules References

- `.ai/rules/inventory-system.md` — comprehensive guide to inventory code, RPCs, storage units, and gotchas
- `.ai/rules/traceability-model.md` — serial/batch lineage graph model (trackedEntity/trackedActivity)
