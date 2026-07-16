---
paths:
  - "apps/erp/app/modules/accounting/**"
  - "apps/erp/app/routes/x+/fixed-asset+/**"
  - "apps/erp/app/routes/x+/depreciation-run+/**"
  - "packages/database/supabase/migrations/*fixed-asset*"
---

# Fixed Asset Lifecycle

Fixed assets are acquired, depreciated, and disposed through the accounting
module. They integrate with purchasing (acquisition via PO receipt / purchase
invoice) and sales (disposal via shipment / sales invoice). All GL postings flow
through `journal` / `journalLine` with `journalEntrySourceType` values
`'Asset Depreciation'` and `'Asset Disposal'`.

Schema lives in three migrations (newest wins):
`20260524143826_fixed-asset-enums.sql`, `20260524143827_fixed-assets.sql`,
`20260525084319_seed-fixed-asset-classes.sql`.

## Tables (current schema)

- **`fixedAsset`** — master record. Key columns: `fixedAssetId` (readable),
  `fixedAssetClassId`, `name`, `serialNumber`, `status` (`fixedAssetStatus`),
  `depreciationMethod`, `usefulLifeMonths`, `residualValuePercent`,
  `acquisitionCost`, `acquisitionDate`, `depreciationStartDate`,
  `accumulatedDepreciation`, `accumulatedTaxDepreciation`, `assetLifetimeUsage`
  (Units of Production), `locationId`, `disposalDate`, `disposalMethod`,
  `saleProceeds`. Tax columns: `taxDepreciationMethod`, `taxUsefulLifeMonths`,
  `taxResidualValuePercent`, `macrsPropertyClass`, `macrsConvention`,
  `bonusDepreciationPercent`.
- **`fixedAssetClass`** — classification + GL account mappings. Six NOT NULL
  account FKs: `assetAccountId`, `accumulatedDepreciationAccountId`,
  `depreciationExpenseAccountId`, `writeOffAccountId`, `writeDownAccountId`,
  `disposalAccountId`. Also default depreciation/tax settings. Seeded with
  Buildings / Machinery & Equipment / Vehicles.
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
calculation and posting is application-level (see below).

## Enums (`20260524143826_fixed-asset-enums.sql`)

- `fixedAssetStatus`: `Draft`, `Active`, `Fully Depreciated`, `Disposed`
- `depreciationMethod`: `Straight Line`, `Declining Balance`, `Units of Production`
- `taxDepreciationMethod`: `Straight Line`, `Declining Balance`, `MACRS`
- `disposalMethod`: `Sale`, `Scrapping`
- `macrsPropertyClass`: `3`,`5`,`7`,`10`,`15`,`20`,`27.5`,`39`
- `macrsConvention`: `Half-Year`, `Mid-Quarter`

## Line-type integration

`purchaseOrderLine`, `salesOrderLine`, `salesInvoiceLine`, `purchaseInvoiceLine`
each have an `assetId` FK → `fixedAsset(id)`, with `'Fixed Asset'` as a line-type
enum value (CHECK: only Fixed Asset lines have non-NULL `assetId`). The
`*Lines` views LEFT JOIN `fixedAsset` and expose `assetReadableId` + `assetName`.

## Code

- Models/validators: `apps/erp/app/modules/accounting/accounting.models.ts` —
  enum arrays (`fixedAssetStatuses`, `depreciationMethods`,
  `taxDepreciationMethods`, `disposalMethods`) and validators
  `fixedAssetClassValidator`, `fixedAssetValidator`, `fixedAssetRegisterValidator`
  (acquisitionCost/Date, accumulatedDepreciation, depreciationStartDate),
  `depreciationRunValidator` (periodEnd only), `fixedAssetDisposalValidator`
  (disposalDate only), `fixedAssetUsageLogValidator`.
- Service: `accounting.service.ts` — `getFixedAsset(s)`, `insert/update/deleteFixedAsset`,
  `getFixedAssetsListForSale` (status Active/Fully Depreciated), class CRUD,
  `insert/getDepreciationRun(s)`, `getDepreciationRunLines`,
  `getAssetDepreciationHistory`, `getFixedAssetDisposal`, usage-log helpers.
  Note `upsertFixedAsset` is deprecated — use insert/update.
- Server transactions (Kysely): `accounting.server.ts` — `postDisposal()` (L37)
  and `postDepreciationRun()` (L225) build journals and update asset rows.
- Calc utils: `accounting.utils.ts` — `buildDepreciationLines()` (L447),
  `getNextPeriodEnd()` (L252), MACRS data.
- UI: `accounting/ui/FixedAssets/` — `FixedAssetForm`, `AssetClassForm`,
  `FixedAssetRegisterForm`, `FixedAssetDisposalForm`, tables, status badges.
- Routes: `routes/x+/fixed-asset+/$fixedAssetId.{tsx,register,dispose,sell,purchase,details,delete}`;
  `routes/x+/depreciation-run+/$depreciationRunId.{tsx,post,repeat,delete}`;
  list/new at `routes/x+/accounting+/{fixed-assets,asset-classes,depreciation-runs}*`.
- Edge functions (`packages/database/supabase/functions/`): `post-receipt`,
  `post-purchase-invoice` (acquisition), `post-shipment`, `post-sales-invoice`
  (disposal).

## Lifecycle

**Acquire (Draft → Active).** Two paths set `acquisitionCost`,
`depreciationStartDate` (if unset), and flip `status` to `Active`:
1. Manual: create asset (Draft), then `$fixedAssetId.register` action with
   `fixedAssetRegisterValidator`. The action calls
   `postAssetAcquisition()` (`accounting.server.ts`), which writes the register
   fields + flips to `Active` and — when `companySettings.accountingEnabled` —
   posts an acquisition journal in the same transaction:
   **Dr `fixedAssetClass.assetAccountId` / Cr acquisition source** at cost, where
   the acquisition source is `accountDefault.goodsReceivedNotInvoicedAccount`
   (GR/IR clearing — the same account the receipt path credits, so a later
   purchase invoice reconciles it). `sourceType` is `'Manual'` (there is no
   `'Asset Acquisition'` enum value). No manually-registered asset exists without
   a GL entry.
2. Via posting: `post-receipt` / `post-purchase-invoice` process Fixed Asset PO
   lines, increment `acquisitionCost`, and post Debit `assetAccountId` / Credit
   payables.

**Depreciate.** Manual, in two steps — **no scheduled/cron job exists**:
1. `depreciation-runs.new` action fetches all `Active` assets, calls
   `buildDepreciationLines()`, inserts a `depreciationRun` (Draft) +
   `depreciationRunLine` per asset.
2. `$depreciationRunId.post` → `postDepreciationRun()`: per asset posts
   Debit `depreciationExpenseAccountId` / Credit `accumulatedDepreciationAccountId`
   (`sourceType: 'Asset Depreciation'`), bumps `accumulatedDepreciation`
   (+ tax / deferred-tax lines when enabled via company settings), sets run
   `Posted`, flips asset to `Fully Depreciated` when NBV hits residual.

**Dispose (Active / Fully Depreciated → Disposed).** GAAP splits the net-book-value
removal (Balance Sheet) from the gain/loss recognition (P&L). Gain/loss on disposal
routes to `fixedAssetClass.disposalAccountId`; **`writeOffAccountId` is no longer
used by any disposal path** (it nets to zero). The two-step (ship → invoice) path
parks NBV in a Balance-Sheet clearing account between legs so a shipped-but-uninvoiced
asset has **zero P&L impact**.

1. Manual scrap: `$fixedAssetId.dispose` → `postDisposal()` (route hardcodes
   `Scrapping`, proceeds 0). NBV = `acquisitionCost − accumulatedDepreciation`.
   Posts Debit accumulated depreciation, **Debit `disposalAccountId` for NBV (the
   loss)**, Credit asset at cost (`sourceType: 'Asset Disposal'`), applies
   location/class dimensions, writes `fixedAssetDisposal` (`gainLoss = −NBV`), sets
   `Disposed`.
2. Two-step sale — **shipment** (`post-shipment`, asset physically leaves):
   Debit accumulated depreciation, **Debit Disposal Clearing =
   `accountDefault.assetAquisitionCostOnDisposalAccount` for NBV** (Balance-Sheet
   holding, account 1320), Credit asset at cost. No gain/loss, no write-off →
   zero P&L. `fixedAssetDisposal` row gets `gainLoss = 0` (unrealized).
3. Two-step sale — **invoice** (`post-sales-invoice`, proceeds recognized): Debit
   AR for proceeds, **Credit Disposal Clearing for NBV (drains it)**, and net the
   gain/loss (`proceeds − NBV`) to `disposalAccountId` (gain → credit, loss →
   debit). Updates the disposal row `gainLoss`. A **direct invoice with no prior
   shipment** posts the classic combined entry (Debit accum. dep., Debit AR,
   Credit asset at cost, gain/loss → `disposalAccountId`); Disposal Clearing is
   not used.

The pure posting math is shared/tested in `@carbon/utils`
(`fixed-asset.ts` + `fixed-asset.test.ts`): `acquisitionLines`,
`disposalShipmentLines`, `disposalInvoiceLines`, `disposalCombinedLines`. The app
poster uses it directly; the Deno edge functions mirror the same arithmetic inline.

## Gotchas

- Tax depreciation / deferred-tax lines only post when
  `companySettings.assetTaxDepreciationEnabled` is true.
- Register now posts an acquisition journal (Dr asset / Cr GR/IR) via
  `postAssetAcquisition()` when accounting is enabled — it is no longer a pure
  status flip.
- The seed (`20260525084319`) maps `writeOffAccountId`, `writeDownAccountId`, and
  `disposalAccountId` **all to account 6320**. For the GAAP gain/loss separation to
  be visible in reporting, point `disposalAccountId` at a distinct
  Gain/(Loss)-on-Disposal P&L account; the posting code already keeps NBV (Balance
  Sheet clearing) separate from gain/loss (`disposalAccountId`).
- Depreciation is entirely manual — there is no Inngest/cron job that advances
  periods; users must create and post each `depreciationRun`.
- `disposalMethod` (`Sale`/`Scrapping`) is set by the posting flow / asset
  column; `fixedAssetDisposalValidator` itself only carries `disposalDate`.
