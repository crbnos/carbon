---
paths:
  - "packages/server-functions/src/create-project-billing-invoices/**"
  - "packages/server-functions/src/generate-contract-billable-items/**"
  - "packages/ee/src/project-revenue/**"
  - "packages/utils/src/project-billing.ts"
  - "packages/jobs/src/invoicing/contract-funding.ts"
  - "apps/erp/app/modules/sales/ui/Contracts/ContractLineBilling*.tsx"
  - "apps/erp/app/modules/projects/ui/Billing/**"
---

# Project billing (Phase 4a)

A customer contract line bills project work. Spec
`.ai/specs/2026-10-09-project-billing.md`; plan
`.ai/plans/2026-10-09-project-billing-phase-4a.md` (decisions P1–P15 and the
*Execution notes*). Phase 4b (revenue: Right to Invoice, Percent Complete, cost
relief, loss provision) has its own plan and ships in the same release: 4a alone
posts T&M invoices to Deferred Revenue, and nothing recognizes them.

## The line

`customerContractLine.billingMethod` (`contractBillingMethod`): `Fixed` (the
schedule, as before), `Time & Materials` or `Cost Plus`. A billing line (T&M or
Cost Plus) has no schedule (`planInvoiceSchedule` and the schedule writers skip
it, `isProgressRevenueMethod` keeps it out of the revenue plan) and these columns
(migration `20261011122931_project-billing.sql`):

- `projectElementId`: the **billing element**; the line bills its whole subtree.
  FK `(projectElementId, projectId, companyId)`.
- `materialHandlingPercent` (T&M) and `feePercent` (Cost Plus), 0–1.
- `fundedAmount` (the billing stop), `fundedCost` (the notice base, without the
  fee), `ceilingAmount`, `noticePercent` (0.75–0.85), `noticeWindowDays` (30–90),
  and `thresholdNoticeFundedCost` / `runOutNoticeFundedCost` (the funded cost each
  notice went out for, P13).

CHECKs: a billing line has a project and a billing element, quantity 1, rate 0 and
`revenueType` One-time (`customerContractLine_billing_check`); Cost Plus needs a
fee; the revenue method follows the billing method (P6: Fixed → Daily, Even Period
or Percent Complete; T&M → Right to Invoice; Cost Plus → Percent Complete or Right
to Invoice); Percent Complete needs a billing element. The ERP mirrors them in
`checkBillingTerms` (`sales.models.ts`, `contractRevenueMethodsByBillingMethod`),
and `upsertContractLine` forces quantity 1, rate 0 and One-time for a billing line.

Confirm and amend (`post-customer-contract`, `checkBillingLines`) refuse a billing
line whose element is the same as, an ancestor of or a descendant of another live
billing line's element (P7), a non-Contract project, and a contract currency other
than the base currency (P5). Amend refuses a `change` of a billing line and allows
`add` and `end` (P9). Funding changes through **Edit Funding**
(`updateContractLineFunding`, Draft or Active).

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

- **T&M at posting.** `insertProjectLedgerRows` (`lib/project-posting.ts`) loads the
  live billing lines once (`loadContractBillingContext`) and writes an item per row
  under a T&M line (`buildContractBillableItem`, `priceTimeAndMaterialsItem`): Labor
  = hours × bill rate, Material and other direct cost × (1 + handling), Machine,
  Overhead and Burden not billed. A reversal (`reverseProjectLedgerRows`) reverses
  the item.
- **Cost Plus from the commercial generator** (P1). `@carbon/server-functions`
  cannot import `@carbon/ee`, so posting writes no Cost Plus item.
  `generateCostPlusItems` (`@carbon/ee/project-revenue.server`) prices cost × (1 +
  fee) for every cost type; it degrades (`gated: true`) without `PROJECT_REVENUE`.
  The nightly job and the line's **Generate Billable Items** call it.
- **The T&M backfill.** `generateTimeAndMaterialsItems` writes items for subtree
  rows posted on or before `through` that have none (`selectRowsToBill`). It runs
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

Projects → **Billing** (`projects+/billing.tsx`, default Unbilled and On Hold) and the
project **Billing** tab (Contract projects) list the items in
`ProjectBillableItemsTable`; the bulk actions post to `projects+/billing.update.tsx`
(`update: projects`) → `updateProjectBillableItems`: hold (reason), release, write off
(reason), price (one item; `amount = round(quantity × unitPrice)`; releases a "No bill
rate" hold). Billed and Written Off items are refused.

Every change reaches the audit log ("Billable Item"): the table is in `auditConfig`
AND has `events: true` in `event-system/attachments.ts` (migration
`20261011132157_project-billable-item-audit-events.sql`). The config alone attaches
no trigger.

## Invoicing

`create-project-billing-invoices` (`{ asOf, customerContractId? }`, `update: sales` +
`create: invoicing`) is a source of the recurring invoicing layer. Per Active contract
with a billing line that started on or before `asOf`:

1. the period end is the latest billing grid date on or before `asOf`;
2. the T&M backfill runs for each T&M line through the period end;
3. Unbilled items posted on or before it are taken in posting-date order within
   `fundedAmount` (`takeWithinFunding`); the rest are stamped "Funding limit";
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

## Commercial gating

`PROJECT_REVENUE` (Business, Partner). T&M and Right to Invoice are community. The
lock is P1 (Cost Plus items only from ee code). The routes call
`requireProjectRevenueEntitlement` for Cost Plus or Percent Complete through
`projectRevenueRefusal` (`sales.server.ts`; `lines.new`, `$lineId.details`, `amend`)
and flash `defaultUpgradeMessage`. The forms keep both choices visible with an
upgrade notice (`ProjectRevenueUpgrade`) and Save disabled. An MCP
`upsertContractLine` skips the route check; the ee generator still bills nothing.

## UI

- Line form and the amend modal's added line: **Billing Method** and
  `ContractLineBillingFields` (billing element via `BillingElement` +
  `api+/projects.billing-elements.ts`, handling or fee, funding, notice).
- Line billing page (`contract+/$id.$lineId.billing.tsx`, `ContractLineBilling`):
  funding (`FundingBar`), labor rates (T&M), items, **Edit Funding**, **Generate
  Billable Items**. The contract explorer opens a billing line here.
- Labor categories: a **Bill Rate** beside the cost rate.

## Known gaps

- Billing lines need the contract currency to equal the base currency (P5);
  multi-currency bill rates are out of scope.
- Browser verification of Phase 4a is deferred (plan Task 21).
