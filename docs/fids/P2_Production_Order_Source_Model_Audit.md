# P2 Production Order Source Model Audit

## Scope and evidence rule

This is a read-only audit from P1 baseline `e88dc306f`. It inspects the
repository source, generated database contract, migrations, and existing FIDS
adapters. It does not query a live tenant, write a database, or invent an
ERPNext record.

## Source inventory

| Candidate source | Evidence | Confidence | Gate meaning |
| --- | --- | --- | --- |
| ERPNext/Frappe Work Order | Read-only inspection of `E:\6. Factory OS\Factory + ERP +MES\erpnext-develop.zip` found `erpnext/manufacturing/doctype/work_order/work_order.json` and `work_order.py`. The DocType has Frappe name identity, status, `production_item`, `bom_no`, `qty`, `produced_qty`, required-items table, operations table, planned/actual start/end and expected delivery date. | `CONFIRMED` | ERPNext production source exists outside this Carbon repository. |
| ERPNext/Frappe Job Card | The same archive contains `job_card/job_card.json` and `job_card.py`; it links `work_order`, `operation`, `workstation`, `for_quantity`, `total_completed_qty`, status, time logs and raw-material items. | `HIGH_CONFIDENCE` | Executable ERPNext operation evidence exists, but its link to Carbon is not implemented here. |
| Carbon ERP `job` | `packages/database/supabase/migrations/20240909194622_jobs.sql` creates `job`; generated `packages/database/src/types.ts` exposes its identity, status, quantity, dates, item, location, sales links and completion fields. | `CONFIRMED` | A Carbon production-order-like source exists. It is not evidence of ERPNext. |
| Carbon MES `jobOperation` | `jobOperation.jobId` is a foreign key to `job.id`; MES RPCs and `operations.service.ts` load the parent job and operation together. | `CONFIRMED` | Carbon Job → Operation relationship is reliable. |
| Carbon MES production evidence | `productionEvent` and `productionQuantity` reference `jobOperationId`; operation detail service reads both. | `CONFIRMED` | Execution evidence can attach to a Carbon operation. |

## Evidence-backed chain

The repository proves this internal chain:

```text
Carbon ERP job.id / job.jobId
        ↓ jobOperation.jobId → job.id
Carbon MES jobOperation.id
        ↓ jobOperationId
productionEvent / productionQuantity / nonConformanceJobOperation
```

It does not prove the requested external chain:

```text
ERPNext Production Order → Carbon ERP job → Carbon MES jobOperation
```

The first arrow has no source implementation or correlation evidence. This is a
core identity/source-ownership blocker, not a UI gap.

## Required fields found in Carbon source

Carbon `job` provides `id`, company-scoped readable `jobId`, `itemId`,
`locationId`, `status`, `quantity`, generated `productionQuantity`,
`quantityComplete`, `quantityShipped`, `quantityReceivedToInventory`,
`startDate`, `dueDate`, `deadlineType`, sales-order references and audit times.
`jobOperation` provides `id`, `jobId`, order, process, optional work center,
operation type, operation status, target/operation/completed/reworked/scrapped
quantities and start/due dates. These are internal Carbon facts, not a frozen
ERPNext contract.

## Audit conclusion

Carbon internal source coverage is `HIGH_CONFIDENCE`, and the external ERPNext
Work Order schema is `CONFIRMED`. The missing piece is the runtime
ERPNext→Carbon correlation/ingestion contract: the Carbon repository contains
no connector, mapping table, external-reference field or event that links an
ERPNext Work Order name to a Carbon `job`. P2 therefore remains blocked on the
cross-system chain, not on discovery of the ERPNext schema itself.
