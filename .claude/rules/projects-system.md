---
paths:
  - "apps/erp/app/modules/projects/**"
  - "apps/erp/test/database/post-timesheet/**"
  - "apps/erp/test/database/post-project-issue/**"
  - "apps/erp/test/database/post-project-expense/**"
  - "apps/erp/test/database/post-project-stock-transfer/**"
  - "packages/api/src/stock-stripes.ts"
  - "apps/erp/app/modules/inventory/grouped-receipt.ts"
  - "packages/ee/src/pegging/**"
---

# Projects

Phases 1a, 1b, 1c, 2a, 2b and 3 of `.ai/specs/2026-10-03-projects.md`, and
Phases 4a and 4b of `.ai/specs/implemented/2026-10-09-project-billing.md`; plans
`.ai/plans/2026-10-07-projects-phase-1a.md`,
`.ai/plans/2026-10-08-projects-phase-1b.md`,
`.ai/plans/2026-10-08-projects-phase-1c.md`,
`.ai/plans/2026-10-08-projects-phase-2a.md`,
`.ai/plans/2026-10-08-projects-phase-2b.md`,
`.ai/plans/2026-10-08-projects-phase-3.md`,
`.ai/plans/2026-10-09-project-billing-phase-4a.md` and
`.ai/plans/2026-10-09-project-billing-phase-4b.md` (their *Execution notes* record every
deviation). Module guide: `apps/erp/app/modules/projects/AGENTS.md`. Cost objectives,
unallowable cost, DCAA timekeeping, dilution, labor transfers and the reports
(Government Contracting Phase 5a), and the R&D tax tags and reports (Phase 5d), have
their own rule: `.claude/rules/government-contracting.md`.

A project is a tree of typed elements. A charge number (a project, or a project plus
an element) is the cost object that jobs, PO lines, purchase invoice lines, charge and
reimbursement lines, timesheet entries and project issues post to. `projectLedger` is the
project's subledger of actual cost.

## Information architecture

The UI was rebuilt on 2026-10-12 (`.ai/plans/2026-10-12-projects-service-ui-rebuild.md`).
Its *Execution notes* record the later decisions that override the plan text. The UI
opens in layers. Each layer shows the least that a user needs.

- **Module sidebar** (`ui/useProjectsSubmodules.tsx`). Manage: **Projects**, **My Time**,
  **Approvals**, **Reports**. Setup: **Labor Categories**, **Planning Groups**. The groups
  do not collapse. Approvals shows while `timesheetApprovalRequired` is on,
  `timekeepingControls = 'DCAA'`, or contract billable items wait for review (Unbilled or
  On Hold). Its count is the sum of two counts from the `projects+/_layout.tsx` and
  `project+/_layout.tsx` loaders: `getApprovalCountForUser` (time) and
  `getBillingReviewCountForUser` (billable items; 0 without `update: projects` and
  `view: sales`). Transfers and Billing are not in the sidebar: a transfer
  opens from the project's Stock page, and billing review is the Billing tab of Approvals.
  The old URLs still work.
- **Projects list** (`ProjectsTable`): Identifier, Name, Status, Owner, Due and Budget used.
  The other columns are hidden by default. **New Project** opens a drawer (`projects+/new.tsx`).
- **Project workspace** (`project+/$projectId.tsx`). The left project sidebar
  (`ProjectSidebar`) starts with the change request picker and a Baselines (history)
  button. Then the page links (`useProjectSidebarLinks`): Overview, Plan, Schedule, Costs
  and Time. There is no Settings page (Brad, 2026-10-19). The Overview (`ProjectOverview`) is a
  dashboard of light cards in two columns. The left column has About (the description), Progress,
  Coming up, Budget, Contract (a Contract project billed by a confirmed project contract,
  `view: sales`) and Needs attention. Needs attention also names, on a Contract project, a
  missing or Draft project contract and the contract billable items that wait for review
  (see `project-billing.md` → UI). Progress shows the share of work elements done (whole
  percent, rounded down; Cancelled work is left out), the days to the due date, the overdue count
  and a bar per state. Coming up lists open elements with a target date. The right column has
  Details, Milestones, Members (only with `restrictCharging`) and Recent activity. Recent activity
  is the latest element comments and `projectLedger` postings, not the audit log, which reads one
  record at a time and is a gated feature. The `$projectId._index.tsx` loader computes all of it;
  Progress counts the work elements: every element but a Parameter that has no children
  but Parameters, so a System grouping five Tasks counts five. Coming up lists every open
  element but a Parameter. Details is `ProjectProperties` in the row layout
  (`PropertyLayoutProvider value="row"`: label left, value right), with the core fields first and
  the rest under **More**. Each field saves as it changes. A field
  posts `intent=field` to `$projectId.details.tsx`, which fills in the rest from the stored
  project and runs the same validation and rules as the old form; Project Control is a
  group of that column (`ProjectControlSettings.ee`). `$projectId.settings.tsx` keeps only
  its action (members, control settings) and redirects to the Overview. The property
  fields save through `PropertySaveProvider` (`ui/Element/PropertyFields.tsx`); without
  one they save the element. On every page with the sidebar, the element tree
  and its "Search elements" box show under the links (the search writes `?search=`
  only on the Plan page; elsewhere it filters the tree). Under Costs, each link shows only
  when it applies: Stock (the project has an `itemLedger` row), Pegging (a current
  `projectPeg`) and Billing (every Contract project, `showBilling`, with `view: sales`;
  with no project contract the page offers New Project Contract). The header
  (`ProjectHeader`, on `RecordHeader`) is one line: the identifier and the name (a button
  that opens the project switcher), the status badge, then the copy button and the ⋯ menu
  at the right end. It has no primary button. The ⋯ menu lists the status transitions
  first, the next step first, then Place in service, Stop work, Baselines, Change
  requests, Copy project and Template.
- **Element page** (`/x/project/$id/element/$elementId`, `ElementView`): a full-screen page
  with no project header and no project sidebar. See *The Plan page*.
- **Layer 5: a feature shows only when it is used.** Stock and Pegging as above. Billing is
  the exception: it shows on every Contract project, so a new one shows how to start
  billing.
  Earned value on the Costs page needs an element with `isControlAccount`. The government
  contracting fields of the project form need `useGovernmentContracting()` (DCAA
  timekeeping, or the `GOVERNMENT_CONTRACTING` feature); the element page's group needs DCAA
  timekeeping. The planning group properties need at least one `planningGroup` row.

## Treatment is decided at the source

The cost treatment decides the GL account when the cost is posted, not later. There
is no month-end sweep.

`resolveProjectPostingAccount(ctx, postingDate)` (`projects/project-posting.ts`) is the
one decision:

1. The nearest node with a treatment in effect on `postingDate` decides: the element,
   then its ancestors (`costTreatment` with `costTreatmentEffectiveFrom` null or on or
   before the date), else the project.
2. An explicit `costAccountId` counts only on the node that set the treatment. An
   account on an element with no treatment of its own is ignored.
3. Statistical → `accountId: null`. The caller keeps its natural account and tags the
   line with the Project dimension only.
4. Expense → `accountDefault.projectExpenseAccount`; Contract →
   `accountDefault.projectWorkInProgressAccount`. A missing default throws a
   `ProjectChargeError` that names it.
5. Capitalize → the class asset account of the asset the charge builds
   (`capitalAssetId`: the nearest final-asset element's asset, else the project's).
   Under Construction gives the CIP class account; Active gives the in-service
   class account and `postCapitalization: true` (a late cost). An explicit
   `costAccountId` is ignored. No asset (not released yet), or any other asset
   status, throws. See *Capital projects*.

Load contexts with `loadProjectPostingContexts` (3 queries for any number of refs, keyed
by `projectPostingKey`) or `resolveProjectLineAccounts` (a document's lines). Never load
one context per line.

### The SQL mirror

`project_posting_account(company, project, element, date)` (migration
`20261021000600_projects-functions.sql`, redefined by
`20261021000900_project-posting-account-missing-default.sql` and, for Capitalize,
`20261021001500_project-posting-account-capitalize.sql`) mirrors the TS resolver for
the SQL posting paths: `complete_job_to_inventory` and `backflush_job_materials`
(migration `20261021000800_complete-job-consume-to-project.sql`). Change both together.

The SQL returns NULL for Statistical only. A missing account default raises the TS
resolver's message ("Set Project Expense in Account Defaults …"), and a missing project
raises too. So the callers' "consumes to a Statistical project" branch means Statistical.
Before the redefinition a missing default also returned NULL and read as Statistical.

## `projectLedger`

One row per cost that reaches a project: `costType` (Material, Labor, Machine,
Overhead, Material Variance, …), `documentType` + `documentId`, `amount`, and
`journalLineId` when a journal exists. Build rows with `buildProjectLedgerRow`.

- Only the postings and the job-completion SQL write it. The ERP only reads it
  (`getProjectLedger`, `getElementTimeAndMaterials`, `get_project_cost_summary`,
  `get_child_service_project_costs`).
- A Statistical charge writes no row. Neither does a Statistical timesheet: the entry is
  only stamped Posted, with no journal (`projects/timesheet-posting-plan.ts`).
- A void or repost writes negative rows with `reversalOfId`
  (`reverseProjectLedgerRows`). Never delete or update a row.
- `unallowable` is stamped at posting by `isUnallowableCharge` (the account's
  allowability or an unallowable element up the tree); a reversal copies its original's
  flag. An unallowable row creates no billable item (see `government-contracting.md`).
- Every poster writes its rows and its journal for every company. The journal follows
  main's always-post rule (`.ai/specs/implemented/2026-10-08-accounting-cutover.md`):
  `journalPostingStatus` makes it Provisional, with no accounting period, before the
  company's accounting cutover, and Posted after it. No project path reads
  `accountingEnabled`. `postProjectJournal` (`projects/project-journal.ts`) decides the status
  and the period for the expense and reclass journals.
- An empty `laborAbsorptionAccount` on a timesheet becomes a stand-in line on retained
  earnings before the cutover (`resolveDefaultAccount`) and refuses the posting after it.
  An empty project or warranty default refuses in every state (`ProjectChargeError`), so
  the cutover readiness lets those stay empty (`FEATURE_ACCOUNT_DEFAULTS`).

## The accounting cutover

Brad's decisions of 2026-10-11 (`.ai/runs/2026-10-11-merge-origin-main.md`,
*Open questions for Brad*):

- **Opening WIP.** Project and service cost on `workInProgressAccount` that is not a
  job's (a Contract project whose Project WIP is the WIP account, a Refurbishment
  charge with Capitalized coverage) opens as ONE "Work in Progress" item with no
  document (`getWorkInProgressItems`, `accounting-cutover/open-items.ts`): the
  non-job WIP lines before the cutover, less the Cost Relief rows before it that
  credit the WIP account (the enable's step 5 posts those with no journal).
- **Fixed assets.** `getCutoverFixedAssets` values an asset as it stood at the
  cutover: less its `fixedAssetCipCost` rows dated on or after it, in the class the
  first capitalization on or after it moved the asset from (`fromClassId`).
- **Re-cost of a project issue.** `recostProjectIssues` (`activate-accounting/recost.ts`)
  writes a `projectLedger` adjustment row (quantity 0, the cost difference,
  `journalLineId` = the re-cost's project line) through `insertProjectLedgerRows`,
  and a `fixedAssetCipCost` row for a Capitalize project.
- **Payback.** Still refused (see *Project stock*).

## Charge gates

`assertChargeable(ctx, mode)` refuses with a `ProjectChargeError` (status 422):

| Mode | Project status | Element |
|---|---|---|
| `new` — time, an issue, a new charge | Released | chargeable, state group Unstarted or Started |
| `commitment` — receipt, invoice, job issue or completion, reversal, return | Released, On Hold or Technically Complete | not Backlog or Cancelled |

`post-timesheet` uses `new` for an entry and `commitment` for a reversal. With
`project.restrictCharging` on, `assertChargeable(ctx, mode, timeEmployeeId)` also refuses
time from an employee who is not a `projectMember`; `post-timesheet` passes the employee
only in DCAA mode and only for a new entry.
`post-project-issue` uses `new` for an Issue and `commitment` for a Return. The first
`new` charge moves an Unstarted element to its project's default Started state
(`startElementsOnFirstCharge`; ERP `startElementOnFirstCharge`).

In the ERP, `chargeNumberError` (`projects.service.ts`) checks a document's charge number
in the route action: the project is the company's, the element belongs to it, and a
consume-to-project job's project is not Statistical. `updateProjectStatus` refuses Close
while a purchase order or job of the project is open (then `closeProject`, see *Project
close*), and refuses any status but On Hold
while the project has a stop-work order (`stopWorkStatusRefusal`, decision C16 of
Government Contracting 5c): only **Resume** (`$projectId.stop-work.tsx`) clears
`stopWorkDate` and releases the project. The CHECK `project_stopWork_check` backs it.
See `project-control.md`.

## Readable ids

`project.identifier` matches `^[A-Z][A-Z0-9]{1,5}$` (a Service project's is its order's
readable id or a template's `TPL-…`, so the CHECK skips Service) and is unique per
company. An
element's `readableId` is `<identifier>-<n>`, where `n` comes from
`project.nextElementSequence`, incremented in `insertProjectElement`'s transaction. A move
(`moveProjectElement`) or a parent change never renumbers. The identifier is read-only
after creation, because every stored `readableId` starts with it. Old projects got an
identifier from `derive_project_identifier` (backfill migration).

## Consume-to-project jobs

`job.consumeToProject` (needs `projectId`; refused with a sales order line) makes the
project the job's cost object in place of WIP:

- `loadJobProjectCharge(db, companyId, jobId)` returns null for every other job, so
  ordinary jobs pay one indexed read and post as before. It refuses Statistical.
- `issue` (material), `post-production-event` (labor, machine, overhead) and the scrap
  paths debit or credit the project account and tag the lines with Project and
  ProjectElement.
- `complete_job_to_inventory` posts the catch-up events to the project and then returns: no
  inventory receipt, no WIP discharge, no `itemCost` update. `backflush_job_materials`
  debits the project account. A job that is both consume-to-project and Make to Asset
  raises.
- On an outside processing receipt, only the job decides the route
  (`loadReceiptProjectRoutes`).

## Service projects

A project with `projectType = 'Service'` is a service order's work tree. Its
`costTreatment` is always By Coverage (`project_service_treatment_check`), its
identifier is the order's readable id (the identifier CHECK skips Service projects),
and `parentProjectId` names a coverage contract's project. Field service owns the rest:
`.claude/rules/field-service.md`.

- **Coverage on charges.** `projectLedger`, `timesheetEntry` and `projectExpenseEntry`
  carry `coverage` and `coverageReason`, and `post-project-issue` takes them as input;
  Standard rows leave them null. `resolveProjectPostingAccount(ctx, date, coverage)` turns the coverage into an
  account and refuses a By Coverage charge without one. `buildProjectLedgerRow` and
  `reverseProjectLedgerRows` copy the coverage.
- **Expense entries.** `projectExpenseEntry` (mileage, a meal, a part bought on a card)
  posts through `post-project-expense` for any project: Dr the project account (a
  Statistical project: `indirectCostAccount`, no ledger row) / Cr GRNI. A Capitalize
  project is refused. The shared `postProjectJournal` (`projects/project-journal.ts`) posts
  it and the coverage reclass.
- **Billable items.** `projectBillableItem` is what a charge will bill. Service
  projects write them (`buildBillableItem`, `reverseBillableItem`), and so does a
  Contract project under a Time & Materials contract line (`buildContractBillableItem`;
  project billing, below). `projectElement.fixedPrice` bills a node's whole subtree as
  one line.
- **Parent roll-up** (field service Phase D). The Costs page lists a project's child
  Service projects, one row per order, from `get_child_service_project_costs`; their
  actual adds to the project total only (`buildProjectCostFigures`, third argument). A
  Contract charge on a Closed parent is refused. `updateServiceOrderCoverageContract`
  keeps `parentProjectId` in step with the order's coverage contract. Details:
  `field-service.md` → *The contract project*.
- **Hidden outside Service.** The Projects lists, Copy from, Build from part's template
  list, the charge number pickers, the dimension picker and the Ramp sync filter
  `projectType = 'Standard'`. Never list a Service project in Projects.

## Contract billing and revenue (Phases 4a and 4b)

A customer contract line with billing method Time & Materials or Cost Plus bills a
Contract project's billing element and its subtree. The whole subsystem is in
`project-billing.md`; what it changes here:

- `insertProjectLedgerRows` writes a T&M billable item for each row under a live T&M
  line, in the posting transaction (`loadContractBillingContext`, one query for the
  lines, then the subtrees and rates only when needed). A reversal reverses the item.
  Cost Plus items come only from the commercial generator.
- **Rows from the job SQL.** `complete_job_to_inventory` and `backflush_job_materials`
  insert `projectLedger` rows in SQL, so posting writes no item for them. They get
  their T&M item from the backfill (`generateTimeAndMaterialsItems`).
  `create-project-billing-invoices` runs that backfill before it reads the items, so
  those rows reach the review list on the next invoice run, not at posting. The
  line's billing page has **Generate Billable Items** to do it at once.
- Review: Projects → **Approvals** → **Billing** tab (`projects+/approvals.tsx?tab=billing`;
  `projects+/billing.tsx` redirects there with its query) and the project's **Billing** page
  under Costs (every Contract project), `update: projects`. Each
  change reaches the audit log ("Billable Item").
- `laborCategoryRate.billRate` is a category's default price of an hour, beside its
  cost rate.
- **Revenue (Phase 4b).** The monthly revenue recognition run recognizes Right to
  Invoice and Percent Complete lines and relieves Project WIP to cost of goods sold:
  every subtree ledger row whose journal debit line is on an Asset account, once
  (`projectCostRelief`). Details, the run order and the call-site rule: `project-billing.md`.
  What no progress line owns is relieved when the project closes (*Project close*).

## Project close

`updateProjectStatus` checks the open PO lines and jobs, then `closeProject`
(`projects.service.ts`) runs the rest in one Kysely transaction (the project row
`FOR UPDATE`). It refuses (spec `.ai/specs/2026-10-03-projects.md` → Lifecycle, Brad
2026-10-22), each message saying what to do:

- a `projectBorrow` still Open that the project owes OR lent ("Pay them back from the
  project's Stock page");
- project stock on hand (`getProjectStockOnHand` non-empty: "Transfer it to unassigned
  stock or another project");
- Capitalize: the project's or an element's `fixedAssetId` still Under Construction
  ("Place them in service").

A **Contract** project then posts one `Project Close` journal (`relieveProjectWipAtClose`,
`projects/project-close.ts`; source and document type `Project Close`, migration
`20261023020301`, off external ledgers by default in `POSTING_POLICY`): Dr
`costOfGoodsSoldAccount` / Cr the account each row's journal line debited, grouped by that
account, dated the company's day, Provisional before the accounting cutover and Posted in
that day's period after it (`postProjectJournal`), tagged with the Project dimension. The
rows are the revenue run's eligibility (an Asset account other than Raw Materials /
Finished Goods, so a relocation pair relieves only its project side), posted on or before
the close date, with no `projectCostRelief` row, and NOT owned by a progress line
(`progressLedgerRows` over every Right to Invoice / Percent Complete line of the project,
whenever it starts): those stay for the run. Each relieved row gets a `projectCostRelief`
row with `journalId`, so neither the run nor a second close relieves it again. A group
that nets to 0 writes nothing. The close takes the run's lock (`lockProjectRevenue`).

**Service orders (D12).** A Contract coverage charge of a Service project posts to its
contract project's account (*Service projects*) on elements no line of the parent can
bill. The PARENT's close relieves them: rows of a Service project whose `parentProjectId` is
the closing project with `coverage = 'Contract'`. The parent is the cost object (its
account holds the debit, and a Closed parent refuses new Contract charges); a Service
project's own close relieves nothing, since its treatment is By Coverage, not Contract. Capitalized (refurbishment) rows are
left alone: they move into the serial's cost.

Closed is final in the UI (`projectStatusTransitions`). Nothing reverses the close
journal; the close relieves only unrelieved rows, so a cost that reaches the project after a
close (only through a direct status change today) is relieved at the next close or by the
run. Pinned by `apps/erp/test/database/lib/project-close.test.ts`.

## Burden (Government Contracting Phase 5b)

The commercial indirect rates run (`indirect-rates.md`) burdens project cost.
What it changes here:

- **Burden rows.** `projectLedger` rows with `costType = 'Burden'`,
  `indirectPoolId`, `indirectRateType` and `burdenFiscalYear` (a CHECK requires
  all three on a Burden row, and refuses all three on any other row). One row per project ×
  element × pool × unallowable flag per run: the YTD catch-up, never an edit of
  an earlier row. Only `post-project-burden` writes them. They are memo rows (no
  journal) unless `companySettings.postAppliedBurden` posts Contract projects'
  burden as applied burden: Dr the project account / Cr the pool's applied
  account.
- **Burden feeds no base.** `PROJECT_BASE_BUCKETS.Burden` is empty, so burden is
  never burdened again through the project ledger.
- **Burden billable items.** A Burden row creates no billable item
  (`generateCostPlusItems` skips it; the T&M pricer returns null).
  `computeBurdenBilling` creates the burden items of a Cost Plus line by
  difference, one per line × pool × fiscal year: `projectLedgerId` null, with
  `indirectPoolId`, `fiscalYear`, `burdenRate`, `burdenBase` and `postingDate`.
  The billing readers (`create-project-billing-invoices`,
  `synthesizeProjectRevenue`, `create-service-order-invoice`) left-join
  `projectLedger`; the invoice groups burden lines by pool, after every other
  line, and the billing backup shows the pool, rate and base.
- **Cost relief.** Memo rows are never relieved (no journal debit on an Asset
  account); applied burden is relieved with the rest of the cost.
- **Costs page.** `get_project_burden_summary` (`getProjectBurdenSummary`) gives
  burden per element and pool. The page lists it per pool under the tree, and an
  element's Allowable cell says "of which burden".

## Project stock (Phase 2a)

`project.projectStock` (set while Draft only; the Overview's properties post to `$projectId.details.tsx`,
which keeps the stored value after that) makes the project own the stock received for it. The stripes, the stripe set of a
demand and the key order are in `inventory-system.md` → *Project stock*. What it changes here:

- **Receipts.** A stocked item on a PO line charged to a project with project stock is
  received into the project's stripe: Dr inventory, no Project Issue row, no `projectLedger`
  row. With `project.chargeAtReceipt` the receipt also writes a `projectLedger` row (no
  asset), and the purchase invoice writes a `Material Variance` row for the whole price
  variance (`stockChargedAtReceipt`, `loadInvoiceProjectCharges`). The stripe does not depend
  on the cost treatment.
- **Charge at receipt: the issue charges nothing again (C2).** The receipt row points at the
  inventory debit, so the cost is the project's while the goods sit in its stock. A movement
  of those units between the project's own stripe and the project writes a zero-net
  **relocation pair** instead of a new cost: +cost on the project debit line and −cost on the
  inventory credit line, both `projectLedger.relocatesReceiptCharge = true`. The pair bills
  nothing (`buildContractBillableItem` returns null, the Cost Plus generator filters it,
  burden billing reads billable items), nets to 0 in `get_project_cost_summary`, budget
  control, burden bases and ACWP, and gives the revenue run a Project WIP row to relieve;
  `selectUnrelievedCost` never relieves a row on an inventory account, so the receipt row
  is never relieved and stock on the shelf never leaves inventory. The split is
  `splitReceiptChargedDrafts` (`project-posting.ts`) for `post-project-issue` (per stripe
  drawn; the rest stays one ordinary row) and `insertJobProjectLedgerRows` (the job issue
  and the manual part issue/return), and the same rule in SQL `backflush_job_materials`
  (`20261023011138`). Both read `project_receipt_charge_quantities` (project, element,
  item): `onShelfQuantity` = Σ receipt Material and relocation rows on an inventory
  account (what an Issue may relocate, per project and item), `relocatedQuantity` = Σ
  relocation rows on any other account (what a Return to the project's stock relocates
  back, per element; the rest of a Return is the ordinary negative row). The relocated
  part's cost is its share of the draw by quantity. A reversal copies the flag. The
  Scrap paths move WIP to scrap, not stock, so they never split. Known limits: the
  on-shelf balance is a ledger quantity, so receipt-charged units that left the stripe
  another way (a transfer out, a count, a supplier return) still count as on the shelf
  and a later issue of uncharged units there is relocated instead of charged; a Service
  (By Coverage) charge never splits; a cutover re-cost of a relocated issue adjusts its
  project side (`recostProjectIssues`, one ledger row per cost row).
- **Jobs.** `job.receiveToProjectStock` (needs a charge number; refused with Consume to
  project, Make to Asset or a sales order line; `chargeNumberError` refuses it on a project
  without project stock) receives the output into the project's stripe
  (`complete_job_to_inventory`, `20261021004100`). A job of a project with project stock
  draws that project's stock, then unassigned stock, in `issue`, the backflush and picking.
- **The accounting cutover.** The enable's inventory reset opens one layer per item and
  stripe at the item's unit cost (`splitOpeningLayersByStripe`), and the re-cost replays
  each stripe as its own pool. A Transfer or Borrow after the cutover opens its layer at
  the re-costed cost of the stock it drew, with no journal. A Payback whose cost changes
  refuses the enable with a 409 that names the transfer and its date
  (`paybackRecostRefusal`, `activate-accounting/recost.ts`): the lender layers, the
  variance journal and the Payback Variance row cannot move with it.
- **Issue to Project.** `post-project-issue` splits an untracked issue across the project's
  stripes at the bin (`splitAcrossStripes`), one `bookAdjustment` per stripe sharing one
  journal and one `projectLedger` row. A Return goes back to the project's stock at the
  cost the issues it reverses charged, not the item's current cost: `issueReturnUnitCost`
  over `loadReturnableIssueRows` (`project-posting.ts`) — the net outstanding Project
  Issue Material cost over quantity for the item (and serial or batch) to the element, or
  the one issue a Service return names — passed to `bookAdjustment` as `fixedUnitCost`,
  the Unscrap rule. So an issue and its return net to 0 in the project and in WIP. With
  nothing outstanding (a Statistical project writes no ledger row) it books at current
  cost. What the stripes do not cover comes out of the first stripe, below zero, unless the
  company prevents negative stock (`getStrictBackflushSettings` without a location:
  Strict backflush and Prevent negative stock both on), which refuses it naming the item
  and its on-hand (Brad, 2026-10-21). A serial or batch never goes below zero. An Issue
  whose units carry no cost (`booked.cost <= 0`, zero-cost layers or an item with no unit
  cost) is refused inside the transaction, so nothing is booked.
- **`projectStockTransfer`** (Draft → Approved → Posted, or Cancelled) with lines;
  `projectBorrow` records an open borrow. Transfers open from the project's Stock page;
  its "All transfers" link opens the list (`projects+/transfers.tsx`, `transfers.new.tsx`),
  which is no longer in the module sidebar. The document is
  `project-stock-transfer+/$id.tsx`, `$id.lines.tsx`, `$id.status.tsx`. The owner pickers
  carry `common` for unassigned stock (`COMMON_STOCK_OWNER`, `toStockOwner`); the UI label
  is "Unassigned stock".
- **Approval** is `update: projects`, not the approvals engine (`updateProjectStockTransferStatus`).
  Approve refuses a transfer without lines and runs the government-furnished guard
  (`governmentFurnishedRefusal`): stock of a `governmentFurnished` project moves only to a
  project of the same customer. The posting checks it again.
- **Posting** (`postProjectStockTransfer`, `projects.service.ts`; the
  `updateProjectStockTransferStatus` operation runs it for `post`): one transaction locks
  the Approved header, checks the from-stripe's on-hand per (item, bin, lot), draws it
  with `calculateCOGS({ projectId })`, writes the `Project Transfer` Transfer pair at the
  line's bin and a relief `costLedger` row, and stamps the line's `unitCost`.
  - **Transfer** opens a layer in the to-stripe at the drawn cost. No journal.
  - **Borrow** opens the borrower's layer at the lender's cost (`costLedger.projectBorrowId`)
    and an Open `projectBorrow` with `borrowedUnitCost` and the due date. No journal.
  - **Payback** relieves the borrower at its current FIFO cost and gives the lender back the
    **borrowed** cost, one layer per borrow settled (`planBorrowMatching`: the borrow the
    payback names first, then the oldest). The difference is the borrower's
    `Payback Variance` `projectLedger` row (payback cost − borrowed cost) and a journal of
    `inventoryAdjustmentVarianceAccount` against inventory (Dr variance / Cr inventory when
    dearer, the mirror when cheaper), tagged with the borrower's project
    (`paybackVariance`). A partial payback reduces the borrow; it stays Open. A Payback
    header names both owners, filled from its borrow.
  - **Tie-out.** The variance journal equals the change in layer value, so the GL inventory
    balance stays equal to the layer valuation. Never put the lender's layer at the
    borrower's cost: the layers then do not change while the journal moves inventory.
    Pinned at 12.00 and 8.00 against a borrow at 10.00 in
    `post-project-stock-transfer.test.ts`.
- **Stock page** (`$projectId.stock.tsx`, `ProjectStock`, under Costs in the project
  sidebar when the project holds stock): the project's on-hand by item, location, bin and
  lot (`getProjectStockOnHand`), its open borrows owed and lent (overdue in red,
  `isBorrowOverdue`), its 10 latest transfers, and a **Transfer** split button (Borrow and
  Payback in its menu) that opens a prefilled Draft (`?type`, `?to`, `?borrow`).
- **Planning (Phase 2b).** MRP nets the project in its own netting segment
  (`planningSegmentId` = the project id; `project_planning_segment`). Plan-line
  materials of Unstarted / Started elements, every method but Make to Order, are
  `Project Material` demand, less what the line's own consumed-at-receipt PO line
  brings (`mrp-system.md` → *Plan-line demand*); an
  Open borrow is firm demand on the borrower and firm supply on the lender. The
  segment draws unassigned stock only from the unassigned segment's true surplus, and
  only through a **Transfer** planning action. Applying it creates a Draft
  transfer (`applyTransferPlanningActions` → `createProjectStockTransfersFromActions`,
  `projects.service.ts`, `planningActionId` on the header). An Order or Make in the
  segment creates a PO line charged to the project or a job with
  `receiveToProjectStock`. The project's manager owns its planning actions.
  Details: `mrp-system.md` → *Project netting segments*.
- **Overdue borrows.** The Overview page's *Needs attention* list shows a row,
  linked to the Stock page, when an Open borrow the project owes or lent is past
  its due date on the company's calendar (`getProjectBorrows` with `dueBefore`,
  in the `$projectId.tsx` loader, as `overdueBorrowCount`). The header has no badge.
  The planning worklists list the same borrows above the grid.

## Planning groups, pegging and distribution (Phase 3)

Commercial: the feature key is `PLANNING_GROUPS` (Business, Partner). The pegging engine is in
`packages/ee/src/pegging/` (`@carbon/ee/pegging` for the pure functions, `@carbon/ee/pegging.server`
for `upsertPlanningGroup`, `createManualPeg` and `writeGroupPegs`). The MRP side is in
`mrp-system.md` → *Planning groups and pegging*.

`@carbon/planning` reaches the ERP client graph, so it must not import a `.server` module.
The MRP run gets the commercial functions by dependency injection: every server-side caller
passes `planningGroupMrpDeps` (`@carbon/ee/pegging.server`: the `companyHasFeature`
check and `writeGroupPegs`) as `runMrp`'s fourth argument. The callers are the ERP's
`runMRP` (`production.service.ts`), the jobs MRP cron, and `planDemoCompany`. Without the
deps, a run degrades as it does for a company without `PLANNING_GROUPS`. A new caller
that forgets them silently plans without groups.

- **The group.** `planningGroup` has a location, an excess rule (`Common Stock` or
  `Exception Project` with `exceptionProjectId`), a priority rule (`Earliest Need` or
  `Project Priority`) and `active`. `upsertPlanningGroup` calls `requireEntitlement` first, then
  refuses a location of another company and an exception project without project stock.
  `deletePlanningGroup` (`projects.service.ts`, no plan check, so a lapsed plan can clean up)
  refuses while a member, a grouped PO line or a grouped job exists. Pages: Projects →
  **Planning Groups** (`projects+/planning-groups*.tsx`). The list shows
  `PlanningGroupsUpgradeOverlay` through `usePlanGate`; the write routes call `requireFeature`.
- **Membership.** `project.planningGroupId` and `project.planningPriority` (lower first), set on
  an existing project's Overview properties (shown only when the company has a group). The CHECK `project_planningGroup_stock_check` requires
  project stock, and the `$projectId.details.tsx` action requires the group at the project's
  location. `project_planning_segment` returns the group id for a member of an active group.
- **Grouped supply.** A PO line or job made for the group carries `planningGroupId` and no
  `projectId` (`purchaseOrderLine_owner_check`, `job_owner_check`). Applying an Order or Make in
  a group segment creates it (`getPlanningSegmentOwners`, `projects.service.ts`), and
  `moveActionPegsToSupply` moves the action's pegs onto the new supply in one transaction.
- **Peg states.** `projectPeg` rows are versioned: a row is never updated in place. A new row
  supersedes the old one (`supersededAt`, `supersededByRunId`). The writes in place are
  `itemLedgerId` on the Hard row a receipt just made and a Manual peg's `exception`.

  | State | Set by | MRP may change it? |
  |---|---|---|
  | Soft | the MRP run, on open or planned supply | yes, on every run |
  | Hard | `harden_pegs_for_supply`, at receipt or completion | never |
  | Manual | **Override** on the Pegging page, with a reason (`createManualPeg`) | no; a gone demand sets `exception` |

- **One way, one rule.** Only `harden_pegs_for_supply(supplyType, supplyId, quantity)`
  (`20261021005400`) turns Soft pegs Hard. It locks the supply's current pegs in need date,
  project priority and demand source order, supersedes each peg it covers, and inserts a Hard row
  with `hardenedAt`. The uncovered part keeps the peg's state. It returns one row per member
  stripe plus an excess row: the exception project, else unassigned stock. `post-receipt` and
  `complete_job_to_inventory` both call it. The reverse for a negative receipt is
  `soften_pegs_for_return` (`20261021005700`): the excess first, then the Hard pegs, latest
  first.
- **Distribution at receipt.** `postReceipt` (`inventory.service.ts`) calls
  `hardenPegsForSupply` (`inventory/grouped-receipt.ts`) per receipt line of a grouped PO
  line in the posting transaction, then splits the line's item ledger rows and cost
  layers into the returned stripes (`allocateToStripes`, `stripeItemLedgerRows`,
  `stripeCostLedgerRows`). The last piece of a layer takes the rounding rest. The journal
  does not change: one inventory debit per line. `linkPegsToItemLedger` sets each Hard
  peg's `itemLedgerId`. A void softens the Hard pegs of the receipt's rows
  (`softenPegsOfItemLedger`).
- **Distribution at completion.** `complete_job_to_inventory` (`20261021005500`) loops over a
  stripe list: one stripe for an ungrouped job, the harden rows for a grouped job. The Output
  layer is written per stripe at the job's unit cost, so scrap spreads through the unit cost
  with no separate posting. The backflush of a grouped job draws the members' stock in the
  pegs' order, then unassigned stock.
- **Price variance.** At invoice, `allocateVarianceAcrossLayers` spreads the variance over the
  striped layers. For a PO line with `planningGroupId`, the share of units already consumed goes
  to each member's project account as a `Material Variance` `projectLedger` row
  (`stripeVarianceCharge`, `invoicing/project-charges.ts`). A Statistical member's
  share stays in purchase price variance.
- **Commitments.** `get_project_cost_summary` (`20261021005600`) adds each Soft and Manual peg on
  an open PO line to the project's committed cost, valued at
  `quantity / conversionFactor × unitPrice`, by the peg's element (none is the project root).
- **Member moves.** MRP proposes a **Transfer** from a sibling's permanent excess and a
  **Borrow** (with a payback date in `triggerValues`) from the rest of a sibling's stock, when
  the sibling needs it later. `createProjectStockTransfersFromActions` (`projects.service.ts`)
  makes a Draft transfer of the action's type. It refuses a Borrow with no payback date.
- **The Pegging page** (`$projectId.pegging.tsx`, `ProjectPegging`, under Costs in the project
  sidebar while the project has a current peg) lists the project's current pegs by item (`getProjectPegs`). With **As of**
  it shows the rows current at the start of the next day in the company timezone:
  `createdAt <= asOf AND (supersededAt IS NULL OR supersededAt > asOf)`. **Override**
  (`$projectId.pegging.manual.tsx`, in the row ⋯ menu) replaces a Soft peg with a Manual peg on another open PO line
  or job of the group (`getPlanningGroupOpenSupplies`). The state colours are
  `PROJECT_PEG_STATE_COLOR_MAP`.

## Timesheets

`timesheetEntry` status: Draft → Submitted → (Approved) → Posted, or Rejected; in DCAA
mode also Pending Employee Review (an entry someone else changed). A
Rejected entry is editable and returns to Draft on save. Every save goes through the
`save-timesheet-entry` posting and every week submit through
`submit-timesheet-week`, from the ERP and the MES; the DCAA rules (Government
Contracting 5a) live there, see `.claude/rules/government-contracting.md`. A Posted entry changes only by
`createTimesheetCorrection`: a negative reversal (`reversalOfId`, `correctionReason`)
plus a replacement entry. With `companySettings.timesheetApprovalRequired` off, submit
posts at once. Log time (`save-timesheet-entry`, `add` mode) submits its entry in Standard
mode. In DCAA mode it saves a Draft, which waits for the weekly certification
(`submit-timesheet-week`), and the route posts nothing (Brad, 2026-10-11).
Each entry also carries a work location and a research role (R&D tax, Phase 5d);
`save-timesheet-entry` defaults them from the job location and the labor category, and
both are part of a cell's key (`government-contracting.md` → *R&D tax*).

**Time not posted yet** (the project Time page and the element page's Actual tab) gives
each row its next step (`OpenTimeAction`, `ui/Element/OpenTimeAction.tsx`): the employee's
own Draft → **Submit week** (posts to `timesheet.submit.tsx` with `redirectTo`, so it
returns to the page; the whole week is submitted, as on My Time); a Submitted entry →
**Approve** (**Post** with approval off), the Approvals action, for `update: projects`; the
employee's own DCAA Draft, Rejected or Pending Employee Review entry → **Open My Time** on
its week (the certification and the review stay there). Another employee's Draft has none.

**My Time** is personal and lives at `x+/timesheet` (`path.to.timesheet`), outside
the Projects layout; `x+/projects+/timesheet.tsx` redirects there. It is a week of bars
(`TimesheetWeek`, Brad 2026-10-20, after the JOLT timesheet; the chart is
`WeekHoursChart` from `@carbon/react/WeekHours`, which the MES My Time uses too, with
`size="lg"` for touch): the week's charge numbers
as cards on the left (**Add**, **PTO**, **Remove**, the week total), and seven day
columns on a fixed 0–24 h scale (`MAX_DAY_HOURS`; the chart scrolls) with one
bar per charge number, stacked in the order the time was entered (`stackDay` on the
cell's `createdAt`, so new time lands at the bottom where it was clicked). One hover state
for the whole week drives the one preview. Clocked timecard time shows as a duration
("8h, 32m"), never as decimal hours beside the logged total. A click below a day's bars
gives the selected card time up to the click (`fillToPointer`, half-hour steps, with a
dashed preview); dragging a bar's lower edge or its arrow keys change its hours
(`snapHours`); × or Delete saves 0, which deletes the Draft entry. Every change is one
`save-timesheet-entry` cell save, so the DCAA reasons, the future-day lock (leave
excepted) and the status locks are the grid's. A Posted bar's menu has **Correct**.
**PTO** is Add with `pto`: the charge number picker lists only leave elements
(`ChargeNumber leaveOnly`), and says how to set one up when there is none. **Remove**
deletes a card's Draft hours (Standard mode; in DCAA only an empty card), and **Submit
week** shows its checks in a tooltip. The manager's view of another employee's week
(`projects+/timesheets.$employeeId.tsx`) keeps `TimesheetGrid`. A Service row is
read-only on both: service time posts from Draft at Stop Work or Add Time on the order,
so `submit-timesheet-week` submits Standard entries only and `post-timesheet` posts a
Service project's Draft entry.

`post-timesheet` costs hours × the labor category's rate on the entry date
(`laborCategoryRate.effectiveFrom`), Dr the project account / Cr
`laborAbsorptionAccount`. After the cutover it writes one journal per accounting period;
before it, one Provisional journal with no period. A reversal undoes what
its original booked (`loadTimesheetBookings`, `pushReversal`), never what the project
would book today: the negated Σ of the entry's Timesheet rows (dilution adjustments
included, so it nets to 0 exactly), on the account of the original posting row's
journal debit line, with its `unallowable` flag. An original that built an asset follows
the asset (its CIP class, or the in-service class once Active). The posting row is the
entry's earliest live row with hours, never a 0-hour dilution adjustment, so its Time &
Materials item is the one reversed. An original with no posting row (Statistical)
reverses nothing. A correction's replacement on the original's labor category rebooks
at the original's undiluted booked rate (`bookedRate`), not today's rate for the date.
`post-project-expense` reverses to its original's debit account and flag the same way. The MES calls it through `erpPosting` with system scope,
because it requires `projects_update` and an operator does not hold it; the routes check
ownership first. The ERP calls it through `postTimesheetEntries` (`projects.service.ts`,
`invokePosting`) after the calling operation's own permission check.

RLS: an employee may insert and update only their own Draft rows. Save and submit
(the two postings), correct (`createTimesheetCorrection`) and post run over
Kysely, so they bypass that check. Approve and reject use the Supabase client and need
`projects_update`.

## Capital projects (Capitalize)

`projectValidator` requires `fixedAssetClassId` (a CIP class) for Capitalize; the
form reads CIP classes with `getCipFixedAssetClasses`, because
`CONSTRUCTION_IN_PROGRESS_ENABLED` stays false.

- `ensureCapitalAssets` (`projects.service.ts`) creates the Under Construction assets:
  one for the project and one per `isFinalAsset` element without one, all ids and
  numbers in one statement. The status route calls it before every change to
  Released; the element update route calls it when `isFinalAsset` turns on past Draft.
- Each poster writes a CIP row right after its `projectLedger` row
  (`writeProjectCipRows`, `projects/project-cip.ts`), for every company.
- A capital job (`loadJobProjectCharge` returns `keepsWip: true`) keeps its WIP lines
  and builds `job.fixedAssetId` through the job-to-CIP sweep; SQL
  `project_cost_treatment` mirrors `resolveProjectTreatment`
  (`20261021001600_complete-job-cip-project.sql`). `chargeNumberError` refuses
  `consumeToProject` on a Capitalize project.
- **Place in service** (`$projectId.place-in-service.tsx`, `PlaceInServiceModal`)
  runs `capitalizeCip` once per asset (needs `update: projects` and
  `create: accounting`), then `completeElementSubtrees` moves the final-asset
  elements and their descendants to Completed.
- Voids call `reverseProjectCipRows` beside `reverseProjectLedgerRows`.

Details (late costs, remaining-life Straight Line): `fixed-asset-lifecycle.md` →
*Capital projects*.

## Trace links and suspect flags

`projectElementLink` (`fromElementId`, `toElementId`, `linkType`, `suspectSince`,
`reviewedAt`): both ends in one project, no self link. `canLink` checks the ends
(`allowedLinkEnds`), duplicates and `precedes` cycles. `feeds` (Parameter →
Parameter) is written only by `saveParameterFormula`, so `deleteProjectElementLink`
refuses it. Only the parent link rolls up cost.

`updateProjectElementField` marks the incoming links of an element suspect when a
`suspectLinkFields` value really changes (name, description, target, Parameter
value and unit); a `feeds` link never turns suspect. `clearSuspectLink` reviews one.

## Verification and Parameters

`computeVerification` (`projects.models.ts`, pure, tested) computes every Parameter
and Requirement from the rows the page loads; there is no SQL function.

- Parameter source: Manual; Sum, Min or Max of child Parameters (same unit only);
  Formula; Item (`parameterItemField` = `unitCost` or a Numeric custom field id of
  the nearest linked part). A Parameter's children must be Parameters
  (`insertProjectElement`, `moveProjectElement`).
- Formula: a closed grammar parsed by `parseParameterFormula` — numbers, readable
  ids, `+ - * /`, unary minus, `min`, `max`, `abs`. Nothing executes. A cycle shows
  an error.
- Contingency gives `checkedHigh` / `checkedLow`; allocation × the parent Parameter
  gives the budget (`formatAllocation`).
- A Requirement passes when its actual Parameter meets the target and no verifying
  Test Case failed; `rollUpRequirementStatus` rolls up child Requirements.
- Item values: `getProjectItemValues` reads `itemCost.unitCost` and the typed table's
  `customFields` (`part`, `material`, `tool`, `consumable`; the row id is the item's
  `readableId`), at most 6 queries. `item` has no `customFields` column.

## The Plan page: layouts, filters and the Reader PDF

Three layouts (`projectLayouts`): List (Linear's grouped list, `ElementList`), Tree
(React Flow boxes + dagre) and Reader. A URL with no layout, a retired one (`table`,
`board`, `timeline`) or the old `?type=` param redirects (`canonicalElementsParams`):
the layout becomes `list`, `?type=X` becomes `filter=type:eq:X`, and every other param
stays, `cr` included. The Reader PDF (`file+/project+/$id[.]pdf.tsx`, `ProjectReaderPDF`
in `@carbon/documents`) reads the same filters (`parseElementFilters`) and outline
(`buildReaderOutline`).

One toolbar row (`ElementsHeader`): the layout `Tabs`, then Filter (Type, State, Owner,
Milestone, Label; Type is single choice) and the **New Element** `SplitButton`, which
posts a default name per type to `path.to.newProjectElement` under the open element.
The page's only search is the project sidebar's "Search elements" box
(`ProjectElementTree`): it filters the tree at once and writes `?search=` (debounced)
on the Plan page. The List is not an editable table: it groups the rows by state
(`sortStates` order, empty groups hidden, each group collapsible, a hover "+" adds a
Task in that state), keeps tree order inside a group and indents a row only under a
parent in the same group. Only the state, the owner and the target date edit in place,
each through its picker (`StatePill` / `OwnerPill` / `DatePill`); labels are read-only;
a click anywhere else opens the element's page. A hover row menu has Open, Add child,
Move to…, Copy id and Delete.

States and labels are company-wide (`20261021012100_project-states-company-wide.sql`):
`projectState` and `projectLabel` have no `projectId`, a name is unique per company, and each
state group has at most one default per company. Settings → Projects edits them in two grids
(`ProjectStatesGrid`, `ProjectLabelsGrid`, posting to `settings+/projects.tsx`); the project
Settings page has no states or labels. `seed-company` seeds the six default states; creating,
copying or building a project, a template or a service order seeds or copies none, and an
element keeps its state id. `projectElement_state_fkey` is `("stateId", "companyId")`.

**Shared with service.** `ElementsHeader`, `ElementList`, `ElementView` and their pieces
(pills, `MoveElementModal`, `ElementChildren`, `QuickAddRow`, `ElementComments`,
`ElementPlanLines`) take their links, write actions, element types and permission module
from `ElementRoutesProvider` (`ui/Elements/ElementRoutes.tsx`); with no provider they use
the project routes (`projectElementRoutes`). A service order's and a service template's
work pass service routes (`field-service.md` → The module UI). Never hard-code a
`path.to.projectElement*` in these components again: read `useElementRoutes(projectId)`.

An element opens on its own page, `path.to.projectElement` → `/x/project/$id/element/$elementId`
(`ElementView`), from the List, the Tree, the Reader, the sidebar tree, links and child rows.
There is no element panel: the old `/elements/$elementId` URL only redirects to the page (its
plan, job, purchase order line, comment and delete action routes stay under it), and the project
layout hides the project header and the project sidebar on the page. The page has one header
row: back, the project and the ancestors, a copy button for the readable id, and one ⋯ menu (Log
time, Issue material, Charge cost, Add child, Add link, Delete). Below it are a main column of at most 800 px
(the readable id with the Linear and Jira issue buttons at its right, title, description, then
Children, Costs, Links, each only when it applies, then Activity) and a 300 px properties
column (`ElementSidebar`, inline fields from
`ui/Element/PropertyFields.tsx`: the properties, the type's fields from `ElementTypeBlock`, Work,
Costs with children, and the Government contracting group, shown only with DCAA timekeeping).
Costs is one block with two tabs: **Estimated** (the plan line cards, `ElementPlanLines`) and
**Actual** (`ElementTimeAndMaterials`: the ledger rows and the open time as cards; on a service
order the `charges` prop instead). It opens on Estimated while the project is Draft (or has no
project row) and on Actual after; the user's choice holds until the page remounts. Every
type but a Parameter shows it, so an empty Task shows Estimated with its Add line button.
The earned value form posts to the page route's action.

On a Contract project the Work group has a **Billing element** switch for every type but
Parameter. It posts `field=isBilling` to the element update route
(`$projectId.elements.update.tsx`), which refuses a project that is not Contract and calls
`updateProjectElementBilling` (`projects.service.ts`). That refuses a second billing element in
one branch (an element and its ancestor), a Parameter, and turning the flag off while a contract
line bills the element. It is a live write, not a plan-layer field.

Both tabs are lists of cards, not tables (Brad 2026-10-21), each with one toolbar row
(`CostToolbar`, `ui/Element/CostCards.tsx`): a search box, a type menu (Material, Labor,
Cost) and a sort menu, all local state (the element page's query string belongs to the Plan
page it came from), then the tab's action at the right. Filtering and sorting are the pure
helpers of `ui/Element/cost-cards.ts` (tested).

**Estimated** (`ElementPlanLines`) is one card per plan line: the estimate, what has been
charged against it, a thin progress bar (red when over the estimate), and one button that
charges more. **Issue** (material, stocked items only) opens `IssueMaterialModal` with the
item and the quantity still to issue; **Log time** (labor) opens `LogTimeModal` with the
category; **Charge** (cost) opens `ChargeCostModal` with the description and the amount
left. A click on the card, or **Edit** in its ⋯ menu, opens `PlanLineModal`; **Add line**
(Material, Labor, Cost) opens the same modal for a new line. Both post the upsert intent to
the plan route.

- **Actuals by key.** `getElementTimeAndMaterials` returns `planActuals`, the element's OWN
  rows (not its subtree), summed by plan-line key with no row limit: material cost by item
  (`Material` and `Material Variance` ledger rows), labor hours by category from the
  timesheet entries (Posted, and not posted yet) with the cost from the `Labor` ledger rows,
  and Posted expenses by `LOWER(BTRIM(description))`. A cost line therefore finds its
  charges by description, which the Charge button prefills. When two lines share a key, the
  oldest takes the whole actual (`keyOwners`), as `post-project-issue` raises the oldest
  line's `quantityIssued`. The material quantity is `quantityIssued` itself.
- **Order.** `orderPlanRows` (`ui/Element/plan-rows.ts`, pure, tested): materials, labor,
  costs, each by `createdAt` then `id`. The sort menu reorders from there (`sortPlanCards`).
- **Item change.** Choosing an item in `PlanLineModal` reads `itemCost.unitCost` through the
  browser client, as `JobMaterialForm` does, and sets the line's unit cost and the item's
  unit. A labor line has no stored amount: its estimate is hours × the category's cost rate
  in effect today (`getProjectElementPage` adds `costRate` to each labor category), as the
  plan cost of `get_project_cost_summary` reads it. A line with no cost shows money only once
  something is charged.
- **Plan lock.** With the plan locked and no Draft change request, Add line is disabled with
  `projectPlanLockedMessage` as its tooltip, as New Element is on the Plan page.

**Actual** (`ElementTimeAndMaterials`) is one card per ledger row of the element's subtree
(an expense shows its own description; a row of an element below names it), then the time
not posted yet with its next step (`OpenTimeAction`). Its **Charge** menu has Issue
material, Log time and Charge cost; with nothing charged it shows the empty text and the
same menu. On a service order the `charges` prop replaces the tab, and the Estimated cards
have no charge buttons (the order posts through its own charge route).

**Charge cost** (`x+/projects+/expense.tsx`, `path.to.projectExpense`, `update: projects`)
checks the budget (source `purchase`: Block refuses, Warn flashes), then `addProjectExpense`
(`projects.service.ts`) inserts a `projectExpenseEntry` and posts it through
`post-project-expense` (Dr the project account / Cr GRNI, one Other Direct ledger row). An
entry that does not post is deleted again, so a refusal leaves nothing behind.

The Tree layout draws one box per parent. `layoutElementTree` (`graph/tree-layout.ts`,
pure, tested) gives a box to each parent that has matching descendants. Dagre places the
boxes, left to right only, and the cards stack in their box at fixed offsets. The type
filter is a lens on the Tree: the loader drops `type` for the Tree, and a box stays while
a card below it matches. `?root=` shows one subtree under a breadcrumb, and the Plan
route (`$projectId.elements.tsx`) skips its own reload when only `root` changes.

`countTraceLinks` and `highlightTraceLinks` give the "N tests" and "N reqs" counts
and their highlight. `ElementTypeIcon` holds the one colour of each type (its icon);
the Tree's cards and boxes are neutral, as in Flow. A card states its fixed size
(`CARD_WIDTH` × `CARD_HEIGHT`), and the view fits from the layout's box sizes
(`treeViewport`, `graph/tree-viewport.ts`, tested) once `useNodesInitialized({
includeHiddenNodes: true })` is true, when the boxes move and when the canvas resizes.
The plain `useNodesInitialized()` never turns true on this canvas: it reads `measured`
off the node objects, and the canvas has no `onNodesChange` to write it back.
`getProjectElementCommentCounts` reads the comment counts in one paged read. `ChangeRequestPicker` in the project sidebar lists
`openChangeRequestStatuses` and sets `?cr=`.

`projectView` and `projectUserPreference` are no longer read or written (saved views
and the per-user layout preference were removed on 2026-10-12); the tables stay.

## Templates, Build from part and part links

- `copyProject` copies milestones, elements (renumbered), element labels, links and
  plan lines (states and labels are company-wide, so a copied element keeps its ids); it clears history (assets, verdicts, reviews, issued quantities, job and
  PO line ids). `project.isTemplate` marks a template.
- An element (not a Parameter) links an item and optionally one serial
  (`trackedEntityId`); a trigger refuses a serial of another item and fills an empty
  item from the serial.
- `buildElementsFromPart` / `previewBuildFromPart` (`$projectId.elements.build.tsx`)
  create System elements from a serial's build history (the lineage RPCs, one call per
  level; `netBuildComponents` counts Consume and Service inputs, less Unconsume, less
  a component a later service order removed from the asset's `customerAssetComponent`
  rows), an item's active make method (`getMethodTree`; lines
  without an `itemCost` row are counted as skipped) or a template's elements, under one
  parent, in one transaction. `planElementsFromSource` is the pure planner. With
  `includePlanLines` a template source also copies the plan lines of the elements it
  copies (a service order passes it; Projects does not). `insertElementsFromPart` is the
  same build in the caller's transaction.
- `get_element_history_by_item` averages hours and material cost over the elements
  that charged the same item. `getProjectElementPage` still loads it, but the element page
  no longer shows it.

## Plan-line actions and other charge numbers

- **Create Job** (`$projectId.elements.$elementId.create-job.tsx`) and **Create PO
  line** (`…create-po-line.tsx`) from a plan-line material stamp
  `projectElementMaterial.jobId` / `purchaseOrderLineId`.
- Reimbursement lines carry `projectId` + `projectElementId` (`ChargeNumberControlled`);
  charge lines show the charge number read-only.
- The Schedule page (`$projectId.milestones.tsx`, `MilestoneSchedule`) lists the milestones
  on the left and draws each one's bar on the same row of a timeline, at a Weekly, Monthly
  or Quarterly scale (`?scale`; the window and the header periods come from the pure
  `scheduleLayout`, `ui/Milestones/schedule-scale.ts`, tested). A row or a bar opens the
  milestone's drawer (`?milestone=`): dates, progress, hours, cost, actions and the burn
  chart (`buildBurnSeries`), which plots Posted timesheet hours against the ideal line.

## WBS codes

`projectElement.wbsCode` holds a PINNED code only; every other code is derived on
read by `computeWbsCodes` (`@carbon/utils` `wbs.ts`): siblings by `sortOrder` then
`sequence`, a Parameter's subtree unnumbered, a child of a code ending `.0` drops
the `.0`. A move never changes a pinned code. Codes are computed from the WHOLE tree
(`getProjectWbsNodes` when the list is filtered). `wbsCode` is a plan-layer field.

- Writes: the element field route (`wbsCode` case, unique-violation → refusal),
  `pinProjectWbsCodes` (one UPDATE FROM VALUES, refuses duplicates),
  `renumberWbsSubtree`, `insertElementsFromWbsTemplate` (via `createProject`'s
  `wbsTemplateKey`; templates in `@carbon/utils` `wbs-templates.ts`, 881F
  Appendix B, A, C, F). Build from part sets `wbsCode` null on copied elements.
- CSV: `toWbsCsvRows` / `readWbsCsv` (pure, `projects.models.ts`) and
  `importProjectWbs` (one transaction, refused on a locked plan, never deletes; a
  blank cell keeps its value; a code pins only when it differs; a row with no
  change is skipped; a `Type` change and a parent loop, among new rows too, are
  row errors). The route needs `create` and `update` on projects. Changing codes
  are cleared before the writes, so a swap does not trip the unique index. A
  name the CSV encoder stripped (`+28V` exports as `28V`) reads back unchanged.
- Pin and Renumber write the live plan even under `?cr=`; a Parameter refuses a
  pinned code.
- MSPDI: `buildMspdiXml` (pure; golden fixture `__fixtures__/mspdi-golden.xml`).
- UI: `WbsCode` badge in `ElementList` and `ProjectElementTree` only once the
  project has a pinned code; `WbsMenu` (Export CSV, Export MS Project XML, Import
  CSV, Pin WBS codes) in `ElementsHeader`; the element page's WBS code field and
  Renumber WBS.

## Baselines, change requests and the plan lock

The **plan layer** is `PLAN_LAYER_FIELDS` (`projects.models.ts`): the plan columns of
`projectElement` and of the four other plan tables (links and the three plan-line
tables). Progress (state, owner, priority, labels, dates, milestone, verdict) and
history (a link's suspect flag and review, a material's issued quantity and job or PO
line, an element's asset, `isFinalAsset`, the cost treatment) stay out.
`isPlanLayerField(table, field)` is the test every route uses.

- **Baseline** — `projectBaseline.snapshot` holds `{ elements, links, materials,
  labor, costs }` (`toPlanSnapshot`, sorted by id) with `formatVersion`
  (`PROJECT_BASELINE_FORMAT_VERSION`). `insertProjectBaseline(trx, …)` takes
  `project.nextBaselineSequence` (the UPDATE locks the project row) then loads the
  snapshot (`loadPlanSnapshot`, 5 queries). Completing a milestone takes one
  (source Milestone). `diffPlanSnapshots` reuses `diffRows` (`modules/shared/diff.ts`).
  Format version 2 (Government Contracting 5c, C6) adds `schedule`: each element's
  `startDate` and `targetDate` (`PlanScheduleRow`). Dates stay progress fields, so
  change requests, the diff and the plan lock ignore `schedule`
  (`ProjectPlanSnapshotKey` leaves it out); earned value reads BCWS from it. A version
  1 baseline has none.
- **Change request** — `projectChangeRequest` (Draft → In Review → Approved → Applied,
  or Rejected / Cancelled) with one `projectChangeRequestItem` per touched row:
  `operation`, `targetTable`, `targetId` (an Add's id is made up front in the SQL
  `id()` format), `payload`, `baseRow`. `mergeChangeRequestItem` (pure) folds a write
  into the row's item; `upsertChangeRequestItems` writes a batch in one transaction and
  refuses anything but a Draft. `createChangeRequest` takes a "Before" baseline.
- **Overlay** — the plan-layer routes read the change request with
  `readChangeRequestId` (form field `changeRequestId`, else `?cr=` on the action URL;
  the UI uses `withChangeRequest`) and call the `*InChangeRequest` helpers instead of the
  live write. Progress fields always write live. `applyChangeRequestItems` (pure) gives
  the plan as the change request leaves it, with the delete cascades;
  `overlayElementList` / `overlayPlanLines` / `overlayLinkList` and
  `getProjectElementPageInChangeRequest` show it on the pages, each row with its
  `changeOperation`. A formula save is refused in a change request (its `feeds` links
  do not travel).
- **Apply** — `applyChangeRequest(db, …)` runs in one Kysely transaction: it locks the
  change request and the project, refuses with `ProjectChangeConflictError` when
  `findConflicts` finds a live row that changed since its `baseRow` (or is gone), then
  applies element Adds (numbered from `nextElementSequence`), Updates
  (`jsonb_populate_recordset`, one statement per table), line and link Adds and Deletes,
  and element Deletes (refused when the subtree has charges). It takes an "After"
  baseline and sets Applied. `reopenChangeRequest` rebases the items onto the live plan
  (`rebaseChangeRequestItems`).
- **Approval** — the status route (`$projectId.change-requests.$crId.status.tsx`) opens
  an approval request when `isApprovalRequired(…, "projectChangeRequest", …)` is true
  (approval rules are commercial, so Community always gets false). With a pending
  request, `approveRequest` / `rejectRequest` (`packages/ee/src/approvals/service.ts`)
  flip the change request from In Review only; else a user with `update: projects`
  decides directly. The ERP route runs the apply after either; no projects code lives in
  `packages/ee`. The notification document id is `<projectId>:<crId>`.
- **Plan lock** — `project.lockPlanAfterMilestoneId`. `isProjectPlanLocked` is true once
  that milestone has `completedAt`. `requireEditablePlanRoute` (wrapping
  `requireProjectPlanEditable`) refuses a plan-layer write outside a Draft change request
  with `projectPlanLockedMessage`. `applyChangeRequest` never calls it.
- **Review** — `getChangeRequestReview` diffs the live plan against the overlay (Applied:
  its Before and After baselines). A `projectChangeRequestView` mark is per element card
  and goes stale when an item of that element is newer than `viewedAt`. Comments may
  target a field (`targetTable`, `targetId`, `field`); Resolve writes over Kysely
  because RLS lets only the author update a comment.

## Linear and Jira

Any element (every type) links to one Linear or Jira issue from the element page:
the buttons sit at the right of the readable id, above the title. Name, description, state (by state group), owner, priority and target date
sync both ways through the issue-sync engine (`issue-sync.md`). A locked plan refuses
an inbound name or description; a Closed project refuses every field.

## Known gaps

- A receipt still creates a Receipt-usage inspection lot for a line the project
  consumes at receipt.
- `receiptLine` has no charge columns. A receipt reads the charge number from its PO
  line.
- The `jobs`, `purchaseOrderLines` and `purchaseInvoiceLines` views predate the charge
  columns, so screens load them with `getJobProjectCharge` / `getLineChargeNumber`.
- `POSTING_POLICY` keeps every project and service journal type off external ledgers by
  default: `Timesheet`, `Project Issue`, `Project Expense`, `Project Transfer` and
  `Service Order`. One rule, as for every journal type added after the returns types
  (Brad 2026-10-10); a customer turns each one on in the integration's settings.
- Ids inside the JSONB of `projectBaseline.snapshot` and `projectChangeRequestItem`
  (`payload`, `baseRow`) are not rewritten by a restore into another company.
- With the plan locked, the Plan page turns off only create and delete; the other
  plan-layer controls stay enabled and the server refuses them.
- The demo datasets seed no change request, item, comment or view. The satellite
  ORBSEC Block 2 project has baseline 1 (`ProjectSpec.baseline`, tier 09
  `seedProjectBaseline`, written with `toPlanSnapshot` from `@carbon/database/project-plan`).
- The demo datasets seed project stock and one Posted Transfer per Contract project
  (`seedProjectStock`, tier 09), but no borrow.
- The satellite dataset seeds the **Star Tracker** planning group (`seedPlanningGroups`, tier
  09): a striped receipt with Hard pegs and an open PO line with Soft pegs. The other three
  datasets seed no group.
- Phase 3: a group segment can get a Transfer from unassigned stock (`commonSurplusDraws`) with
  the group id as `toProjectId`; applying it fails on the project FK. Without the feature, the
  planning RPCs still group on-hand by `project_planning_segment`, so a lapsed plan shows group
  rows. The void of a negative receipt puts units back in the member stripes but leaves the
  pegs Soft until the next run.
- A Posted project stock transfer has no void; a Transfer back is the correction.
- Planning: a Project Material demand writes no `demandForecastSource` lineage row,
  so the item planning chart cannot name the plan line. The order drawer's Open
  Orders / Open Jobs list every segment's orders of the item, and a `?item=` link
  opens the item's first segment row.
