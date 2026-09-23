# Revenue Recognition Core + Rental Fleet (Sell vs. Rent Manufactured Units)

> Status: in-progress (open questions resolved 2026-09-22; N1–N6 accepted by Brad, N7–N16 recommended and not vetoed — see Open Questions; plan: `.ai/plans/2026-09-22-revenue-recognition-and-rentals.md`)
> Author: Claude (with Brad Barbin)
> Date: 2026-09-22
> Tracking issues: crbnos/carbon#1048 (revenue recognition — this spec is its Phase 1), crbnos/carbon#1056 (leases — this spec supersedes the lessor slice), crbnos/carbon#1041 (fixed assets — this spec defines the inventory→asset bridge the make/CIP work reuses), crbnos/carbon#1060 (program tracker)
> Research: `.ai/research/2026-09-21-sell-vs-rent-rental-revenue-recognition.md`
> Related specs: `.ai/specs/2026-07-04-revenue-recognition.md` (full ASC 606 model; its SSP allocation, arrangements and POC become Phases 2–3 on the substrate built here), `.ai/specs/2026-07-04-lease-accounting.md` (lessee accounting, modifications, IFRS 16 delta stay there), `.ai/specs/archived/2026-07-04-fixed-assets-completeness.md` (components / impairment / reclassification; its CIP scope is carried here), `.ai/specs/2026-07-04-close-automation.md` (propose-only posture this spec follows), `.ai/specs/2026-08-07-rma-module.md` (tracked-entity reactivation precedent)

## TLDR

A manufacturer that rents out a unit it built is a **lessor**. Under ASC 842 / IFRS 16 the rental is an **operating lease** unless it transfers control (bargain purchase option, term covering most of the economic life, PV ≥ substantially all of fair value…), in which case it is a **sales-type lease** — a financed sale. Carbon today can only sell: revenue posts in full at invoice, a built unit can never leave inventory except by shipment, and there is no rental document, no recurring invoicing, no deferred-revenue writer and no "at customer" state for a serial. This spec builds four things on one substrate, in the order the plan will sequence them:

1. **Revenue recognition core (Phase 1 of #1048 — "capture the amount")** — `accountDefault.deferredRevenueAccount` → seeded 2160 finally gets a writer; a per-line `revenueRecognitionSchedule` (deferral, accrual and lease-interest rows, each carrying its own debit/credit accounts); a `revenueRecognitionRun` Draft → Posted batch (depreciation-run pattern) posted as an *accounting* source under the period matrix; a monthly Inngest proposal; a seeded "Recognize revenue for the period" close task with a fail-closed evaluator; the straight-line-by-date-range method for any invoice line carrying service dates, gated by `companySettings.revenueRecognitionEnabled` so posting stays byte-identical when off. Arrangements, SSP allocation and cost-to-cost POC (the rest of #1048) attach to this schedule/run substrate later.
2. **Fleet capitalization bridge + Make to Asset** — `fixedAsset` gains `itemId`, `trackedEntityId`, `quantity`, `workCenterId` and an out-of-service flag; a `fixedAssetTransfer` document with a `sourceType` (Inventory / Job / Construction in Progress) and two postings: **Capitalize** (from stock: Dr asset / Cr Finished Goods at the unit's carrying cost, the serial consumed *into* the asset; from a job: Dr asset / Cr WIP at completion, the unit never touching inventory; from a CIP asset: Dr depreciating class / Cr CIP at the in-service date) and **Return to inventory at net book value** (the Tesla pattern) so a returned unit is sold gross through the normal sales flow. A job can target a fixed-asset class (one asset per serialized unit, created at completion) or an `Under Construction` asset (SAP AuC: the job's cost is swept to it at attachment and at completion) — the make/self-constructed scope of #1041, including "build it, then use it yourself" through the work-center link. The existing Fixed Asset sales-order line stays as the net gain/loss disposal path.
3. **Rental agreements (operating)** — a time-based `rentalAgreement` document in the sales module (customer, fleet units one serial per line, start / open-ended or end date, a day / week / month rate ladder with best-rate selection, **Calendar Month** or **28 Days** billing cycles, advance or arrears, refundable deposit, variable charges), lifecycle Draft → Active → Closed / Cancelled with line custody Pending → On Rent → Returned → Sold; fleet units can be taken **out of service** for maintenance, which removes them from availability without touching depreciation; a daily Inngest job proposes Draft sales invoices per due billing period using a new **`Rental`** invoice line type whose posting credits **Deferred Revenue** (never revenue directly); the recognition run releases it straight-line and accrues unbilled rent for arrears billing to **Contract Assets** so period revenue is right regardless of when the invoice is posted; deposits post to **Customer Prepayments** 2110 through a new deposit branch of `post-payment`.
4. **Sales-type leases (v1 per Brad)** — per-line ASC 842-10-25-2 classification with company thresholds and audited override; at activation the unit is derecognized (from inventory at carrying cost, or from the fleet at NBV), **Net Investment in Leases** is recognized at the PV of payments + residuals, revenue = PV of lease payments and cost of sales = carrying amount − PV of unguaranteed residual (selling profit at commencement), then an effective-interest schedule whose monthly interest income posts in the recognition run while each rental invoice reduces the net investment; purchase-option exercise and end-of-term residual return close the schedule.

Every posting is period-gated and immutable through the existing journal path; every new source type gets a `POSTING_POLICY` entry; no existing posting surface changes unless a Rental line or the rev-rec flag is present.

## Problem Statement

Verified in code on 2026-09-21 (details and line references in the research file's *Carbon Baseline*):

1. **Revenue is all point-in-time at invoice.** `post-sales-invoice` credits `accountDefault.salesAccount` with the full line total; account 2160 Deferred Revenue is seeded but mapped to nothing and written by nothing; `prepaymentAccount` 2110 is mapped but no posting path writes it. A 12-month service billed up front, or a month of rent billed in advance, books as revenue on day one.
2. **A built unit cannot become an asset.** `complete_job_to_inventory` receives serialized units into Finished Goods (Dr FG / Cr WIP at actual job cost) and there is **no path from inventory or a job to a `fixedAsset`** — the asset row has no item, serial or tracked-entity link. Registering a built vehicle manually leaves it in inventory and adds it against retained earnings a second time; the inventory tie-out and the fleet register can never agree.
3. **Nothing rental-shaped exists.** No line type, no time-based unit of measure or per-period price, no recurring or scheduled invoicing, no deposit on a document (`payment` has no document FK; `invoiceSettlement` can only target an invoice or memo), no "on rent / at customer" state (`trackedEntityStatus` is `Available | Reserved | On Hold | Consumed | Rejected | Scrapped`; shipped serials simply become Consumed), no lease classification, no net-investment schedule.
4. **The governing specs are unimplemented and mis-shaped for this use case.** #1048 models rentals-as-606 arrangements (wrong standard for a lessor); #1056 has the right lessor slice but is wrapped in lessee PV/IBR machinery and a multi-book dependency; #1041's narrowed "make" scope (job→CIP) has no written spec on the issue yet, and inventory→fleet was never part of it.

The customer-facing consequence: a vehicle maker that rents part of its output cannot show rented vehicles on the balance sheet, cannot bill them monthly without hand-typed invoices, and cannot recognize the revenue in the right month.

## Proposed Solution

### 0. Phasing (one spec, four build phases; the plan sequences them)

| Phase | Delivers | Depends on |
|---|---|---|
| **A. Recognition core** | account defaults + seeds, `revenueRecognitionSchedule`, `revenueRecognitionRun/Line`, straight-line deferral on invoice lines with service dates (flag-gated), run posting, close task, monthly proposal, deferred-revenue waterfall | — |
| **B. Fleet bridge + Make to Asset** | `fixedAsset` item/serial/quantity/work-center/out-of-service columns, seeded *Rental Fleet* and *Construction in Progress* classes, `fixedAssetTransfer` + `post-asset-transfer` (capitalize from stock / attach job / capitalize CIP / return to inventory), the job→asset branch of `complete_job_to_inventory`, `fixedAssetCipCost`, fleet register view, tracked-entity attributes, work-center capital-cost panel | — (parallel with A) |
| **C. Rental agreements (operating)** | agreement tables + UI, item rate ladder, activation / delivery / return, Calendar Month + 28 Days billing periods with best-rate selection, daily invoice proposal, `Rental` invoice line posting (deferral + accrual + early-return credits), deposits, utilization report | A, B |
| **D. Sales-type leases** | classification + thresholds, PV / effective-interest utilities, commencement posting, interest in the run, purchase option, end-of-term residual, net-investment report | C |

Out of this spec (tracked elsewhere): SSP allocation, arrangements, contract modifications and POC (#1048 Phases 2–3); lessee accounting, remeasurements, disclosures package, IFRS 16 delta (#1056); components, impairment, class reclassification and CIP aging (#1041 follow-ons); bulk / non-serialized fleet units, anniversary billing cycles, payment escalations (straight-line rent receivable), maintenance-module integration for fleet units (dispatches, meter-based service intervals), MRP demand for fleet builds, FX remeasurement of the net investment, automatic machine-rate derivation from asset depreciation.

### 1. Revenue recognition core (Phase A)

**Accounts** — resolved by id through `accountDefault` (never by number at posting time — `.ai/lessons.md`):

| `accountDefault` column | Seeded account | Note |
|---|---|---|
| `deferredRevenueAccount` | **2160 Deferred Revenue** (exists, unmapped) | contract liability |
| `contractAssetAccount` | **1145 Contract Assets** (new, under *Receivables*) | unbilled receivable / accrued rent |
| `rentalIncomeAccount` | **4060 Rental Income** (new, under *Revenue*) | operating-lease income + variable charges |
| `leaseRevenueAccount` | **4070 Lease Revenue** (new, under *Revenue*) | sales-type commencement revenue |
| `leaseInterestIncomeAccount` | **4150 Interest Income – Leases** (new, under *Other Income*) | effective-interest income |
| `netInvestmentInLeasesAccount` | **1160 Net Investment in Leases** (new, under *Receivables*) | lease receivable + PV of residual |

Deposits use the existing `prepaymentAccount` → 2110 Customer Prepayments. New accounts are inserted per company group with the parent resolved by `"isGroup" = TRUE AND name` (lesson `20260630093809` precedent), mirrored in `seed.data.ts` + `seed-company`, and backfilled into `accountDefault` by id in a reconciling migration.

**Schedule rows.** `revenueRecognitionSchedule` is the single "what to post, when" table. Each row carries its own `debitAccountId` / `creditAccountId` captured at creation, so the run is a pure poster and later methods (SSP-allocated elements, POC deltas) only add rows:

| `type` | Created by | Posts |
|---|---|---|
| `Deferral` | invoice posting of a deferrable line | Dr deferred revenue / Cr the line's revenue account |
| `Accrual` | the run, for earned-but-unbilled rent | Dr contract asset / Cr rental income (billed later by an invoice that credits the contract asset) |
| `Interest` | sales-type activation (one per schedule period) | Dr net investment / Cr lease interest income |

**Straight-line by date range (the Phase A method).** `salesInvoiceLine` (and `salesOrderLine`, copied on conversion) gain `serviceStartDate` / `serviceEndDate`. When `companySettings.revenueRecognitionEnabled` is on and a posted line has service dates, `post-sales-invoice` credits `deferredRevenueAccount` instead of the revenue account for the **net-of-tax** line amount and writes one `Deferral` row per accounting period the range overlaps, amounts prorated by days (last row absorbs rounding so Σ rows = line amount exactly, `distributeRoundingResidual`). Rows are dated the period end. Lines without service dates, and every line when the flag is off, post exactly as today (AC #1). `Rental` lines always go through the schedule regardless of the flag (they are new; activating the first rental agreement requires the flag on). VOID reverses the journal and deletes the line's unposted rows; a posted row blocks the void with the standard reversal-only message.

**Run.** `revenueRecognitionRun` (`runId` readable, `periodEnd`, `status Draft | Posted`, `postedAt/By`) + `revenueRecognitionRunLine` (one per schedule row it will post, `amount`, `journalId`). Creating a run for a period selects every `Planned` row with `scheduledDate ≤ periodEnd` **and** synthesizes the period's `Accrual` rows (operating rental days not covered by a billed `Deferral` row) and due `Interest` rows. Posting (`postRevenueRecognitionRun`, Kysely transaction in `accounting.server.ts`, `getOrCreateAccountingPeriod(…, source: "accounting")` so Locked periods accept it and Closed reject) writes **one journal per run** (`sourceType 'Revenue Recognition'`, `postingDate = periodEnd`), lines grouped per schedule row with `documentType 'Invoice' / documentId = salesInvoiceId` for deferrals and `'Rental Agreement'` for accruals and interest, dimensions copied from the source invoice line (Customer / Item / Location), stamps `journalId` on lines and flips rows to `Posted`. Running twice for one period creates nothing the second time (rows are claimed by `runLineId`). Deleting a Draft run releases its rows. A "Repeat" action (depreciation-run parity) opens the next period.

**Proposal.** Inngest `revenue-recognition-proposal`, cron `0 6 1 * *`, per company (`scheduled/mrp.ts` fan-out pattern, one `step.run` per company): if the prior month has due rows and no run, create the Draft run. Propose-only, like every close-automation job.

**Close task.** Seed `periodCloseTaskDefinition` "Recognize revenue for the period" — `taskType 'Auto'`, `autoCheckKey 'unposted-revenue-schedules'`, `severity 'Warning'`, `isSystem`, `sortOrder` directly after "Post depreciation runs covering the period" — per company (reconciling migration) and in `seed-company`. The evaluator joins `computePeriodReadiness` (a key without an evaluator fails every close, so both land in one PR): fails when any `Planned` row is dated on/before the period end, any active operating rental line has un-accrued days in the period, or any `Interest` row for the period is unposted; a company with the flag off and no agreements passes trivially.

**Sync.** `POSTING_POLICY` (`@carbon/ee`) gains `'Revenue Recognition'`: `representation: "journal"`, syncable, `defaultEnabled: true`. The rental *invoices* are documents and follow the AR document sync; their Rental lines have no item, so the provider mapper must send them as **account-costed lines to the deferred-revenue account** (Xero: any account code; QBO/Rillet: verified at plan stage — see Risks).

### 2. Fleet bridge (Phase B)

**Columns.** `fixedAsset` gains `itemId` (FK `item`), `trackedEntityId` (FK `trackedEntity`, unique per company while the asset is not Disposed), `quantity NUMERIC NOT NULL DEFAULT 1` (forward hook for bulk pools — v1 CHECK `quantity = 1`), `workCenterId` (see *Work-center link*) and `outOfServiceSince` / `outOfServiceReason` (see *Out of service*); `fixedAssetStatus` gains `'Under Construction'`. `serialNumber` is filled from `trackedEntity.readableId` on capitalization.

**Class.** Seed one **Rental Fleet** `fixedAssetClass` per company: Straight Line, 60 months, 20 % residual, `assetAccount` **1370 Rental Fleet** (new, *PP&E*), `accumulatedDepreciationAccount` **1380 Accumulated Depreciation – Rental Fleet** (new), depreciation expense 6310, write-off / write-down / loss 6320, gain 4140 — its own balance-sheet line ("Operating lease vehicles, net"), editable like any class. Depreciation runs treat fleet assets like any other Active asset: they depreciate **whether or not on rent**. Seed also one **Construction in Progress** class (`isConstructionInProgress = true`, `assetAccount` **1390 Construction in Progress** — new, *PP&E*; its other account FKs point at the ordinary 1330 / 6310 / 6320 / 4140 and never post while a unit is `Under Construction`).

**Document.** `fixedAssetTransfer` (readable `transferId`, sequence `FAT`) — `type 'Capitalization' | 'Return to Inventory'` (a later `'Reclassification'` type joins the same table), `sourceType 'Inventory' | 'Job' | 'Construction in Progress'`, `fixedAssetId`, `itemId`, `trackedEntityId`, `jobId`, `fromClassId`, `locationId`, `storageUnitId`, `quantity` (1), `transferDate`, `inServiceDate`, `amount`, `accumulatedDepreciation`, `journalId`, `status Draft | Posted`, `postedAt/By`. Every v1 action creates and posts in one step; the status column keeps the document shape open for a reviewed Draft later.

**Capitalize from inventory** (`post-asset-transfer`, type `capitalize`; permission `create: accounting`; unit must be `Available` with on-hand 1 at the chosen location):
- Cost **C** = the unit's carrying cost from its open `costLedger` layer(s) (FIFO/LIFO layer, Average `itemCost.unitCost`, Standard `standardCost`) — the same resolution `get_inventory_valuation` and the shipment COGS path use, consumed through the shared `calculateCOGS`-style layer consumer.
- Journal `sourceType 'Asset Transfer'`, `documentType 'Asset Transfer'`, `documentId = transferId`: **Dr class `assetAccountId` C / Cr `resolveInventoryAccount(replenishmentSystem)` C** (Finished Goods for made items). Dimensions: Location, FixedAssetClass, Item.
- Ledger: `itemLedger` −1 (`entryType 'Negative Adjmt.'`, `documentType 'Asset Transfer'`, `trackedEntityId`), `costLedger` consumption row against the layer; `trackedEntity.status → 'Consumed'` with `attributes["Fixed Asset"] = fixedAssetId` plus a `'Capitalize'` `trackedActivity` (input = the entity) so the traceability graph shows the asset as the consumer.
- Asset: creates (or fills a Draft) `fixedAsset` — `itemId`, `trackedEntityId`, `serialNumber`, `acquisitionCost = C`, `acquisitionDate = depreciationStartDate = transferDate`, `locationId`, `status 'Active'`. The Draft→Active flip uses the same `.where("status","=","Draft")` race guard as registration.
- With `accountingEnabled = false`: ledger + asset changes only, no journal (registration parity).

**Return to inventory at NBV** (type `return`; asset `Active | Fully Depreciated`, not on an active rental line): **N** = `acquisitionCost − accumulatedDepreciation`. Journal: **Dr inventory account N / Dr class accumulated depreciation (accumDep) / Cr class asset account (cost)**; `itemLedger` +1 (`'Positive Adjmt.'`, `'Asset Transfer'`), `costLedger` layer at N; the same `trackedEntity` is reactivated to **`Available`** (the return inspection already happened on the agreement — RMA reactivates to On Hold because no inspection has) with the Fixed Asset attribute cleared and a `'Return to Inventory'` activity; asset → `'Disposed'` with new `disposalMethod 'Transfer to Inventory'` and a `fixedAssetDisposal` row (`netBookValueAtDisposal N`, `saleProceeds 0`, `gainLoss 0`, `journalId`). The unit is then sold like any other stock (gross revenue + COGS at N).

**Make to Asset (job → asset).** A job can target an asset instead of inventory: `job.fixedAssetClassId` (create the asset(s) at completion) or `job.fixedAssetId` (an existing `Under Construction` asset — the CIP case below); at most one, and never on a job linked to a sales order line. The branch lives **inside `complete_job_to_inventory`**, the single completion choke point (the interceptor cascade auto-completes jobs without the ERP route — `.ai/lessons.md`). For a job with `fixedAssetClassId`: the production-event absorption catch-up runs as today; then, instead of the inventory receipt, the function posts **Dr class `assetAccountId` / Cr `workInProgressAccount`** for the accumulated WIP cost of the units received (`sourceType 'Asset Transfer'`, both lines `documentType 'Asset Transfer'` with `documentId = jobId` so the per-job WIP balance still nets to zero, `documentLineReference = transferId`), creates one `fixedAsset` per received serialized unit (`fixedAssetId` from `get_next_sequence('fixedAsset', …)`, `itemId`, `trackedEntityId`, `serialNumber`, `acquisitionCost` = cost ÷ units, `acquisitionDate = depreciationStartDate` = completion date, `locationId` = the job's, `status 'Active'`) plus one `fixedAssetTransfer` row each (`type 'Capitalization'`, `sourceType 'Job'`, `jobId`, `journalId`), sets each entity `Consumed` with `attributes["Fixed Asset"]` and a `'Capitalize'` activity, and writes **no** `itemLedger`, `costLedger`, `itemCost` or `pickMethod` change — the unit never touches stock, which is the whole point (the "main correctness benefit" named on #1041). Partial completions create assets for the units received so far at the WIP cost accumulated so far, exactly as the inventory path prices them. v1 requires a **serialized item or a quantity of one** (a batch or untracked job of more than one unit is rejected at release with that message); bulk pools are the later phase that relaxes it. Entry points: the job form's **Complete to** target, and the fleet register's **Build for fleet** action, which opens a new job with the Rental Fleet class pre-filled.

**Construction in progress (the #1041 make scope).** For long builds the asset exists before the build finishes and accumulates cost from several sources. `fixedAssetClass.isConstructionInProgress` marks a CIP class (seeded once per company, see *Class*); an asset in a CIP class carries status **`Under Construction`** from its first cost until capitalization and is excluded from depreciation runs (they select `Active` only). Cost arrives three ways, each appending an append-only `fixedAssetCipCost` row (`sourceType 'Purchase Invoice' | 'Receipt' | 'Job' | 'Manual'`, document links, `jobId`, `amount`, `costDate`, `journalId`): (1) **Fixed Asset PO lines** — the existing `post-receipt` / `post-purchase-invoice` acquisition path, unchanged except that a CIP-class asset flips to `Under Construction` instead of `Active`; (2) **an attached job** — `post-asset-transfer` type `attachJob` sets `job.fixedAssetId` and posts a catch-up sweep of the job's current WIP balance (**Dr CIP `assetAccountId` / Cr WIP**, `'Asset Transfer'`, `documentId = jobId`), so cost leaves WIP at attachment (SAP AuC, Brad 2026-07-04); attaching is allowed while the job is Draft / Ready / In Progress / Paused, and the job's ordinary completion then routes through the same `complete_job_to_inventory` branch to sweep the remainder to the CIP asset with no inventory receipt — "complete to CIP" is simply Complete; (3) **manual** cost (a Draft journal the user posts, recorded against the asset). A CIP asset with zero PO lines and only job cost is valid; a job targets inventory *or* one asset, never both. **Capitalization** is `post-asset-transfer` type `capitalizeCip`: target class + `inServiceDate`; posts **Dr target class `assetAccountId` / Cr CIP `assetAccountId`** for Σ `fixedAssetCipCost`, sets `acquisitionCost`, `acquisitionDate`, `depreciationStartDate = inServiceDate`, `fixedAssetClassId` = target, `status 'Active'`, and records the transfer (`sourceType 'Construction in Progress'`, `fromClassId`). Registering an asset directly in a CIP class (an opening balance for a build already under way) posts as today and lands `Under Construction`. CIP aging, class reclassification, components and impairment stay in #1041's follow-ons.

**Work-center link.** `fixedAsset.workCenterId` (nullable FK, many assets → one cell, `ON DELETE SET NULL`) records which work center a self-built machine serves, mirroring `fixedAsset.locationId`. The work-center detail page gains a read-only **capital cost** panel (its assets, NBV, monthly book depreciation from the class method) and the asset form a work-center picker. Machine rates stay hand-typed in v1; the panel is what makes deriving them possible later. The docs callout that Carbon keeps no link between the two records becomes stale and is updated in the plan.

**Out of service.** `fixedAsset.outOfServiceSince` / `outOfServiceReason` (both set or both null). *Take out of service* (`update: accounting`, from the fleet register or the asset page; also a checkbox on the rental return form) removes a unit from availability without touching its accounting: depreciation continues, agreements cannot activate or deliver on it (the error names the reason), and the fleet status reads `In Maintenance`. *Return to service* clears both columns. A unit that is `On Rent` cannot be taken out of service — it is at the customer; work done there is a variable charge. Maintenance-module integration (dispatches, meter-based intervals from `meterIn`) is a later phase.

**Fleet register.** View `fleetAssets`: `fixedAsset` where `itemId IS NOT NULL` joined to item, tracked entity, work center and the active `rentalAgreementLine`, exposing `fleetStatus` in precedence order — `Sold` (Disposed by sale), `Returned to Stock` (Disposed by transfer), `Under Construction`, `On Rent`, `In Maintenance` (`outOfServiceSince` set), `Reserved` (Active agreement, line Pending), `Available` (Active / Fully Depreciated, none of the above) — plus `customerId` / `customerLocationId` of the active line, `outOfServiceReason` and NBV. Derived, never stored.

### 3. Rental agreements — operating (Phase C)

**Placement.** Sales module (`sales.models.ts` / `sales.service.ts` / `sales.server.ts`, UI `sales/ui/Rentals/`, routes `x+/rental-agreement+/` and `x+/sales+/rental-agreements*`). The agreement is the customer-facing contract; postings live in edge functions and `accounting.server.ts`.

**Header** `rentalAgreement` (`rentalAgreementId` readable, sequence `RA`): `customerId`, `customerLocationId` (where the units live while on rent), `customerContactId`, `salesPersonId`, `locationId` (home warehouse), `status` (`Draft | Active | Closed | Cancelled`), `startDate`, `endDate` (NULL = open-ended / month-to-month; **required** when any line classifies Sales-Type; a unit still on rent past it is a **holdover** and keeps billing at the same rates until returned), `billingCycle` (`Calendar Month` — the month tier prorated by calendar days; `28 Days` — fixed 28-day periods from the line's start priced off the day / week / month ladder, thirteen per year), `billingTiming` (`Advance | Arrears`), `paymentTermId`, `currencyCode`, `exchangeRate`, `depositAmount` (refundable), `discountRate` (annual %, for classification PV and sales-type schedules; defaults from `companySettings.leaseDefaultDiscountRate`), `ownershipTransfers`, `specializedAsset`, `purchaseOptionAmount`, `purchaseOptionReasonablyCertain`, `notes`, audit, `customFields`.

**Lines** `rentalAgreementLine` — one **serialized fleet unit** per line (`quantity` fixed at 1 in v1): `fixedAssetId` (operating: required, Available), `itemId`, `trackedEntityId` (sales-type from stock: the serial to derecognize), `rateMode` (`Best Rate | Fixed`), `rateUnit` (`Day | Week | Month`, the tier a Fixed line bills), `dayRate` / `weekRate` / `monthRate` (snapshotted from `itemRentalRate` at activation so a later price-list change never touches a live agreement; a Calendar Month agreement needs `monthRate`, a 28 Days agreement needs at least one tier), `fairValue` (default `itemUnitSalePrice.unitSalePrice`), `economicLifeMonths` (default class `usefulLifeMonths`), `guaranteedResidualValue`, `unguaranteedResidualValue`, `lessorClassification` (`Operating | Sales-Type | Direct Financing`, computed at activation, stored with `classificationOverride` + `classificationOverrideReason`, audit-logged), `status` (`Pending | On Rent | Returned | Sold`), `deliveredAt`, `returnedAt`, `meterOut`, `meterIn`, `returnNotes`, `initialNetInvestment`, `sellingProfit`.

**Charges** `rentalAgreementCharge` (variable payments: mileage overage, damage, delivery, cleaning): `rentalAgreementLineId`, `chargeDate`, `description`, `amount`, `taxPercent`, `salesInvoiceLineId` (set when billed). Recognized when billed — never deferred.

**Billing periods** `rentalBillingPeriod` (per line): `periodStart`, `periodEnd`, `days`, `rateUnitApplied`, `amount`, `isAdjustment`, `dueOn` (= `periodStart` for Advance, `periodEnd` for Arrears), `status Pending | Invoiced`, `salesInvoiceLineId`. Periods are cut by the agreement's cycle — **Calendar Month**: calendar months, `amount = monthRate × days ÷ days in the month` (a full month = the rate); **28 Days**: consecutive 28-day periods from the line's `deliveredAt` (or the agreement start), the last one cut at `returnedAt` or `endDate`. A 28 Days period is priced by the line's `rateMode`: **Fixed** bills `rateUnit` × the units the period covers (`ceil(days ÷ unitDays)`); **Best Rate** bills the cheapest of `days × dayRate`, `ceil(days ÷ 7) × weekRate` and `ceil(days ÷ 28) × monthRate` over the tiers the line has, ties going to the larger unit (`bestRateCharge` in `sales.utils.ts`, unit-tested). Best rate is evaluated per period, never cumulatively, so a period's charge is always known when it is cut and never negative. Periods are generated on activation for the fixed term (or rolling one period ahead when open-ended), extended while a unit is on rent past `endDate` (holdover, same rates), and re-cut on return: an unbilled final period shrinks to `returnedAt`; a period already billed **in advance** gets a negative `isAdjustment` row for the difference between what was billed and the best-rate charge for the days actually used (a month tier already earned by a long stay yields no credit — the Texada rule). Persisting periods is what makes invoice generation idempotent and the waterfall exact.

**Lifecycle.**
- *Activate* (`post-rental-agreement`, type `activate`): validates each line (unit Available and in service; not on another active line — the error names the other agreement or the out-of-service reason), snapshots the item's rate ladder onto the line, locks classification (§4), generates billing periods, sets lines `Pending` (or `On Rent` when `deliveredAt` is given), header `Active`. Operating lines post **no journal**; the asset simply stops being Available.
- *Deliver*: sets `deliveredAt`, line `On Rent`. Custody is the agreement's `customerLocationId`; `fixedAsset.locationId` stays the home warehouse. Blocked while the unit is out of service.
- *Return* (type `return`): `returnedAt`, `meterIn`, notes; re-cuts the final billing period (adding the advance-billing adjustment row when due); line `Returned`; the asset is `Available` again for re-rent or *Return to inventory*, or goes straight to `In Maintenance` when the return form's out-of-service box is ticked. Charges entered at return ride the final invoice.
- *Close*: allowed when every line is Returned or Sold and every period is Invoiced; *Cancel*: Draft or Active with no On Rent line and no invoiced period.

**Invoice proposal.** Inngest `rental-billing`, cron `0 5 * * *`, per company: for periods with `dueOn ≤ company_today()` and `status Pending`, plus unbilled charges, create **one Draft `salesInvoice` per agreement** (customer, bill-to, payment term, currency from the agreement) with a `Rental` line per period (`rentalInvoiceLineKind 'Rent'`, `serviceStartDate/EndDate` = the period, `quantity 1`, `unitPrice = amount` — negative for an adjustment row — a description naming the days and tier such as "10 days · 2 × week rate", `taxPercent` from the customer's default) and per charge (`'Charge'`), stamping `rentalBillingPeriod.salesInvoiceLineId` / `rentalAgreementCharge.salesInvoiceLineId` so a re-run never bills twice. Propose-only: a human posts (or edits) the invoice. "Generate invoices now" on the agreement calls the same service. Deleting a Draft invoice un-stamps its periods.

**Posting a `Rental` line** (`post-sales-invoice`, new `case "Rental"`; AR, tax and shipping legs unchanged via `buildSalesPostingLines`, revenue leg swapped by kind and classification):

| Line | Revenue leg | Schedule |
|---|---|---|
| Operating, `Rent` | Cr **deferred revenue** (net) — but first Cr **contract asset** for any posted `Accrual` row of the same line/period not yet billed (stamps `billedBySalesInvoiceLineId`) | `Deferral` row(s) per overlapped period for the deferred part |
| Operating, `Rent` adjustment (negative; early return on advance billing) | Dr **deferred revenue** / Cr AR for the credit, and the period's `Planned` deferral row shrinks by the same amount (a row already `Posted` ⇒ Dr **rental income** instead) | none |
| Operating, `Charge` | Cr **rental income** | none |
| Sales-Type, `Rent` | Cr **net investment in leases** (payment) | none (interest rows already exist) |
| Sales-Type, `Purchase Option` | Cr **net investment in leases** | none |
| Sales-Type, `Charge` | Cr **rental income** (variable lease payment) | none |

The `Rental` line type is added to `salesInvoiceLineType` only (rentals never sit on a sales order in v1). The `salesInvoiceLines` view is dropped and recreated with `SELECT *` (lesson). VOID mirrors every leg and unstamps periods.

**Deposits.** `payment` gains `rentalAgreementId` and `salesOrderId` (nullable, CHECK at most one). `post-payment`: a posted **Receipt** carrying either document reference posts its **unapplied** portion **Cr `prepaymentAccount` 2110** (Dr cash as today) instead of the AR credit, `documentType 'Rental Agreement'` / `documentId`. Applying it later to a posted invoice (`invoiceSettlement.sourcePaymentId`, the existing prior-credit path) posts Dr 2110 / Cr AR; refunding the balance is a **Disbursement** funded by the deposit payment (existing refund machinery) posting Dr 2110 / Cr cash. Deposits never touch revenue or schedules. Ordinary receipts without a document reference keep today's behavior.

**Utilization.** `getRentalUtilization(companyId, { from, to, fixedAssetClassId? })`: per fleet asset (and class total) **time utilization** = on-rent days ÷ days the unit was in the fleet in the range, and **dollar utilization** = rental + lease-interest income recognized in the range ÷ Σ `acquisitionCost` (annualized) — read from agreement line dates and posted schedule rows; CSV export via the table-export surface.

### 4. Sales-type leases (Phase D)

**Classification** (`classifyLessorLease`, `accounting.utils.ts`, computed per line at activation and stored with its inputs): the term is `startDate → endDate` in months (open-ended ⇒ 1 month ⇒ always Operating; Sales-Type therefore requires `endDate`). Tests (ASC 842-10-25-2): (a) `ownershipTransfers`; (b) `purchaseOptionReasonablyCertain`; (c) term ≥ `companySettings.leaseMajorPartThresholdPercent` (75) % of `economicLifeMonths`; (d) PV(fixed payments + purchase option if reasonably certain + guaranteed residual) ≥ `leaseSubstantiallyAllThresholdPercent` (90) % of `fairValue`; (e) `specializedAsset`. Any true ⇒ **Sales-Type**, else **Operating**. Direct Financing (PV substantially all *only* through a third-party residual guarantee) has no input in v1 and is unreachable; the enum value exists for #1056. An override with a required reason is allowed (`update: accounting`) and audit-logged. Thresholds and `leaseDefaultDiscountRate` live on `companySettings`.

**Present value.** Periodic rate r = `discountRate / 12`; payments in arrears (annuity-immediate) or advance (annuity-due) per `billingTiming`; PVpay = PV(rent stream) + PV(purchase option if reasonably certain) + PV(guaranteed residual); PVres = PV(unguaranteed residual); **NI = PVpay + PVres**.

**Commencement posting** (per Sales-Type line, inside `activate`, `sourceType 'Lease'`, `documentType 'Rental Agreement'`): derecognize the unit — from **inventory** at carrying cost **C** (same layer consumer as capitalization: `itemLedger` −1 with `documentType 'Rental Agreement'`, `costLedger` consumption, entity `Consumed` with `attributes["Rental Agreement"]` and **`Customer`** finally written) or from the **fleet** (Dr class accumulated depreciation / Cr class asset at cost, C = NBV, asset `Disposed` by `Sale`, `fixedAssetDisposal` row) — then:

```
Dr Net Investment in Leases (1160)        NI
Dr Cost of Goods Sold (5010)              C − PVres
    Cr Lease Revenue (4070)                       PVpay
    Cr Finished Goods (1220) / fleet asset legs   C
```
Selling profit = PVpay − (C − PVres), stored on the line. Balanced by construction (NI + C − PVres = PVpay + PVres + C − PVres).

**Schedule** `rentalLeaseScheduleLine` (per line, effective interest, lessor semantics of #1056's `leaseScheduleLine`): `periodDate`, `openingNetInvestment`, `paymentAmount`, `interestAmount = opening × r`, `principalAmount = payment − interest`, `closingNetInvestment`; the final line absorbs rounding so the closing balance equals the residual + purchase option exactly. Each line spawns one `Interest` schedule row (Dr 1160 / Cr 4150) that the recognition run posts in its period.

**End of term.** *Purchase option exercised*: the agreement's "Sell to customer" action bills a `Purchase Option` Rental line (Dr AR / Cr 1160); the line becomes `Sold`. *Returned with unguaranteed residual*: `return` posts Dr class asset account (into the Rental Fleet class as a new fleet asset at the residual, or Dr Finished Goods when returned to stock) / Cr 1160 for the closing net investment; the tracked entity is reactivated as in §2. *Ownership transfers*: nothing remains. Early termination of a Sales-Type line is a manual journal in v1 (blocked in the UI with that message).

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Standard for rentals | Lessor operating / sales-type accounting (ASC 842 / IFRS 16), separate rental-income and lease accounts; not 606 arrangements | Identified asset + customer control = lease; short-term election is lessee-only; Tesla / United Rentals presentation (research §1) |
| 2 | Rev-rec scope now | Phase 1 = capture the amount: schedule + run + deferral + accrual + close task; SSP / arrangements / POC later on the same substrate | Brad 2026-09-22; rentals need none of the allocation machinery |
| 3 | Fleet capitalization | `fixedAssetTransfer` capitalize / return-to-inventory posting that consumes the serial into the asset | D365 F&SC Inventory→FA journal, NetSuite asset proposal, SAP 241 (research §3); keeps the inventory tie-out exact |
| 4 | Selling a returned unit | Return to inventory at NBV then normal sale (gross) as the default; existing Fixed Asset SO line stays (net) | ASC 606 vs 610-20 (research §6); both paths exist in industry |
| 5 | Rental document | New `rentalAgreement` in the sales module, not a sales-order line type nor #1056's `lease` table | Time-based, open-ended, recurring; every system that bent the SO bolted a subscription engine beside it (research §4); columns kept compatible so #1056 lessor tests attach later |
| 6 | Serial custody | Consumed-into-asset + `Fixed Asset` / `Rental Agreement` / `Customer` attributes; fleet status derived from agreements | No new tracked-entity statuses or rental locations; RMA reactivation precedent |
| 7 | Rental revenue timing | `Rental` lines always defer; the run releases and accrues unbilled rent to contract assets | One rule for advance and arrears; period-correct regardless of invoice posting date |
| 8 | Recognition vehicle | `revenueRecognitionRun` Draft → Posted batch (depreciation-run pattern) | Propose-only posture (close-automation decision, Brad 2026-07-04); no hook into `postJournalEntry`; approvable batch |
| 9 | Schedule rows carry accounts | `debitAccountId` / `creditAccountId` captured at creation | The run stays a pure poster; new methods add rows, not branches |
| 10 | Billing | Calendar Month (prorated month tier) or 28 Days (thirteen per year, day / week / month ladder), advance or arrears, Draft invoices proposed daily, one invoice per agreement per cycle | Texada / point-solution convention (research §4); anniversary cycles later |
| 11 | Rates | Day / week / month ladder on the item, snapshotted per line; best rate per billing period with ties to the larger unit; level for the term, escalations later | Odoo cheapest-line rule + Texada single-tier rule; per-period evaluation keeps every charge non-negative and known when cut; level payments ⇒ straight-line = billing, no straight-line receivable in v1 |
| 12 | Revenue account | Company default `rentalIncomeAccount` (+ lease accounts), fleet asset accounts per class | Flat defaults + per-entity assignment (lesson: no N×M matrix); the class already owns the balance-sheet accounts |
| 13 | Deposits | `payment.rentalAgreementId` / `salesOrderId` → 2110 via the deposit branch; refund via existing Disbursement refund | Reuses AR/AP payment machinery; #1048's design generalized |
| 14 | Sales-type in v1 | Classification, commencement, effective-interest schedule, interest in the run, purchase option, residual return; direct financing unreachable; early termination manual | Brad 2026-09-22; residual-guarantee-only cases are rare for a manufacturer renting its own product |
| 15 | Source types | `'Asset Transfer'`, `'Lease'`, `'Revenue Recognition'` (+ `POSTING_POLICY` entries) | Names shared with #1041 / #1056; irreversible enum values kept to three |
| 16 | Multi-tenancy (H1) | Every new table: `companyId`, composite PK `("id","companyId")`, `id('prefix')`, audit columns, `customFields` on documents; FKs to `fixedAsset("id")` / `trackedEntity("id")` single-column (their PK shape) | House convention; fixed-asset tables predate composite PKs |
| 17 | Service shape (H2) | Rental CRUD/queries in `sales.service.ts`, invoice generation in `sales.server.ts`; schedules/runs/fleet queries in `accounting.service.ts`, posting transactions in `accounting.server.ts`, calc in `accounting.utils.ts`; `(client, …) → {data, error}`, never throw | One service/models pair per module |
| 18 | RLS (H3) | Four policies per table: SELECT `get_companies_with_employee_permission('<module>_view')`, writes `<module>_create/update/delete` — `sales_*` for agreement tables, `accounting_*` for transfers, schedules, runs | Fixed-asset and AR/AP payment precedents |
| 19 | Permissions (H4) | Agreement routes `view/create/update/delete: "sales"`; activate/return/close `update: "sales"` + edge-function `requirePermissions`; capitalize/return-to-inventory, runs, overrides `create/update: "accounting"` | Dispose / depreciation-run precedent |
| 20 | Forms (H5) | `ValidatedForm` + zod (`rentalAgreementValidator`, `rentalAgreementLineValidator`, `rentalAgreementChargeValidator`, `fixedAssetTransferValidator`, `revenueRecognitionRunValidator`, `itemRentalRateValidator`); Drawer overlays for line/charge detail | House convention |
| 21 | Module layout (H6) | No new module; sales `ui/Rentals/`, accounting `ui/RevenueRecognition/` + `ui/FixedAssets/` additions | A rental is a sales sub-area; fleet + recognition are accounting |
| 22 | Backward compatibility (H7) | Additive schema; `post-sales-invoice` / `post-payment` branches only fire on `Rental` lines, service dates + flag, or document-referenced deposits; views recreated with `SELECT *`; new source types get policies | Frozen posting surfaces byte-identical otherwise (AC #1) |
| 23 | Make to Asset choke point | The job→asset branch lives inside `complete_job_to_inventory`, keyed on `job.fixedAssetClassId` / `job.fixedAssetId`; assets and transfer rows are created in SQL with `get_next_sequence` | Lesson: completion side effects must live in the SQL function — the interceptor cascade auto-completes jobs without the route |
| 24 | Job→asset journals | `sourceType 'Asset Transfer'`, both lines `documentType 'Asset Transfer'` with `documentId = jobId`, `documentLineReference = transferId` | The per-job WIP balance is Σ lines with `documentId = jobId`; a different id on the credit would leave phantom WIP. Not `'Job Receipt'`: nothing was received to stock |
| 25 | CIP contract | Class flag + `Under Construction` + `fixedAssetCipCost` + attach-at-WIP-credit + complete-to-CIP + capitalization transfer, all-or-nothing per job | Brad 2026-07-04 (SAP AuC: cost leaves WIP at attachment) and 2026-09-03 ("let's add make"); answers the five questions raised on #1041; one job targets inventory or one asset; built here as Phase B, nothing delegated (Brad, 2026-09-22) |
| 26 | Work-center link | `fixedAsset.workCenterId` (many assets → one cell), read-only capital-cost panel; no automatic machine-rate change | Mirrors `fixedAsset.locationId`; deriving rates is a costing-policy decision that belongs with standard costing |
| 27 | Out of service | Two columns on `fixedAsset`; fleet status derives `In Maintenance`; depreciation unaffected | Point-solution status buckets; the accounting status enum stays clean |

## Data Model Changes

Three migrations (enums first, per the ADD VALUE transaction rule; randomized HHMMSS; idempotent), then `pnpm run generate:types`.

```sql
-- ── 1) Enums ────────────────────────────────────────────────────────────────
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Lease';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Revenue Recognition';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "itemLedgerDocumentType"  ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "itemLedgerDocumentType"  ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "salesInvoiceLineType"    ADD VALUE IF NOT EXISTS 'Rental';
ALTER TYPE "disposalMethod"          ADD VALUE IF NOT EXISTS 'Transfer to Inventory';
ALTER TYPE "fixedAssetStatus"        ADD VALUE IF NOT EXISTS 'Under Construction';

CREATE TYPE "fixedAssetTransferType"    AS ENUM ('Capitalization', 'Return to Inventory');  -- 'Reclassification' joins later
CREATE TYPE "fixedAssetTransferSourceType" AS ENUM ('Inventory', 'Job', 'Construction in Progress');
CREATE TYPE "revenueScheduleType"       AS ENUM ('Deferral', 'Accrual', 'Interest');
CREATE TYPE "revenueScheduleStatus"     AS ENUM ('Planned', 'Posted');
CREATE TYPE "rentalAgreementStatus"     AS ENUM ('Draft', 'Active', 'Closed', 'Cancelled');
CREATE TYPE "rentalAgreementLineStatus" AS ENUM ('Pending', 'On Rent', 'Returned', 'Sold');
CREATE TYPE "rentalBillingCycle"        AS ENUM ('Calendar Month', '28 Days');
CREATE TYPE "rentalRateUnit"            AS ENUM ('Day', 'Week', 'Month');
CREATE TYPE "rentalRateMode"            AS ENUM ('Best Rate', 'Fixed');
CREATE TYPE "rentalBillingTiming"       AS ENUM ('Advance', 'Arrears');
CREATE TYPE "rentalBillingPeriodStatus" AS ENUM ('Pending', 'Invoiced');
CREATE TYPE "rentalInvoiceLineKind"     AS ENUM ('Rent', 'Charge', 'Purchase Option');
CREATE TYPE "lessorClassification"      AS ENUM ('Operating', 'Sales-Type', 'Direct Financing');  -- shared with #1056

-- ── 2) Settings + defaults ──────────────────────────────────────────────────
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "revenueRecognitionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "leaseMajorPartThresholdPercent" NUMERIC NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS "leaseSubstantiallyAllThresholdPercent" NUMERIC NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "leaseDefaultDiscountRate" NUMERIC NOT NULL DEFAULT 6;   -- annual %

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "deferredRevenueAccount" TEXT REFERENCES "account"("id"),
  ADD COLUMN IF NOT EXISTS "contractAssetAccount" TEXT REFERENCES "account"("id"),
  ADD COLUMN IF NOT EXISTS "rentalIncomeAccount" TEXT REFERENCES "account"("id"),
  ADD COLUMN IF NOT EXISTS "leaseRevenueAccount" TEXT REFERENCES "account"("id"),
  ADD COLUMN IF NOT EXISTS "leaseInterestIncomeAccount" TEXT REFERENCES "account"("id"),
  ADD COLUMN IF NOT EXISTS "netInvestmentInLeasesAccount" TEXT REFERENCES "account"("id");
-- Seeds per company group (parent by "isGroup" = TRUE AND name): 1145 Contract Assets
-- (Receivables), 1160 Net Investment in Leases (Receivables), 1370 Rental Fleet (PP&E),
-- 1380 Accumulated Depreciation – Rental Fleet (PP&E), 1390 Construction in Progress (PP&E),
-- 4060 Rental Income (Revenue),
-- 4070 Lease Revenue (Revenue), 4150 Interest Income – Leases (Other Income);
-- backfill the six accountDefault columns by id (2160 already exists); mirror in
-- seed.data.ts + seed-company; one 'Rental Fleet' and one 'Construction in Progress' fixedAssetClass per company;
-- sequences 'rentalAgreement' (RA), 'revenueRecognitionRun' (RR), 'fixedAssetTransfer' (FAT);
-- periodCloseTaskDefinition 'Recognize revenue for the period' (Auto,
-- 'unposted-revenue-schedules', Warning, isSystem) after the depreciation task.

-- ── 3) Fleet bridge ─────────────────────────────────────────────────────────
ALTER TABLE "fixedAsset"
  ADD COLUMN IF NOT EXISTS "itemId" TEXT REFERENCES "item"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "trackedEntityId" TEXT REFERENCES "trackedEntity"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "quantity" NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "workCenterId" TEXT REFERENCES "workCenter"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "outOfServiceSince" DATE,
  ADD COLUMN IF NOT EXISTS "outOfServiceReason" TEXT;
ALTER TABLE "fixedAsset" ADD CONSTRAINT "fixedAsset_quantity_v1_check" CHECK ("quantity" = 1);
ALTER TABLE "fixedAsset" ADD CONSTRAINT "fixedAsset_outOfService_check"
  CHECK (("outOfServiceSince" IS NULL) = ("outOfServiceReason" IS NULL));
ALTER TABLE "fixedAssetClass" ADD COLUMN IF NOT EXISTS "isConstructionInProgress" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "fixedAssetClassId" TEXT REFERENCES "fixedAssetClass"("id"),   -- Make to Asset: create at completion
  ADD COLUMN IF NOT EXISTS "fixedAssetId" TEXT REFERENCES "fixedAsset"("id");             -- CIP: sweep this job's cost to the asset
ALTER TABLE "job" ADD CONSTRAINT "job_asset_target_check"
  CHECK (num_nonnulls("fixedAssetClassId", "fixedAssetId") <= 1);
CREATE UNIQUE INDEX IF NOT EXISTS "fixedAsset_trackedEntity_live_idx"
  ON "fixedAsset" ("companyId", "trackedEntityId") WHERE "trackedEntityId" IS NOT NULL AND "status" <> 'Disposed';

CREATE TABLE IF NOT EXISTS "fixedAssetTransfer" (
  "id" TEXT NOT NULL DEFAULT id('fatr'),
  "companyId" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "type" "fixedAssetTransferType" NOT NULL,
  "sourceType" "fixedAssetTransferSourceType" NOT NULL DEFAULT 'Inventory',
  "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
  "itemId" TEXT REFERENCES "item"("id"),                       -- NULL for a CIP capitalization
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id"),
  "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,      -- sourceType 'Job'
  "fromClassId" TEXT REFERENCES "fixedAssetClass"("id"),       -- sourceType 'Construction in Progress'
  "locationId" TEXT NOT NULL,
  "storageUnitId" TEXT,
  "quantity" NUMERIC NOT NULL DEFAULT 1,
  "transferDate" DATE NOT NULL,
  "inServiceDate" DATE,                                        -- CIP capitalization: depreciation start
  "amount" NUMERIC NOT NULL,                       -- carrying cost / WIP cost / Σ CIP cost (capitalize), NBV (return), base currency
  "accumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "fixedAssetTransfer_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetTransfer_transferId_companyId_key" UNIQUE ("transferId", "companyId"),
  CONSTRAINT "fixedAssetTransfer_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- + 4 RLS policies (accounting_view/create/update/delete)

CREATE TABLE IF NOT EXISTS "fixedAssetCipCost" (            -- append-only CIP cost ledger
  "id" TEXT NOT NULL DEFAULT id('facc'),
  "companyId" TEXT NOT NULL,
  "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
  "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('Purchase Invoice', 'Receipt', 'Job', 'Manual')),
  "sourceDocumentId" TEXT,
  "sourceDocumentLineId" TEXT,
  "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,
  "amount" NUMERIC NOT NULL,
  "costDate" DATE NOT NULL,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "fixedAssetCipCost_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetCipCost_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_asset_idx" ON "fixedAssetCipCost" ("companyId", "fixedAssetId");
-- + 4 RLS policies (accounting_*)

-- ── 4) Revenue recognition core ─────────────────────────────────────────────
ALTER TABLE "salesOrderLine"
  ADD COLUMN IF NOT EXISTS "serviceStartDate" DATE, ADD COLUMN IF NOT EXISTS "serviceEndDate" DATE;
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "serviceStartDate" DATE, ADD COLUMN IF NOT EXISTS "serviceEndDate" DATE,
  ADD COLUMN IF NOT EXISTS "rentalAgreementId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalAgreementLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalBillingPeriodId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalAgreementChargeId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalInvoiceLineKind" "rentalInvoiceLineKind",
  ADD CONSTRAINT "salesInvoiceLine_rental_check" CHECK (
    ("invoiceLineType" <> 'Rental' AND "rentalAgreementLineId" IS NULL) OR
    ("invoiceLineType" = 'Rental' AND "rentalAgreementLineId" IS NOT NULL AND "rentalInvoiceLineKind" IS NOT NULL)
  ),
  ADD CONSTRAINT "salesInvoiceLine_serviceDates_check" CHECK (
    ("serviceStartDate" IS NULL) = ("serviceEndDate" IS NULL) AND
    ("serviceEndDate" IS NULL OR "serviceEndDate" >= "serviceStartDate")
  );
-- salesInvoiceLines view: DROP + CREATE with t.* (lesson: CREATE OR REPLACE cannot reorder columns)

CREATE TABLE IF NOT EXISTS "revenueRecognitionSchedule" (
  "id" TEXT NOT NULL DEFAULT id('rvsc'),
  "companyId" TEXT NOT NULL,
  "type" "revenueScheduleType" NOT NULL,
  "status" "revenueScheduleStatus" NOT NULL DEFAULT 'Planned',
  "salesInvoiceLineId" TEXT,                        -- Deferral source
  "rentalAgreementLineId" TEXT,                     -- Accrual / Interest / rental Deferral
  "rentalLeaseScheduleLineId" TEXT,                 -- Interest
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "scheduledDate" DATE NOT NULL,                    -- = periodEnd
  "accountingPeriodId" TEXT REFERENCES "accountingPeriod"("id"),
  "amount" NUMERIC NOT NULL,                        -- base currency, historical rate
  "debitAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "creditAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "runLineId" TEXT,                                 -- claimed by a Draft run
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "billedBySalesInvoiceLineId" TEXT,                -- Accrual consumed by a later invoice
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionSchedule_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionSchedule_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "rvsc_due_idx" ON "revenueRecognitionSchedule" ("companyId", "status", "scheduledDate");
-- + 4 RLS policies (accounting_*)

CREATE TABLE IF NOT EXISTS "revenueRecognitionRun" (
  "id" TEXT NOT NULL DEFAULT id('rvrn'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionRun_runId_companyId_key" UNIQUE ("runId", "companyId")
);
CREATE TABLE IF NOT EXISTS "revenueRecognitionRunLine" (
  "id" TEXT NOT NULL DEFAULT id('rvrl'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  CONSTRAINT "revenueRecognitionRunLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionRunLine_run_fkey" FOREIGN KEY ("runId", "companyId")
    REFERENCES "revenueRecognitionRun"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "revenueRecognitionRunLine_schedule_key" UNIQUE ("companyId", "scheduleId")
);
-- + 4 RLS policies each (accounting_*)

-- ── 5) Rentals ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "itemRentalRate" (
  "id" TEXT NOT NULL DEFAULT id('irr'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE,
  "currencyCode" TEXT NOT NULL,
  "dayRate" NUMERIC,
  "weekRate" NUMERIC,
  "monthRate" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "itemRentalRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "itemRentalRate_item_currency_key" UNIQUE ("companyId", "itemId", "currencyCode"),
  CONSTRAINT "itemRentalRate_tier_check" CHECK (num_nonnulls("dayRate", "weekRate", "monthRate") >= 1)
);  -- RLS sales_*

CREATE TABLE IF NOT EXISTS "rentalAgreement" (
  "id" TEXT NOT NULL DEFAULT id('rag'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementId" TEXT NOT NULL,
  "status" "rentalAgreementStatus" NOT NULL DEFAULT 'Draft',
  "customerId" TEXT NOT NULL,
  "customerLocationId" TEXT,
  "customerContactId" TEXT,
  "salesPersonId" TEXT REFERENCES "user"("id"),
  "locationId" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "billingCycle" "rentalBillingCycle" NOT NULL DEFAULT 'Calendar Month',
  "billingTiming" "rentalBillingTiming" NOT NULL DEFAULT 'Advance',
  "paymentTermId" TEXT,
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "depositAmount" NUMERIC NOT NULL DEFAULT 0,
  "discountRate" NUMERIC NOT NULL,                  -- annual %, copied from companySettings at creation
  "ownershipTransfers" BOOLEAN NOT NULL DEFAULT false,
  "specializedAsset" BOOLEAN NOT NULL DEFAULT false,
  "purchaseOptionAmount" NUMERIC,
  "purchaseOptionReasonablyCertain" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "activatedAt" TIMESTAMP WITH TIME ZONE, "closedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "rentalAgreement_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalAgreement_rentalAgreementId_companyId_key" UNIQUE ("rentalAgreementId", "companyId"),
  CONSTRAINT "rentalAgreement_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rentalAgreement_dates_check" CHECK ("endDate" IS NULL OR "endDate" > "startDate")
);

CREATE TABLE IF NOT EXISTS "rentalAgreementLine" (
  "id" TEXT NOT NULL DEFAULT id('ragl'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementId" TEXT NOT NULL,
  "status" "rentalAgreementLineStatus" NOT NULL DEFAULT 'Pending',
  "fixedAssetId" TEXT REFERENCES "fixedAsset"("id"),
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id"),
  "quantity" NUMERIC NOT NULL DEFAULT 1 CHECK ("quantity" = 1),
  "rateMode" "rentalRateMode" NOT NULL DEFAULT 'Best Rate',
  "rateUnit" "rentalRateUnit",                      -- the tier a Fixed line bills
  "dayRate" NUMERIC, "weekRate" NUMERIC, "monthRate" NUMERIC,   -- snapshot of itemRentalRate at activation
  "fairValue" NUMERIC,
  "economicLifeMonths" INTEGER,
  "guaranteedResidualValue" NUMERIC NOT NULL DEFAULT 0,
  "unguaranteedResidualValue" NUMERIC NOT NULL DEFAULT 0,
  "lessorClassification" "lessorClassification",
  "classificationOverride" BOOLEAN NOT NULL DEFAULT false,
  "classificationOverrideReason" TEXT,
  "classificationInputs" JSONB,                     -- snapshot of the five tests + PVs at activation
  "initialNetInvestment" NUMERIC,
  "sellingProfit" NUMERIC,
  "deliveredAt" DATE, "returnedAt" DATE,
  "meterOut" NUMERIC, "meterIn" NUMERIC, "returnNotes" TEXT,
  "commencementJournalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalAgreementLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalAgreementLine_rate_check" CHECK ("rateMode" = 'Best Rate' OR "rateUnit" IS NOT NULL),
  CONSTRAINT "rentalAgreementLine_agreement_fkey" FOREIGN KEY ("rentalAgreementId", "companyId")
    REFERENCES "rentalAgreement"("id", "companyId") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "rentalAgreementLine_asset_live_idx"
  ON "rentalAgreementLine" ("companyId", "fixedAssetId")
  WHERE "fixedAssetId" IS NOT NULL AND "status" IN ('Pending', 'On Rent');

CREATE TABLE IF NOT EXISTS "rentalAgreementCharge" (
  "id" TEXT NOT NULL DEFAULT id('ragc'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementLineId" TEXT NOT NULL,
  "chargeDate" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0,
  "salesInvoiceLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalAgreementCharge_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalAgreementCharge_line_fkey" FOREIGN KEY ("rentalAgreementLineId", "companyId")
    REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "rentalBillingPeriod" (
  "id" TEXT NOT NULL DEFAULT id('rbp'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "days" INTEGER NOT NULL,
  "rateUnitApplied" "rentalRateUnit",
  "amount" NUMERIC NOT NULL,                        -- negative on an isAdjustment row
  "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
  "dueOn" DATE NOT NULL,
  "status" "rentalBillingPeriodStatus" NOT NULL DEFAULT 'Pending',
  "salesInvoiceLineId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "rentalBillingPeriod_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalBillingPeriod_line_fkey" FOREIGN KEY ("rentalAgreementLineId", "companyId")
    REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "rentalBillingPeriod_unique" UNIQUE ("companyId", "rentalAgreementLineId", "periodStart", "isAdjustment")
);

CREATE TABLE IF NOT EXISTS "rentalLeaseScheduleLine" (       -- sales-type effective interest
  "id" TEXT NOT NULL DEFAULT id('rlsl'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementLineId" TEXT NOT NULL,
  "periodDate" DATE NOT NULL,
  "openingNetInvestment" NUMERIC NOT NULL,
  "paymentAmount" NUMERIC NOT NULL,
  "interestAmount" NUMERIC NOT NULL,
  "principalAmount" NUMERIC NOT NULL,
  "closingNetInvestment" NUMERIC NOT NULL,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalLeaseScheduleLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalLeaseScheduleLine_line_fkey" FOREIGN KEY ("rentalAgreementLineId", "companyId")
    REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "rentalLeaseScheduleLine_unique" UNIQUE ("companyId", "rentalAgreementLineId", "periodDate")
);
-- RLS: rentalAgreement*, rentalBillingPeriod, rentalLeaseScheduleLine, itemRentalRate → sales_view/create/update/delete
-- (schedule lines are written by service-role posting paths; policies exist for completeness)

-- ── 6) Deposits ─────────────────────────────────────────────────────────────
ALTER TABLE "payment"
  ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "rentalAgreementId" TEXT,
  ADD CONSTRAINT "payment_deposit_document_check" CHECK (
    num_nonnulls("salesOrderId", "rentalAgreementId") <= 1
  );

-- ── 7) Views ────────────────────────────────────────────────────────────────
-- fleetAssets: fixedAsset (itemId NOT NULL) ⨝ item ⨝ trackedEntity ⟕ active rentalAgreementLine ⟕ rentalAgreement
--   → fleetStatus ('Sold' | 'Returned to Stock' | 'Under Construction' | 'On Rent' | 'In Maintenance' | 'Reserved' | 'Available'),
--     customerId, customerLocationId, outOfServiceReason, nbv
-- rentalAgreements: header ⨝ customer + line/period rollups (lineCount, onRentCount, nextDueOn, unbilledAmount)
```

Tracked-entity attribute vocabulary (`functions/lib/utils.ts` `TrackedEntityAttributes`) gains `"Fixed Asset"` and `"Rental Agreement"`; `Customer` is written for the first time. `trackedActivity.type` values added: `Capitalize`, `Return to Inventory`, `Lease Commencement`.

## API / Service Changes

```ts
// accounting.service.ts (client-first, {data, error})
getRevenueSchedules(client, companyId, filters)           // waterfall + run preview
getRevenueRecognitionRun(s) / getRevenueRecognitionRunLines
getDeferredRevenueWaterfall(client, companyId, { asOf })  // Planned rows bucketed by period; opening 2160 tie-out
getFleetAssets(client, companyId, filters)                // fleetAssets view
getFixedAssetTransfer(s)
getFixedAssetCipCosts(client, fixedAssetId, companyId)
getWorkCenterCapitalCost(client, workCenterId, companyId)  // assets, NBV, monthly book depreciation
setFixedAssetOutOfService / returnFixedAssetToService(client, { fixedAssetId, companyId, reason?, userId })
getLeaseNetInvestment(client, companyId, { asOf })        // per line: NI, next interest, maturity by fiscal year
getRentalUtilization(client, companyId, { from, to, fixedAssetClassId? })

// accounting.server.ts (Kysely transactions)
createRevenueRecognitionRunProposal(db, { companyId, periodEnd, userId })  // shared by route + Inngest
postRevenueRecognitionRun(db, { runId, companyId, userId })                // one journal, 'Revenue Recognition', accounting source
overrideLessorClassification(db, { lineId, classification, reason, userId })

// accounting.utils.ts (pure, unit-tested)
spreadStraightLine(amount, start, end, periods) / prorateByDays(rate, periodStart, periodEnd)
presentValue({ payments, timing, rate, residuals })
classifyLessorLease(inputs, thresholds) → { classification, tests, pvPayments, pvResidual }
buildLessorSchedule({ netInvestment, payments, rate, residual }) → lines (last line absorbs rounding)

// sales.service.ts
get/insert/update/deleteRentalAgreement, getRentalAgreements(filters), lines/charges CRUD,
getRentalBillingPeriods, getRentableFleetAssets(companyId, locationId), get/upsert/deleteItemRentalRate,
generateRentalBillingPeriods(line, cycle, timing, through)                 // pure + persisted; both cycles, holdover, return re-cut + adjustment
// sales.utils.ts
bestRateCharge(days, { dayRate, weekRate, monthRate }) → { amount, rateUnitApplied }   // per period; ties → larger unit
// sales.server.ts
createRentalInvoicesForDuePeriods(db, serviceRole, { companyId, asOf, rentalAgreementId?, userId }) // shared by job + button

// Edge functions (packages/database/supabase/functions)
post-asset-transfer        { type: 'capitalize' | 'return' | 'attachJob' | 'capitalizeCip', transfer payload }   // requirePermissions create: accounting
// SQL: complete_job_to_inventory gains the job→asset branch (job.fixedAssetClassId / job.fixedAssetId): no itemLedger /
//      costLedger / FG / itemCost; Dr asset / Cr WIP; fixedAsset + fixedAssetTransfer (+ fixedAssetCipCost) rows via get_next_sequence
// post-receipt / post-purchase-invoice: a CIP-class asset lands 'Under Construction' and appends a fixedAssetCipCost row
post-rental-agreement      { type: 'activate' | 'return' | 'close' | 'cancel', rentalAgreementId, lines? }  // update: sales
post-sales-invoice         + case "Rental" (kind × classification per §3 table); + service-date deferral (flag-gated); VOID mirrors
post-payment               + deposit branch (salesOrderId | rentalAgreementId ⇒ unapplied portion → prepaymentAccount)

// Inngest (packages/jobs/src/inngest/functions/scheduled)
rental-billing                 cron '0 5 * * *'   per company → createRentalInvoicesForDuePeriods
revenue-recognition-proposal   cron '0 6 1 * *'   per company → createRevenueRecognitionRunProposal(prior month)

// Close checklist
computePeriodReadiness: evaluator 'unposted-revenue-schedules' (see §1)
// @carbon/ee POSTING_POLICY: 'Asset Transfer', 'Lease', 'Revenue Recognition' (journal, syncable, defaultEnabled true)
```

Routes: `x+/sales+/rental-agreements.tsx` (+ `.new`), `x+/rental-agreement+/$id.{tsx,details,lines,$lineId,charges,activate,deliver,return,close,cancel,invoice,delete}.tsx`, `x+/sales+/item-rental-rates.tsx` (or the item's sales tab), `x+/accounting+/revenue-recognition-runs.tsx` (+ `.new`), `x+/revenue-recognition-run+/$runId.{tsx,post,repeat,delete}.tsx`, `x+/accounting+/fleet.tsx`, `x+/accounting+/revenue-waterfall.tsx`, `x+/accounting+/rental-utilization.tsx`, `x+/accounting+/lease-net-investment.tsx`, `x+/fixed-asset+/$fixedAssetId.{return-to-inventory,attach-job,capitalize,out-of-service}.tsx`, `x+/part+/$itemId.inventory.tsx` gains a per-serial "Capitalize as fixed asset" action posting to `x+/fixed-asset+/capitalize.tsx`, the job form gains a **Complete to** target (inventory / a fixed-asset class / an Under Construction asset), and the work-center detail page gains the read-only capital-cost panel. Settings: `x+/accounting+/defaults.tsx` (six new mappings), `x+/settings+/…` rev-rec flag + lease thresholds.

## UI Changes

- **Rental agreements** table (status, customer, units, next due, unbilled) + New form (cycle, timing, dates, deposit); detail page with Lines (fleet unit picker filtered to `Available` and in service, rate mode + the snapshotted day / week / month tiers, fair value / life / residual / classification chip with test results and override), Charges, Billing periods (days, tier applied, status, invoice link, adjustments flagged), Deposits (payments referencing the agreement), and actions Activate / Deliver / Return (with meter reading and an out-of-service checkbox) / Generate invoices / Close / Cancel with confirmation modals showing the journal preview for sales-type activation.
- **Fleet register** (`fleetAssets`): status badges Under Construction / Available / Reserved / On Rent / In Maintenance / Sold / Returned to Stock, NBV, customer, out-of-service reason; row actions Rent (opens New agreement pre-filled), Take out of service / Return to service, Return to inventory (NBV preview); header action **Build for fleet** (opens New job with the Rental Fleet class as the completion target).
- **Capitalize** modal from a serialized unit's row on the item inventory page: class (default Rental Fleet), date, cost preview from the layer, resulting asset id. **Job form** gains a *Complete to* selector (Inventory, a fixed-asset class, or an Under Construction asset), read-only once the job has a WIP balance. **Asset page** gains Attach job (CIP only), Capitalize (CIP only: target class + in-service date + journal preview), the CIP cost ledger tab, a work-center field, and the out-of-service actions. **Work-center page** gains the capital-cost panel (assets, NBV, monthly depreciation).
- **Revenue recognition runs**: list + Draft run detail grouped by type (Deferral / Accrual / Interest) and agreement or invoice, Post button, Repeat; **Waterfall** report (opening 2160 / 1145 balances, future periods); **Net investment** report; **Utilization** report with class filter and CSV export.
- **Sales invoice** line form: `Rental` type is read-only (generated), shows agreement / period / kind; Service and Part lines gain optional service dates (visible when the rev-rec flag is on). **Payment** form gains a Deposit-for picker (sales order or rental agreement). **Item** sales tab gains the rental rate ladder (day / week / month).
- Close drawer shows the new task through the checklist substrate. Flash messages on every transition (`.claude/rules/flash-system.md`).

## Acceptance Criteria

Numbers are USD, base currency, tax 0 unless stated; the *Rental Fleet* class is Straight Line, 60 months, 20 % residual.

- [ ] **Byte-identical when off.** With `revenueRecognitionEnabled = false` and no Rental lines, posting a sales invoice produces journal lines identical to today (revenue to `salesAccount`); no schedule rows exist.
- [ ] **Straight line.** Flag on, a Service line $1,200.00 with service 2026-10-01 → 2027-03-31 posted 2026-10-05: Dr AR 1,200 / Cr 2160 1,200; six `Deferral` rows of 200.00 dated each month end; the October run posts Dr 2160 200 / Cr 4010 200 (the line's revenue account); a second run for October creates no lines; December Locked → the run posts; December Closed → the standard period error.
- [ ] **Capitalize.** Serial VIN-001 of item VEH-100 (FIFO layer 42,000.00) capitalized on 2026-10-01: Dr 1370 42,000 / Cr 1220 42,000; `itemLedger` −1 with `documentType 'Asset Transfer'`; on-hand 0 and the layer's `remainingQuantity` 0; entity `Consumed` with `attributes["Fixed Asset"]`; asset `Active`, `acquisitionCost` 42,000, `itemId`/`trackedEntityId`/`serialNumber` set; `get_inventory_tie_out` variance unchanged (0); traceability shows the asset as the consumer. Capitalizing the same serial again is rejected.
- [ ] **Depreciation.** The October depreciation run charges VIN-001 (42,000 − 8,400) ÷ 60 = 560.00 whether or not it is on rent.
- [ ] **Operating, advance.** Agreement RA-000001 (customer A, VIN-001, 1,500.00/month, start 2026-10-15, open-ended, Advance, fair value 60,000, life 120): activation classifies Operating, posts no journal, line `On Rent` after Deliver, fleet status `On Rent`; the daily job proposes one Draft invoice with a Rental line 822.58 (17/31 × 1,500) for 2026-10-15 → 10-31; posting it: Dr AR 822.58 / Cr 2160 822.58 + one `Deferral` row; the October run: Dr 2160 822.58 / Cr 4060 822.58; the November period 1,500.00 is proposed on/after Nov 1 and released by the November run; the job never proposes a period twice.
- [ ] **Operating, arrears.** Same agreement with Arrears: nothing is proposed in October; the October run posts an `Accrual` Dr 1145 822.58 / Cr 4060 822.58; the invoice proposed on/after Nov 1 for October posts Dr AR 822.58 / Cr 1145 822.58 (no 2160) and stamps the accrual as billed.
- [ ] **Variable charge.** A 120.00 mileage charge entered on the line appears on the next proposed invoice as a `Charge` Rental line and posts Dr AR 120 / Cr 4060 120 with no schedule row.
- [ ] **Deposit.** A Receipt of 3,000.00 referencing RA-000001 with no applications posts Dr cash 3,000 / Cr 2110 3,000; applying 500.00 to the posted final invoice posts Dr 2110 500 / Cr AR 500; a Disbursement refund of 2,500.00 funded by the deposit posts Dr 2110 2,500 / Cr cash 2,500; 2110 nets to 0 for the agreement and the invoice shows paid.
- [ ] **Return and resale.** Return on 2027-01-10: the final period 2027-01-01 → 01-10 = 483.87 (10/31 × 1,500) is proposed; line `Returned`, fleet `Available`. *Return to inventory* on 2027-01-15 after three depreciation runs: NBV 40,320.00 → Dr 1220 40,320 / Dr 1380 1,680 / Cr 1370 42,000; `itemLedger` +1; a `costLedger` layer of 40,320; entity `Available` with the Fixed Asset attribute cleared; asset `Disposed` (`Transfer to Inventory`), `fixedAssetDisposal.gainLoss` 0. Selling VIN-001 on a normal sales order at 45,000.00 posts revenue 45,000 and COGS 40,320.
- [ ] **Availability.** Adding VIN-001 to a second agreement while RA-000001's line is `Pending` or `On Rent` fails with an error naming RA-000001.
- [ ] **Make to Asset.** Job J-200 builds 2 × VEH-100 with *Complete to* = Rental Fleet and 84,000.00 of accumulated WIP. Completing it posts Dr 1370 84,000 / Cr 1230 84,000 (`sourceType 'Asset Transfer'`, both lines `documentId = J-200`), creates two Active assets at 42,000.00 each carrying the units' serials, `itemId` and `trackedEntityId`, two `fixedAssetTransfer` rows (`sourceType 'Job'`), and writes no `itemLedger`, `costLedger` or `itemCost` change — VEH-100 on-hand is unchanged and `get_inventory_tie_out` is unaffected; both entities are `Consumed` with `attributes["Fixed Asset"]`; J-200's WIP balance is 0.00 and completing it again creates nothing. A job for three untracked units with a class target is rejected at release with "Make to Asset needs a serialized item or a quantity of one". The same job with no target lands in Finished Goods exactly as today.
- [ ] **CIP.** Asset W-1 in the Construction in Progress class with no PO lines. Attaching in-progress job J-300 (WIP balance 2,500.00) posts Dr 1390 2,500 / Cr 1230 2,500 and a `fixedAssetCipCost` row; W-1 is `Under Construction` and the October depreciation run skips it. J-300 accrues 1,500.00 more and is completed: Dr 1390 1,500 / Cr 1230 1,500, a second cost row, no inventory receipt, entity `Consumed`. A Fixed Asset PO line of 6,000.00 invoiced against W-1 posts through the existing acquisition path and appends a third row. Capitalizing into Machinery & Equipment with in-service 2026-11-01 posts Dr 1350 10,000 / Cr 1390 10,000; `acquisitionCost` 10,000.00, `depreciationStartDate` 2026-11-01, `Active`; the November run charges 83.33 (120 months, 0 % residual). Attaching a job that is linked to a sales order line, or a second asset to J-300, is rejected.
- [ ] **Work-center link.** W-1 linked to work center WC-10 appears in WC-10's capital-cost panel with its NBV and 83.33 monthly depreciation; deleting WC-10 leaves W-1 with `workCenterId` null; WC-10's `machineRate` is unchanged.
- [ ] **Rate ladder (28 Days, Arrears, Best Rate).** VEH-100 rates day 100.00 / week 500.00 / month 1,500.00, snapshotted onto the line at activation (raising the item's day rate afterwards changes nothing on the agreement). Returned after 3 days: one period, 300.00 at the day rate. After 10 days: 1,000.00 as 2 × week (tie with 10 days; the larger unit wins) and the invoice line reads "10 days · 2 × week rate". After 20 days: 1,500.00 as 1 × month (tie with 3 weeks). After 35 days: period 1 (28 days) 1,500.00 + period 2 (7 days) 500.00 = 2,000.00. Still on rent after a year: 13 periods. `rateMode 'Fixed'` with `rateUnit 'Week'` bills a 10-day period at 1,000.00 regardless of the other tiers. Activating a Calendar Month agreement on an item with no month rate is rejected.
- [ ] **Early return on advance billing.** Same ladder, 28 Days, Advance, start 2026-10-01, `endDate` 2026-10-28: the 1,500.00 month-tier period is billed on day 1 and its `Planned` deferral row is 1,500.00. Returned on 2026-10-03: an adjustment row of −1,200.00 (1,500 − the best rate for 3 days) is proposed as a negative Rental line; posting it posts Dr 2160 1,200 / Cr AR 1,200 and the Planned row becomes 300.00, which the October run recognizes. Returned on 2026-10-20 instead: no adjustment (the month tier is already the best rate for 20 days).
- [ ] **Holdover.** RA-000003 (Calendar Month, 1,500.00/month, `endDate` 2026-10-31) with the unit still on rent on 2026-11-05: a November period exists at the same rate and the agreement shows *past end date*; returning on 2026-11-10 re-cuts it to 2026-11-01 → 11-10 = 500.00 (10/30 × 1,500).
- [ ] **Out of service.** *Take out of service* on VIN-001 with reason "Brake inspection": fleet status `In Maintenance`; adding it to an agreement line fails with an error naming the reason; the October depreciation run still charges 560.00; *Return to service* makes it `Available`. Taking an `On Rent` unit out of service is rejected. Ticking the box on the return form leaves the returned unit `In Maintenance`.
- [ ] **Sales-type.** RA-000002: 36 months, 1,000.00/month Arrears, purchase option 5,000.00 reasonably certain, fair value 38,000, life 120, 6 % rate, unit from stock at carrying 30,000.00, residuals 0. PV payments = 32,871.02, PV option = 4,178.22, NI = 37,049.24; classification Sales-Type (test b; also test d: PV incl. option 37,049.24 / 38,000 = 97.5 %). Activation posts Dr 1160 37,049.24 / Dr 5010 30,000.00 / Cr 4070 37,049.24 / Cr 1220 30,000.00; `sellingProfit` 7,049.24; `itemLedger` −1 with `'Rental Agreement'`; entity `Consumed` with `Rental Agreement` and `Customer` attributes. 36 schedule lines; month 1 interest 185.25, principal 814.75, closing 36,234.49; the October run posts Dr 1160 185.25 / Cr 4150 185.25; the month-1 invoice posts Dr AR 1,000 / Cr 1160 1,000. After payment 36 the closing balance is 5,000.00 ± 0.01 (last line absorbs rounding); "Sell to customer" bills a `Purchase Option` line 5,000.00 → Dr AR / Cr 1160 → net investment 0.00, line `Sold`.
- [ ] **Classification.** RA-000002 with the option *not* reasonably certain and fair value 60,000: PV 32,871.02 / 60,000 = 54.8 % < 90 % and 36/120 = 30 % < 75 % ⇒ Operating. An open-ended agreement always classifies Operating; setting `purchaseOptionReasonablyCertain` without an `endDate` is rejected. An override to Sales-Type requires a reason and writes an audit-log entry.
- [ ] **Close task.** "Recognize revenue for the period" fails for October while a due `Planned` row, an un-accrued on-rent day or an unposted `Interest` row exists; passes after the October run posts; a company with the flag off and no agreements passes.
- [ ] **Utilization.** For Q4 2026 VIN-001 reports 78 on-rent days of 92 (84.8 %) and dollar utilization = recognized rental income ÷ 42,000 annualized; CSV export matches the table.
- [ ] **Sync policy.** `POSTING_POLICY` has entries for `'Asset Transfer'`, `'Lease'`, `'Revenue Recognition'`; `pnpm --filter @carbon/ee typecheck` passes.
- [ ] **Hygiene.** `pnpm run generate:types`, scoped `typecheck` (erp, database, jobs, ee), `pnpm run lint`, unit tests for `spreadStraightLine`, `prorateByDays`, `bestRateCharge`, `generateRentalBillingPeriods`, `presentValue`, `classifyLessorLease`, `buildLessorSchedule` (incl. the numeric examples above) pass; the `complete_job_to_inventory` redefinition is forked from the newest migration and diffed against `origin/main` before merge; all migrations apply idempotently twice; every new table has four RLS policies; `pnpm db:check:datasets` and `pnpm db:check:backups` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Provider invoice sync cannot represent a Rental line that credits Deferred Revenue (QBO item income-account typing; Rillet document model) | High | Plan-stage spike per provider; Xero maps by account code; where a provider cannot, exclude Rental invoices from document sync with reason code and let the `'Revenue Recognition'` journals + a journal-represented invoice carry the amounts; document in `accounting-sync-handlers.md` |
| Double recognition between accrual and deferral for the same period | High | `rentalBillingPeriod` is the single source of "what was billed"; the run computes accrual days as period days minus days covered by billed rows; invoice posting consumes posted accruals before deferring; AC arrears case pins it |
| Regression in `post-sales-invoice` / `post-payment` for non-rental companies | High | Branches keyed on `Rental` line type, service dates + flag, and document-referenced receipts; AC #1 pins byte-identical output; VOID paths tested |
| Carrying-cost resolution for capitalization diverges from shipment COGS | Med | Reuse the shared layer consumer (`calculateCOGS` path) rather than re-implementing; tie-out AC |
| Sales-type PV/schedule rounding and rate edge cases (advance timing, zero rate) | Med | Pure utilities with unit tests; last line absorbs rounding; zero rate ⇒ straight PV = Σ payments |
| Enum additions are irreversible | Low | Three source types, two document types, one invoice line type, one disposal method, all named to match sibling specs |
| Net investment is monetary in the agreement currency; FX remeasurement is out of scope | Med | v1 requires agreement currency = base currency for Sales-Type lines (validation); note in docs; #1050 owns revaluation |
| Draft invoice edits after proposal (price changes) desync periods | Med | The Rental line's `unitPrice` is what posts; editing it is allowed but the period keeps the proposed amount for the waterfall; the run reconciles on posted amounts only |
| `computePeriodReadiness` evaluator missing ⇒ every close blocked | Med | Definition seed and evaluator ship in one PR (AC close task) |
| `complete_job_to_inventory` is redefined by many migrations; a fork from a stale base silently reverts sibling branches | High | Fork from the newest definition, `DROP IF EXISTS` first, diff against `origin/main` before merge (lesson: `get_batchable_operations`) |
| CIP was earlier discussed on #1041 as external contributor work | Low | Brad (2026-09-22): nothing is assigned to the contributor; §2 is the only CIP design and Phase B builds it in-house. Note the change on the issue when convenient so no parallel spec appears |
| Negative Rental lines depend on posting's signed-line handling | Med | Early-return AC; unit test `buildSalesPostingLines` with a negative Rental line; mixed-sign invoice lines are already supported (lesson) |
| Rate-ladder tie-breaks and 28-day periods straddling two accounting periods | Low | `bestRateCharge` and `generateRentalBillingPeriods` are pure and unit-tested; deferral rows split per accounting period exactly as in Phase A |

## Open Questions

> Resolutions from Brad (2026-09-22) are recorded verbatim in intent; questions surfaced while writing carry a recommended answer and are marked **pending veto** — they do not block `/plan`, but a veto changes the affected section.

- [x] **Scope of the rev-rec build: full ASC 606 model now, or phased?** — **Answer (Brad, 2026-09-22):** phase it; "we just need to capture the amount" ⇒ Phase A is the schedule/run/deferral/accrual core; SSP allocation, arrangements and POC are later phases on the same substrate (§0, Decision 2).
- [x] **Accounting treatment: lessor operating leases vs 606 subscription services; sales-type in v1?** — **Answer (Brad, 2026-09-22):** lessor lease accounting, and **include sales-type in v1** (§4, Decisions 1 and 14).
- [x] **Fleet capitalization bridge (capitalize from inventory + return to inventory at NBV), shared with the CIP work?** — **Answer (Brad, 2026-09-22):** yes (§2, Decisions 3–4).
- [x] **Rental document and home: new `rentalAgreement` in sales with a `Rental` invoice line type?** — **Answer (Brad, 2026-09-22):** yes (§3, Decision 5).
- [x] **Serial custody: consume into the asset and derive on-rent status?** — **Answer (Brad, 2026-09-22):** yes (Decision 6).
- [x] **Billing cadence and posture: calendar-month, prorated, advance/arrears, propose-only Draft invoices?** — **Answer (Brad, 2026-09-22):** ok (Decision 10).
- [x] **Deposits in scope?** — **Answer (Brad, 2026-09-22):** yes (Decision 13).
- [x] **v1 fleet scope: serialized units only?** — **Answer (Brad, 2026-09-22):** "that makes sense" + asked for the pros and cons of non-serial units. **Trade-off recorded:** *Pros of bulk units* — real fleets rent scaffolding, ladders, generators and other low-value gear as quantities (Wynne supports "serialized, bulk, or fixed assets"); no serial assignment burden at job completion; batch-tracked items could rent by quantity. *Cons in Carbon* — `fixedAsset` is a quantity-1 record, so bulk needs pool assets with proportional capitalization, partial disposal by fraction (#1041's `disposalFraction`) and per-unit NBV on return; on-rent becomes a count rather than a state, so "which unit is at which customer" is unanswerable and traceability, damage charging, recalls and maintenance all weaken — unacceptable for vehicles, normal for scaffolding; a cheaper alternative for such gear is to leave it in inventory and bill rental as a service (the Odoo model), which is wrong for long-lived assets. **Resolution:** serialized-only in v1; `fixedAsset.quantity` ships with a `= 1` CHECK and the transfer/agreement postings are written per unit, so a bulk pool is a phase that relaxes the CHECK and adds proportional math without touching the agreement, billing or revenue model.

Surfaced while writing (recommended, **pending veto**):

- [x] **N1 — Rental lines always defer, so rental revenue appears when the run posts rather than at invoice posting.** Alternative: the same-period expedient (credit revenue directly when the billed period equals the posting period). — **Answer (Brad, 2026-09-22): accepted as recommended.** Recommendation was: always defer; one rule for advance and arrears, period-correct with the accrual, and the run is part of close anyway.
- [x] **N2 — Recognition vehicle is a `revenueRecognitionRun` Draft → Posted batch, not #1048's "Draft journal + hook on `postJournalEntry`".** — **Answer (Brad, 2026-09-22): accepted as recommended.** Recommendation was: run pattern (depreciation-run parity, no hook, approvable batch). #1048's later phases post through the same run.
- [x] **N3 — Rates are level for the term (no escalations / straight-line rent receivable in v1).** Originally also deferred day/week rates and 28-day cycles, which were folded in later the same day (see N12). — **Answer (Brad, 2026-09-22): accepted as recommended.** Recommendation was: yes; level payments make straight-line equal billing.
- [x] **N4 — Direct financing is unreachable in v1 (no third-party residual-guarantee input).** — **Answer (Brad, 2026-09-22): accepted as recommended.** Recommendation was: yes; the enum value exists for #1056.
- [x] **N5 — Return to inventory reactivates the serial as `Available` (not `On Hold`).** — **Answer (Brad, 2026-09-22): accepted as recommended.** Recommendation was: yes; the return inspection is recorded on the agreement before the transfer is possible.
- [x] **N6 — Rental income is a company default account, fleet balance-sheet accounts come from the class.** — **Answer (Brad, 2026-09-22): accepted as recommended.** Recommendation was: yes (no per-class income account until asked).
- [x] **N7 — Sales-Type lines require agreement currency = base currency in v1.** — **Recommended:** yes; FX remeasurement of the net investment belongs to #1050.
- [x] **N8 — `payment.salesOrderId` ships now alongside `rentalAgreementId` (the deposit branch is generic).** — **Recommended:** yes; it is #1048's own design and costs one column.
- [x] **N9 — Provider sync of Rental invoice lines (deferred-revenue credit) is resolved per provider at plan stage.** — **Recommended:** account-costed line to 2160 where the provider allows; otherwise exclude the document with a reason code and rely on the journals.

Added 2026-09-22 when the tier-1 items were folded in (recommended, **pending veto**):

- [x] **N10 — Job→asset journals use `sourceType 'Asset Transfer'` with `documentId = jobId` on both lines, not `'Job Receipt'`.** — **Recommended:** yes; the per-job WIP balance keys on `documentId = jobId`, and nothing was received to stock, so receipt reporting should not see it.
- [x] **N11 — This spec carries the #1041 make/CIP contract (class flag, `Under Construction`, cost ledger, attach-at-WIP-credit, complete-to-CIP, capitalization transfer).** — **Answer (Brad, 2026-09-22):** yes, and nothing is assigned to the external contributor — Phase B builds it in-house; the transfer table stays one table.
- [x] **N12 — Best rate is evaluated per billing period (ties to the larger unit); the day/week ladder applies to the 28 Days cycle only, Calendar Month bills the prorated month tier.** — **Recommended:** yes; per-period keeps every charge non-negative and known when cut, and matches the Texada outcome in practice.
- [x] **N13 — Early return inside an advance-billed period yields a negative Rental line; a unit on rent past `endDate` keeps billing at the same rates (holdover).** — **Recommended:** yes; signed invoice lines are already handled by posting, and holdover is what every rental operator expects.
- [x] **N14 — The work-center link is `fixedAsset.workCenterId` with a read-only capital-cost panel and no automatic machine-rate change.** — **Recommended:** yes; deriving rates is a costing-policy decision that belongs with standard costing.
- [x] **N15 — Out of service is two columns on `fixedAsset` with no maintenance-module integration in v1.** — **Recommended:** yes; the flag covers the daily need, and dispatch integration needs the maintenance module to accept assets as targets.
- [x] **N16 — The schedule/run substrate keeps the `revenueRecognition*` names.** — **Recommended:** keep for now and rename to a generic accounting schedule/run in the same PR that schedules lessee accounting or prepaid amortization, if either lands within the year. Brad did not opt into the rename when asked.

## Changelog

- 2026-09-23: Phases A–D built (plan Tasks 1–54; browser verification of B, C and D pending in Tasks 31, 46, 56). Plan-level decisions folded in:
  1. New journal source types `'Revenue Recognition'`, `'Asset Transfer'` and `'Lease'` ship `defaultEnabled: false` in `POSTING_POLICY` (this spec said `true`); the returns-types precedent that a new journal type never starts pushing to a customer's ledger unasked wins.
  2. Shared pure math lives in `packages/database/supabase/functions/shared/` (`revenue-schedule.ts`, `rental-billing.ts`, `lessor-lease.ts`), `YYYY-MM-DD` strings and integers only, re-exported to Node through `@carbon/utils`. `classifyLessorLease` lives in `shared/lessor-lease.ts`, not `accounting.utils.ts` as §4 says.
  3. Kysely writers shared by a route and an Inngest job live in `packages/database/src/` (`revenue-recognition.ts`, `rental-billing.ts`); human-triggered posting stays in `accounting.server.ts`.
  4. `rentalAgreement.taxPercent` added: rent lines are taxed at the agreement's rate, since no customer default tax exists.
  5. `rentalAgreementCharge.kind` added so a purchase option bills as a `'Purchase Option'` charge row, not a new table.
  6. Close task `sortOrder` 5 (ties fall back to name; existing rows are never renumbered).
  7. Job→asset branch of `complete_job_to_inventory`: assets and transfers are written at amount 0 right after the job status update and priced once the WIP journal exists; with accounting off they stay at cost 0.
- 2026-09-23: Deviations recorded in the plan's Execution notes, the ones that change this spec's design:
  - §1: a dated line's schedule is prorated by days, not equal months. The monthly proposal cron is `0 12 1 * *` so every timezone is past the month boundary. `post-sales-invoice` re-stamps posting and issue dates to today, so a back-dated invoice cannot be posted as dated from the UI.
  - §2: a job attached to an asset outside a construction-in-progress class is refused; a fractional-quantity or short serial job is refused rather than capitalizing a different count. Capitalizing stock into a CIP class also writes a `fixedAssetCipCost` row. A unit on rent cannot be taken out of service.
  - §3: billing periods run from the agreement start, not the line's delivery date; the daily pass rolls every live operating line's periods forward (open-ended and holdover). Cancel deletes the Pending lines (the line status enum has no Cancelled). An Accrual row is the accrued slice (billing period ∩ month ∩ on-rent days), accrued while no POSTED invoice covers it. An early-return credit writes negative Deferral rows instead of shrinking the originals. Rental revenue legs carry `documentType 'Rental Agreement'`. Activation does not check `revenueRecognitionEnabled`.
  - §4: `presentValue` returns `pvRent` alongside `pvPayments`, which includes a reasonably certain option (the plan's 32,871.02 pin was the rent alone). A 28 Days lease is valued over whole 28-day periods at annual × 28/365; a mid-month Calendar Month start values one fewer period than it bills. Commencement is fleet-only (activation refuses a line without a fleet unit), so the from-inventory leg is not built; a commenced unit's asset is Disposed, so the Fleet register reads Sold while it is on lease. Interest rows are written only with accounting on. A sales-type line never rolls holdover periods. A Purchase Option invoice marks the line Sold only when it is a Sales-Type line On Rent; VOID reverts it. Sales-type return before `endDate`, and cancel of a commenced sales-type line, are refused ("Early termination of a sales-type lease is a manual journal"); the residual goes to the class named "Rental Fleet" (else the class the unit left) or to inventory. The override audit entry is `entityType "rentalAgreement"` with the reason as a diff entry, written with the service role and only when audit logging is on. The net investment report counts principal once the run has posted the schedule line's interest.
  - Open follow-ups: MCP invoice-delete tools leave rental stamps behind; voiding a purchase-option invoice on a Closed agreement returns the line to On Rent; a posted final invoice with an unposted last interest month leaves the return's closing NI a month apart from the ledger; rental revenue legs are invisible to readers keyed on the invoice document type; intercompany elimination does not know the deferred-revenue or rental accounts; provider sync of Rental lines is unverified.
- 2026-09-22 (later): Folded in the tier-1 items from the likelihood-of-use ranking (Brad: "let's include all the 1's"): Make to Asset (the job→asset branch of `complete_job_to_inventory`) plus the #1041 CIP contract and the work-center link; the day / week / month rate ladder with per-period best rate and the 28 Days cycle (early-return adjustments, holdover); the out-of-service flag with the `In Maintenance` fleet status. New pending-veto items N10–N16.
- 2026-09-22: Created after research (`.ai/research/2026-09-21-sell-vs-rent-rental-revenue-recognition.md`) and Brad's answers to the eight open questions; nine questions surfaced while writing recorded with recommended answers pending veto. Phases #1048 (this is Phase 1), supersedes the lessor slice of #1056, defines the inventory→asset bridge for #1041.
