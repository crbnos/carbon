---
paths:
  - "apps/erp/app/modules/accounting/**"
  - "apps/erp/app/routes/x+/fixed-asset+/**"
  - "apps/erp/app/routes/x+/depreciation-run+/**"
  - "apps/erp/app/routes/x+/accounting+/fleet.tsx"
  - "packages/database/supabase/migrations/*fixed-asset*"
  - "packages/database/supabase/migrations/*fleet-bridge*"
  - "packages/database/supabase/migrations/*asset-transfer*"
  - "packages/database/supabase/migrations/*job-to-asset*"
  - "packages/database/supabase/functions/post-asset-transfer/**"
  - "packages/database/supabase/functions/shared/asset-transfer.ts"
  - "packages/database/supabase/functions/post-rental-agreement/**"
  - "packages/database/supabase/migrations/*rental-agreements*"
  - "packages/database/supabase/migrations/*lease-enum*"
  - "packages/database/supabase/migrations/*lessor-schedule*"
---

# Fixed Asset Lifecycle

Fixed assets are acquired, depreciated, and disposed through the accounting
module. They integrate with purchasing (acquisition via PO receipt / purchase
invoice), sales (disposal via shipment / sales invoice), production (a job that
completes to an asset) and inventory (a serialized unit capitalized from stock
or returned to it). All GL postings flow through `journal` / `journalLine`.
`journalEntrySourceType` is `'Asset Depreciation'` for depreciation runs,
`'Asset Disposal'` for the manual scrap, `'Asset Transfer'` for every
inventory ↔ asset move and job → asset completion, and `'Lease'` for a
sales-type lease's commencement and residual return (below); the two-step sale reuses the
document source types (`'Sales Shipment'` / `'Sales Invoice'`) and manual
registration uses `'Manual'`. `'Asset Transfer'` is `representation: "journal"`,
`defaultEnabled: false` in the accounting-sync policy
(`packages/ee/src/accounting/core/models.ts`), like `'Revenue Recognition'`
and `'Lease'`.

Schema lives in these migrations (newest wins):
`20260524143826_fixed-asset-enums.sql`, `20260524143827_fixed-assets.sql`,
`20260525084319_seed-fixed-asset-classes.sql`,
`20260717031529_split-asset-gain-loss-disposal-accounts.sql`,
`20260922225541_asset-transfer-enums.sql`, `20260922225830_fleet-bridge.sql`,
`20260922230906_complete-job-to-asset.sql`, `20260923003525_rental-agreements.sql` (recreates `fleetAssets` with the rental join), and `20260923051441_lease-enum.sql` / `20260923051445_lessor-schedule.sql` (sales-type leases). Design:
`.ai/specs/2026-09-22-revenue-recognition-and-rentals.md` §2 and §4.

## Tables (current schema)

- **`fixedAsset`** — master record. Key columns: `fixedAssetId` (readable),
  `fixedAssetClassId`, `name`, `serialNumber`, `status` (`fixedAssetStatus`),
  `depreciationMethod`, `usefulLifeMonths`, `residualValuePercent`,
  `acquisitionCost`, `acquisitionDate`, `depreciationStartDate`,
  `accumulatedDepreciation`, `accumulatedTaxDepreciation`, `assetLifetimeUsage`
  (Units of Production), `locationId`, `disposalDate`, `disposalMethod`,
  `saleProceeds`. Tax columns: `taxDepreciationMethod`, `taxUsefulLifeMonths`,
  `taxResidualValuePercent`, `macrsPropertyClass`, `macrsConvention`,
  `bonusDepreciationPercent`. **Fleet bridge** (`20260922225830`): `itemId`
  (FK `item`), `trackedEntityId` (FK `trackedEntity`; partial unique index
  `fixedAsset_trackedEntity_live_idx` on `(companyId, trackedEntityId)` while
  `status <> 'Disposed'`), `quantity NUMERIC NOT NULL DEFAULT 1` (CHECK
  `quantity = 1` — v1 is one serialized unit per asset), `workCenterId` (FK
  `workCenter`, `ON DELETE SET NULL`), `outOfServiceSince` /
  `outOfServiceReason` (CHECK: both set or both null).
- **`fixedAssetClass`** — classification + GL account mappings. Seven NOT NULL
  account FKs: `assetAccountId`, `accumulatedDepreciationAccountId`,
  `depreciationExpenseAccountId`, `writeOffAccountId`, `writeDownAccountId`,
  `gainOnDisposalAccountId`, `lossOnDisposalAccountId` (`20260717031529`
  renamed `disposalAccountId` → `lossOnDisposalAccountId` and added the gain
  column, backfilled to the loss account where no gain account resolved).
  `isConstructionInProgress BOOLEAN NOT NULL DEFAULT false` marks a CIP class.
  Also default depreciation/tax settings. Seeded with Buildings / Machinery &
  Equipment / Vehicles, plus (`20260922225830` for existing companies,
  `functions/lib/seed.data.ts` for new ones) **Rental Fleet** (Straight Line,
  60 months, 20 % residual, asset `1370 Rental Fleet`, accumulated
  `1380 Accumulated Depreciation – Rental Fleet`) and **Construction in
  Progress** (`isConstructionInProgress = true`, asset `1390 Construction in
  Progress`, accumulated 1330, 120 months, 0 %); both use 6310 / 6320 / 4140
  for expense / write-off / write-down / loss / gain. The three accounts are
  seeded once per company group under the `Property, Plant & Equipment` group.
- **`fixedAssetTransfer`** — the inventory ↔ asset document. `transferId`
  (sequence `table = 'fixedAssetTransfer'`, prefix `FAT`, size 6), `type`
  (`fixedAssetTransferType`), `sourceType` (`fixedAssetTransferSourceType`),
  `fixedAssetId`, `itemId`, `trackedEntityId`, `jobId`, `fromClassId`,
  `locationId` (NOT NULL), `storageUnitId`, `quantity`, `transferDate`,
  `inServiceDate`, `amount`, `accumulatedDepreciation`, `journalId`, `status`
  CHECK `IN ('Draft','Posted')`, `postedAt`, `postedBy`. Every v1 writer
  creates the row and posts it in the same transaction; the status column only
  keeps the document shape open for a reviewed Draft later.
- **`fixedAssetCipCost`** — append-only cost ledger of an asset under
  construction: `sourceType` CHECK `IN ('Purchase Invoice','Receipt','Job',
  'Manual')`, `sourceDocumentId`, `sourceDocumentLineId`, `jobId`, `amount`,
  `costDate`, `journalId`. Capitalization sums these rows, not the asset's
  `acquisitionCost`.
- **`fleetAssets`** (view, `SECURITY_INVOKER`) — `fixedAsset` where `itemId IS
  NOT NULL`, joined to `item` (`itemReadableId`, `itemName`, `thumbnailPath`),
  `fixedAssetClass` (`className`, `isConstructionInProgress`), `trackedEntity`
  (`trackedEntityReadableId`) and `workCenter` (`workCenterName`), with
  `netBookValue` and a **derived** `fleetStatus`: Disposed + `disposalMethod
  'Transfer to Inventory'` → `Returned to Stock`; any other Disposed → `Sold`;
  `Under Construction`; `outOfServiceSince` set → `In Maintenance`; else
  `Available`. `20260923003525_rental-agreements.sql` recreated it with a
  `LEFT JOIN LATERAL` on the newest LIVE `rentalAgreementLine` of the asset
  (`status IN ('Pending','On Rent')`, joined to its `rentalAgreement`) and
  exposes that line's `rentalAgreementId`, `customerId`, `customerLocationId`.
  Full precedence: Disposed + Transfer to Inventory → `Returned to Stock`;
  other Disposed → `Sold`; `Under Construction`; live line `On Rent` → `On
  Rent`; `outOfServiceSince` set → `In Maintenance`; live line `Pending` →
  `Reserved`; else `Available`. So a unit on rent that is also out of service
  reads On Rent, and a reserved unit out of service reads In Maintenance. A
  Draft agreement's lines are already `Pending` (the column default), so a
  draft RESERVES its units; the partial unique index
  `rentalAgreementLine_asset_live_idx` keeps one live line per asset.
- **`job.fixedAssetClassId` / `job.fixedAssetId`** — the Make to Asset target;
  CHECK `job_asset_target_check` (`num_nonnulls(...) <= 1`). The `jobs` view
  was DROP + CREATEd (it selects `j.*`).
- **`depreciationRun`** — period batch. `depreciationRunId`, `periodEnd`,
  `status` CHECK `IN ('Draft','Posted')`, `postedAt`, `postedBy`.
- **`depreciationRunLine`** — one row per asset per run: `amount`, `taxAmount`,
  `journalId` (FK to posted GL entry).
- **`fixedAssetDisposal`** — disposal record: `disposalMethod`, `disposalDate`,
  `saleProceeds`, `netBookValueAtDisposal`, `gainLoss`, `journalId`.
- **`fixedAssetUsageLog`** — Units of Production input: `periodStart`,
  `periodEnd` (unique per asset), `unitsProduced`.
- **`receiptFixedAssetLine` / `shipmentFixedAssetLine`** — link receipt/shipment
  to PO/SO line (`serialNumber`, received/shipped flags).

There are **no Postgres functions/triggers** for depreciation or disposal — all
calculation and posting is application-level (see below). The one SQL path is
the job → asset branch inside `complete_job_to_inventory` (Make to Asset).

## Enums

- `fixedAssetStatus`: `Draft`, `Active`, `Fully Depreciated`, `Disposed`,
  `Under Construction` (`20260922225541`)
- `depreciationMethod`: `Straight Line`, `Declining Balance`, `Units of Production`
- `taxDepreciationMethod`: `Straight Line`, `Declining Balance`, `MACRS`
- `disposalMethod`: `Sale`, `Scrapping`, `Transfer to Inventory`
  (`20260922225541`; only `post-asset-transfer` writes the third — the UI
  `disposalMethods` array still lists the first two)
- `fixedAssetTransferType`: `Capitalization`, `Return to Inventory`
- `fixedAssetTransferSourceType`: `Inventory`, `Job`, `Construction in Progress`
- `journalEntrySourceType`, `journalLineDocumentType`, `itemLedgerDocumentType`
  each gained `Asset Transfer`
- `macrsPropertyClass`: `3`,`5`,`7`,`10`,`15`,`20`,`27.5`,`39`
- `macrsConvention`: `Half-Year`, `Mid-Quarter`

## Line-type integration

`purchaseOrderLine`, `salesOrderLine`, `salesInvoiceLine`, `purchaseInvoiceLine`
each have an `assetId` FK → `fixedAsset(id)`, with `'Fixed Asset'` as a line-type
enum value (CHECK: only Fixed Asset lines have non-NULL `assetId`). The
`*Lines` views LEFT JOIN `fixedAsset` and expose `assetReadableId` + `assetName`.

## Code

- Models/validators: `apps/erp/app/modules/accounting/accounting.models.ts` —
  enum arrays (`fixedAssetStatuses` incl. `Under Construction`, `fleetStatuses`,
  `depreciationMethods`, `taxDepreciationMethods`, `disposalMethods`) and
  validators `fixedAssetClassValidator`, `fixedAssetValidator`,
  `fixedAssetRegisterValidator` (acquisitionCost/Date, accumulatedDepreciation,
  depreciationStartDate), `depreciationRunValidator` (periodEnd only),
  `fixedAssetDisposalValidator` (disposalDate only), `fixedAssetUsageLogValidator`,
  and the fleet bridge: `fixedAssetCapitalizeValidator` (fixedAssetClassId,
  itemId, trackedEntityId, locationId, storageUnitId?, transferDate, name?),
  `fixedAssetReturnToInventoryValidator` (transferDate, locationId,
  storageUnitId?), `fixedAssetAttachJobValidator` (jobId),
  `fixedAssetCapitalizeCipValidator` (toClassId, inServiceDate),
  `fixedAssetOutOfServiceValidator` (reason).
- Service: `accounting.service.ts` — `getFixedAsset(s)`, `insert/update/deleteFixedAsset`,
  `getFixedAssetsListForSale` (status Active/Fully Depreciated), class CRUD,
  `insert/getDepreciationRun(s)`, `getDepreciationRunLines`,
  `getAssetDepreciationHistory`, `getFixedAssetDisposal`, usage-log helpers.
  Note `upsertFixedAsset` is deprecated — use insert/update. Fleet section
  (`// -- Fleet --`): `getFleetAssets` (the `fleetAssets` view; search on
  name / fixedAssetId / serialNumber / itemReadableId, `fleetStatus` filter),
  `getUnderConstructionAssets` (status `Under Construction`),
  `getFixedAssetTransfers`, `getFixedAssetCipCosts`, `getWorkCenterCapitalCost`
  (every non-Disposed asset with that `workCenterId`, with `netBookValue` and,
  for Straight Line assets with a useful life, `monthlyDepreciation = round(cost
  × (1 − residual %) / usefulLifeMonths)`), `setFixedAssetOutOfService`,
  `returnFixedAssetToService`, `invokeAssetTransfer`
  (`client.functions.invoke("post-asset-transfer", { body })`).
- Server transactions (Kysely): `accounting.server.ts` — `postDisposal()`,
  `postDepreciationRun()` and `postAssetRegistration()` build journals and
  update asset rows. `postAssetRegistration` takes an optional `status`
  (`"Active" | "Under Construction"`, default Active) and, for `Under
  Construction` with `acquisitionCost > 0`, also inserts a `fixedAssetCipCost`
  row (`sourceType 'Manual'`, `journalId`) so a later capitalization sweeps it.
- Calc utils: `accounting.utils.ts` — `acquisitionLines()`,
  `buildDepreciationLines()`, `getNextPeriodEnd()`, MACRS data.
- Shared line builders (Deno): `functions/shared/asset-transfer.ts` —
  `buildCapitalizationLines` (Dr asset / Cr the account the value came from) and
  `buildReturnToInventoryLines` (Dr inventory NBV / Dr accumulated depreciation
  when non-zero / Cr asset at cost); every amount `round()`ed, every set
  `assertBalanced`, a cost that rounds to ≤ 0 throws.
- UI: `accounting/ui/FixedAssets/` — `FixedAssetForm` (has a **Work Center**
  picker, `workCenterId`), `AssetClassForm`, `FixedAssetRegisterForm`,
  `FixedAssetDisposalForm`, `FixedAssetCapitalizeForm`,
  `FixedAssetReturnToInventoryForm`, `FixedAssetAttachJobForm`,
  `FixedAssetCapitalizeCipForm`, `FixedAssetOutOfServiceForm`,
  `FixedAssetCipCosts` (the "Construction in Progress" card on the asset page,
  rendered for a CIP-class asset), `FleetAssetsTable`, `FleetStatus` (its own
  colour map — fleet status has no entry in `packages/utils/src/status-colors.ts`;
  `FIXED_ASSET_STATUS_COLOR_MAP` does include `Under Construction`), tables,
  status badges. The asset page also lists the asset's transfers and shows
  `Work Center` / `Out of Service Since` detail rows.
- Routes: `routes/x+/fixed-asset+/$fixedAssetId.{tsx,register,dispose,sell,purchase,details,delete,capitalize,return-to-inventory,attach-job,out-of-service}`,
  `routes/x+/fixed-asset+/capitalize.tsx` (no id: capitalize a stock unit);
  `routes/x+/depreciation-run+/$depreciationRunId.{tsx,post,repeat,delete}`;
  list/new at `routes/x+/accounting+/{fixed-assets,asset-classes,depreciation-runs}*`;
  the fleet register at `routes/x+/accounting+/fleet.tsx` (nav: Accounting →
  Fixed Assets → Assets / Fleet / Depreciation, `useAccountingSubmodules`).
- Edge functions (`packages/database/supabase/functions/`): `post-receipt`,
  `post-purchase-invoice` (acquisition, CIP-aware), `post-shipment`,
  `post-sales-invoice` (disposal), `post-asset-transfer` (transfers; registered
  in `config.toml`, `verify_jwt = true`).
- Outside the module: production `production.models.ts` (`jobValidator`
  carries `fixedAssetClassId` / `fixedAssetId`, refined to at most one:
  "A job completes to a fixed-asset class or to one asset under construction,
  not both"), `ui/Jobs/JobForm.tsx` (**Complete To**: Inventory / Fixed Asset
  Class / Asset Under Construction; `x+/job+/new.tsx` pre-fills the class from
  `?fixedAssetClassId=`), `ui/Jobs/JobHeader.tsx` (the complete dialog hides the
  location / bin pickers and says "Completes to fixed asset class …" or "Sweeps
  cost to asset …"), `routes/x+/job+/$jobId.status.tsx` (release gate, below);
  inventory `ui/Inventory/InventoryStorageUnits.tsx` (row action **Capitalize
  as Fixed Asset**); resources `routes/x+/resources+/work-centers.$id.tsx` +
  `ui/WorkCenters/WorkCenterForm.tsx` (read-only **Capital Cost** panel).

## Lifecycle

**Acquire (Draft → Active, or → Under Construction).** Four paths set
`acquisitionCost`, `depreciationStartDate` (if unset), and flip `status`:
1. Manual: create asset (Draft), then `$fixedAssetId.register` action with
   `fixedAssetRegisterValidator`. When `companySettings.accountingEnabled`, the
   route posts an acquisition journal via `postAssetRegistration()` inside one
   Kysely transaction (`sourceType` `'Manual'`, description
   `Asset Registration: <readableId>`) and only then flips the asset (journal
   first, so no capitalized asset exists without a GL entry; the whole
   transaction rolls back on failure). The lines come from `acquisitionLines()`:
   - **No prior depreciation** (`accumulatedDepreciation = 0`) — two lines:
     **Debit `assetAccountId`** (gross cost) / **Credit
     `accountDefault.retainedEarningsAccount`** (owner equity) at cost.
   - **Mid-life capitalization** (`accumulatedDepreciation > 0`) — three lines,
     so the GL asset/contra balances match the subledger's net book value instead
     of overstating the asset at gross: **Debit `assetAccountId`** (gross cost) /
     **Credit `fixedAssetClass.accumulatedDepreciationAccountId`** (opening accum
     depreciation) / **Credit `retainedEarningsAccount`** for NBV only
     (`cost − accumulatedDepreciation`).

   The route resolves `registeredStatus` from the class: a CIP class registers
   to `Under Construction` (and the server writes the CIP cost row), any other
   class to `Active`. With accounting disabled it is a bare status flip (no
   journal).
2. Via posting: `post-receipt` / `post-purchase-invoice` process Fixed Asset PO
   lines, increment `acquisitionCost`, and post Debit `assetAccountId` / Credit
   GRNI (receipt) or payables (invoice). A Draft asset flips to `Active`, or to
   **`Under Construction`** when its class `isConstructionInProgress` — then
   `depreciationStartDate` stays null and the cost is also appended as a
   `fixedAssetCipCost` row (`sourceType 'Receipt'` / `'Purchase Invoice'`,
   `sourceDocumentId` / `sourceDocumentLineId`, `journalId`). Voiding the
   document deletes its CIP rows and backs the amount out of `acquisitionCost`;
   it is refused with "Asset was capitalized; reverse the capitalization first"
   once the asset has left `Under Construction`.
3. Make (job → asset): a job with `fixedAssetClassId` completes into one new
   asset per unit; see **Make to Asset** below.
4. Capitalize from stock: `post-asset-transfer` `capitalize` consumes an
   `Available` serialized unit into a new (or a Draft) asset at its carrying
   cost; see **post-asset-transfer** below.

**Make to Asset.** The branch lives inside `complete_job_to_inventory`
(`20260922230906`, forked verbatim from
`20260922050131_mark-complete-completes-remaining-quantities.sql`), so every
completion path (ERP route, API/MCP, the `sync_finish_job_operation` trigger)
gets it. `v_asset_target` is `'asset'` when `job.fixedAssetId` is set, `'class'`
when `job.fixedAssetClassId` is, else null (the ordinary receipt). Guards, all
raised before anything moves: a job with a `salesOrderLineId` ("A job linked to
a sales order line cannot complete to a fixed asset"); a non-serial item
completing anything but exactly 1 ("Make to Asset needs a serialized item or a
quantity of one"); a `fixedAssetId` whose class is not CIP ("Job … targets fixed
asset … which is not in a Construction in Progress class"); fewer unconsumed
serial units than the quantity being completed. `$jobId.status.tsx` runs the
first two gates when a job goes `Ready`, so a bad target is refused at release.
- `'class'`: one `fixedAsset` per unit (`fixedAssetId` from
  `get_next_sequence('fixedAsset')`, name `<item name> <serial | jobId>`,
  `itemId`, `trackedEntityId`, `serialNumber`, the class's method / life /
  residual, `acquisitionDate = depreciationStartDate = company_today`,
  `locationId` = the job's, status `Active`, or `Under Construction` for a CIP
  class) plus one Posted `fixedAssetTransfer` each (`type 'Capitalization'`,
  `sourceType 'Job'`, `jobId`). Serial units are taken in the receipt's order
  (shop-floor-finished `Available` first, then by `readableId`), skipping any
  unit already carrying `attributes['Fixed Asset']`; each goes `Consumed` with
  that attribute and a `'Capitalize'` `trackedActivity` (`sourceDocument 'Fixed
  Asset'`, input = the unit). After the WIP journal, `acquisitionCost` =
  accumulated WIP ÷ units and the transfers get `amount` + `journalId`.
- `'asset'`: no new asset; the accumulated WIP becomes one `fixedAssetCipCost`
  row (`sourceType 'Job'`) and one transfer (`quantity` = the units completed),
  and the asset's `acquisitionCost` grows by it (status stays / becomes
  `Under Construction`).
- Either way the units **never enter stock**: no `itemLedger`, `costLedger`,
  `pickMethod` or `itemCost` write; the WIP discharge posts Dr class
  `assetAccountId` (description `Fixed Asset`) / Cr WIP as an `'Asset Transfer'`
  journal, both lines still `documentId = jobId` so the per-job WIP balance nets
  to zero for a re-completion; a `FixedAssetClass` dimension is stamped when
  active. With accounting disabled the assets and transfers stay at cost 0 (the
  same posture as registering with accounting off). Partial completions create
  assets for the units received so far. Covered by
  `packages/database/supabase/tests/job-completion-to-asset.test.sql`.

**Construction in progress.** A CIP class (`isConstructionInProgress`) is a
holding account: its assets sit at `Under Construction`, are skipped by
depreciation runs (`depreciation-runs.new` selects `status = 'Active'`), and
accumulate `fixedAssetCipCost` rows from (1) Fixed Asset PO lines (path 2
above), (2) jobs — **Attach Job** (`post-asset-transfer` `attachJob`) or a job
created with **Complete To** = Asset Under Construction, both swept by the
completion branch, and (3) registration / stock capitalization into the class
(`'Manual'` rows). **Capitalize** (`post-asset-transfer` `capitalizeCip`) moves
the asset into an in-service class at `inServiceDate`. The asset page offers
**Attach Job** while the asset is Draft or Under Construction and **Capitalize**
while Under Construction; `$fixedAssetId.attach-job` lists jobs with no
`salesOrderLineId`, no asset target and status not in Completed / Cancelled /
Closed; `$fixedAssetId.capitalize` offers only non-CIP classes.

**post-asset-transfer** (`functions/post-asset-transfer/index.ts`,
`validators.ts` = the zod contract + pure helpers). One `fixedAssetTransfer`
document per call, created and Posted in ONE transaction; `requirePermissions`
with `create: accounting` is enforced by the calling routes; business failures
are 400 `ValidationError`s with the message the app shows, a record the
caller's company does not own is a 404. With `accountingEnabled = false` every
ledger, entity and asset write is identical and no journal is created. Journals
are `sourceType 'Asset Transfer'`, lines `documentType 'Asset Transfer'`, with
Location / FixedAssetClass / Item dimensions. Four payload variants:
- `capitalize` (`fixedAssetClassId`, `itemId`, `trackedEntityId`, `locationId`,
  `storageUnitId?`, `transferDate`, `name?`, `fixedAssetId?` = a Draft asset to
  fill): the unit must belong to the item, be `Available`, have no live asset
  and net on-hand at the location (`resolveCapitalizationStock`: the bin with
  the highest positive net wins; a picked unit has rows in more than one bin).
  Creates the asset (or fills the Draft under the same `status = 'Draft'` race
  guard as registration) with `quantity 1`, `serialNumber` = the unit's
  `readableId`, `acquisitionDate = transferDate`, `depreciationStartDate =
  transferDate` (null for a CIP class), status `Active` (`Under Construction`
  for a CIP class); relieves the unit through the shared adjustment path
  (`itemLedger` −1, `entryType 'Negative Adjmt.'`, cost-layer consumption at
  carrying cost, no variance journal); posts Dr class asset / Cr the
  replenishment inventory account for that cost (a unit with no carrying value
  posts nothing and the asset is created at 0); writes a `'Manual'` CIP row for
  a CIP class; sets the entity `Consumed` with `attributes['Fixed Asset']` and a
  `'Capitalize'` activity. Transfer: `type 'Capitalization'`, `sourceType
  'Inventory'`. Entry points: the inventory storage-unit row action and
  `x+/fixed-asset+/capitalize.tsx` (defaults the class to the one named
  `Rental Fleet`, hides CIP classes, shows the item's current unit cost as the
  estimate).
- `return` (`fixedAssetId`, `locationId`, `storageUnitId?`, `transferDate`):
  asset must be `Active` or `Fully Depreciated` (`RETURNABLE_ASSET_STATUSES`)
  and its entity `Consumed`; the route additionally requires `itemId` and no
  `outOfServiceSince`. NBV = `acquisitionCost − accumulatedDepreciation`.
  `itemLedger` +1 (`'Positive Adjmt.'`) with a cost layer at NBV stamped with the
  unit (`costLedger.trackedEntityId`, so the unit is later sold at that NBV — see
  `inventory-system.md`), journal from
  `buildReturnToInventoryLines` when cost > 0, asset → `Disposed` with
  `disposalMethod 'Transfer to Inventory'` plus a `fixedAssetDisposal` row at
  NBV, entity back to `Available` with the `Fixed Asset` attribute removed and a
  `'Return to Inventory'` activity. Transfer: `type 'Return to Inventory'`,
  `sourceType 'Inventory'`, `amount` = NBV, `accumulatedDepreciation` recorded.
- `attachJob` (`fixedAssetId`, `jobId`): asset's class must be CIP and its
  status Draft / Under Construction; the job must not be in
  `CLOSED_JOB_STATUSES` (Completed / Cancelled / Closed), must have no
  `salesOrderLineId` and no asset target. Sets `job.fixedAssetId` (guarded on
  the job still having no target) and sweeps the job's current WIP balance:
  Dr CIP asset / Cr WIP (`'Asset Transfer'`, both lines `documentId = jobId`,
  the transfer in `documentLineReference`), one `fixedAssetCipCost` row
  (`'Job'`) and one transfer (`sourceType 'Job'`), asset → `Under Construction`
  with `acquisitionCost += balance` (nothing is swept when the balance is 0 or
  accounting is off). An unset asset location is filled from the job.
- `capitalizeCip` (`fixedAssetId`, `toClassId`, `inServiceDate`): asset must be
  `Under Construction` in a CIP class, target must not be CIP, and the asset
  needs a location (its own, else the latest attached job's). Posts Dr target
  class asset / Cr CIP asset for Σ `fixedAssetCipCost`, then sets
  `fixedAssetClassId` = target, `acquisitionCost` = the sum, `acquisitionDate =
  depreciationStartDate = inServiceDate`, status `Active` (guarded on
  `status = 'Under Construction'`). Transfer: `type 'Capitalization'`,
  `sourceType 'Construction in Progress'`, `fromClassId`, `inServiceDate`.

**Fleet register.** `x+/accounting+/fleet.tsx` renders `getFleetAssets` with
the derived status (see the view); **Build for Fleet** (needs
`create: production`) opens `path.to.newJob?fixedAssetClassId=<the class named
"Rental Fleet", else the first non-CIP class>`. Row menu: View Asset, **Rent** (only
`fleetStatus = 'Available'`, needs `create: sales`; opens
`path.to.newRentalAgreement?fixedAssetId=`, which creates the Draft agreement
with that unit as its first line), Take Out of Service / Return to Service,
Return to Inventory (rows with an `itemId` that are on the books).

**Rentals.** A rental agreement (`sales` module, documented in
`apps/erp/app/modules/sales/AGENTS.md` → Rentals) rents fleet units. An
**Operating** line posts no journal at activation, the asset stays `Active` and keeps
depreciating, and only the derived fleet status changes (Reserved → On Rent →
Available again, or In Maintenance when the return form's out-of-service box is
ticked — `post-rental-agreement` `return` sets `outOfServiceSince =
returnedAt` and the reason). `post-rental-agreement` `activate` accepts a unit
whose `fleetStatus` is `Available`, or `Reserved` by the same agreement, and
whose asset status is `Active` / `Fully Depreciated`; `In Maintenance` is
refused with "<unit> is out of service: <reason>". Deliver
(`x+/rental-agreement+/$id.$lineId.deliver.tsx`) is refused while the unit
reads In Maintenance. **Return to Inventory is refused while the unit is on a
live rental line**: `post-asset-transfer` `returnToInventory` checks for a
`rentalAgreementLine` with `status IN ('Pending','On Rent')` inside its
transaction and throws "Asset <id> is on rent|reserved on rental agreement
<RA…>; return it from the agreement first". The fleet table hides the
Return to Inventory menu item for On Rent and Reserved rows, and Take Out of
Service for On Rent rows; the edge function and the route stay the gates.

**Sales-type leases dispose the fleet asset.** A line classified **Sales-Type**
at activation (`post-rental-agreement` `commenceSalesTypeLines`) is sold to the
lease at ACTIVATION, not delivery: the asset goes `Disposed`,
`disposalMethod 'Sale'`, `disposalDate` = company today, `saleProceeds` = the
net investment, guarded on `status IN ('Active','Fully Depreciated')` (a
concurrent change refuses with "<unit> changed status while the agreement was
being activated"), plus a `fixedAssetDisposal` row (`netBookValueAtDisposal`
= C = cost − accumulated depreciation, `gainLoss` = selling profit, `journalId`
= the commencement journal). With accounting on the `'Lease'` journal (pure
builder `buildCommencementLines`, `post-rental-agreement/lessor.ts`) is: Dr Net
Investment in Leases NI, Dr COGS C − PVres, **Dr class
`accumulatedDepreciationAccountId`** accumulated depreciation / Cr Lease
Revenue PVpay, **Cr class `assetAccountId`** at cost; no gain/loss or
clearing account is used (the selling profit is Lease Revenue less COGS). The
tracked entity goes `Consumed` (attribute `Fixed Asset` removed, `Rental
Agreement` + `Customer` added, a `Lease Commencement` activity). The derived
`fleetStatus` then reads **Sold** (any Disposed asset not returned to stock)
while the rental line is still On Rent. Commencement is fleet-only: activation
refuses a line without a fleet unit, so the spec's from-stock commencement has
no entry point in v1.

**Residual return capitalizes a NEW Rental Fleet asset.** Returning a
Sales-Type line at or after `endDate` with `residualDestination: "Fleet"`
(`returnResidual`) inserts a new `fixedAsset` (new `fixedAssetId` from the
sequence) in the non-CIP class named "Rental Fleet" (else the class the unit
left at commencement; neither → "No Rental Fleet asset class to return the
unit into; create one or return the unit to inventory") with `acquisitionCost`
= the closing net investment (`netInvestmentAt`, `lessor.ts`: the
`closingNetInvestment` of the last `rentalLeaseScheduleLine` dated on or
before `returnedAt` — the closing target at or after `endDate` — or
`initialNetInvestment` when the line has no schedule; read off the schedule,
NOT off posted principal, so an unposted final month is neither overstated
nor lost),
`acquisitionDate` / `depreciationStartDate` = today, the class's method /
life / residual, `status` Active, the same `itemId` / `trackedEntityId` /
serial; a Posted `fixedAssetTransfer` (`type` Capitalization, `sourceType`
Inventory, `amount` = closing); `'Lease'` journal Dr class `assetAccountId` /
Cr Net Investment in Leases (skipped when accounting is off or closing is 0);
the entity stays `Consumed` with `Fixed Asset` = the new asset and a
`Capitalize` activity. The disposed original is untouched (the live-serial
unique index ignores Disposed rows). `residualDestination: "Inventory"`
instead books `bookAdjustment` +1 at `fixedUnitCost` = closing and Dr the
item's inventory account. Schedule lines and Planned Interest rows dated on or
before the return STAY and post through later recognition runs (that is what
brings Net Investment in Leases to zero: initial NI + Σ interest − Σ rent −
closing = 0); only unposted ones dated after the return are deleted, and only
a Draft run holding Interest rows dated after the return blocks it. A return
dated after company today is refused ("The return date cannot be in the
future"), and a Sales-Type line's billing is not re-cut by a return.

**Purchase option exercise derecognizes the rest.** Posting a Sales-Type
line's `Purchase Option` invoice line (`post-sales-invoice`,
`purchaseOptionSettlement` in `rental-posting.ts`) credits NI by the option
and settles the difference to the schedule's closing balance (the last
`rentalLeaseScheduleLine`'s `closingNetInvestment`): shortfall Dr
`costOfGoodsSoldAccount` / Cr NI, excess Dr NI / Cr `leaseRevenueAccount`,
on the option line's journal line reference so VOID reverses it. No asset is
created — the unit is the customer's.

**Out of service.** `outOfServiceSince` / `outOfServiceReason` are set together
by `setFixedAssetOutOfService` (date = company today) and cleared together by
`returnFixedAssetToService`; both through `$fixedAssetId.out-of-service.tsx`
(`update: accounting`; a plain POST takes the asset out with the form's reason,
POST `?intent=return` returns it). The loader refuses an asset already out of
service or Disposed. Accounting is untouched: the asset stays `Active` and
keeps depreciating; only the fleet status reads `In Maintenance`, and Return to
Inventory is blocked until the asset is back in service. A unit On Rent
cannot be taken out of service: the loader and the action both refuse it
(`getOnRentLineForAsset`, `sales.service.ts`, read with the service role
scoped to company + asset — an accountant may lack `sales_view`, and under RLS
that read as "not on rent"; a failed read refuses) with "The asset is on rent on
<RA…>; return it from the agreement and take it out of service there" — the
agreement's Return form has the out-of-service box for exactly that.

**Work-center link.** `fixedAsset.workCenterId` is a picker on the asset form
and a detail row on the asset page; `work-centers.$id.tsx` loads
`getWorkCenterCapitalCost` and `WorkCenterForm` renders a read-only **Capital
Cost** panel (asset id → NBV, per-asset monthly depreciation for Straight Line
assets, totals). Machine rates are still typed by hand.

**Depreciate.** Manual, in two steps — **no scheduled/cron job exists**:
1. `depreciation-runs.new` action fetches all `Active` assets, calls
   `buildDepreciationLines()`, inserts a `depreciationRun` (Draft) +
   `depreciationRunLine` per asset.
2. `$depreciationRunId.post` → `postDepreciationRun()`: per asset posts
   Debit `depreciationExpenseAccountId` / Credit `accumulatedDepreciationAccountId`
   (`sourceType: 'Asset Depreciation'`), bumps `accumulatedDepreciation`
   (+ tax / deferred-tax lines when enabled via company settings), sets run
   `Posted`, flips asset to `Fully Depreciated` when NBV hits residual.

**Dispose (Active / Fully Depreciated → Disposed).** GAAP: remove cost + accum
depreciation, recognize proceeds, and book the net **gain/(loss) = proceeds −
NBV** to a distinct non-operating line — never comingled with revenue. Carbon
uses `gainOnDisposalAccountId` / `lossOnDisposalAccountId` for that gain/loss
and `writeOffAccountId` as a **disposal clearing / holding account** in the
two-step (ship → invoice) flow.
1. Manual scrap: `$fixedAssetId.dispose` → `postDisposal()` (hardcodes
   `Scrapping`). NBV = `acquisitionCost − accumulatedDepreciation`; proceeds = 0,
   so the entire NBV is a loss. Posts Debit accumulated depreciation, **Debit
   `lossOnDisposalAccountId` for the full NBV loss**, Credit asset at cost
   (`sourceType: 'Asset Disposal'`), applies location/class dimensions, writes
   `fixedAssetDisposal` (`gainLoss = −NBV`), sets `Disposed`.
2. Via posting (two-step sale):
   - **`post-shipment`** (asset physically leaves): Debit accumulated
     depreciation, **Debit `writeOffAccountId` (disposal clearing) for NBV** — a
     balance-sheet holding, not a P&L loss — Credit asset at cost. Writes
     `fixedAssetDisposal` with `saleProceeds = 0`, `gainLoss = 0` (unknown until
     invoiced) and sets `Disposed`. **No interim P&L impact.**
   - **`post-sales-invoice`** (proceeds recognized): Debit AR for proceeds,
     **Credit `writeOffAccountId` for NBV** (clears the clearing account back to
     zero), then books the explicit gain/loss — Credit `gainOnDisposalAccountId`
     for a gain, Debit `lossOnDisposalAccountId` for a loss. Updates the
     disposal row `gainLoss = proceeds − NBV`. Over a completed cycle
     `writeOffAccountId` nets to **zero** and the gain/loss accounts carry only
     the gain/loss.
   - Direct sales invoice (no prior shipment) posts the combined single-step
     disposal: Debit accum depreciation, Credit asset at cost, Debit AR for
     proceeds, and the gain/loss to the gain / loss accounts (no clearing
     round-trip), `disposalMethod 'Sale'`.
3. Return to inventory (`post-asset-transfer` `return`, above): `Disposed`
   with `disposalMethod 'Transfer to Inventory'`, no gain/loss — the unit goes
   back to stock at NBV and is sold later like any other stock.

## Gotchas

- Tax depreciation / deferred-tax lines only post when
  `companySettings.assetTaxDepreciationEnabled` is true.
- Register posts an acquisition journal (Dr `assetAccountId` / Cr
  `retainedEarningsAccount`) when accounting is enabled, then flips status; it is
  a bare status flip only when accounting is disabled.
- `writeOffAccountId` is the **disposal clearing / holding account** (parks NBV
  between shipment and invoice, nets to zero); `gainOnDisposalAccountId` /
  `lossOnDisposalAccountId` carry the net gain/(loss). `writeDownAccountId`
  remains unused (reserved for impairment).
- Depreciation is entirely manual — there is no Inngest/cron job that advances
  periods; users must create and post each `depreciationRun`. `Under
  Construction` assets are skipped (not `Active`); out-of-service assets are not.
- `disposalMethod` (`Sale`/`Scrapping`/`Transfer to Inventory`) is set by the
  posting flow / asset column; `fixedAssetDisposalValidator` itself only carries
  `disposalDate`.
- A CIP class's own method / life / residual never run: capitalization starts
  depreciation at `inServiceDate` under the in-service class. Only
  `fixedAssetCipCost` rows are capitalized — cost that reaches a CIP asset
  without a row (there is no such path today) would be silently dropped.
- `fixedAssetTransfer.status` is always `Posted` in practice; do not build a
  Draft-review UI on the column without adding the poster.
- A fleet asset's unit must be serialized: `fixedAsset.quantity` is CHECKed to 1
  and `complete_job_to_inventory` refuses a non-serial job of more than one.
- Any Disposed asset that was not returned to stock reads `Sold` (a scrapped
  fleet unit too).
- `Reserved` means "named on a live Pending line", which includes every line of
  a DRAFT agreement. Cancelling an agreement deletes its Pending lines (the
  line status enum has no Cancelled), which is what frees the unit.
- An OPERATING rental never changes `fixedAsset.status` or `locationId`:
  custody is the agreement's `customerLocationId`, exposed on `fleetAssets`. A
  SALES-TYPE line disposes the asset at activation (above), and a residual
  return creates a different asset row rather than reviving the old one.
