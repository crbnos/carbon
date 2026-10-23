---
paths:
  - "apps/erp/app/modules/sales/sales.service.ts"
  - "apps/erp/app/modules/sales/contract-clin.ts"
  - "packages/ee/src/project-revenue/**"
  - "apps/erp/app/modules/accounting/project-revenue.ts"
  - "apps/erp/app/modules/accounting/ui/RevenueRecognition/ProjectRevenueProgress.ee.tsx"
  - "packages/utils/src/project-billing.ts"
  - "packages/jobs/src/invoicing/contract-funding.ts"
  - "apps/erp/app/modules/sales/ui/Contracts/ContractLineBilling*.tsx"
  - "apps/erp/app/modules/projects/ui/Billing/**"
---

# Project billing (Phases 4a and 4b)

A customer contract line bills project work, and the monthly revenue recognition
run recognizes its revenue and relieves its Project WIP. Spec
`.ai/specs/implemented/2026-10-09-project-billing.md`; plans
`.ai/plans/2026-10-09-project-billing-phase-4a.md` (decisions P1–P15) and
`.ai/plans/2026-10-09-project-billing-phase-4b.md` (decisions R1–R11), each with its
*Execution notes*. The 2 phases ship in the same release: 4a alone posts T&M
invoices to Deferred Revenue, and nothing recognizes them.

## The line

`customerContractLine.billingMethod` (`contractBillingMethod`): `Fixed` (the
schedule, as before), `Time & Materials` or `Cost Plus`. A billing line (T&M or
Cost Plus) has no schedule (`planInvoiceSchedule` and the schedule writers skip
it, `isProgressRevenueMethod` keeps it out of the revenue plan) and these columns
(migration `20261021005900_project-billing.sql`):

- `projectElementId`: the **billing element**; the line bills its whole subtree.
  FK `(projectElementId, projectId, companyId)`.
- `materialHandlingPercent` (T&M) and `feePercent` (Cost Plus), 0–1.
- `fundedAmount` (the billing stop), `fundedCost` (the notice base, without the
  fee), `ceilingAmount`, `noticePercent` (0.75–0.85), `noticeWindowDays` (30–90),
  and `thresholdNoticeFundedCost` / `runOutNoticeFundedCost` (the funded cost each
  notice went out for, P13).

CHECKs: a billing line has a project and a billing element, quantity > 0, rate 0 and
`revenueType` One-time (`customerContractLine_billing_check`; `quantity = 1` until
`20261023024353_prototype-clins.sql`, which allows a Part line's units); Cost Plus needs a
fee; the revenue method follows the billing method (P6: Fixed → Daily, Even Period
or Percent Complete; T&M → Right to Invoice; Cost Plus → Percent Complete or Right
to Invoice); Percent Complete needs a billing element. The ERP mirrors them in
`checkBillingTerms` (`sales.models.ts`, `contractRevenueMethodsByBillingMethod`),
and `upsertContractLine` forces rate 0 and One-time for a billing line, and quantity 1
unless the line names a Part (see Part CLINs below).

A billing line lives on a **project contract** (`customerContract.billingBasis =
'Project'`, migration `20261021013300_contract-billing-basis.sql`; spec
`.ai/specs/2026-10-21-project-contracts.md`). A service contract (`Schedule`) takes only
`Fixed` lines, and every project contract line is One-time; a project contract's `Fixed`
line is labelled "Fixed Price", has quantity 1 and its `rate` as the price (a Part line:
its quantity, at `rate` per unit), and bills on
its schedule rows ("billing events", edited in `ContractInvoiceGrid` on the Invoicing
step). An amend `change` of a Fixed Price line (any One-time line, either kind of
contract) ends it the day before it starts and its copy bills only the new price less
what the line and the lines it replaced (`amendsLineId`) billed — `Invoiced` and
`Billed Externally` rows, `chainBilled` / `replacedLineBilled` in
`reconcileContractSchedule` — as ONE row on the first invoice date from the change; the
remaining events are not kept. Amend refuses a new price below what was billed (a
one-time line has no credit adjustment) and an `end` of an invoiced one-time line. The
old line keeps its revenue window (`revenueEndDate` is set to its old end), so each line
earns what it bills over the same days; a Percent Complete copy is priced at the
chain's total (ee: the copy's schedule rows plus the replaced lines' billed rows).
`billingBasisMismatch` (`@carbon/database/contract-schedule`) is the one test:
`upsertContractLine` and `insertContractLines` refuse with
`CONTRACT_BILLING_BASIS_MISMATCH`, and `post-customer-contract` refuses at Confirm and for
an added line at Amend, with `billingBasisMismatchMessages`. The project contract screens
are in `apps/erp/app/modules/sales/AGENTS.md` → Contracts → "Billing basis".

Confirm and amend (`post-customer-contract`, `checkBillingLines`) refuse a billing
line whose element is the same as, an ancestor of or a descendant of another live
billing line's element (P7), a non-Contract project, and a contract currency other
than the base currency (P5). A Fixed Percent Complete line takes part in the P7
overlap check (both ways round), though not in the billing-element and cost
treatment checks: two progress lines on one branch over the same dates would earn
revenue on, and relieve, the same cost. Amend refuses a `change` of a billing line and allows
`add` and `end` (P9). Funding changes through **Edit Funding**
(`updateContractLineFunding`, Draft or Active). Confirm's revenue check
(`refuseRevenueResiduals`) and the contract page's `revenueResiduals` skip Right to
Invoice and Percent Complete lines (`isProgressRevenueMethod`): they have no planned
revenue, so a Fixed Percent Complete line's billed total is not a residual. Before this,
Confirm refused every Fixed Percent Complete line.

## Bill rates

`resolveBillRate` (`@carbon/utils` `project-billing.ts`), most specific first, each
effective-dated: `customerContractLaborRate` for the line and employee, then for the
line and labor category, then `laborCategoryRate.billRate`. No rate → the item is
On Hold with `BILLABLE_REASON_NO_BILL_RATE`. RLS of `customerContractLaborRate`:
`company("sales", { read: "sales_view" })`.

## Billable items

`projectBillableItem` rows with `customerContractLineId`. The hold reasons live in
`statusReason` (P3; no `holdReason` column): "No bill rate", "No hours", "Funding
limit" or a user's note.

- **T&M at posting.** `insertProjectLedgerRows` (`projects/project-posting.ts`) loads the
  live billing lines once (`loadContractBillingContext`) and writes an item per row
  under a T&M line (`buildContractBillableItem`, `priceTimeAndMaterialsItem`): Labor
  = hours × bill rate, Material and other direct cost × (1 + handling), Machine,
  Overhead and Burden not billed. A reversal (`reverseProjectLedgerRows`) reverses
  the item.
- **Cost Plus from the commercial generator** (P1). Posting writes no Cost Plus
  item: `buildContractBillableItem` returns null for a Cost Plus line.
  `generateCostPlusItems` (`@carbon/ee/project-revenue.server`) prices cost × (1 +
  fee) for every cost type; it degrades (`gated: true`) without `PROJECT_REVENUE`.
  It bills only the rows of the line's own dates, `startDate <= postingDate <=
  min(through, endDate)`: a row an earlier line on the element covered is never
  billed again, and an ended line still bills a row of its dates posted after it
  ended (the T&M path clamps `through` the same way).
  The nightly job and the line's **Generate Billable Items** (the
  `generateContractBillableItems` operation, `sales.server.ts`) call it.
- **The T&M backfill.** `generateTimeAndMaterialsItems` writes items for subtree
  rows posted from the line's `startDate` through `through` that have none
  (`selectRowsToBill`, which pairs reversals over every row first). A row dated
  before the start gets no item, as at posting (P8): an earlier line on the
  element (an ended Fixed Price line, say) covered it. It runs
  at confirm and at an amend `add` (P15), from **Generate Billable Items**
  (`generate-contract-billable-items`), and inside `create-project-billing-invoices`
  before it reads items.
- **SQL rows reach review at the next invoice run.** `complete_job_to_inventory`
  and `backflush_job_materials` insert `projectLedger` rows in SQL, so they get no
  item at posting. The backfill gives them their T&M item:
  `create-project-billing-invoices` runs it for each T&M line before it reads the
  items, so those rows reach the review list on the next invoice run, not at
  posting. **Generate Billable Items** on the line's billing page does it at once.
- Pricing is exact (P10): every item is quantity 1 at the priced amount, except a
  T&M labor item (hours × rate). A Cost Plus labor item stores quantity = hours.

## Review and the audit log

Billing review is the **Billing** tab of Projects → **Approvals**
(`projects+/approvals.tsx?tab=billing`; the loader reads only the open tab's rows, and
with no status filter shows Unbilled and On Hold). The tab needs what the page needs,
`update: projects`. `projects+/billing.tsx` is a loader-only redirect to that tab that
keeps the query (`redirectBeforeLoaders`). The sidebar lists Approvals while time
approval or DCAA is on, or while contract billable items are Unbilled or On Hold
(`useProjectsSubmodules`): `getBillingReviewCountForUser` (`projects.service.ts`, one
`count: exact, head: true` read on `projectBillableItem` with `customerContractLineId` set)
returns that count, 0 for a user without `update: projects` and `view: sales`. Both
projects layouts (`projects+/_layout.tsx`, `project+/_layout.tsx`) load it as
`billingReviewCount`, and the Approvals count adds it to the time count. The line billing
page and the project Overview's Needs attention row link the tab. The project **Billing**
page lists the project's items too. Both use `ProjectBillableItemsTable`; the bulk actions post to
`projects+/billing.update.tsx` (`update: projects`) → `updateProjectBillableItems`:
hold (reason), release, write off (reason), price (one item;
`amount = round(quantity × unitPrice)`; releases a "No bill rate" hold). Billed and
Written Off items are refused.

Every change reaches the audit log ("Billable Item"): the table is in `auditConfig`
AND has `events: true` in `event-system/attachments.ts` (migration
`20261021010100_project-billable-item-audit-events.sql`). The config alone attaches
no trigger.

## Invoicing

`create-project-billing-invoices` (`{ asOf, customerContractId? }`, `update: sales` +
`create: invoicing`) is a source of the recurring invoicing layer. Per Active contract
with a billing line that started on or before `asOf`:

1. the period end is the latest billing grid date on or before `asOf`;
2. the T&M backfill runs for each T&M line through the period end;
3. Unbilled items posted on or before it are taken within `fundedAmount`
   (`takeWithinFunding`): every credit is taken, then each positive item in
   posting-date order that still fits after the credits and the items before it;
   the rest are stamped "Funding limit". An item that does not fit never holds a
   later credit or a later item that fits;
4. one Draft invoice per contract through `insertDraftContractInvoice`, lines from
   `planProjectInvoiceLines` (P11: T&M labor by category and unit price, Cost Plus
   labor by category, other cost by cost type), `invoiceLineType 'Service'`;
5. each item is stamped Billed with `salesInvoiceLineId` (one `UPDATE … FROM VALUES`).

Holds (`projectInvoiceHold`): a re-bill of a voided invoice (`voidedSalesInvoiceId`,
P4) wins over a negative item ("Includes a credit for a reversed charge"); Draft Only
never holds. Deleting the Draft (`releaseRecurringInvoiceStamps`) and a VOID
(`post-sales-invoice`, which also stamps `voidedSalesInvoiceId`) return the items to
Unbilled.

The contract page's **Project Billing** card lists the billing lines and the invoices
that billed them (`getContractProjectBillingInvoices`); each invoice has a backup
report (`contract+/$id.billing-backup.$invoiceId.tsx`, `getProjectBillingBackup`, CSV
from the table).

**Invoice** on a project contract's page (`$id.invoice.tsx` → `generateContractInvoicesNow`,
`sales.service.ts`) runs `create-project-billing-invoices` for that contract, then
`create-contract-invoices` (its Fixed Price billing events), in the nightly job's order.

## The nightly job

`recurring-billing` (`packages/jobs`) runs, for a company with an Active contract with
a billing line: `cost-plus-items-<id>` (`generateCostPlusItems`), then
`project-billing-<id>` (`create-project-billing-invoices`), BEFORE the contract step,
because that step ends a contract past its end date and its last period would then
never bill. After the contract step, `contract-funding-<id>` runs
`checkContractFunding` (`src/invoicing/contract-funding.ts`) and sends
`ContractFundingThreshold` per notice (P12: daily, not per posting batch). A notice
goes to the contract's sales person and the project's manager, in-app and by email.

## Funding notice

`fundingNotice` (`@carbon/utils`): incurred + expected (the last 90 days' average
daily cost × `noticeWindowDays`, capped by the remaining plan only when the subtree
has a plan, P14) against `noticePercent × fundedCost`; a second notice when the funds
run out within the window. A changed `fundedCost` makes both due again (P13).

## Part CLINs (prototypes)

Spec `.ai/specs/2026-10-21-project-contracts.md` section 10 (D23–D39). A project
contract line may name a Part: a deliverable that a job builds and a delivery hands
over. `contractLineItemTypeAllowed` / `contractLineItemTypeMessage`
(`@carbon/database/contract-schedule`) allow a Part only when `billingBasis =
'Project'`. A Part line keeps its quantity, the units to deliver. The billing method
still decides how the line bills. The screens are in
`apps/erp/app/modules/sales/AGENTS.md` → Contracts → "Part CLINs".

**Build.** `$id.$lineId.build.tsx` calls `sales.buildContractLineJob`, which calls
`createProjectJob` (`apps/erp/app/modules/projects/projects.service.ts`) with
`customerContractLineId`.
The job is charged to the task the user picks, it consumes to the project for every
billing method (D30, D33), and it gets its own Make to Order plan line on that task.
The plan line's **Create Job** links its job to a part CLIN too
(`findPartContractLine`). See `projects-system.md` → Consume-to-project jobs.

**The job bills through the billing element.** Billing reads the project ledger, not
the job. The job's rows carry `jobId` and the task, so they fall under the line's
billing element when the task is in its subtree:

| Billing method | What the job's cost gives |
|---|---|
| Time & Materials | A billable item per ledger row at posting (`issue`, `post-production-event` through `insertProjectLedgerRows`). Labor is priced by the row's `laborCategoryId`, which `post-production-event` now stamps from `employeeJob.laborCategoryId` (D37); with no category and no employee rate the item is On Hold "No bill rate". Rows that `complete_job_to_inventory` and `backflush_job_materials` write in SQL get their item from the T&M backfill at the next invoice run |
| Cost Plus | Items from `generateCostPlusItems`, as for any other cost |
| Fixed Price | No billable items. The line bills on its billing events. Percent Complete revenue follows the job's cost |

Under DCAA timekeeping, shop labor reaches the project through a certified timesheet,
not at the production event (`government-contracting.md` → Shop labor under DCAA).

**Billing on delivery (Fixed Price, D34).** An Active contract's billing events cannot
be edited, so the delivery moves them. `postContractShipment`
(`inventory/shipment-customer-contract.ts`) calls `splitBillingRowForDelivery`
(`sales/contract-delivery-billing.ts`) for each Fixed Price delivery line with
delivered quantity × `rate`:

1. It takes the line's next Planned, non-adjustment row with a positive amount
   (`FOR UPDATE`). With none left (all invoiced), it does nothing.
2. If the row holds no more than the amount, the whole row moves to a Planned invoice on
   the delivery date. The shipment line stores the row in
   `customerContractInvoiceLineId` and its old date in `previousInvoiceDate`.
3. Otherwise it splits the row: the old row keeps the rest, and a new row with the
   amount (units in proportion) goes on the delivery date. `previousInvoiceDate` stays
   null.

`restoreBillingRowAfterVoid` puts it back: a whole row returns to a Planned invoice on
`previousInvoiceDate`; a split row merges into the line's next Planned row of the same
period. It refuses once the delivered row's invoice is not Planned ("The delivery is
invoiced. Credit it first."). Empty Planned invoices are deleted. The line's billed
total never changes, so the revenue plan still conserves. T&M and Cost Plus deliveries
change no billing.

**A contract invoice line never ships.** `isDirectItemLine`
(`post-sales-invoice/posting-lines.ts`) is false for a line with
`customerContractLineId`. Without it, a Part on a contract invoice line relieved stock
a second time (a `Sales Shipment` item ledger row and a COGS pair on a Fixed Price
event; a COGS pair on T&M or Cost Plus). The invoice line stays `invoiceLineType
'Service'`; the job and the delivery own the part.

## Revenue and WIP relief (Phase 4b)

The revenue recognition run recognizes a line with revenue method Right to Invoice or
Percent Complete. Each month of such a line is a `customerContractRevenue` row with
`earnedToDate` (and, for Percent Complete, `estimateAtCompletion`,
`transactionPrice` and `progress`). `synthesizeContractRevenue` then moves the month
through the contract position like a planned month: a Deferral row for what Deferred
Revenue covers, an Accrual row into Contract Assets for the rest.

**Run order (R1).** `runRowSynthesizers(type, extra)` (`accounting.service.ts`)
builds the list. A revenue recognition run gets `extra`, `synthesizeProjectRevenue`,
then `synthesizeContractRevenue`; a lease run gets `synthesizeRentalAccruals` only.
`extra` defaults to `projectRevenueSynthesizers(projectRevenueWriters)`
(`@carbon/ee/project-revenue.server`); only a test passes its own. The propose,
preview and recalculate postings all call `runRowSynthesizers(type)`, so every caller
gets the commercial synthesizer: the run routes, the close checklist preview
(`getPeriodRunPreview`), the MCP tools and the job `revenue-recognition-proposal`.
Pinned by `apps/erp/test/database/propose-revenue-recognition-run/synthesizer-order.test.ts`.
The Percent Complete and cutover recost tests are `apps/erp/test/database/ee/project-revenue/{percent-complete,cutover-recost}.ee.test.ts`
(they call ERP posting bodies, which `packages/ee` cannot import).

`projectRevenueSynthesizers(writers)` and `synthesizeCommercialProjectRevenue(writers)`
are factories. They take the ERP's community writers as an argument, so ee never
imports the ERP. The shared writers live in
`apps/erp/app/modules/accounting/project-revenue.ts` (`projectRevenueWriters`, beside
`synthesizeProjectRevenue`). A synthesizer:

1. takes `lockProjectRevenue` (the contract position lock);
2. reads its lines with `loadProgressLines` (contract not Draft, line started by the
   period end). A line an amendment replaced (another line names it in
   `amendsLineId`) is left out: its `change` copy carries it on, from the replaced
   line's start (`ProgressLine.startDate`) and with its months and loss provision
   (`historyLineIds`, through replaced lines of the same revenue method);
3. rebuilds the run's month with `clearProgressMonth` (R5): it deletes the line's
   Planned schedule rows of the month (`Deferral`, `Accrual`, `Cost Relief`,
   `Loss Provision`, through `syncDraftRecognitionRuns`), then the Planned month row.
   A Recognized month is never touched, and neither is a month of a line that (or
   whose replaced lines) already has a month row, a `Cost Relief` or a `Loss
   Provision` row for a LATER month: the later month's cumulative catch-up covers
   it, so running the earlier month writes nothing for that line;
4. writes the month with `writeProgressMonths` (`recognizedBefore` gives what earlier
   months recognized, any status, the replaced lines' months included);
5. relieves cost with `selectUnrelievedCost` and `writeCostRelief`.

**Which line owns a ledger row.** `progressLedgerRows` (`project-revenue.ts`, passed
to ee as a writer) is the one definition: a line owns the rows of its billing
element subtree posted within its own dates (`startDate <= postingDate <=
min(through, endDate)`), and a row belongs to at most one line (with two lines on
one branch over the same dates, which P7 refuses, the line that started last). The
cost relief and the Percent Complete actual both read it, so an ended line and its
follow-on on one element each earn and relieve only their own cost. Before it, both
lines selected the same row and the relief insert failed on
`projectCostRelief_ledger_key`, failing the whole run.

**Right to Invoice** (`synthesizeProjectRevenue`, community). Earned to date = Σ the
line's billable items whose ledger row posted on or before the period end, other than
Written Off and other than an item the invoice run holds for the funding limit
(`statusReason` = `BILLABLE_REASON_FUNDING_LIMIT` and not Billed; audit A6, Brad
2026-10-22): work the funding does not cover is not yet a right to invoice. The invoice
run decides that hold again each time, so once funding covers the item it is billed and
the next month earns it (cumulative). Other holds (No bill rate, No hours, a user's note)
are still earned. The month = earned to date − recognized before; a write-off gives a
negative month. The hold is stamped by the invoice run only, so an item over funding
that no invoice run has seen yet is still earned by a run before it.

**Percent Complete** (`synthesizeCommercialProjectRevenue`, ee). It returns at once
without `PROJECT_REVENUE` (`projectRevenueEnabledForCompany`). It first runs
`generateCostPlusItems` through the period end (R10). Per line:

| Figure | Rule |
|---|---|
| EAC | the billing element's `estimateAtCompletion` override, else `estimateAtCompletion(sumSubtree(…))` over `get_project_cost_summary`, less the subtree cost posted outside the line's own dates (another line's cost), floored at 0 |
| Price | Fixed: Σ the line's `customerContractInvoiceLine.amount`. Cost Plus: EAC × (1 + fee), capped at `ceilingAmount` (`percentCompletePrice`) |
| Progress | `min(actual ÷ EAC, 1)`, 0 when EAC is 0; actual = the ledger rows the line owns to the period end (`progressLedgerRows`, R8) |
| Earned to date | price × actual ÷ EAC, rounded once (`percentCompleteRevenue`) |
| Loss provision | target `(EAC − price) × (1 − progress)` when EAC > price, else 0 (`lossProvisionBalance`); the run writes the change from the `Loss Provision` rows of earlier months and this month's already posted ones (a zero-revenue month writes no month row, so it stays open to a second run, which must not book the change again) |

The math is pure in `packages/ee/src/project-revenue/progress.ts`.

**Cost relief (R2–R4).** Both methods relieve every ledger row the line owns
(`progressLedgerRows`) posted on or before the period end that has no
`projectCostRelief` row and whose journal debit line is on an Asset account other than
an inventory account (`onInventoryAccount`: the Raw Materials or Finished Goods default).
A row with no journal line, an expensed row, or a row whose cost still sits in stock (a
Charge at receipt receipt row, the inventory side of a relocation pair) is never relieved;
issued receipt-charged stock is relieved through the pair's project side (accounting audit C2,
`projects-system.md` → *Project stock*). Every charge writes its
journal for every company (Provisional before the accounting cutover, Posted after
it), and its ledger row carries the `journalLineId` (a Project Issue included). One `Cost Relief` schedule row per line and account: Dr
`costOfGoodsSoldAccount` / Cr that account. `projectCostRelief` records each ledger row
with its schedule row (`UNIQUE (projectLedgerId, companyId)`, FK to the schedule row
`ON DELETE CASCADE`), so a rebuilt month frees its rows and none is relieved twice. A
row is relieved by the run OR by its project's close (`projects-system.md` → *Project
close*): a close's rows carry `journalId` instead of the schedule row
(`projectCostRelief_source_check`: exactly one of the two, migration
`20261023020301`), and the same unique key keeps the run from relieving them again.

**Loss provision.** A `Loss Provision` schedule row: Dr `costOfGoodsSoldAccount` / Cr
`contractLossProvisionAccount` (seeded `2165 Contract Loss Provision`, set under
**Accounting → Default Accounts**). A negative row releases provision; posting swaps
its sides.

**Posting.** `Cost Relief` and `Loss Provision` rows carry `customerContractLineId` and
no `customerContractRevenueId` (R6), and post in the run's `Revenue Recognition`
journal (off external ledgers by default, `POSTING_POLICY`). The out-of-date check of
`postRevenueRecognitionRun` reads a missing month row as stale for `Deferral` and
`Accrual` rows only; applied to every contract row it refused every run that held a
relief or provision row, and Recalculate rewrote the same rows. `postRevenueRecognitionRun`
adds the Project and Project Element dimensions to contract rows; the descriptions come
from `revenueRowDescriptions` (`accounting.utils.ts`). The orphan cleanup of
`synthesizeContractRevenue` reads only `Deferral` and `Accrual` rows, or it would
delete the relief rows.

**Review.** The run page shows a **Project Revenue** card above its sections
(`ProjectRevenueProgress.ee.tsx`): per line the EAC, price, progress, earned to date,
this month, cost relieved and loss provision change. A Right to Invoice line has no
EAC, price or progress. The project **Billing** page shows **Progress** and
**Revenue** per billing line, and the contract's **Project Billing** card
shows **Revenue** (`getProjectContractRevenue`, `projects.service.ts`). A Draft run also
shows a **Journal** card: `summarizeRunJournal`
(`ui/RevenueRecognition/runJournal.ts`, tested) sums the run lines' schedule rows by
account, a negative amount on the swapped sides, rendered by `JournalPreview`
(`~/components/JournalPreview.tsx`).

## Commercial gating

`PROJECT_REVENUE` (Business, Partner). T&M and Right to Invoice are community. The
lock is P1 (Cost Plus items only from ee code), and the Percent Complete synthesizer
and the loss provision run only in ee code (R1). The routes call
`requireProjectRevenueEntitlement` for Cost Plus or Percent Complete through
`projectRevenueRefusal` (`sales.service.ts`; routes `lines.new`, `$lineId.details` and
`$lineId.update`) and flash `defaultUpgradeMessage`. The `amendContract`,
`createContractLine` and `updateContractLine` operations (`sales.server.ts`, also MCP
tools) call it too and return the message as an `entitlement` error. The forms keep
both choices visible with an upgrade notice (`ProjectRevenueUpgrade`) and Save disabled.

## UI

- Line form and the amend modal's added line: **Billing Method** and
  `ContractLineBillingFields` (billing element via `BillingElement` +
  `api+/projects.billing-elements.ts`, handling or fee, funding, notice).
- **Billing element.** The element page's Work properties have a **Billing element**
  switch on a Contract project, for any type but Parameter (`ElementSidebar`). It posts
  `field=isBilling` to the element update route (`$projectId.elements.update.tsx`),
  which refuses it on a non-Contract project and calls `updateProjectElementBilling`
  (`projects.service.ts`). That function refuses a second billing element in one branch
  (an element and its ancestor) and a Parameter (`refuseBillingInBranch`), and refuses
  turning the flag off while a contract line bills the element (`refuseBilledElement`).
  It is a live write, not a plan-layer field. Without a flagged element, the line form's
  Billing Element picker has nothing to offer (`getProjectBillingElements`).
- Line billing page (`contract+/$id.$lineId.billing.tsx`, `ContractLineBilling`): one
  primary action, **Generate Billable Items**. **Line Details** and **Edit Funding** are
  in the ⋯ menu. The cards: Funding (`FundingBar`); funding actions
  (`ContractFundingActions`, shown when `useGovernmentContracting()` is true, DCAA owns
  the totals, or the line has actions); labor rates (`ContractLaborRates`, T&M); rate
  ceilings (`ContractRateCeilings.ee.tsx`, Cost Plus); and Billable Items. Funding
  actions, labor rates and rate ceilings are inline-edit grids (`Table compact
  withInlineEditing`): an "Add …" button under the grid adds a draft row, Delete is in
  the row ⋯ menu, and there is no modal. Each edit posts the whole row with the
  existing intent; the routes answer `quiet` with `{ error }` and no flash. The Billable Items card's description links Projects →
  Approvals (`?tab=billing`), where items are reviewed. The contract explorer opens a
  billing line here.
- Project **Billing** page (`$projectId.billing.tsx`): in the project sidebar under
  Costs for every Contract project (`showBilling`: `costTreatment = 'Contract'`), with
  `view: sales`. The `$projectId.tsx` loader also returns `projectContracts`
  (`getProjectContracts`: the `billingBasis = 'Project'` contracts whose header names the
  project OR that have a line whose own `projectId` is the project — a line bills its own
  project, so a backfilled contract with no header project still counts; empty without
  `view: sales`). With none, the page
  is an `Empty` "No project contract bills this project" with **New Project Contract**
  (`path.to.newProjectContractForProject`, `create: sales`). Otherwise a row names each
  project contract with its status, then the contract lines table (`ProjectBillingLines`:
  Line, linking the line billing page, Billing Element, Funding, Progress and Revenue;
  `getContractBillingLines` skips Fixed lines, and with no billing line it shows "No
  billing lines yet"), then the project's billable items.
- Project Overview (`$projectId._index.tsx`, `ProjectOverview`), for `view: sales`: a
  **Contract** card under Budget when a confirmed (not Draft) project contract bills the
  project, all of them summed over the lines that bill THIS project
  (`contractLinesBillingProject`: the line's `projectId`, else the header's): `FundingBar`
  (compact) and Funded (`projectContractFunded`, which skips a line an amendment
  replaced — `currentContractLines`), Cost, Billed (billing lines' funding rows plus Fixed Price
  schedule rows on Invoiced or Billed Externally invoices), Unbilled and Revenue
  (`getProjectContractRevenue`), linking the first Active contract. **Needs attention**
  rows on a Contract project: no project contract (links the Billing page), a Draft
  project contract (links its Review step), and the contract billable items that wait for
  review (`update: projects` too; links Approvals `?tab=billing`).
- Labor categories: the rates are a `Grid` on the category drawer (Effective From, Cost
  Rate, **Bill Rate**). Rates have no delete endpoint, so the grid has no delete.

## Known gaps

- Cost a progress line owns is relieved only by the run. A Contract project's WIP that no
  progress line owns (no billing element, a Fixed Daily or Even Period line's subtree,
  project-level burden) waits in Project WIP until the project closes, which relieves it
  (`relieveProjectWipAtClose`, audit D11). A Fixed Daily / Even Period line's cost is
  therefore expensed at close, not as its revenue is earned (audit A10).
- A Percent Complete line owns its subtree's rows at close even without
  `PROJECT_REVENUE`, when the run cannot relieve them.
- The split of an element's EAC between an ended line and its follow-on is a
  heuristic (the subtree EAC less the cost outside the line's dates): until the
  follow-on's cost is in, the ended line's EAC still holds the follow-on's remaining
  estimate.

- Billing lines need the contract currency to equal the base currency (P5);
  multi-currency bill rates are out of scope.
- The project **Billing** page and the contract's **Project Billing** card list billing
  lines only, so a Fixed Percent Complete line shows its figures in the run review only.
- The run page's **Amount** sums every line, cost relief and loss provision included.
- Browser verification of Phase 4a (plan Task 21) and Phase 4b (plan Task 14) is
  deferred.
- **Amend after a delivery.** `reconcileContractSchedule` pins a delivered row
  (`ExistingRow.isDelivered`, read by `loadSchedule` from the `shipmentLine` that moved
  it): it counts as billed for its key, is never re-cut, and its invoice is never
  deleted (an invoice dated on or after the change that holds one keeps it and loses its
  other rows). On a project contract an amendment also passes `onlyLineIds` (the lines
  it ended or added), so the authored billing events of every other line keep their
  dates. Pinned by `contract-schedule.test.ts` and `post-shipment/customer-contract.test.ts`.
- On a project contract the amend modal's **Add Lines** offers parts and services; every
  added line is One-time, and a part line keeps its quantity and (Fixed) unit price.
