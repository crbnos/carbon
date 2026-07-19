---
paths:
  - "apps/erp/app/modules/inventory/**"
  - "packages/database/supabase/migrations/**"
---

# Inventory System

Carbon's inventory tracks item/material quantities across locations and storage
units, plus serial/batch/lot tracking, receipts/shipments, transfers, and picking.

## Code (real paths)

All inventory service code lives in a single module: `apps/erp/app/modules/inventory/`

- `inventory.service.ts` — the one service file (~90+ exported functions, no `service/` subfolder)
- `inventory.models.ts` — Zod validators + exported enums/helpers
- `lineage.server.ts` — traceability/genealogy graph computation
- `types.ts`, `index.ts`
- `ui/` — feature folders: `Inventory/`, `Receipts/`, `Shipments/`, `StockTransfers/`,
  `WarehouseTransfers/`, `StorageUnits/`, `StorageTypes/`, `Kanbans/`, `PickingLists/`,
  `Batches/`, `ShippingMethods/`, `Traceability/`

Key service functions (verified):
- `getInventoryItems` / `getInventoryItemsCount` — call the `get_inventory_quantities` RPC
  (args `{ location_id, company_id }`, `count: "exact"`); supports search + generic filters.
- `getItemLedgerPage` — paginated item-ledger history for an item at a location.
- `insertManualInventoryAdjustment` — thin wrapper over the **`post-inventory-adjustment`
  edge function** (MES has a matching wrapper in `apps/mes/app/services/inventory.service.ts`).
  The edge function owns positive/negative/set-quantity resolution, tracked-entity storage-unit
  transfers, expiry override, batch/serial assignment — and, in one Kysely transaction, maintains
  `costLedger` layers (consume via `calculateCOGS` on decreases, new layer at current cost on
  increases) and posts a journal (Dr/Cr `resolveInventoryAccount` vs
  `accountDefault.inventoryAdjustmentVarianceAccount`) when `companySettings.accountingEnabled`.
  `post-inventory-count` books its variances through the same shared core
  (`functions/shared/post-adjustment.ts`). Storage-unit transfers post no GL. The valuation
  workbench tie-out offers a **Reconcile** action (`createInventoryReconciliationJournal`) that
  drafts an adjusting journal for any residual pre-feature variance.
- Storage units: `getStorageUnit(s)`, `getStorageUnitRoots`, `getStorageUnitChildren`,
  `getStorageUnitTree`, `getStorageUnitsTreeForLocation`, `getDefaultStorageUnitForJob`,
  `getDefaultStorageUnitOrStorageUnitWithHighestQuantity` (these are the picking/job defaults).
- Tracking: `getTrackedEntities`, `getAvailableTrackedEntities` (RPC `get_available_tracked_entities`),
  `getSerialNumbersForItem`, `getBatchNumbersForItem`, `getShelfLifeForItems`, `getPickOrder` (FEFO/FIFO).
- Picking: `generatePickingList`, `getPickingListAvailability` (RPC `get_picking_list_availability`),
  `getPickingSchedule` (RPC `get_picking_schedule`).

Validators in `inventory.models.ts`: `inventoryAdjustmentValidator`, `receiptValidator`,
`shipmentValidator`, `stockTransferValidator`, `warehouseTransferValidator`, `storageUnitValidator`,
`storageTypeValidator`, `kanbanValidator`, `pickingListValidator`, `pickingListLineValidator`,
`shippingMethodValidator`, `batchPropertyValidator`. Also exports `itemLedgerTypes` etc.

## Database (current schema)

- **`itemLedger`** — source of truth for on-hand quantity. Key cols: `entryType` (`itemLedgerType`),
  `documentType` (`itemLedgerDocumentType`), `postingDate`, `itemId`, `locationId`,
  `storageUnitId`, `quantity`, `trackedEntityId`, and `trackedEntityStatus` (denormalized from
  `trackedEntity.status` — added `20260420112047`, lets reads filter status without a JOIN).
- **`itemLedgerSnapshot`** (matview, `20260713235406`) — snapshot of the immutable UNTRACKED
  ledger rows (`trackedEntityId IS NULL`, `createdAt` older than 1h) per item/company/location:
  `quantity`, `consumed30/90`, `storageUnitIds`, `snapshotCutoff`. pg_cron refresh every 30 min.
  Read only inside the SECURITY DEFINER quantity functions (REVOKEd from PostgREST roles); live
  reads add rows past `snapshotCutoff` plus ALL tracked rows, so results stay exact. Distinct
  from `itemStockQuantities` (the approximate UI item-store matview used by RealtimeDataProvider).
  The old `itemInventory` rollup table is DEAD — its maintaining trigger was dropped in
  `20250209170952_shipment.sql`; don't read or write it.
- **`storageUnit`** — bins/locations. Renamed from `shelf` (`20260417000100`); supports nesting via
  `parentId` and `storageTypeIds TEXT[]` (`20260417000200`). Cols: `id`, `name`, `locationId`,
  `warehouseId`, `parentId`, `storageTypeIds`, `active`.
- **`storageType`** — storage-unit type definitions (`20260417000000`).
- **`trackedEntity`** — serial/batch/lot tracking (`20250225145619`). Cols: `id`, `quantity`,
  `status` (`trackedEntityStatus`), `sourceDocument(Id)`, `attributes JSONB` (batch/serial #, supplier…),
  `expirationDate`. Companion `trackedActivity` + `trackedActivityInput`/`Output` record movements.
- **`warehouseTransfer` / `warehouseTransferLine`** — inter-location moves (`20250726000000`).
  Status enum `warehouseTransferStatus`. Lines carry from/to location + storage unit, shipped/received qty.
- **`stockTransfer*`** — intra-location moves (separate from warehouse transfers).
- **`pickMethod`** — default storage unit for picking an item at a location (`defaultStorageUnitId`).
- **`itemPlanning`** / **`itemReplenishment`** — reorder/planning params and replenishment strategy.
- **`storageRule`** + assignment tables — renamed from `customRule`/`itemRule` (`20260603130000`).

`get_inventory_quantities(company_id TEXT, location_id TEXT, item_id TEXT DEFAULT NULL)` — the central
read. Newest definition is `20260713235406_item-ledger-snapshot.sql` (snapshot + delta via
`itemLedgerSnapshot`; `item_id` restricts to one item for detail-page loads). Returns ~52 cols:
item identity + material props, planning fields, and quantities `quantityOnHand`, `quantityOnHold`,
`quantityRejected` (status-aware: excludes `Rejected`, surfaces `On Hold`), `quantityOnSalesOrder`,
`quantityOnPurchaseOrder`, `quantityOnProductionOrder`, `quantityOnProductionDemand`, `demandForecast`,
`usageLast30Days`, `usageLast90Days`, `daysRemaining`, plus `storageTypeIds`/`storageUnitIds` arrays.
Aggregates from `itemLedger`, open `purchaseOrder(Line)`, `salesOrder(Line)`, `job`/`jobMaterial`,
and `demandForecast`/`demandActual`.

Relevant enums: `itemLedgerType`, `itemLedgerDocumentType`, `trackedEntityStatus`
(`Available`, `Reserved`, `On Hold`, `Consumed`, `Rejected`), `warehouseTransferStatus`,
`itemTrackingType`, `itemReplenishmentSystem`, `itemReorderingPolicy`.

## Gotchas

- **Migrations are timestamp-ordered; tables get renamed.** `shelf`→`storageUnit`/`shelfId`→`storageUnitId`,
  `customRule`→`storageRule`. Grep the NEWEST migration for the real name; never trust an older one or the
  old cache. The `shelf`→`storageUnit` rename was split across paired migrations
  `20260417000100` (rename, M2) + `..000300` (recreate dependents, M4) — they must apply together.
- **Short-closed PO lines don't count as incoming supply.** `get_inventory_quantities`,
  `get_job_quantity_on_hand`, and the `openPurchaseOrderLines` view (MRP) all filter open-PO supply with
  `pol."receivedComplete" = false` (`20260708204214`). A line short-closed via
  `shortClosePurchaseOrderLine` ("Stop Receiving") keeps `quantityToReceive > 0` but is excluded from
  `quantityOnPurchaseOrder`.
- **`get_inventory_quantities` has many revisions.** Always read the newest (`20260713235406`), not the
  first match. `quantityOnHand` is status-aware: `Rejected` tracked entities are excluded, and tracked
  rows are always computed live (never from `itemLedgerSnapshot`) so status flips are never stale.
- **The auto-generated MCP reference (`.ai/rules/mcp-tools-reference.md`) is stale** for storage units —
  it still lists `getShelf`/`getDefaultShelfForJob`. The real service exports `getStorageUnit*` /
  `getDefaultStorageUnitForJob`. Trust the service file.
- On-hand math comes from `itemLedger` (and the `get_inventory_quantities` RPC), not from summing
  `trackedEntity` directly. The old `itemInventory` table is orphaned (trigger dropped
  `20250209170952`) — never read or write it.
