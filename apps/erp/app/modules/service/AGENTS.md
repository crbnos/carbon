# Service Module

Service jobs (work on a customer's unit, at the depot or on site), customer assets (the installed base) and the dispatch grid. The full rules, postings and RMA flow are in `.claude/rules/service-jobs.md`; spec `.ai/specs/2026-10-22-service-jobs-and-returns.md`.

Files (`.claude/rules/module-files.md`): `service.server.ts` holds the `defineServiceFn` operations (`api.service.<name>`, most tagged `@mcp`); `service.service.ts` the building blocks, including the posting bodies `postServiceJob` and `createServiceInvoice` (with `postServiceJobPermission` / `createServiceInvoicePermission`); `service.models.ts` the validators and `SERVICE_JOB_STATUS_TRANSITIONS`; `types.ts` the shared types. Pure planners: `service-job-plan.ts` (coverage account, completion and reclass journal lines) and `service-job-invoice-plan.ts` (`planServiceJobInvoiceLines`). Rules shared with the MES live in `@carbon/utils` (`packages/utils/src/service-job.ts`). There is no barrel.

## Key Domain Concepts
- **Service job** — `serviceJob`, readable `SJ…`. One customer, an optional customer asset, a work site (Depot / Customer Site), a location (our depot). Status: Open → In Progress ⇄ On Hold → Completed → Invoiced; Awaiting Approval while an estimate waits; Cancelled. Completed, Invoiced and Cancelled are locked (`isServiceJobLocked`).
- **Coverage** — who bears the cost: Billable, Warranty or Contract, one per job. Billable and Contract cost goes to `costOfServiceAccount` (falls back to COGS), Warranty to `warrantyExpenseAccount` (no fallback). `suggestCoverage` defaults it from the asset's warranty dates.
- **Labor item** — an item of type Service: `itemCost.unitCost` is the cost per hour, the unit sale price the bill rate. Default `companySettings.serviceLaborItemId`.
- **Estimate** — `serviceJobEstimateLine` rows, sent and answered on the job (no sales quote). Required before Complete for a Billable job that is Fixed Price or came from an RMA line, unless `repairable` is false (`canComplete`).
- **Charge** — a `serviceJobItem` Charge line: a Service item at a price, optionally linked to the reimbursement or supplier invoice line that paid its cost.
- **Customer asset** — one shipped serial at a customer (`customerAsset`): In Service, At Depot (received on an RMA Service or Warranty line), Returned.

## Safety
### Always
- MUST write a time row, Part, Charge, estimate line or assignment through its operation: each calls `editableServiceJob`, which refuses a locked job.
- MUST post through `postServiceJob` (`completeServiceJob` / `reopenServiceJob` / `setServiceJobCoverage`) and issue parts through `issueServiceJobPart` / `unissueServiceJobPart` (`invokePosting` → `issue` `serviceJob*` types in `inventory.service.ts`). These lock the job FOR UPDATE.
- MUST change coverage only with `setServiceJobCoverage`: it posts the parts reclass. `updateServiceJob` (`serviceJobFieldValues`) never writes status, coverage or posting columns.
- MUST call `refreshSalesReturnOrderStatus` (`sales.service.ts`) in the same transaction when a change can resolve an RMA line (job completed/reopened, unit shipped, scrapped, replaced).
- MUST name new path helpers `serviceJob*`, `serviceSchedule*` or `customerAsset*`. `path.to.service`, `services` and `x+/service+/` belong to the Service ITEM page.

### Ask First
- Changing `needsAcceptedEstimate`, `coverageAccountRole` or `suggestCoverage` in `@carbon/utils` — the ERP, the MES and the postings all read them.
- Adding a status or a transition — `serviceJobPrimaryAction`, `getSalesReturnOrderStatus` and `SHIP_BACK_JOB_STATUSES` (`inventory/shipment-service-return.ts`) depend on the set.
- Letting service time enter timesheet submit, approval or DCAA — it is kept out on purpose.

### Never
- Never insert a Part line or a journal directly — the `issue` posting writes the `itemLedger`, `costLedger` and journal together.
- Never set a job Completed or Invoiced with a plain update — the completion journal and `completionJournalId`, or the invoice, would be missing.
- Never run a second clock for an employee — `serviceJobTime_open_clock_key` refuses it; the MES maps the error to `CLOCK_ALREADY_RUNNING`.

## Validation Commands
```bash
pnpm exec turbo run typecheck --filter=erp
cd apps/erp && pnpm exec vitest run app/modules/service test/schedule-matrix.test.ts
pnpm --filter @carbon/utils exec vitest run src/service-job.test.ts
# live database (load the worktree SUPABASE_* env first):
cd apps/erp && pnpm exec vitest run test/database/post-service-job test/database/create-service-invoice \
  test/database/issue/service-job.test.ts test/database/post-receipt/service-return.test.ts \
  test/database/post-shipment/service-return.test.ts
```

## Key Data Model
| Table | Purpose |
|---|---|
| `serviceJob` | The job; one non-Cancelled job per `salesReturnOrderLineId` |
| `serviceJobTime` | Time entries; `startTime`/`endTime` from the MES clock; `unitCost` stored at completion |
| `serviceJobItem` | Part (from `issue`) and Charge lines; `reimbursementLineId` / `purchaseInvoiceLineId` |
| `serviceJobEstimateLine` | The estimate; locked while Sent or Accepted |
| `serviceJobAssignment` | Technician × day × planned hours: the dispatch grid |
| `customerAsset` | Installed base; created by `upsertShippedCustomerAssets` or `registerCustomerAsset` |

## Key Service Functions
- `postServiceJob(ctx, { action })` — `complete` (labor journal, Dr coverage / Cr labor absorption), `reopen` (negated copy), `set-coverage` (parts reclass). Registered for the MES as `post-service-job`.
- `createServiceInvoice(ctx, { serviceJobId })` — Draft sales invoice; every line carries `serviceJobId`, which `postSalesInvoice` posts as revenue only.
- `setServiceJobDayHours(db, args)` — My Time: the day's total → one manual entry (`manualHoursForDay`).
- `moveServiceJobAssignment(db, args)` — move a block; merges with the same job, person and day.
- `chargeCost(ctx, charge)` / `getLinkableCostLines` — a charge's paid cost.
- `getServiceJobs`, `getServiceJob`, `getServiceBacklog`, `getServiceJobAssignmentsRange`, `getServiceJobsByAsset`, `getCustomerAssets`, `getSalesReturnLinesByAsset`.

## Copy From
| To build… | Copy from… | Then change… |
|---|---|---|
| A people × days drag-and-drop grid | `ui/Schedule/ServiceSchedule.tsx` + `~/components/ScheduleMatrix` | the chip and its intents |

## Related Modules
- **inventory** — `postReceipt` / `postShipment` call `createServiceJobsForReturn`, `shipServiceUnits` and their voids (`receipt-service-return.ts`, `shipment-service-return.ts`); `issueMaterial` owns the `serviceJob*` issue types.
- **sales** — RMA return types, next steps and `refreshSalesReturnOrderStatus`.
- **invoicing** — `postSalesInvoice` skips stock relief for `serviceJobId` lines.
- **projects** — My Time (`getTimesheetWeekView`) shows the service rows.
- **production** — the People matrix shares `~/components/ScheduleMatrix`.
- MES: `apps/mes/app/services/service.service.ts` and `x+/service*.tsx`.

## Rules References
- `.claude/rules/service-jobs.md` — statuses, postings, RMA flow, MES, My Time, the grid
- `.claude/rules/module-files.md` — operations vs building blocks
- `.claude/rules/accounting-sync-handlers.md` — journal sources
