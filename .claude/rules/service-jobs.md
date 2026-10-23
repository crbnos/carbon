---
paths:
  - "apps/erp/app/modules/service/**"
  - "apps/erp/app/routes/x+/service-job+/**"
  - "apps/erp/app/routes/x+/service-jobs+/**"
  - "apps/mes/app/routes/x+/service*"
  - "apps/mes/app/services/service.service.ts"
  - "apps/erp/app/modules/inventory/receipt-service-return.ts"
  - "apps/erp/app/modules/inventory/shipment-service-return.ts"
---

# Service Jobs and Customer Returns

A **service job** is work on one customer unit, at our depot or at the customer's
site. It has one coverage (Billable, Warranty or Contract), a time list, a parts
and charges list and, for billable work, an estimate. Its sibling is the
maintenance dispatch (`maintenanceDispatch`), not the project: there is no
project, no work tree and no visit. The customer RMA decides per line whether a
unit is restocked or serviced; a serviced line opens a job when its receipt posts.

Spec: `.ai/specs/2026-10-22-service-jobs-and-returns.md`. Postings research:
`.ai/research/2026-10-22-service-rma-postings.md`. Module guide:
`apps/erp/app/modules/service/AGENTS.md`.

## The record

Migrations `20261023070940_service-job-enum-values.sql`,
`20261023071039_service-jobs.sql`, `20261023071226_service-jobs-rls.sql`.

| Table (id prefix) | Holds |
|---|---|
| `serviceJob` (`sj`) | The job. Readable `serviceJobId` from sequence `serviceJob` (`SJ`). Customer, optional `customerAssetId` (sets `itemId` + `trackedEntityId`), `locationId` (our depot, the parts source), `workSite` Depot / Customer Site, `coverage`, `billingMethod` Time and Materials / Fixed Price, `priority`, `assignee` (lead technician), `problem`, `findings` / `resolution` (JSON rich text), `repairable` (null until someone decides), the estimate columns, `fixedPrice`, `serviceItemId` (what a Fixed Price job bills), `completionJournalId`, `salesInvoiceId`, `salesReturnOrderLineId`, `signaturePath` / `signedByName` |
| `serviceJobEstimateLine` (`sjel`) | A labor item (quantity = hours), a part or a charge, at a unit price |
| `serviceJobTime` (`sjt`) | One time entry: employee, labor item, `entryDate`, `hours`, `billable`. `startTime` / `endTime` only on an MES clock entry. `unitCost` is stored by Complete and cleared by Reopen |
| `serviceJobItem` (`sji`) | `lineType` Part (written only by the `issue` posting) or Charge (a Service item at a price; may link the line that paid it) |
| `serviceJobAssignment` (`sja`) | Technician, `scheduledDate`, `plannedHours`. Unique per job, employee and date |

Two unique indexes carry rules the code relies on:
`serviceJob_salesReturnOrderLineId_key` (one non-Cancelled job per RMA line) and
`serviceJobTime_open_clock_key` (one running clock per employee).

RLS (authz manifest `company("service")`, tightened by
`20261023102753_service-jobs-rls-tighten.sql`): any employee of the company
reads; insert, update and delete need `service_create` / `service_update` /
`service_delete`. Every technician write (the MES, My Time) runs on the
service role or the system connection after its own `companyId` check.

`updateServiceJob` checks a change against the jobs it changes
(`serviceJobFieldRefusal`): a customer location, contact or asset must be the
job's customer's; a job from a return or on an asset keeps its customer; a job
with a Part line keeps its location ("Return the issued parts before changing
the job's location.").

## Statuses

`serviceJobStatus`: Open, Awaiting Approval, In Progress, On Hold, Completed,
Invoiced, Cancelled. Completed, Invoiced and Cancelled are **locked**
(`SERVICE_JOB_LOCKED_STATUSES` / `isServiceJobLocked`, `packages/utils/src/service-job.ts`):
every child-row write goes through `editableServiceJob` (operations) or
`lockServiceJob(trx, { open: true })` (postings), which refuse with
`SERVICE_JOB_LOCKED`.

| Move | Done by | Rule |
|---|---|---|
| Start, Hold, Resume, Cancel | `setServiceJobStatus` (`SERVICE_JOB_STATUS_TRANSITIONS`, `service.models.ts`) | Start Open → In Progress; Hold Open or In Progress → On Hold; Resume On Hold → In Progress; Cancel from any open status, refused while the job has time entries or Part lines |
| Send Estimate | `sendServiceJobEstimate` | Billable only, at least one line, not already Accepted. Estimate Sent, job Awaiting Approval |
| Record Response | `recordServiceJobEstimateResponse` | Estimate must be Sent. Accepted → job Open; a Fixed Price job's `fixedPrice` = Σ quantity × unit price. Declined → job In Progress and `repairable = false` |
| Complete | `completeServiceJob` → `postServiceJob` `complete` | From Open, In Progress or On Hold |
| Reopen | `reopenServiceJob` → `postServiceJob` `reopen` | Completed → In Progress. Invoiced is refused; so is a job whose RMA unit shipped back, was scrapped or replaced (`SERVICE_JOB_UNIT_LEFT_ERROR`), and one whose completion journal is not a live document journal, e.g. Superseded by the cutover (`SERVICE_JOB_BEFORE_CUTOVER_ERROR`) |
| Create Invoice | `createServiceInvoice` | Completed and Billable → Invoiced |
| MES clock Start | `x+/service-time.tsx` | An Open job goes In Progress |
| MES New Job | `x+/service.new.tsx` | Inserted In Progress |
| RMA receipt / void | `createServiceJobsForReturn` / `voidServiceJobsForReturn` | Inserted Open; the void cancels it |

Estimate lines are locked while the estimate is Sent or Accepted; a Declined
estimate is editable again.

## The estimate rule

`needsAcceptedEstimate` / `canComplete` (`@carbon/utils`): a job needs an
Accepted estimate before Complete when it is Billable AND (Fixed Price OR has a
`salesReturnOrderLineId`), unless `repairable === false`. Warranty and Contract
jobs never need one. `postServiceJob` re-checks `canComplete` under the row lock.

`serviceJobPrimaryAction` picks the header's one primary action: Open → Start;
In Progress → Complete, or Send Estimate while `canComplete` is false; Awaiting
Approval → Record Response (Billable); Completed → Create Invoice (Billable).
Everything else (Send/Print Estimate, Hold, Resume, Reopen, Cancel Job) is in
the ⋯ menu (`ServiceJobHeader.tsx`).

## Coverage and its accounts

| Coverage | Account (`coverageAccountRole` → `serviceCoverageAccount`, `service-job-plan.ts`) |
|---|---|
| Billable, Contract | `accountDefault.costOfServiceAccount` (Accounting → Default Accounts → Cost of Service). An optional default: `resolveDefaultAccount` falls back to `costOfGoodsSoldAccount` |
| Warranty | `accountDefault.warrantyExpenseAccount`. No fallback: empty refuses every Warranty posting with `MISSING_WARRANTY_EXPENSE_ACCOUNT` |

- A new job's coverage, when the form leaves it empty, is `suggestCoverage(asset, today)`:
  Warranty while the asset's labor OR parts warranty end date is on or after the
  company's today, else Billable (`createServiceJob`).
- Coverage changes only through `setServiceJobCoverage` (`postServiceJob`
  `set-coverage`), never `updateServiceJob`. Refused once the job is locked.
- Contract posts like Billable but has no invoice action
  (`serviceJobPrimaryAction` offers Create Invoice to Billable only). Contract
  coverage from a service contract is phase 3.

## Labor items

A labor item is an item of type Service. Its `itemCost.unitCost` is the cost per
hour; its `itemUnitSalePrice.unitSalePrice` is the bill rate per hour. Each time
entry names one (`refuseUnlessServiceItem`). The company default is
`companySettings.serviceLaborItemId` (Settings → Invoicing → Service Labor
Item). The MES clock and a new My Time entry use the default; without it they
refuse.

## Postings

The completion, reopen and reclass journals have `sourceType` `'Service Job'`
and line `documentType` `'Service Job'` (`writeServiceJobJournal`, with the
job's location as a Location dimension when one is active). The issue journal
is an `'Inventory Adjustment'` source (`createAdjustmentJournal`'s default) whose
ledger and lines carry `documentType` `'Service Job Consumption'`. Every one is
Provisional before the company's accounting cutover, Posted after it
(`journalPostingStatus`).

| Event | Dr | Cr | Written by |
|---|---|---|---|
| RMA receipt, Return to Stock line | Inventory (original shipment cost) | COGS | `postReceipt`, unchanged |
| RMA receipt, Service or Warranty line | none | none | `postReceipt` → `createServiceJobsForReturn` (`inventory/receipt-service-return.ts`) |
| Part issued to a job | coverage account | Inventory | `issueServiceJobPart` → `issue` `serviceJobInventory` (non-tracked) / `serviceJobTrackedEntities` (serial or batch) |
| Part returned from a job | Inventory | coverage account | `unissueServiceJobPart` → `issue` `serviceJobUnconsume` (returns everything still issued and deletes the line) |
| Job Completed | coverage account | `laborAbsorptionAccount` | `postServiceJob` `complete`: one journal, a pair per labor item at Σ hours × `itemCost.unitCost` (`buildServiceJobCompletionLines`); stores `unitCost` on each time row |
| Job reopened | negated copy of the completion journal | | `postServiceJob` `reopen` (`insertNegatedJournal`) |
| Coverage changed | new coverage account | old coverage account | `postServiceJob` `set-coverage` at the issued parts' net cost (Σ `costLedger` `'Service Job Consumption'` for the job; `buildCoverageReclassLines`). No journal when both coverages share an account |
| Billable job invoice | AR | Sales | `createServiceInvoice` drafts it; `postSalesInvoice` posts a line with `serviceJobId` as revenue only (no shipment, item ledger or COGS) |
| Warranty replacement shipment | `warrantyExpenseAccount` | Inventory | `postShipment`: a sales order line whose `salesReturnOrderLineId` is a Return for Warranty line gets `cogsAccountOverride` |
| Ship a serviced unit back | none | none | `postShipment` → `shipServiceUnits` (`inventory/shipment-service-return.ts`) |
| Charge with a linked cost | none (the linked document already posted) | | `upsertServiceJobCharge` |

The issue journal is written by the shared valuation in `inventory.service.ts`
(the `offsetAccount` is `serviceCoverageAccount`); a return reverses at the cost
the job booked (`resolveMaintenanceReturnCost` over the job's `costLedger` rows).

Complete refuses: a status that is not Open / In Progress / On Hold,
`!canComplete`, a labor item with no cost ("… has no cost per hour. Set its
unit cost first."), and a running clock ("Stop the running clock first."). Time
posts ONLY at completion; until then entries are freely editable. There is no
WIP: the customer owns the unit.

## The invoice

`createServiceInvoice` (`service.service.ts`) locks the job, plans the lines with
the pure `planServiceJobInvoiceLines` (`service-job-invoice-plan.ts`), and
inserts an `opportunity`, a Draft `salesInvoice` (customer's currency and
payment terms, `customerReference` = the job number, tax 0),
`salesInvoiceShipment` and the lines, each with `serviceJobId`.

- Time and Materials: one line per labor item at Σ billable hours × its sale
  price, then every billable Part and Charge at its `unitPrice`. A labor item
  with billable hours and no sale price is refused.
- Fixed Price: one line, `serviceItemId` at `fixedPrice`; refused without either.
- Nothing billable is refused.

Deleting the Draft invoice (`deleteSalesInvoiceReleasingRentals`) or its last
line naming a job (`deleteSalesInvoiceLineReleasingRentals`) sets the job back
to Completed with no `salesInvoiceId` (`releaseServiceJobInvoiceStamps`), in
the delete's transaction. Voiding a posted one (`postSalesInvoice` `void`)
does the same, so the job can be invoiced again.

## The RMA

`salesReturnOrderLine` gained `returnType` (enum `returnType`: Return to Stock,
Return for Service, Return for Warranty), `customerAssetId`, `problem` and
`quantityShipped`. CHECK `salesReturnOrderLine_service_quantity_check`: a
Service or Warranty line has quantity 1 (one unit, one job).
`salesOrderLine.salesReturnOrderLineId` marks a replacement.

- **Add from assets** (`$id.from-assets.tsx` → `createReturnOrderLinesFromAssets`
  → `insertSalesReturnOrderLinesFromAssets`): Draft RMA only, one line per asset,
  unit price 0, Return for Warranty while a warranty runs on the company's
  today, else Return for Service. The line form makes the same suggestion when
  an asset is picked (`suggestCoverage`).
- **Receipt** (`createServiceJobsForReturn`): skips a line that already has a
  live job; finds or creates the customer asset of each serial and sets it At
  Depot; inserts one Open Depot job per line at the receiving location (Billable
  for Service, Warranty for Warranty); writes a `Return Receipt` activity. No
  item ledger, cost layer or journal; the serial stays Consumed. `postReceipt`
  re-reads every line's return type under the RMA lock and refuses if one
  changed. A serial-tracked Service or Warranty line with no serial on the
  receipt is refused ("Assign the serial before posting a service receipt").
- **Receipt void** (`voidServiceJobsForReturn`): for each line THIS receipt
  received (quantity > 0; a line it carried at 0 belongs to another receipt),
  cancels the line's live job and
  sets the asset back In Service. Refused when the job has work (a status past
  Open, a time entry or a Part line): "Cancel the job first."
- **Ship back**: the RMA shipment, the same create path as Return to Customer
  (header **Ship**, line **Ship Back** → `path.to.newShipment` with source
  `Sales Return Order`). The line's job is the live one, else the latest
  Cancelled one (`loadReturnLineJobs`); a Cancelled job's unit goes back
  unrepaired. `shipServiceUnits` refuses unless that job is Completed,
  Invoiced or Cancelled (`SHIP_BACK_JOB_STATUSES`) and the asset is At Depot;
  sets the asset In Service at the RMA's site; adds `quantityShipped`
  (`addReturnLineQuantityShipped`). Void: `unshipServiceUnits` sets the asset
  At Depot and lowers `quantityShipped` (never below 0).
- **Credit and replacement**: Issue Credit (`getCreditableQuantities`,
  `createSalesReturnOrderCredit`) and the header's whole-RMA Create
  Replacement (`createReplacementSalesOrder` without `lineIds`) take Return to
  Stock lines only. A Service or Warranty unit stays the customer's; it is
  replaced only through `replaceReturnedUnit`.
- **Next steps** (line ⋯ menu, `$id.$lineId.next-step.tsx`):

| Action | Operation | When offered | Effect |
|---|---|---|---|
| Disposition | `setSalesReturnOrderLineDisposition` / the issue route (Scrap, Rework) | Return to Stock line, received | Use As Is, Return to Customer, Scrap, Rework (no Repair) |
| Ship Back | the RMA shipment | Service/Warranty line, received, job Completed, Invoiced or Cancelled, unit not shipped or scrapped | as above |
| Scrap Unit | `scrapReturnedUnit` → `scrapServiceReturnLine` | same as Ship Back | disposition Scrap, serial Scrapped, asset Returned; nothing posts |
| No-charge Replacement | `replaceReturnedUnit` | Warranty line, job Completed with `repairable = false` | adds a line at price 0 naming the RMA line to the RMA's Draft replacement order, else a new Draft sales order |
| Change to Return for Service | `changeReturnLineToService` | Warranty line whose job is open | `set-coverage` Billable on the job, then `setReturnLineToService` on the line: two steps, not one transaction. Needs `update` on sales AND service |

### RMA status

`salesReturnOrderStatus` gained In Progress. The status is derived, never set by
a posting: `getSalesReturnOrderStatus` (`packages/utils/src/status.ts`, pure)
read by `refreshSalesReturnOrderStatus` (`sales.service.ts`, locks the RMA, call
it inside the transaction that changed an input). To Receive until every line is
received or short-closed; In Progress until every line is resolved; then
Completed. Draft and Cancelled are never changed by it.

A line is resolved when it is received (or short-closed with nothing received)
and:
- Return to Stock: `disposition` is not Pending.
- Service / Warranty: its job (the live one, else the latest Cancelled) is
  Completed, Invoiced or Cancelled, AND the unit shipped back (`quantityShipped ≥ 1`),
  was scrapped (disposition Scrap), or was replaced (a replacement sales order
  line exists and disposition is Use As Is).

Callers: `postReceipt` (post and void), `postShipment` (post and void),
`postServiceJob` (complete and reopen, `refreshJobReturnOrder`),
`setSalesReturnOrderLineDisposition`, `shortCloseSalesReturnOrderLine`,
`scrapServiceReturnLine`, `setReturnLineToService`, `replaceReturnedUnit`.

### Customer asset status

`customerAssetStatus`: In Service (at the customer), At Depot (received on a
Service or Warranty line), Returned (scrapped, or its sales shipment voided).
Receipt → At Depot; receipt void → In Service; ship-back → In Service; ship-back
void → At Depot; Scrap Unit → Returned. Shipment creation is
`upsertShippedCustomerAssets` (`inventory/shipment-customer-assets.ts`).

## MES

Routes `apps/mes/app/routes/x+/`: `service.tsx` (layout), `service._index.tsx`
(the queue: **Today**, jobs assigned to me today; **Open at this location**),
`service.new.tsx`, `service.$jobId.tsx`, `service.$jobId.add-and-issue.tsx`,
`service.$jobId.signature.tsx`, `service-time.tsx`. Sidebar and tab bar entry
**Service**, shortcut `alt+8` (`MES_NAV_SHORTCUTS.service`). Data access in
`apps/mes/app/services/service.service.ts`.

- **New Job**: scan or pick a serial or a customer. Inserted In Progress,
  `assignee` = the technician, at the technician's location, Time and Materials,
  and the clock starts at the default labor item. Refused while the
  technician's clock runs on another job.
- **Clock** (`service-time.tsx`, actions Start / Stop / Complete). Start inserts
  a `serviceJobTime` row with `startTime`, `hours` 0, `entryDate` today; an Open
  job goes In Progress. Stop sets `endTime`, `hours` = `clockHours` (never
  negative) and `entryDate` = the company's business day of the start. A second
  Start is refused ("Your clock is running on … Stop it first."); the unique
  index backs the check (`CLOCK_ALREADY_RUNNING`). Complete stops the
  technician's own clock on this job, then posts `post-service-job` `complete`
  with the stored signature.
- **Parts**: `erpPosting("issue", …)` (`serviceJob*` types, from
  `add-and-issue`); the job page's `return-part` intent runs
  `serviceJobUnconsume`.
- Plain writes (findings, resolution, repairable, signature, status) use the
  service role after a `companyId` ownership check, as maintenance does. The
  routes call `requirePermissions(request, {})`.

## My Time

Service rows sit below the project rows on My Time in the ERP and the MES. They
never go through timesheet submit, approval, certification or DCAA.

- Read: ERP `getTimesheetWeekView` (`projects.service.ts`), MES
  `getServiceTimeWeek`. Both group with `groupServiceTimeRows`
  (`@carbon/utils`): one row per job, a row with no hours for a job the employee
  is assigned to that week, rows locked when the job is locked. **Add** lists
  the open jobs the employee is assigned to that week or leads.
- Write: ERP `x+/timesheet.service.tsx` → `setServiceJobDayHours`; MES
  `saveServiceDayHours` (a copy with the same rules and messages, on the
  service-role client). The bar sets the day's TOTAL; `manualHoursForDay` turns
  it into the day's one manual entry (no clock): updated, inserted at the
  default labor item (`billable` = coverage is Billable), or deleted at 0.
  - A total below the day's clock hours writes nothing and returns `warning`
    `SERVICE_DAY_HAS_CLOCK_TIME` ("Edit it on the job").
  - Two or more manual entries on the day are refused.
  - Permission `{}` (company membership, like `saveTimesheetEntry`). Without
    `update: service` the caller must lead the job or hold an assignment on it
    (`mustBeAssigned`).

## Dispatch grid

Service → Schedule: `x+/service-jobs+/schedule.tsx` (loader),
`schedule.update.tsx` (intents `assign` → `upsertServiceJobAssignment`, `move` →
`moveServiceJobAssignment`, `unassign` → `deleteServiceJobAssignment`), UI in
`modules/service/ui/Schedule/` (`ServiceSchedule`, `ServiceBacklog`,
`AssignmentBlock`, `ServiceScheduleHeader`). It copies the People matrix
(`x+/priority+/people.tsx?view=matrix`).

- Rows: the location's employees, plus anyone scheduled on one of its jobs that
  week. The department filter (cookie `serviceScheduleDepartment`) only
  reorders: its people float to the top.
- Cells: a day's assignment blocks and a total against the person's shift hours
  (own shift, else the location's most common shift length, else 8). A
  `peopleAbsence` day is greyed and refuses drops.
- Backlog (`getServiceBacklog`): the location's open jobs with no assignment.
  Drop on a cell = `assign`; block to another cell = `move` (merges with the
  same job, person and day: planned hours add); block to the backlog =
  `unassign`.

### Shared `ScheduleMatrix`

`apps/erp/app/components/ScheduleMatrix/` (`@dnd-kit/core`) is the drag and
drop for any people × days matrix: `ScheduleMatrixDnd`, `MatrixCell`,
`MatrixChip`, `MatrixOutsideZone` and the pure `resolveMatrixDrop` (no move on
a disabled cell or the same place; `apps/erp/test/schedule-matrix.test.ts`).
Two users: the dispatch grid, and the production People matrix
(`PeopleMatrix.tsx`, intent `move-cell` → `movePersonCell` →
`movePeopleAssignmentCell`; see `apps/erp/app/modules/production/AGENTS.md`).
A new matrix MUST use it rather than its own `DndContext`.

## Charge cost links

A Charge can name the line that paid its cost: `reimbursementLineId` (a line of
a Posted reimbursement) or `purchaseInvoiceLineId` (a line with an account on a
supplier invoice that is not Draft, Pending or Voided), never both. `chargeCost`
sets `unitCost` = the line's base amount ÷ the charge quantity, refuses a line
that already pays another charge, and the job posts nothing for it.
`getLinkableCostLines` lists the newest 100 of each source; the charge form
(**Paid By**) warns when the line's account is not the job's coverage account
(`getServiceJobCoverageAccount`). The one-line-one-charge rule is a check before
the write, backed by the partial unique indexes
`serviceJobItem_reimbursementLineId_key` / `serviceJobItem_purchaseInvoiceLineId_key`
(`20261023103748`); `upsertServiceJobCharge` maps their violation
(`isChargeCostLinkTaken`) to `CHARGE_COST_LINE_TAKEN`.

## Demo datasets

Each dataset seeds 5 service jobs (one per main status), time, estimate lines,
a charge, 4 assignments and a labor item set as `serviceLaborItemId`, plus an In
Progress RMA with a received Return for Service line. See
`.claude/rules/onboarding-company-templates.md`.

## Known gaps

- **Keep at zero value** (spec decision 19) did not ship. After a no-charge
  replacement the old unit can only be scrapped: no path adds a customer unit
  to stock at zero cost.
- **Phase 3** is out of scope: contract coverage from a service contract,
  supplier warranty recovery, preventive maintenance on customer assets.
- Seeded jobs carry no issued parts (the tiers do not model the issue posting's
  ledger rows), and the seeded Invoiced job's invoice is Draft.
- `changeReturnLineToService` is two operations, not one transaction: a
  failure after the coverage change leaves the job Billable on a Warranty line.
