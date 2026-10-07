# Revenue Recognition, Rentals and Contracts

> Status: implemented (2026-10-07). Every Part is built and browser-verified, except one check in Part II: the email send and the "Recurring invoicing" digest have not been run against a live SMTP server (plan Part II, Task 21).
> Consolidated 2026-10-07 from the three specs below (each kept verbatim as a Part) plus the decisions that until then lived only in plans (Part IV) and the later changes that had no spec (Part V).
> Plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` (Parts I–VI).
> Run logs: `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`, `.ai/runs/2026-10-02-rental-invoice-automation.md`, `.ai/runs/2026-10-02-contracts.md`.
> Acceptance-criteria checklists are kept as written; an unticked box is a criterion, not an open task.

## Contents

| Part | Scope | Was |
|---|---|---|
| I | Revenue recognition and rentals | `.ai/specs/implemented/2026-09-22-revenue-recognition-and-rentals.md` |
| II | Recurring invoicing (rental invoice automation) | `.ai/specs/2026-10-02-rental-invoice-automation.md` |
| III | Contracts | `.ai/specs/2026-10-02-contracts.md` |
| IV | Period runs: one Draft per period, per-month journals, Reverse Run, the close checklist's run preview | decisions in plan Parts V and VI |
| V | Later changes: the rental agreement setup wizard; capitalization cost | no spec |

# Part I — Revenue recognition and rentals

> Was `.ai/specs/implemented/2026-09-22-revenue-recognition-and-rentals.md` ("Revenue Recognition Core + Rental Fleet (Sell vs. Rent Manufactured Units)"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

> Status: implemented (2026-10-04). Phases A–D built and browser-verified (`.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`); plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part I. Open questions resolved 2026-09-22 (N1–N6 accepted by Brad, N7–N16 recommended and not vetoed).
> Author: Claude (with Brad Barbin)
> Date: 2026-09-22
> Tracking issues: crbnos/carbon#1048 (revenue recognition — this spec is its Phase 1), crbnos/carbon#1056 (leases — this spec supersedes the lessor slice), crbnos/carbon#1041 (fixed assets — this spec defines the inventory→asset bridge the make/CIP work reuses), crbnos/carbon#1060 (program tracker)
> Research: `.ai/research/2026-09-21-sell-vs-rent-rental-revenue-recognition.md`
> Related specs: `.ai/specs/2026-07-04-revenue-recognition.md` (full ASC 606 model; its SSP allocation, arrangements and POC become Phases 2–3 on the substrate built here), `.ai/specs/2026-07-04-lease-accounting.md` (lessee accounting, modifications, IFRS 16 delta stay there), `.ai/specs/archived/2026-07-04-fixed-assets-completeness.md` (components / impairment / reclassification; its CIP scope is carried here), `.ai/specs/2026-07-04-close-automation.md` (propose-only posture this spec follows), `.ai/specs/2026-08-07-rma-module.md` (tracked-entity reactivation precedent)

### TLDR

A manufacturer that rents out a unit it built is a **lessor**. Under ASC 842 / IFRS 16 the rental is an **operating lease** unless it transfers control (bargain purchase option, term covering most of the economic life, PV ≥ substantially all of fair value…), in which case it is a **sales-type lease** — a financed sale. Carbon today can only sell: revenue posts in full at invoice, a built unit can never leave inventory except by shipment, and there is no rental document, no recurring invoicing, no deferred-revenue writer and no "at customer" state for a serial. This spec builds four things on one substrate, in the order the plan will sequence them:

1. **Revenue recognition core (Phase 1 of #1048 — "capture the amount")** — `accountDefault.deferredRevenueAccount` → seeded 2160 finally gets a writer; a per-line `revenueRecognitionSchedule` (deferral, accrual and lease-interest rows, each carrying its own debit/credit accounts); a `revenueRecognitionRun` Draft → Posted batch (depreciation-run pattern) posted as an *accounting* source under the period matrix; a monthly Inngest proposal; a seeded "Recognize revenue for the period" close task with a fail-closed evaluator; the straight-line-by-date-range method for any **Service** invoice line carrying service dates, active whenever `companySettings.accountingEnabled` is on (no separate flag) — lines without service dates post byte-identically to before. Arrangements, SSP allocation and cost-to-cost POC (the rest of #1048) attach to this schedule/run substrate later.
2. **Fleet capitalization bridge + Make to Asset** — `fixedAsset` gains `itemId`, `trackedEntityId`, `quantity`, `workCenterId` and an out-of-service flag; a `fixedAssetTransfer` document with a `sourceType` (Inventory / Job / Construction in Progress) and two postings: **Capitalize** (from stock: Dr asset / Cr Finished Goods at the unit's carrying cost, the serial consumed *into* the asset; from a job: Dr asset / Cr WIP at completion, the unit never touching inventory; from a CIP asset: Dr depreciating class / Cr CIP at the in-service date) and **Return to inventory at net book value** (the Tesla pattern) so a returned unit is sold gross through the normal sales flow. A job can target a fixed-asset class (one asset per serialized unit, created at completion) or an `Under Construction` asset (SAP AuC: the job's cost is swept to it at attachment and at completion) — the make/self-constructed scope of #1041, including "build it, then use it yourself" through the work-center link. The existing Fixed Asset sales-order line stays as the net gain/loss disposal path.
3. **Rental agreements (operating)** — a time-based `rentalAgreement` document in the sales module (customer, fleet units one serial per line, start / open-ended or end date, a day / week / month rate ladder with best-rate selection, **Calendar Month** or **28 Days** billing cycles, advance or arrears, refundable deposit, variable charges), lifecycle Draft → Active → Closed / Cancelled with line custody Pending → On Rent → Returned → Sold; fleet units can be taken **out of service** for maintenance, which removes them from availability without touching depreciation; a daily Inngest job proposes Draft sales invoices per due billing period using a new **`Rental`** invoice line type whose posting credits **Deferred Revenue** (never revenue directly); the recognition run releases it straight-line and accrues unbilled rent for arrears billing to **Contract Assets** so period revenue is right regardless of when the invoice is posted; deposits post to **Customer Prepayments** 2110 through a new deposit branch of `post-payment`.
4. **Sales-type leases (v1 per Brad)** — per-line ASC 842-10-25-2 classification with company thresholds and audited override; at activation the unit is derecognized (from inventory at carrying cost, or from the fleet at NBV), **Net Investment in Leases** is recognized at the PV of payments + residuals, revenue = PV of lease payments and cost of sales = carrying amount − PV of unguaranteed residual (selling profit at commencement), then an effective-interest schedule whose monthly interest income posts in the recognition run while each rental invoice reduces the net investment; purchase-option exercise and end-of-term residual return close the schedule.

Every posting is period-gated and immutable through the existing journal path; every new source type gets a `POSTING_POLICY` entry; no existing posting surface changes unless a Rental line or the rev-rec flag is present.

### Problem Statement

Verified in code on 2026-09-21 (details and line references in the research file's *Carbon Baseline*):

1. **Revenue is all point-in-time at invoice.** `post-sales-invoice` credits `accountDefault.salesAccount` with the full line total; account 2160 Deferred Revenue is seeded but mapped to nothing and written by nothing; `prepaymentAccount` 2110 is mapped but no posting path writes it. A 12-month service billed up front, or a month of rent billed in advance, books as revenue on day one.
2. **A built unit cannot become an asset.** `complete_job_to_inventory` receives serialized units into Finished Goods (Dr FG / Cr WIP at actual job cost) and there is **no path from inventory or a job to a `fixedAsset`** — the asset row has no item, serial or tracked-entity link. Registering a built vehicle manually leaves it in inventory and adds it against retained earnings a second time; the inventory tie-out and the fleet register can never agree.
3. **Nothing rental-shaped exists.** No line type, no time-based unit of measure or per-period price, no recurring or scheduled invoicing, no deposit on a document (`payment` has no document FK; `invoiceSettlement` can only target an invoice or memo), no "on rent / at customer" state (`trackedEntityStatus` is `Available | Reserved | On Hold | Consumed | Rejected | Scrapped`; shipped serials simply become Consumed), no lease classification, no net-investment schedule.
4. **The governing specs are unimplemented and mis-shaped for this use case.** #1048 models rentals-as-606 arrangements (wrong standard for a lessor); #1056 has the right lessor slice but is wrapped in lessee PV/IBR machinery and a multi-book dependency; #1041's narrowed "make" scope (job→CIP) has no written spec on the issue yet, and inventory→fleet was never part of it.

The customer-facing consequence: a vehicle maker that rents part of its output cannot show rented vehicles on the balance sheet, cannot bill them monthly without hand-typed invoices, and cannot recognize the revenue in the right month.

### Proposed Solution

#### 0. Phasing (one spec, four build phases; the plan sequences them)

| Phase | Delivers | Depends on |
|---|---|---|
| **A. Recognition core** | account defaults + seeds, `revenueRecognitionSchedule`, `revenueRecognitionRun/Line`, straight-line deferral on invoice lines with service dates (flag-gated), run posting, close task, monthly proposal, deferred-revenue waterfall | — |
| **B. Fleet bridge + Make to Asset** | `fixedAsset` item/serial/quantity/work-center/out-of-service columns, seeded *Rental Fleet* and *Construction in Progress* classes, `fixedAssetTransfer` + `post-asset-transfer` (capitalize from stock / attach job / capitalize CIP / return to inventory), the job→asset branch of `complete_job_to_inventory`, `fixedAssetCipCost`, fleet register view, tracked-entity attributes, work-center capital-cost panel | — (parallel with A) |
| **C. Rental agreements (operating)** | agreement tables + UI, item rate ladder, activation / delivery / return, Calendar Month + 28 Days billing periods with best-rate selection, daily invoice proposal, `Rental` invoice line posting (deferral + accrual + early-return credits), deposits, utilization report | A, B |
| **D. Sales-type leases** | classification + thresholds, PV / effective-interest utilities, commencement posting, interest in the run, purchase option, end-of-term residual, net-investment report | C |

Out of this spec (tracked elsewhere): SSP allocation, arrangements, contract modifications and POC (#1048 Phases 2–3); lessee accounting, remeasurements, disclosures package, IFRS 16 delta (#1056); components, impairment, class reclassification and CIP aging (#1041 follow-ons); bulk / non-serialized fleet units, anniversary billing cycles, payment escalations (straight-line rent receivable), maintenance-module integration for fleet units (dispatches, meter-based service intervals), MRP demand for fleet builds, FX remeasurement of the net investment, automatic machine-rate derivation from asset depreciation.

#### 1. Revenue recognition core (Phase A)

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

**Straight-line by date range (the Phase A method).** `salesInvoiceLine` (and `salesOrderLine`, copied on conversion) gain `serviceStartDate` / `serviceEndDate`. They belong to **Service** lines only: every Part (and Material, Tool, Consumable, Fixture) is a physical good, earned when it ships, so a bundle such as a machine with a year of support is two lines — the Part recognized at posting, the Service deferred — and the split is the price on each line (SSP allocation of a single bundle price is Phase 2–3). The line forms show the dates only on a Service line, the validators refuse them elsewhere (the invoice validator also admits `Rental`), the upserts null them elsewhere, and posting defers only a Service line. When `companySettings.accountingEnabled` is on and a posted Service line has service dates, `post-sales-invoice` credits `deferredRevenueAccount` instead of the revenue account for the **net-of-tax** line amount and writes one `Deferral` row per accounting period the range overlaps, amounts prorated by days (last row absorbs rounding so Σ rows = line amount exactly, `distributeRoundingResidual`). Rows are dated the period end. Lines without service dates, and every line when accounting is off, post exactly as today (AC #1); the Deferred Revenue account is only required when an invoice has a dated line. There is no separate revenue recognition flag — deferral is meaningless without a journal, so it follows `accountingEnabled`. `Rental` lines always go through the schedule. VOID reverses the journal and deletes the line's unposted rows; a posted row blocks the void with the standard reversal-only message.

**Run.** `revenueRecognitionRun` (`runId` readable, `periodEnd`, `status Draft | Posted`, `postedAt/By`) + `revenueRecognitionRunLine` (one per schedule row it will post, `amount`, `journalId`). Creating a run for a period selects every `Planned` row with `scheduledDate ≤ periodEnd` **and** synthesizes the period's `Accrual` rows (operating rental days not covered by a billed `Deferral` row) and due `Interest` rows. Posting (`postRevenueRecognitionRun`, Kysely transaction in `accounting.server.ts`, `getOrCreateAccountingPeriod(…, source: "accounting")` so Locked periods accept it and Closed reject) writes **one journal per run** (`sourceType 'Revenue Recognition'`, `postingDate = periodEnd`), lines grouped per schedule row with `documentType 'Invoice' / documentId = salesInvoiceId` for deferrals and `'Rental Agreement'` for accruals and interest, dimensions copied from the source invoice line (Customer / Item / Location), stamps `journalId` on lines and flips rows to `Posted`. Running twice for one period creates nothing the second time (rows are claimed by `runLineId`). Deleting a Draft run releases its rows. A "Repeat" action (depreciation-run parity) opens the next period.

**Proposal.** Inngest `revenue-recognition-proposal`, cron `0 6 1 * *`, per company (`scheduled/mrp.ts` fan-out pattern, one `step.run` per company): if the prior month has due rows and no run, create the Draft run. Propose-only, like every close-automation job.

**Close task.** Seed `periodCloseTaskDefinition` "Recognize revenue for the period" — `taskType 'Auto'`, `autoCheckKey 'unposted-revenue-schedules'`, `severity 'Warning'`, `isSystem`, `sortOrder` directly after "Post depreciation runs covering the period" — per company (reconciling migration) and in `seed-company`. The evaluator joins `computePeriodReadiness` (a key without an evaluator fails every close, so both land in one PR): fails when any `Planned` row is dated on/before the period end, any active operating rental line has un-accrued days in the period, or any `Interest` row for the period is unposted; a company with no dated lines and no agreements passes trivially.

**Sync.** `POSTING_POLICY` (`@carbon/ee`) gains `'Revenue Recognition'`: `representation: "journal"`, syncable, `defaultEnabled: true`. The rental *invoices* are documents and follow the AR document sync; their Rental lines have no item, so the provider mapper must send them as **account-costed lines to the deferred-revenue account** (Xero: any account code; QBO/Rillet: verified at plan stage — see Risks).

#### 2. Fleet bridge (Phase B)

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

**Capital projects build on this CIP (`.ai/specs/2026-10-03-projects.md`, branch `projects-wbs-research-spec`).** A Capitalize project is the front end for these CIP assets. It creates one `Under Construction` asset per final-asset WBS element on release. Its jobs use this spec's `job.fixedAssetId` path unchanged (no second job-to-CIP mechanism). *Place in service* calls `capitalizeCip` one-to-one per element. To stay compatible, keep these surfaces stable:
- the `fixedAssetCipCost` columns and its `sourceType` CHECK, which Projects widens with `'Timesheet'`, `'Project Issue'`, `'Charge'`, `'Reimbursement'` plus `projectId`, `wbsElementId` and `postCapitalization`;
- the `attachJob` / complete-to-CIP sweep;
- `capitalizeCip`'s one-asset-in, one-asset-out shape.

Late costs after capitalization (decided 2026-10-04) post to the now-Active asset as an addition to acquisition cost, depreciated over the remaining life. Projects owns that change, including moving Straight Line depreciation to a remaining-life basis.

**Work-center link.** `fixedAsset.workCenterId` (nullable FK, many assets → one cell, `ON DELETE SET NULL`) records which work center a self-built machine serves, mirroring `fixedAsset.locationId`. The work-center detail page gains a read-only **capital cost** panel (its assets, NBV, monthly book depreciation from the class method) and the asset form a work-center picker. Machine rates stay hand-typed in v1; the panel is what makes deriving them possible later. The docs callout that Carbon keeps no link between the two records becomes stale and is updated in the plan.

**Out of service.** `fixedAsset.outOfServiceSince` / `outOfServiceReason` (both set or both null). *Take out of service* (`update: accounting`, from the fleet register or the asset page; also a checkbox on the rental return form) removes a unit from availability without touching its accounting: depreciation continues, agreements cannot activate or deliver on it (the error names the reason), and the fleet status reads `In Maintenance`. *Return to service* clears both columns. A unit that is `On Rent` cannot be taken out of service — it is at the customer; work done there is a variable charge. Maintenance-module integration (dispatches, meter-based intervals from `meterIn`) is a later phase.

**Fleet register.** View `fleetAssets`: `fixedAsset` where `itemId IS NOT NULL` joined to item, tracked entity, work center and the active `rentalAgreementLine`, exposing `fleetStatus` in precedence order — `Sold` (Disposed by sale), `Returned to Stock` (Disposed by transfer), `Under Construction`, `On Rent`, `In Maintenance` (`outOfServiceSince` set), `Reserved` (Active agreement, line Pending), `Available` (Active / Fully Depreciated, none of the above) — plus `customerId` / `customerLocationId` of the active line, `outOfServiceReason` and NBV. Derived, never stored.

#### 3. Rental agreements — operating (Phase C)

**Placement.** Sales module (`sales.models.ts` / `sales.service.ts` / `sales.server.ts`, UI `sales/ui/Rentals/`, routes `x+/rental-agreement+/` and `x+/sales+/rental-agreements*`). The agreement is the customer-facing contract; postings live in edge functions and `accounting.server.ts`.

**Header** `rentalAgreement` (`rentalAgreementId` readable, sequence `RA`): `customerId`, `customerLocationId` (where the units live while on rent), `customerContactId`, `salesPersonId`, `locationId` (home warehouse), `status` (`Draft | Active | Closed | Cancelled`), `startDate`, `endDate` (NULL = open-ended / month-to-month; **required** when any line classifies Sales-Type; a unit still on rent past it is a **holdover** and keeps billing at the same rates until returned), `billingCycle` (`Calendar Month` — the month tier prorated by calendar days; `28 Days` — fixed 28-day periods from the line's start priced off the day / week / month ladder, thirteen per year), `billingTiming` (`Advance | Arrears`), `paymentTermId`, `currencyCode`, `exchangeRate`, `depositAmount` (refundable), `discountRate` (annual %, for classification PV and sales-type schedules; defaults from `companySettings.leaseDefaultDiscountRate`), `ownershipTransfers`, `specializedAsset`, `purchaseOptionAmount`, `purchaseOptionReasonablyCertain`, `notes`, audit, `customFields`.

**Lines** `rentalAgreementLine` — one **serialized fleet unit** per line (`quantity` fixed at 1 in v1): `fixedAssetId` (operating: required, Available), `itemId`, `trackedEntityId` (sales-type from stock: the serial to derecognize), `rateUnit` (`Day | Week | Month`, the unit's rate frequency) and `rate` (the unit's ONE rate — editable while Draft, starting from the customer's `customerItemRentalRate`, else its customer type's, else `itemRentalRate`, for that frequency, effective on the agreement start date; fixed at activation so a later price-list change never touches a live agreement. Amended 2026-09-28: v1 had a Best Rate / Fixed mode over a day / week / month ladder snapshotted from the item; Best Rate was removed), `fairValue` (default `itemUnitSalePrice.unitSalePrice`), `economicLifeMonths` (default class `usefulLifeMonths`), `guaranteedResidualValue`, `unguaranteedResidualValue`, `lessorClassification` (`Operating | Sales-Type | Direct Financing`, computed at activation, stored with `classificationOverride` + `classificationOverrideReason`, audit-logged), `status` (`Pending | On Rent | Returned | Sold`), `deliveredAt`, `returnedAt`, `meterOut`, `meterIn`, `returnNotes`, `initialNetInvestment`, `sellingProfit`.

**Charges** `rentalAgreementCharge` (variable payments: mileage overage, damage, delivery, cleaning): `rentalAgreementLineId`, `chargeDate`, `description`, `amount`, `taxPercent`, `salesInvoiceLineId` (set when billed). Recognized when billed — never deferred.

**Billing periods** `rentalBillingPeriod` (per line): `periodStart`, `periodEnd`, `days`, `rateUnitApplied`, `amount`, `isAdjustment`, `dueOn` (= `periodStart` for Advance, `periodEnd` for Arrears), `status Pending | Invoiced`, `salesInvoiceLineId`. Periods are cut by the agreement's cycle — **Calendar Month**: calendar months, `amount = monthRate × days ÷ days in the month` (a full month = the rate); **28 Days**: consecutive 28-day periods from the line's `deliveredAt` (or the agreement start), the last one cut at `returnedAt` or `endDate`. A 28 Days period bills the line's `rate` × the whole units of its `rateUnit` the period covers (`ceil(days ÷ unitDays)`, `rateCharge`); on a Calendar Month agreement a Daily or Weekly line bills the same way and a Monthly line is prorated as above (`periodCharge`, `shared/rental-billing.ts`, unit-tested). *(Amended 2026-09-28: the v1 Best Rate mode — cheapest tier per period — was removed with the ladder.)* Best rate is evaluated per period, never cumulatively, so a period's charge is always known when it is cut and never negative. Periods are generated on activation for the fixed term (or rolling one period ahead when open-ended), extended while a unit is on rent past `endDate` (holdover, same rates), and re-cut on return: an unbilled final period shrinks to `returnedAt`; a period already billed **in advance** gets a negative `isAdjustment` row for the difference between what was billed and the best-rate charge for the days actually used (a month tier already earned by a long stay yields no credit — the Texada rule). Persisting periods is what makes invoice generation idempotent and the waterfall exact.

**Lifecycle.**
- *Activate* (`post-rental-agreement`, type `activate`): validates each line (unit Available and in service; not on another active line — the error names the other agreement or the out-of-service reason), fixes the line's rates (its own, else the default ladder) onto it, locks classification (§4), generates billing periods, sets lines `Pending` (or `On Rent` when `deliveredAt` is given), header `Active`. Operating lines post **no journal**; the asset simply stops being Available.
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

#### 4. Sales-type leases (Phase D)

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

#### Design Decisions

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
| 10 | Billing | Calendar Month (prorated month tier) or 28 Days (thirteen per year, day / week / month ladder), advance or arrears, Draft invoices proposed daily, one invoice per agreement per cycle | Texada / point-solution convention (research §4); anniversary cycles later. **Propose-only superseded by Part II** (Draft Only / Post / Post and Email; charges split onto a held invoice when automating) |
| 11 | Rates | One frequency and one rate per line, starting from customer → customer type → item rate cards (`customerItemRentalRate`, `itemRentalRate`) and editable while Draft — not pricing rules, which price one unit with quantity breaks; Best Rate removed; a Daily / Weekly unit on a Calendar Month agreement bills the days / whole weeks (amended 2026-09-28); fixed at activation; best rate per billing period with ties to the larger unit; level for the term, escalations later | Odoo cheapest-line rule + Texada single-tier rule; per-period evaluation keeps every charge non-negative and known when cut; level payments ⇒ straight-line = billing, no straight-line receivable in v1 |
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
| 28 | Service dates scope | Service lines only (Rental lines carry their billing period); forms, validators, upserts and posting all enforce it | Brad 2026-09-23: every Part is a physical good earned at shipment; a Service item on its own line is what splits the bundle's revenue |

### Data Model Changes

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

### API / Service Changes

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

### UI Changes

- **Rental agreements** table (status, customer, units, next due, unbilled) + New form (cycle, timing, dates, deposit); detail page with Lines (fleet unit picker filtered to `Available` and in service, rate mode + the snapshotted day / week / month tiers, fair value / life / residual / classification chip with test results and override), Charges, Billing periods (days, tier applied, status, invoice link, adjustments flagged), Deposits (payments referencing the agreement), and actions Activate / Deliver / Return (with meter reading and an out-of-service checkbox) / Generate invoices / Close / Cancel with confirmation modals showing the journal preview for sales-type activation.
- **Fleet register** (`fleetAssets`): status badges Under Construction / Available / Reserved / On Rent / In Maintenance / Sold / Returned to Stock, NBV, customer, out-of-service reason; row actions Rent (opens New agreement pre-filled), Take out of service / Return to service, Return to inventory (NBV preview); header action **Build for fleet** (opens New job with the Rental Fleet class as the completion target).
- **Capitalize** modal from a serialized unit's row on the item inventory page: class (default Rental Fleet), date, cost preview from the layer, resulting asset id. **Job form** gains a *Complete to* selector (Inventory, a fixed-asset class, or an Under Construction asset), read-only once the job has a WIP balance. **Asset page** gains Attach job (CIP only), Capitalize (CIP only: target class + in-service date + journal preview), the CIP cost ledger tab, a work-center field, and the out-of-service actions. **Work-center page** gains the capital-cost panel (assets, NBV, monthly depreciation).
- **Revenue recognition runs**: list + Draft run detail grouped by type (Deferral / Accrual / Interest) and agreement or invoice, Post button, Repeat; **Waterfall** report (opening 2160 / 1145 balances, future periods); **Net investment** report; **Utilization** report with class filter and CSV export.
- **Sales invoice** line form: `Rental` type is read-only (generated), shows agreement / period / kind; Service and Part lines gain optional service dates (visible when the rev-rec flag is on). **Payment** form gains a Deposit-for picker (sales order or rental agreement). **Item** sales tab gains the rental rate ladder (day / week / month).
- Close drawer shows the new task through the checklist substrate. Flash messages on every transition (`.claude/rules/flash-system.md`).

### Acceptance Criteria

Numbers are USD, base currency, tax 0 unless stated; the *Rental Fleet* class is Straight Line, 60 months, 20 % residual.

- [ ] **Byte-identical when off.** With no service dates and no Rental lines, posting a sales invoice produces journal lines identical to today (revenue to `salesAccount`); no schedule rows exist.
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
- [ ] **Close task.** "Recognize revenue for the period" fails for October while a due `Planned` row, an un-accrued on-rent day or an unposted `Interest` row exists; passes after the October run posts; a company with no dated lines and no agreements passes.
- [ ] **Utilization.** For Q4 2026 VIN-001 reports 78 on-rent days of 92 (84.8 %) and dollar utilization = recognized rental income ÷ 42,000 annualized; CSV export matches the table.
- [ ] **Sync policy.** `POSTING_POLICY` has entries for `'Asset Transfer'`, `'Lease'`, `'Revenue Recognition'`; `pnpm --filter @carbon/ee typecheck` passes.
- [ ] **Hygiene.** `pnpm run generate:types`, scoped `typecheck` (erp, database, jobs, ee), `pnpm run lint`, unit tests for `spreadStraightLine`, `prorateByDays`, `bestRateCharge`, `generateRentalBillingPeriods`, `presentValue`, `classifyLessorLease`, `buildLessorSchedule` (incl. the numeric examples above) pass; the `complete_job_to_inventory` redefinition is forked from the newest migration and diffed against `origin/main` before merge; all migrations apply idempotently twice; every new table has four RLS policies; `pnpm db:check:datasets` and `pnpm db:check:backups` pass.

### Risks

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

### Open Questions

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

### Known gaps

Recorded at the Phase D close-out and still open:

- The MCP invoice-delete tools leave rental stamps behind.
- Voiding a purchase-option invoice on a Closed agreement returns the line to On Rent.
- A posted final invoice with an unposted last interest month leaves the return's closing net investment a month apart from the ledger.
- Rental revenue legs are invisible to readers keyed on the invoice document type.
- Intercompany elimination does not know the deferred-revenue or rental accounts.
- Provider sync of Rental lines is unverified.

#### Review notes (PR #1697, reconciled with the built code 2026-10-04)

The DDL in *Data Model Changes* is the design-time sketch; the built migrations are the source of truth.

- **Idempotency.** Built: every `CREATE TYPE` is inside an `IF NOT EXISTS (… pg_type …)` block, every `ADD VALUE` uses `IF NOT EXISTS`, and every `ADD CONSTRAINT` on an existing table is inside an `IF NOT EXISTS (… pg_constraint …)` block (`20261006220301_fleet-rental-lease-enums.sql`, `20261006220501_rental-agreements.sql`).
- **`rentalLeaseScheduleLine` RLS.** Decision: it stays on `company("sales", { read: "sales_view" })` in `packages/database/src/authz/manifest.ts`, the same as its parent `rentalAgreementLine`. The parent already holds the lease inputs (`classificationInputs`, `initialNetInvestment`) under `sales_*`, so moving the child alone to `accounting_*` would not narrow who can change them. The accounting net-investment report reads both tables. The app writes the schedule only in server functions over Kysely (activation, invoice posting, run posting). Gap: a user with `sales_update` can still write it directly through PostgREST, as with the parent.
- **`salesInvoiceLine_rental_check`.** Built: a `Rental` line needs `rentalAgreementLineId` and `rentalLineType` (the enum is `rentalInvoiceLineType`, not `…Kind`). Known gap: the check does not require `rentalBillingPeriodId` on a `Rent` line or `rentalAgreementChargeId` on a `Charge` line. The `salesInvoiceLine` rental columns and the `salesInvoiceLineId` stamps on `rentalBillingPeriod` / `rentalAgreementCharge` have no foreign keys. Only the generators write these columns. `payment.rentalAgreementId` does have its FK.
- **Audit columns.** Built: `revenueRecognitionRunLine`, `rentalLeaseScheduleLine` and `rentalBillingPeriod` all have `createdBy`, `createdAt`, `updatedBy` and `updatedAt`, as does every other table these migrations create.
- **One-day rental.** Decision: kept `endDate > startDate` (`rentalAgreement_dates_check` and the `isEndDateAfterStart` refine in `sales.models.ts`). A fixed-term agreement covers at least two calendar days, and a same-day fixed term cannot be entered.
- **Phase B and #1031.** The meta DAG makes #1041 depend on #1031. When Phase B was built, #1031's period lifecycle was already on main, and `post-asset-transfer` posts through `getAccountingPeriodForDate`. So the "—" in the §0 table means "nothing in this spec", not "no upstream dependency".
- **Editing a generated Rental line.** Built: `SalesInvoiceLineForm` renders a read-only `RentalInvoiceLineSummary` for a `Rental` line, so its `unitPrice` cannot be edited in the UI. This replaces the Risks row that allows edits. Known gap: the line `details` action does not refuse a direct POST for a `Rental` line.
- **Rate tiers.** Built: a line bills one rate (`rateUnit` and `rate` NOT NULL, `rentalAgreementLine_rate_nonnegative`). The `rateMode` / Fixed design is gone, and with it the null-tier case. Known gap: `itemRentalRate_tier_check` and `customerItemRentalRate_tier_check` require at least one tier but do not refuse a negative one. Only the zod validators (`min(0)`) do. A negative card rate still cannot reach billing, because the line's own check refuses it.

### Changelog

- 2026-10-04: Implemented; moved to `implemented/`. The branch's migrations were folded into one file per change: enums `20261006220301_fleet-rental-lease-enums.sql`; tables `20261006220201_revenue-recognition-core.sql`, `20261006220401_fleet-bridge.sql`, `20261006220501_rental-agreements.sql` (now also `customerItemRentalRate`, `rentalLeaseScheduleLine`, the single-rate line and the named SET NULL FKs), `20261006220601_serial-cost-layer.sql`; `complete_job_to_inventory` in `20261006221601_complete-job-to-asset.sql`; RLS in `20261006221501_revenue-recognition-rentals-contracts-rls.sql`. Migration names in the entries below are the pre-fold ones.

- 2026-10-04: Note added: capital projects (`2026-10-03-projects.md`) build on this spec's CIP asset, ledger, job sweep and `capitalizeCip`. Projects owns the widened CIP sources, the late-cost rule and the remaining-life depreciation change.
- 2026-10-02: Decision 10's propose-only posture reversed for rentals by Part II.
- 2026-09-28: Merged main's authz manifest (#1737). The 11 new tables' policies moved out of the branch migrations into `packages/database/src/authz/manifest.ts` (`company("accounting", { read: "accounting_view" })` for the recognition and asset-transfer tables, `company("sales", { read: "sales_view" })` for the rental tables — the same policies as before), shipped by the generated `20260928014618_rental-revenue-recognition-rls.sql`. `20260928014435_complete-job-to-asset-guarded.sql` restores the Make to Asset branch of `complete_job_to_inventory`, which main's `20260925121735_rpc-function-guards.sql` had replaced, and adds that migration's `assert_company_access` guard.
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
  - §3: billing periods run from the agreement start, not the line's delivery date; the daily pass rolls every live operating line's periods forward (open-ended and holdover). Cancel deletes the Pending lines (the line status enum has no Cancelled). An Accrual row is the accrued slice (billing period ∩ month ∩ on-rent days), accrued while no POSTED invoice covers it. An early-return credit writes negative Deferral rows instead of shrinking the originals. Rental revenue legs carry `documentType 'Rental Agreement'`. There is no revenue recognition flag; deferral follows `accountingEnabled`.
  - §4: `presentValue` returns `pvRent` alongside `pvPayments`, which includes a reasonably certain option (the plan's 32,871.02 pin was the rent alone). A 28 Days lease is valued over whole 28-day periods at annual × 28/365; a mid-month Calendar Month start values one fewer period than it bills. Commencement is fleet-only (activation refuses a line without a fleet unit), so the from-inventory leg is not built; a commenced unit's asset is Disposed, so the Fleet register reads Sold while it is on lease. Interest rows are written only with accounting on. A sales-type line never rolls holdover periods. A Purchase Option invoice marks the line Sold only when it is a Sales-Type line On Rent; VOID reverts it. Sales-type return before `endDate`, and cancel of a commenced sales-type line, are refused ("Early termination of a sales-type lease is a manual journal"); the residual goes to the class named "Rental Fleet" (else the class the unit left) or to inventory. The override audit entry is `entityType "rentalAgreement"` with the reason as a diff entry, written with the service role and only when audit logging is on. The net investment report counts principal once the run has posted the schedule line's interest.
  - Open follow-ups: see Known gaps.
- 2026-09-22 (later): Folded in the tier-1 items from the likelihood-of-use ranking (Brad: "let's include all the 1's"): Make to Asset (the job→asset branch of `complete_job_to_inventory`) plus the #1041 CIP contract and the work-center link; the day / week / month rate ladder with per-period best rate and the 28 Days cycle (early-return adjustments, holdover); the out-of-service flag with the `In Maintenance` fleet status. New pending-veto items N10–N16.
- 2026-09-22: Created after research (`.ai/research/2026-09-21-sell-vs-rent-rental-revenue-recognition.md`) and Brad's answers to the eight open questions; nine questions surfaced while writing recorded with recommended answers pending veto. Phases #1048 (this is Phase 1), supersedes the lessor slice of #1056, defines the inventory→asset bridge for #1041.

# Part II — Recurring invoicing (rental invoice automation)

> Was `.ai/specs/2026-10-02-rental-invoice-automation.md` ("Rental Invoice Automation — post and email recurring rental invoices"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

> Status: in-progress
> Author: barbinbrad (with Claude)
> Date: 2026-10-02
> Research: `.ai/research/rental-invoice-automation.md`
> Amends: Part I Decision 10 ("propose-only Draft invoices") — reversed for rentals, see D1
> Shared layer (2026-10-02): this automation is the source-agnostic **recurring-invoicing layer** — one mode list (`invoiceAutomation`), one company default + per-document override, one pipeline in `packages/jobs/src/invoicing/` (`automateSalesInvoice`), one daily `recurring-billing` job and one "Recurring invoicing" digest. Rental agreements are its first source; AR contracts (Part III) plug in as the second and add the `Post and Send via Stripe` mode. Names were generalized before any code existed; behaviour for rentals is unchanged. Decisions: `.ai/runs/2026-10-02-contracts.md` (U1–U4, G4b, G7).

### TLDR

The daily `rental-billing` job drafts one invoice per rental agreement, and then someone has to open, post and email each one by hand, every billing cycle, for every agreement. This spec adds an **invoice automation** setting with three modes: `Draft Only`, `Post` and `Post and Email`. It is set company-wide on a new **Settings → Invoicing** page, defaults to `Post and Email`, and can be overridden per agreement. Rent invoices are posted (and emailed) in the same run that drafts them.

Anything that needs a human eye is left in Draft with a reason:
- hand-entered charges, split onto their own Draft invoice so the rent is never delayed;
- early-return credits;
- sales-rule violations;
- a missing required contact;
- posting failures such as a locked period.

An invoice whose contact has no email is posted and flagged, not sent. A daily notification tells each agreement's internal owner (salesperson, else creator) what was posted, emailed and held, with no setup; an optional "Also notify" group gets the company-wide summary. A voided invoice's re-bill is always held for review.

### Problem Statement

`packages/jobs/src/inngest/functions/scheduled/rental-billing.ts:56` says it plainly: "Posting stays a human action in the ERP; this only drafts invoices."

- A fleet of 40 agreements on calendar-month billing produces 40 Draft invoices on the 1st. Each one needs a person to open it, press Post, choose Email and confirm.
- The invoices are fully determined by the agreement's terms, so the human adds nothing on the normal path. The research found that every peer system lets that path run unattended: NetSuite bill runs, Business Central's Subscription Billing, Odoo, Xero "Approve for sending", QuickBooks "Scheduled" and Stripe `auto_advance`.
- Hidden bug on today's manual path: posting a rental invoice with Send Via = Email uploads the PDF to `${companyId}/opportunity/null/…`. Rental invoices have `opportunityId: null`, and the email branch of `$invoiceId.post.tsx:802` doesn't guard for it; only the Stripe branch does (`:85`). This spec fixes it as a side effect (D12).

### Proposed Solution

#### Flow

```
recurring-billing cron (05:00 UTC, per company step; renamed from `rental-billing`)
  └─ create-rental-invoices server function      (packages/server-functions/src/create-rental-invoices/)
       ├─ effective mode = agreement.invoiceAutomation ?? companySettings.invoiceAutomation
       ├─ Draft Only  → one Draft invoice per agreement (today's behaviour, unchanged)
       └─ Post / Post and Email →
            ├─ RENT invoice:    every due rent period (incl. early-return adjustments)
            │                   held when it re-bills a voided invoice's rows (D26) or carries an early-return adjustment
            └─ CHARGES invoice: every due charge (Charge + Purchase Option), always Draft,
                                automationHoldReason = "charges are reviewed before posting"
       returns [{ invoiceId, rentalAgreementId, mode, holdReason }]
  └─ per unheld invoice: step.run("automate-<invoiceId>") → automateSalesInvoice()
  └─ notify → one digest per agreement owner (salesPersonId ?? createdBy) + one company-wide digest to the "Also notify" group

automateSalesInvoice(invoiceId, mode)          (packages/jobs/src/invoicing/automate-invoice.ts)
  1. re-read invoice; skip unless status = Draft and automationHoldReason IS NULL
  2. contact requirement (checkPartyContactRequirement, moved to a package)  → hold on fail
  3. evaluateSalesRulesForSalesDocument("salesInvoice") — ANY violation           → hold
  4. claim: UPDATE status = 'Pending' WHERE status = 'Draft'   (0 rows → someone else has it; stop)
  5. invoke post-sales-invoice (service role, userId "system"); read status back
       not Submitted → reset Pending→Draft, hold with the function's error message
  6. raiseMoment("invoicing.salesInvoicePosted")
  7. mode = Post and Email:
       skip if sentAt IS NOT NULL
       contact email missing → sendError = "The invoice contact has no email" (stays posted)
       else render PDF + email → stamp sentAt / sentTo; on failure stamp sendError
```

"Generate Invoices" (`$id.invoice.tsx`) and "Sell to Customer" (`$id.$lineId.sell.tsx`) call the same generator. They then send `carbon/rental-invoice.automate` events for the invoices it returns. A small event-triggered Inngest function runs the same `automateSalesInvoice`. So pressing the button behaves exactly like the cron, minus the digest.

#### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Reverse "propose-only" for rentals | Yes, rentals only | The user asked for it (2026-10-02). Rental invoices are fully determined by the agreement's terms; the close-automation posture still governs every other proposal job |
| D2 | Modes | `Draft Only` / `Post` / `Post and Email`, a new enum `invoiceAutomation` | The three levels every peer system offers (research). `Post` without email serves customers billed through a portal or EDI |
| D3 | Where it is set | Company default (`companySettings.invoiceAutomation`, NOT NULL DEFAULT `'Post and Email'`) plus a nullable per-agreement override (`rentalAgreement.invoiceAutomation`, NULL = company default) | User decision. Follows the flat-default-plus-override shape `.ai/lessons.md` prescribes (`customer.defaultCc` → `companySettings.defaultCustomerCc`). No customer level (user decision) |
| D4 | Default | `Post and Email` | User decision. Rentals are not on `main`, so no existing company changes behaviour on deploy |
| D5 | `Post and Email` needs an email | The agreement override can only be SET to `Post and Email` when the agreement's contact has an email (the service refuses it; the UI disables it). At run time, a missing email degrades to post + `sendError`, never a skipped post | User decision. Checked at both ends because a contact's email can be removed after the setting is chosen, and a company default can't be validated per agreement |
| D6 | Review window | None. Posted in the same run that drafts | User decision. So there is no "will post on" date, and no "an edit makes it manual" rule |
| D7 | Charges | When automating, charges (kind `Charge` and `Purchase Option`) go on their OWN Draft invoice, held as "charges are reviewed before posting". Rent periods go on the rent invoice, which posts | User decision. A single charge must not delay the rent. Mirrors NetSuite's Ready/Hold billing stage and Point of Rental's contract hold. `Draft Only` agreements keep today's single combined invoice, since nothing is automated |
| D8 | Holds (left in Draft) | (a) charges invoice; (b) rent invoice carrying an early-return adjustment row; (c) a sales-rule violation of any severity, warnings included; (d) the company requires a customer contact and location and the invoice lacks one; (e) any posting failure (locked or closed period, missing account default, …), with the edge function's message | User decision (holds a–e; first invoice NOT held). The job can't acknowledge a warning, so a warning holds |
| D9 | First invoice | Not held | User decision. The terms were just reviewed at activation |
| D10 | Where automation runs | Inline in the `recurring-billing` cron (renamed from `rental-billing`, U4), one `step.run` per invoice; plus an event-triggered function for the two ERP buttons. Both call one `automateSalesInvoice` | Steps give per-invoice isolation and memoized retries (one failure never stops the run). Sharing one function keeps the button and the cron identical |
| D11 | Double-post protection | A conditional claim `Draft → Pending` before invoking (the `ramp-sync-bill.ts:179-215` pattern); the step re-reads status first, so a retried step after a successful post skips straight to email | `post-sales-invoice` never checks the invoice is Draft. The button event and the cron can race for the same invoice |
| D12 | PDF and email in a job | Extract the sales-invoice PDF data loading into a shared server loader in `@carbon/documents` (takes a supabase client). The ERP PDF route, the manual post route and the job all use it. Storage path is `${companyId}/sales-invoice/${invoiceId}/<file>` when the invoice has no opportunity, `opportunity/<id>/…` otherwise | The route loader needs a session (`requirePermissions` `view: sales`), so a job can't call it. Jobs already render `@carbon/documents` PDFs (`tasks/print-job/renderers.tsx`). Also fixes the `opportunity/null` bug on the manual path |
| D13 | Sender | From: `"<Company name>" <DEFAULT_FROM address>`. Reply-To: `companySettings.accountsReceivableEmail`, else the agreement's owner (`salesPersonId ?? createdBy`) email. To: the invoice contact. CC: `customer.defaultCc` ?? `companySettings.defaultCustomerCc`, plus the receivables email | User decision. Our SMTP can't send AS the customer's domain without SPF/DKIM, so we send from our domain under the company's name and route replies to receivables |
| D14 | Sent tracking | New `salesInvoice.sentAt`, `sentTo`, `sendError`. The manual post modal's Email path stamps them too | Needed for idempotency (never email twice on retry), for the "Needs review" filter, and so a person can see an invoice went out. Stamping on the manual path keeps one meaning for the columns |
| D15 | Hold reason storage | `salesInvoice.automationHoldReason TEXT` (a human-readable message) | Read-only display data; the reasons are open-ended (edge-function errors), so an enum would lose the message. Only meaningful while Draft. Kept after a manual post as history and ignored by the filter |
| D16 | Notification | A new digest event `NotificationEvent.RecurringInvoicing` (documentIds-shaped), at most once per recipient per cron run when anything was posted, emailed or held. **By default each agreement's internal owner (`salesPersonId ?? createdBy`) gets a digest of their agreements' invoices; no setup needed.** `companySettings.invoiceNotificationGroup` (`text[]`, users/groups) is "Also notify": those people get the company-wide digest, and an owner listed in it gets only that one. Delivered in-app and by email | User decisions (daily notification; "a good default should be automatic invoices with notifications to the internal person"). The button path sends none; the person who pressed it is looking at the result |
| D17 | Settings page | A new `x+/settings+/invoicing.tsx`, with a nav entry in `useSettingsSubmodules`. Cards: **Recurring Invoices** (default mode), **Receivables Email** (`accountsReceivableEmail`, which has no UI today), **Notifications** (`invoiceNotificationGroup`), plus **Emails** (default customer CC) and **Centralized Billing Address** MOVED from `settings+/sales.tsx` with their intents and actions | User decision (new page; move the invoice-related cards) |
| D18 | Agreement override editable when | Draft and Active (not Closed / Cancelled), through a dedicated service `updateRentalAgreementInvoiceAutomation` and a dedicated `intent` in `x+/rental-agreement+/update.tsx` that bypasses the Draft-only terms guard | It is an operational preference, not a lease term, and touches no accounting. `updateRentalAgreement` stays Draft-only (it is an MCP tool with its own guard) |
| D19 | Multi-tenancy (heuristic 1) | No new tables. New columns sit on `companySettings` / `rentalAgreement` / `salesInvoice`, all already company-scoped | — |
| D20 | Service shape (heuristic 2) | `updateRentalAgreementInvoiceAutomation(client, …)` returns `{data, error}` and refuses with a PostgrestError-shaped `RENTAL_INVOICE_EMAIL_NO_CONTACT`, like the other `RENTAL_*` codes | Matches the rental service conventions in sales AGENTS |
| D21 | RLS (heuristic 3) | Unchanged. The new columns inherit their tables' policies; the job writes with the service role | — |
| D22 | Permissions (heuristic 4) | Settings → Invoicing: `view: settings` to load, `update: settings` to save (as `settings+/sales.tsx`). The agreement override: `update: sales` | Same scopes as the pages the cards move from |
| D23 | Forms (heuristic 5) | Settings cards are `ValidatedForm` + fetcher intents like `settings+/sales.tsx`. The agreement field saves through the properties-panel pattern | Existing patterns |
| D24 | Module layout (heuristic 6) | Validators in `settings.models.ts` / `sales.models.ts`, services in `settings.service.ts` / `sales.service.ts`. The automation itself lives in `packages/jobs/src/invoicing/` (not an ERP module) | One service/models file per module |
| D25 | Backward compatibility (heuristic 7) | `updateRentalAgreement` (MCP) unchanged. The new service becomes an MCP tool (regenerate the MCP metadata). `checkPartyContactRequirement` moves from `apps/erp/app/modules/settings/party-contact.server.ts` to a package the job can import (`@carbon/database` or `@carbon/ee/rules.server`, to be settled in /plan), and the ERP re-imports it | Nothing frozen is touched |
| D26 | Re-billing after a VOID | VOID stamps `voidedSalesInvoiceId` on the periods and charges it releases; when automating, a rent invoice re-billing any such row is held with "Re-billing INV-…, which was voided". The stamp survives a deleted draft and is overwritten by a later VOID | User decision. Otherwise the next morning's run re-posts and re-emails the same amounts nobody decided to re-bill (an Active agreement's rates are locked) |

### Data Model Changes

One migration (`pnpm db:migrate:new rental-invoice-automation`):

```sql
CREATE TYPE "invoiceAutomation" AS ENUM ('Draft Only', 'Post', 'Post and Email');

ALTER TABLE "companySettings"
  ADD COLUMN "invoiceAutomation" "invoiceAutomation" NOT NULL DEFAULT 'Post and Email',
  ADD COLUMN "invoiceNotificationGroup" TEXT[] NOT NULL DEFAULT '{}';

-- NULL = use the company default
ALTER TABLE "rentalAgreement"
  ADD COLUMN "invoiceAutomation" "invoiceAutomation";

ALTER TABLE "rentalBillingPeriod" ADD COLUMN "voidedSalesInvoiceId" TEXT;
ALTER TABLE "rentalAgreementCharge" ADD COLUMN "voidedSalesInvoiceId" TEXT;

ALTER TABLE "salesInvoice"
  ADD COLUMN "automationHoldReason" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "sentTo" TEXT,
  ADD COLUMN "sendError" TEXT;
```

- The `rentalAgreements` view is recreated so it exposes `invoiceAutomation` and the effective mode (`COALESCE(ra."invoiceAutomation", cs."invoiceAutomation")`). Fork the body from its LATEST definition (lesson: backdated view forks).
- `salesInvoices` is recreated only if the list's "Needs review" filter needs a derived column. Prefer filtering on the base columns.
- `accountsReceivableEmail` already exists (`20260304112615`). No change.
- After migrating: `pnpm run generate:types`; `pnpm db:check:datasets` (the satellite dataset seeds rental agreements); `pnpm db:check:backups`.

### API / Service Changes

**`packages/server-functions/src/create-rental-invoices/`** (was `packages/database/src/rental-billing.ts`)
- `createRentalInvoicesForDuePeriods` reads the effective mode per agreement (one join to `companySettings`). When the mode is not `Draft Only` it drafts up to two invoices: rent and charges. It returns `{ invoices: { invoiceId, rentalAgreementId, mode, holdReason }[] }`; keep `invoiceIds` for existing callers or migrate them.
- Rent invoices with an `isAdjustment` row are stamped with the early-return hold.
- Stamping and idempotency are unchanged: periods and charges are stamped in the same transaction.

**`packages/jobs/src/invoicing/automate-invoice.ts`** (new)
- `automateSalesInvoice({ client, db, companyId, invoiceId, mode })` returns `{ outcome: "posted" | "emailed" | "held" | "skipped", reason? }`. The flow is above.
- The hold-reason strings are constants exported from one module, so the UI and tests share them.

**`packages/jobs/src/inngest/functions/scheduled/rental-billing.ts`**
- After the draft step: one `step.run` per unheld invoice, then a `notify` step.

**`packages/jobs/src/inngest/functions/tasks/invoice-automate.ts`** (new)
- Event `carbon/rental-invoice.automate` with `{ companyId, invoiceId }`. Concurrency key `event.data.invoiceId`, limit 1.
- Register it in `packages/jobs/src/inngest/index.ts` and add the event to the client schema.

**`@carbon/documents`**
- A server-side sales-invoice loader, `loadSalesInvoiceDocument(client, companyId, invoiceId)`, returning the `SalesInvoicePDF` props and the `SalesInvoiceEmail` props.
- `routes/file+/sales-invoice+/$id[.]pdf.tsx` and `$invoiceId.post.tsx` switch to it.

**`$invoiceId.post.tsx`**
- Uses the shared loader and the opportunity-or-invoice storage path (D12).
- Stamps `sentAt` / `sentTo` / `sendError` on the Email path.

**`apps/erp/app/modules/sales`**
- `updateRentalAgreementInvoiceAutomation(client, { id, companyId, invoiceAutomation, updatedBy })` (`/** @mcp update */`). Allowed on Draft and Active. Refuses `Post and Email` when the agreement's contact has no email.
- Add `invoiceAutomation` to the validators.

**`apps/erp/app/modules/settings`**
- Validators and services for `invoiceAutomation`, `invoiceNotificationGroup` and `accountsReceivableEmail`. `updateAccountsReceivableEmail` already exists, at `settings.service.ts:1361`.

**`$id.invoice.tsx` / `$id.$lineId.sell.tsx`**
- After generating, send one `carbon/rental-invoice.automate` event per unheld invoice. The flash says "Invoices generated and being posted" when any were sent.

**`@carbon/notifications`**
- `NotificationEvent.RecurringInvoicing` plus its text: "Recurring invoicing: N posted, M emailed, K need review".

### UI Changes

**Settings → Invoicing (new page)**
- **Recurring Invoices** card: a select (Draft only / Post / Post and email) with the description "What happens to rental invoices when they're created each day. Invoices with charges, early-return credits or rule violations always wait for review."
- **Receivables Email**: an email input. Description: "Replies to emailed invoices go here, and it's copied on each one."
- **Notifications**: a users/groups picker, "Who gets the daily rental invoicing summary".
- **Emails** and **Centralized Billing Address**: moved verbatim from Sales settings.

**Rental agreement properties panel**
- A new **Invoicing** select: "Company default (<mode>)" / Draft only / Post / Post and email.
- Post and email is disabled with the hint "Add a contact with an email to send invoices" when the contact has no email.
- When the effective mode is Post and email and the contact has no email: an inline note, "Invoices will be posted but not emailed — the contact has no email".
- Editable while Draft or Active.

**Rental agreement header and summary**
- The header's "Invoice" button becomes a secondary **Invoice Now**. Its dialog explains that invoices are created automatically every day, and the button is for billing right away, e.g. after adding a charge.
- Under "Next Due" the summary states the schedule: "Next invoice <date> is created automatically, then posted and emailed" (or "…then posted" / "…and left as a draft for review"). A Draft agreement reads "Invoices are created automatically once the agreement is active."

**Rental agreement details**
- The invoices list and Billing Periods card show a held invoice's reason, e.g. "Held: charges are reviewed before posting".

**Sales invoice header**
- A Draft invoice with `automationHoldReason` shows a warning badge with the reason.
- A posted invoice shows "Emailed to x@y on <date>", or the `sendError` with a "Send" action that opens the existing post/send modal's email path.

**Sales invoices list**
- A **Needs review** saved filter: Draft with a hold reason, or posted with `sendError` and no `sentAt`.

Follow the `carbon-design` skill for badge and filter conventions. Wrap all strings in Lingui and run `/translate`.

### Acceptance Criteria

- [ ] With the company default `Post and Email`, an Active Calendar-Month agreement whose contact has an email and one due rent period produces, after the cron runs: one sales invoice in `Submitted`, a posted journal, `sentAt` set, and an email to the contact. The email is from "<Company> <no-reply@…>" with Reply-To = the receivables email and the PDF attached at `${companyId}/sales-invoice/<id>/…`.
- [ ] The same agreement set to `Draft Only` produces one Draft invoice holding rent and charges together (today's behaviour), and nothing is posted.
- [ ] With a due rent period and a hand-entered damage charge on a `Post` agreement, the cron produces two invoices: rent `Submitted`, charges `Draft` with the hold "charges are reviewed before posting".
- [ ] A rent invoice carrying an early-return adjustment row stays Draft with the early-return hold.
- [ ] A sales rule that warns on the customer leaves the invoice Draft with the rule's message as the hold reason.
- [ ] With the current accounting period Locked, the invoice ends `Draft` (not `Pending`) and its hold reason is the posting function's message.
- [ ] On a `Post and Email` company default where the contact has no email, the invoice is `Submitted`, `sentAt` is NULL and `sendError` = "The invoice contact has no email". It appears under **Needs review**.
- [ ] Setting an agreement's override to `Post and Email` when its contact has no email is refused (UI disabled; the service returns `RENTAL_INVOICE_EMAIL_NO_CONTACT`).
- [ ] Re-running the cron step for an invoice that is already `Submitted` with `sentAt` set posts and emails nothing. Pressing Generate Invoices while the cron automates the same agreement produces exactly one posted invoice (the claim test).
- [ ] With no notification group configured, an agreement's salesperson (or creator, when none) receives exactly one "Recurring invoicing" notification (in-app and email) per cron run that posted, emailed or held one of their invoices. A user added to "Also notify" additionally receives the company-wide digest, and never two digests for the same run.
- [ ] An Active agreement's header shows a secondary "Invoice Now" button, and its summary states when the next invoice is created and what happens to it, matching the effective mode.
- [ ] Voiding a posted rent invoice and then generating again produces a Draft rent invoice held as "Re-billing INV-…, which was voided"; nothing is posted or emailed. Deleting that draft and generating again holds it again.
- [ ] Posting a non-rental invoice manually with Send Via = Email stamps `sentAt`. A rental invoice posted manually with Email stores its PDF under `sales-invoice/<id>/`, not `opportunity/null/`.
- [ ] Settings → Invoicing shows the five cards. Settings → Sales no longer shows Emails or Centralized Billing Address, and their saves still work from the new page.
- [ ] Unit tests: the generator's split/hold decisions (pure helper) and `automateSalesInvoice`'s outcome per hold case (vitest, mocked clients).

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| An email is sent but the `sentAt` stamp fails, so an Inngest retry sends it twice | Med | Stamp `sentAt` in the same step immediately after `sendEmail` resolves. Give the email step `retries: 0` on the send itself and record `sendError` on any throw, so a human re-sends rather than the job |
| An invoice is stuck in `Pending` when the `invoke` call itself fails (network), since the edge function's own catch never ran | Med | `automateSalesInvoice` resets `Pending → Draft` (conditional on `Pending`) on any non-Submitted outcome before recording the hold |
| Posting an invoice nobody looked at with a wrong rate or tax | Med | Rates and tax were set on the agreement at activation. Charges and credits are held. `Draft Only` exists per agreement. VOID is available |
| `Post and Email` is the default, so a company's first rental invoice goes to a customer automatically | Low | Rentals are new and unreleased. The settings card and the agreement field both state the effective mode before activation |
| Rental lines' provider sync (Xero/QBO/Rillet) is unverified (parent spec risk) | Med | Unchanged by this spec; automation only makes posting more frequent. Track it under the parent spec's open follow-up |
| Moving `checkPartyContactRequirement` to a package widens its import graph | Low | It only reads `companySettings`; /plan picks the package |
| Moving two Sales settings cards breaks muscle memory and links | Low | Settings search and nav cover it. Mention it in the changelog entry |

### Open Questions

> All resolved with the user on 2026-10-02 before this spec was written.

- [x] Can rental invoices be posted and sent automatically? — **Answer:** Yes. Research in `.ai/research/rental-invoice-automation.md`; posting reuses the `ramp-sync-bill` claim-and-invoke pattern, emailing needs the PDF loader extracted.
- [x] At what level is it configured? — **Answer:** A company-wide setting on an Invoicing settings page, overridden per agreement. No customer level.
- [x] Default mode? — **Answer:** `Post and Email`, selectable on an agreement only when its contact has an email.
- [x] Which invoices are held for review? — **Answer:** Charges (on their own invoice), early-return credits, purchase-option lines (they're charges), sales-rule errors AND warnings, a missing required contact, and locked/closed periods or any posting failure.
- [x] What if the contact has no email? — **Answer:** Post anyway, flag it (`sendError`), don't send. Record `sentAt` when sent. Send under the company's receivables email.
- [x] Review window before posting? — **Answer:** None; post immediately in the same run.
- [x] Where does the company setting live? — **Answer:** A new Settings → Invoicing page.
- [x] Who is the email from? — **Answer:** Carbon's default sender under the company name, Reply-To the receivables email (fallback: the agreement creator; refined 2026-10-02 to the owner, `salesPersonId ?? createdBy`), receivables CC'd.
- [x] How are charges handled? — **Answer:** On a separate Draft invoice for review; the rent posts on its own.
- [x] Hold the agreement's first invoice? — **Answer:** No.
- [x] How do people learn what happened? — **Answer:** Badges, a Needs review filter, AND a daily notification (recipients: a notification group on the Invoicing page, per the existing `*NotificationGroup` pattern).
- [x] Should Invoicing also take over the invoice cards from Sales settings? — **Answer:** Yes. Move Emails (default CC) and Centralized Billing Address.
- [x] Phase posting and emailing separately? — **Answer:** No; ship together.
- [x] What happens when a rental invoice is voided? — **Answer:** The re-bill is always a held draft (D26).
- [x] Who is notified by default? — **Answer:** Each agreement's internal owner (salesperson, else creator), with no setup; the settings group is "Also notify" (D16).

### Implementation decisions

Folded in from `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part II ("Plan-level decisions") and its execution log (`.ai/runs/2026-10-02-rental-invoice-automation.md`). Where these disagree with sections above, these win.

1. **Email goes out through `sendEmail` directly**, not `trigger("send-email")`: the queued job forces From to `DEFAULT_FROM` and only queues, so a delivery error would never reach `sendError`. The manual post route keeps `trigger("send-email")`, so its `sentAt` means "queued". A send with no SMTP transport stamps `sendError` ("Email sending is not configured"), never `sentAt`.
2. **`checkPartyContactRequirement` lives in `@carbon/lib`** (`./party-contact`, `./party-contact.server`); the ERP files re-export it.
3. **One sales-invoice document loader in `@carbon/lib`** (`./sales-invoice-document.server`: `loadSalesInvoiceDocument`, `renderSalesInvoicePdf`), used by the PDF route, the manual post route and the job. The job renders the PDF with internal-URL logos and swaps them for the public URL in the email HTML.
4. **"Needs review" is the `salesInvoices.needsReview` view column** plus a Receivables → Needs Review sidebar link.
5. **Send on a posted invoice with `sendError`** is `x+/sales-invoice+/$invoiceId.send.tsx`, firing `carbon/invoice.automate` with `mode: "Post and Email"`.
6. **The event carries an optional `mode`**; absent, the function resolves the invoice's agreement's effective mode.
7. **The split and hold decision is pure**: `planRentalInvoices` in `packages/utils/src/rental-invoice-plan.ts` (`@carbon/utils`; first written in `@carbon/database`), vitest-pinned.
8. **A re-bill after a VOID is always held** (D26): VOID stamps `voidedSalesInvoiceId` on the periods and charges it releases; sticky across a deleted draft.
9. **Owners are notified with no setup** (D16): each agreement's `salesPersonId ?? createdBy` gets one digest over their invoices; "Also notify" gets the company digest; an owner listed there gets only the company one.
10. **`automateSalesInvoice` is two functions**, `postSalesInvoiceUnattended` and `emailPostedInvoice` (`packages/jobs/src/invoicing/automate-invoice.ts`), so the cron and the `invoice-automate` function run them as separate memoized steps. A post failure resets the claim to Draft with the error as the hold reason; any email-step failure stamps `sendError`.
11. **Source-agnostic names in the shared layer** (grill U1): `INVOICE_SEND_NO_EMAIL`, `invoiceNotificationValidator` / `updateInvoiceNotificationSetting`, digest results keyed by `sourceId`.
12. **Posting is in-process** (2026-10-03, after main replaced the edge functions with Node server functions): the automation calls `post-sales-invoice` through `serverFns.system({ db, companyId, userId: "system" })`, so a failure's message comes back directly (no edge-function body to unwrap; `getEdgeFunctionErrorMessage` and `@carbon/lib/edge-function-error` are gone). The manual Post route keeps a Draft-only claim even though `assertPostable` admits Pending — an automation claim is a Pending row.
13. **Generator and run proposal are server functions** (2026-10-03, for consistency with main's server-functions rule — Kysely, multi-table, shared by the ERP and jobs): `create-rental-invoices` (`{ asOf, rentalAgreementId? }`, `update: sales` + `create: invoicing`) and `propose-revenue-recognition-run` (`{ periodEnd }`, `create: accounting`). The pure rental/lease/automation libs (`rental-periods`, `revenue-schedule`, `lessor-lease`, `rental-invoice-plan`) live in `@carbon/utils`, since nothing in `@carbon/database` needs them any more. `releaseRentalInvoiceStamps` moved into the ERP's `sales.server.ts`, its only caller.

### Changelog

- 2026-10-03: Implemented per the plan (Tasks 1–20); status in-progress pending browser verification. Implementation decisions folded in above.
- 2026-10-02 (later): The agreement says invoicing is automatic (summary schedule line, "Invoice Now" button). D16 notifies each agreement's owner by default (the group becomes "Also notify"); D26 holds re-bills after a VOID. Both were user decisions made while planning.
- 2026-10-02: Created. Questions resolved with the user before writing. Reverses Part I Decision 10 for rentals.

# Part III — Contracts

> Was `.ai/specs/2026-10-02-contracts.md` ("Contracts — AR contracts with independent billing and revenue schedules"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

> Status: Phase A implemented (2026-10-04, plan `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III); Phase B and the setup wizard implemented (2026-10-04, plan `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part IV)
> Author: Brad (with Claude)
> Date: 2026-10-02
> Research: `.ai/research/subscription-recurring-invoicing.md` (SAP, NetSuite, Business Central, D365 F&O, Acumatica, Odoo, Xero, QuickBooks, Stripe, Chargebee, Maxio; Rillet and Stripe API data models; Rillet's Contract screens)
> Interview record: `.ai/runs/2026-10-02-contracts.md` (Q1–Q11, U1–U4, G1–G9)
> Builds on: Part II (the shared recurring-invoicing layer — this spec is its second source), Part I (revenue recognition run, Contract Assets accrual, rental revenue posting model)
> Delivers from the billing side: the "revenue arrangement" of `.ai/specs/2026-07-04-revenue-recognition.md` Phases 2–3 (without SSP allocation)
> Supersedes: the earlier "Subscriptions" draft of this file (same path history)
> Coordinates with: `.ai/specs/2026-10-03-projects.md` (branch `projects-wbs-research-spec`) — its Phase 4 adds Time & Materials / Cost Plus lines; the two one-way doors it needs are taken here (project on the line; revenue *method*)

### TLDR

A **contract** is a new AR document in Sales for everything a customer buys as an agreement rather than a shipment: SaaS access, support and maintenance plans, implementation and setup fees, prepaid licences. Its **lines** are **One-time** or **Recurring** **Service** items, each with quantity, rate, discount %, tax, its own dates, a **project** (optional), and a **revenue method** (*Daily* or *Even per month*, prorated first & last) over revenue dates that default to the line's (a **go-live** date can push the start). A contract has two **independent schedules** built from the same lines:

- an **invoice schedule** — computed from the billing frequency (Week / Month / Quarter / Year), alignment (Anniversary or Calendar), timing (Advance / Arrears) and first invoice date, with one-time lines on the first invoice — that the user can **edit while Draft** (move, split, merge invoices; each line's billed total conserved);
- a **revenue schedule** — read-only, computed per line from its revenue method and revenue dates — with an **invoiced / recognized / deferred** summary per month.

Revenue follows the **line, not the invoice**: the monthly recognition run recognizes each line's schedule, releasing Deferred Revenue where it was billed ahead and accruing **Contract Assets** where it was earned first, and invoice posting relieves the accrual before deferring the rest — the rental revenue model, generalized. Due invoices are drafted daily by the shared **`recurring-billing`** job and handed to the shared **recurring-invoicing layer** (post / email / send via Stripe / hold / digest), with the company default automation mode and a per-contract override. Changes are **amendments** (a dated header with a reason and contract type, plus replacement lines), prorated from the change date or effective from the next period. **Cancel** picks an end date and can credit unused prepaid time as a credit memo. A fixed **term** renews automatically with an optional uplift %. Every contract and amendment carries a **contract type** (New Sales, Existing, Expansion, Reactivation, Contraction). Migrated contracts carry **Billed through** and **Recognize revenue from** dates. Contracts are created standalone or from chosen Service lines of a sales order. Rental agreements stay their own document and share the invoicing layer. Nothing on the AP side.

### Problem Statement

A customer moving all of its customer invoicing to Carbon needs one-off invoices (covered), rentals (covered by rental agreements, being automated by Part II), and **contracts** — which Carbon cannot express:

- No recurring-invoice, subscription, contract or copy-invoice feature exists in the sales or invoicing domain (verified; `@carbon/stripe` subscription code is Carbon's own plan billing).
- Rental agreements bill on a cycle but need a serialized fleet unit per line.
- Revenue is tied to the invoice: a Service line defers over its own service dates at posting. There is no way to bill $60,000 for implementation on signature and recognize it over the six months it is delivered, to recognize revenue earned before it is invoiced, or to see a contract's invoiced vs recognized vs deferred position.
- Every renewal, seat increase, discount expiry and cancellation is tracked outside Carbon.

Worked example used throughout: *Acme* signs on 15 October 2026 — implementation $60,000 one-time (revenue over 1 Nov–30 Apr, go-live 1 Nov), platform access 10 seats × $40 per Month with 20 % off the first year, premium support $1,200 per Year — invoiced Monthly, Calendar, in Advance, first invoice 1 November, 12-month term renewing at +5 %.

### Proposed Solution

#### Concepts

| Term | Meaning |
|---|---|
| **Contract** | The AR agreement header: customer, invoicing terms, schedule settings, term and renewal, contract type, migration dates, automation override. Readable id `CON000001`. |
| **Contract line** | A Service item, **One-time** or **Recurring**, with quantity, rate, discount %, tax %, start / end dates, revenue method, revenue start / end, go-live date, project. |
| **Project** | Optional: the existing accounting project (`project`, on main since `20260919153014_accounting-projects.sql`) on the contract as the default and on a line as an override. Every revenue-side journal line the contract line produces carries it as the Project dimension. |
| **Rate unit** | Recurring lines only: what the rate is per — Day, Week, Month, Quarter, Year. Independent of the billing frequency ($10 per Day invoiced Monthly). |
| **Billing frequency / alignment / timing** | Every Week / Month / Quarter / Year; *Anniversary* (from the start date) or *Calendar* (1st of week (Monday) / month / quarter / year, first period prorated); *Advance* (due on the period's first day) or *Arrears* (last day). |
| **Invoice schedule** | Persisted planned invoices (`customerContractInvoice`) and their lines (`customerContractInvoiceLine` — contract line, billing period, amount). Computed, then editable while Draft with each contract line's billed total conserved. |
| **Revenue method** | How a line earns revenue. The v1 methods are schedules: *Daily* (equal per day) or *Even per month, prorated first & last* (equal per calendar month, partial first/last months by days) — Rillet `DAILY` / `EVEN_PERIOD`. Deliberately a *method*, not a *pattern*: later methods — *As Invoiced* (time & materials) and *Percent Complete* (project contracts, cost-to-cost) — earn revenue without a schedule known up front and arrive as new enum values, not a rename. |
| **Revenue schedule** | The **per-line revenue ledger** (`customerContractRevenue`), one row per line per month. For the v1 schedule methods the rows are planned at confirmation from the method over the line's revenue dates. Later methods have the recognition run generate the month's row instead (*As Invoiced*: equal to the line's invoice lines posted in the month; *Percent Complete*: from cost progress, a catch-up landing in the next unposted month's row). Posting is the same either way. Read-only. |
| **Amendment** | A dated change (`customerContractAmendment`: date, reason, contract type, effective from *Change Date* or *Next Period*) whose replacement lines point at the lines they replace (`amendsLineId`). A billed line is never edited. |
| **Adjustment** | An invoice-schedule line correcting an already-billed recurring period when its line's end moved (amendment, cancellation), computed from the amount actually billed. |
| **Contract type** | New Sales, Existing, Expansion, Reactivation, Contraction — on the contract and on each amendment; suggested automatically, editable. |
| **Billed through / Recognize revenue from** | Migration dates: periods ending on or before *Billed through* were invoiced elsewhere (never drafted); revenue before *Recognize revenue from* belongs to the old books, after it Carbon releases the migrated Deferred Revenue balance. |

#### Lifecycle

`customerContractStatus`: **Draft → Active → Ended**.

- **Draft** — everything editable, including the invoice schedule. The invoice and revenue previews and the summary are live. Delete allowed.
- **Confirm** (`update: sales`; `create: invoicing` too when the effective automation mode posts) — validates (≥ 1 line, Service items only, dates consistent, invoice schedule conserves every line's total, Stripe customer linked when the mode is *Post and Send via Stripe* — the existing link step done once here), stamps `confirmedAt`, freezes the schedules, suggests the contract type (New Sales for a customer's first contract; Reactivation when all its earlier contracts ended). From now on changes go through amendments, cancellation and renewal.
- **Active** — the daily job drafts due invoices and the recognition run recognizes revenue. A cancelled contract stays Active until its end date passes and its last invoice is drafted; the header shows "Ends {date}".
- **Ended** — set by the daily job once the end date has passed and nothing is left to draft. `cancelledAt` / `cancellationReason` distinguish a cancellation from a term end. Read-only.

Delete is Draft-only. A confirmed contract with nothing invoiced or recognized can be cancelled back to nothing (end date before its start), which removes its planned invoices and revenue rows.

#### The invoice schedule

Pure math in `packages/database/supabase/functions/shared/contract-schedule.ts` (re-exported by `@carbon/utils`, unit-tested):

1. **Grid.** Frequency + alignment define period boundaries. Anniversary anchors on the contract start (a 29th–31st anchor clamps to the month's last day and returns to the anchor day when it exists — `@internationalized/date` `.add({ months })`); Calendar anchors on the 1st of the week / month / quarter / year containing it.
2. **Recurring lines** get one invoice-schedule line per grid period intersecting `[start, end]`, `units` = the period in the line's rate unit **prorated by day** (Day: days; Week: days ÷ 7; Month / Quarter / Year: whole calendar months ÷ 1 / 3 / 12 plus each partial month's days ÷ its days ÷ 1 / 3 / 12), `amount = round(quantity × rate × units × (1 − discount))` at internal scale. Due on the period's first (Advance) or last (Arrears) day.
3. **One-time lines** put their whole net amount on the first planned invoice on or after their start date.
4. **First invoice date** defaults to the first period's due date and can be set (e.g. invoice on signature before the service starts); periods due before it are gathered onto it.
5. **Editing (Draft only).** The user can move an invoice's date, split an invoice line into installments, merge invoices, and move a one-time line to a later invoice. Every edit must keep each contract line's billed total equal to its computed total (Rillet "redistribution only"); the preview shows the residual until it balances. Billing-period dates on lines stay the service window they cover, wherever the invoice lands.
6. **Horizon.** Fixed-term contracts are planned to their end date; open-ended contracts through the current period plus the next, rolled forward daily. Only planned rows can be edited, so an open-ended contract's edits reach as far as the horizon.
7. **Reconcile, never rewrite** (shared with rentals — the create / re-cut / adjust reconciliation extracted from `rental-billing.ts`, rental behaviour pinned by `rental-billing.test.ts`): a planned period whose line's end moved is re-cut; an already-invoiced recurring period that now extends past its line's end gets ONE adjustment = − (billed amount × days after the new end ÷ days billed); never a second one for the same period. An amendment regenerates the unbilled schedule from its effective date and warns that manual edits after that date are reset.
8. **Billed through.** Planned periods ending on or before it are created *Billed Externally* (no invoice). It must fall on a period end.

#### The revenue schedule

Per line, at confirmation (and on every amendment / cancellation / renewal), `customerContractRevenue` rows — one per calendar month — from the line's revenue method over `[revenueStart, revenueEnd]`:

- **Recurring lines** default revenue dates = the line's dates; the monthly amount follows the method over the same net value the invoice schedule bills for that span.
- **One-time lines** default revenue dates = the line's start and end (a one-time line with no end = recognized in the month of its start — point in time).
- **Go-live** (optional) moves the revenue start; the line's billing dates are unchanged.
- *Daily*: amount ∝ days in the month. *Even per month*: equal per full calendar month, first/last partial months prorated by days. Totals reconcile exactly (`distributeRoundingResidual`).
- Months before *Recognize revenue from* are not created (migration).
- The engine below reads only the rows, never the method — which is what lets a later run-generated method (*As Invoiced*, *Percent Complete*) reuse invoice posting, the recognition run and the contract position unchanged.

#### Accounting — revenue follows the line

Gated on `companySettings.accountingEnabled` (off → invoices post straight to revenue, as today). Generalizes the rental model (`post-sales-invoice/rental-posting.ts` `planRentalLine`, `synthesizeRentalAccruals`) from rental lines to contract lines, per contract line:

- **Invoice posting.** A sales-invoice line with `customerContractLineId` takes the contract branch (before the Service deferral branch): Cr **Contract Assets** up to the line's accrued-unbilled balance, the rest Cr **Deferred Revenue**; Dr AR. A negative adjustment line reverses in the opposite order (Dr Deferred Revenue up to the line's deferred balance, rest Dr Contract Assets).
- **Recognition run.** For each contract line and month ≤ the run's period, recognized revenue = the `customerContractRevenue` row: Dr Deferred Revenue up to the line's deferred balance, the rest Dr **Contract Assets** (earned, not yet billed); Cr the line's revenue account (the item's sales account). Rows post once (`journalId` / `postedAt` stamps), Planned → Posted, the existing revenue-recognition-run Draft → Posted lifecycle and close task.
- **Migration.** For months from *Recognize revenue from*, a line whose periods are *Billed Externally* draws its Dr from the migrated Deferred Revenue opening balance (the line's deferred balance is seeded with its externally-billed-but-unrecognized amount at confirmation, computed from the revenue schedule; the opening journal must have put that balance in Deferred Revenue).
- **Cancellation credit** (credit memo, below) posts Dr Deferred Revenue up to the line's deferred balance, the rest Dr Contract Assets / revenue for months already recognized beyond the end date (catch-up in the next run), and the line's future revenue rows after the end date are removed.
- **Project dimension.** Every revenue-side journal line a contract line produces — Contract Assets / Deferred Revenue at invoice posting, Deferred Revenue / Contract Assets / revenue in the recognition run, the cancellation credit — carries the line's project (`customerContractLine.projectId`, else `customerContract.projectId`) as the **Project** dimension, derived at posting like every other dimension (AR keeps the customer). Recorded from the first invoice because nothing can attach it later: the contract would be the only record of which project a line belonged to, and invoices already pushed to an accounting provider would not pick up a dimension added afterwards. It is what puts a project's billing revenue beside its costs (`2026-10-03-projects.md`). No project → posts exactly as without this.
- **Contract position** per line and month = invoiced (posted invoice lines), recognized (posted revenue rows), deferred = invoiced − recognized (Deferred Revenue when positive, Contract Assets when negative) — the summary on the contract and the input of a later ARR / waterfall report.

Foreign currency: the contract stores one `exchangeRate`, read from the company's rates when the contract is created or its currency is changed. Every invoice `create-contract-invoices` drafts, and the cancellation credit memo, carries that stored rate and posts at it, not at the rate of the invoice date. Revenue is computed in contract currency. The recognition run applies each month as a movement at the period end's rate (`get_exchange_rate`), and each pool carries base at a weighted-average rate, so a base difference on a cleared balance goes to realized exchange gain or loss (D3). FX remeasurement of the contract balance is out of v1.

#### Invoicing — the shared recurring-invoicing layer

Contracts are the second **source** of the layer defined in Part II:

- **Drafting.** `createContractInvoicesForDuePlannedInvoices(db, { companyId, asOf, customerContractId?, userId })` (`@carbon/database/contract-billing`), one transaction per contract: renewals (below), roll the horizon, then for each planned invoice due on or before `asOf` draft one Draft `salesInvoice` (customer, bill-to, invoice contact, payment term, currency, `customerReference` = the contract's PO number, `customerContractId`) with one line per planned invoice line: `invoiceLineType 'Service'`, the line's item, customer-facing description + the service window, quantity, `unitPrice` and `discountPercent` from the contract line, `taxPercent`, `serviceStartDate` / `serviceEndDate` = the billing period, `customerContractId`, `customerContractLineId`, `customerContractInvoiceLineId`. Stamps the planned rows *Invoiced* + `salesInvoiceLineId` (idempotent re-run).
- **Daily job.** The shared `recurring-billing` cron (renamed from `rental-billing` by the rental automation plan) runs, per company in an isolated step, every source's drafting — rental agreements, then contracts — and then `automateSalesInvoice` over every drafted invoice, sending one "Recurring invoicing" digest per owner (`salesPersonId ?? createdBy`) across both sources.
- **Mode.** `customerContract.invoiceAutomation` (nullable) overrides `companySettings.invoiceAutomation` (default *Post and Email*). This spec adds the mode **`Post and Send via Stripe`** to the shared `invoiceAutomation` enum and its branch to `automateSalesInvoice` (post, then the existing Stripe Connect send — Carbon stays the billing engine; never a Stripe Subscription). Rental agreements gain it too.
- **Contract holds** (the source declares them, as rentals declare charges and early-return credits): an invoice carrying a negative adjustment line; an invoice re-billing rows a VOID released (`voidedSalesInvoiceId` stamp on `customerContractInvoiceLine`, the rental D26 rule); and the shared holds (sales-rule violation, missing required contact, posting failure).
- **Recipients and sender** (shared rule): To the invoice contact, CC the customer's default CC (else the company default CC); From `"<Company name>" <DEFAULT_FROM>`; Reply-To `companySettings.accountsReceivableEmail`, else the contract owner (`salesPersonId ?? createdBy`).
- **VOID** of a contract invoice returns its planned rows to Pending and stamps `voidedSalesInvoiceId` (held on re-draft); **deleting** a Draft contract invoice un-stamps them (`releaseRecurringInvoiceStamps`, generalizing `releaseRentalInvoiceStamps`).
- **Invoice Now** on an Active contract runs drafting + automation for that contract now (`update: sales` + `create: invoicing`).

#### Amendments

**Amend** on an Active contract (`update: sales`) creates a `customerContractAmendment` (date, reason, contract type, effective from) with replacement lines — change quantity, rate, rate unit, discount, tax, description, revenue method / dates, project; add a line; end a line:

- *From the change date* (default): the old line ends the day before the effective date, the new line starts on it; recurring periods are prorated by day and already-billed advance periods adjusted from the billed amount; revenue rows of the old line after the effective date are removed and the new line's are added (prospective).
- *From the next billing period*: the effective date snaps to the first day of the next unstarted period; nothing is prorated.
- **Contract type** is suggested from the change in recurring value per period: up → Expansion, down → Contraction; editable.
- A **preview** shows the adjustment, the next invoices and the revenue change before saving.

A **time-limited discount** (20 % off the first year) is entered as the line's discount plus a scheduled amendment removing it at the date (created at confirmation from an optional "discount ends" date on the line).

#### Cancellation

**Cancel** (`update: sales`): end date (default the end of the current billing period, so nothing is credited), reason, and — only when the date falls inside a period already billed in advance — *Credit unused time*. Ends every open line, removes planned invoices and revenue rows after the date, and, when crediting, drafts one Draft customer **credit memo** (`memo.customerContractId`, amount = Σ the cancellation's adjustment rows, stamped `memoId`) posted through the contract branch of `post-memo` (above). Revertible until the end date passes and only while no credit memo has posted.

#### Renewal

A contract with a **term** (months; presets 6 months / 1, 2, 3 years / custom; or open-ended) and renewal *Renew* is extended by the daily job on its end date: end date + one term, an amendment of type **Existing** effective the new term's first day raising every open recurring line's rate by the uplift % (*From the next billing period*), new planned invoices and revenue rows. Renewal *End* lets it end.

#### Sales order → contract

**Create Contract** on a sales order (`create: sales`) offers its Service lines; the ticked ones become contract lines (One-time, or Recurring with a rate unit), with customer, payment term, currency and PO reference copied and `customerContract.salesOrderId` set. Those order lines are billed by the contract: the `convert` sales order → invoice skips order lines referenced by a contract line, and the order's invoiced rollup counts them as invoiced.

#### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | The document | A generalized AR **Contract** (`customerContract*`), replacing the Subscription draft | G2; Rillet Contract; contract = billing + revenue on the same lines |
| 2 | Rentals | Stay a separate document; share the recurring-invoicing layer; read-only upcoming-invoices preview; no schedule editing | G2, G4b — custody events re-cut the schedule, sales-type units must bill their valued schedule, rent automation needs determinism |
| 3 | AP side | Nothing; prepaid expenses and repeating supplier bills are a documented gap | G1; Rillet has none |
| 4 | Revenue types | One-time + Recurring, Service items only; goods on sales orders; usage later | G3, Q1 |
| 5 | Rate unit vs frequency | Separate (Day…Year vs Week…Year) | Q2, Q2b |
| 6 | Alignment / timing | Anniversary (default) or Calendar; Advance or Arrears; first invoice date | Q3, G4, Rillet invoicing |
| 7 | Proration | By day, exact | NetSuite / BC / Stripe convention |
| 8 | Invoice schedule | Persisted, computed, editable while Draft with per-line totals conserved | G4; Rillet invoice breakdown |
| 9 | Revenue | Per-line **revenue method** (v1: Daily / Even per month) over revenue dates (go-live); read-only schedule; invoiced / recognized / deferred summary. `customerContractRevenue` is the per-line revenue ledger — rows planned (schedule methods) or generated by the run (later methods) | G5; Rillet revenue step. Named *method* on 2026-10-03 so *As Invoiced* (T&M) and *Percent Complete* (project contracts, `2026-10-03-projects.md` Phase 4) are added enum values — renaming a column or enum after customer data exists breaks restoring older backups |
| 10 | Revenue engine | Revenue follows the line: recognition run releases Deferred Revenue or accrues Contract Assets; invoice posting relieves accruals first — rental model generalized | G5 settled-by-model; ASC 606 contract asset / liability |
| 11 | SSP allocation | None — each line's revenue is its own net price | Rev-rec spec Phase 2–3 allocation stays later |
| 12 | Discounts | Discount % per line; time-limited via a scheduled amendment | G8 |
| 13 | Changes | Amendment header + replacement lines; Change Date (prorated, default) or Next Period | Q6, Q11, G6; Rillet amendments |
| 14 | Adjustment basis | Amount actually billed × unused days ÷ billed days | Stripe flexible billing |
| 15 | Cancellation | End date (default end of period); optional credit memo | Q7, Q7b |
| 16 | Renewal | Optional term; Renew with uplift % (an *Existing* amendment) or End | Q8, G6 |
| 17 | Contract type | New Sales / Existing / Expansion / Reactivation / Contraction on contract + amendment, suggested, editable; ARR report later | G6 |
| 18 | Migration | *Billed through* + *Recognize revenue from*; Carbon releases the migrated deferred balance | Q10, G9 |
| 19 | Grouping | One invoice per contract per run | Q4 |
| 20 | Automation | Shared layer: company default + per-contract override; adds *Post and Send via Stripe*; contract holds (negative adjustments, VOID re-bills) | U1, U2, Q5 |
| 21 | Recipients / sender | Invoice contact, CC default CC; Reply-To AR email else owner | G7, U3 |
| 22 | Daily job | One `recurring-billing` job across sources, one digest per owner | U4 |
| 23 | Origin | Standalone + Create Contract from chosen sales-order Service lines (removed from the order's invoicing) | Q9, Q9b |
| 24 | Dimensions | No manual per-line dimensions — derived at posting as today. One source field is recorded: an optional **project** on the contract (default) and line (override), written as the Project dimension on the line's revenue-side journal lines | G7 settled-by-codebase; project added 2026-10-03 — a one-way door: revenue posted without it can never be attributed to a project, and project profitability (`2026-10-03-projects.md`) needs it from the first invoice |
| 25 | Module / naming | Inside `sales` (`sales.models.ts` / `.service.ts` / `.server.ts`, `ui/Contracts/`); tables `customerContract*`; UI "Contracts" | Heuristic 6; rental precedent; room for a supplier contract later |
| 26 | Multi-tenancy (H1) | `companyId` + `PRIMARY KEY ("id","companyId")` + `id('prefix')` on every table | conventions-database |
| 27 | Service shape (H2) | `client` first, `{data, error}`, MCP-safe guards (Draft-only edits, explicit field picks) | rental writers precedent |
| 28 | RLS (H3) | `company("sales", { read: "sales_view" })` per table in `authz/manifest.ts` + `authz migration` | authz-manifest rule |
| 29 | Permissions (H4) | CRUD / amend / cancel `sales_*`; confirm with a posting mode and Invoice Now also `create: invoicing` | rental Generate Invoices precedent |
| 30 | Forms (H5) | `customerContractValidator`, `customerContractLineValidator`, `customerContractInvoiceEditValidator`, `customerContractAmendmentValidator`, `customerContractCancelValidator`, `createContractFromSalesOrderValidator` | conventions-forms |
| 31 | Backward compatibility (H7) | Additive tables/columns/enum values; `post-sales-invoice` / `post-memo` / `convert` gain branches only for contract-linked rows | No FROZEN surface touched |

### Data Model Changes

Migrations: enums first (ADD VALUE rule), then tables; `pnpm db:migrate`, `pnpm --filter @carbon/database authz migration contracts-rls`, `pnpm run generate:types`.

```sql
CREATE TYPE "customerContractStatus"        AS ENUM ('Draft', 'Active', 'Ended');
CREATE TYPE "customerContractType"          AS ENUM ('New Sales', 'Existing', 'Expansion', 'Reactivation', 'Contraction');
CREATE TYPE "contractRevenueType"           AS ENUM ('One-time', 'Recurring');
CREATE TYPE "contractRateUnit"              AS ENUM ('Day', 'Week', 'Month', 'Quarter', 'Year');
CREATE TYPE "contractBillingFrequency"      AS ENUM ('Week', 'Month', 'Quarter', 'Year');
CREATE TYPE "contractBillingAlignment"      AS ENUM ('Anniversary', 'Calendar');
CREATE TYPE "contractBillingTiming"         AS ENUM ('Advance', 'Arrears');
CREATE TYPE "contractRenewal"               AS ENUM ('Renew', 'End');
CREATE TYPE "contractRevenueMethod"         AS ENUM ('Daily', 'Even Period');   -- later: 'As Invoiced', 'Percent Complete'
CREATE TYPE "contractAmendmentEffect"       AS ENUM ('Change Date', 'Next Period');
CREATE TYPE "contractInvoiceStatus"         AS ENUM ('Planned', 'Invoiced', 'Billed Externally');
ALTER TYPE "invoiceAutomation" ADD VALUE IF NOT EXISTS 'Post and Send via Stripe';  -- enum from the rental automation plan

CREATE TABLE "customerContract" (
  "id" TEXT NOT NULL DEFAULT id('con'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,                 -- readable, sequence 'customerContract' prefix CON
  "name" TEXT NOT NULL,
  "status" "customerContractStatus" NOT NULL DEFAULT 'Draft',
  "contractType" "customerContractType" NOT NULL DEFAULT 'New Sales',
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "invoiceCustomerId" TEXT REFERENCES "customer"("id"),
  "invoiceCustomerContactId" TEXT REFERENCES "customerContact"("id"),
  "invoiceCustomerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "salesPersonId" TEXT REFERENCES "user"("id"),
  "salesOrderId" TEXT,                                   -- origin
  "projectId" TEXT,                                      -- default Project dimension for every line (existing accounting project)
  "customerReference" TEXT,                              -- PO number → every invoice
  "closeDate" DATE NOT NULL,                             -- booking date
  "startDate" DATE NOT NULL,
  "endDate" DATE,                                        -- NULL = open-ended
  "termMonths" INTEGER CHECK ("termMonths" > 0),
  "renewal" "contractRenewal" NOT NULL DEFAULT 'End',
  "renewalUplift" NUMERIC NOT NULL DEFAULT 0 CHECK ("renewalUplift" >= 0),   -- fraction
  "billingFrequency" "contractBillingFrequency" NOT NULL DEFAULT 'Month',
  "billingAlignment" "contractBillingAlignment" NOT NULL DEFAULT 'Anniversary',
  "billingTiming" "contractBillingTiming" NOT NULL DEFAULT 'Advance',
  "firstInvoiceDate" DATE,
  "billedThrough" DATE,
  "recognizeRevenueFrom" DATE,
  "invoiceAutomation" "invoiceAutomation",               -- NULL = companySettings.invoiceAutomation
  "paymentTermId" TEXT REFERENCES "paymentTerm"("id"),
  "currencyCode" TEXT NOT NULL,
  "notes" JSONB,
  "confirmedAt" TIMESTAMP WITH TIME ZONE, "confirmedBy" TEXT REFERENCES "user"("id"),
  "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancellationReason" TEXT,
  "endedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContract_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContract_readable_key" UNIQUE ("customerContractId", "companyId"),
  CONSTRAINT "customerContract_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "customerContract_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1)
);

CREATE TABLE "customerContractAmendment" (
  "id" TEXT NOT NULL DEFAULT id('cona'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "amendmentDate" DATE NOT NULL,                         -- effective date after snapping
  "effect" "contractAmendmentEffect" NOT NULL DEFAULT 'Change Date',
  "contractType" "customerContractType" NOT NULL,
  "reason" TEXT NOT NULL,                                -- 'Renewal' for a renewal, 'Cancellation' for a cancel
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractAmendment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractAmendment_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE
);

CREATE TABLE "customerContractLine" (
  "id" TEXT NOT NULL DEFAULT id('conl'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "revenueType" "contractRevenueType" NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),         -- a Service item (service-layer check)
  "description" TEXT,                                     -- customer-facing
  "quantity" NUMERIC NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
  "rate" NUMERIC NOT NULL CHECK ("rate" >= 0),            -- price; per rate unit when Recurring
  "rateUnit" "contractRateUnit",                          -- Recurring only
  "discountPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("discountPercent" >= 0 AND "discountPercent" <= 1),
  "discountEndsOn" DATE,                                  -- schedules the removing amendment at confirm
  "taxPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "goLiveDate" DATE,
  "revenueMethod" "contractRevenueMethod" NOT NULL DEFAULT 'Daily',
  "revenueStartDate" DATE,                                -- default goLiveDate ?? startDate
  "revenueEndDate" DATE,                                  -- default endDate (one-time, no end = point in time)
  "amendmentId" TEXT,                                     -- the amendment that created it
  "amendsLineId" TEXT,                                    -- the line it replaces
  "salesOrderLineId" TEXT,
  "projectId" TEXT,                                       -- overrides the contract's project
  "sortOrder" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContractLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractLine_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLine_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "customerContractLine_rateUnit_check" CHECK (("revenueType" = 'Recurring') = ("rateUnit" IS NOT NULL)),
  CONSTRAINT "customerContractLine_amends_check" CHECK ("amendsLineId" IS NULL OR "amendmentId" IS NOT NULL)
);
CREATE UNIQUE INDEX "customerContractLine_salesOrderLine_key"
  ON "customerContractLine" ("salesOrderLineId", "companyId") WHERE "salesOrderLineId" IS NOT NULL;

CREATE TABLE "customerContractInvoice" (                   -- a planned invoice (the editable breakdown)
  "id" TEXT NOT NULL DEFAULT id('coni'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "status" "contractInvoiceStatus" NOT NULL DEFAULT 'Planned',
  "salesInvoiceId" TEXT,                                   -- stamp when drafted
  "isEdited" BOOLEAN NOT NULL DEFAULT FALSE,
  /* audit */ "createdBy" TEXT NOT NULL REFERENCES "user"("id"), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoice_pkey" PRIMARY KEY ("id", "companyId")
);
CREATE INDEX "customerContractInvoice_due_idx" ON "customerContractInvoice" ("companyId", "status", "invoiceDate");

CREATE TABLE "customerContractInvoiceLine" (
  "id" TEXT NOT NULL DEFAULT id('conil'),
  "companyId" TEXT NOT NULL,
  "customerContractInvoiceId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL,  -- service window covered
  "units" NUMERIC NOT NULL,
  "amount" NUMERIC NOT NULL,                               -- net of discount; negative for an adjustment
  "isAdjustment" BOOLEAN NOT NULL DEFAULT FALSE,
  "salesInvoiceLineId" TEXT,                               -- stamp (no FK, rental precedent)
  "voidedSalesInvoiceId" TEXT,                             -- re-bill hold (rental D26)
  "memoId" TEXT,                                           -- cancellation credit
  /* audit */ "createdBy" TEXT NOT NULL REFERENCES "user"("id"), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoiceLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractInvoiceLine_dates_check" CHECK ("periodEnd" >= "periodStart")
);

CREATE TABLE "customerContractRevenue" (                   -- per line per month, read-only
  "id" TEXT NOT NULL DEFAULT id('conr'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL,  -- a calendar month (or its covered part)
  "amount" NUMERIC NOT NULL,
  "status" "revenueScheduleStatus" NOT NULL DEFAULT 'Planned',   -- existing enum
  "journalId" TEXT, "postedAt" TIMESTAMP WITH TIME ZONE,
  /* audit */ "createdBy" TEXT NOT NULL REFERENCES "user"("id"), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractRevenue_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractRevenue_key" UNIQUE ("companyId", "customerContractLineId", "periodStart")
);

-- Provenance on existing tables (ON DELETE SET NULL FKs on (col, companyId) + indexes)
ALTER TABLE "salesInvoice"     ADD COLUMN "customerContractId" TEXT;
ALTER TABLE "salesInvoiceLine" ADD COLUMN "customerContractId" TEXT,
                               ADD COLUMN "customerContractLineId" TEXT,
                               ADD COLUMN "customerContractInvoiceLineId" TEXT;
ALTER TABLE "memo"             ADD COLUMN "customerContractId" TEXT;
-- Sequence 'customerContract' prefix 'CON' size 6 (seed + seed-company); view "customerContracts":
-- c.* + customerName, lineCount, recurringPerPeriod, contractValue, nextInvoiceDate,
-- invoicedToDate, recognizedToDate, deferredBalance.
```

RLS: each new table `company("sales", { read: "sales_view" })`. Backups: tenant tables discovered automatically; `pnpm db:check:backups` regenerates the manifest (no renames). Demo datasets: one Active contract per dataset (a one-time implementation line + two recurring lines) in the sales slice; coverage floors measured.

### API / Service Changes

- **Pure** — `shared/contract-schedule.ts`: `billingGrid`, `periodUnits`, `planInvoiceSchedule(contract, lines)`, `validateScheduleEdit(lines, plannedRows)` (per-line totals conserved), `revenueSchedule(line, method)`, `amendmentPlan(...)`, `cancellationPlan(...)`, `renewalPlan(...)`, `contractPosition(...)`; the reconciliation helper extracted from `rental-billing.ts`.
- **Database package** — `@carbon/database/contract-billing`: `createContractInvoicesForDuePlannedInvoices`, `confirmContract`, `applyContractAmendment`, `cancelContract`, `renewDueContracts` (Kysely, one transaction each); `releaseRecurringInvoiceStamps` generalizes `releaseRentalInvoiceStamps`; the revenue-recognition run's synthesizer list gains `synthesizeContractRevenue` (beside `synthesizeRentalAccruals`).
- **Jobs** — the shared `recurring-billing` cron and `automateSalesInvoice` (rental automation plan) gain the contract source and the Stripe branch.
- **Edge functions** — `post-sales-invoice`: contract branch (relieve Contract Assets, defer the rest, negative adjustments in reverse; the line's Project dimension on its revenue-side lines — also written by `synthesizeContractRevenue` and the `post-memo` contract branch); VOID: release + `voidedSalesInvoiceId` on contract rows. `post-memo`: contract branch. `convert`: skip contract-linked order lines.
- **ERP** (`sales.service.ts`, MCP tools with Draft-only guards): `getContracts`, `getContract`, `insertContract`, `updateContract`, `deleteContract`, `getContractLines`, `upsertContractLine`, `deleteContractLine`, `getContractInvoiceSchedule`, `updateContractInvoiceSchedule` (Draft, conserved totals), `getContractRevenueSchedule`, `getContractPosition`, `previewContract`. Server-only (`sales.server.ts`): confirm, amend, cancel, invoice now, create from sales order.
- **Routes** — `x+/sales+/contracts.tsx`; `x+/contract+/new.tsx`, `$id.tsx` shell, `$id.details.tsx`, `$id.lines.new.tsx`, `$id.$lineId.details.tsx`, `$id.schedule.tsx` (invoice-schedule edits), `$id.confirm.tsx`, `$id.amend.tsx`, `$id.cancel.tsx`, `$id.invoice.tsx`, `$id.delete.tsx`, `update.tsx`; `x+/sales-order+/$orderId.contract.tsx`.

### UI Changes

Built with the `carbon-design` skill. Creation is a five-step setup wizard (Details, Products, Invoicing, Revenue, Review — the five Rillet steps), at `/x/contract/:id/setup/<step>`. Brad chose the wizard on 2026-10-04; it replaces the original "one page, not a wizard" decision. After Confirm, a person works on the contract from the contract page (explorer + center + properties), like the rental agreement page:

- **Sales → Contracts** list: ID, name, customer, type, status, recurring per period, contract value, next invoice, invoiced / recognized / deferred, ends on.
- **Contract page** — header (status, *Confirm*, *Invoice Now*, *Amend*, *Cancel*, *Delete* while Draft); explorer of lines (*Add Line*: product picker, multi-select like Rillet's "Add to contract"); center sections:
  - **Summary** — lines as line items ("Implementation · one-time · $60,000", "Platform access · 10 × $40 per month · 20 % off until 31 Oct 2027"), contract value, recurring per period, next invoice.
  - **Invoices** — the invoice schedule (date, total, lines, status, sales-invoice link). While the contract is a Draft, this is the editable grid of the wizard's Invoicing step. It has one row per invoice, one column per line and a footer row of residuals.
  - **Revenue** — per line method, project and dates, the monthly schedule, and the **invoiced / recognized / deferred** table per month. While the contract is a Draft, this is the editable grid of the wizard's Revenue step. It has one row per month and one column per line.
  - **Amendments** — history with date, type, reason and changes.
- **Properties** panel — name, customer, bill-to, contact, sales person, project, close date, start + **duration** (6 months / 1, 2, 3 years / open-ended / custom) → end date, renewal + uplift, frequency, alignment, timing, first invoice date, billed through, recognize revenue from, invoicing (company default / Draft Only / Post / Post and Email / Post and Send via Stripe), payment term, currency, PO number, contract type, notes, custom fields.
- **Line form** — Service item, revenue type, description (customer-facing), quantity, rate (+ per rate unit when Recurring), discount % + ends on, tax %, start / end, go-live, revenue method + revenue dates, project (defaults from the contract).
- **Amend / Cancel modals** with previews (as specified above); **Create Contract** on sales orders; "From contract CON000012" links on invoices, lines and memos.
- **Settings → Invoicing** (rental automation plan) mode list gains *Post and Send via Stripe*.
- **Docs** — `docs/content/docs/reference/contracts.mdx` (`carbon-docs`), agent KB regenerated, glossary: *Contract*, *Contract type*, *Invoice schedule*, *Revenue method*, *Billed through*, *Amendment*.

### Acceptance Criteria

Worked example (Acme, accounting enabled):

- [ ] A Draft contract with implementation $60,000 one-time (revenue 1 Nov 2026–30 Apr 2027, Even Period), platform 10 × $40 per Month at 20 % off, support $1,200 per Year, Monthly / Calendar / Advance, first invoice 1 Nov, previews invoice 1 Nov = $60,420.00 (60,000 + 320 + 100) and $420.00 each month after; revenue preview for implementation = $10,000 per month Nov–Apr; summary for November: invoiced $60,420.00, recognized $10,420.00, deferred $50,000.00.
- [ ] Editing the schedule to split implementation into 3 × $20,000 on 1 Nov / 1 Dec / 1 Jan is accepted; moving $10,000 of it off the schedule is refused with the residual shown.
- [ ] After confirming, the daily job on 1 Nov drafts one invoice with three Service lines (service windows 1–30 Nov for the recurring lines, 1 Nov–30 Apr for implementation), and re-running drafts nothing; with the company default *Post and Email* it posts and emails the invoice contact (CC default CC, Reply-To the receivables email).
- [ ] Posting that invoice credits Deferred Revenue $60,420.00 (no Contract Assets yet); the November recognition run recognizes $10,420.00 (Dr Deferred Revenue / Cr each item's sales account).
- [ ] With the implementation billed later instead — 2 × $30,000 on 1 Jan and 1 Apr — the November and December runs each accrue $10,000 of implementation revenue to Contract Assets (earned, not billed); posting the 1 Jan invoice relieves the $20,000 accrual and defers $10,000, which the January run releases; no Deferred Revenue debit balance or Contract Assets credit balance ever appears.
- [ ] A line at $10 per Day invoices $310.00 for a 31-day month and $280.00 for February 2027.
- [ ] Anniversary alignment, start 15 March, monthly: invoices on the 15th, no proration; a 31 January anchor bills 28 February then 31 March.
- [ ] Amend on 12 March (platform 10 → 15 seats, *From the change date*, March billed $320 net): the next invoice carries −$206.45 (320 × 20/31) and +$309.68 (15 × 40 × 0.8 × 20/31) and the amendment is suggested as *Expansion*; *From the next billing period* produces no March lines.
- [ ] With 10 seats, the discount ends on 31 Oct 2027 (scheduled amendment) and the term renews the same day with a 5 % uplift: November 2027 bills platform at 10 × $40 × 1.05 = $420.00.
- [ ] Renewal on 31 Oct 2027 with uplift 5 %: end date extends 12 months, an *Existing* amendment raises recurring rates by 5 %; with renewal *End* the contract ends.
- [ ] Cancel effective 20 Sep with *Credit unused time* on a September billed at $420: a Draft credit memo for $140.00 (420 × 10/30); posting it debits Deferred Revenue; revenue rows after 20 Sep are removed.
- [ ] VOID of a posted contract invoice returns its planned rows to Pending; the next run re-drafts and holds it ("Re-billing INV-…, which was voided").
- [ ] An invoice containing a negative adjustment line is drafted and held for review regardless of the automation mode.
- [ ] *Post and Send via Stripe*: confirmation requires the Stripe customer link; the job posts and sends through Connect; failures leave a held Draft with the reason.
- [ ] Migrated annual contract (start 1 May 2026, Billed through 30 Apr 2027, Recognize revenue from 1 Oct 2026, one line $12,000 per Year invoiced Yearly in advance, revenue method Even Period): no invoice before 1 May 2027; the October run recognizes $1,000 from Deferred Revenue (the migrated opening balance); first Carbon invoice 1 May 2027.
- [ ] Contract type suggestions: a customer's first contract → New Sales; a customer whose earlier contracts all ended → Reactivation; a seat reduction amendment → Contraction.
- [ ] *Create Contract* from a sales order ticking only the platform line: invoicing the order bills only the remaining lines; the order completes when they are invoiced.
- [ ] A EUR contract posts with base translation; recognition rows post in base.
- [ ] A contract with project *P-100* and one line overriding it to *P-200*: the invoice's Contract Assets / Deferred Revenue lines and each recognition run's lines carry the Project dimension of their own line (P-100 / P-200), AR carries none; a contract with no project posts exactly as before.
- [ ] One company whose contract billing throws does not stop the `recurring-billing` run for other companies; rental billing behaviour and tests are unchanged after the shared extraction.

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Line-level revenue engine (accrue / defer per line) is new posting territory beyond rentals | High | Generalize the rental model already built and tested (`planRentalLine`, `synthesizeRentalAccruals`); per-line balance invariants in unit tests; journal balance assertions; worked-example tests above |
| Editable schedules break the conservation invariant | Med | Pure `validateScheduleEdit` on every save and at confirmation; DB-side check at confirm (Σ per line = computed total) |
| Amendments reset hand-edited future invoices | Low | Warn in the amendment preview; edits before the effective date are kept |
| Unattended posting / sending a wrong invoice | High | Shared-layer holds (negative adjustments, VOID re-bills, rule violations, posting failures); company default can be set to Draft Only; per-contract override |
| Migration revenue depends on the opening balance being in Deferred Revenue | Med | Confirmation shows the migrated deferred amount per line; a period-close check compares it with the Deferred Revenue balance |
| Two sources in one cron grow its runtime | Low | Per-company isolated steps (`.ai/lessons.md` tenant isolation); each source in its own step within the company |
| Scope overlap with the rev-rec spec Phases 2–3 | Med | This spec delivers the arrangement from the billing side without SSP; a scope note on `2026-07-04-revenue-recognition.md` points here |

### Delivery phases

Two plans, in order, each shippable (decided 2026-10-02; the rental invoice automation plan, which builds the shared layer, executes first):

- **Phase A — contracts, invoice schedule, invoicing.** *Implemented 2026-10-04* (`.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III; see the 2026-10-04 Changelog entry for the decisions that refine this spec). Everything except the line-level revenue engine: tables, contract page, lines, editable invoice schedule, amendments, cancellation + credit memo, renewal, contract types, discounts, migration *Billed through*, Create Contract from sales orders, the contract source in `recurring-billing`, contract holds, and the *Post and Send via Stripe* mode. Interim revenue: contract invoice lines post through the existing **Service-line deferral** — each line's service dates are its billing period, and a one-time line's service dates are its revenue dates — so revenue is right whenever billing is at or ahead of delivery (the common case). The revenue section shows the preview and summary computed from the schedule; *Recognize revenue from* and Even Period are accepted but only take effect in Phase B.
- **Phase B — revenue follows the line.** *Implemented 2026-10-04* (`.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part IV; see the second 2026-10-04 Changelog entry). Phase B leaves out the contract position view: the Revenue section of a confirmed contract still shows the preview. `customerContractRevenue`, the contract branch of `post-sales-invoice` / `post-memo` (relieve Contract Assets, defer the rest), `synthesizeContractRevenue` in the recognition run, Even Period, migrated deferred-balance release, the contract position view. Contract lines switch from the Service deferral branch to the contract branch; invoices already posted in Phase A keep their Service deferral rows (no restatement).

### Out of scope (v1)

Usage-based / metered lines; physical goods on contracts; SSP allocation across lines; ARR / MRR waterfall reports (contract type and position are captured for them); per-customer invoice consolidation; customer rate cards for contracts; trials, pausing and coupons; per-line manual dimensions; FX remeasurement of contract balances; Rillet recurring-revenue sync; anything on the AP side (prepaid expenses, repeating supplier bills); merging rental agreements into contracts.

### Open Questions

> All resolved with Brad on 2026-10-02 before this version was written (`.ai/runs/2026-10-02-contracts.md`).

- [x] **Line content** — **Answer:** Service items only (Q1), now One-time + Recurring (G3); usage later.
- [x] **Frequencies; rate unit vs rhythm** — **Answer:** rates per Day / Week / Month / Quarter / Year; invoiced every Week / Month / Quarter / Year (Q2, Q2b).
- [x] **Alignment** — **Answer:** Anniversary by default, Calendar optional (Q3).
- [x] **Grouping** — **Answer:** one invoice per contract per run (Q4).
- [x] **Automation** — **Answer:** the shared layer: company default + per-contract override, adding *Post and Send via Stripe* (Q5, U1, U2).
- [x] **Mid-term changes; when they take effect** — **Answer:** amendments prorated by day from the change date (default) or from the next period (Q6, Q11).
- [x] **Cancellation; credit form** — **Answer:** chosen end date (default end of period); optional credit memo (Q7, Q7b).
- [x] **Renewal** — **Answer:** optional term; Renew with uplift % or End (Q8).
- [x] **Origin; sales-order lines** — **Answer:** standalone + Create Contract from chosen Service lines, removed from the order's invoicing (Q9, Q9b).
- [x] **Migration** — **Answer:** Billed through (Q10) + Recognize revenue from, Carbon releasing the migrated deferred balance (G9).
- [x] **Reply-to; daily job** — **Answer:** AR email else owner; one `recurring-billing` job (U3, U4).
- [x] **AP side** — **Answer:** nothing for now (G1).
- [x] **Contract vs Subscription; rentals** — **Answer:** a generalized Contract; rentals stay separate (G2).
- [x] **Editable invoice schedule; for rentals?** — **Answer:** editable while Draft with totals conserved (G4); rentals get a read-only preview (G4b).
- [x] **Revenue per line** — **Answer:** Daily or Even per month over revenue dates with go-live; read-only schedule; invoiced / recognized / deferred summary (G5).
- [x] **Contract types** — **Answer:** New Sales / Existing / Expansion / Reactivation / Contraction, suggested and editable; reports later (G6, G6b).
- [x] **Recipients** — **Answer:** invoice contact + default CC (G7, G7b).
- [x] **Discounts** — **Answer:** discount % per line (G8).

### Changelog

- 2026-10-02: Created as "Subscriptions" after research and a 14-question interview.
- 2026-10-02: Re-scoped to **Contracts** after reviewing Rillet's Contract (G1–G9) and unifying with rental invoice automation into one recurring-invoicing layer (U1–U4): independent invoice and revenue schedules, editable invoice schedule, per-line revenue patterns and the line-level revenue engine, one-time lines, contract types, discounts, migration revenue; delivery, sender and the daily job now come from the shared layer.
- 2026-10-03: Two one-way doors taken for the Projects spec (`2026-10-03-projects.md`): an optional **project** on the contract and line, written as the Project dimension on revenue-side journal lines (amends decision 24); **revenue pattern renamed revenue method** (`revenueMethod` / `contractRevenueMethod`) and `customerContractRevenue` framed as the per-line revenue ledger, so *As Invoiced* and *Percent Complete* are later enum values rather than a post-data rename.
- 2026-10-04: **Phase A implemented** (`.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III, run log `.ai/runs/2026-10-02-contracts.md`). The plan refined this spec with 15 decisions. Brad reviewed them on 2026-10-03. He changed decision 3 to a real invoice line discount and confirmed decision 5.
  1. **No `customerContractRevenue` table in Phase A.** The Revenue section is a preview that `contract-revenue.ts` computes from the lines. The Service deferral of each invoice line posts the revenue.
  2. **The invoice schedule persists only after the first edit, or at Confirm.** While a Draft is unedited, the loader computes the schedule from the lines. The first edit writes the `customerContractInvoice` rows with `isEdited = true`. Confirm refuses an edited schedule that no longer conserves the total of each line.
  3. **Sales invoice lines get a real discount.** `salesInvoiceLine.discountPercent` is a fraction from 0 to 1, with generated `netUnitPrice` / `convertedNetUnitPrice`. It discounts the merchandise (`quantity × unitPrice`) only. Tax applies to the discounted merchandise. Every amount calculation applies it: the `salesInvoices` view, posting, documents, the ERP invoice UI, Stripe, the accounting providers and rental utilization. A contract invoice line carries the list `unitPrice` and the `discountPercent` of its contract line.
  4. **A contract credit memo posts to Deferred Revenue, not to Sales Discount.** `post-memo` debits Deferred Revenue up to the Planned deferral that it releases, and debits Sales for the remainder. It deletes or trims those Planned rows. `post-memo` refuses to void a contract memo.
  5. **The project is on `salesInvoiceLine.projectId`.** `post-sales-invoice` writes it as the Project dimension on the revenue-side journal lines. AR keeps the customer.
  6. **Rental reconciliation is not extracted.** Contracts have their own `reconcileContractSchedule` with the same adjustment rule. The rental files did not change.
  7. **A sales-order line that a contract takes gets `invoicedComplete = true`** when the contract is created. `deleteContractReleasingSalesOrderLines` and `deleteContractLineReleasingSalesOrderLine` release it when the user deletes the Draft contract or that contract line. `convert` did not change.
  8. **A row from reconciliation, or a line that starts mid-period, lands on the next regular invoice date.**
  9. **Recurring units count whole months from the period start, then days.** An Anniversary period such as 15 Mar–14 Apr is exactly 1 month. A partial Calendar period is its days ÷ the days of that month.
  10. **`rowPricing` prices a schedule row with two roundings at internal scale:** `unitPrice = round(rate × units)` and `amount = round(quantity × unitPrice × (1 − discountPercent))`. A row whose amount is not that product (a split installment, an adjustment) drafts as quantity 1 at its amount, with the discount in the description (`invoiceLinePricing`).
  11. **A cancellation stores what it changed** in `customerContractAmendment.previousState`, so *Revert cancellation* can restore it. `customerContractInvoiceLine.customerContractInvoiceId` is nullable for memo rows, with a CHECK that the row has an invoice or a memo.
  12. **Carbon suggests the contract type at creation, and the user can change it.** Confirm does not change it. The amendment preview suggests the amendment type from the change in recurring value per billing period.
  13. **The list shows contract value, invoiced to date and next invoice date from the `customerContracts` view.** The contract page computes the recurring value per period in TypeScript. Recognized and deferred amounts are Phase B.
  14. **The Stripe send moved into `@carbon/stripe`** as `sendPostedSalesInvoiceViaStripe` (`send-sales-invoice.server.ts`). The caller injects the mapping write, so `@carbon/stripe` has no commercial dependency.
  15. **Each demo dataset has one Active contract.**

  This spec predates the move from edge functions to Node server functions. The table maps the names in this spec to the code:

  | Spec says | Code |
  |---|---|
  | `packages/database/supabase/functions/shared/contract-schedule.ts` | `packages/database/src/contract-schedule.ts` (`@carbon/database/contract-schedule`, re-exported from `@carbon/utils`) |
  | Revenue preview math (`revenueSchedule`, `contractPosition`) | `packages/utils/src/contract-revenue.ts` |
  | `@carbon/database/contract-billing` (`confirmContract`, `applyContractAmendment`, `cancelContract`) | Server function `post-customer-contract`: confirm, schedule edits, amend, cancel, revert cancellation |
  | `@carbon/database/contract-billing` (`renewDueContracts`, `createContractInvoicesForDuePlannedInvoices`) | Server function `create-contract-invoices`: renewal, horizon roll, end of contract, drafting |
  | Edge functions `post-sales-invoice` / `post-memo` / `convert` | `packages/server-functions/src/<name>/` |
  | `automateSalesInvoice` | `postSalesInvoiceUnattended` + `emailPostedInvoice` + `sendPostedInvoiceViaStripe` (`packages/jobs/src/invoicing/automate-invoice.ts`) |
  | `releaseRecurringInvoiceStamps` | `releaseRecurringInvoiceStamps` in `apps/erp/app/modules/sales/sales.server.ts` (generalized from `releaseRentalInvoiceStamps`) |
- 2026-10-04: **Phase B implemented + setup wizard** (`.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part IV). Brad made 5 decisions on 2026-10-04. They override parts of this spec, and they supersede Phase A decisions 1 and 4.
  1. **Creation is a wizard.** It has five steps: Details, Products, Invoicing, Revenue and Review. This overrides "one page, not Rillet's wizard" in UI Changes. After Confirm, the contract page stays the place to work on a contract.
  2. **Next on Details saves the Draft.** Each later step edits that Draft through the real endpoints. Each step is a route: `/x/contract/:id/setup/<step>`.
  3. **The conservation rule stays.** The invoice grid and the revenue grid only move money. The invoices of each line must add up to its total, and its revenue must equal what it bills. Confirm waits until both residuals are zero.
  4. **The contract has a ship-to address** (`customerContract.shipToCustomerLocationId`). `create-contract-invoices` copies it onto each drafted invoice's `salesInvoiceShipment.customerLocationId` (added for this, in `20261006221401_sales-invoice-discount-and-ship-to.sql`).
  5. **Phase B ships now.** Carbon stores the revenue schedule of each line as the **revenue plan**, one amount per month. A person can edit it while the contract is a Draft. This overrides "read-only" and the out-of-scope item "hand-edited revenue schedules". The GL engine posts from the revenue plan.

  The plan refined the design with 13 decisions. The code implements them as follows:

  | # | Decision | As built |
  |---|---|---|
  | D1 | Revenue plan table | `customerContractRevenue`: one row per line per calendar month, amount in contract currency, `status` Planned / Recognized / Recognized Externally. An unedited Draft has no rows, and the loader plans them live. The first revenue edit, or Confirm, writes them. |
  | D2 | Revenue plan math | `@carbon/database/contract-revenue-schedule` (`planRevenueSchedule`, `reconcileRevenueSchedule`, `validateRevenueEdit`). The revenue total of a line is the sum of its invoice-schedule rows, adjustments and memo credits included. `@carbon/utils` re-exports it. |
  | D3 | Position = invoiced − recognized | `applyContractMovement` (`@carbon/database/contract-position`) applies every movement. Deferred Revenue holds the positive part and Contract Assets the negative part, in contract currency and in base. Each pool carries base at a weighted-average rate. Against a receivable, the base difference goes to realized exchange gain or loss, never to revenue. |
  | D4 | Movement ledger | `customerContractLedgerEntry`, entry types Opening / Invoice / Recognition / Credit Memo / Void. A Recognition entry cascades with its schedule row. |
  | D5 | Recognition reuses the run | `synthesizeContractRevenue` is the second synthesizer of the run. It writes a Deferral row for the part that the deferred pool covers and an Accrual row for the rest. Run posting writes `documentType 'Contract'` and the Customer, Item and Project dimensions, and marks the month Recognized. |
  | D6 | Invoice posting branch | A contract line credits Contract Assets up to the asset pool and Deferred Revenue for the rest. It writes no schedule rows. A VOID negates the Invoice entry exactly. If a pool then goes below zero, a reclass on the VOID journal moves it to the other pool. |
  | D7 | Credit memo branch | `post-memo` applies the credit per line: Deferred Revenue up to the pool, Contract Assets for the rest. It no longer changes recognition schedule rows. Cancel writes no catch-up rows itself; the revenue reconciliation from the new end date makes them (D9). |
  | D8 | Opening balance at Confirm | The server function writes it at Confirm, not a migration. Per line, it is the Billed Externally rows minus the Recognized Externally revenue, at the contract's exchange rate. It has no journal. |
  | D9 | Reconcile, never rewrite | `reconcileRevenue` runs after amend, cancel, revert, renewal, the horizon roll and a discount end at Confirm. It keeps Recognized months, and also Planned months that a Draft run holds. |
  | D10 | Invoice grid operations | `edit-schedule` gains `setAmount`, `addInvoice` and `delete`. The grid replaces the move, split and merge menus on a Draft. Those intents stay in the server function, with no UI. |
  | D11 | Revenue grid operations | The new action `edit-revenue` has `setAmount`, `addMonth`, `deleteMonth` and `reset`. Confirm refuses a line whose revenue total is not its billed total. |
  | D12 | Grid | The shared `Table` with `editableComponents`, plus a new `EditableDate` cell in `~/components/Editable`. |
  | D13 | Wizard shell | `ContractSetupFrame` (heading and stepper) and `ContractSetupFooter` (contract total, Back, Next). |

  The implementers reported 5 differences from the plan:
  1. **The run recognizes Ended contracts too.** The synthesizer and the close check read every contract that is not a Draft. So the catch-up months of a cancelled contract still post.
  2. **One lock serializes every writer.** Invoice posting, its VOID, `post-memo` and the synthesizer all take the advisory lock `contract-position:<companyId>`.
  3. **Run posting refuses an incomplete run.** `postRevenueRecognitionRun` refuses a run while a due contract month has no schedule row. The user must recalculate the run first.
  4. ~~Drafted invoices do not get the ship-to address.~~ Fixed: see decision 4.
  5. **The position view is missing.** The loader does not send the ledger position. The Revenue section of a confirmed contract still shows the preview.
- 2026-10-04: **The contract line field `kind` is now `revenueType`** (enum `contractRevenueType`, migration `20261004202351_contract-line-revenue-type.sql`). The UI label is "Revenue Type". The new name says what the field decides (`.claude/rules/conventions-database.md`). The Data Model above uses the new names.

# Part IV — Period runs (revenue recognition and depreciation)

> These decisions had no spec; they were recorded in the plans (now plan Parts V and VI) after the conversation of 2026-10-04. Research: `.ai/research/2026-10-04-netsuite-period-runs.md`.

## Hardening (plan Part V)

| # | Decision | NetSuite precedent |
|---|---|---|
| D0 | Keep the uncommitted baseline: Recalculate on Draft runs, the out-of-date check at Post, and Draft-run sync on invoice void and contract credit memo. | ARM Estimate, re-runnable process |
| D1 | A posting makes a period Active only when the period contains the company's today. | The current period comes from the system date. |
| D2 | New, Repeat and Post refuse a run whose `periodEnd` is after the end of the company's current month. The current month stays allowed. | FAM "Allow Future-dated Depreciation" off |
| D3 | **Reverse Run** on a Posted run reverses its journals, resets the source records, and returns the run to Draft. Depreciation allows it only on the latest posted run. Generic journal reversal refuses run journals. | ARM void or delete makes plan lines recognizable again |
| D4 | A run posts one journal per month, each in that month's accounting period. If that month's period is Closed, that month posts in the run's own period. | FAM journal per period of depreciation |
| D5 | A revenue recognition period can have more than one run. Only one Draft per period exists at a time. | ARM "multiple times in a month" |

Terms:

- **Month end**: the last day of a calendar month, `YYYY-MM-DD`.
- **Company today**: `datetime.today(await getCompanyTimeZone(client, companyId)).toString()`.
- **Current month end**: `endOfMonth(parseDate(companyToday)).toString()`.
- **Future run**: a run whose `periodEnd` is after the current month end.
- **Target date**: the posting date of a month's journal. It is the month end, or the run's `periodEnd` when the month's period is Closed.

## The close checklist asks the runs what is due (plan Part VI)

| # | Decision |
|---|---|
| E1 | The close checklist asks the run engines what a run would do now, instead of copying their rules. |
| E2 | Revenue recognition: a dry run of the proposal (synthesizers + due rows) in a transaction that always rolls back. |
| E3 | Depreciation: `buildDepreciationRunLines` for the period end — the lines New Run would create. |
| E4 | Each task shows what is due (count and amount), and offers **Create run**. |
| E5 | Never leave an empty run: Create run, New Run and the dry run create nothing when nothing is due. |

Terms:

- **Run preview**: `{ revenue: { count, amount }, depreciation: { count, amount } }` for one period end.
- **Due**: in the preview, or held by a Draft run of the period that is not posted.

# Part V — Later changes

> Built after the Parts above were implemented, with no spec of their own. The code and `apps/erp/app/modules/sales/AGENTS.md` (Rentals → Setup wizard), `.claude/rules/fixed-asset-lifecycle.md` (post-asset-transfer) are the detailed record.

## Rental agreement setup wizard (2026-10-07)

Creating a rental agreement is five routed steps — details → units → billing → accounting → review — on the same `~/components/Setup` pieces as the contract wizard (Part III), replacing the single `RentalAgreementForm`. "Next" on the first step saves a Draft; later steps save as they are edited. Units are added several at a time at their rate on file and priced in a grid. **Activate refuses a unit with no rate** (`unpricedUnitError`, `post-rental-agreement/validators.ts`): a unit at zero would go on rent and bill nothing. Playbook: `.ai/playbooks/rental-agreement-setup-wizard.md`.

## Capitalization cost (2026-10-07)

Capitalizing a stock unit (Part I, the fleet bridge) moves the value inventory already carries: its carrying cost, never a typed amount, since any other amount would strand a balance in the inventory account. The credit is the item's own inventory account (Buy → Raw Materials, Make → Finished Goods), the account its receipts and adjustments debited.

- The capitalize form shows the exact cost from the `preview-asset-capitalization` server function — the same `calculateCOGS` relief, rolled back — instead of the item's unit cost, which differed whenever the unit's own layer, a layer at net book value or the average was not that cost.
- `post-asset-transfer` `capitalize` refuses a unit whose cost is zero, rather than creating an asset worth nothing with no journal.
- Not done: inventory accounts per item posting group (so a bought unit held for rent could sit in Finished Goods). It would change every inventory posting, not capitalization alone.
