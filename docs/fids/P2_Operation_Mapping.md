# P2 Operation Mapping

## Relationship classification

| Mapping | Cardinality | Confidence | Classification |
| --- | --- | --- | --- |
| Carbon Job → Carbon Job Operation | `1:N` | `CONFIRMED` | `CONFIRMED_DIRECT_MAPPING` |
| ERPNext Work Order → ERPNext Work Order Operation / Job Card | `1:N` | `CONFIRMED` in the archived DocTypes | Source-side only |
| ERPNext Work Order Operation / Job Card → Carbon Job Operation | Unknown | `BLOCKED` | `UNRESOLVED` |

## Carbon relationship

| Relationship | Evidence | Confidence |
| --- | --- | --- |
| Job contains operations | `jobOperation.jobId` foreign key to `job.id`; `getJobByOperationId` first resolves `jobId` then loads the parent `jobs` row. | `CONFIRMED` |
| Operation sequence | `jobOperation.order` plus `operationOrder` (`After Previous` / `With Previous`). | `CONFIRMED` |
| Operation dependencies | `jobOperationDependency(operationId, dependsOnId, jobId)` with no-self check and status-trigger functions. | `CONFIRMED` |
| Operation executes at work center | Optional `jobOperation.workCenterId` foreign key; `productionEvent.workCenterId` records execution context. | `HIGH_CONFIDENCE` |
| Operation execution evidence | `productionEvent.jobOperationId`, `productionQuantity.jobOperationId`, and non-conformance links. | `CONFIRMED` |
| ERPNext operation relationship | ERPNext operation source exists, but no ERPNext-to-Carbon operation correlation key. | `BLOCKED` |

The ERPNext source does contain an operations child table on Work Order and
Job Card links to a Work Order, Operation and Workstation. Those facts prove
ERPNext-side planning/execution objects, but do not prove that an ERPNext child
row is the same record as a Carbon `jobOperation` row.

## MES read model

The latest `get_job_operation_by_id` RPC returns parent job readable ID/status,
item context, operation status, target/operation/completed/reworked/scrapped
quantities, work center and operation due date. This is sufficient to describe
Carbon MES execution context, not to prove an ERPNext operation mapping.

## Contract rule

P2 may retain the Carbon `jobOperationId` and parent Carbon `job.id` as source
references. It must not call a Carbon operation an ERPNext operation, infer an
ERPNext routing sequence, or create a cross-system operation ID until the
Production Order correlation contract is confirmed.
