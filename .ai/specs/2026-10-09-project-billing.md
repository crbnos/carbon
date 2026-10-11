# Project Billing: time-and-materials and cost-plus contract lines, and revenue by progress

> Status: Phase 4a implemented (2026-10-11, plan `.ai/plans/2026-10-09-project-billing-phase-4a.md`; browser check deferred). Phase 4b planned (`.ai/plans/2026-10-09-project-billing-phase-4b.md`).
> Author: Brad (with Claude)
> Date: 2026-10-09
> Research: `.ai/research/projects-wbs-pmmo.md` (patterns 9 and 10, Answer 6, Recommendation 7)
> Builds on:
> - `.ai/specs/2026-10-03-projects.md` (the project ledger, the billing flag, Phase 4 outline, decisions 25–26)
> - `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` (contracts, the recurring invoicing layer, the revenue recognition run; on main)
> - `.ai/specs/implemented/2026-10-08-field-service.md` (`projectBillableItem`, which ships with field service Phase A)

## TLDR

A customer contract can now bill project work in three ways, chosen per contract line by its **billing method**:

| Billing method | What the invoice shows | Price |
|---|---|---|
| **Fixed** (today) | The line's schedule: one-time or recurring | The line's rate |
| **Time & Materials** | Hours and costs charged to the line's **billing element** and its subtree | Hours × a bill rate; materials and other costs × (1 + handling %) |
| **Cost Plus** | Allowable cost of the subtree | Cost × (1 + fee %) |

- **Billable items.** Every project ledger row under a billing element becomes a billable item when it posts. Field service introduced the table; this spec adds contract pricing. A user reviews items: bill, hold or write off.
- **Funding.** A line has a funded amount and a ceiling. Billing stops at the funded amount. A notice goes out when incurred plus expected cost reaches 75 % (or the contract's percent) of the funded cost.
- **Invoicing.** The nightly recurring billing job drafts one invoice per contract per billing period from the Unbilled items. These invoices use the existing contract path, so automation, posting, voids and stamp release work as for fixed lines.
- **Revenue.** Two new revenue methods run in the monthly recognition run:
  - **Right to Invoice** (time and materials): revenue equals the billable amount of the work performed in the month, whether or not it is invoiced yet.
  - **Percent Complete** (cost plus, and fixed-price lines tied to a project): revenue equals the price × (actual cost ÷ estimate at completion). A forecast loss is provided in full at once.
- **Project WIP relief.** The same run moves the matching cost from Project WIP to cost of goods sold. So revenue and cost land in the same month.

## Problem Statement

- **Contract projects never leave WIP.** Phase 1a posts Contract-treatment cost to `projectWorkInProgressAccount`. Nothing relieves it: Phase 4 of the projects spec was an outline only.
- **Contracts bill only schedules.** `customerContractLine` has a `revenueType` of One-time or Recurring, and a rate (`20261006221301_contracts.sql:102-145`). There is no way to bill the hours an engineer logged, or cost plus a fee.
- **No bill rates exist.** Labor categories have cost rates only. No table holds a price per labor category or per employee for a customer (`customerItemPriceOverride` and `customerItemRentalRate` are keyed by item).
- **No funding control.** Contract lines have no funded or ceiling amount. FAR 52.232-20/-22 require notice at 75 % of the estimated cost.
- **No progress-based revenue.** The revenue run recognizes only planned schedule rows (`synthesizeContractRevenue`, `propose-revenue-recognition-run/index.ts:285-494`). The contracts migration reserves two later methods in a comment (`20261006221201_contract-enums.sql:21`). Cost-to-cost percent of completion is not implemented (`.ai/specs/2026-07-04-revenue-recognition.md` is in progress, and its POC part is open).

## Proposed Solution

### Concepts

| Term | Meaning |
|---|---|
| **Billing method** | A new column on `customerContractLine`: Fixed, Time & Materials or Cost Plus. Fixed lines behave exactly as today. |
| **Billing element** | The project element a T&M or Cost Plus line bills (`customerContractLine.projectElementId`), with its whole subtree. The element must have `isBilling` (projects spec *Billing flag*). |
| **Bill rate** | The price of one hour. Found most-specific first: the contract line × the employee, then the contract line × the labor category, then the labor category's default bill rate (`laborCategoryRate.billRate`). |
| **Handling %** | `materialHandlingPercent` on a T&M line: the markup on material and other direct cost. |
| **Fee %** | `feePercent` on a Cost Plus line: the fee on allowable cost. |
| **Billable item** | One `projectBillableItem`: a ledger row with its quantity, unit price, amount and status (Unbilled, On Hold, Billed, Written Off). |
| **Funded amount / ceiling** | `fundedAmount` (cost plus fee) caps what Carbon bills. `fundedCost` (exclusive of fee) drives the funding notices. `ceilingAmount` caps the transaction price of a Cost Plus line. |
| **Right to Invoice** | A revenue method: revenue = the billable amount of the items performed in the period. ASC 606-10-55-18. |
| **Percent Complete** | A revenue method: revenue = price × (cumulative actual cost ÷ estimate at completion), cumulative catch-up each month. |

### Billing methods on a contract line

- **Fixed:** unchanged. The schedule (`planInvoiceSchedule`) bills it. A Fixed line may also set `projectElementId` and use revenue method Percent Complete; that is a fixed-price contract recognized by progress.
- **Time & Materials** and **Cost Plus:**
  - The line has no schedule. `planInvoiceSchedule` and the contract schedule writers skip it.
  - It needs `projectElementId` (a billing element of a Contract-treatment project) and an Active contract.
  - Its `quantity` is 1 and its `rate` is 0. A CHECK keeps them so; the UI hides both.
  - Its default revenue method is Right to Invoice (T&M) or Percent Complete (Cost Plus). A user may choose the other one.
- One billing element has at most one Active T&M or Cost Plus line. Two lines would bill the same cost twice.

### Billable items

A posting function writes one Time & Materials billable item per `projectLedger` row when 3 things are true (Cost Plus items come from the commercial generator, decision P1):
1. the row's project has treatment Contract;
2. its element is the billing element of an Active T&M or Cost Plus line, or a descendant of it;
3. the row is not `unallowable` (projects Phase 5 sets this flag; it is false until then).

The price depends on the line's method and the row's cost type:

| Method | Labor | Material, Outside Processing, Purchased Service, Other Direct | Machine, Overhead, Burden |
|---|---|---|---|
| T&M | hours × bill rate | cost × (1 + handling %) | not billed (included in the bill rate) |
| Cost Plus | cost × (1 + fee %) | cost × (1 + fee %) | cost × (1 + fee %) |

- `buildContractBillableItem` (`project-posting.ts`) is the contract branch beside the field service `buildBillableItem`. It runs in the posting transaction for T&M lines. Cost Plus items come from `generateCostPlusItems` in `packages/ee` (P1).
- Rows that the SQL functions `complete_job_to_inventory` and `backflush_job_materials` insert into `projectLedger` get their T&M item from the backfill. `create-project-billing-invoices` runs that backfill before it reads items, so those rows reach the review list on the next invoice run, not at posting. **Generate Billable Items** on the line's billing page does it at once.
- **Generate billable items** on the contract line creates items for older ledger rows. These rows posted before the line existed, or before the element became a billing element. It skips rows that already have an item.
- A reversal of a ledger row reverses its item with `reverseBillableItem`. An Unbilled item is written off with the reason "Reversed". A Billed item gets a negative Unbilled item.
- A user can change the unit price of an Unbilled item, put it On Hold, release it, or write it off with a reason. Each change goes to the audit log.

### Bill rates

- `laborCategoryRate` gains `billRate`, effective-dated with the cost rate it already holds. It is the company's default price of an hour of that category.
- `customerContractLaborRate` holds the contract's own rates: the contract line, a labor category **or** an employee, the bill rate and `effectiveFrom`.
- `resolveBillRate(line, employeeId, laborCategoryId, date)` returns the most specific rate effective on the date:
  1. contract line × employee;
  2. contract line × labor category;
  3. the labor category's default `billRate`.

  With no rate, the item is created On Hold with the reason "No bill rate" (in `statusReason`, P3).

### Funding

- `fundedAmount` and `ceilingAmount` on the line are optional.
- **Funding position:** billed = Σ Billed items of the line; unbilled = Σ Unbilled and On Hold items; incurred = Σ the subtree's ledger cost.
- **Invoicing stops at the funded amount.** The invoicing source takes Unbilled items in posting date order. It stops before the item that would take billed above funded. Those items stay Unbilled with the reason "Funding limit" and show on the line.
- **Notices (FAR 52.232-20/-22).** The clauses compare cost, not billing. The test adds the cost incurred and the cost expected in the next 60 days. It compares the sum with 75 % of the estimated cost or the allotted funds. A contract can set the percent from 75 to 85 and the window from 30 to 90 days.
  1. The line has `fundedCost` (the funded amount exclusive of fee), `noticePercent` (default 0.75) and `noticeWindowDays` (default 60).
  2. Expected cost = the subtree's average daily cost over the last 90 days × `noticeWindowDays`. The plan's remaining cost caps it.
  3. When incurred + expected cost first reaches `noticePercent` × `fundedCost`, Carbon sends `ContractFundingThreshold` to the contract's sales person and the project's manager. It sends a second notice when the line's funding runs out within the window.
  4. The notice states the funded cost, the incurred cost, the expected cost and the estimate at completion. It also states the date the funds run out at the current rate.

### Invoicing

A new server function `create-project-billing-invoices` is a new source of the recurring invoicing layer:
1. It takes each Active contract with a T&M or Cost Plus line. The billing period end is the latest billing grid date on or before `asOf` (`billingGrid`, from the contract's `billingFrequency` and `billingAlignment`).
2. It selects the lines' Unbilled items with a posting date on or before the period end, within funding.
3. It drafts one invoice per contract, through the same insert path as `insertContractInvoice`. The header carries `customerContractId`. Each invoice line carries `customerContractLineId` and `projectId`, with `invoiceLineType 'Service'`.
4. It groups the invoice lines. Labor groups by labor category: quantity = hours, and unit price = the average rate when rates differ. Other costs group by cost type. A backup report lists every item.
5. It stamps each item: `salesInvoiceLineId` and status Billed.

Wiring, as the contracts research lists it:
- `recurring-billing.ts`: a company discovery flag and one more step after contract billing.
- `releaseRecurringInvoiceStamps` (`sales.server.ts:439`): deleting the Draft returns the items to Unbilled.
- The VOID branch of `post-sales-invoice` (`:2620-2695`): a void returns the items to Unbilled.
- Automation, owners and the digest key on `salesInvoice.customerContractId`, so they work with no change.
- The field service guard (no stock relief on lines that billable items stamp) applies.

### Revenue and WIP relief

The monthly recognition run gets a third synthesizer, `synthesizeProjectRevenue`, beside `synthesizeRentalAccruals` and `synthesizeContractRevenue` (`RUN_ROW_SYNTHESIZERS`, `propose-revenue-recognition-run/index.ts:496-499`). For each Active contract line with revenue method Right to Invoice or Percent Complete, it computes the month's revenue and writes a `customerContractRevenue` row. Then it moves the contract position with `applyContractMovement`, exactly as for planned rows. Invoices already credit Contract Assets first, then Deferred Revenue (`planContractInvoiceLine`), so unbilled revenue sits in Contract Assets and billing in advance sits in Deferred Revenue.

**Right to Invoice:**
- Earned to date = Σ the amount of the line's billable items with posting date ≤ the period end and status other than Written Off.
- This month = earned to date − recognized to date. A write-off gives a negative month.
- Cost relief = the cost of those items not yet relieved.

**Percent Complete:**
- Price:
  - Fixed line: the line's total scheduled amount (its contract value).
  - Cost Plus line: estimate at completion × (1 + fee %), capped at `ceilingAmount`.
- Estimate at completion (EAC): the billing element subtree's estimate at completion from the Costs tab (actual + committed + remaining plan, or the manual override).
- Progress = cumulative actual cost of the subtree up to the period end ÷ EAC, capped at 1.
- Earned to date = price × progress. This month = earned to date − recognized to date.
- Cost relief = every subtree cost not yet relieved (cost-to-cost expenses cost as incurred).
- **Loss provision.** If EAC > price, the provision balance must be (EAC − price) × (1 − progress). The run posts the change: Dr cost of goods sold / Cr `contractLossProvisionAccount`, or the reverse. With the cost-to-cost margin, the full loss shows at once (ASC 606 and ASC 605-35).

**Cost relief rows.** The run writes schedule rows of two new types, `Cost Relief` (Dr cost of goods sold / Cr Project WIP) and `Loss Provision`. `postRevenueRecognitionRun` posts them with the Project and Project Element dimensions. `projectCostRelief` records which ledger rows each relief covered, so no cost is relieved twice.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Where the method lives | `customerContractLine.billingMethod` (Fixed, Time & Materials, Cost Plus). `revenueType` stays for Fixed lines. | The projects spec said `kind`; main has `revenueType` (One-time, Recurring), which answers a different question. Naming rule: name what the choice decides. |
| 2 | Revenue method names | Add `'Right to Invoice'` and `'Percent Complete'` to `contractRevenueMethod`. Not `'As Invoiced'`. | Under ASC 606-10-55-18, T&M revenue follows the right to invoice, which arises when work is performed, not when an invoice is drafted. "As Invoiced" would mislead. The contracts migration only reserved the names in a comment. |
| 3 | One revenue path | Both methods go through the monthly run and the contract position (`applyContractMovement`). Invoices post as for every contract line. | Reuses the deferral and contract asset machinery. No second revenue engine. |
| 4 | WIP relief timing | In the same run as revenue: Right to Invoice relieves the cost of the items it recognizes; Percent Complete relieves all cost incurred. | Revenue and its cost land in the same month. Cost-to-cost expenses contract cost as incurred. |
| 5 | Loss | Full provision at once, adjusted monthly to (EAC − price) × (1 − progress). | ASC 605-35-25-46 (kept by ASC 606 for contracts with a forecast loss). |
| 6 | Billable items | Created at posting, in the posting transaction, by the field service `buildBillableItem` hook. A backfill action covers older rows. | One billing table for service and contracts. SAP DP91 and Costpoint review states. |
| 7 | Rate lookup | Line × employee, then line × labor category, then the category's default bill rate. No rate puts the item On Hold. | Costpoint's most-specific-wins sequence. An item never bills at 0 by accident. |
| 8 | Overhead on T&M | Machine, overhead and burden rows are not billed on T&M lines. | A T&M bill rate is a loaded rate (FAR 16.601). Billing burden again would double it. |
| 9 | Funding | A hard stop at `fundedAmount` (cost + fee) per line. Notices from incurred + expected cost against `noticePercent` × `fundedCost`, with a per-line window. | Oracle's hard limit, D365 funding limits. FAR 52.232-20/-22 compare cost exclusive of fee, with a 60-day look-ahead that a contract may set from 30 to 90 days and 75 % to 85 %. |
| 10 | Invoice grouping | Labor by labor category, other costs by cost type, with an item backup report. | DCAA-style invoices show labor by category; the backup reconciles to the books (DFARS 252.242-7006 (c)(16)). |
| 11 | One line per billing element | Refused at confirm and amend. | Prevents double billing of one cost. |
| 12 | Fixed-price by progress | A Fixed line with a `projectElementId` may use Percent Complete. | FFP development contracts recognize revenue over time by cost-to-cost. |
| 13 | Multi-tenancy (H1) | Every new table has `companyId`, `PRIMARY KEY ("id","companyId")` and `id('prefix')`. | conventions-database. |
| 14 | Service shape (H2) | Client first, `{data, error}`. Posting and invoicing in server functions with Kysely transactions. | conventions-services. |
| 15 | RLS (H3) | `customerContractLaborRate`: `company("sales")`, as the contract tables. `projectCostRelief`: `company("accounting")`, read-only. | The contract's module owns its rates. |
| 16 | Permissions (H4) | Contract line fields need `update: sales`. Billable item review needs `update: projects` (or `update: service` for Service projects). Invoicing keeps `create: invoicing`. | Billing review is project work; the contract is a sales document. |
| 18 | Commercial gating | T&M and Right to Invoice community; Cost Plus, Percent Complete and the loss provision commercial (`PROJECT_REVENUE`). | Brad 2026-10-09. Service businesses need T&M; Cost Plus and progress revenue are what A&D contractors buy. |
| 17 | Backward compatibility (H7) | Existing lines get `billingMethod 'Fixed'`. No existing posting changes. The new synthesizer touches only the two new revenue methods. | No FROZEN surface. |

## Data Model Changes

Migration order: enum values first, in their own migration; then tables and columns; then seeds.

```sql
-- enums (own migration)
CREATE TYPE "contractBillingMethod" AS ENUM ('Fixed', 'Time & Materials', 'Cost Plus');
ALTER TYPE "contractRevenueMethod" ADD VALUE IF NOT EXISTS 'Right to Invoice';
ALTER TYPE "contractRevenueMethod" ADD VALUE IF NOT EXISTS 'Percent Complete';
ALTER TYPE "revenueScheduleType" ADD VALUE IF NOT EXISTS 'Cost Relief';
ALTER TYPE "revenueScheduleType" ADD VALUE IF NOT EXISTS 'Loss Provision';

ALTER TABLE "customerContractLine"
  ADD COLUMN "billingMethod" "contractBillingMethod" NOT NULL DEFAULT 'Fixed',
  ADD COLUMN "projectElementId" TEXT,                -- the billing element (projectId exists)
  ADD COLUMN "materialHandlingPercent" NUMERIC,      -- T&M, 0–1
  ADD COLUMN "feePercent" NUMERIC,                   -- Cost Plus, 0–1
  ADD COLUMN "fundedAmount" NUMERIC,                 -- cost + fee; the billing stop
  ADD COLUMN "fundedCost" NUMERIC,                   -- exclusive of fee; the notice base
  ADD COLUMN "noticePercent" NUMERIC NOT NULL DEFAULT 0.75,   -- 0.75–0.85
  ADD COLUMN "noticeWindowDays" INTEGER NOT NULL DEFAULT 60,  -- 30–90
  ADD COLUMN "ceilingAmount" NUMERIC;
-- CHECK: "billingMethod" = 'Fixed' OR ("projectElementId" IS NOT NULL AND "quantity" = 1 AND "rate" = 0)
-- CHECK: "billingMethod" <> 'Cost Plus' OR "feePercent" IS NOT NULL
-- FK ("projectElementId", "projectId", "companyId") → projectElement
-- partial UNIQUE on ("projectElementId", "companyId") WHERE "billingMethod" <> 'Fixed' is enforced at confirm
--   (the line has no status column, so the service checks Active contracts)

ALTER TABLE "laborCategoryRate" ADD COLUMN "billRate" NUMERIC;

CREATE TABLE "customerContractLaborRate" (
  "id" TEXT NOT NULL DEFAULT id('conlr'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "laborCategoryId" TEXT,
  "employeeId" TEXT REFERENCES "user"("id"),
  "billRate" NUMERIC NOT NULL CHECK ("billRate" >= 0),
  "effectiveFrom" DATE NOT NULL,
  -- audit; PK ("id","companyId");
  -- CHECK (num_nonnulls("laborCategoryId", "employeeId") = 1);
  -- UNIQUE ("customerContractLineId", "laborCategoryId", "employeeId", "effectiveFrom", "companyId")
);

-- No holdReason column (P3): the reasons ('No bill rate', 'No hours', 'Funding limit', a user's note)
-- live in the existing projectBillableItem.statusReason. projectBillableItem gains voidedSalesInvoiceId (P4).

CREATE TABLE "projectCostRelief" (                   -- append-only
  "id" TEXT NOT NULL DEFAULT id('pcr'),
  "companyId" TEXT NOT NULL,
  "projectLedgerId" TEXT NOT NULL,
  "revenueRecognitionRunLineId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- PK ("id","companyId"); UNIQUE ("projectLedgerId", "revenueRecognitionRunLineId", "companyId")
);

ALTER TABLE "accountDefault" ADD COLUMN "contractLossProvisionAccount" TEXT;
-- seeded account: 'Contract Loss Provision' (Liability, Balance Sheet), number chosen in the plan
-- after checking the chart for a free number next to 2160 Deferred Revenue; backfill as
-- 20261006220201_revenue-recognition-core.sql does
```

`projectWorkInProgressAccount` comes from projects Phase 1a. `projectBillableItem` comes from field service Phase A.

## API / Service Changes

- **Pure helpers** (`@carbon/utils`, unit-tested): `resolveBillRate`, `priceContractBillableItem(method, costType, ledgerRow, rates, line)`, `percentCompleteRevenue({ price, eac, actualToDate, recognizedToDate })`, `lossProvisionBalance({ price, eac, progress })`, `fundingPosition(items, line)`, `fundingNotice({ incurred, averageDailyCost, remainingPlan, line })`.
- **Posting:** `buildBillableItem` gains the contract branch; every posting function that writes `projectLedger` already calls it.
- **Server functions:**
  - `create-project-billing-invoices` (`{ asOf, customerContractId? }`, permissions `{ update: "sales", create: "invoicing" }`);
  - `generate-contract-billable-items` (`{ customerContractLineId }`, the backfill action);
  - `propose-revenue-recognition-run`: the `synthesizeProjectRevenue` synthesizer.
- **Contract services** (`sales.service.ts`): `getContractLaborRates`, `upsertContractLaborRate`, `deleteContractLaborRate`, `getContractLineFunding`.
- **Project services** (`projects.service.ts`): `getContractBillableItems(client, { companyId, customerContractLineId, status })`, `updateProjectBillableItems` (bulk hold, release, write-off, price).
- **Jobs:** `recurring-billing` gains the Cost Plus and project billing steps (before the contract step) and a daily funding check that sends `ContractFundingThreshold` once per threshold per funded cost (P12, P13).
- **Invoice automation and stamps:** `releaseRecurringInvoiceStamps` and the VOID branch return billable items to Unbilled.

## UI Changes

Build with the `carbon-design` skill.

- **Contract line form:** **Billing method**. For T&M and Cost Plus, quantity and rate hide, and the form shows:
  - the billing element: a project element picker limited to the billing elements of the line's project;
  - handling % or fee %;
  - funded amount, funded cost, notice percent and window, ceiling;
  - the revenue method (Right to Invoice or Percent Complete).
- **Contract line page:**
  - a **Labor rates** table: labor category or employee, bill rate, effective from;
  - a **Funding** bar: billed, unbilled, incurred, funded, ceiling;
  - the line's billable items, with **Generate billable items**.
- **Contract details:** a **Project billing** section beside Invoices and Revenue, listing T&M and Cost Plus lines with their funding.
- **Projects → Billing** (the planned submodule): billable items by contract line, filtered by status. Bulk **Hold**, **Release**, **Write off** (reason required) and **Edit price**.
- **Project page → Billing tab** (planned in the projects spec): the project's contract lines, funding, the percent complete and the revenue recognized to date.
- **Labor categories:** a **Bill rate** column beside the cost rate.
- **Settings → Account Defaults:** **Contract Loss Provision**.

## Acceptance Criteria

Phase 4a: billing

- [ ] **T&M item.** A T&M line bills element `P101-2` with handling 10 %. An engineer (category Engineer II, default bill rate 150.00) logs 6 h on a child of `P101-2`. One Unbilled item of 900.00 exists. A 200.00 material issue to the same subtree gives an item of 220.00. An overhead row gives no item.
- [ ] **Rate lookup.** A contract rate for Engineer II of 160.00 gives 960.00. A rate for that employee of 175.00 gives 1,050.00. With no rate anywhere, the item is On Hold with "No bill rate".
- [ ] **Cost Plus item.** A Cost Plus line has fee 8 %. A 1,000.00 labor cost gives an item of 1,080.00. A 500.00 overhead row gives 540.00.
- [ ] **Review.** A user puts an item On Hold, edits another item's price, and writes off a third with a reason. The audit log shows all three.
- [ ] **Invoice.** The nightly job drafts one invoice for the contract with labor grouped by category and materials as one line. The items become Billed. Deleting the Draft returns them to Unbilled. Voiding a posted invoice returns them to Unbilled.
- [ ] **Funding stop.** With funded 10,000.00 and items of 6,000.00 and 5,000.00, the invoice takes 6,000.00. The second item stays Unbilled with "Funding limit".
- [ ] **Funding notice.** Funded cost is 100,000.00 and incurred is 60,000.00. The last 90 days averaged 300.00 a day, so the expected 60-day cost is 18,000.00. Incurred + expected = 78,000.00 ≥ 75,000.00, so the notice goes out once.
- [ ] **One line per billing element.** Confirming a second T&M line for the same billing element is refused.

Phase 4b: revenue

- [ ] **Right to Invoice.** In October, items of 9,000.00 post and 6,000.00 are invoiced. The October run recognizes 9,000.00: 6,000.00 from the invoice's position and 3,000.00 into Contract Assets. It relieves the items' 5,500.00 cost: Dr COGS / Cr Project WIP.
- [ ] **Percent Complete.** A Cost Plus line has EAC 100,000.00, fee 8 % and no ceiling (price 108,000.00). With 25,000.00 actual at month end, the run recognizes 27,000.00 and relieves 25,000.00. The next month, with 40,000.00 actual and EAC raised to 120,000.00 (price 129,600.00), it recognizes 43,200.00 − 27,000.00 = 16,200.00.
- [ ] **Ceiling.** With a ceiling of 115,000.00, the price in the second month is 115,000.00.
- [ ] **Loss.** A Fixed line with price 100,000.00, EAC 110,000.00 and progress 40 % posts a provision of 6,000.00 (10,000.00 × 60 %). At 100 % progress the provision is 0, and the full 10,000.00 loss is in the margin.
- [ ] **No double relief.** Running the proposal twice for the same month relieves each ledger row once (`projectCostRelief`).

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **A new source of the recurring invoicing layer** touches stamp release and VOID, which serve rentals and contracts | Med | The new code only handles invoice lines that billable items stamp. Database tests for delete and void of each source. |
| **EAC drives revenue.** A wrong estimate misstates revenue every month. | High | The run shows the EAC, price and progress per line in the proposal for review before posting. The EAC override is audited. |
| **Billing a cost twice** through two lines or a manual invoice | Med | One line per billing element; items stamp invoice lines; the backfill skips rows with an item. |
| **Funding stop splits a month's work over two invoices** | Low | Expected behaviour under a hard limit; the held items show with their reason. |
| **Dependency order:** projects 1a/1b and field service Phase A must ship first | Med | Phase 4a starts after field service Phase A (it brings `projectBillableItem`). |

## Delivery phases

1. **Phase 4a: billing.** ✅ Implemented 2026-10-11. Billing method, billing element, bill rates, billable items for contracts, review, funding and notices, the invoicing source.
2. **Phase 4b: revenue.** Right to Invoice, Percent Complete, cost relief, loss provision, the Billing tab's progress figures.

## Plan decisions (Phase 4a)

The plan corrected or added to this spec. Each is in the code; the plan's *Execution notes* record how.

| # | Decision |
|---|---|
| P1 | `@carbon/server-functions` cannot import `@carbon/ee`, so Cost Plus pricing runs in the commercial `generateCostPlusItems`, not at posting. Posting writes T&M items only. The nightly job and **Generate Billable Items** call the generator. |
| P2 | `requireProjectRevenueEntitlement` (ee) guards a Cost Plus line or Percent Complete in the routes. The real lock is P1. |
| P3 | No `holdReason` column: `projectBillableItem.statusReason` holds "No bill rate", "No hours", "Funding limit" and a user's note. |
| P4 | `projectBillableItem.voidedSalesInvoiceId`, stamped by a VOID. A re-bill of such an item, or an invoice with a negative item, is held. |
| P5 | Billing lines and Percent Complete lines need the contract currency to equal the base currency. |
| P6 | T&M uses Right to Invoice only; Cost Plus Percent Complete or Right to Invoice; Fixed Daily, Even Period or Percent Complete. CHECKs enforce it. |
| P7 | Confirm and amend refuse a billing element equal to, above or below another live billing line's element. |
| P8 | A live billing line: Active contract, billing method not Fixed, and `startDate <= postingDate <= COALESCE(endDate, postingDate)`. |
| P9 | Amend refuses a `change` of a billing line and allows `add` and `end`. Funding changes through **Edit Funding**; labor rates change at any time. |
| P10 | Every item is quantity 1 at its amount, except a T&M labor item (hours × rate). A Cost Plus labor item stores quantity = hours. |
| P11 | Invoice lines: T&M labor by labor category and unit price, Cost Plus labor by category, other cost by cost type. |
| P12 | The funding check runs once a day in the recurring billing job, not after each posting batch. |
| P13 | `thresholdNoticeFundedCost` and `runOutNoticeFundedCost` record the funded cost each notice went out for; a changed `fundedCost` makes it due again. |
| P14 | The plan's remaining cost caps the expected cost only when the subtree has a plan. |
| P15 | Confirm and an amend `add` of a T&M line run the T&M backfill in their transaction. |
| — | Rows that `complete_job_to_inventory` and `backflush_job_materials` insert into `projectLedger` get their T&M item from the backfill, which `create-project-billing-invoices` runs before it reads items. They reach the review list on the next invoice run, not at posting. |
| — | Item review reaches the audit log: `projectBillableItem` is in `auditConfig` and has `events: true` in `event-system/attachments.ts`. |

## Out of scope

- Indirect rates, burden at provisional rates and the year-end true-up (projects Phase 5). Until then, Cost Plus bills the cost the ledger holds.
- Progress payments and performance-based payments (FAR 32.5, 32.10).
- Award and incentive fee computation (CPAF, CPIF share ratios). The fee % is fixed.
- Milestone billing of T&M work.
- Multi-currency bill rates. Rates are in the contract's currency.
- Billing grouped (Phase 3) project stock to member contracts beyond what each member project's ledger holds.

## Open Questions

> Autonomous run (2026-10-09). Everything is resolved from codebase precedent and the research consensus except Q1, which is a product decision.

Resolved with Brad (2026-10-09):

- [x] **Q1: commercial gating** (projects decision 34) — **Answer:** the recommendation. T&M billing and Right to Invoice are community. Cost Plus pricing, the Percent Complete synthesizer and the loss provision go to `packages/ee` behind a `PROJECT_REVENUE` feature. `requireEntitlement` guards creating a Cost Plus line or choosing Percent Complete. `companyHasFeature` degrades the run.

Resolved autonomously (2026-10-09), open to veto:

- [x] **Name of the T&M revenue method?** — **Autonomous:** Right to Invoice. Rationale: ASC 606-10-55-18; "As Invoiced" misstates the timing.
- [x] **Where does WIP relief happen?** — **Autonomous:** in the monthly run, beside revenue. Rationale: matching; one place for cost-to-cost.
- [x] **Overhead on T&M?** — **Autonomous:** not billed. Rationale: loaded bill rates.
- [x] **Funding enforcement?** — **Autonomous:** hard stop per line, items held with a reason. Rationale: Oracle hard limit.
- [x] **Invoice layout?** — **Autonomous:** grouped by labor category and cost type, with a backup report. Rationale: DCAA invoice practice.

## Changelog

- 2026-10-09: Created autonomously from `.ai/research/projects-wbs-pmmo.md`, the projects spec's Phase 4 outline, and a map of the contracts, recurring invoicing and revenue recognition code on main. Corrects the projects spec: the line's type is `revenueType`, not `kind`; `customerContractLine.projectId` already exists. Q1 (commercial gating) is open.
- 2026-10-09: Q1 resolved (Brad): T&M and Right to Invoice community; Cost Plus, Percent Complete and the loss provision commercial behind `PROJECT_REVENUE`.
- 2026-10-11: Phase 4a implemented. Recorded plan decisions P1–P15 and the SQL backfill decision; corrected the billable item, data model and jobs sections (P1, P3, P12).
