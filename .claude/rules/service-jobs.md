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

Specs: `.ai/specs/2026-10-22-service-jobs-and-returns.md`, and
`.ai/specs/2026-10-31-service-labor-rates-and-time-posting.md` (labor rates,
time posted per entry, ASC 606 revenue). Postings research:
`.ai/research/2026-10-22-service-rma-postings.md`. Module guide:
`apps/erp/app/modules/service/AGENTS.md`.

## The record

Migrations `20261023070940_service-job-enum-values.sql`,
`20261023071039_service-jobs.sql`, `20261023071226_service-jobs-rls.sql`,
`20261101042555_service-labor-invoice-line-type.sql` (the `'Labor'`
invoice line type, written by nothing now; see The invoice),
`20261101043733_service-labor-rates.sql`.

| Table (id prefix) | Holds |
|---|---|
| `serviceJob` (`sj`) | The job. Readable `serviceJobId` from sequence `serviceJob` (`SJ`). Customer, optional `customerAssetId` (sets `itemId` + `trackedEntityId`), `locationId` (our depot, the parts source), `workSite` Depot / Customer Site, `coverage`, `billingMethod` Time and Materials / Fixed Price, `laborBillRate` (per hour, see Labor rates), `priority`, `assignee` (lead technician), `problem`, `findings` / `resolution` (JSON rich text), `repairable` (null until someone decides), the estimate columns, `fixedPrice`, `salesInvoiceId`, `salesReturnOrderLineId`, `signaturePath` / `signedByName` (no screen captures a signature any more; the columns hold older ones) |
| `serviceJobEstimateLine` (`sjel`) | A part or a charge at a unit price, or a **Labor** line: `itemId` NULL, quantity = hours, `unitPrice` = the job's `laborBillRate` |
| `serviceJobTime` (`sjt`) | One time entry: employee, `entryDate`, `hours`, `billable`. `startTime` / `endTime` only on a clock entry. `unitCost` is the cost rate the entry first posted at; the time reconcile sets it once and never changes it |
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
the job's location."); `laborBillRate` is refused once the estimate is Sent or
Accepted (`SERVICE_JOB_BILL_RATE_LOCKED`); `fixedPrice` is refused unless the
job is Fixed Price.

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
| Send | `sendServiceJobEstimate` | Billable only, at least one line, not already Accepted. Files the estimate PDF in the job's files first (a failure changes nothing). Estimate Sent, job Awaiting Approval. With `notification` Email the PDF is emailed to `customerContact` (and `cc`); a failed email keeps the send and returns `warning` |
| Accept / Reject | `recordServiceJobEstimateResponse` | Estimate must be Sent. Accepted → job In Progress (the repair starts; no Start needed); a Fixed Price job's `fixedPrice` = Σ quantity × unit price. Declined → job back to Open and `repairable = false`; the header's primary action is then Complete (`serviceJobPrimaryAction`), which closes the job and bills the evaluation. `estimateRespondedBy` is optional; the header sends none |
| Reopen estimate | `reopenServiceJobEstimate` | Estimate Sent, Accepted or Declined on a job that is not locked → estimate Draft (lines and bill rate editable, Send again), the answer cleared; Awaiting Approval → Open; a Declined estimate's `repairable = false` back to null. Earlier sends' PDFs stay in the job's files |
| Complete | `completeServiceJob` → `postServiceJob` `complete` | From Open, In Progress or On Hold. Refused while a clock runs. Runs the time reconcile and refuses if it fails; writes no journal of its own |
| Reopen | `reopenServiceJob` → `postServiceJob` `reopen` | Completed → In Progress. Writes no journal: the time cost stays posted. Invoiced is refused; so is a job whose RMA unit shipped back, was scrapped or replaced (`SERVICE_JOB_UNIT_LEFT_ERROR`) |
| Create Invoice | `createServiceInvoice` | Completed and Billable → Invoiced |
| MES clock Start | `x+/service-time.tsx` | An Open job goes In Progress |
| MES New Job | `x+/service.new.tsx` | Inserted In Progress |
| RMA receipt / void | `createServiceJobsForReturn` / `voidServiceJobsForReturn` | Inserted Open; the void cancels it |

Estimate lines are locked while the estimate is Sent or Accepted; a Declined
estimate is editable again.

### Guards before the click

The UI shows each rule before an action fails:

| Rule | What the UI does |
|---|---|
| No cost rate in Settings → Service, or a Billable job with no bill rate | The ERP job page (`x+/service-job+/$jobId.tsx`) and the MES job page (`x+/service.$jobId.tsx`) show a warning, "Labor rates are not set", with a link to Settings → Service |
| The bill rate after the estimate is Sent or Accepted | `ServiceJobProperties` shows the field read-only with the reason |
| A Fixed Price job with no `fixedPrice` | The Complete and Create Invoice dialogs (`ServiceJobActionModal.tsx`) ask for the price |
| A running clock at Complete (ERP) | The Complete dialog offers **Stop clock and complete**: `x+/service-job+/$jobId.stop-clock` (`stopServiceJobClock`), then Complete |
| Cancel on a job with time or Part lines | `ServiceJobHeader` disables **Cancel Job**; its tooltip says to remove the time and return the parts first |

The Complete route saves a fixed price from the dialog with `updateServiceJob`
before it completes. Create Invoice sends the price to `createServiceInvoice`,
which saves it inside the invoice transaction.

## The estimate

An estimate is optional: no job needs an Accepted estimate before Complete.
(A `needsAcceptedEstimate` / `canComplete` gate once refused a Billable Fixed
Price or RMA job without one; it was removed on request.)

A line with no item is a **Labor** line: its quantity is hours, and
`upsertServiceJobEstimateLine` sets its `unitPrice` to the job's
`laborBillRate` (refused while the job has none). When the bill rate changes,
`updateServiceJobLaborBillRate` sets `unitPrice` on the job's Labor lines in
the same Kysely transaction. The estimate PDF (`ServiceJobEstimatePDF`) shows
a Labor line as hours × rate. `renderServiceJobEstimatePdf` (`service.pdf.tsx`)
renders it for both the Preview route
(`file+/service-job-estimate+/$id[.]pdf.tsx`) and the email.

`serviceJobPrimaryAction` picks the header's one primary action: Open → Start (Complete when its estimate was Declined);
In Progress → Complete; Awaiting
Approval → Record Response (Billable); Completed → Create Invoice (Billable).
The estimate's buttons are in the header, as a quote's Preview, Finalize, Won
and Lost are (`ServiceJobHeader.tsx`):

- **Preview** opens the estimate PDF; disabled with no estimate lines.
- **Send** (Billable jobs) opens `EstimateSendModal`, the quote Finalize
  modal's sibling: Send Via (None / Email, when the email integration is on),
  the customer contact (default the job's) and CC. Disabled unless the
  estimate can be sent. While an Open job has estimate lines not yet Sent or
  Accepted, Send is the primary button and Start drops to secondary (an
  estimate stays optional, so Start stays enabled).
- **Accept** (primary) and **Reject** replace Record Response while the
  estimate is Sent. Each posts straight to `$jobId.estimate.response`, as a
  quote's Lost does, with no modal.

Hold, Resume, Reopen and Cancel Job are in the ⋯ menu. **Reopen** steps back
one stage, as a quote's does: a Completed job reopens (`reopenServiceJob`),
else a Sent, Accepted or Declined estimate goes back to Draft
(`reopenServiceJobEstimate`) to be edited and sent again.

The email is `ServiceJobEstimateEmail` (`@carbon/documents/email`, the
notification card with no button: the job number, unit, serial and total),
sent by `emailServiceJobEstimate` (`service.service.ts`) from the sending user
to the contact and the user, the PDF attached as content. Every send files
its PDF with `fileServiceJobEstimatePdf` in `${companyId}/service-job/${jobId}`
(`SJ… - Estimate - <time>.pdf`), the folder the job page's Files card lists.
It writes no `document` row: `documentSourceType` has no service job value.

## Coverage and its accounts

| Coverage | Account (`coverageAccountRole` → `serviceCoverageAccount`, `service-job-plan.ts`) |
|---|---|
| Billable, Contract | `accountDefault.costOfServiceAccount` (Accounting → Default Accounts → Cost of Service). An optional default: `resolveDefaultAccount` falls back to `costOfGoodsSoldAccount` |
| Warranty | `accountDefault.warrantyExpenseAccount`. No fallback: empty refuses every Warranty posting with `MISSING_WARRANTY_EXPENSE_ACCOUNT` |

- A new job's coverage, when the form leaves it empty, is `suggestCoverage(asset, today)`:
  Warranty while the asset's labor OR parts warranty end date is on or after the
  company's today, else Billable (`createServiceJob`).
- Coverage changes only through `setServiceJobCoverage` (`postServiceJob`
  `set-coverage`), never `updateServiceJob`. Refused once the job is locked. A job
  that becomes Billable sets every time entry `billable`, since each took its flag
  from the coverage it was logged under.
- Contract posts like Billable but has no invoice action
  (`serviceJobPrimaryAction` offers Create Invoice to Billable only). Contract
  coverage from a service contract is phase 3.

## Labor rates

Service labor has two rates per hour, in the company's base currency. No
Service item stands for labor.

| Rate | Where | Used for |
|---|---|---|
| `companySettings.serviceLaborCostRate` | Settings → Service (`x+/settings+/service.tsx`, `updateServiceSettings`, `update: settings`) | The cost of every time entry. The reconcile stores it in `serviceJobTime.unitCost` when the entry first posts; a later change never re-rates a posted entry |
| `companySettings.serviceLaborBillRate` | Settings → Service | The default bill rate. Every create path copies it into `serviceJob.laborBillRate`: ERP New (`insertServiceJob`), MES New Job, the RMA receipt (`createServiceJobsForReturn`) and the demo datasets |
| `serviceJob.laborBillRate` | The job's properties panel (`updateServiceJob`, field `laborBillRate`) | The Labor estimate lines and the invoice's labor line. Editable while the job is open and its estimate is not Sent or Accepted |

Without a cost rate, every time write is refused with
`SERVICE_LABOR_COST_RATE_MISSING` ("Set the labor cost rate in Settings →
Service."): `refuseWithoutLaborCostRate` in the ERP time operations, and the
same text in the MES clock Start, MES New Job and MES My Time
(`getServiceLaborRates`).

## Postings

The time journal (`reconcileServiceJobTime`) and the coverage reclass journal
(`writeServiceJobJournal`) have `sourceType` `'Service Job'` and line
`documentType` `'Service Job'`. Each line carries the job's location as a
Location dimension when one is active. The issue journal is an `'Inventory
Adjustment'` source (`createAdjustmentJournal`'s default) whose ledger and
lines carry `documentType` `'Service Job Consumption'`. These three are
Provisional before the company's accounting cutover, Posted after it
(`journalPostingStatus`). A revenue accrual posts in the run's
`'Revenue Recognition'` journal, with line `documentType` `'Service Job'`.

| Event | Dr | Cr | Written by |
|---|---|---|---|
| RMA receipt, Return to Stock line | Inventory (original shipment cost) | COGS | `postReceipt`, unchanged |
| RMA receipt, Service or Warranty line | none | none | `postReceipt` → `createServiceJobsForReturn` (`inventory/receipt-service-return.ts`) |
| Part issued to a job | coverage account | Inventory | `issueServiceJobPart` → `issue` `serviceJobInventory` (non-tracked) / `serviceJobTrackedEntities` (serial or batch) |
| Part returned from a job | Inventory | coverage account | `unissueServiceJobPart` → `issue` `serviceJobUnconsume` (returns everything still issued and deletes the line). A serial reverses its own cost rows (`returnableIssueRows`); anything else the job's average for the item |
| Time entry closed, edited or deleted | coverage account | `laborAbsorptionAccount` | `postServiceJob` `post-time` → `reconcileServiceJobTime`: the difference per entry, hours × `unitCost` (see Time cost below) |
| Coverage changed | new coverage account | old coverage account | `postServiceJob` `set-coverage` at the issued parts' net cost (Σ `costLedger` `'Service Job Consumption'` for the job; `buildCoverageReclassLines`). No journal when both coverages share an account. Then the time reconcile moves the posted time |
| Revenue earned, not billed (month end) | `contractAssetAccount` | `serviceRevenueAccount` | `synthesizeServiceJobRevenue` in the Revenue Recognition run (see Revenue below) |
| Billable job invoice | AR | Contract Assets (the job's accrual), then Service Revenue | `createServiceInvoice` drafts it; `postSalesInvoice` posts a line with `serviceJobId` as revenue only (no shipment, item ledger or COGS) |
| Warranty replacement shipment | `warrantyExpenseAccount` | Inventory | `postShipment`: a sales order line whose `salesReturnOrderLineId` is a Return for Warranty line gets `cogsAccountOverride` |
| Ship a serviced unit back | none | none | `postShipment` → `shipServiceUnits` (`inventory/shipment-service-return.ts`) |
| Charge with a linked cost | none (the linked document already posted) | | `upsertServiceJobCharge` |

The issue journal is written by the shared valuation in `inventory.service.ts`
(the `offsetAccount` is `serviceCoverageAccount`); a return reverses at the cost
the job booked (`resolveMaintenanceReturnCost` over the job's `costLedger` rows).

There is no WIP: the customer owns the unit, so time and parts cost go
straight to the coverage account.

### Time cost

Each time entry posts its cost when it closes. The posting copies
maintenance labor (`postMaintenanceEvent`, `resources.service.ts`).
`reconcileServiceJobTime` (`service.service.ts`) does the work:

1. It locks the job and reads every closed entry: `hours` > 0 and no running
   clock.
2. An entry with no `unitCost` takes `serviceLaborCostRate` and stores it.
   With no cost rate it refuses (`SERVICE_LABOR_COST_RATE_MISSING`).
3. `buildServiceTimeCostGroups` (`service-job-plan.ts`) builds the desired
   pair per entry: Dr the coverage account / Cr `laborAbsorptionAccount`, at
   hours × `unitCost`.
4. It reads the prior lines of the job's live journals. Each line's
   `documentLineReference` is `journalReference.to.serviceJobTime(id)`
   (`service-job-time:<id>`).
5. `diffLaborGroups` posts the difference as "Service Job Time SJ…"
   journals. Each entry's lines are dated on its `entryDate`, the day the
   revenue run counts its hours. If that period is Closed or Locked, or the
   day is before the cutover, they are dated the company's today. A deleted
   entry's reversal is also dated today (`serviceTimePostingDates`). Each
   posting date gets its own journal, and each journal balances.

A deleted entry has no desired lines, so its prior lines reverse. A coverage
change needs no extra code: the next reconcile moves the posted cost. A change
to an entry posted before the accounting cutover is refused
(`withoutSupersededEntries`, `TIME_ENTRY_BEFORE_CUTOVER_ERROR`).

Every write to `serviceJobTime` runs the reconcile:

| Write | Where the reconcile runs |
|---|---|
| ERP My Time (`setServiceJobDayHours`) | In the same Kysely transaction |
| ERP job page create, edit, delete (`upsertServiceJobTime`, `deleteServiceJobTime`) | After the write, as the system (`postServiceJobTime`). A failure keeps the write and returns `warning` |
| ERP stop clock (`stopServiceJobClock` → `stopServiceJobClocks`) | After the write. A failure returns `warning` |
| MES clock Stop, MES My Time | After the write, through `erpPosting` `post-service-job` `post-time` (MES `postServiceJobTime`) |
| Coverage change (`set-coverage`) | In the same transaction |
| Complete | In the Complete transaction. Complete refuses if it fails |

A failed post-after-write leaves the entry unposted. The next reconcile of the
job posts it, and Complete always runs one.

## The invoice

`createServiceInvoice` (`service.service.ts`) locks the job, plans the lines with
the pure `planServiceJobInvoiceLines` (`service-job-invoice-plan.ts`), and
inserts an `opportunity`, a Draft `salesInvoice` (customer's currency and
payment terms, `customerReference` = the job number, tax 0),
`salesInvoiceShipment` and the lines, each with `serviceJobId`. Every line
is `invoiceLineType` `'Service'`.

- Time and Materials: one labor line with no item (unit `EA`, description
  "Labor", `SERVICE_JOB_LABOR_LINE`) at Σ billable hours × the job's
  `laborBillRate` at invoicing. Then every billable Part and Charge at its
  `unitPrice`. Billable hours on a job with no bill rate are refused
  (`SERVICE_JOB_BILL_RATE_MISSING`).
- Fixed Price: one line with no item (quantity 1, unit `EA`, description
  "Fixed price service", `SERVICE_JOB_FIXED_PRICE_LINE`) at `fixedPrice`.
  Time, parts and charges are in the price. Refused without a price
  (`SERVICE_JOB_FIXED_PRICE_MISSING`). The input's optional `fixedPrice`
  sets the price of a job that has none, inside the invoice transaction.
  A service job names no item to bill: migration
  `20261102011400_drop-service-job-service-item.sql` dropped
  `serviceJob.serviceItemId`.
- Nothing billable is refused.

A Service line with no item (`isItemlessServiceLine`, `invoicing.models.ts`)
is named by its description in the line form, the explorer, the summary and
the PDF and email (`@carbon/documents` `utils/sales-invoice.ts`). The form
edits only its description, quantity, price and tax. Only an existing line
may have no item: `salesInvoiceLineValidator` accepts it on an edit,
`updateSalesInvoiceLine` refuses it when the stored line has an item, and
`createSalesInvoiceLine` refuses it. `isDirectItemLine` needs an item, so the
line ships nothing and has no cost.

Before 2026-11-01 these lines had the type `'Labor'` (migration
`20261101042555`; a Postgres enum value cannot be dropped). Old rows render
and post as Service lines (`postingLineRevenue`), and saving one in the form
changes it to Service. Nothing writes `'Labor'` now.

Deleting the Draft invoice (`deleteSalesInvoiceReleasingRentals`) or its last
line naming a job (`deleteSalesInvoiceLineReleasingRentals`) sets the job back
to Completed with no `salesInvoiceId` (`releaseServiceJobInvoiceStamps`), in
the delete's transaction. Voiding a posted one (`postSalesInvoice` `void`)
does the same, so the job can be invoiced again. The void also clears
`billedBySalesInvoiceLineId` on the job's Accrual rows, so they are unbilled
again.

## Revenue (ASC 606)

A repair improves a unit the customer controls, so a Billable job earns its
revenue over time (606-10-25-27(b)). Service revenue has its own account,
`accountDefault.serviceRevenueAccount` (Accounting → Default Accounts →
Service Revenue). When it is empty, `DEFAULT_FALLBACKS` resolves it to
`salesAccount`.

### The accrual

`synthesizeServiceJobRevenue` (`accounting.service.ts`) is the last
synthesizer of a Revenue Recognition run (`runRowSynthesizers`). It runs
under the proposal lock. It reads every job created on or before the run's
`periodEnd` that has no invoice, or a Draft or Pending one, and is either
Billable and not Cancelled, or still holds unbilled accruals.

| Billing | Earned to date at `periodEnd` |
|---|---|
| Time and Materials | Σ billable closed hours (`entryDate` ≤ `periodEnd`) × `laborBillRate`, plus Σ billable Part and Charge lines created by then × their price |
| Fixed Price, Completed on or before `periodEnd` | `fixedPrice` |
| Fixed Price, open | `fixedPrice` × min(1, closed billable hours ÷ the Accepted estimate's Labor hours) |
| Fixed Price with no Labor hours on an Accepted estimate, or no `fixedPrice` | 0 |
| Not Billable any more, or Cancelled | 0, so its open accruals reverse |

The row is cumulative: earned to date minus Σ the job's unbilled Accrual rows
(any status). A non-zero difference becomes one Planned Accrual row:
`serviceJobId`, Dr `contractAssetAccount` / Cr Service Revenue,
`scheduledDate` = `periodEnd`. A negative difference is a negative row.
Without `contractAssetAccount` the run refuses with
`SERVICE_REVENUE_CONTRACT_ASSETS_MISSING`. A Warranty or Contract job never
earns revenue.

`postRevenueRecognitionRun` posts the row with `documentType`
`'Service Job'` and the Customer and Location dimensions of the job
(`RecognitionSources.serviceJobs`, `run-journals.ts`). Its line descriptions
are "Unbilled service accrued" / "Service revenue accrued"
(`revenueRowDescriptions`).

### Invoice relief

`postSalesInvoice` (`invoicing.service.ts`) gives a line with `serviceJobId`
the `book: "service"` revenue. It loads the job's unbilled Accrual rows
(Planned or Posted) and spreads them over the job's lines:

1. `planServiceJobRevenue` walks the job's lines in sort order. Each line
   takes min(accrual left, its revenue) as a Contract Assets leg.
   `buildSalesPostingLines` refuses a leg larger than its line, so one line
   cannot take it all.
2. `planServiceJobLine` credits the rest of each line to "Service Revenue".
3. If accrual is left after the job's last line, that line also writes a
   reclass that sums to 0: Cr Contract Assets / Dr Service Revenue. This
   takes back the revenue the run accrued beyond what was billed.
4. Posting stamps every cleared Accrual row with the job's first line
   (`billedBySalesInvoiceLineId`).

So nothing stays on Contract Assets after the job is billed, and Service
Revenue ends at the invoice amount.

### Accounting sync

`classifyAccountingPostingRole` (`@carbon/database` `accounting-posting.ts`)
maps a "Service Revenue" line to the `ServiceRevenue` role. The "Contract
Assets" leg stays unclassified: the run journals do not sync
(`defaultEnabled: false`), so the provider books the whole line as revenue.
`loadSalesInvoices` (`packages/ee/src/accounting/core/sales-invoice-source.ts`)
replays `serviceRevenueAccountId` from the posted journal. If no Service
Revenue line posted (the accrual covered every line), it reads the credit
account of the Accrual rows the invoice cleared. Each component carries its
`serviceJobId`; `isServiceRevenueComponent` routes it to that account.
QuickBooks and Rillet use a second synthetic sales item or product, and Xero
uses the line's account code. See `.claude/rules/accounting-sync-handlers.md`.

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
  item ledger, cost layer or journal; the serial goes from Consumed to
  Available while the unit is at the depot. It has no ledger stock, so
  on-hand and the pickers that read it (`get_available_tracked_entities`)
  skip it; a list that filters on status alone (the MES issue modal's
  `getSerialNumbersForItem`) still shows it. `postReceipt`
  re-reads every line's return type under the RMA lock and refuses if one
  changed. A serial-tracked Service or Warranty line with no serial on the
  receipt is refused ("Assign the serial before posting a service receipt").
- **Receipt void** (`voidServiceJobsForReturn`): for each line THIS receipt
  received (quantity > 0; a line it carried at 0 belongs to another receipt),
  cancels the line's live job and
  sets the asset back In Service; the serial goes back to Consumed. Refused when the job has work (a status past
  Open, a time entry or a Part line): "Cancel the job first."
- **Ship back**: the RMA shipment, the same create path as Return to Customer
  (header **Ship**, line **Ship Back** → `path.to.newShipment` with source
  `Sales Return Order`). The line's job is the live one, else the latest
  Cancelled one (`loadReturnLineJobs`); a Cancelled job's unit goes back
  unrepaired. `shipServiceUnits` refuses unless that job is Completed,
  Invoiced or Cancelled (`SHIP_BACK_JOB_STATUSES`) and the asset is At Depot;
  sets the serial Consumed again and the asset In Service at the RMA's site;
  adds `quantityShipped` (`addReturnLineQuantityShipped`). The Available serial
  is what lets the shipment's tracking take it (`shippableEntityStatuses`).
  Void: `unshipServiceUnits` sets the asset At Depot, the void sets the serial
  Available, and `quantityShipped` drops (never below 0).
- **Links**: the collapsed RMA line in the explorer shows the item and the
  return type only; its jobs are in the expanded line. A Service or
  Warranty line's page has a **Service Jobs** card, the sibling of the sales
  order line's Jobs card (`SalesReturnOrderLineServiceJobs`, read by
  `getServiceJobsForReturnLine`): every job of the line with its status,
  assignee, coverage, hours and repairable. Expanding the line in the
  explorer lists its service jobs (every status, with the status badge), receipts
  and shipments (`SalesReturnOrderLineRelatedItems`; receipts and shipments
  from `getSalesReturnOrderRelatedItems`), as a sales order line lists its jobs
  and shipments. A receipt's Documents panel lists the service jobs of the
  return lines it takes in (`getReceiptRelatedItems`, matched on
  `receiptLine.lineId`).
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
`service-time.tsx`. Sidebar and tab bar entry
**Service**, shortcut `alt+8` (`MES_NAV_SHORTCUTS.service`). Data access in
`apps/mes/app/services/service.service.ts`.

- **New Job**: scan or pick a serial or a customer. Inserted In Progress,
  `assignee` = the technician, at the technician's location, Time and
  Materials, `laborBillRate` = the company's bill rate, and the clock starts.
  Refused while the technician's clock runs on another job, and while the
  company has no cost rate.
- **Clock** (`service-time.tsx`, actions Start / Stop / Complete). Start
  refuses while the company has no cost rate. It inserts a `serviceJobTime`
  row with `startTime`, `hours` 0, `entryDate` today; an Open job goes In
  Progress. Stop sets `endTime`, `hours` = `clockHours` (never negative) and
  `entryDate` = the company's business day of the start. Then it posts the
  job's time (`postServiceJobTime`); a failure flashes "Clock stopped, but its
  labor cost did not post". A second Start is refused ("Your clock is running
  on … Stop it first."); the unique index backs the check
  (`CLOCK_ALREADY_RUNNING`). Complete stops the technician's own clock on this
  job, then posts `post-service-job` `complete`.
- The job page shows the "Labor rates are not set" warning (see Guards before
  the click).
- **Parts**: `erpPosting("issue", …)` (`serviceJob*` types, from
  `add-and-issue`); the job page's `return-part` intent runs
  `serviceJobUnconsume`.
- Plain writes (findings, resolution, repairable, status) use the
  service role after a `companyId` ownership check, as maintenance does. The
  routes call `requirePermissions(request, {})`.

## My Time

Service rows sit below the project rows on My Time in the ERP and the MES. They
never go through timesheet submit, approval, certification or DCAA.

- Read: ERP `getTimesheetWeekView` (`projects.service.ts`), MES
  `getServiceTimeWeek`. Both group with `groupServiceTimeRows`
  (`@carbon/utils`): one row per job, a row with no hours for a job the employee
  is assigned to that week, rows locked when the job is locked. **Add** lists
  every open job in the company. The assignee owns a job; more than one
  person works on it, so time is never limited to the assignee.
- Write: ERP `x+/timesheet.service.tsx` → `setServiceJobDayHours`; MES
  `saveServiceDayHours` (a copy with the same rules and messages, on the
  service-role client). The bar sets the day's TOTAL; `manualHoursForDay` turns
  it into the day's one manual entry (no clock): updated, inserted
  (`billable` = coverage is Billable), or deleted at 0.
  - Both refuse while the company has no cost rate.
  - The ERP reconciles the job's time cost in the same transaction. The MES
    posts it after the save (`postServiceJobTime`); a failure keeps the hours
    and shows a warning toast.
  - A total below the day's clock hours writes nothing and returns `warning`
    `SERVICE_DAY_HAS_CLOCK_TIME` ("Edit it on the job").
  - Two or more manual entries on the day are refused.
  - Permission `{}` (company membership, like `saveTimesheetEntry` and the
    MES clock): any employee may log time on any open job.

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

Each dataset seeds the labor rates (`sales.serviceLaborRates`, set as
`serviceLaborCostRate` / `serviceLaborBillRate`), 5 service jobs (one per main
status) at the bill rate, time, estimate lines with a Labor line, a charge and
4 assignments. It also seeds an In Progress RMA with a received Return for
Service line. Every seeded time entry is closed, stores the cost rate and has
its own Posted time journal (tier 09, `serviceJobTimeJournal`). See
`.claude/rules/onboarding-company-templates.md`.

## Known gaps

- **Keep at zero value** (spec decision 19) did not ship. After a no-charge
  replacement the old unit can only be scrapped: no path adds a customer unit
  to stock at zero cost.
- **Phase 3** is out of scope: contract coverage from a service contract,
  supplier warranty recovery, preventive maintenance on customer assets.
- Seeded jobs carry no issued parts (the tiers do not model the issue posting's
  ledger rows), and the seeded Invoiced job's invoice is Draft. The datasets
  seed no service revenue accruals: the first Revenue Recognition run writes
  them.
- Rates are per company. There is no rate per employee or per job type.
- Existing data was not migrated: a job created before the rates has no
  `laborBillRate` until someone sets it.
- `changeReturnLineToService` is two operations, not one transaction: a
  failure after the coverage change leaves the job Billable on a Warranty line.
