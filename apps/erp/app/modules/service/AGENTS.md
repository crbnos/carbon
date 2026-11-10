# Service Module

Service jobs (work on a customer's unit, at the depot or on site), customer assets (the installed base) and the dispatch grid. The full rules, postings and RMA flow are in `.claude/rules/service-jobs.md`; specs `.ai/specs/2026-10-22-service-jobs-and-returns.md` and `.ai/specs/2026-10-31-service-labor-rates-and-time-posting.md` (labor rates, time posted per entry, ASC 606 revenue).

Files (`.claude/rules/module-files.md`): `service.server.ts` holds the `defineServiceFn` operations (`api.service.<name>`, most tagged `@mcp`); `service.service.ts` the building blocks, including the posting bodies `postServiceJob` and `createServiceInvoice` (with `postServiceJobPermission` / `createServiceInvoicePermission`); `service.models.ts` the validators and `SERVICE_JOB_STATUS_TRANSITIONS`; `types.ts` the shared types. Pure planners: `service-job-plan.ts` (coverage account, `buildServiceTimeCostGroups` for the time cost, the reclass journal lines) and `service-job-invoice-plan.ts` (`planServiceJobInvoiceLines`). Rules shared with the MES live in `@carbon/utils` (`packages/utils/src/service-job.ts`). There is no barrel.

## Key Domain Concepts
- **Service job** — `serviceJob`, readable `SJ…`. One customer, an optional customer asset, a work site (Depot / Customer Site), a location (our depot). Status: Open → In Progress ⇄ On Hold → Completed → Invoiced; Awaiting Approval while an estimate waits; Cancelled. Completed, Invoiced and Cancelled are locked (`isServiceJobLocked`).
- **Coverage** — who bears the cost: Billable, Warranty or Contract, one per job. Billable and Contract cost goes to `costOfServiceAccount` (falls back to COGS), Warranty to `warrantyExpenseAccount` (no fallback). `suggestCoverage` defaults it from the asset's warranty dates.
- **Labor rates** — two rates per hour in the base currency, set in Settings → Service (`x+/settings+/service.tsx`): `companySettings.serviceLaborCostRate` costs every time entry (stored in `serviceJobTime.unitCost` when the entry first posts) and `serviceLaborBillRate` is copied into `serviceJob.laborBillRate` by every create path. The job's bill rate is editable until the estimate is Sent or Accepted. No Service item stands for labor.
- **Estimate** — `serviceJobEstimateLine` rows, sent and answered on the job (no sales quote): **Send** emails the estimate PDF (`renderServiceJobEstimatePdf`, `service.pdf.tsx`; `emailServiceJobEstimate`), then **Accept** / **Reject**. Optional: a job completes without an accepted estimate. A line with no item is a Labor line: quantity = hours, `unitPrice` = the job's bill rate.
- **Service revenue** — a Billable job earns revenue over time (ASC 606). The Revenue Recognition run accrues earned-but-unbilled revenue (`synthesizeServiceJobRevenue`, `accounting.service.ts`: Dr Contract Assets / Cr `serviceRevenueAccount`, else Sales); the job's invoice clears it (`planServiceJobRevenue`, `invoicing.service.ts`).
- **Charge** — a `serviceJobItem` Charge line: a Service item at a price, optionally linked to the reimbursement or supplier invoice line that paid its cost.
- **Customer asset** — one shipped serial at a customer (`customerAsset`): In Service, At Depot (received on an RMA Service or Warranty line), Returned.

## Safety
### Always
- MUST write a time row, Part, Charge, estimate line or assignment through its operation: each calls `editableServiceJob`, which refuses a locked job.
- MUST run the time reconcile after every write to `serviceJobTime`: `reconcileServiceJobTime` in the same transaction, or `postServiceJobTime` (`post-service-job` `post-time`) after it. An unposted entry is caught up only by the next reconcile.
- MUST refuse a time write while the company has no cost rate (`refuseWithoutLaborCostRate`, `SERVICE_LABOR_COST_RATE_MISSING`).
- MUST post through `postServiceJob` (`completeServiceJob` / `reopenServiceJob` / `setServiceJobCoverage`) and issue parts through `issueServiceJobPart` / `unissueServiceJobPart` (`invokePosting` → `issue` `serviceJob*` types in `inventory.service.ts`). These lock the job FOR UPDATE.
- MUST change coverage only with `setServiceJobCoverage`: it posts the parts reclass. `updateServiceJob` (`serviceJobFieldValues`) never writes status, coverage or posting columns.
- MUST call `refreshSalesReturnOrderStatus` (`sales.service.ts`) in the same transaction when a change can resolve an RMA line (job completed/reopened, unit shipped, scrapped, replaced).
- MUST name new path helpers `serviceJob*`, `serviceSchedule*` or `customerAsset*`. `path.to.service`, `services` and `x+/service+/` belong to the Service ITEM page.

### Ask First
- Changing `coverageAccountRole` or `suggestCoverage` in `@carbon/utils` — the ERP, the MES and the postings all read them.
- Adding a status or a transition — `serviceJobPrimaryAction`, `getSalesReturnOrderStatus` and `SHIP_BACK_JOB_STATUSES` (`inventory/shipment-service-return.ts`) depend on the set.
- Letting service time enter timesheet submit, approval or DCAA — it is kept out on purpose.

### Never
- Never insert a Part line or a journal directly — the `issue` posting writes the `itemLedger`, `costLedger` and journal together.
- Never set a job Completed or Invoiced with a plain update — Complete runs the time reconcile and refreshes the RMA status; Create Invoice writes the invoice.
- Never change a posted entry's `unitCost` — a posted cost does not move when the company rate changes.
- Never write `laborBillRate` with a plain update — `updateServiceJobLaborBillRate` also reprices the Labor estimate lines in the same transaction.
- Never run a second clock for an employee — `serviceJobTime_open_clock_key` refuses it; the MES maps the error to `CLOCK_ALREADY_RUNNING`.

## Validation Commands
```bash
pnpm exec turbo run typecheck --filter=erp
cd apps/erp && pnpm exec vitest run app/modules/service test/schedule-matrix.test.ts
pnpm --filter @carbon/utils exec vitest run src/service-job.test.ts
# live database (load the worktree SUPABASE_* env first):
cd apps/erp && pnpm exec vitest run test/database/post-service-job test/database/create-service-invoice \
  test/database/issue/service-job.test.ts test/database/post-receipt/service-return.test.ts \
  test/database/post-shipment/service-return.test.ts \
  test/database/post-sales-invoice/service-job-posting.test.ts \
  test/database/propose-revenue-recognition-run/service-job-revenue.test.ts
```

## Key Data Model
| Table | Purpose |
|---|---|
| `serviceJob` | The job; one non-Cancelled job per `salesReturnOrderLineId` |
| `serviceJob.laborBillRate` | The job's bill rate per hour; copied from `companySettings.serviceLaborBillRate` |
| `serviceJobTime` | Time entries; `startTime`/`endTime` from a clock; `unitCost` = the cost rate the entry first posted at |
| `serviceJobItem` | Part (from `issue`) and Charge lines; `reimbursementLineId` / `purchaseInvoiceLineId` |
| `serviceJobEstimateLine` | The estimate; locked while Sent or Accepted |
| `serviceJobAssignment` | Technician × day × planned hours: the dispatch grid |
| `customerAsset` | Installed base; created by `upsertShippedCustomerAssets` or `registerCustomerAsset` |

## Key Service Functions
- `postServiceJob(ctx, { action })` — `post-time` (the time reconcile alone), `complete` (refuses a running clock, runs the reconcile, writes no journal of its own), `reopen` (no journal), `set-coverage` (parts reclass, then the reconcile moves posted time). Registered for the MES as `post-service-job`.
- `reconcileServiceJobTime(trx, args)` — per entry, Dr coverage / Cr labor absorption at hours × `unitCost`, keyed `journalReference.to.serviceJobTime(id)`; posts the difference (`diffLaborGroups`) as one `'Service Job'` journal per posting date: the entry's date, or today when that period is Closed or Locked, the date is before the cutover, or the entry was deleted. Copies `postMaintenanceEvent`.
- `postServiceJobTime(ctx, serviceJobId)` — runs `post-time` as the system after a write; returns the failure's message or null.
- `stopServiceJobClocks(db, args)` — stops every running clock on a job (operation `stopServiceJobClock`, then `postServiceJobTime`).
- `createServiceInvoice(ctx, { serviceJobId, fixedPrice? })` — Draft sales invoice: every line is `'Service'`. A Time and Materials job bills one labor line with no item ("Labor", billable hours × `laborBillRate`) then its parts and charges; a Fixed Price job bills one line with no item, "Fixed price service", 1 × `fixedPrice`. Lines typed `'Labor'` before 2026-11-01 render and post as Service lines. `fixedPrice` sets a missing price inside the transaction. Every line carries `serviceJobId`, which `postSalesInvoice` posts as revenue only (`book: "service"`).
- `updateServiceJobLaborBillRate(db, args)` — the job's bill rate and its Labor estimate lines, in one transaction.
- `setServiceJobDayHours(db, args)` — My Time: the day's total → one manual entry (`manualHoursForDay`), then the reconcile, in one transaction.
- `moveServiceJobAssignment(db, args)` — move a block; merges with the same job, person and day.
- `chargeCost(ctx, charge)` / `getLinkableCostLines` — a charge's paid cost.
- `getServiceJobs`, `getServiceJob`, `getServiceBacklog`, `getServiceJobAssignmentsRange`, `getServiceJobsByAsset`, `getCustomerAssets`, `getSalesReturnLinesByAsset`.
- `upsertCustomerAsset(client, asset)` — a partial update: a field left out keeps its value and null clears it (`customerAssetPatchValidator`), because the API sends only what changes. The asset page's form sends every field, so its route turns an empty one into null. `updateCustomerAssetNotes` is not published: it takes the editor's raw JSON, and `updateCustomerAsset` takes notes as Markdown.

## Copy From
| To build… | Copy from… | Then change… |
|---|---|---|
| A people × days drag-and-drop grid | `ui/Schedule/ServiceSchedule.tsx` + `~/components/ScheduleMatrix` | the chip and its intents |

## Related Modules
- **inventory** — `postReceipt` / `postShipment` call `createServiceJobsForReturn`, `shipServiceUnits` and their voids (`receipt-service-return.ts`, `shipment-service-return.ts`); `issueMaterial` owns the `serviceJob*` issue types.
- **sales** — RMA return types, next steps and `refreshSalesReturnOrderStatus`.
- **invoicing** — `postSalesInvoice` skips stock relief for `serviceJobId` lines and credits their revenue to Contract Assets (the job's accrual) and Service Revenue (`planServiceJobRevenue`, `planServiceJobLine`); a void clears the accruals' `billedBySalesInvoiceLineId`.
- **accounting** — `synthesizeServiceJobRevenue` in the Revenue Recognition run; `accountDefault.serviceRevenueAccount`.
- **settings** — Settings → Service (`updateServiceSettings`) holds the two labor rates.
- **projects** — My Time (`getTimesheetWeekView`) shows the service rows.
- **production** — the People matrix shares `~/components/ScheduleMatrix`.
- MES: `apps/mes/app/services/service.service.ts` and `x+/service*.tsx`.

## Rules References
- `.claude/rules/service-jobs.md` — statuses, postings, RMA flow, MES, My Time, the grid
- `.claude/rules/module-files.md` — operations vs building blocks
- `.claude/rules/accounting-sync-handlers.md` — journal sources
