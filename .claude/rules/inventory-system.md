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
  (args `{ location_id, company_id }`, plus `project_id` from `getInventoryItems`'s
  `projectId`; `count: "exact"`); supports search + generic filters.
- `getItemLedgerPage` — paginated item-ledger history for an item at a location.
- `insertManualInventoryAdjustment` — thin wrapper over the **`post-inventory-adjustment`
  server function** (MES has a matching wrapper in `apps/mes/app/services/inventory.service.ts`).
  The server function owns positive/negative/set-quantity **plus Scrap/Unscrap**
  (`.ai/specs/2026-08-06-scrap-unscrap-flow.md`) resolution, tracked-entity storage-unit
  transfers, expiry override, batch/serial assignment — and, in one Kysely transaction, maintains
  `costLedger` layers (consume via `calculateCOGS` on decreases, new layer at current cost on
  increases) and posts a journal (Dr/Cr `resolveInventoryAccount` vs
  `accountDefault.inventoryAdjustmentVarianceAccount`) when `companySettings.accountingEnabled`.
  `post-inventory-count` books its variances through the same shared core
  (`packages/server-functions/src/lib/post-adjustment.ts`). Storage-unit transfers post no GL.
  **Serial units are costed by specific identification.** `costLedger.trackedEntityId`
  (migration `20261006220601`) stamps a layer booked for ONE serial unit — every layer
  `bookAdjustment` writes for a `Serial` item (a fixed asset returned to stock at NBV, a
  sales-type lease residual, an unscrap, a positive adjustment). `calculateCOGS` takes
  optional `trackedEntityIds` and orders FIFO / LIFO layers through
  `orderLayersForConsumption` (`packages/server-functions/src/lib/cost-layer-order.ts`): the leaving unit's own layer
  first, then unstamped layers, then another unit's stamped layer as the last resort (so
  nothing else eats a returned unit's value). Callers passing the ids: `bookAdjustment`
  decreases, the three `post-shipment` COGS calls (`leavingTrackedEntityIds` over the
  shipment's ledger rows) and `issue`'s `createMaterialWipEntries`. Receipt and job-output
  layers cover many units and stay unstamped, so a received serial is still FIFO-costed.
  Pinned by `lib/cost-layer-order.test.ts` and the database test
  `lib/calculate-cogs.test.ts`. **Children of a layer** (`appliesToCostLedgerId`,
  `adjustment = true`: purchase price variance, a refurbishment's `Revaluation` and
  write-down) are applied with their parent. On an unstamped layer the children cover
  its units in turn (`createdAt` order, each only up to the quantity taken). On a layer
  stamped for one serial every child belongs to that unit and is applied in full. The SQL
  backflush (`backflush_job_materials`, migration `20261010012609`) follows the same rules:
  it issues only untracked material, so it takes unstamped layers first and a stamped
  layer last, and it applies every open child of a stamped layer in full. Pinned by
  `supabase/tests/backflush-layer-children.test.sql`.
  **Refurbishment** (`complete-service-order`, Field Service Phase C): a serial with no
  layer of its own gets one by a **split** of the layer `calculateCOGS` takes next
  (oldest unstamped under FIFO, newest under LIFO): 1 unit of quantity, remaining
  quantity and cost moves to a new stamped layer, and the unit's share of the source's
  open children moves with it (`planRefurbishmentCompletion`,
  `complete-service-order/plan.ts`). No value changes and no journal posts; the WIP then
  lands as a `Revaluation` child. **`get_inventory_valuation`** (migration
  `20261010002941_valuation-child-rows.sql`) counts only parent rows as layers and adds each
  open child's remaining cost to its parent; it counted an open child as a layer of its
  own before. The valuation
  workbench tie-out offers a **Reconcile** action (`createInventoryReconciliationJournal`) that
  drafts an adjusting journal for any residual pre-feature variance.
  **Scrap** = a `Negative Adjmt.` movement with `documentType='Scrap'` +
  `itemLedger.scrapReasonId`, offset to `accountDefault.scrapAccount` (fallback
  `inventoryAdjustmentVarianceAccount`), tracked entity → `Scrapped` (keeps its
  quantity; partial batch scrap splits per the identity-flip convention).
  **Unscrap** (Oracle Return-from-Scrap) restores a `Scrapped` entity to
  `Available` at the **original scrapped cost** (resolved from the scrap
  movement's `costLedger` via `resolve-unscrap-cost.ts`) and bin, linked by
  `correctionOfItemLedgerId`; ERP UI = the Unscrap row action on the tracked-
  entities table (`UnscrapModal`, no location and **no scrap reason** submitted —
  both resolved server-side; the reason is inherited from the original scrap
  movement so unscrap can't be mis-classified, and the UI collects only an
  optional comment).
  Scrap journals carry ScrapReason/WorkCenter/Employee dimensions; the single
  `scrapAccount` + dimensions replaces per-reason account mapping by design.
  The **ScrapReason** dimension is seeded active by default (a `dimension` row per
  company group, from `packages/database/src/seed-data.ts`; backfilled to existing groups by
  `20260808114732_backfill-scrap-reason-dimension.sql`). Like CustomerType/ItemPostingGroup
  it is entity-backed — its values resolve live from the `scrapReason` table via
  `getEntityDimensionValues`/`getEntityValuesByIds` (accounting.service.ts), so adding a
  scrap reason immediately makes it a selectable/taggable dimension value with no sync step.
  A tag is only written when the entity type has an **active** `dimension` row — a scrap
  posting's ScrapReason `extraDimension` is dropped in `post-adjustment.ts` if the dimension
  was deleted/deactivated for that company group.
- `correctStockMovement` — wraps the **`correct-stock-movement` server function**: fixes any
  posted `itemLedger` row by booking ONE opposite (delta) movement linked to the original's
  correction root via `itemLedger.correctionOfItemLedgerId`, carrying the ORIGINAL's
  `postingDate` and (when accounting is on) posting its journal into the period containing
  that date via `getAccountingPeriodForDate` (throws on Locked/Closed). The delta is
  `correctedQuantity − effective` (effective = root + all prior corrections in the group),
  so repeat corrections converge. `documentType`/`documentId` are copied from the original
  so document-scoped movement views keep including the fix. Entry point: "Correct Quantity"
  context action on `StockMovementsTable` → `stock-movements/$ledgerId/correct` route (whose
  loader returns the authoritative effective quantity for the modal pre-fill). Corrections
  render as normal flat rows with an `isCorrection` badge — no nesting/expandable grouping.
  Inventory counts have NO count-level rectify; Posted is terminal.
- Storage units: `getStorageUnit(s)`, `getStorageUnitRoots`, `getStorageUnitChildren`,
  `getStorageUnitTree`, `getStorageUnitsTreeForLocation`, `getDefaultStorageUnitForJob`,
  `getDefaultStorageUnitOrStorageUnitWithHighestQuantity` (these are the picking/job defaults).
- Tracking: `getTrackedEntities`, `getAvailableTrackedEntities` (RPC `get_available_tracked_entities`),
  `getSerialNumbersForItem`, `getBatchNumbersForItem`, `getShelfLifeForItems`, `getPickOrder` (FEFO/FIFO).
- Picking: `generatePickingList`, `getPickingListAvailability` (RPC `get_picking_list_availability`),
  `getPickingSchedule` (RPC `get_picking_schedule`). These honor `itemSupersession`
  (`20260730143512_picking-supersession.sql` + `inventory/supersession-pick.ts`
  `resolvePickTarget`): `Prefer New`/`Stock Only` redirect a pick to the effective successor
  (× `conversionFactor`); `Consume First` redirects only when the predecessor is out of warehouse
  stock; `No Stock` (and `Stock Only` without an effective successor) is dropped from the schedule
  and skipped in generation. Note picking's redirect rules differ from the MRP/job-creation map
  (`packages/database/src/supersession-pick.ts`, which redirects only `Consume First`/`Prefer New`) —
  for picking, `Stock Only` must not be picked for production. A substituted line's `itemId`
  differs from its `jobMaterial.itemId` (no new column); the availability RPC reports the
  line's OWN pick item's warehouse on-hand with NO successor fold-in — a substituted line
  already targets the successor, and folding successor stock into a line still targeting the
  predecessor would mask a real shortage and double-count the successor.

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
  from `itemStockQuantities` — since `20260812002454` a real TABLE maintained
  transactionally by a statement-level handler on `itemLedger`
  (`apply_item_stock_quantities`, attached via `attach_statement_handler`), no
  longer an approximate matview. Excludes `Rejected` tracked stock; exact, with a
  nightly `reconcile-item-stock-quantities` cron as drift backstop. Read by
  RealtimeDataProvider (with realtime push), the workflow engine's
  `item.quantityOnHand` operation, and MRP's on-hand input.
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
- **`enforcementRule`** + assignment tables — ONE table for storage and sales rules, discriminated by `family` (`20260817143022`/`20260817143512`). Storage-family reads must filter `family = 'storage'`. Lineage: `itemRule` → `customRule` → `storageRule` → merged into `enforcementRule`.

`get_inventory_quantities(company_id TEXT, location_id TEXT, item_id TEXT DEFAULT NULL, project_id TEXT DEFAULT NULL)` — the central
read. Newest definition is `20261010035358_inventory-rpcs-project-stripe.sql`, which adds
`project_id` (NULL: every stripe; `''`: common stock; an id: that project's stock — see
*Project stock* below) to the body of `20261006130001_demand-forecast-consumption.sql` (the
`20260713235406_item-ledger-snapshot.sql` body — snapshot + delta via `itemLedgerSnapshot`,
`item_id` restricts to one item for detail-page loads — plus a net-projection demand arm:
`GREATEST("forecastQuantity" - "consumedQuantity", 0)` of `demandProjection`). Returns ~52 cols:
item identity + material props, planning fields, and quantities `quantityOnHand`, `quantityOnHold`,
`quantityRejected` (status-aware: excludes `Rejected`, surfaces `On Hold`), `quantityOnSalesOrder`,
`quantityOnPurchaseOrder`, `quantityOnProductionOrder`, `quantityOnProductionDemand`, `demandForecast`,
`usageLast30Days`, `usageLast90Days`, `daysRemaining`, plus `storageTypeIds`/`storageUnitIds` arrays.
Aggregates from `itemLedger`, open `purchaseOrder(Line)`, `salesOrder(Line)`, `job`/`jobMaterial`,
`demandForecast`/`demandActual`, and `demandProjection` net of `consumedQuantity`.

Relevant enums: `itemLedgerType`, `itemLedgerDocumentType` (includes `Scrap`,
`20260807090400`), `trackedEntityStatus`
(`Available`, `Reserved`, `On Hold`, `Consumed`, `Rejected`, `Scrapped`), `warehouseTransferStatus`,
`itemTrackingType`, `itemReplenishmentSystem`, `itemReorderingPolicy`.

## Project stock (stock stripes)

Projects Phase 2a (`.ai/plans/2026-10-08-projects-phase-2a.md`, execution notes; spec
`.ai/specs/2026-10-03-projects.md` → *Project stock*). A project with `project.projectStock`
owns the stock received for it. The model is **valuated striping**: `itemLedger.projectId` and
`costLedger.projectId` name the owning project, and NULL is common stock.
`itemStockQuantities.projectId` is part of its primary key, with `''` for common stock (a key
column cannot be NULL). `trackedEntity` has no `projectId`: a partial transfer leaves one lot in
two stripes, and a lot's stripe is the stripe of its rows with the most net on-hand
(`trackedEntityStripe`).

- **The stripe rule.** A row that creates stock sets the stripe its source names (a PO line
  charged to a project with project stock; a job with `receiveToProjectStock`; a Transfer). A
  row that draws stock sets the stripe it drew. A reversal or correction copies the row it
  reverses.
- **The stripe set of a demand.** A job or a plan line of a project with project stock draws
  that project's stock, then common stock. Every other demand draws common stock only.
  Another project's stock needs a Transfer or a Borrow first. The helpers are in
  `packages/server-functions/src/lib/stock-stripes.ts`: `stripesForDemand`,
  `loadDemandStripes`, `splitAcrossStripes` / `drawFromStripes` (one row per stripe drawn),
  `itemLedgerInStripes`, `stripeKey` (`''` for common), `assertEntitiesInStripes`,
  `assertEntitiesInCommonStock`, `loadProjectStock`, `withStripe`.
- **Handler and key order.** `20261010021027_item-stock-quantities-project.sql` changes the
  primary key and `reconcile_item_stock_quantities`. The generated authz migration
  `20261010021110_item-stock-quantities-project-handler.sql` changes the
  `apply_item_stock_quantities` ON CONFLICT to the new key. Between the two every
  `itemLedger` insert fails, so they always apply together.
- **Costing.** `calculateCOGS` takes `projectId` and relieves only that stripe's layers; the SQL
  backflush (`20261010023707`) and job completion (`20261010030228`) follow it.
  `bookAdjustment`, `buildItemLedgerRow` and `buildCostLedgerRow` take `projectId`.
- **Pickers.** `get_available_tracked_entities` takes `p_project_ids`;
  `get_item_quantities_by_tracking_id` returns `projectId`; the picking-list RPCs and
  `get_picking_schedule` read the line's or job's stripes (`20261010024754`,
  `20261010032726`). `pickingListLine.projectId` and `inventoryCountLine.projectId` carry the
  stripe.
- **Common stock only.** Sales shipments, direct sales invoices, return-to-customer shipments,
  warehouse transfers and maintenance draw common stock. A purchase return draws the stripe
  its stock came in on.
- **Counts** give one line per (item, bin, lot, stripe). The `inventoryCountLines` view
  (`20261010124108`) carries `projectId`, `projectIdentifier` and `projectName`, and the count
  table shows a **Stock Owner** column.
- **Reads.** `itemLedgerSnapshot` is grouped by `COALESCE("projectId", '')` and its unique
  index includes it. `get_inventory_valuation` returns one row per (location, item, stripe)
  with a trailing `projectId`. `get_inventory_tie_out`, `get_item_ledger_balance` and
  `get_inventory_value_by_location` still sum every stripe. The quantities page takes
  `?project` (absent, `common` or a project id) and the item's storage-unit card groups rows
  by owner. `post-inventory-adjustment` takes `projectId` for untracked stock and a new lot.
- **Planning** nets a project with project stock in its own segment, and a planning group's
  members in the group's segment (Projects Phase 2b and 3, `mrp-system.md`).
- **Grouped receipts and completions** (Projects Phase 3). A PO line or job with
  `planningGroupId` is received or completed into its members' stripes by its pegs:
  `harden_pegs_for_supply` returns one row per member plus the excess (the exception project,
  else common stock), and `post-receipt` / `complete_job_to_inventory` write one item ledger
  row and one cost layer per row, at the receipt's or the job's unit cost. A negative receipt
  takes units back through `soften_pegs_for_return`. Details: `projects-system.md` →
  *Planning groups, pegging and distribution*.
- **Transfer, Borrow, Payback** post through `post-project-stock-transfer`; the costing is in
  `projects-system.md` → *Project stock*.

## Gotchas

- **Migrations are timestamp-ordered; tables get renamed.** `shelf`→`storageUnit`/`shelfId`→`storageUnitId`,
  `customRule`→`storageRule`→`enforcementRule` (merged with `salesRule`). Grep the NEWEST migration for the real name; never trust an older one or the
  old cache. The `shelf`→`storageUnit` rename was split across paired migrations
  `20260417000100` (rename, M2) + `..000300` (recreate dependents, M4) — they must apply together.
- **Short-closed PO lines don't count as incoming supply.** `get_inventory_quantities`,
  `get_job_quantity_on_hand`, and the `openPurchaseOrderLines` view (MRP) all filter open-PO supply with
  `pol."receivedComplete" = false` (`20260708204214`). A line short-closed via
  `shortClosePurchaseOrderLine` ("Stop Receiving") keeps `quantityToReceive > 0` but is excluded from
  `quantityOnPurchaseOrder`.
- **`get_inventory_quantities` has many revisions.** Always read the newest (`20261010035358`), not the
  first match. `quantityOnHand` is status-aware: `Rejected` tracked entities are excluded, and tracked
  rows are always computed live (never from `itemLedgerSnapshot`) so status flips are never stale.
- **The auto-generated MCP reference (`.claude/rules/mcp-tools-reference.md`) is stale** for storage units —
  it still lists `getShelf`/`getDefaultShelfForJob`. The real service exports `getStorageUnit*` /
  `getDefaultStorageUnitForJob`. Trust the service file.
- **An RMA Repair line moves no stock.** `post-receipt` and `post-shipment` branch on
  `salesReturnOrderLine.disposition = 'Repair'`: no `itemLedger` row, no cost layer, no
  journal, and the serial stays `Consumed`. The receipt still counts `quantityReceived`;
  the shipment ships only units whose Depot Repair order is Completed or Closed. Every
  other RMA line posts as before. See `field-service.md` → Depot repair.
- On-hand math comes from `itemLedger` (and the `get_inventory_quantities` RPC), not from summing
  `trackedEntity` directly. The old `itemInventory` table is orphaned (trigger dropped
  `20250209170952`) — never read or write it.
