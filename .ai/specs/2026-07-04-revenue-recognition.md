# Revenue Recognition (ASC 606 / IFRS 15)

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1048
> Readiness finding: `.ai/specs/2026-07-03-public-company-readiness.md` GAP-1
> Research: `.ai/research/public-company-compliance.md` (§ASC 606 answers, §NetSuite ARM)

## TLDR

Carbon recognizes revenue in full the moment a sales invoice posts — `post-sales-invoice` credits `accountDefault.salesAccount` with the gross line total ([post-sales-invoice/index.ts:381-398](packages/database/supabase/functions/post-sales-invoice/index.ts)); the seeded Deferred Revenue account **2160** has no writer, and no schedule, obligation, deposit, or percent-of-completion concept exists anywhere (verified by grep — GAP-1). This spec builds the full ASC 606 five-step model using NetSuite ARM's proven vocabulary: a **revenue arrangement** (the contract, one per sales order) containing **revenue elements** (performance obligations, one per sales order line) that receive a **relative-SSP allocation** of the transaction price from a standalone-selling-price catalog (with residual fallback), and **recognition schedules** per element — point-in-time on shipment/invoice, straight-line over a service period, and **cost-to-cost percent-of-completion driven by Carbon's existing job-costing actuals** (WIP journal lines by `documentId = jobId` over the estimate-at-completion from `jobMaterial`/`jobOperation`) — the differentiator no AI-GL competitor can copy, because they have no cost basis to recognize against. Billing for deferrable elements credits 2160 instead of revenue; a monthly recognition run generates an *accounting*-source journal (`Dr 2160 / Cr 4010` + auto-reversing contract-asset reclass) that posts under the period-close matrix and registers a seeded `periodCloseTaskDefinition` ("Recognize revenue for the period") with an auto-check on due unposted schedules. Customer deposits post to the existing Customer Prepayments liability (2110) until performance; contract modifications re-spread prospectively or with cumulative catch-up per ASC 606-10-25-12/13; reports ship the deferred-revenue waterfall, contract asset/liability rollforward, and remaining-performance-obligations backlog.

## Problem Statement

- **Revenue is all point-in-time, at invoice.** A 9-month machine build invoiced 50% up front books half the contract as revenue on day one; a 12-month service contract books 100% at invoicing. Both are wrong under ASC 606 and both are audit findings that force customers off Carbon before an IPO (readiness GAP-1; research §market timing — "rev-rec shadow spreadsheets" is a top-3 QuickBooks-graduation trigger).
- **Account 2160 "Deferred Revenue" is dead schema.** Seeded in [20260315000000_reset-chart-of-accounts.sql:206](packages/database/supabase/migrations/20260315000000_reset-chart-of-accounts.sql) but mapped to no `accountDefault` column and written by no posting path.
- **No deposits.** A customer's 30% down payment on a `payment` with no invoice application sits as a credit inside AR — understating both cash-collected liability and gross AR; there is no contract-liability presentation.
- **No obligations or allocation.** A bundled order (machine + install + 1-year support) has no way to split the price by fair value; discounts land wherever the salesperson typed them.
- **The raw material for POC already exists and is unused for revenue.** Job actuals accumulate in the GL WIP account keyed by `documentId = jobId` (`issue` → *Job Consumption*, `post-production-event` → *Production Event*), estimates live on `jobMaterial`/`jobOperation`, and `close-job` already computes the WIP balance per job — everything cost-to-cost POC needs, with no progress-billing or percent-complete concept on top of it (verified: zero hits for `milestone`/`percentOfCompletion`).

Scope resolved 2026-07-04 (Brad): **the full model** — arrangements, SSP allocation, all three methods, deposits, modifications, reports — not the reduced deferral-only cut GAP-1 sketched.

## Proposed Solution

### Object model — NetSuite ARM vocabulary (research §NetSuite ARM)

| Carbon table | ARM concept | Meaning |
|---|---|---|
| `revenueArrangement` | Revenue Arrangement | The ASC 606 contract. One per sales order (v1); holds status + transaction price. |
| `revenueElement` | Revenue Element | One performance obligation, 1:1 with a `salesOrderLine`; carries SSP, allocated amount, method, job link. |
| `revenueRecognitionSchedule` | Revenue Plan lines | Dated recognition rows per element; `planType` `Forecast` (unbilled projection) vs `Actual` (billed, postable). A separate plan header table is deliberately collapsed into element + schedule while Carbon has a single book — reintroduce per-book plans when GAP-5 multi-book lands. |
| `itemStandaloneSellingPrice` | Fair Value Price List | SSP catalog per item with configurable determination and effective dating. |

**Creation.** When `companySettings.revenueRecognitionEnabled` is on, releasing a sales order (status leaves Draft) creates the arrangement + elements from its lines (service hook in `convertQuoteToOrder`/order release path; idempotent). Transaction price = Σ line extended prices **net of tax** (the multi-jurisdiction tax spec removes tax from revenue; the element snapshot uses the same pre-tax base `quantity × unitPrice + setup + addOn`). Flag off (default) ⇒ zero new rows, zero posting changes — full backward compatibility.

**Lifecycle.** `Draft → Approved → Closed`. Allocation runs at approval; single-element arrangements auto-approve (no allocation judgment to review). Invoicing a line whose element belongs to an unapproved multi-element arrangement is blocked with a flash error. `Closed` when all elements are fully recognized and billed.

### SSP and relative-SSP allocation

- `itemStandaloneSellingPrice`: per item + currency, `price`, `method` (`Stated` — entered by accounting; `List Price` — derived from `itemUnitSalePrice.unitSalePrice` at arrangement creation), `effectiveDate`/`expirationDate` (rate-change pattern from the tax spec's components).
- Element SSP resolution order: Stated SSP row → company fallback per `companySettings.sspFallback` (`List Price` default | `Invoice Price` — treats the stated line price as SSP, i.e. no reallocation) → **Residual**: permitted when exactly *one* element in the arrangement lacks SSP (ASC 606-10-32-34(c)); its allocation = transaction price − Σ other allocations. Two or more SSP-less elements block approval with a named-item error.
- Allocation: `allocated_i = transactionPrice × (SSP_i × qty_i) / Σ(SSP × qty)`, rounded largest-remainder so Σ allocated = transaction price to the cent.
- **Range expedient** (NetSuite range checking): if every element's stated line price is within `sspTolerancePercent` (company setting, default 5%) of its SSP, allocation keeps stated prices — no churn when sales prices at fair value.
- `sspSource` snapshots on the element (`Stated` / `List Price` / `Invoice Price` / `Residual`) — the allocation is explainable from the row forever, config edits never restate it.

### Recognition methods (per element; default from new `item.revenueRecognitionMethod`, overridable per line pre-approval)

1. **Point in Time** (default — today's behavior, made allocation-aware). Recognition event = shipment posting for inventory lines (control transfers), invoice posting otherwise. If billing and the event land in the same period and allocated = billed, the invoice credits revenue directly (no deferral churn). Otherwise billing defers (below) and one `Actual` schedule row dated at the event releases it.
2. **Straight Line.** New `salesOrderLine.serviceStartDate/serviceEndDate` define the period; schedule rows generated per accounting period, first/last prorated by days. Billing converts Forecast rows to Actual up to the billed amount (oldest first).
3. **Percent of Completion (cost-to-cost)** — for elements whose sales order line spawned a job (`job.salesOrderLineId` linkage, [20250124174744_add-sales-order-line-to-jobs.sql](packages/database/supabase/migrations/20250124174744_add-sales-order-line-to-jobs.sql)):
   - **Actual cost to date** = Σ `journalLine.amount` where `accountId = accountDefault.workInProgressAccount` AND `documentId = job.id` AND `amount > 0` — the *debit inflows* (Job Consumption material, Production Event labor/machine), deliberately excluding WIP relief credits so shipping to stock doesn't un-earn revenue. Same subledger query `close-job` already trusts.
   - **Estimate at completion (EAC)** = Σ `jobMaterial.estimatedQuantity × unitCost` + Σ `jobOperation` (setup/labor/machine hours × `laborRate`/`machineRate` + `overheadRate`) — the `JobEstimatesVsActuals.tsx` math, extracted into a `getJobCostProgress` RPC — floored at actual-to-date (EAC can only grow past estimate, never fall below cost incurred).
   - `pctComplete = LEAST(actual / NULLIF(EAC, 0), 1)`; cumulative revenue = `pctComplete × allocatedAmount`; the run posts the delta vs previously recognized. EAC drift therefore self-corrects as a **cumulative catch-up in the current open period** — closed periods are never restated.
   - Job `Completed` or closed via `close-job` ⇒ force 100% (remaining allocation recognizes in that period's run).
   - POC schedule rows are not pre-spread: each run inserts the period's `Actual` delta row; `Forecast` rows for RPO/waterfall are projected from `job.dueDate` and replaced as actuals post.

### Posting model

**Accounts** (per the control-account lesson — resolved by id via `accountDefault`, never by number at posting time):
- `accountDefault.deferredRevenueAccount` → backfilled to seeded **2160 Deferred Revenue** (finally gets its writer).
- `accountDefault.contractAssetAccount` → new seeded **1145 Contract Assets** (current-assets group, parent resolved by `isGroup = TRUE AND name`, per lesson `20260630093809` precedent).
- Deposits use existing `accountDefault.prepaymentAccount` → **2110 Customer Prepayments** (already seeded and mapped, currently writerless on the AR side).

**Billing (deferral).** `post-sales-invoice` change: for a line whose element defers (any method when the recognition event hasn't fully occurred), the revenue credit swaps `salesAccount` → `deferredRevenueAccount` for the pre-tax amount; AR debit unchanged; COGS logic untouched (v1 — see OQ-N1). Lines with no element (flag off, or non-arrangement companies) post exactly as today. Base-currency amounts freeze at the invoice `exchangeRate` — deferred revenue is nonmonetary, released at historical rate.

**Recognition run (monthly).** `runRevenueRecognition(client, { companyId, accountingPeriodId, userId })`:
1. Refresh POC deltas (`getJobCostProgress`) and convert billed Forecast → Actual rows.
2. Select due rows: `planType = 'Actual'`, `status = 'Planned'`, `scheduledDate ≤ period end`.
3. Generate **one Draft journal** — `sourceType: 'Revenue Recognition'` (new `journalEntrySourceType` value, an *accounting* source under the period-close matrix, so it posts into Locked periods with `update: accounting`) — lines `Dr deferredRevenueAccount / Cr salesAccount` per element, `documentId = revenueArrangementId`, dimensions copied from the source invoice lines (Customer/Item/Location, `journalLineDimension`).
4. **Contract-asset reclass** (NetSuite deferred-revenue reclassification pattern): per arrangement, when cumulative recognized > cumulative billed (POC ahead of billing), append auto-reversing lines `Dr contractAssetAccount / Cr deferredRevenueAccount` for the excess, so 2160 never presents a debit balance and 1145 rolls forward per period.
5. Stamp `journalId` on the rows; posting the journal through the existing `postJournalEntry` surface (which already carries the period gate, immutability triggers, and — when readiness MW-2 lands — the approval engine) flips rows to `Posted`. Voiding/deleting the Draft journal un-stamps.

Corrections are reversal-only, inheriting the period-closing spec's rules (reversals date into the current open period).

### Customer deposits

`payment` (type `Receipt`) gains nullable `salesOrderId`. A posted receipt with `salesOrderId` and no invoice applications credits `prepaymentAccount` (2110) instead of AR — a true contract liability, per-order traceable. Applying the deposit to a posted invoice (`paymentApplication`) posts `Dr 2110 / Cr receivablesAccount`. Deposits are *not* revenue events — they never touch 2160 or schedules; they appear in the contract-liability rollforward as their own column. Unapplied ordinary receipts (no `salesOrderId`) keep today's AR-credit behavior; the rollforward footnotes them (v1 reports-only; auto-reclass deferred).

### Contract modifications (ASC 606-10-25-12/13)

Editing an approved arrangement's sales order (line added/removed, qty/price change) triggers `reallocateArrangement`:
- **Prospective (separate-contract treatment):** a *new* line for a distinct good/service priced within `sspTolerancePercent` of its SSP becomes a new element with its own allocation; existing elements untouched.
- **Cumulative catch-up:** everything else — re-run relative-SSP allocation over the updated transaction price; posted schedule rows are immutable; unposted rows regenerate; the difference between the new required-cumulative and posted-to-date lands as catch-up lines in the next recognition run, in the current open period.
- The system proposes the treatment from the rules above; an accountant with `update: accounting` can override before confirming; the choice + before/after allocation snapshot is audit-logged (`.ai/rules/audit-log-system.md`).

### Reports (all read schedules + `journalLine`, tie to GL)

1. **Deferred revenue waterfall** — opening 2160 balance per element/arrangement, then future-period columns from unposted Actual + Forecast rows. Answers "when does the balance sheet unwind."
2. **Contract asset/liability rollforward** — per period, per arrangement: opening, + billings deferred, + deposits received, − revenue recognized, ± reclass, closing; split asset (1145) / liability (2160 + 2110); totals tie to the trial balance (auditors' first request — GAP-1).
3. **Remaining performance obligations** — Σ unrecognized allocated amount per arrangement, bucketed by expected timing from Forecast rows (≤1yr / 1–2yr / >2yr) — the ASC 606-10-50-13 backlog disclosure, which for Carbon doubles as a financially-credible production backlog.

### Close integration (registration, never a parallel mechanism)

Per the period-closing spec §NetSuite-style close checklist: this feature **seeds a `periodCloseTaskDefinition`** — name "Recognize revenue for the period", `taskType: 'Auto'`, `autoCheckKey: 'unposted-revenue-schedules'`, `severity: 'Warning'`, `isSystem: true`, sorted after depreciation (task 4) — via migration for existing companies + `seed-company` for new ones. The evaluator joins `getPeriodCloseReadiness`: fails when Actual schedule rows with `scheduledDate ≤ period end` are unposted (companies with the flag off trivially pass). Warning severity means skip-with-reason is possible (matches depreciation's posture); the row records the sign-off in the close binder.

### Interplay

- **Tax:** transaction price and all deferral/recognition amounts are **net of tax** — the tax spec strips tax from the revenue credit; this spec consumes the same pre-tax base. No tax rows ever touch 2160.
- **Period close & immutability:** recognition journals are *accounting*-source, period-gated, immutable once posted, reversal-only — all inherited, nothing re-implemented.
- **IFRS 15:** converged with ASC 606 at this feature's altitude; residual differences (licensing nuances, contract-cost impairment reversal) become policy switches when GAP-5 multi-book lands — no schema here precludes them.
- **Multi-book:** schedules and journals are book-agnostic v1; `journal.bookId` (readiness Phase 0) stamps them into `PRIMARY` automatically.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Multi-tenancy (heuristic 1) | All four new tables: `companyId`, composite PK `("id","companyId")`, `id()` prefixes, audit columns; child FKs reference composites | House convention; tax-spec precedent |
| 2 | Service shape (heuristic 2) | All service functions in **`accounting.service.ts`/`accounting.models.ts`**, `(client, ...)` → `{data, error}`, never throw | **Module ownership call: accounting, not sales.** The outputs are journals, control accounts, a close task, and financial reports — all accounting-owned; the tax spec set the precedent of accounting owning cross-cutting financial config while stamping sales documents. Sales/invoicing get only thin hooks (arrangement creation on release, deferral swap at posting). |
| 3 | RLS (heuristic 3) | Four standard policies per table; SELECT `get_companies_with_employee_role()`, writes `get_companies_with_employee_permission('accounting_*')`; schedule/element writes flow through service-role posting paths but policies defined for completeness | Tax-ledger precedent |
| 4 | Permissions (heuristic 4) | Arrangement/SSP/report routes `view/update: "accounting"`; arrangement creation + deferral run inside existing sales/invoicing document permissions; reallocation override `update: "accounting"` | Matches tax determination posture: config audited, document flow unblocked |
| 5 | Forms (heuristic 5) | `ValidatedForm` + zod (`revenueArrangementValidator`, `standaloneSellingPriceValidator`, …) + route actions with `intent`; Drawer overlays for arrangement detail | House convention |
| 6 | Module layout (heuristic 6) | No new module; `modules/accounting/ui/RevenueRecognition/`, routes `x+/accounting+/revenue-*`; hooks in `post-sales-invoice`, `post-payment`, order-release service | One service/models file per module |
| 7 | Backward compatibility (heuristic 7) | Gated by `companySettings.revenueRecognitionEnabled` (default **false**): flag off ⇒ posting byte-identical to today; new columns nullable/defaulted; enum values additive; views untouched; enablement is prospective (open orders get arrangements only via an explicit backfill action, not automatically) | Frozen posting surfaces change only behind the flag |
| 8 | Vocabulary & shape | NetSuite ARM (arrangement/element/plan/SSP), with the plan header collapsed into element + schedule until multi-book | Research: ARM is the system mid-market companies actually IPO on; collapsing the plan removes a join with zero information v1 |
| 9 | Arrangement granularity | One arrangement per sales order; element per line | The SO is Carbon's contract document; multi-SO combination (ASC 606-10-25-9) deferred until demanded |
| 10 | POC actuals source | GL WIP debit inflows by `documentId = jobId` (close-job's own query, debit-side only) | Single source of truth already trusted for variance relief; no parallel job-cost ledger to reconcile |
| 11 | EAC source | `jobMaterial`/`jobOperation` estimate math via `getJobCostProgress` RPC, floored at actuals | Same numbers the Estimates-vs-Actuals UI shows planners; floor prevents >100% |
| 12 | Deferral timing | Billing defers to 2160; recognition run releases; contract asset via auto-reversing reclass | NetSuite ARM pattern exactly; keeps 2160 credit-normal and 1145 roll-forwardable |
| 13 | Deposits | `payment.salesOrderId` → post to existing 2110 `prepaymentAccount`; application relieves to AR | Reuses seeded account + AR/AP payment machinery (`20260630093809`); no new document type |
| 14 | Control accounts | New `accountDefault.deferredRevenueAccount` (→2160) + `contractAssetAccount` (→ new 1145), seeded + backfilled, resolved by id | `.ai/lessons.md` control-account rule |
| 15 | Recognition journal surface | Generate Draft JE, post via existing `postJournalEntry` | Inherits period gate, immutability, numbering, and future MW-2 approval for free — no parallel poster |

## Data Model Changes

One migration (`pnpm db:migrate:new revenue-recognition`), then `pnpm run generate:types`:

```sql
CREATE TYPE "revenueRecognitionMethod" AS ENUM ('Point in Time', 'Straight Line', 'Percent of Completion');
CREATE TYPE "revenueArrangementStatus" AS ENUM ('Draft', 'Approved', 'Closed');
CREATE TYPE "revenuePlanType" AS ENUM ('Forecast', 'Actual');
CREATE TYPE "revenueScheduleStatus" AS ENUM ('Planned', 'Posted');
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Revenue Recognition';

CREATE TABLE "revenueArrangement" (
  "id" TEXT NOT NULL DEFAULT id('rvar'),
  "companyId" TEXT NOT NULL,
  "arrangementId" TEXT NOT NULL,                -- readable, from sequence
  "salesOrderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "revenueArrangementStatus" NOT NULL DEFAULT 'Draft',
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC(10,5) NOT NULL DEFAULT 1,
  "transactionPrice" NUMERIC(16,5) NOT NULL DEFAULT 0,   -- net of tax, document currency
  "approvedBy" TEXT REFERENCES "user"("id"),
  "approvedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "revenueArrangement_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueArrangement_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "revenueArrangement_salesOrder_key" UNIQUE ("companyId", "salesOrderId")
);
ALTER TABLE "revenueArrangement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revenueArrangement_SELECT" ON "revenueArrangement" FOR SELECT USING (
  "companyId" = ANY (get_companies_with_employee_role())
);
CREATE POLICY "revenueArrangement_INSERT" ON "revenueArrangement" FOR INSERT WITH CHECK (
  "companyId" = ANY (get_companies_with_employee_permission('accounting_create'))
);
CREATE POLICY "revenueArrangement_UPDATE" ON "revenueArrangement" FOR UPDATE USING (
  "companyId" = ANY (get_companies_with_employee_permission('accounting_update'))
);
CREATE POLICY "revenueArrangement_DELETE" ON "revenueArrangement" FOR DELETE USING (
  "companyId" = ANY (get_companies_with_employee_permission('accounting_delete'))
);

CREATE TABLE "revenueElement" (
  "id" TEXT NOT NULL DEFAULT id('rvel'),
  "companyId" TEXT NOT NULL,
  "arrangementId" TEXT NOT NULL,
  "salesOrderLineId" TEXT NOT NULL,
  "itemId" TEXT,
  "jobId" TEXT,                                  -- POC linkage via job.salesOrderLineId
  "recognitionMethod" "revenueRecognitionMethod" NOT NULL DEFAULT 'Point in Time',
  "extendedPrice" NUMERIC(16,5) NOT NULL,        -- stated, net of tax
  "ssp" NUMERIC(16,5),
  "sspSource" TEXT,                              -- 'Stated' | 'List Price' | 'Invoice Price' | 'Residual'
  "allocatedAmount" NUMERIC(16,5),
  "serviceStartDate" DATE,
  "serviceEndDate" DATE,
  "recognizedAmount" NUMERIC(16,5) NOT NULL DEFAULT 0,   -- maintained on posting, base currency
  "billedAmount" NUMERIC(16,5) NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueElement_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueElement_arrangement_fkey" FOREIGN KEY ("arrangementId", "companyId")
    REFERENCES "revenueArrangement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "revenueElement_line_key" UNIQUE ("companyId", "salesOrderLineId")
);
-- + same four RLS policies (accounting_*)

CREATE TABLE "itemStandaloneSellingPrice" (
  "id" TEXT NOT NULL DEFAULT id('ssp'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "price" NUMERIC(16,5) NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'Stated',       -- 'Stated' | 'List Price'
  "effectiveDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "expirationDate" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "itemStandaloneSellingPrice_pkey" PRIMARY KEY ("id", "companyId")
);
-- + four RLS policies (accounting_*)

CREATE TABLE "revenueRecognitionSchedule" (
  "id" TEXT NOT NULL DEFAULT id('rvsc'),
  "companyId" TEXT NOT NULL,
  "elementId" TEXT NOT NULL,
  "planType" "revenuePlanType" NOT NULL DEFAULT 'Forecast',
  "status" "revenueScheduleStatus" NOT NULL DEFAULT 'Planned',
  "scheduledDate" DATE NOT NULL,
  "accountingPeriodId" TEXT REFERENCES "accountingPeriod"("id"),
  "amount" NUMERIC(16,5) NOT NULL,               -- base currency, historical rate
  "isCatchUp" BOOLEAN NOT NULL DEFAULT false,    -- POC/EAC drift or modification re-spread
  "journalId" TEXT,                              -- stamped by the recognition run
  "salesInvoiceId" TEXT,                         -- billing that funded this Actual row
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionSchedule_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionSchedule_element_fkey" FOREIGN KEY ("elementId", "companyId")
    REFERENCES "revenueElement"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "rvsc_due_idx" ON "revenueRecognitionSchedule"
  ("companyId", "status", "planType", "scheduledDate");
-- + four RLS policies (accounting_*)

-- Column additions
ALTER TABLE "item" ADD COLUMN "revenueRecognitionMethod" "revenueRecognitionMethod" NOT NULL DEFAULT 'Point in Time';
ALTER TABLE "salesOrderLine" ADD COLUMN "serviceStartDate" DATE, ADD COLUMN "serviceEndDate" DATE;
ALTER TABLE "payment" ADD COLUMN "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL;
ALTER TABLE "companySettings"
  ADD COLUMN "revenueRecognitionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sspFallback" TEXT NOT NULL DEFAULT 'List Price',
  ADD COLUMN "sspTolerancePercent" NUMERIC(5,4) NOT NULL DEFAULT 0.05;
ALTER TABLE "accountDefault"
  ADD COLUMN "deferredRevenueAccount" TEXT,
  ADD COLUMN "contractAssetAccount" TEXT;

-- Seeds/backfills: insert account 1145 'Contract Assets' per company (parent by
-- "isGroup" = TRUE AND name, per lessons); backfill deferredRevenueAccount → account 2160
-- and contractAssetAccount → 1145 by id; mirror both in seed.data.ts + seed-company.
-- Seed periodCloseTaskDefinition ('Recognize revenue for the period', 'Auto',
-- 'unposted-revenue-schedules', severity 'Warning', isSystem TRUE) per company + seed-company.
-- Sequence row for arrangementId ('RA-%{yyyy}-') per company.
```

Notes: `revenueElement.recognizedAmount`/`billedAmount` are maintained denormalizations (updated in the same transaction as posting/stamping) so reports and RPO don't re-aggregate schedules on every render. No views select from the touched tables' changed columns (verify at implementation; DROP/recreate with `SELECT *` if any do).

## API / Service Changes

All in `apps/erp/app/modules/accounting/accounting.service.ts` + `accounting.models.ts`:

```ts
createRevenueArrangement(client, { companyId, salesOrderId, userId })       // idempotent; hook on order release
allocateRevenueArrangement(client, { arrangementId, companyId, userId })    // SSP resolve + relative allocation + residual + range expedient
approveRevenueArrangement(client, { arrangementId, companyId, userId })     // blocks on unresolvable SSP; auto for single-element
reallocateArrangement(client, { arrangementId, companyId, userId, treatment?: "prospective" | "catchUp" })
getJobCostProgress(client, { jobId, companyId })     // → { actualToDate, eac, pctComplete } (RPC-backed)
generateRecognitionSchedules(client, { elementId, companyId })              // straight-line spread / PIT event row / POC forecast
runRevenueRecognition(client, { companyId, accountingPeriodId, userId })    // → { data: draftJournalId } (steps in §Posting model)
get/upsert/deleteStandaloneSellingPrice(...)
getRevenueArrangements / getRevenueArrangement / getDeferredRevenueWaterfall /
getContractBalanceRollforward / getRemainingPerformanceObligations(client, companyId, ...)
```

Callers/hooks to update:
- **`post-sales-invoice`** (edge fn): line-level deferral swap (`salesAccount` → `deferredRevenueAccount`) when a `revenueElement` defers; converts Forecast → Actual schedule rows for the billed amount; bumps `billedAmount`. VOID reverses symmetrically.
- **`post-shipment`**: marks the point-in-time recognition event for inventory elements (dates the Actual row).
- **`post-payment`** (edge fn): deposit branch — `salesOrderId` set + no applications ⇒ credit `prepaymentAccount`; application posting relieves 2110 → AR.
- **Order release / `convertQuoteToOrder` path** (sales service): `createRevenueArrangement` hook behind the flag.
- **`close-job` / job completion**: emits the existing job-status change; the recognition run reads status — no new posting inside `close-job`.
- **`getPeriodCloseReadiness`**: new evaluator `unposted-revenue-schedules`.

Routes (new, `apps/erp/app/routes/x+/accounting+/`): `revenue-arrangements.tsx` (+ `$arrangementId.tsx` drawer with elements/allocation/schedules, actions `approve | reallocate`), `revenue-recognition.run.tsx` (period picker → generate Draft JE), `ssp.tsx` (SSP catalog CRUD), `revenue-reports.(waterfall|rollforward|rpo).tsx`. All `view/update: "accounting"`.

## UI Changes

- **Revenue Arrangements** table + drawer: status badge, transaction price, allocation table (stated vs SSP vs allocated, `sspSource` chip), per-element method/progress bars (billed vs recognized), POC elements show `pctComplete` with actual/EAC drill to the job.
- **Recognition run** page: due-schedule preview grouped by arrangement (incl. catch-up rows flagged), "Generate journal" → links to the Draft JE for review/post.
- **SSP catalog** settings page; **item form** gains the recognition-method select; **sales order line** form gains service dates (visible when method = Straight Line).
- **Sales order** side panel: arrangement status card (accounting-linked, read-only for sales roles); **payment form** gains optional Sales Order (deposit) field.
- **Reports**: three report pages per §Reports, CSV export via the standard table-export surface.
- Flash messages on all transitions per `.ai/rules/flash-system.md`.

## Acceptance Criteria

- [ ] With `revenueRecognitionEnabled = false`, posting a sales invoice produces journal lines byte-identical to today (revenue to `salesAccount`); no arrangement rows are created.
- [ ] Releasing a 3-line order (machine $80k SSP $90k, install $10k SSP $15k, 12-mo support $10k SSP $15k) creates one arrangement with 3 elements and allocates $75k/$12.5k/$12.5k (relative SSP, largest-remainder, Σ = $100k exactly).
- [ ] An element without SSP takes the residual when it is the only one missing; two missing SSPs block approval with a named-item error.
- [ ] Invoicing a Straight Line element (service 2026-07-15 → 2027-01-14) credits 2160, and schedules 7 rows with first/last prorated by days, summing exactly to the allocated amount.
- [ ] A POC element whose job has $40k actual WIP debits against a $100k EAC recognizes 40% × allocated in the run; raising material actuals to $60k next period recognizes exactly the 20-point delta (cumulative catch-up, no restatement of the prior posted journal).
- [ ] Completing the job (or `close-job`) forces the element to 100% in that period's run.
- [ ] `runRevenueRecognition` creates one Draft journal (`sourceType 'Revenue Recognition'`) with `Dr 2160 / Cr 4010` lines carrying Customer/Item/Location dimensions; posting it flips schedule rows to `Posted`; running twice for the same period generates nothing the second time (idempotent via `journalId` stamps).
- [ ] When recognized > billed on an arrangement, the run adds auto-reversing `Dr 1145 / Cr 2160` lines; the balance-sheet 2160 line never shows a debit balance.
- [ ] With June **Locked**, the recognition journal posts (accounting source); with June **Closed**, posting fails with the period error.
- [ ] A Receipt payment with `salesOrderId` and no applications credits 2110 (not AR); applying it to the order's posted invoice posts `Dr 2110 / Cr 1110` and the deposit disappears from the rollforward's deposit column.
- [ ] Adding a new distinct line at SSP to an approved arrangement leaves existing allocations untouched (prospective); a 10% price cut on an existing line re-spreads with a catch-up row in the next run and writes an audit-log entry with before/after allocations.
- [ ] The close checklist shows "Recognize revenue for the period" auto-failing while due unposted schedules exist and passing after the run's journal posts; a flag-off company sees it pass trivially.
- [ ] Rollforward closing balances tie to the trial balance for 2160, 2110, and 1145 for a period with mixed activity; RPO buckets sum to Σ(allocated − recognized).
- [ ] `pnpm run generate:types`, scoped `typecheck`, and `pnpm run lint` pass; migration applies idempotently twice.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| EAC garbage-in (jobs with $0 or stale estimates) → wild POC swings | High | `pctComplete` guards (EAC floored at actuals, capped 100%); run preview shows per-element deltas before journal generation; elements with EAC = 0 recognize nothing and surface a warning row |
| Deferral swap in `post-sales-invoice` regresses non-rev-rec companies | High | Behavior strictly behind element existence + company flag; AC #1 pins byte-identical output; VOID path covered in tests |
| WIP debit-inflow query double-counts reversal/void journals | Med | Exclude journals with `reversalOfId`/VOID descriptions from the actuals sum; AC test with a voided consumption |
| Schedule/GL drift (journal posted but rows not flipped, or vice versa) | Med | Stamp + flip in one transaction keyed by `journalId`; rollforward report reconciles schedules vs 2160 and flags variances |
| Modification re-spread on heavily-billed arrangements produces large catch-ups users don't expect | Med | Confirmation dialog shows the catch-up amount before accepting; audit log snapshot; treatment override |
| FX: deferral frozen at invoice rate diverges from current-rate intuition | Low | Documented (nonmonetary liability, ASC 830-consistent); per-invoice `salesInvoiceId` on rows makes rate provenance traceable |

## Open Questions

> Resolutions recorded; two genuinely-new blocking questions at the end remain open.

- [x] **Scope: reduced cut (deferral + deposits + POC, no SSP) vs full ASC 606 model?** — **Answer:** Brad, 2026-07-04: "the more complete plan" — full model including arrangements, performance obligations, and relative-SSP allocation with configurable determination + residual fallback. GAP-1's deferred-SSP note is superseded.
- [x] **Is cost-to-cost POC in v1, and what drives it?** — **Answer:** Brad, 2026-07-04: full model incl. SSP allocation; POC ships v1 driven by existing job-costing actuals (GL WIP inflows by `documentId = jobId`) over `jobMaterial`/`jobOperation` EAC — Carbon's differentiator vs AI-GL startups (research §market timing).
- [x] **Contract modifications in v1?** — **Answer:** Yes (full model) — prospective vs cumulative catch-up per ASC 606-10-25-12/13, system-proposed with accountant override; closed periods never restated.
- [x] **Close-checklist integration mechanism** — **Answer:** Register a seeded `periodCloseTaskDefinition` with `autoCheckKey 'unposted-revenue-schedules'` — the period-closing spec's 2026-07-04 revision built the registration surface precisely so features like this never build a parallel mechanism.
- [x] **Are recognized amounts gross or net of tax?** — **Answer:** Net — the multi-jurisdiction tax spec removes tax from the revenue credit; transaction price, allocation, deferral, and recognition all operate on the pre-tax base.
- [x] **IFRS 15 divergences now?** — **Answer:** Policy switches later; ASC 606/IFRS 15 are converged at this altitude, and per readiness GAP-5 phasing, book-level divergences wait for multi-book (adjustment books).
- [x] **Deposit modeling: new document type vs payment extension?** — **Answer:** Extend `payment` with `salesOrderId` and post to the existing seeded 2110 `prepaymentAccount` — reuses the week-old AR/AP payment machinery; no new document.

- [x] **OQ-N1 (blocking): POC cost matching — does v1 also move COGS timing?** Recognizing POC *revenue* monthly while COGS still posts at shipment (today's `post-shipment`/MTO flow) misstates in-period margin: months with recognition but no shipment show 100% margin, the shipment month shows a cost cliff. Proper ASC 606 over-time treatment expenses costs as incurred (`Dr COGS / Cr WIP` for the period's incurred cost in the same recognition run, with shipment/`close-job` skipping COGS for POC elements to avoid double-posting) — but that changes the WIP/inventory flow, which is GAP-3 (inventory valuation) territory and production-critical schema behavior. **Recommendation:** ship COGS-as-incurred for POC elements in v1 (auditors will not accept the mismatch), coordinated with the GAP-3 spec. Needs Brad's call before implementation. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Yes — v1 moves COGS to as-incurred for POC elements (Dr COGS / Cr WIP inside the recognition run; shipment skips COGS for POC elements). Coordinate with the inventory-valuation workstream (#1040).
- [x] **OQ-N2 (blocking): revenue timing vs invoice for point-in-time inventory elements.** When shipment (control transfer) and invoicing land in *different* periods, v1 as specified defers at invoice and releases at the shipment-dated event — but if shipment precedes the invoice (ship June, invoice July), recognizing in June requires accruing unbilled revenue (`Dr 1145 / Cr 4010`) *before any invoice exists*, i.e. recognition entirely decoupled from billing for ordinary goods. **Recommendation:** v1 recognizes at the *later* of shipment/invoice for point-in-time elements (conservative, zero unbilled-accrual machinery for the common flow; the contract-asset reclass already covers POC); full ship-then-bill accrual in v1.1. Confirm the simplification is acceptable for the first release. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Ambitious — recognize at shipment (control transfer) with unbilled-receivable/contract-asset accrual machinery in v1. Back out to later-of-shipment-and-invoice at plan stage.

## Changelog

- 2026-07-04: Created — full ASC 606 model per Brad's 2026-07-04 scope resolution ("the more complete plan", incl. SSP allocation). Grounded in codebase exploration (post-sales-invoice revenue posting, dead 2160 seed, accountDefault/prepayment plumbing, job WIP-by-documentId costing, close-job, jobMaterial/jobOperation estimates, AR/AP payment tables) and `.ai/research/public-company-compliance.md` (NetSuite ARM vocabulary and reclass pattern). Registers into the period-closing spec's checklist substrate. Two new blocking questions (POC COGS timing; ship-before-bill recognition) recorded unchecked.
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
