---
paths:
  - "apps/erp/app/modules/projects/**"
  - "packages/server-functions/src/post-timesheet/**"
  - "packages/server-functions/src/post-project-issue/**"
  - "packages/server-functions/src/post-project-expense/**"
  - "packages/server-functions/src/lib/project-posting.ts"
  - "packages/server-functions/src/lib/project-cip.ts"
  - "packages/server-functions/src/post-project-stock-transfer/**"
  - "packages/server-functions/src/lib/stock-stripes.ts"
---

# Projects

Phases 1a, 1b, 1c, 2a and 2b of `.ai/specs/2026-10-03-projects.md`; plans
`.ai/plans/2026-10-07-projects-phase-1a.md`,
`.ai/plans/2026-10-08-projects-phase-1b.md`,
`.ai/plans/2026-10-08-projects-phase-1c.md`,
`.ai/plans/2026-10-08-projects-phase-2a.md` and
`.ai/plans/2026-10-08-projects-phase-2b.md` (their *Execution notes* record every
deviation). Module guide: `apps/erp/app/modules/projects/AGENTS.md`.

A project is a tree of typed elements. A charge number (a project, or a project plus
an element) is the cost object that jobs, PO lines, purchase invoice lines, charge and
reimbursement lines, timesheet entries and project issues post to. `projectLedger` is the
project's subledger of actual cost.

## Treatment is decided at the source

The cost treatment decides the GL account when the cost is posted, not later. There
is no month-end sweep.

`resolveProjectPostingAccount(ctx, postingDate)` (`lib/project-posting.ts`) is the
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
`20261009055331_projects-functions.sql`, redefined by
`20261009100941_project-posting-account-missing-default.sql` and, for Capitalize,
`20261009103835_project-posting-account-capitalize.sql`) mirrors the TS resolver for
the SQL posting paths: `complete_job_to_inventory` and `backflush_job_materials`
(migration `20261009071629_complete-job-consume-to-project.sql`). Change both together.

The SQL returns NULL for Statistical only. A missing account default raises the TS
resolver's message ("Set Project Expense in Account Defaults …"), and a missing project
raises too. So the callers' "consumes to a Statistical project" branch means Statistical.
Before the redefinition a missing default also returned NULL and read as Statistical.

## `projectLedger`

One row per cost that reaches a project: `costType` (Material, Labor, Machine,
Overhead, Material Variance, …), `documentType` + `documentId`, `amount`, and
`journalLineId` when a journal exists. Build rows with `buildProjectLedgerRow`.

- Only server functions and the job-completion SQL write it. The ERP only reads it
  (`getProjectLedger`, `getElementTimeAndMaterials`, `get_project_cost_summary`,
  `get_child_service_project_costs`).
- A Statistical charge writes no row. Neither does a Statistical timesheet: the entry is
  only stamped Posted, with no journal (`post-timesheet/plan.ts`).
- A void or repost writes negative rows with `reversalOfId`
  (`reverseProjectLedgerRows`). Never delete or update a row.
- Rows written inside an accounting gate exist only with accounting on: `issue`,
  `post-production-event`, job completion and the purchase invoice. Receipts, charges
  and reimbursements write rows with accounting off too.

## Charge gates

`assertChargeable(ctx, mode)` refuses with a `ProjectChargeError` (status 422):

| Mode | Project status | Element |
|---|---|---|
| `new` — time, an issue, a new charge | Released | chargeable, state group Unstarted or Started |
| `commitment` — receipt, invoice, job issue or completion, reversal, return | Released, On Hold or Technically Complete | not Backlog or Cancelled |

`post-timesheet` uses `new` for an entry and `commitment` for a reversal.
`post-project-issue` uses `new` for an Issue and `commitment` for a Return. The first
`new` charge moves an Unstarted element to its project's default Started state
(`startElementsOnFirstCharge`; ERP `startElementOnFirstCharge`).

In the ERP, `chargeNumberError` (`projects.server.ts`) checks a document's charge number
in the route action: the project is the company's, the element belongs to it, and a
consume-to-project job's project is not Statistical. `updateProjectStatus` refuses Close
while a purchase order or job of the project is open.

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
  project is refused. The shared `postProjectJournal` (`lib/project-journal.ts`) posts
  it and the coverage reclass.
- **Billable items.** `projectBillableItem` is what a charge will bill. Only Service
  projects write them today (`buildBillableItem`, `reverseBillableItem`).
  `projectElement.fixedPrice` bills a node's whole subtree as one line.
- **Parent roll-up** (field service Phase D). The Costs tab lists a project's child
  Service projects, one row per order, from `get_child_service_project_costs`; their
  actual adds to the project total only (`buildProjectCostFigures`, third argument). A
  Contract charge on a Closed parent is refused. `updateServiceOrderCoverageContract`
  keeps `parentProjectId` in step with the order's coverage contract. Details:
  `field-service.md` → *The contract project*.
- **Hidden outside Service.** The Projects lists, Copy from, Build from part's template
  list, the charge number pickers, the dimension picker and the Ramp sync filter
  `projectType = 'Standard'`. Never list a Service project in Projects.

## Project stock (Phase 2a)

`project.projectStock` (set while Draft only; `$projectId.details.tsx` keeps the stored value
after that) makes the project own the stock received for it. The stripes, the stripe set of a
demand and the key order are in `inventory-system.md` → *Project stock*. What it changes here:

- **Receipts.** A stocked item on a PO line charged to a project with project stock is
  received into the project's stripe: Dr inventory, no Project Issue row, no `projectLedger`
  row. With `project.chargeAtReceipt` the receipt also writes a `projectLedger` row (no
  asset), and the purchase invoice writes a `Material Variance` row for the whole price
  variance (`stockChargedAtReceipt`, `loadInvoiceProjectCharges`). The stripe does not depend
  on the cost treatment.
- **Jobs.** `job.receiveToProjectStock` (needs a charge number; refused with Consume to
  project, Make to Asset or a sales order line; `chargeNumberError` refuses it on a project
  without project stock) receives the output into the project's stripe
  (`complete_job_to_inventory`, `20261010030228`). A job of a project with project stock
  draws that project's stock, then common stock, in `issue`, the backflush and picking.
- **Issue to Project.** `post-project-issue` splits an untracked issue across the project's
  stripes at the bin (`splitAcrossStripes`), one `bookAdjustment` per stripe sharing one
  journal and one `projectLedger` row. A Return goes back to the project's stock.
- **`projectStockTransfer`** (Draft → Approved → Posted, or Cancelled) with lines;
  `projectBorrow` records an open borrow. Pages: Projects → **Transfers**
  (`projects+/transfers.tsx`, `transfers.new.tsx`) and the document
  (`project-stock-transfer+/$id.tsx`, `$id.lines.tsx`, `$id.status.tsx`). The owner pickers
  carry `common` for common stock (`COMMON_STOCK_OWNER`, `toStockOwner`).
- **Approval** is `update: projects`, not the approvals engine (`updateProjectStockTransferStatus`).
  Approve refuses a transfer without lines and runs the government-furnished guard
  (`governmentFurnishedRefusal`): stock of a `governmentFurnished` project moves only to a
  project of the same customer. The posting checks it again.
- **Posting** (`post-project-stock-transfer`, called by `postProjectStockTransfer` with
  `serverFns.system`): one transaction locks the Approved header, checks the from-stripe's
  on-hand per (item, bin, lot), draws it with `calculateCOGS({ projectId })`, writes the
  `Project Transfer` Transfer pair at the line's bin and a relief `costLedger` row, and stamps
  the line's `unitCost`.
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
- **Stock tab** (`$projectId.stock.tsx`, `ProjectStock`, shown when `projectStock` is on): the
  project's on-hand by item, location, bin and lot (`getProjectStockOnHand`), its open
  borrows owed and lent (overdue in red, `isBorrowOverdue`), and **Transfer**, **Borrow** and
  **Payback** buttons that open a prefilled Draft (`?type`, `?to`, `?borrow`).
- **Planning (Phase 2b).** MRP nets the project in its own netting segment
  (`planningSegmentId` = the project id; `project_planning_segment`). Plan-line
  materials of Unstarted / Started elements are `Project Material` demand; an
  Open borrow is firm demand on the borrower and firm supply on the lender. The
  segment draws common stock only from the common segment's true surplus, and
  only through a **Transfer** planning action. Applying it creates a Draft
  transfer (`applyTransferPlanningActions` → `createProjectStockTransfersFromActions`,
  `projects.server.ts`, `planningActionId` on the header). An Order or Make in the
  segment creates a PO line charged to the project or a job with
  `receiveToProjectStock`. The project's manager owns its planning actions.
  Details: `mrp-system.md` → *Project netting segments*.
- **Overdue borrows.** `ProjectHeader` shows a red **Overdue borrows** badge,
  linked to the Stock tab, when an Open borrow the project owes or lent is past
  its due date on the company's calendar (`getProjectBorrows` with `dueBefore`,
  in the `$projectId.tsx` loader). The planning worklists list the same
  borrows above the grid.

## Timesheets

`timesheetEntry` status: Draft → Submitted → (Approved) → Posted, or Rejected. A
Rejected entry is editable and returns to Draft on save. A Posted entry changes only by
`createTimesheetCorrection`: a negative reversal (`reversalOfId`, `correctionReason`)
plus a replacement entry. With `companySettings.timesheetApprovalRequired` off, submit
posts at once.

**My Timesheet** is personal and lives at `x+/timesheet` (`path.to.timesheet`), outside
the Projects layout; `x+/projects+/timesheet.tsx` redirects there. A Service row is
read-only there: service time posts from Draft at Stop Work or Add Time on the order,
so `submitTimesheetEntries` submits Standard entries only and `post-timesheet` posts a
Service project's Draft entry.

`post-timesheet` costs hours × the labor category's rate on the entry date
(`laborCategoryRate.effectiveFrom`), Dr the project account / Cr
`laborAbsorptionAccount`. It writes one journal per accounting period. A reversal uses
its original's `costRate`. The ERP and the MES call it with `serverFns.system`, because
it requires `projects_update` and an operator does not hold it; the routes check
ownership first.

RLS: an employee may insert and update only their own Draft rows. Submit
(`submitTimesheetEntries`), correct (`createTimesheetCorrection`) and post run over
Kysely, so they bypass that check. Approve and reject use the Supabase client and need
`projects_update`.

## Capital projects (Capitalize)

`projectValidator` requires `fixedAssetClassId` (a CIP class) for Capitalize; the
form reads CIP classes with `getCipFixedAssetClasses`, because
`CONSTRUCTION_IN_PROGRESS_ENABLED` stays false.

- `ensureCapitalAssets` (`projects.server.ts`) creates the Under Construction assets:
  one for the project and one per `isFinalAsset` element without one, all ids and
  numbers in one statement. The status route calls it before every change to
  Released; the element update route calls it when `isFinalAsset` turns on past Draft.
- Each poster writes a CIP row right after its `projectLedger` row
  (`writeProjectCipRows`, `server-functions/src/lib/project-cip.ts`), with accounting
  off too where the ledger row is written then.
- A capital job (`loadJobProjectCharge` returns `keepsWip: true`) keeps its WIP lines
  and builds `job.fixedAssetId` through the job-to-CIP sweep; SQL
  `project_cost_treatment` mirrors `resolveProjectTreatment`
  (`20261009105739_complete-job-cip-project.sql`). `chargeNumberError` refuses
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

## Layouts, views and the Reader PDF

Six layouts (`projectLayouts`): List, Board, Table, Tree (React Flow boxes + dagre),
Timeline (own component, `timeline-geometry.ts`), Reader. The Reader PDF
(`file+/project+/$id[.]pdf.tsx`, `ProjectReaderPDF` in `@carbon/documents`) reads the
same filters (`parseElementFilters`) and outline (`buildReaderOutline`).

The Tree layout draws one box per parent. `layoutElementTree` (`graph/tree-layout.ts`,
pure, tested) gives a box to each parent that has matching descendants. Dagre places the
boxes, left to right only, and the cards stack in their box at fixed offsets. The type
filter is a lens on the Tree: the loader drops `type` for the Tree, and a box stays while
a card below it matches. `?root=` shows one subtree under a breadcrumb, and the Elements
route skips its own reload when only `root` changes.

`countTraceLinks` and `highlightTraceLinks` give the "N tests" and "N reqs" counts
and their highlight. `elementTypeColors` (`ElementTypeIcon.tsx`) is the one colour map
of the types, on every layout. `getProjectElementCommentCounts` reads the comment counts
in one paged read. `ChangeRequestPicker` in the Elements header lists
`openChangeRequestStatuses` and sets `?cr=`.

`projectView` (saved views; shared ones readable with `projects_view`) and
`projectUserPreference` (one per user and project) hold layout, filters and display
options. A URL without `layout` redirects to the named view, else the preference.

## Templates, Build from part and part links

- `copyProject` copies states, labels, milestones, elements (renumbered), links and
  plan lines; it clears history (assets, verdicts, reviews, issued quantities, job and
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
  that charged the same item; the Budget section shows it.

## Plan-line actions and other charge numbers

- **Create Job** (`$projectId.elements.$elementId.create-job.tsx`) and **Create PO
  line** (`…create-po-line.tsx`) from a plan-line material stamp
  `projectElementMaterial.jobId` / `purchaseOrderLineId`.
- Reimbursement lines carry `projectId` + `projectElementId` (`ChargeNumberControlled`);
  charge lines show the charge number read-only.
- The milestone burn chart (`buildBurnSeries`) plots Posted timesheet hours against
  the ideal line.

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
- With the plan locked, the Elements page turns off only create and delete; the other
  plan-layer controls stay enabled and the server refuses them.
- The demo datasets seed no baseline, change request, item, comment or view.
- The demo datasets seed project stock and one Posted Transfer per Contract project
  (`seedProjectStock`, tier 09), but no borrow.
- A Posted project stock transfer has no void; a Transfer back is the correction.
- Planning: a Project Material demand writes no `demandForecastSource` lineage row,
  so the item planning chart cannot name the plan line. The order drawer's Open
  Orders / Open Jobs list every segment's orders of the item, and a `?item=` link
  opens the item's first segment row.
