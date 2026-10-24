# Inventory Module

Tracks item quantities across locations and storage units. Manages receipts, shipments, stock transfers, warehouse transfers, kanbans, picking lists, serial/batch/lot tracking, storage types, and traceability (lineage graphs).

## Key Domain Concepts

- **Storage Unit** — hierarchical container (bin, shelf, rack, zone) within a location. Tree structure via `parentId`. Renamed from `shelf` in migration `20260417000100`. MUST use `storageUnit` naming, never `shelf`. Bulk **CSV import** is wired via the shared import system (`table: "storageUnit"`, permission `inventory`): fields `id`, `name`, `locationId`, `parentName`, `storageTypeNames`, `active`; matched on `(locationId, lower(name))` since names are unique per location, parents linked in a second pass. See `.claude/rules/csv-import-system.md`.
- **Tracked Entity** — serial/batch/lot-tracked item instance with `readableId` (serial or batch number), `status` (Available/Reserved/On Hold/Consumed/Rejected/Scrapped), `quantity`, and `expirationDate`. `Scrapped` is terminal but recoverable via the Unscrap adjustment. Batch items have `batchProperty` definitions. A serialized unit can leave stock as a fixed asset: the storage-unit row action **Capitalize as Fixed Asset** (`ui/Inventory/InventoryStorageUnits.tsx`, rows with a `trackedEntityId`, needs `create: accounting`) opens `path.to.fixedAssetCapitalize` with `itemId`, `trackedEntityId`, `locationId` and `storageUnitId` as search params; `postAssetTransfer` (`accounting.service.ts`, ported from the `post-asset-transfer` server function) then consumes the unit (`Consumed`, `attributes["Fixed Asset"]`, a `'Capitalize'` `trackedActivity`, `itemLedger` −1 `'Asset Transfer'`) at its carrying cost, and **Return to Inventory** on the asset brings the same unit back `Available` at net book value. See `.claude/rules/fixed-asset-lifecycle.md`.
- **Item Ledger** — append-only log of every inventory movement (`itemLedger` table). Source of truth for on-hand quantities. MUST never INSERT directly — always go through service functions.
- **Receipt** — inbound inventory from POs, transfers, customer RMAs (source "Sales Return Order"), or rental units coming back (source "Rental Agreement"). Lines link to `purchaseOrderLine`, jobs, or `salesReturnOrderLine`. Posting creates ledger entries and tracked entities; RMA receipts re-enter at the original outbound cost (shipment consumption rows), current cost for blind returns, or zero when the return reason flags `inventoryValueZero`, and reactivate the SAME tracked entity On Hold (ReturnEntityForm re-tags the Consumed entity instead of minting a new serial). A rental receipt holds no `receiptLine`: each unit is a `receiptFixedAssetLine` with `rentalAgreementLineId`, and posting returns the unit on its agreement and moves its `fixedAsset.locationId` to the receipt's location, with no `itemLedger` row or journal for a `Rental` line (see sales AGENTS → Rentals → Deliver and return). A rental receipt cannot be voided.
- **Shipment** — outbound inventory to customers, or return flows: source "Purchase Return Order" ships supplier returns (Cr Inventory / Dr GRNI at carried cost; a line linked to an issue whose inspection reject wrote off a non-tracked lot first puts those units back — `getReturnLineWriteOffs`, a Positive Adjmt. under the shipment at the write-off's own cost, Dr Inventory / Cr Scrap — so they are relieved once, and the void writes them off again), source "Sales Return Order" ships rejected RMA claims back to the customer (On Hold entities allowed in lines.tracking for that source only), source "Rental Agreement" delivers rental units: each unit is a `shipmentFixedAssetLine` with `rentalAgreementLineId`, posting puts it On Rent and writes no `itemLedger`, `costLedger` or journal row, and its PDF prints as a "Delivery Ticket".
- **Stock Transfer** — moves inventory between storage units within the same location. A transfer with `kanbanId` set is a kanban replenishment (written by `replenishKanban` (`inventory.service.ts`, ported from the `kanban-replenish` server function)); the list shows it as Source "Kanban".
- **Warehouse Transfer** — moves inventory between locations (inter-location).
- **Picking List** — generated pick instructions with FEFO/FIFO ordering and tracked entity allocation.
- **Kanban** — pull-based replenishment signal (Buy, Make, or Transfer between storage units). A Transfer kanban with `replenishmentLevel` also fires automatically when the projected quantity at its To storage unit drops below the level. See `.claude/rules/kanban-system.md`.
- **Inventory Count** — physical/cycle count. Posted is terminal (there is no count-level "Rectify" — fixing a posted movement happens per-movement via `correctStockMovement`). Created with an optional scope (`storageUnitIds` + `itemType`) recorded in the header's `scope` JSONB (written at create; not yet read back). `generateInventoryCountLines` snapshots on-hand into `inventoryCountLine` rows, **excluding Rejected AND Consumed tracked lots**. The count **detail** table filters lines by item type / storage unit / storage type / tags / material attributes via the `inventoryCountLines` **view** (line → item → subtype tables → storageUnit, flattened) — the same generic column-filter set the quantities screen uses. There is no material-attribute scope at create time.

## Safety

### Always
- MUST use `adjustInventory` for quantity changes — it runs the storage rules, then `insertManualInventoryAdjustment`, which creates proper ledger entries and handles tracked entity updates.
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
| `itemStockQuantities` | On-hand per (item, company, location) — a real TABLE maintained transactionally by a statement-level event handler on `itemLedger` (`apply_item_stock_quantities`, attached via `attach_statement_handler`; was a 30-min-refresh matview until `20260812002454`). Excludes `Rejected` tracked stock. Never write to it directly — it is derived state; the nightly `reconcile-item-stock-quantities` cron repairs any drift. Read by the item-dropdown store (with realtime push), the workflow engine's `item.quantityOnHand`, and MRP's on-hand input |
| `storageUnit` | Hierarchical bins/shelves via `parentId`; scoped to location |
| `storageType` | Storage unit type definitions (capacity, constraints) |
| `trackedEntity` | Serial/batch/lot instances with readableId, status, quantity, expirationDate |
| `receipt` / `receiptLine` | Inbound documents from POs or production |
| `receiptFixedAssetLine` | One fixed asset per row on a receipt: `purchaseOrderLineId` (a PO receipt) XOR `rentalAgreementLineId` (a rental receipt; CHECK `receiptFixedAssetLine_source_check`), `received`, `serialNumber`. The rental return fields: `meter`, `notes`, `takeOutOfService` + `outOfServiceReason` (CHECK: a tick needs a reason; the UI saves both as one `outOfService` field), `residualDestination` (`Fleet` / `Inventory`, a `Sale` line only). Edited through `updateReceiptFixedAssetLine` (`receiptFixedAssetLineUpdateValidator`), which refuses a line on a non-Draft receipt |
| `shipment` / `shipmentLine` | Outbound documents to customers |
| `shipmentFixedAssetLine` | One fixed asset per row on a shipment: `salesOrderLineId` (a sales order shipment) XOR `rentalAgreementLineId` (a rental shipment; CHECK `shipmentFixedAssetLine_source_check`), `shipped`, `serialNumber`, and `meter` (a rental unit's meter out). Edited through `updateShipmentFixedAssetLine` (`shipmentFixedAssetLineUpdateValidator`), which refuses a line on a non-Draft shipment. A reader that means a sales order line filters `salesOrderLineId IS NOT NULL` |
| `stockTransfer` / `stockTransferLine` | Intra-location moves between storage units; `stockTransfer.kanbanId` marks a kanban replenishment |
| `warehouseTransfer` / `warehouseTransferLine` | Inter-location moves |
| `kanban` | Pull-based replenishment signals; `replenishmentLevel` arms a Transfer kanban |
| `batchProperty` | Custom property definitions for batch-tracked items |
| `pickingList` / `pickingListLine` | Pick instructions with tracked entity allocation |
| `pickMethod` | Default storage unit and pick strategy per item at a location |

## Operations (`inventory.server.ts`)

Each operation is one `defineServiceFn` const in `inventory.server.ts`. A route action calls it through `carbon(request)` as `api.inventory.<name>(input)` and makes no other write (one route is left: `api+/kanban.collision.$id.tsx` still clears the job with `updateKanbanJob` from `production.service.ts`). A document id comes from the URL, never the form body; the API and MCP publish the ones tagged `@mcp` as `inventory_<name>`. Every check the route used to make is in the function.

| Operation | Route | What it holds |
|---|---|---|
| `createReceipt` / `createShipment` | `receipt+/new.tsx`, `shipment+/new.tsx` | The `create` posting for the source document; a return order or rental agreement with a Draft document returns that one. A sales or purchase order shipment needs the caller's default location |
| `updateReceipt` / `updateShipment` | `$receiptId.details.tsx`, `$shipmentId.details.tsx` | A changed source or location rebuilds the lines; a rental document keeps its agreement |
| `postReceipt` / `postShipment` | `$receiptId.post.tsx`, `$shipmentId.post.tsx` | Storage rules (and over-receipt, and the order's sales rules), Pending, the posting, back to Draft on failure, labels, lead times, the workflow moment. A shipment also applies the expired-batch policy and saves the packing slip (`packing-slip.pdf.tsx`, shared with `file+/shipment+/$id[.]pdf.tsx`) |
| `voidReceipt` / `voidShipment` | `$receiptId.void.tsx`, `$shipmentId.void.tsx` | Posted only; not a receipt a purchase invoice created. A receipt void also refuses stock that has left its bin since posting and an untracked lot an inspection rejected; the refusal reaches the caller in its own words |
| `splitReceiptLine`, `updateReceiptLines`, `updateReceiptFixedAssetLine` (and the shipment twins) | `lines.split.tsx`, `lines.update.tsx`, `fixed-asset-lines.update.tsx` | A fixed-asset line changes only on a Draft document |
| `setReceiptLineBatch` / `setReceiptLineSerial` / `assignReceiptReturnEntity` / `removeReceiptReturnEntity` | `receipt+/lines.tracking.tsx` (one per `trackingType` / `intent`) | Batch and serial numbers; a sales return re-tags the Consumed entity the customer sent back |
| `assignShipmentLineEntity` | `shipment+/lines.tracking.tsx` | The line's item, in a status `shippableEntityStatuses` (`inventory.utils.ts`) allows: Available; On Hold, received on this return order, for a return-to-customer shipment; Available, or Rejected and received on a posted receipt from the return's supplier, for a return-to-supplier shipment |
| `createStockTransfer` / `setStockTransferStatus` | `stock-transfer+/new.tsx`, `$id.status.tsx` | Storage rules on `stockTransfer`; reopening a Completed transfer needs `delete: inventory` |
| `pickStockTransferLine` / `unpickStockTransferLine` / `pickStockTransferLineEntity`, `updateStockTransferLines` | `$id.line.quantity.tsx` (0 unpicks), `$id.scan.$lineId.tsx`, `lines.update.tsx` | `postStockTransfer` (`inventory.service.ts`, ported from `post-stock-transfer`); a Completed transfer is refused; a scanned pick never exceeds what is left |
| `setWarehouseTransferStatus`, `createWarehouseTransferLine` / `updateWarehouseTransferLine` / `removeWarehouseTransferLine` | `$transferId.status.tsx`, `$transferId.details.new.tsx`, `$transferId.details.$id.tsx` | Storage rules on `warehouseTransfer`; lines change only on a Draft transfer |
| `createInventoryCount` / `postInventoryCount` | `inventory+/inventory-count.new.tsx`, `inventory-count+/$id.post.tsx` | A failed snapshot deletes the count; `service.postInventoryCount` (ported from `post-inventory-count`) posts it, and lines that cannot post come back as `invalidLineIds` |
| `adjustInventory` | `inventory+/quantities+/$itemId.adjustment.tsx` | Storage rules on `inventoryAdjustment`, plus `pick` or `place` at a bin; a serial item (read from the item) moves at most one unit |
| `removeStorageUnit` | `inventory+/storage-units.delete.$storageUnitId.tsx` | `cascade` deletes the subtree |
| `deleteReceipt` / `deleteShipment`, `deleteReceiptLine` / `deleteShipmentLine` | `$receiptId.delete.tsx`, `$shipmentId.delete.tsx`, `lines.$id.delete.tsx` | A document is refused once posted (`postingDate` set). Deleting a shipment line also needs `delete: sales` (the `shipmentLine` RLS) |
| `insertWarehouseTransfer` / `updateWarehouseTransfer` / `deleteWarehouseTransfer` | `warehouse-transfer+/new.tsx`, `$transferId.details.tsx`, `$transferId.delete.tsx` | A transfer is created Draft and an edit never writes its status (only `setWarehouseTransferStatus` moves it); an edit needs a Draft transfer |
| `createStockTransferLine` / `updateStockTransferLine` / `deleteStockTransferLine` / `deleteStockTransfer` | `stock-transfer+/$id.line.*`, `delete.$id.tsx` | Draft transfer only (the transfer in the URL); a line's picked quantity moves only by picking. An update needs `create` and `update: inventory`, as the old route did |
| `updateInventoryCountStatus` | `inventory-count+/$id.confirm.tsx`, `$id.reopen.tsx` | Draft → Pending or Pending → Draft; only `postInventoryCount` posts |
| `updateInventoryCountLine` / `deleteInventoryCount` | `inventory-count+/lines.update.tsx`, `$id.delete.tsx` | A line changes only on a Draft count (else `conflict`), counted by the caller; a Posted count is not deleted |
| `setPickingListStatus` / `updatePickingList` | `picking-list+/$pickingListId.status.tsx`, `$pickingListId.update.tsx` | Reopening a closed list needs `delete: inventory`; finishing applies `finishPickingList` (the incomplete-list policy: refuse, or `needsAcknowledgement` until acknowledged; Partial when anything is left or short). Details change only on a Draft list |
| `pickPickingListLineChecked` / `pickPickingListLineEntity` | `$pickingListId.line.quantity.tsx`, `$pickingListId.tracked.$lineId.tsx` | The line must be on the list; then `pickPickingListLine` / `setPickingListLineTrackedEntity` as the system |
| `createKanban` / `updateKanban` / `deleteKanban`, `createStorageUnit` / `updateStorageUnit`, `createShippingMethod` / `updateShippingMethod` / `deleteShippingMethod` | `inventory+/kanbans.*`, `storage-units.*`, `shipping-methods.*` | Row edits. A modal create returns the new row; a drawer redirects to its list |
| `createStorageType` / `updateStorageType` / `deleteStorageTypeWithCascade` | `inventory+/storage-types.*` | `parts` permissions (the `storageType` RLS). A type storage units still have is deleted only with `cascade`, which needs `update: parts` and takes it off them in one transaction |
| `upsertBatchProperty` / `updateBatchPropertyOrder` / `deleteBatchProperty` | `inventory+/batch-property+/*` | `update: inventory`; a new property also needs `create` on parts or inventory (RLS) |
| `generatePickingList` / `deletePickingList` | `picking-list+/new.tsx`, `$pickingListId.delete.tsx` | — |
| `correctStockMovement`, `updateTrackedEntityExpiry`, `createInventoryReconciliationJournal` | `stock-movements+/$ledgerId.correct.tsx`, `tracked-entity.expiry.tsx`, `reports+/inventory-valuation.reconcile.tsx` | See Key Service Functions; the reconcile journal needs `create: accounting` |
| `scanKanban` | `api+/kanban.$id.tsx` (the card's QR code; a GET, employees only) | Make: a job (auto-release: the release checks, then `releaseCheckedJobs` and the schedule; a refused job stays Draft and the scan returns a `message`); Buy: a line on the supplier's open Draft / Planned PO or a new one; Transfer: `kanban-replenish` as the scanner. Returns what it made; the route picks the page |

A blocking rule is data, not an error: `post`, `create`, `setStatus` and `adjust` return `{ violations, ruleNames }` and change nothing; the route returns it to `useRuleViolations`, which re-sends with `acknowledged: true`. The primitives they replaced are no longer published (`insertManualInventoryAdjustment`, `insertInventoryCount`, `upsertReceipt`, `updatePickingListStatus`, `upsertPickingList`, `pickPickingListLine`, `setPickingListLineTrackedEntity`, `upsertShipment`, `insertStockTransfer`, `updateStockTransferStatus`, `updateWarehouseTransferStatus`, `upsertWarehouseTransferLine`, `deleteWarehouseTransferLine`, `deleteStorageUnit`, `deleteStorageUnitCascade`).

## Key Service Functions

- `getInventoryItems` / `getInventoryItemsCount` — calls `get_inventory_quantities` RPC for on-hand quantities
- `getItemLedgerPage` (`inventory.service.ts`) / `getItemLedgerActivity` (`inventory.utils.ts`) — paginated ledger history
- `getItemLedgerBalance` — `get_item_ledger_balance` RPC: on-hand right after one ledger entry, on the `quantityOnHand` definition (Rejected tracked stock counts zero). The item Activity feed fetches it ONCE for its newest loaded row; `withRunningBalance` (`ui/Inventory/ledgerFeed.ts`) derives every row's before → after from it as pages load, so paging adds no queries. Run it on raw rows, before `collapseTransferPairs`
- `insertManualInventoryAdjustment` — adjustments with tracked entity handling (called by `adjustInventory` after the storage rules); wraps the `post-inventory-adjustment` posting, which maintains cost layers and posts the journal (`inventoryAdjustmentVarianceAccount`, seeded 5310, against the raw materials or finished goods account) in one transaction for every company. The journal is Provisional before the accounting cutover and Posted after it (`journalPostingStatus`). An increase with no value posts no journal; a decrease always writes its pair, at zero too, so the enable's re-cost can find it. Storage-unit transfers post no journal
- `getSerialUnitCosts` / `recostSerialUnit` (operations in `inventory.server.ts`) — run `service.previewSerialUnitCosts` (each on-hand serial's carrying cost, `view: accounting`; read by the Storage Units card through `api+/items.$itemId.serial-costs.ts`) and `service.recostSerialUnit` (re-book ONE serial's FIFO / LIFO layer at a new cost, journal vs an offset account, `update: accounting`; route `x+/inventory+/quantities+/$itemId.recost.tsx`), both ported from server functions. See `.claude/rules/inventory-system.md` → Serial unit cost and Recost
- `correctStockMovement` — the operation settles `postStockMovementCorrection` (`inventory.service.ts`, ported from the `correct-stock-movement` server function) directly, so its refusal keeps its message: fixes a posted `itemLedger` row by booking ONE opposite (delta) movement linked via `correctionOfItemLedgerId`, dated with the original's `postingDate` and posted into the original's accounting period (fails if Locked/Closed). The delta is derived against the movement's current effective quantity (original + prior corrections), so repeat corrections converge
- `getStorageUnit(s)` / `getStorageUnitTree` / `getStorageUnitsTreeForLocation` — storage hierarchy
- `getAvailableTrackedEntities` — calls `get_available_tracked_entities` RPC
- `getReceipts` / `getReceiptLines` / `reconcileReceiptSerialEntities` — receipt management. `reconcileReceiptSerialEntities` (Kysely, its own transaction; `reconcileReceiptSerialsInTransaction` inside a caller's) drops serials beyond the received quantity (run on post, and in the same transaction as a quantity change in `updateReceiptLines`) and returns the lines still missing serials, which the post refuses
- `releaseReceiptSerialEntities` (`@carbon/database/receipt-serials`, shared with the receipt line split, `receiptLineSplit` in `shared.service.ts`) — the one way a receipt serial is removed, run inside a Kysely transaction: an entity with no `itemLedger` history is deleted, one with history only loses its receipt link in one set-based update. A serial box save is planned by the pure `planSerialBoxWrite` (`inventory.models.ts`)
- `getShipments` / `getShipmentLines` / `getShipmentRelatedItems` — shipment management
- `getRentalShipmentLines` / `getRentalReceiptLines` — a rental document's asset lines with their rental line, fleet asset, item and tracked entity; the `$shipmentId.tsx` / `$receiptId.tsx` loaders call them for the `'Rental Agreement'` source and pass them as `rentalLines` (sorted by asset id, else unit name) to `ShipmentRentalLineItem` / `ReceiptRentalLineItem`. Both readers order by `createdAt, id`: a document's units are inserted in one statement and share a `createdAt`
- `getReceiptRelatedItems` / `getWarehouseTransferRelatedItems` / `getPickingListRelatedItems` — the `DocumentPage` Documents panels (receipt invoices + a sales return's customer; a transfer's shipments and receipts; a picking list's jobs). Query errors are logged and degrade to empty lists
- `generatePickingList` / `getPickingListAvailability` / `getPickingSchedule` — picking operations
- `getDefaultStorageUnitOrStorageUnitWithHighestQuantity` — picking defaults
- `getTrackedEntities` / `getTrackedEntityExpirations` / `getShelfLifeForItems` — tracking and expiry
- `generateInventoryCountLines` — Kysely; aggregates `itemLedger` on-hand into `inventoryCountLine` rows, scoped by the optional `storageUnitIds` + `itemType`. Excludes `Rejected` and `Consumed` tracked lots (status-aware, matching `quantityOnHand`); non-tracked rows (NULL status) always included. `getInventoryCountLines` reads the `inventoryCountLines` view (joins item + subtype tables on `id = item."readableId"` — the same predicate `get_inventory_quantities` uses, all LEFT — + `storageUnit`) so the detail table can apply generic column filters on flat columns.

## Key Exports

```typescript
import { getInventoryItems, insertManualInventoryAdjustment } from "~/modules/inventory/inventory.service";
import { inventoryAdjustmentValidator, receiptValidator } from "~/modules/inventory/inventory.models";
```

## Storage Rules (sub-area)

Configurable if-condition-then-error/warn rules evaluated on **warehouse/MES transaction surfaces** (the storage-legal subset of `enforcementRuleSurface`: receipt, shipment, stockTransfer, warehouseTransfer, inventoryAdjustment, place, pick, operationStart, operationFinish, materialIssue, materialReceive). Lives **inside** this module: validators in `inventory.models.ts`, UI in `ui/StorageRules/`; the admin CRUD is the family-parametrized implementation in `shared.service.ts` (see "Service functions" below). There is no `modules/storage-rules` directory — a rule feature is not its own domain.

Sibling feature to **sales rules** (`~/modules/sales`, sales-document surfaces). Both share the engine in `@carbon/utils` (`rules.ts` + `field-registry.ts` + the zod AST mirror in `rules-schema.ts`), the evaluator/violation UI in `@carbon/ee/rules(.server)`, AND the `enforcementRule` table — one table for both families, discriminated by `family`.

- **Rule** — `enforcementRule` row (`family = 'storage'`; the table is shared with sales rules, so every read/write here MUST filter `family = 'storage'`): `conditionAst` JSONB, `severity` (`error` blocks; `warn` blocks until acknowledged), `targetType` (`item` | `workCenter`, enum `enforcementRuleTargetType`), `surfaces`, `appliesToAll` (workCenter broadcast gate) and the `filteredItem*` columns (item scoping). Assignments are polymorphic across `enforcementRuleItemAssignment` / `enforcementRuleWorkCenterAssignment` — `targetType` picks the table. The item table is shared with the sales family: resolve pinned rules against a family-filtered fetch, never a PostgREST embed.
- **Evaluator** — `@carbon/ee/rules.server`: `evaluateLinesForSurface`, `isBlocked`, `dedupeViolations`, plan gate `isStorageRulesEnabledForCompany`. Its item load swallows query errors, which silently skips every broadcast rule — a known gap kept for behavior compatibility (see the comment at the call site). New evaluators must throw instead.
- **One modal** — posting actions return `{ violations, ruleNames }`; callers submit via `useRuleViolations` and render `RuleViolationModal`. Do not fork a second violation UI.

### Storage Rules safety

- The `ui/StorageRules/` components are the **shared** rule-builder surface — sales rules imports `RuleBuilder`, `SurfacesField`, `MessageWithTokens`, `SeveritySelect`, and `ItemFilterSelector` from here by deep path. Changes must stay backward-compatible; parameterize additively rather than rewriting.
- These components import other modules' code from the file that defines it (`~/modules/items/items.models`, …); modules have no barrel. `inventory` already depends on `items`, and the sales module imports these components for its SalesRules UI. `StorageRules` is deliberately **not** re-exported from `ui/index.ts`, so that import cannot create a cycle through the inventory UI.
- `getEnforcementRuleAssignmentCounts` (`shared.service.ts`) spans BOTH assignment tables — a rule lives in exactly one, so the union of single-table counts is correct. Rule ids are globally unique, so counting by id needs no family predicate even though the item table is shared.
- Never widen the `enforcementRule_storage_surfaces` CHECK to admit sales-document surfaces — that CHECK is what replaced the old per-family enum typing.

Service functions: the admin CRUD is NOT in `inventory.service.ts`. The read helpers (`getEnforcementRules` / `getEnforcementRule` / `getEnforcementRuleAssignmentCounts`) share one parametrized implementation in `shared.service.ts`, called with `"storage"` as the family. The entitlement-gated WRITES (`upsertEnforcementRule` / `deleteEnforcementRule`) moved to `@carbon/ee/rules.server` (`packages/ee/src/rules/service.server.ts`) — they embed `requireEntitlement("STORAGE_RULES")`. Cross-app READ queries `getActiveRulesForTargets` / `getRuleAssignmentsForTarget` / `getStorageRulesList` are imported from `@carbon/ee/rules` DIRECTLY at the call site; the gated writes `assignStorageRule` / `unassignStorageRule` are imported from `@carbon/ee/rules.server` at the call site too. Routes: `x+/inventory+/storage-rules*`, plus assignment routes under `x+/items+/rules.*` (item targets) and `x+/resources+/work-centers.rules.*` (work-center targets).

## Related Modules

- **purchasing** — receipts consume PO lines; receipt posting updates `purchaseOrderLine.quantityReceived`
- **production** — job completion posts finished goods; materials issued from inventory (a Make to Asset job completes to `fixedAsset` rows and writes no `itemLedger`)
- **accounting** — a serialized unit moves between stock and the fixed asset register through `post-asset-transfer` (Capitalize as Fixed Asset / Return to Inventory); the `fleetAssets` view joins `fixedAsset` to `item` and `trackedEntity`
- **items** — `itemTrackingType` (Inventory/Serial/Batch/Non-Inventory) determines tracking behavior
- **sales** — shipments fulfill sales order lines
- **quality** — inbound inspections triggered on receipt for items with a Receipt-usage inspection-document assignment

## Rules References

- `.claude/rules/inventory-system.md` — comprehensive guide to inventory code, RPCs, storage units, and gotchas
- `.claude/rules/traceability-model.md` — serial/batch lineage graph model (trackedEntity/trackedActivity)
