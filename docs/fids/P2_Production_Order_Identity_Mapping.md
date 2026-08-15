# P2 Production Order Identity Mapping

## Identity matrix

| Layer | Candidate key | Evidence | Confidence | Decision |
| --- | --- | --- | --- | --- |
| ERPNext Production Order anchor | Frappe `Work Order.name` (the DocType record name) | `E:\6. Factory OS\Factory + ERP +MES\erpnext-develop.zip::erpnext/manufacturing/doctype/work_order/work_order.json` and `work_order.py`. | `CONFIRMED` | Source anchor exists, but no Carbon link is present. |
| Carbon ERP Job database identity | `job.id` (primary key) | `20240909194622_jobs.sql`; generated DB types. | `CONFIRMED` | Stable internal foreign-key identity. |
| Carbon ERP Job readable identity | `job.jobId`, unique with `companyId` | `job_jobId_key` in the jobs migration. | `CONFIRMED` | Display/business identifier, not a cross-system key. |
| Carbon MES Operation | `jobOperation.id` | `jobOperation` primary key and MES operation RPC. | `CONFIRMED` | Stable operation identity. |
| Job → Operation link | `jobOperation.jobId = job.id` | Foreign key in jobs migration and MES `getJobByOperationId`. | `CONFIRMED` | Internal relationship only. |
| ERPNext → Carbon correlation | None observed | No shared external ID, mapping table, event, external-reference column, or adapter input. | `NO_RELIABLE_MAPPING` | P2 core gate blocker. |

## Existing FIDS identity behavior

`adaptErpJobToFactoryObject` accepts a generic `recordId` and labels it
`system: "erpnext"`, producing `production-order:erpnext:<recordId>`. This is a
pure contract fixture boundary; it is not a runtime ERPNext integration and
must not be treated as proof that Carbon `job.id` or `job.jobId` is an ERPNext
ID. `adaptCarbonOperationToFactoryObject` similarly creates a deterministic
Carbon MES operation identity but has no parent production-order reference.

## Required confirmation

Before P2 implementation, confirm one authoritative rule such as an ERPNext
Work Order `name` mapped to a Carbon `job` external-reference field or a
versioned mapping table. The rule must define company/tenant scope, lifecycle
when a source is renamed or cancelled, duplicate handling, and whether the
mapping is one-to-one. Until then, no Factory OS production-order ID may be
presented as a cross-system identity.
