# Rental agreement seed shape — research for a demo-dataset seed spec

Date: 2026-11-10. Read-only research. Every claim cites `file:line` (paths relative to the
worktree root `/Users/aashu/work/carbon/carbon/.claude/worktrees/fix-rental-contacts-demo-data`).
"Not verified" marks anything inferred rather than read.

Abbreviations: `M/` = `packages/database/supabase/migrations/`, `SS` =
`apps/erp/app/modules/sales/sales.service.ts`, `SV` = `apps/erp/app/modules/sales/sales.server.ts`,
`INV` = `apps/erp/app/modules/inventory/inventory.service.ts`,
`INVC` = `apps/erp/app/modules/invoicing/invoicing.service.ts`, `DS` = `packages/database/src/datasets/`.

---

## 0. Headline findings (read first)

1. **No dataset seeds rentals today.** `grep -i rental` over `DS` finds only item and opportunity
   names ("Fleet Uptime Support", `DS/data/robotics/items.ts:275`). Seeded fixed assets have no
   `itemId` and no `trackedEntityId` (`DS/tiers/09-accounting.ts:419-445`). The `fleetAssets` view
   keeps only rows `WHERE fa."itemId" IS NOT NULL` (`M/20261006220501_rental-agreements.sql:294`).
   So no seeded asset is a fleet unit, and the seed must add fleet units first.
2. **The seed cannot import the billing math.** `generateRentalBillingPeriods`, `billingHorizon` and
   `periodCharge` live in `packages/utils/src/rental-periods.ts:252,272,330`. `classifyRentalLine`
   and `leasePaymentTerms` live in `packages/utils/src/lessor-lease.ts:320,415`. `@carbon/utils`
   depends on `@carbon/database` (`packages/utils/package.json:4`). `@carbon/database` lists only
   `@carbon/config` (`packages/database/package.json:4`). Precedent: the contract schedule math moved
   into `@carbon/database` "so the demo-dataset tier can plan a schedule" (sales AGENTS → Contracts →
   Schedule math). The seed must either move the rental math into `@carbon/database` or write the
   period rows as literals.
3. **Recommend `Rental` (operating) lines only.** Activation writes no journal for a `Rental` line.
   It writes only the line, the periods and the header (`SS:17852-17903`). Only
   `commenceSalesTypeLines` writes journals, and it runs for `Sale` plans only (`SS:17842-17849`).
   A `Sale` line writes a `'Lease'` journal, disposes the asset, consumes the serial and writes a
   lease schedule with Interest rows (§3.2). The dataset wipe does not void `'Lease'` journals:
   `DOCUMENT_JOURNAL_SOURCES` has no `Lease` (`DS/wipe.ts:306-317`). A re-apply would then leave
   live journals for deleted documents.
4. **The nightly job acts on seeded Active agreements.** `recurring-billing` runs at `0 5 * * *`
   (`packages/jobs/src/inngest/functions/scheduled/recurring-billing.ts:57`). It calls
   `create-rental-invoices` (`:254`), which drafts every Pending period with `dueOn <= asOf`
   (`SS:15349-15350`). The company default `invoiceAutomation` is `'Post and Email'`
   (`M/20261006221101_rental-invoice-automation.sql:10`). Under that mode the job posts and emails
   the drafts (sales AGENTS → Invoice generation and automation). So the first night bills and emails
   every seeded period that is due and not billed. Seed those periods as Invoiced with their
   invoices, or set the agreement's `invoiceAutomation` to `'Draft Only'`.
5. **The wipe cannot delete a Posted deposit.** The `payment` before-interceptor
   `prevent_invalid_deposit_refund` raises `'Posted advances and refunds must be voided, not
   deleted'` when a delete hits a Posted payment with `rentalAgreementId`
   (`M/20261106195705_legacy-deposit-refund-lock-order.sql:36-42`). It has no `app.sync_in_progress`
   bypass. `DS/wipe.ts` has no deposit handling (a grep for `deposit|prepayment|replication` finds
   nothing). So a Posted rental deposit breaks `wipeFirst`. A Draft deposit is safe.
6. **The seed's invoice journal helper handles only Part lines** (`DS/helpers/posting-journals.ts:154`,
   `DS/helpers/post-documents.ts:193`). It writes no `revenueRecognitionSchedule` rows. A Posted
   Rental invoice needs a new builder (§3.6).

---

## 1. Tables, columns, constraints, enums

### 1.1 Enums (`M/20261006220301_fleet-rental-lease-enums.sql`)

| Enum | Values | Cite |
|---|---|---|
| `rentalAgreementStatus` | Draft, Active, Closed, Cancelled | `:29`; types `packages/database/src/types.ts:110165` |
| `rentalAgreementLineStatus` | Pending, On Rent, Returned, Sold | `:32`; types `:110164` |
| `rentalBillingCycle` | Calendar Month, 28 Days, + Monthly | `:35`; `M/20261016144058_rental-monthly-billing-cycle.sql:5`; types `:110166` |
| `rentalBillingTiming` | Advance, Arrears | `:38` |
| `rentalBillingPeriodStatus` | Pending, Invoiced | `:41` |
| `rentalInvoiceLineType` | Rent, Charge, Purchase Option | `:44` |
| `rentalRateUnit` | Day, Week, Month | `:47` |
| `lessorClassification` | Rental, Sale, Financing (no input for Financing) | `:50` |
| `invoiceAutomation` | Draft Only, Post, Post and Email, Post and Send via Stripe | `M/20261006221101…:6` |
| `revenueScheduleType` | Deferral, Accrual, Interest (+ Amortization, Cost Relief, Loss Provision) | `M/20261006220101_revenue-recognition-enums.sql:7`, `M/20261011163133…:8`, `M/20261021005800…:8-9` |
| `revenueScheduleStatus` | Planned, Posted | `M/20261006220101…:10` |
| Added values | `journalLineDocumentType` / `itemLedgerDocumentType` += `Rental Agreement`; `salesInvoiceLineType` += `Rental`; `journalEntrySourceType` += `Lease`; `fixedAssetStatus` += `Under Construction`; `disposalMethod` += `Transfer to Inventory` | `:6-18` |
| `shipmentSourceDocument` / `receiptSourceDocument` | += `Rental Agreement` | `M/20261008155050_rental-documents-enums.sql:3-4` |

### 1.2 `rentalAgreement` (`M/20261006220501_rental-agreements.sql:32-78`, + `invoiceAutomation` `M/20261006221101…:14-15`; Row type `types.ts:65752-65788`)

| Column | Type / default | Notes |
|---|---|---|
| `id` | TEXT `id('rag')` | PK `(id, companyId)` `:64` |
| `rentalAgreementId` | TEXT NOT NULL | UNIQUE `(rentalAgreementId, companyId)` `:65`; sequence `RA`, size 6 (`packages/database/src/seed-data.ts:600-607`) |
| `status` | enum NOT NULL DEFAULT Draft | `:36` |
| `customerId` | NOT NULL FK customer | `:37` |
| `customerLocationId` | FK customerLocation, null | "Rental Site"; copied to invoice ship-to (`SS:15650`) |
| `customerContactId` | FK customerContact, null | primary contact; trigger-checked (§4) |
| `salesPersonId` | FK user, null | |
| `locationId` | NOT NULL FK location | |
| `startDate` | DATE NOT NULL | |
| `endDate` | DATE null | CHECK `endDate IS NULL OR endDate > startDate` `:68` |
| `billingCycle` | DEFAULT 'Calendar Month' | |
| `billingTiming` | DEFAULT 'Advance' | |
| `paymentTermId` | FK paymentTerm, null | |
| `currencyCode` | NOT NULL | activation refuses non-base currency (`SS:17619-17624`) |
| `exchangeRate` | NOT NULL DEFAULT 1 | |
| `taxPercent` | NOT NULL DEFAULT 0 | fraction 0–1 (`sales.models.ts:1561-1566`) |
| `depositAmount` | NOT NULL DEFAULT 0 | |
| `discountRate` | NUMERIC **NOT NULL, no default** | annual %; UI prefills from `companySettings.leaseDefaultDiscountRate` (sales AGENTS → rentalAgreement row) |
| `ownershipTransfers`, `specializedAsset`, `purchaseOptionReasonablyCertain` | BOOL NOT NULL DEFAULT false | lease tests a/e/b |
| `purchaseOptionAmount` | NUMERIC null | validator refuses reasonably-certain without endDate (`sales.models.ts:1585-1591`) |
| `notes` | TEXT | |
| `activatedAt`, `closedAt` | timestamptz null | set by activate / close (`SS:17894-17903`, `SS:18452-18462`) |
| `invoiceAutomation` | enum null | NULL = company default |
| `customFields` | JSONB | |
| audit | `createdBy` NOT NULL FK user, `createdAt` DEFAULT NOW(), `updatedBy`, `updatedAt` | |

View `rentalAgreements` adds `customerName`, `lineCount`, `onRentCount`, `nextDueOn`, `unbilledAmount`
(Σ Pending periods), `effectiveInvoiceAutomation` (`M/20261006221101…:32-61`).

### 1.3 `rentalAgreementLine` (`M/20261006220501…:81-132`; Row `types.ts:66365`)

| Column | Notes |
|---|---|
| `id` `id('ragl')`, `companyId`, `rentalAgreementId` | composite FK `(rentalAgreementId, companyId)` → agreement ON DELETE CASCADE `:117` |
| `status` | DEFAULT 'Pending' `:85` |
| `fixedAssetId` | FK fixedAsset, nullable — but activation refuses any line without one (`SS:17678-17680`) |
| `itemId` | **NOT NULL** FK item — the app copies it from the asset (`SS:9858`) |
| `trackedEntityId` | FK trackedEntity — copied from the asset (`SS:9859`) |
| `quantity` | DEFAULT 1, CHECK = 1 `:89` |
| `rateUnit` | NOT NULL DEFAULT 'Month' |
| `rate` | NUMERIC NOT NULL, CHECK ≥ 0 `:116`; activation refuses 0 (`unpricedUnitError`, `SS:17383`, used `SS:17738`) |
| `fairValue`, `economicLifeMonths` | null; lease inputs |
| `guaranteedResidualValue`, `unguaranteedResidualValue` | NOT NULL DEFAULT 0 |
| `lessorClassification` | null on Draft; set at activation (`SS:17874`) |
| `classificationOverride` BOOL DEFAULT false, `classificationOverrideReason` | override route only |
| `classificationInputs` | JSONB, set at activation for EVERY line (`SS:17876`); shape `ClassificationInputs` (`packages/utils/src/lessor-lease.ts:376-393`) |
| `initialNetInvestment`, `sellingProfit`, `commencementJournalId` (FK journal ON DELETE SET NULL) | `Sale` lines only (`SS:17864-17870`) |
| `deliveredAt` DATE, `meterOut` | written by a posted rental shipment (`INV:18736-18746`) |
| `returnedAt` DATE, `meterIn`, `returnNotes` | written by `returnRentalUnit` (`SS:16764-16779`) |
| audit | createdBy NOT NULL |

Unique partial index `rentalAgreementLine_asset_live_idx (companyId, fixedAssetId) WHERE fixedAssetId
IS NOT NULL AND status IN ('Pending','On Rent')` (`:130-132`): one live line per asset, across Draft and
Active agreements alike.

### 1.4 `rentalAgreementCharge` (`:135-163`, + `voidedSalesInvoiceId` `M/20261006221101…:21-22`, + `invoiceSeparately` `M/20261012181937…:6-7`)

`id('ragc')`; `rentalAgreementLineId` NOT NULL (composite FK → line, CASCADE `:150`); `chargeType`
DEFAULT 'Charge'; `chargeDate` DATE NOT NULL; `description` NOT NULL; `amount` NOT NULL; `taxPercent`
DEFAULT 0; `salesInvoiceLineId` (no FK) = billed stamp; `voidedSalesInvoiceId`; `invoiceSeparately`
BOOL DEFAULT false. Unique partial `(companyId, rentalAgreementLineId) WHERE chargeType = 'Purchase
Option'` (`:161-163`).

### 1.5 `rentalBillingPeriod` (`:166-194`, + `voidedSalesInvoiceId` `M/20261006221101…:19-20`, + `memoId` `M/20261007171726_rental-credit-memos.sql:24-33`)

`id('rbp')`; `rentalAgreementLineId` NOT NULL (composite FK, CASCADE `:184`); `periodStart`,
`periodEnd` DATE NOT NULL; `days` INT NOT NULL; `rateUnitApplied` (null only on an adjustment for a period that starts after the return, `rental-periods.ts:469`);
`amount` NOT NULL (negative on adjustments); `isAdjustment` DEFAULT false; `dueOn` NOT NULL; `status`
DEFAULT 'Pending'; `salesInvoiceLineId` (no FK); `voidedSalesInvoiceId`; `memoId` FK memo ON DELETE
RESTRICT. UNIQUE `(companyId, rentalAgreementLineId, periodStart, isAdjustment)` `:186`; CHECK
`memoId IS NULL OR (isAdjustment AND salesInvoiceLineId IS NULL)` (`M/20261007171726…:30-31`).

### 1.6 `rentalAgreementContact` (`M/20261104063711_rental-agreement-contacts.sql:5-30`)

`id('rac')`; `rentalAgreementId` NOT NULL (composite FK → agreement CASCADE `:18-20`);
`customerContactId` NOT NULL FK customerContact CASCADE; `role` TEXT CHECK `char_length ≤ 50` `:25`;
`sortOrder` INT NOT NULL DEFAULT 0 (order added; the app writes 0..n-1, `SS:9703-9711`); UNIQUE
`(rentalAgreementId, customerContactId, companyId)` `:23-24`. Never holds the primary contact (the app
filters it out, `SS:9581-9585`; the update trigger deletes a promoted one, `:49-52`). Every contact must
be a `customerContact` of the agreement's customer (`SS:9588-9605`) — app-side only for list rows; the DB
checks only the primary (§4). RLS: SELECT only (`M/20261104075634…:15`).

### 1.7 `rentalLeaseScheduleLine` (`:348-374`) — `Sale` lines only

`id('rlsl')`; line FK CASCADE; `periodDate`, `openingNetInvestment`, `paymentAmount`,
`interestAmount`, `principalAmount`, `closingNetInvestment` all NOT NULL; `journalId`, `postedAt`
(stamped by the lease run). UNIQUE `(companyId, rentalAgreementLineId, periodDate)`.

### 1.8 Rate cards (not needed for activation, needed for a realistic Draft UI)

- `itemRentalRate` (`:9-29`): per `(companyId, itemId, currencyCode)` unique; day/week/month, CHECK ≥ 1 tier.
- `customerItemRentalRate` (`:301-344`): exactly one of `customerId` / `customerTypeId`, ≥ 1 tier,
  `validFrom ≤ validTo`; partial uniques per scope.
- Activation reads no rate card — only the line's own `rate` / `rateUnit` (`SS:17735-17741`).

### 1.9 Columns rentals add elsewhere

- `salesInvoiceLine`: `rentalAgreementId`, `rentalAgreementLineId`, `rentalBillingPeriodId`,
  `rentalAgreementChargeId`, `rentalLineType`; CHECK `salesInvoiceLine_rental_check`: non-Rental ⇒
  `rentalAgreementLineId IS NULL`; Rental ⇒ `rentalAgreementLineId` and `rentalLineType` NOT NULL
  (`:197-212`). Also `serviceStartDate`/`serviceEndDate` paired CHECK (`M/20261006220201…:164-166`).
- `payment`: `rentalAgreementId` composite FK ON DELETE SET NULL; CHECK at most one of
  `salesOrderId, rentalAgreementId, customerContractId, purchaseOrderId`
  (`:222-236`, widened `M/20261021012500…:249`, `M/20261105213627…:26`).
- `memo.rentalAgreementId` (`M/20261007171726…:12-18`).
- `revenueRecognitionSchedule`: `rentalAgreementLineId`, `rentalLeaseScheduleLineId` (`M/20261006220201…:214-215`), `memoId`.
- `shipmentFixedAssetLine` / `receiptFixedAssetLine`: `rentalAgreementLineId` (composite FK CASCADE),
  `meter`; receipt adds `notes`, `takeOutOfService`, `outOfServiceReason`, `residualDestination`
  (CHECK Fleet/Inventory); CHECK exactly one source line (`M/20261008155056_rental-documents.sql:4-44`).
  Partial uniques: one Draft rental shipment / receipt per agreement (`:47-52`).
- `companySettings`: `leaseMajorPartThresholdPercent` 75, `leaseSubstantiallyAllThresholdPercent` 90,
  `leaseDefaultDiscountRate` 6 — all NOT NULL with defaults (`:242-245`); `invoiceAutomation`
  DEFAULT 'Post and Email', `invoiceNotificationGroup` (`M/20261006221101…:9-11`).
- `fixedAsset` fleet bridge: `itemId`, `trackedEntityId`, `quantity` (CHECK = 1), `workCenterId`,
  `outOfServiceSince`/`Reason` (CHECK both or neither); unique `(companyId, trackedEntityId) WHERE
  status <> 'Disposed'` (`M/20261006220401_fleet-bridge.sql:9-43`).

---

## 2. What a line points at, and what must exist first

A line rents one fleet unit: a `fixedAsset` row with `itemId` set (`SS:9835-9837` refuses an asset
without one). At activation the asset must meet 3 rules (`SS:17351-17379`):

1. Status `Active` or `Fully Depreciated` (`RENTABLE_ASSET_STATUSES`, `SS:17321-17323`).
2. Not out of service.
3. `fleetStatus` Available, or Reserved by the same agreement.

`getRentableFleetAssets` reads `fleetAssets` where `fleetStatus = 'Available'` (`SS:10180-10192`).

`fleetStatus` derivation (`M/20261006220501…:270-278`): Disposed+Transfer to Inventory → Returned to
Stock; other Disposed → Sold; Under Construction; live line On Rent → On Rent; out of service → In
Maintenance; live line Pending → Reserved; else Available. The view INNER JOINs `item` and
`fixedAssetClass` (`:280-281`).

Prerequisite chain for each seeded fleet unit (mirrors `post-asset-transfer` capitalize):

1. An item — serial-tracked by convention (Rental Rates card is for serial-tracked parts, sales AGENTS →
   itemRentalRate row; activation itself does not check the tracking type — I found no check in
   `SS:17592-17917`).
2. A `trackedEntity` serial of that item. The capitalize path leaves it `status 'Consumed'` with
   `attributes || {"Fixed Asset": <asset id>}` (`apps/erp/app/modules/accounting/accounting.service.ts:14090-14098`)
   plus a `Capitalize` `trackedActivity` (`sourceDocument 'Fixed Asset'`, attributes `{"Fixed Asset": id}`)
   and a `trackedActivityInput` row qty 1 (`accounting.service.ts:13746-13770`). Tier 03 seeds serials
   as `status 'Available'`, `sourceDocument 'Item'`, `attributes {}` (`DS/tiers/03-inventory.ts:105-123`).
3. A `fixedAsset` in the **Rental Fleet** class (seeded by `seed-data.ts:2410-2425`: Straight Line,
   60 mo, 20 % residual, accounts 1370 / 1380) with `itemId`, `trackedEntityId`, `quantity 1`,
   `serialNumber` = the serial's readableId, status Active, `locationId`. Tier 09 already reads classes by
   name (`DS/tiers/09-accounting.ts:395-401`) but `FixedAssetSpec` has no item/serial fields
   (`DS/types.ts:1908-1941`) — a spec change.
4. A customer (+ `customerContact` with an email if the agreement emails invoices) and a location.
5. Sequence `rentalAgreement` (seeded per company, `seed-data.ts:600-607`; migration backfill
   `M/20261006220501…:248-251`).
6. A currency row with `decimalPlaces` in the company group (activation and drafting read it,
   `SS:15287-15298`; `currencyDecimals` at `SS:17624-17628`) — not verified that datasets seed it beyond the base.

Not verified: does a seeded unit also need the `itemLedger` −1 row and the journal that the
capitalize posting writes (`fixed-asset-lifecycle.md` → post-asset-transfer `capitalize`)? The current
fixed-asset seed writes no acquisition journal (`DS/tiers/09-accounting.ts:419-445`).

---

## 3. What each action writes

### 3.1 Draft (create)

`createRentalAgreement` (`SV:4689-4800`): `getNextSequenceNumber('rentalAgreement')`, insert header via
`insertRentalAgreement` (`SS:9373-9395`, fields picked by `rentalAgreementTerms` `SS:9337-9368`), then
contacts via `saveRentalAgreementContacts` (`SS:9638-9732`: sets `customerContactId`, rows for the rest),
then optionally one line via `upsertRentalAgreementLine` (`SS:9784-9895`). A Draft line row:
`rentalAgreementId, fixedAssetId, itemId, trackedEntityId, rateUnit, rate, fairValue,
economicLifeMonths, guaranteedResidualValue (0), unguaranteedResidualValue (0)` (`SS:9863-9874`); status
defaults Pending, so a Draft already RESERVES its units. No periods, no classification.

### 3.2 Activate — `postRentalAgreement` `activate` (route `$id.activate.tsx:15` → `SV:5060-5098` → `invokePosting('post-rental-agreement')` → `SS:18558-18576` → `activate` `SS:17592-17917`)

Activation runs in one Kysely transaction. It locks the agreement `FOR UPDATE` (`lockAgreement`
`SS:15915-15952`). It refuses unless all 7 checks pass: Draft; base currency; at least 1 line; a fleet
asset on every line; each unit available; rate > 0; no Financing override. A `Sale` line must also pass
`salesTypeRequirementError`. Then it writes, in this order:

1. `commenceSalesTypeLines` for `Sale` plans only (`SS:17842-17849`; body `SS:17919-18224`) — see below.
2. Every line (`SS:17852-17882`): `lessorClassification`, `classificationInputs` (JSON record),
   `status = deliveredAt ? 'On Rent' : 'Pending'`, `updatedBy/At`; `Sale` lines also
   `initialNetInvestment`, `sellingProfit`, `commencementJournalId`.
3. `rentalBillingPeriod` rows (`SS:17884-17892`) from `billingPeriodRow` (`SS:15954-15973`):
   `periodStart, periodEnd, days, amount, rateUnitApplied, isAdjustment(false), dueOn, status 'Pending',
   companyId, createdBy`. The rules of `generateRentalBillingPeriods`
   (`packages/utils/src/rental-periods.ts:330-476`):

   | Rule | Value | Cite |
   |---|---|---|
   | First period starts on | the agreement `startDate`, never the delivery date | `:411` |
   | Cut through | `activationBillingThrough` = `billingHorizon(cycle, today)`, capped at `endDate` for `Sale` | `SS:16239-16251` |
   | `billingHorizon` | Calendar Month: end of next month; Monthly: today + 1 month; 28 Days: today + 28 | `:252-266` |
   | Fixed term | cut in full (`lastDay = endDate` when `endDate > through`) | `:406-408` |
   | Open-ended | one extra period past `through` | `:417` |
   | Period shape | Calendar Month: calendar months, first and last partial; Monthly: anniversary months; 28 Days: 28-day windows | `:377-386` |
   | Term end | a hard cut inside a period | `:391-393` |
   | `dueOn` | Advance: `periodStart`; Arrears: `periodEnd` | `:399` |
   | Amount, Month rate on Calendar Month | rate × days ÷ days in the month | `:191-210`, `:286-292` |
   | Amount, Month rate on Monthly | rate × days ÷ days in the period | `:224-245`, `:293-299` |
   | Amount, other cases | whole units × rate, units rounded up, Month = 28 days | `:160-161`, `:300-306` |
   | Rounding | to the currency `decimalPlaces` | `:167-189` |
4. Header: `status 'Active'`, `activatedAt`, `updatedBy/At` (`SS:17894-17903`).

**No journal, no asset write, no tracked-entity write for a `Rental` line.**

`classificationInputs` for a Rental line is still the full record: `{ inputs: { ownershipTransfers,
purchaseOptionReasonablyCertain, termMonths, economicLifeMonths, pvPayments, fairValue,
specializedAsset }, thresholds: { majorPartPercent, substantiallyAllPercent }, tests: {a..e},
pvToFairValuePercent, termToLifePercent, pv: { pvRent, pvPayments, pvResidual, netInvestment }, payment,
periods, annualRate, timing }` (`lessor-lease.ts:376-393`, built `:415-494`). Open-ended (`termMonths`
null) is always Rental (`:161-163`). A seed authoring it literally should copy what the function
produces (classification UI reads it — sales AGENTS → Lease classification).

`Sale` commencement (`SS:17919-18224`), for the record: `'Lease'` journal via `postLeaseJournal`
(`SS:16104-16166`: `createAdjustmentJournal` sourceType `Lease`, Posted after cutover with the current
period; lines `documentType 'Rental Agreement'`, `documentId` agreement, `documentLineReference` line;
`journalLineDimension` rows for Customer/Item/Location), lines from `buildCommencementLines`
(Dr NI, Dr COGS C − PVres, Dr accumulated depreciation / Cr Lease Revenue PVpay, Cr asset at cost);
`fixedAsset` → Disposed / Sale / disposalDate today / saleProceeds NI (`SS:18062-18078`);
`fixedAssetDisposal` row (`SS:18080-18094`); tracked entity → Consumed, attributes minus `Fixed Asset`
plus `Rental Agreement` + `Customer`, `Lease Commencement` activity (`SS:18098-18126`);
`rentalLeaseScheduleLine` rows (`SS:18168-18182`); Planned `Interest` `revenueRecognitionSchedule` rows
(Dr NI / Cr lease interest income, `rentalLeaseScheduleLineId`) (`SS:18183-18222`). Requires the
commencement month ≥ activation month and whole billing periods (`lessor-lease.ts:498+`).

### 3.3 Deliver — rental shipment

Route `$id.$lineId.deliver.tsx` → `deliverRentalUnit` (`SV:5190-5212`) → `create`
`shipmentFromRentalAgreement` (`apps/erp/app/modules/shared/shared.service.ts:14874-15037`): Draft
`shipment` (`shipmentId` from `getNextSequence('shipment')`, `sourceDocument 'Rental Agreement'`,
`sourceDocumentId` agreement id, `sourceDocumentReadableId` RA number, `customerId`, `locationId` =
agreement's, `status 'Draft'`, `:14998-15012`) + one `shipmentFixedAssetLine` per Pending unit
(`shipmentId, rentalAgreementLineId, shipped true`, `:15013-15024`). Posting (`postRentalShipment`
`INV:18649-18780`): line → `On Rent`, `deliveredAt` = posting date, `meterOut` (`INV:18734-18751`);
`Rental Delivery` `trackedActivity` + `trackedActivityInput` qty 1, attributes `{Shipment, "Rental
Agreement"}` (`INV:18753-18766`, helper `SS:16168-16217`); shipment `status 'Posted'`, `postingDate`,
`postedBy` (`INV:18768-18777`). **No itemLedger, costLedger or journal** (none in that body).
Refuses a future date (`INV:18663-18664`), a non-Pending line, an out-of-service unit.

### 3.4 Return — rental receipt; Release

Receipt (`postRentalReceipt` `INV:13780-13950`): per ticked `receiptFixedAssetLine` runs
`returnRentalUnit` (`SS:16612-16844`); sets `fixedAsset.locationId` = receipt location
(`INV:13910-13921`); `Rental Return` activity (output) for a `Rental` line (`INV:13923-13936`); receipt
`Posted`, `postingDate` = return date, `postedBy` (`INV:13939-13948`).

`returnRentalUnit` for a `Rental` line: regenerates periods with `returnedAt`; deletes Pending
non-adjustment periods starting after the return (`SS:16725-16732`); re-cuts the Pending period the
return falls in (`SS:16735-16754`); inserts any missing period plus negative `isAdjustment` rows for
Invoiced Advance periods past the return (`SS:16757-16763`; adjustment = billed − charge for days
used, `dueOn = returnedAt`, `rental-periods.ts:455-471`); line → `Returned`, `returnedAt`, `meterIn`,
`returnNotes` (`SS:16764-16779`); optional out-of-service on the asset (`SS:16805-16817`).
Refuses a return before start / before delivery (`SS:16654-16664`), future dates (route level).

Release (`releaseUnit` `SS:18226-18322`): Pending line only, not `Sale`, no open rental document;
calls `returnRentalUnit` without a location — so periods re-cut and line Returned, asset location
unchanged, no receipt, no activity.

### 3.5 Close / Cancel

Close (`SS:18392-18466`): Active; no Draft/Pending rental shipment or receipt; every line Returned or
Sold, no Pending period, no unbilled charge (`closeBlocker` `SS:17402-17417`); header `Closed`,
`closedAt`. Cancel (`SS:18468-18546`): allowed for Draft always; Active only with nothing On Rent /
Sold / invoiced / recognized and no commenced Sale line (`cancelBlocker` `SS:17426-17457`); deletes
Pending periods and Pending/On Rent lines (`SS:18511-18531`), keeps Returned lines; header
`Cancelled` (no stamp column).

### 3.6 Invoice a billing period

Route `$id.invoice.tsx` → `generateRentalInvoicesNow` (`SS:12924-12950`) → `create-rental-invoices`
→ `draftAgreementInvoices` (per agreement, one transaction). First rolls live Rental lines forward to
`billingHorizon(asOf)` (`rollBillingPeriodsForward` `SS:15719-15821`). Then per due period
(`dueOn <= asOf`, Pending) and per unbilled charge (`chargeDate <= asOf`):

- Adjustments → ONE Draft credit `memo` per agreement (`insertRentalCreditMemo` `SS:15510-15589`:
  `memoId` from `creditMemo` sequence, `direction 'Credit'`, `status 'Draft'`, `memoDate asOf`,
  `amount` = Σ credits, `reference` RA number, `notes`, `rentalAgreementId`); periods → `Invoiced`,
  `memoId`.
- Others → Draft `salesInvoice` (`insertRentalInvoice` `SS:15591-15710`): an `opportunity`
  (`customerId`), header (`invoiceId` from `salesInvoice` sequence, `status 'Draft'`, customer/
  invoiceCustomer = agreement customer, `invoiceCustomerContactId` = primary contact,
  `invoiceCustomerLocationId` = site, `locationId`, `paymentTermId`, currency/rate, `dateIssued asOf`,
  subtotal/totalTax/totalAmount, `opportunityId`, `automationHoldReason`), a `salesInvoiceShipment`
  (`id` = invoice id, `customerLocationId` = site, `shippingCost 0`), lines
  (`invoiceLineType 'Rental'`, `rentalAgreementId`, `rentalAgreementLineId`, `rentalBillingPeriodId`
  or `rentalAgreementChargeId`, `rentalLineType`, `description` (`rentLineDescription` `SS:15827-15856`),
  `unitPrice`, `taxPercent` (agreement's for rent), `serviceStartDate/EndDate` = period, `quantity 1`,
  `methodType 'Pull from Inventory'`, `unitOfMeasureCode 'EA'`, `exchangeRate`, `locationId`,
  `sortOrder`); then stamps periods `Invoiced` + `salesInvoiceLineId`, charges `salesInvoiceLineId`
  (`SS:15679-15707`). Split into rent vs charges invoices by `planRentalInvoices` unless Draft Only.

Posting the invoice: `postSalesInvoice` takes the rental decisions from `planRentalLine`
(`INVC:8651-8800`).

| Invoice line | What posting writes | Cite |
|---|---|---|
| Rent, `Rental` line | Cr Contract Assets for the period's unbilled Accrual rows; the rest Cr Deferred Revenue | `INVC:8730-8779` |
| Rent, `Rental` line | Planned `Deferral` `revenueRecognitionSchedule` rows, straight-line over the part of the period no accrual covers; each row has `salesInvoiceLineId`, `rentalAgreementLineId`, debit deferred revenue, credit rental income | `INVC:8532-8543`, insert `INVC:10100-10115` |
| Rent, `Rental` line | `billedBySalesInvoiceLineId` on each Accrual row it bills | `INVC:10122-10152` |
| Charge | Cr Rental Income, no schedule rows | `INVC:8673-8689` |
| Rent or Purchase Option, `Sale` line | Cr Net Investment in Leases | `INVC:8690-8717` |
| Purchase Option, `Rental` line | refused | `INVC:8719-8723` |
| Purchase Option, `Sale` line | line `On Rent` → `Sold` | `INVC:10157-10175` |

Every revenue leg carries `documentType 'Rental Agreement'` (`INVC:8662-8665`). The rental account
defaults must be mapped (`INVC:7384-7400`).

### 3.7 Sell to Customer

`sellRentalUnit` (`$id.$lineId.sell.tsx:15`): Sale line On Rent, not before `endDate`; inserts a
`Purchase Option` charge (`insertRentalPurchaseOptionCharge` `SS:12902-12918`) and calls
`generateRentalInvoicesNow`; the line becomes `Sold` only when that invoice POSTS (§3.6). The only path
to line status `Sold` is a `Sale` line — so seeding `Sold` requires the full Sale chain (§3.2, 3.6).

### 3.8 Accruals (lease run) and deposits

- `synthesizeRentalAccruals` (lease run proposal, not activation): Accrual rows (Dr contract assets /
  Cr rental income) per slice of On Rent/Returned periods no posted invoice covers (accounting AGENTS
  line 29). Seeded On Rent units with unposted rent will show in the "Post lease journals" close task
  preview (`seed-data.ts:2509-2511`, `autoCheckKey 'unposted-lease-schedules'`). Seeding is optional;
  nothing at activation writes them.
- Deposit = customer `payment` with `rentalAgreementId`; `post-payment` books unapplied cash to
  `prepaymentAccount` with description "Customer Deposit" and it funds only that agreement's invoices
  (accounting AGENTS line 55; scope reader `packages/database/src/deposit-scope.ts:26-80`). See §0.5.

### Which write journals

| Action | Journal |
|---|---|
| Create / edit Draft, contacts | none |
| Activate, `Rental` line | none |
| Activate, `Sale` line | `'Lease'` commencement |
| Deliver (shipment post) | none |
| Return / release, `Rental` | none |
| Return, `Sale` (residual) | `'Lease'` |
| Close / cancel | none |
| Draft invoice / credit memo | none until posted |
| Post rental invoice / memo | `Sales Invoice` / `Credit Memo` journals |
| Lease run | `'Lease Run'` |
| Deposit payment post | `Payment` journal |

---

## 4. Triggers and checks a raw SQL insert hits

- **`rentalAgreement_primary_contact_on_insert`** BEFORE INSERT WHEN `customerContactId IS NOT NULL`
  and **`rentalAgreement_customer_change_clears_contacts`** BEFORE UPDATE OF customerId/
  customerContactId (`M/20261104063711…:69-82`): refuses a primary contact not in `customerContact`
  for `(customerId, companyId)` (`:56-64`); on update a customer change deletes all contact rows and
  nulls the primary unless the same update sets one; a new primary deletes its own list row (`:42-53`).
  No `app.sync_in_progress` check — it always fires.
- **`sync_advance_document_sequence`** after-interceptor on `rentalAgreement`
  (`packages/database/src/event-system/attachments.ts:385`; body latest
  `M/20261102032723_merge-main-handlers.sql:146+`): an inserted `rentalAgreementId` in the RA format
  moves the counter past it. No sync_in_progress check (dispatcher `M/20261002114954…`
  `dispatch_event_after_interceptors` runs every function unconditionally). Same on `shipment`,
  `receipt`, `salesInvoice`, `memo`, `payment`, `journal`, `fixedAsset`.
- **No event triggers** on `rentalAgreementLine`, `rentalBillingPeriod`, `rentalAgreementCharge`,
  `rentalAgreementContact`, `rentalLeaseScheduleLine` (none listed in `attachments.ts`).
  Queue/event dispatch skips SYNC/WEBHOOK/WORKFLOW handlers under sync_in_progress
  (`M/20261021013200_issue-sync-events.sql:44-45`).
- `salesInvoice`: `prevent_posted_sales_invoice_deletion` (attachments `:388-393`) — the wipe already
  voids/handles posted invoices.
- `payment`: `prevent_invalid_deposit_refund` (§0.5).
- CHECKs to respect: agreement dates, line quantity = 1, rate ≥ 0, period unique key, memo check,
  `salesInvoiceLine_rental_check`, service-date pair, `payment_deposit_document_check`, shipment/receipt
  `*_source_check` (exactly one of salesOrderLineId/purchaseOrderLineId and rentalAgreementLineId),
  receipt out-of-service check, fixed-asset quantity / out-of-service checks, live-line unique index,
  live-serial unique index on `fixedAsset`.
- Bypassed by raw SQL (app-only rules the seed must re-implement): Draft-only edits, contact list
  belongs to customer and never holds the primary, emailable primary under Post and Email
  (`SS:9607-9625`), rate > 0 and availability at activation, base currency, line status transitions.
- Wipe: generic over every `companyId` table except `PRESERVED_TABLES` (`DS/wipe.ts:13-60`,
  discovery `:133-162`); rental tables are not preserved, so they are wiped. Not verified that the
  delete order copes with `rentalBillingPeriod_memo_fkey ON DELETE RESTRICT` and
  `revenueRecognitionSchedule_memo_fkey` (no ON DELETE).

---

## 5. Settings and accounts

Already provided for a new company by `packages/database/src/seed-data.ts`:
- Accounts 1145 Contract Assets, 1160 NI in Leases (`:919-921`), 1370 Rental Fleet (`:1079-1081`),
  1380, 2160 Deferred Revenue, 4060 Rental Income (`:1642-1644`), 4070 Lease Revenue (`:1656`), 4150
  Interest Income – Leases (`:1742`).
- `accountDefault`: `deferredRevenueAccount 2160`, `contractAssetAccount 1145`, `rentalIncomeAccount
  4060`, `leaseRevenueAccount 4070`, `leaseInterestIncomeAccount 4150`, `netInvestmentInLeasesAccount
  1160` (`:2352-2357`), `prepaymentAccount 2110` (`:2335`).
- Fixed asset class "Rental Fleet" (`:2410-2425`) — `fixedAssetClass` is preserved by the wipe
  (`DS/wipe.ts:30`); tier 09's comment "bootstrap seeds the three classes" (`DS/tiers/09-accounting.ts:393`)
  is stale against the five in `seed-data.ts`.
- Sequences `rentalAgreement` RA, `lease` LSE, `leaseRun` LR (`:600-626`).
- Close tasks incl. "Post lease journals" (`:2509-2511`).
- `companySettings` lease thresholds / discount rate / `invoiceAutomation` come from column defaults
  (§1.9); I found no override in `seed-data.ts` (grep `lease` hits none for these columns).

Mapping lives in `accountDefault` (preserved table), so datasets inherit it.

---

## 6. Doc pointers — what matters for seeding

- `apps/erp/app/modules/sales/AGENTS.md` → Rentals: the table/column reference above; "Never write
  `rentalBillingPeriod` / line status transitions from app code" (a seed must mirror the postings'
  shapes instead); Draft lines reserve units; periods run from the agreement start, not delivery;
  `Sale` lines derecognize at activation; setup wizard redirects Draft agreements for `update: sales`
  users into `setup/units` (`draftRentalAgreementSetupPath`).
- `apps/erp/app/modules/accounting/AGENTS.md`: revenue recognition (line 27), run types (28 — rental
  rows belong to the Lease run), rental accruals (29), sales-type leases + lease policy (33), rental
  utilization report reads `deliveredAt`/`returnedAt` and posted schedule rows (38), customer deposits
  (55).
- `.claude/rules/fixed-asset-lifecycle.md`: fleet bridge columns, `fleetAssets` precedence, Rental
  Fleet class, capitalize writes (serial Consumed + `Fixed Asset` attribute), `Rental` lines never touch
  `fixedAsset.status`, receipt moves `locationId`, Return to Inventory refused on a live line.
- `packages/database/src/datasets/AGENTS.md`: one transaction with `app.sync_in_progress`; no JS
  `Date` (DayOffset vs `ctx.anchor`); "Posted states carry their downstream rows"; never literal PKs;
  tier order is the contract (fixed assets are tier 09, so rentals go in or after tier 09); update
  `coverage.ts` and `validate.ts` coverage sets with new rows/statuses.
- `.claude/rules/onboarding-company-templates.md:362-375`: datasets set an accounting cutover, so every
  seeded journal must be Posted (not Provisional).
- Specs: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md`,
  `2026-10-07-rental-shipments-and-receipts.md`, `2026-11-04-rental-agreement-contacts.md`.

---

## 7. Suggested state matrix (inferred from §3, not a decision)

| Seed state | Rows |
|---|---|
| Draft | header (no `activatedAt`), primary contact + contact rows, Pending lines with rate, no classification, no periods |
| Active, units Pending (not delivered) | + classification + `classificationInputs` on lines, periods to horizon, `activatedAt` |
| Active, On Rent | + Posted rental shipment + `shipmentFixedAssetLine` + `Rental Delivery` activity; line `deliveredAt`/`meterOut` |
| Active, partially billed | + Posted rental invoice(s) with Rental lines, periods `Invoiced` + `salesInvoiceLineId`, Deferral rows, sales invoice journal (new seed builder) |
| Active, a unit Returned / released | + Posted rental receipt (or none for release), re-cut periods, line `returnedAt`, `Rental Return` activity, asset `locationId` |
| Closed | every line Returned, every period Invoiced, no unbilled charge, no open rental doc, `closedAt` |
| Cancelled | header only (Pending lines and periods deleted); Returned lines may remain |
| Sold line | only via a `Sale` line + posted Purchase Option invoice — recommend out of scope |
