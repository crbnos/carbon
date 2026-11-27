---
paths:
  - "apps/erp/app/modules/inventory/**"
  - "packages/api/src/stock-stripes.ts"
  - "packages/database/supabase/migrations/**"
triggers:
  - "itemLedger"
  - "costLedger"
  - "calculateCOGS"
  - "bookAdjustment"
  - "get_inventory_quantities"
  - "itemStockQuantities"
  - "effectiveNettable"
  - "itemInventory"
summary:
  - "Read on-hand from itemLedger or get_inventory_quantities, never by summing trackedEntity, and never read or write the dead itemInventory table."
  - "Grep the NEWEST migration for a table or function: tables get renamed (shelf to storageUnit) and get_inventory_quantities has many revisions."
  - "Stock in a non-nettable storage unit is on hand but not supply: planning and picking read quantityOnHand - quantityNonNettable."
  - "Set a stock row's projectId stripe from its source; a draw sets the stripe it drew, and a reversal copies the row it reverses."
  - "Move stock through the postings (postInventoryAdjustment, bookAdjustment), which write the ledger, cost layers and journal in one Kysely transaction."
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
  (args `{ location_id, company_id }`, plus `project_id` from `getInventoryItems`'s
  `projectId`; `count: "exact"`); supports search + generic filters.
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
  `apps/erp/test/database/lib/calculate-cogs.test.ts`. **Children of a layer** (`appliesToCostLedgerId`,
  `adjustment = true`: purchase price variance, a `Revaluation` and
  write-down) are applied with their parent. On an unstamped layer the children cover
  its units in turn (`createdAt` order, each only up to the quantity taken). On a layer
  stamped for one serial every child belongs to that unit and is applied in full. The SQL
  backflush (`backflush_job_materials`, migration `20261021003200`) follows the same rules:
  it issues only untracked material, so it takes unstamped layers first and a stamped
  layer last, and it applies every open child of a stamped layer in full. Pinned by
  `supabase/tests/backflush-layer-children.test.sql`.
  **`get_inventory_valuation`** (migration
  `20261021003000_valuation-child-rows.sql`) counts only parent rows as layers and adds each
  open child's remaining cost to its parent; it counted an open child as a layer of its
  own before.
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
  `costLedgerType 'Revaluation'` (no
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
  A count of tracked units is grouped by (item, storage unit) (`inventoryCountGroups`
  view) and counted by scan, Add unit or CSV import. A unit counted in another bin
  posts as a move: 2 `Transfer` rows with `documentType` `Inventory Count`, no GL —
  so `getInventoryCountMovements` (which reads that document type) lists it. See
  `apps/erp/app/modules/inventory/AGENTS.md` → Inventory Count.
- Storage units: `getStorageUnit(s)`, `getStorageUnitRoots`, `getStorageUnitChildren`,
  `getStorageUnitTree`, `getStorageUnitsTreeForLocation`,
  `getDefaultStorageUnitOrStorageUnitWithHighestQuantity`, and `getDefaultStorageUnitForJob`
  (`inventory.utils.ts`) — these are the picking/job defaults.
- Tracking: `getTrackedEntities`, `getAvailableTrackedEntities` (RPC `get_available_tracked_entities`),
  `getSerialNumbersForItem`, `getBatchNumbersForItem`, `getShelfLifeForItems`, `getPickOrder` (FEFO/FIFO).
- Live bins (migration `20261115001836_picking_list_live_bins.sql`). A picking list line's
  `storageUnitId` is the bin suggested when the list was made, then the bin the first pick
  drew from. The ERP and MES picking pages do not read it for an unpicked line: they show
  `getPickingListLiveBins` (RPC `get_picking_list_live_bins(p_company_id, p_picking_list_id)`):
  the nettable warehouse bins that hold the line's item on the line's stripe now, fullest
  first. A line with no row is out of stock; a picked line names the bin it was picked from.
  `get_picking_list_availability` is no longer read by either page (`getPickingListAvailability`
  stays as an operation). The MES reads two more: `get_job_issue_bins(p_company_id, p_job_id,
  p_item_ids)` (the bins a job's untracked materials can issue from: positive stock per
  eligible stripe, and lineside stock only up to the job's outstanding picked claim) and
  `get_issue_tracked_entity_stock(p_company_id, p_location_id, p_item_ids, p_project_ids)`
  (available lots of every revision of an item in one read, with the bin holding most).
- Stock transfer lines, a kanban refill included, show the same
  (`20261115053325_stock_transfer_live_bins.sql`): the transfer page loads
  `getStockTransferLiveBins` (RPC `get_stock_transfer_live_bins(p_company_id,
  p_stock_transfer_id)`: common stock in nettable warehouse bins and the line's From bin,
  never its To bin) and follows `itemLedger` changes for its items. When the From bin no
  longer holds what is left to pick, the line shows "Stock at: bin (qty), …", or "Location
  not known" when no bin holds it. The pick still posts from the line's From bin
  (`postStockTransfer`). An untracked pick is refused when that bin (no storage unit
  included) holds less common stock than the picks of the item take together
  (`untrackedPickShortfall`, under the draw lock; single pick, Pick All and the move
  dialog). A Put Away line keeps its own check (`putAwayPickShortfall`). The lines are
  ordered by item id with numbers as numbers. Pinned by
  `apps/erp/test/database/stock-transfer-pick-stock.test.ts`.
- Pick, unpick and unissue post from the ledger, not from the saved bin (`postPicking`,
  `issueMaterial`). An untracked pick locks the draw (`lockUntrackedDraws`), reads the bins
  again, chooses the source with `chooseSourceBin` and splits it with
  `planStripedUntrackedDraw`; its `Direct Transfer` rows carry `documentLineId` = the picking
  list line. An unpick returns what the line still holds to the bins those rows drew from,
  newest first, never more than `quantityPicked`; rows picked before the tag go back to the
  line's saved bin. An unissue (`Positive Adjmt.` on a job material) is refused above
  `quantityIssued` and returns stock to the bins and stripes the job's `Job Consumption` rows
  of that item drew from, the operation's own draws first. It reads by job and item, because
  the job-completion SQL backflush writes no `documentLineId`. A serial or batch Unconsume
  (`unconsumeTrackedEntities` in `issueMaterial`) returns each unit to the bin and stripe of
  its newest negative `Consumption` row (ledger read newest first by `createdAt`), not to any
  other row of its history: a unit picked or transferred after receipt has rows in bins it
  has left. Pinned by `apps/erp/test/database/unconsume-tracked-bin.test.ts`.
- A picking list line's lineside (`toStorageUnitId`) can be empty: a release picking list is
  made before the scheduler gives an operation with only a process its work center. Each pick
  (`inventory`, `serial`, `batch` in `postPicking`) fills it under the line lock
  (`resolvePickDestination`) from the operation's current work center
  (`get_or_create_work_center_lineside`) and saves it, or refuses when the operation still has
  none. The posting is the one check; the ERP and MES callers do not refuse first.
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

`get_inventory_quantities(company_id TEXT, location_id TEXT, item_id TEXT DEFAULT NULL, project_id TEXT DEFAULT NULL)` — the central
read. Newest definition is `20261021004300_inventory-rpcs-project-stripe.sql`, which adds
`project_id` (NULL: every stripe; `''`: unassigned stock; an id: that project's stock — see
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
`costLedger.projectId` name the owning project, and NULL is unassigned stock.
`itemStockQuantities.projectId` is part of its primary key, with `''` for unassigned stock (a key
column cannot be NULL). `trackedEntity` has no `projectId`: a partial transfer leaves one lot in
two stripes, and a lot's stripe is the stripe of its rows with the most net on-hand
(`trackedEntityStripe`).

- **The stripe rule.** A row that creates stock sets the stripe its source names (a PO line
  charged to a project with project stock; a job with `receiveToProjectStock`; a Transfer). A
  row that draws stock sets the stripe it drew. A reversal or correction copies the row it
  reverses.
- **The stripe set of a demand.** A job or a plan line of a project with project stock draws
  that project's stock, then unassigned stock. Every other demand draws unassigned stock only.
  Another project's stock needs a Transfer or a Borrow first. The helpers are in
  `packages/api/src/stock-stripes.ts` (`@carbon/api/stock-stripes`, shared with the MES): `stripesForDemand`,
  `loadDemandStripes`, `splitAcrossStripes` / `drawFromStripes` (one row per stripe drawn),
  `itemLedgerInStripes`, `stripeKey` (`''` for unassigned stock), `assertEntitiesInStripes`,
  `assertEntitiesInCommonStock`, `loadProjectStock`, `withStripe`.
- **Handler and key order.** `20261021003600_item-stock-quantities-project.sql` changes the
  primary key and `reconcile_item_stock_quantities`. The generated authz migration
  `20261021003700_item-stock-quantities-project-handler.sql` changes the
  `apply_item_stock_quantities` ON CONFLICT to the new key. Between the two every
  `itemLedger` insert fails, so they always apply together.
- **Costing.** `calculateCOGS` takes `projectId` and relieves only that stripe's layers; the SQL
  backflush (`20261021003900`) and job completion (`20261021004100`) follow it.
  `bookAdjustment`, `buildItemLedgerRow` and `buildCostLedgerRow` take `projectId` (all in
  `shared/shared.service.ts`).
- **Pickers.** `get_available_tracked_entities` takes `p_project_ids`;
  `get_item_quantities_by_tracking_id` returns `projectId`; the picking-list RPCs and
  `get_picking_schedule` read the line's or job's stripes (`20261021004000`,
  `20261021004200`). `pickingListLine.projectId` and `inventoryCountLine.projectId` carry the
  stripe.
- **Unassigned stock only.** Sales shipments, direct sales invoices, return-to-customer shipments,
  warehouse transfers and maintenance draw unassigned stock. A purchase return draws the stripe
  its stock came in on.
- **Counts** give one line per (item, bin, lot, stripe). The `inventoryCountLines` view
  (`20261021004400`) carries `projectId`, `projectIdentifier` and `projectName`, and the count
  table shows a **Stock Owner** column. A scan or an import row counts the bin, not an owner:
  it spreads over every line of that item (or lot) in the bin with `spreadBatchCount`, up to
  each line's expected quantity, and the CSV export sums those lines into one row. Only the
  line table counts one owner at a time. A unit counted in another bin keeps its owner: the
  added line takes the unit's stripe, and the 2 `Transfer` rows of a move carry it.
- **Reads.** `itemLedgerSnapshot` is grouped by `COALESCE("projectId", '')` and its unique
  index includes it. `get_inventory_valuation` returns one row per (location, item, stripe)
  with a trailing `projectId`. `get_inventory_tie_out`, `get_item_ledger_balance` and
  `get_inventory_value_by_location` still sum every stripe. The quantities page takes
  `?project` (absent, `common` or a project id) and the item's storage-unit card groups rows
  by owner. `postInventoryAdjustment` takes `projectId` for untracked stock and a new lot
  (`postInventoryAdjustmentInput`, `@carbon/api/postings`).
- **Planning** nets a project with project stock in its own segment, and a planning group's
  members in the group's segment (Projects Phase 2b and 3, `mrp-system.md`).
- **Grouped receipts and completions** (Projects Phase 3). A PO line or job with
  `planningGroupId` is received or completed into its members' stripes by its pegs:
  `harden_pegs_for_supply` returns one row per member plus the excess (the exception project,
  else unassigned stock), and `postReceipt` (`inventory/grouped-receipt.ts`) /
  `complete_job_to_inventory` write one item ledger
  row and one cost layer per row, at the receipt's or the job's unit cost. A negative receipt
  takes units back through `soften_pegs_for_return`. Details: `projects-system.md` →
  *Planning groups, pegging and distribution*.
- **Transfer, Borrow, Payback** post through `postProjectStockTransfer` (`projects.service.ts`); the costing is in
  `projects-system.md` → *Project stock*.

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
  generated; an untracked pick draws from the nettable warehouse bins that hold stock at post time (see Live bins above). Shipments are not restricted: a shipment line can
  name a non-nettable bin. A new sales order shipment line for an untracked item keeps the bin
  the order line names, even when short; a line with no bin takes a bin that holds its stock
  (`shipmentSourceBinChooser` → `chooseSourceBin`, `shared.service.ts`), and so does a quote
  line converted with no default bin. `postShipment` warns
  (`shipmentStockWarnings`, rule id `SHIPMENT_BIN_STOCK_RULE_ID`) when an untracked line's bin
  holds less than it ships, naming the bins that hold the item; the user acknowledges it.
  A purchase order (outside processing), rental or contract shipment writes no item ledger row
  and is not checked.
- **A guessed bin is never non-nettable.** When no bin was chosen, consumption (the
  completion backflush and manual issue in `issueJobOperationMaterials` / `issueMaterial`)
  and a new job material (`getStorageUnitId`, and its
  set-based twins in get-method) take the item's pick method default only when it is
  nettable (`getNettableDefaultStorageUnitId`, `shared.service.ts`), then fall back to
  `getStorageUnitWithHighestQuantity`, which only considers nettable units;
  `getDefaultStorageUnitForJob` (`inventory.utils.ts`) skips them the same way. The bin the material itself names is
  still used as named. A DESTINATION is not guessed: a job's output bin and a PO line's bin
  (a kanban scan included) keep a non-nettable pick method default, since receiving into an
  inspection area is a deliberate setup. Under strict backflush a non-nettable Pull From
  counts as none at activation and release (production `AGENTS.md` → Strict backflush).
  Pinned by `apps/erp/test/database/non-nettable-fullest-bin.test.ts` and
  `strict-backflush.test.ts`.
- **An untracked draw takes stock from the bins that hold it.** Outside strict backflush, the
  completion backflush (`issueJobOperationMaterials`), the manual and step issue
  (`partToOperation`) and job completion's SQL backflush (`backflush_job_materials`,
  `20261105230630_backflush-split-across-bins.sql`) split a draw with
  `planStripedUntrackedDraw` (`@carbon/database/picked-consumption`), stripe by stripe: a
  project job takes its project's stock in every bin before common stock. Within a stripe the
  bin the material names (else the item's nettable default) gives what it holds, then the other
  bins with untracked stock give the rest, fullest first. Those are active, nettable bins under
  no work center (`get_effective_work_center_id`, so a child of a lineside unit is lineside too)
  and no storage unit. A real shortfall goes to the last (common) stripe, on the named bin, else
  the first bin drawn, else no storage unit. A Non-Inventory material holds no stock: both
  backflushes issue it with no ledger row and no cost (`20261106213428_backflush-skips-non-inventory.sql`). The bin reads come from `getUntrackedBinStock`
  (`shared.service.ts`, one row per bin and stripe). Before it reads, each path locks every
  (location, item) it draws (`lockUntrackedDraws`, key `untracked-draw:<companyId>:<locationId>:<itemId>`,
  `untrackedDrawLockKey`; the SQL locks the same keys in the same key-hash order in every mode,
  before the strict backflush keys, `20261124055757_backflush-draw-lock-in-strict.sql`), so two
  draws never plan from the same on-hand. The SQL then locks a FIFO / LIFO stripe's open cost
  layers and their open children in `calculateCOGS`'s order (`postingDate`, `createdAt`;
  children by `createdAt`) before it reads them (`20261124060450_backflush-locks-cost-layers.sql`).
  The MES step backflush sends `maxQuantityIssued` (its target), and `partToOperation` issues only
  what still reaches it under the job material's lock. A draw records what picked and
  lineside budgets already took from a bin before it plans the rest. Pinned by
  `picked-consumption.test.ts`, `apps/erp/test/database/consumption-bins.test.ts` and
  `supabase/tests/backflush-split-across-bins.test.sql`.
- **Every stock-out with no bin chosen takes its bin from stock, never NULL by default.**
  An empty bin field must never mean "take it from no storage unit". Each writer of a
  negative untracked `itemLedger` row follows one of two shared rules
  (`shared.service.ts`, `@carbon/database/picked-consumption`):
  1. Ordinary stock: `planUntrackedDraw` (lock, the item's pick method default when a
     guess may take it — nettable, active, not lineside — then the bins that hold stock,
     fullest first, split across them, stripe by stripe; never a quarantine or lineside
     unit), or `shipmentSourceBinChooser` when a document line names one bin.
  2. Nonconforming or returned stock: `planHeldUntrackedDraw` /
     `returnShipmentSourceBinChooser` (`planHeldStockDraw` / `chooseHeldStockBin`). Held
     units (`BinStock.held`: active, non-nettable, not lineside — quarantine, MRB,
     rejected) come first, then the other bins, fullest first.

  | Path | Rule | Test |
  |---|---|---|
  | Project Issue (`postProjectIssue`), and a Return with no bin goes back to the bins the issues drew from | 1 | `post-project-issue/untracked-draw-bins.test.ts` |
  | Maintenance spare-part issue / un-issue (`maintenanceDispatchInventory`, `maintenanceDispatchUnissue`) | 1, back per row | `maintenance-issue-bins.test.ts` |
  | Service job part issue / return (`serviceJobInventory`, `serviceJobUnconsume`) | 1, back per bin | `issue/service-job.test.ts` |
  | Direct sales invoice (`postSalesInvoice`, `directInvoiceSourceBins`); the void reads the posted rows | 1, one bin per line | `sales-invoice-source-bins.test.ts` |
  | Warehouse transfer shipment line with no From bin (`createDocument`) | 1, one bin per line | `shipment-create-source-bins.test.ts` |
  | Sales and Purchase Return Order shipment lines (`createDocument`) | 2, one bin per line | `shipment-create-source-bins.test.ts` |
  | NCR close, untracked Scrap / Return to Supplier not from an inspection (`closeIssue`, `planHeldWriteOffBins`); stock an open lot holds is left alone | 2 | `ncr-scrap-source-bins.test.ts` |

  Every guess on this list reads stock net of what open inspection lots hold in a unit
  (`getUntrackedBinStock` with `inspectionHolds`: "all", or "openLots" for a supplier
  return, which may ship a Partial lot's remainder), and a planned shortfall never lands
  on such a unit (`keepInspectionHeldStock` moves it to no storage unit). The hold guard
  refuses any posting that takes a unit below what its lots hold, so without this a guess
  turns a posting that used to succeed into a refusal. The job backflush, which the SQL
  backflush mirrors, does not pass it yet. A return of drawn stock (Project Issue Return,
  maintenance un-issue, service job part return) goes back through
  `planReturnToDrawnBins`: the bins the document's rows drew from, newest first, each up
  to what it still has out; a Project Issue Return takes the item's draw lock before it
  reads the issues, so two Returns never give one bin back more than it had out. A
  purchase return puts an inspection write-off back in the
  line's bin before it ships from it, so the two net there.

  A serial or batch row posts at the bin the unit holds stock in: sales order and return
  shipments (`trackedShipmentSourceBins`), Project Issue, and job consumption
  (`resolveTrackedEntityBin`). A shipment reads those bins before its posting
  transaction, so the transaction first calls `confirm`: it locks the units `FOR UPDATE`
  in id order (the lock a stock transfer pick takes), reads the bins again and refuses
  when a unit has moved since. A reversal books against the row it reverses (an Unconsume
  takes the unit's newest negative `Consumption` row). A stock transfer whose From is no
  storage unit keeps it: moving stock out of no bin is a deliberate re-binning, and the
  pick check refuses it only when no storage unit is short.
- **An operation completion issues what its units still need.** `issueJobOperationMaterials`
  reads `quantityComplete + quantityScrapped` under the operation lock and issues
  `min(quantity × units, estimatedQuantity) − quantityIssued`, as `backflush_job_materials` does
  for the job. Material issued first by a manual or step issue counts, and a resent completion
  issues nothing. It takes the untracked draw locks and reads `quantityIssued` again under them
  before it computes the draw, as the job's backflush reads it under the same locks, so a
  backflush that committed meanwhile is not issued twice (`job-material-issue-concurrency.test.ts`). A serial completion (`jobOperationSerialComplete`) locks the operation and
  refuses a unit already complete on it ("This unit is already complete on this operation"), so
  a resent one writes no second production row. `partToOperation` locks the operation it was
  called for and the material's own operation (in id order; the material must be on that job),
  then the draw, then the job material row, so a step issue and the completion it triggers run
  one after the other.
- **A non-nettable unit is never made a default by itself.** Placing an item's first stock
  in one does not set it as the pick method default (`updatePickMethodDefaultStorageUnitIfNeeded`,
  and `complete_job_to_inventory` in the same migration). A new BoM line does not seed its
  Pull From from a non-nettable default (`resolveMethodMaterialStorageUnitIds`,
  `seedStorageUnitIds`), a sales order line does not ship from one
  (`getDefaultStorageUnitForJob(…, { source: true })`, quote-to-order conversion), and
  returned picked material does not go back into one.
- **Consumption lot pickers leave quarantined lots out.** The MES issue modal's serial and
  batch lists (`getIssueLotsForItem`, over `get_issue_tracked_entity_stock`) and both maintenance
  add-part modals (`getNonNettableTrackedEntityIds`, `@carbon/database`) drop lots whose stock
  is in a non-nettable unit; a failed read offers none.
- **A lot is drawn only where it is in stock.** A job issue
  (`consumeTrackedEntitiesIntoOperation`) and a serial or batch pick (`postPicking`) refuse a lot
  whose stock is at another location (`assertEntitiesAtLocation`, `@carbon/api/stock-stripes`); a
  unit with no stock anywhere (still in production) passes. The MES issue lists and suggested
  allocation offer only the job's location. A maintenance dispatch's and a service job's serial or
  batch draw (`issue` `maintenanceDispatchTrackedEntities`, `serviceJobTrackedEntities`) refuse
  the same, then book each draw in the storage unit at the dispatch's or job's location that holds
  most of the lot's unassigned stock (`resolveTrackedEntityBins` over its unassigned rows), and
  refuse a draw larger than the unassigned stock that unit holds. Each locks the lots (`FOR
  UPDATE`, id order) before it reads their ledger, so two draws never split the same quantity. A
  job issue (`consumeTrackedEntitiesIntoOperation`) locks its lots the same way before it reads
  their quantity and ledger, and a batch pick (`trackedEntitiesToBatch`) locks every picked lot
  before the member job materials. The maintenance and service add-part modals (ERP and MES) still
  list every Available lot of the item.
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

## Inspection hold (goods-in)

Stock received under an open inspection lot cannot move
(`.ai/specs/2026-11-03-goods-in-inspection-hold.md`, full detail in
`inspection-system.md` → Goods-in inspection hold). `check_inspection_hold`, a
statement handler on `itemLedger`, refuses an INSERT statement with a negative row of an `On Hold`
serial or batch unit whose receipt line's inspection lot is open, or with
untracked moves out that leave an (item, storage unit) below
`inspection_held_quantity` (under a per-(item, unit) advisory lock). It is the one enforcement point for
every move path, the SQL backflush included. The release flag (GUC
`app.inspection_release`, `@carbon/database/quality`) covers only the write that
IS the release: `withInspectionRelease(trx, fn)` turns it on for one step and
restores it. A lot's decision, an NCR's close and a purchase receipt void's
cancelled lots run under it; the stock moves, write-offs and unit changes that
follow run with the guard on, because a decided lot (or a closed NCR, or a
cancelled lot) no longer holds stock: the guard lets that stock go and keeps
what other lots hold. A sales-return receipt void opens no lot and needs no
flag. `setInspectionRelease(trx)` (the whole transaction) stays for
`postInventoryCount` (a count records where held stock really is, and
`heldStockMovedByCount` names what it found elsewhere), the four return-shipment
transactions and the delete of an NCR that failed to open; a company restore or
import sets the flag with `SET LOCAL`. A return
shipment also calls `refuseShippingOpenLotStock` after its ledger rows, so it
cannot ship stock an open lot still holds (checked only where an open lot
holds stock). The guard also steps aside under
`app.sync_in_progress` (dataset apply, test fixtures). Picking a unit never
changes its status, so a stock transfer unpick leaves the status as it is: a
held unit stays `On Hold`. A direct edit cannot release the hold either: BEFORE
interceptors refuse changing a held unit's `On Hold` status, a receipt lot's
status, unit or accepted quantity, deleting a lot that holds stock, closing or
deleting the NCR of a Partial lot's held remainder or moving its link, or
making a goods-in storage unit inactive or another location's,
outside a release posting (a company deletion is never refused) (detail in
`inspection-system.md`). A PO line its project consumes at receipt opens no lot. Put Away offers an untracked line no more than is free
in its unit (on-hand less what open lots hold).

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
- **Outside-processing PO lines are not supply for planning.** `openPurchaseOrderLines`
  (`20261117123417`) leaves out lines of an `Outside Processing` PO: the line carries the job's
  item, but receiving it stocks nothing (the job is the supply), so MRP counted the job twice.
  `get_inventory_quantities`' `quantityOnPurchaseOrder` still counts them.
- **`get_inventory_quantities` has many revisions.** Always read the newest (`20261021004300`), not the
  first match. `quantityOnHand` is status-aware: `Rejected` tracked entities are excluded, and tracked
  rows are always computed live (never from `itemLedgerSnapshot`) so status flips are never stale.
- On-hand math comes from `itemLedger` (and the `get_inventory_quantities` RPC), not from summing
  `trackedEntity` directly. The old `itemInventory` table is orphaned (trigger dropped
  `20250209170952`) — never read or write it.
