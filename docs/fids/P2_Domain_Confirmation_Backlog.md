# P2 Domain Confirmation Backlog

| ID | Confirmation | Owner | Evidence required | Priority | Gate |
| --- | --- | --- | --- | --- | --- |
| P2-D01 | Confirm the ERPNext Work Order DocType/API access, source ID/company scope and deployed version used by the integration. | ERPNext owner | Endpoint/schema example with a non-secret record | P0 | Blocking |
| P2-D02 | Define the one-to-one ERPNext ↔ Carbon Job correlation key and lifecycle. | Data governance | Mapping sample, duplicate/rename/cancel rules | P0 | Blocking |
| P2-D03 | Confirm whether Carbon `job.id` or `job.jobId` is the internal anchor and how it is exposed to MES. | Carbon ERP/MES owner | Contract and sample records | P0 | Blocking |
| P2-D04 | Freeze `completedQuantity` semantics, including production aggregate = 1, operation completion = 1, job completion = 0 regression. | Production domain owner | Regression fixture and authoritative rule | P0 | Blocking |
| P2-D05 | Publish ERPNext and Carbon status crosswalk and transition authority. | ERP/MES owners | Enum matrix and transition examples | P1 | Required |
| P2-D06 | Confirm operation identity, sequence, dependency and parent-order mapping. | MES owner | Operation sample with source references | P1 | Required |
| P2-D07 | Confirm due-date/start-date ownership, timezone, deadline semantics and revision/freshness policy. | Planning owner | Schedule contract | P1 | Required |
| P2-D08 | Define material method/shortage/availability semantics. | ERP planning owner | Material and supply examples | P2 | Non-blocking secondary |
| P2-D09 | Define work-center versus equipment identity and machine-state authority. | MES/work-center owner | Equipment mapping and state enum | P2 | Non-blocking secondary |
| P2-D10 | Define exception sources, evidence timestamps/freshness, severity/lifecycle and action authorization. | Factory OS governance | Governance contract | P3/P4 | Deferred |

No item in this backlog authorizes UI, workflow, schema, event-bus or database
changes. It is a confirmation list for the next domain review.
