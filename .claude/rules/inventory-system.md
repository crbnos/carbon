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

- `inventory.server.ts` — the module's `defineServiceFn` operations (see `.claude/rules/module-files.md`)
- `inventory.service.ts` — the building blocks, including the traceability graph
  (`fetchLineageSubgraph`, `fetchJobScopedLineage`, `toGraphData`)
- `inventory.models.ts` — Zod validators + exported enums/helpers
- `inventory.utils.ts` — browser-safe helpers
- `supersession-pick.ts`, `types.ts`
- `ui/` — feature folders: `Inventory/`, `Receipts/`, `Shipments/`, `StockTransfers/`,
  `WarehouseTransfers/`, `StorageUnits/`, `StorageTypes/`, `Kanbans/`, `PickingLists/`,
  `Batches/`, `ShippingMethods/`, `Traceability/`

Key service functions (verified):
- `getInventoryItems` / `getInventoryItemsCount` — call the `get_inventory_quantities` RPC
  (args `{ location_id, company_id }`, `count: "exact"`); supports search + generic filters.
- `getItemLedgerPage` — paginated item-ledger history for an item at a location.
- `insertManualInventoryAdjustment` — thin wrapper over the **`post-inventory-adjustment`
  posting** (`postInventoryAdjustment`, `inventory.service.ts`; MES has a matching wrapper in `apps/mes/app/services/inventory.service.ts`).
  The posting owns positive/negative/set-quantity **plus Scrap/Unscrap**
  (`.ai/specs/2026-08-06-scrap-unscrap-flow.md`) resolution, tracked-entity storage-unit
  transfers, expiry override, batch/serial assignment — and, in one Kysely transaction, maintains
  `costLedger` layers (consume via `calculateCOGS` on decreases, new layer at current cost on
  increases) and posts a journal (Dr/Cr `resolveInventoryAccount` vs
  `accountDefault.inventoryAdjustmentVarianceAccount`) for every company — Provisional before the
  accounting cutover, Posted after it.
  `post-inventory-count` books its variances through the same shared core
  (`bookAdjustment`, `shared.service.ts`). Storage-unit transfers post no GL.
  **Serial units are costed by specific identification.** `costLedger.trackedEntityId`
  (migration `20261006220601`) stamps a layer booked for ONE serial unit — every layer
  `bookAdjustment` writes for a `Serial` item (a fixed asset returned to stock at NBV, a
  sales-type lease residual, an unscrap, a positive adjustment). `calculateCOGS` takes
  optional `trackedEntityIds` and orders FIFO / LIFO layers through
  `orderLayersForConsumption` (`@carbon/database/cost-relief`): the leaving unit's own layer
  first, then unstamped layers, then another unit's stamped layer as the last resort (so
  nothing else eats a returned unit's value). Callers passing the ids: `bookAdjustment`
  decreases, the three `post-shipment` COGS calls (`leavingTrackedEntityIds` over the
  shipment's ledger rows) and `issue`'s `createMaterialWipEntries`. Receipt and job-output
  layers cover many units and stay unstamped, so a received serial is still FIFO-costed.
  Pinned by `apps/erp/test/database/lib/cost-layer-order.test.ts` and the database test
  `apps/erp/test/database/lib/calculate-cogs.test.ts`.
  **Serial unit cost and Recost.** `previewSerialUnitCosts` (`inventory.service.ts`,
  ported from the `preview-serial-unit-costs` server function; `{ itemId,
  locationId? }`, `view: accounting`) values every on-hand serial of an item
  with the pure `serialUnitCost` (`shared.service.ts`): calculateCOGS's
  arithmetic for a quantity of one (own layer, then unstamped, with price
  correction children; Standard / Average at the item cost), from one read of
  the item's layers. ERP: the `inventory.getSerialUnitCosts` operation → cached `api+/items.$itemId.serial-costs.ts`
  (also returns `costingMethod` and `retainedEarningsAccountId`), read by
  `InventoryStorageUnits` only when the user can view accounting; a zero
  cost reads "No cost". **Recost** (row action, `update: accounting`, FIFO /
  LIFO only) → `x+/inventory+/quantities+/$itemId.recost.tsx` →
  the `inventory.recostSerialUnit` operation → `service.recostSerialUnit` (`{ trackedEntityId, unitCost,
  offsetAccountId?, postingDate }`, `update: accounting`): exactly one unit on
  hand at one location; relieves it via `calculateCOGS` (its own layer first)
  and books −1 at the old cost / +1 stamped at the new, both
  `costLedgerType 'Revaluation'` (the only writer of that type; no
  `itemLedger` row — nothing moves); posts an `'Inventory
  Adjustment'` journal (Provisional before the accounting cutover) of the difference, inventory account vs the offset
  account (`getOffsetAccount`, `shared.service.ts`, signed by the offset
  account's own class via `buildOffsetLines`). The valuation report's FIFO /
  LIFO layer average moves by exactly the difference, so the tie-out holds. The valuation
  workbench tie-out offers a **Reconcile** action (`createInventoryReconciliationJournal`) that
  drafts an adjusting journal for any residual pre-feature variance.
  **Scrap** = a `Negative Adjmt.` movement with `documentType='Scrap'` +
  `itemLedger.scrapReasonId`, offset to `accountDefault.scrapAccount` (fallback
  `inventoryAdjustmentVarianceAccount`), tracked entity → `Scrapped` (keeps its
  quantity; partial batch scrap splits per the identity-flip convention).
  **Unscrap** (Oracle Return-from-Scrap) restores a `Scrapped` entity to
  `Available` at the **original scrapped cost** (resolved from the scrap
  movement's `costLedger` via `resolveUnscrapUnitCost`, `inventory.service.ts`) and bin, linked by
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
  posting's ScrapReason `extraDimension` is dropped in `shared.service.ts` if the dimension
  was deleted/deactivated for that company group.
- `correctStockMovement` (operation) — settles **`postStockMovementCorrection`** (`inventory.service.ts`, ported from the `correct-stock-movement` server function): fixes any
  posted `itemLedger` row by booking ONE opposite (delta) movement linked to the original's
  correction root via `itemLedger.correctionOfItemLedgerId`, carrying the ORIGINAL's
  `postingDate` and posting its journal: after the accounting cutover into the period containing
  that date via `getAccountingPeriodForDate` (throws on Locked/Closed); before it the journal is
  Provisional and has no period. The delta is
  `correctedQuantity − effective` (effective = root + all prior corrections in the group),
  so repeat corrections converge. `documentType`/`documentId` are copied from the original
  so document-scoped movement views keep including the fix. Entry point: "Correct Quantity"
  context action on `StockMovementsTable` → `stock-movements/$ledgerId/correct` route (whose
  loader returns the authoritative effective quantity for the modal pre-fill). Corrections
  render as normal flat rows with an `isCorrection` badge — no nesting/expandable grouping.
  Inventory counts have NO count-level rectify; Posted is terminal.
- Storage units: `getStorageUnit(s)`, `getStorageUnitRoots`, `getStorageUnitChildren`,
  `getStorageUnitTree`, `getStorageUnitsTreeForLocation`,
  `getDefaultStorageUnitOrStorageUnitWithHighestQuantity`, and `getDefaultStorageUnitForJob`
  (`inventory.utils.ts`) — these are the picking/job defaults.
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
  `warehouseId`, `parentId`, `storageTypeIds`, `active`, `nettable`, `effectiveNettable`.
- **`storageType`** — storage-unit type definitions (`20260417000000`), with `nettable`.
- **`trackedEntity`** — serial/batch/lot tracking (`20250225145619`). Cols: `id`, `quantity`,
  `status` (`trackedEntityStatus`), `sourceDocument(Id)`, `attributes JSONB` (batch/serial #, supplier…),
  `expirationDate`. Companion `trackedActivity` + `trackedActivityInput`/`Output` record movements.
- **`warehouseTransfer` / `warehouseTransferLine`** — inter-location moves (`20250726000000`).
  Status enum `warehouseTransferStatus`. Lines carry from/to location + storage unit, shipped/received qty.
- **`stockTransfer*`** — intra-location moves (separate from warehouse transfers).
- **`pickMethod`** — default storage unit for picking an item at a location (`defaultStorageUnitId`).
- **`itemPlanning`** / **`itemReplenishment`** — reorder/planning params and replenishment strategy.
- **`enforcementRule`** + assignment tables — ONE table for storage and sales rules, discriminated by `family` (`20260817143022`/`20260817143512`). Storage-family reads must filter `family = 'storage'`. Lineage: `itemRule` → `customRule` → `storageRule` → merged into `enforcementRule`.

`get_inventory_quantities(company_id TEXT, location_id TEXT, item_id TEXT DEFAULT NULL)` — the central
read. Newest definition is `20261006130001_demand-forecast-consumption.sql` (the
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

## Non-nettable storage

Stock in a non-nettable unit (a quarantine or MRB hold area) is on hand and valued, but it is
not supply (migration `20261029090412_non-nettable-storage.sql`). The form field is
"Non-nettable" (`nonNettable`); the columns are positive (`nettable`, default true), and
`upsertStorageUnit` / `upsertStorageType` convert, leaving the column alone when
`nonNettable` is omitted.

- **The rule.** A unit is non-nettable when its own `nettable` is false, when ANY of its
  storage types has `nettable` false, or when its parent is non-nettable. No override: a child
  cannot opt back in. Stock in no unit (NULL `storageUnitId`) is nettable.
- **Stored, not walked.** `storageUnit.effectiveNettable` holds the result, written only by
  `util.refresh_storage_unit_nettable(locationIds)` (in `util`, out of the API), which
  recomputes a location's units top-down from the roots. The after-interceptors call it:
  `sync_storage_unit_nettable` on an INSERT that is or inherits non-nettable, and on a change
  to `nettable`, `storageTypeIds`, `locationId`, `effectiveNettable` itself, or `parentId`
  when the old and new parent disagree; `sync_storage_type_nettable` on a `nettable` change
  and on deleting a non-nettable type. The refresh marks its own writes with the transaction
  GUC `app.storage_unit_nettable_refresh`, so they do not refresh again; any other write of
  `effectiveNettable` is recomputed back. `upsertStorageUnit` never writes it. Lineside is
  the opposite pattern (`get_effective_work_center_id`, walked per row); don't copy that for
  planning reads.
- **The aggregate.** `itemStockQuantities.quantityNonNettable` is the part of `quantityOnHand`
  in non-nettable units, maintained by `apply_item_stock_quantities` (joins `storageUnit`).
  When a unit flips, `refresh_storage_unit_nettable` RECOMPUTES it from the ledger for every
  item with stock in a flipped unit, rather than adjusting it, so an earlier drift is
  repaired too. It is the NON-nettable part, so a backup taken before the column existed
  restores as "nothing quarantined". Deleting a non-nettable unit releases its stock first
  (`storage_unit_release_non_nettable_stock`, a BEFORE interceptor), because the FK sets the
  ledger rows' unit to NULL and the ledger handler can no longer tell. A ledger write racing
  a flip can leave `quantityNonNettable` stale; the next flip or the nightly reconcile
  corrects it.
- **Who reads nettable stock** (`quantityOnHand - quantityNonNettable`): `runMrp`,
  `generatePlanningActions`, `get_purchasing_planning` / `get_production_planning` (Rejected lots
  excluded too), job-creation Consume First (`loadSupersessionRedirect`,
  `settleConsumeFirstLines`), the quote lead time, the job materials page
  (`get_job_quantity_on_hand` filters the unit) and its Order Status successor read, and the
  item planning chart's projection (the "Quantity on Hand" card stays physical and notes the
  non-nettable part).
- **Picking never offers it.** `get_warehouse_storage_unit_ids(ids)` (not lineside AND
  nettable) backs `resolveWarehouseSource` / `getWarehouseOnHand` / `hasWarehouseStock`;
  `get_picking_schedule`, `get_picking_list_availability` and
  `get_picking_list_tracked_available` add `storage_unit_is_nettable(il."storageUnitId")`
  beside the lineside test. `get_available_tracked_entities` has its own
  `p_exclude_non_nettable` switch: picking (ERP and MES) and MES suggested allocation pass it,
  a stock transfer does not, since moving stock out is how it is released. `postPicking`
  also refuses a pick (untracked, serial or batch) whose source unit is non-nettable at post
  time (`assertPickSourceNettable`), since a bin can become one after the list was
  generated; it still does not re-check lineside. Shipments are not restricted: a shipment line can
  name a non-nettable bin.
- **A guessed bin is never non-nettable.** When no bin was chosen, consumption (the
  completion backflush and manual issue in `issueJobOperationMaterials` / `issueMaterial`,
  the maintenance spare-part issue) and a new job material (`getStorageUnitId`, and its
  set-based twins in get-method) take the item's pick method default only when it is
  nettable (`getNettableDefaultStorageUnitId`, `shared.service.ts`), then fall back to
  `getStorageUnitWithHighestQuantity`, which only considers nettable units; the backflush's
  second fallback (the fullest bin when the proposed one is short) and
  `getDefaultStorageUnitForJob` (`inventory.utils.ts`) skip them the same way, and so does
  job completion's SQL backflush (`backflush_job_materials`, migration
  `20261029091503_non-nettable-guessed-bins.sql`). The bin the material itself names is
  still used as named. A DESTINATION is not guessed: a job's output bin and a PO line's bin
  (a kanban scan included) keep a non-nettable pick method default, since receiving into an
  inspection area is a deliberate setup. Under strict backflush a non-nettable Pull From
  counts as none at activation and release (production `AGENTS.md` → Strict backflush).
  Pinned by `apps/erp/test/database/non-nettable-fullest-bin.test.ts` and
  `strict-backflush.test.ts`.
- **A non-nettable unit is never made a default by itself.** Placing an item's first stock
  in one does not set it as the pick method default (`updatePickMethodDefaultStorageUnitIfNeeded`,
  and `complete_job_to_inventory` in the same migration). A new BoM line does not seed its
  Pull From from a non-nettable default (`resolveMethodMaterialStorageUnitIds`,
  `seedStorageUnitIds`), a sales order line does not ship from one
  (`getDefaultStorageUnitForJob(…, { source: true })`, quote-to-order conversion), and
  returned picked material does not go back into one.
- **Consumption lot pickers leave quarantined lots out.** The MES issue modal's serial and
  batch lists (`getSerialNumbersForItem` / `getBatchNumbersForItem`) and both maintenance
  add-part modals drop lots whose stock is in a non-nettable unit
  (`getNonNettableTrackedEntityIds`, `@carbon/database`); a failed read offers none.
- **CSV import** has a "Non-nettable" column for storage units and storage types
  (`parseCsvNonNettable`, `shared.service.ts`): blank leaves an existing unit's flag alone,
  true/false (also yes/no, y/n, 1/0, on/off) sets it, and anything else is a row error.
- **Kanbans refuse it.** `createKanban` / `updateKanban` call
  `refuseNonNettableKanbanUnits` (`inventory.service.ts`) and refuse a To or From storage unit
  that is non-nettable (`ctx.error("rule", …)`), since replenishing into one builds stock
  nothing may use and a Transfer from one would release quarantined stock on every scan.
  `updateKanban` checks only a unit the update sets, so a kanban whose unit became
  non-nettable later stays editable and its scans are refused instead: `scanKanban` refuses a
  Buy or Make card with the same check, and `replenishKanban` refuses a Transfer scan or level
  check (`KANBAN_REPLENISH_REASONS.nonNettableStorageUnit`).
- **The form says why.** When a unit's own flag is on but `effectiveNettable` is false, the
  edit route resolves the cause with the pure `nonNettableSource` (`inventory.utils.ts`:
  the unit's own storage type first, then the nearest parent that is non-nettable by its
  flag or a type) and the switch reads "Already non-nettable through its storage type X" /
  "…through its parent X".
- **Physical readers are unchanged:** `get_inventory_quantities` (the Inventory screen), the
  item picker badge, the workflow `item.quantityOnHand`, valuation and GL.

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
- **`get_inventory_quantities` has many revisions.** Always read the newest (`20261006130001`), not the
  first match. `quantityOnHand` is status-aware: `Rejected` tracked entities are excluded, and tracked
  rows are always computed live (never from `itemLedgerSnapshot`) so status flips are never stale.
- On-hand math comes from `itemLedger` (and the `get_inventory_quantities` RPC), not from summing
  `trackedEntity` directly. The old `itemInventory` table is orphaned (trigger dropped
  `20250209170952`) — never read or write it.
