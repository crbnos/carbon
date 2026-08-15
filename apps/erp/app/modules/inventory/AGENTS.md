# Inventory Module

Tracks item quantities across locations and storage units. Manages receipts, shipments, stock transfers, warehouse transfers, kanbans, picking lists, serial/batch/lot tracking, storage types, and traceability (lineage graphs).

## Key Domain Concepts

- **Storage Unit** — hierarchical container (bin, shelf, rack, zone) within a location. Tree structure via `parentId`. Renamed from `shelf` in migration `20260417000100`. MUST use `storageUnit` naming, never `shelf`.
- **Tracked Entity** — serial/batch/lot-tracked item instance with `readableId` (serial or batch number), `status` (Available/Reserved/On Hold/Consumed/Rejected/Scrapped), `quantity`, and `expirationDate`. `Scrapped` is terminal but recoverable via the Unscrap adjustment. Batch items have `batchProperty` definitions.
- **Item Ledger** — append-only log of every inventory movement (`itemLedger` table). Source of truth for on-hand quantities. MUST never INSERT directly — always go through service functions.
- **Receipt** — inbound inventory from POs or production. Lines link to `purchaseOrderLine` or jobs. Posting creates ledger entries and tracked entities.
- **Shipment** — outbound inventory to customers. Lines link to sales order lines.
- **Stock Transfer** — moves inventory between storage units within the same location.
- **Warehouse Transfer** — moves inventory between locations (inter-location).
- **Picking List** — generated pick instructions with FEFO/FIFO ordering and tracked entity allocation.
- **Kanban** — pull-based replenishment signal between storage units.
- **Inventory Count** — physical/cycle count. Posted is terminal (there is no count-level "Rectify" — fixing a posted movement happens per-movement via `correctStockMovement`). Created with an optional scope (`storageUnitIds` + `itemType`) recorded in the header's `scope` JSONB (written at create; not yet read back). `generateInventoryCountLines` snapshots on-hand into `inventoryCountLine` rows, **excluding Rejected AND Consumed tracked lots**. The count **detail** table filters lines by item type / storage unit / storage type / tags / material attributes via the `inventoryCountLines` **view** (line → item → subtype tables → storageUnit, flattened) — the same generic column-filter set the quantities screen uses. There is no material-attribute scope at create time.

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
| `itemStockQuantities` | On-hand per (item, company, location) — a real TABLE maintained transactionally by a statement-level event handler on `itemLedger` (`apply_item_stock_quantities`, attached via `attach_statement_handler`; was a 30-min-refresh matview until `20260812002454`). Excludes `Rejected` tracked stock. Never write to it directly — it is derived state; the nightly `reconcile-item-stock-quantities` cron repairs any drift. Read by the item-dropdown store (with realtime push), the workflow engine's `item.quantityOnHand`, and MRP's on-hand input |
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
- `correctStockMovement` — wraps the `correct-stock-movement` edge function: fixes a posted `itemLedger` row by booking ONE opposite (delta) movement linked via `correctionOfItemLedgerId`, dated with the original's `postingDate` and posted into the original's accounting period (fails if Locked/Closed). The delta is derived against the movement's current effective quantity (original + prior corrections), so repeat corrections converge
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

## Storage Rules (sub-area)

Configurable if-condition-then-error/warn rules evaluated on **warehouse/MES transaction surfaces** (`transactionSurface`: receipt, shipment, stockTransfer, warehouseTransfer, inventoryAdjustment, place, pick, operationStart, operationFinish, materialIssue, materialReceive). Lives **inside** this module: validators in `inventory.models.ts`, CRUD in `inventory.service.ts`, UI in `ui/StorageRules/`. There is no `modules/storage-rules` directory — a rule feature is not its own domain.

Sibling feature to **sales rules** (`~/modules/sales`, sales-document surfaces). Both share the engine in `@carbon/utils` (`rules.ts` + `field-registry.ts` + the zod AST mirror in `rules-schema.ts`) and the evaluator/violation UI in `@carbon/ee/rules(.server)` — the code layer is unified under neutral `rules` naming while the tables stay separate.

- **Rule** — `enforcementRule` row (`family = 'storage'`; the table is shared with sales rules, so every read/write here MUST filter `family = 'storage'`): `conditionAst` JSONB, `severity` (`error` blocks; `warn` blocks until acknowledged), `targetType` (`item` | `workCenter`, enum `enforcementRuleTargetType`), `surfaces`, `appliesToAll` (workCenter broadcast gate) and the `filteredItem*` columns (item scoping). Assignments are polymorphic across `enforcementRuleItemAssignment` / `enforcementRuleWorkCenterAssignment` — `targetType` picks the table. The item table is shared with the sales family: resolve pinned rules against a family-filtered fetch, never a PostgREST embed.
- **Evaluator** — `@carbon/ee/rules.server`: `evaluateLinesForSurface`, `isBlocked`, `dedupeViolations`, plan gate `isStorageRulesEnabledForCompany`.
- **One modal** — posting actions return `{ violations, ruleNames }`; callers submit via `useRuleViolations` and render `RuleViolationModal`. Do not fork a second violation UI.

### Storage Rules safety

- The `ui/StorageRules/` components are the **shared** rule-builder surface — sales rules imports `RuleBuilder`, `SurfacesField`, `MessageWithTokens`, `SeveritySelect`, and `ItemFilterSelector` from here by deep path. Changes must stay backward-compatible; parameterize additively rather than rewriting.
- These components must NOT import a module barrel (`~/modules/inventory`, `~/modules/items`, or `~/modules/sales`) — deep file imports only. `inventory` already depends on `items`, and the sales module imports these components for its SalesRules UI, so a barrel import would create a cycle. `StorageRules` is deliberately **not** re-exported from `ui/index.ts` for the same reason.
- `getRuleAssignmentCounts` spans BOTH assignment tables — a rule lives in exactly one, so the union of single-table counts is correct.
- Never widen the `enforcementRule_storage_surfaces` CHECK to admit sales-document surfaces — that CHECK is what replaced the old per-family enum typing.

Service functions: `getStorageRules` / `getStorageRule` / `upsertStorageRule` / `deleteStorageRule` / `getRuleAssignmentCounts`; cross-app `getActiveRulesForTargets` / `getRuleAssignmentsForTarget` / `getStorageRulesList` / `assignStorageRule` / `unassignStorageRule` re-exported from `@carbon/ee/rules` through the module barrel. Routes: `x+/inventory+/storage-rules*`, plus assignment routes under `x+/items+/rules.*` (item targets) and `x+/resources+/work-centers.rules.*` (work-center targets).

## Related Modules

- **purchasing** — receipts consume PO lines; receipt posting updates `purchaseOrderLine.quantityReceived`
- **production** — job completion posts finished goods; materials issued from inventory
- **items** — `itemTrackingType` (Inventory/Serial/Batch/Non-Inventory) determines tracking behavior
- **sales** — shipments fulfill sales order lines
- **quality** — inbound inspections triggered on receipt for items with a Receipt-usage inspection-document assignment

## Rules References

- `.claude/rules/inventory-system.md` — comprehensive guide to inventory code, RPCs, storage units, and gotchas
- `.claude/rules/traceability-model.md` — serial/batch lineage graph model (trackedEntity/trackedActivity)
