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
through `journal` / `journalLine`. `journalEntrySourceType` is
`'Asset Depreciation'` for depreciation runs and `'Asset Disposal'` for the
manual scrap; the two-step sale reuses the document source types (`'Sales
Shipment'` / `'Sales Invoice'`) and manual registration uses `'Manual'`.

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
   `fixedAssetRegisterValidator`. When `companySettings.accountingEnabled`, the
   route posts an acquisition journal via `postAssetRegistration()` inside one
   Kysely transaction (`sourceType` `'Manual'`, description
   `Asset Registration: <readableId>`) and only then flips the asset to `Active`
   (journal first, so no capitalized asset exists without a GL entry; the whole
   transaction rolls back on failure). The lines come from `acquisitionLines()`
   (`accounting.utils.ts`):
   - **No prior depreciation** (`accumulatedDepreciation = 0`) — two lines:
     **Debit `assetAccountId`** (gross cost) / **Credit
     `accountDefault.retainedEarningsAccount`** (owner equity) at cost.
   - **Mid-life capitalization** (`accumulatedDepreciation > 0`) — three lines,
     so the GL asset/contra balances match the subledger's net book value instead
     of overstating the asset at gross: **Debit `assetAccountId`** (gross cost) /
     **Credit `fixedAssetClass.accumulatedDepreciationAccountId`** (opening accum
     depreciation) / **Credit `retainedEarningsAccount`** for NBV only
     (`cost − accumulatedDepreciation`).

   With accounting disabled it is a bare status flip (no journal).
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

**Dispose (Active / Fully Depreciated → Disposed).** GAAP: remove cost + accum
depreciation, recognize proceeds, and book the net **gain/(loss) = proceeds −
NBV** to a distinct non-operating line — never comingled with revenue. Carbon
uses `disposalAccountId` for that gain/loss and `writeOffAccountId` as a
**disposal clearing / holding account** in the two-step (ship → invoice) flow.
1. Manual scrap: `$fixedAssetId.dispose` → `postDisposal()` (hardcodes
   `Scrapping`). NBV = `acquisitionCost − accumulatedDepreciation`; proceeds = 0,
   so the entire NBV is a loss. Posts Debit accumulated depreciation, **Debit
   `disposalAccountId` for the full NBV loss**, Credit asset at cost
   (`sourceType: 'Asset Disposal'`), applies location/class dimensions, writes
   `fixedAssetDisposal` (`gainLoss = −NBV`), sets `Disposed`.
2. Via posting (two-step sale):
   - **`post-shipment`** (asset physically leaves): Debit accumulated
     depreciation, **Debit `writeOffAccountId` (disposal clearing) for NBV** — a
     balance-sheet holding, not a P&L loss — Credit asset at cost. Writes
     `fixedAssetDisposal` with `saleProceeds = 0`, `gainLoss = 0` (unknown until
     invoiced). **No interim P&L impact.**
   - **`post-sales-invoice`** (proceeds recognized): Debit AR for proceeds,
     **Credit `writeOffAccountId` for NBV** (clears the clearing account back to
     zero), then books the explicit gain/loss to `disposalAccountId` — Credit for
     a gain, Debit for a loss. Updates the disposal row `gainLoss = proceeds −
     NBV`. Over a completed cycle `writeOffAccountId` nets to **zero** and
     `disposalAccountId` carries only the gain/loss.
   - Direct sales invoice (no prior shipment) posts the combined single-step
     disposal: Debit accum depreciation, Credit asset at cost, Debit AR for
     proceeds, and the gain/loss to `disposalAccountId` (no clearing round-trip).

## Gotchas

- Tax depreciation / deferred-tax lines only post when
  `companySettings.assetTaxDepreciationEnabled` is true.
- Register posts an acquisition journal (Dr `assetAccountId` / Cr
  `retainedEarningsAccount`) when accounting is enabled, then flips status; it is
  a bare status flip only when accounting is disabled.
- `writeOffAccountId` is the **disposal clearing / holding account** (parks NBV
  between shipment and invoice, nets to zero); `disposalAccountId` carries the
  net gain/(loss). `writeDownAccountId` remains unused (reserved for impairment).
- Depreciation is entirely manual — there is no Inngest/cron job that advances
  periods; users must create and post each `depreciationRun`.
- `disposalMethod` (`Sale`/`Scrapping`) is set by the posting flow / asset
  column; `fixedAssetDisposalValidator` itself only carries `disposalDate`.
