---
paths:
  - "apps/erp/app/modules/projects/**"
  - "packages/server-functions/src/post-timesheet/**"
  - "packages/server-functions/src/post-project-issue/**"
  - "packages/server-functions/src/lib/project-posting.ts"
---

# Projects

Phase 1a of `.ai/specs/2026-10-03-projects.md`; plan
`.ai/plans/2026-10-07-projects-phase-1a.md` (its *Execution notes* record every
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
5. Capitalize throws. It is Phase 1b; `projectValidator` refuses it in the ERP.

Load contexts with `loadProjectPostingContexts` (3 queries for any number of refs, keyed
by `projectPostingKey`) or `resolveProjectLineAccounts` (a document's lines). Never load
one context per line.

### The SQL mirror

`project_posting_account(company, project, element, date)` (migration
`20261009055331_projects-functions.sql`, redefined by
`20261009100941_project-posting-account-missing-default.sql`) mirrors the TS resolver for
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
  (`getProjectLedger`, `getElementTimeAndMaterials`, `get_project_cost_summary`).
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

`project.identifier` matches `^[A-Z][A-Z0-9]{1,5}$` and is unique per company. An
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

## Timesheets

`timesheetEntry` status: Draft → Submitted → (Approved) → Posted, or Rejected. A
Rejected entry is editable and returns to Draft on save. A Posted entry changes only by
`createTimesheetCorrection`: a negative reversal (`reversalOfId`, `correctionReason`)
plus a replacement entry. With `companySettings.timesheetApprovalRequired` off, submit
posts at once.

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

## Known gaps

- A receipt still creates a Receipt-usage inspection lot for a line the project
  consumes at receipt.
- `receiptLine` has no charge columns. A receipt reads the charge number from its PO
  line.
- The `jobs`, `purchaseOrderLines` and `purchaseInvoiceLines` views predate the charge
  columns, so screens load them with `getJobProjectCharge` / `getLineChargeNumber`.
- `POSTING_POLICY` syncs `Timesheet` and `Project Issue` journals to external ledgers by
  default.
