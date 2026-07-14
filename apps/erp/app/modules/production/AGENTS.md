# Production Module

Work orders (jobs), scheduling, routings (operations), bill of materials, procedures, production events/quantities, maintenance dispatches/schedules, demand forecasting, and MRP integration.

## Key Domain Concepts

- **Job** — production work order. Statuses: Draft → Planned → Ready → In Progress → Paused → Completed → Closed → Cancelled. `isJobLocked(status)` returns true for Completed/Closed/Cancelled. MUST check before allowing edits.
- **Job Make Method** — a job's manufacturing method (BOM + routing). Root method has `parentMaterialId = null`; sub-assemblies nest via `parentMaterialId`. Created by the `get-method` edge function.
- **Job Operation** — routing step within a make method. Types: Inside (in-house) or Outside (subcontracted). Statuses: Todo → Ready → In Progress → Done. Ordered by `order` column.
- **Job Material** — BOM line within a make method. Each has a `methodType` (Pull from Inventory, Purchase to Order, Make to Order) that drives procurement.
- **Production Event** — time tracking (Labor/Machine/Setup) against an operation.
- **Production Quantity** — output recording (Production/Scrap/Rework) against an operation with optional `scrapReason`.
- **Procedure** — versioned work instructions linked to operations via `processId`. Statuses: Draft/Active/Archived.
- **Maintenance Dispatch** — reactive/scheduled repair for work centers with comments, events, items, and linked work centers.
- **Scheduling** — finite scheduling via the `schedule` edge function: backward date calculation feeds a forward slot allocator. Every work center is finite — one operation at a time, always open (24×7). When an operation's process `requiresAbility`, work only accumulates while a qualified employee is on shift (`employeeShift` ⋈ `shift`; no shift assignment = always available) and not reserved elsewhere. Placements persist as `capacityReservation` rows (authoritative across jobs/runs; rebuilt per job per run; `WorkCenter` + `OperatorPool` kinds). Dispatch rules per `schedulingPolicy` (per-WC row → company default → EDD). MUST use `triggerJobSchedule` to reschedule, never direct date writes.
- **Ability requirements** — resolved through the operation's PROCESS: `process.requiresAbility` → the ability linked 1:1 to the process (`ability.processId`) → binary `employeeAbility` qualification (active ∧ trainingCompleted ∧ not expired). Gates both the scheduler's operator pools and MES operation start. There are no operation-level ability tables.

## Safety

### Always
- MUST use `recalculateJobRequirements` after changing job materials or operations — it recalculates quantities and costs.
- MUST use `triggerJobSchedule` to reschedule — it invokes the scheduling engine via Inngest.
- MUST check `isJobLocked(status)` before allowing edits — Completed/Closed/Cancelled jobs are locked.
- MUST scope queries by `companyId`; jobs are also scoped by `locationId`.
- MUST use `calculateJobPriority` for priority — it computes from deadline type and due date. Never set `job.priority` manually.

### Ask First
- Deleting jobs that have posted production events or inventory movements.
- Changing job status backwards (e.g., Completed → In Progress).
- Running MRP (`runMRP`) — it can create/modify planned orders system-wide.

### Never
- Directly modify `jobOperation.startDate`/`dueDate` — MUST go through the scheduling engine.
- Delete job operations that have production events recorded against them.
- Set `job.priority` manually — it's calculated by `calculateJobPriority`.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `job` / `jobs` (view) | Work order header: item, quantity, dates, status, priority |
| `jobMakeMethod` | Manufacturing method instance; tree via `parentMaterialId` |
| `jobOperation` | Routing step: process, times, work center, status, scheduling dates |
| `jobMaterial` | BOM line: item, quantity, methodType, unitCost |
| `jobOperationStep` / `jobOperationParameter` / `jobOperationTool` | Work instruction details on operations |
| `jobOperationDependency` | Operation sequencing dependencies |
| `capacityReservation` | Durable finite-capacity slot allocations (WorkCenter / OperatorPool) |
| `schedulingPolicy` | Dispatch rule per work center (null workCenterId = company default) |
| `jobOperationQueueTime` (view) | Ready → first productionEvent queue time (`jobOperation.readyAt` stamped by trigger) |
| `productionEvent` | Time tracking: type (Labor/Machine/Setup), start/end, employee |
| `productionQuantity` | Output: type (Production/Scrap/Rework), quantity, scrapReason |
| `procedure` / `procedureStep` / `procedureParameter` | Versioned work instructions |
| `maintenanceDispatch` / `maintenanceSchedule` | Equipment maintenance tracking |
| `demandForecast` / `demandProjection` | Demand planning data |
| `scrapReason` / `maintenanceFailureMode` | Reference data for production and maintenance |

## Key Service Functions

- `convertSalesOrderLinesToJobs` — creates jobs from sales order Make to Order lines
- `getJob` / `getJobs` / `getJobMethodTree` / `getJobMethodTreeArray` — job reads with method hierarchy
- `getJobMaterialsWithQuantityOnHand` — BOM with on-hand for shortfall visibility
- `getJobMaterialShortfallByItem` — priority-adjusted shortfall calculation
- `getJobOrderStatusMap` — procurement status indicators per material
- `recalculateJobRequirements` / `recalculateJobOperationDependencies` — recalculation after changes
- `triggerJobSchedule` — fires the scheduling engine via Inngest
- `getJobPromiseDate` — promise date = scheduled finish of the job's last operation (predictLeadTime v1)
- `runMRP` — triggers Material Requirements Planning via `mrp` edge function
- `calculateJobPriority` — computes priority from deadline type and due date
- `getActiveJobOperationsByLocation` — schedule board data (RPC `get_active_job_operations_by_location`)
- `getProductionPlanning` — MRP-driven production planning (RPC `get_production_planning`)
- `upsertMaintenanceDispatch` / `upsertMaintenanceSchedule` — maintenance management

## Key Exports

```typescript
import { getJob, insertJob, triggerJobSchedule, runMRP } from "~/modules/production";
import { jobValidator, isJobLocked, jobStatus } from "~/modules/production";
```

## Related Modules

- **sales** — jobs created from sales order lines; `job.salesOrderLineId` links back
- **items** — `job.itemId` references item master; methods come from item make methods
- **inventory** — materials issued from inventory; finished goods post on job completion
- **purchasing** — outside operations and purchased materials create PO lines via `jobId`
- **resources** — operations run on work centers; scheduling assigns to work centers
- **quality** — production quantities can trigger quality inspections; scrap reasons overlap

## Rules References

- `.ai/rules/scheduling-data-structures.md` — scheduling engine architecture, trigger chain, RPCs
- `.ai/rules/mrp-system.md` — MRP run flow, planning data model, and planning UI
- `.ai/rules/method-material-sourcing.md` — how material methodType drives procurement
