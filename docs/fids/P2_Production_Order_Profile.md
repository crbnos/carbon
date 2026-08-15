# P2 Production Order Profile

This profile records what can and cannot be stated for a Production Order 360
object from the current repository.

| Profile facet | Carbon evidence | Confidence | P2 treatment |
| --- | --- | --- | --- |
| Identity | `job.id`, company-scoped `job.jobId`, item/location/sales references | `CONFIRMED` internally | Keep source references; no ERPNext identity claim. |
| Status | Job enum and operation enum are explicit | `CONFIRMED` internally | Preserve raw values; crosswalk deferred. |
| Quantity/progress | Job quantity/production quantity/completion plus operation and production-quantity facts | `PARTIAL` for canonical semantics | Do not define `completedQuantity` yet. |
| Schedule | Job `startDate`/`dueDate`/`deadlineType`; operation start/due and scheduling RPCs | `HIGH_CONFIDENCE` internally | Source ownership and timezone policy required. |
| Operations | Ordered operations, dependencies, process and work center references | `CONFIRMED` internally | ERPNext operation linkage deferred. |
| Materials | Job material item, method type, required/issued quantities and supply-job links | `HIGH_CONFIDENCE` internally | Availability/shortage ontology deferred. |
| Equipment | Work center and production-event work-center references | `PARTIAL` | Work center ≠ governed equipment identity without confirmation. |
| Exceptions/evidence | Conflict fields, non-conformance links, production events/quantities | `PARTIAL` | No final severity, freshness or action authority. |
| ERPNext source | Work Order and Job Card DocTypes are present in the external ERPNext archive | `CONFIRMED` | Runtime ingestion/correlation still blocked. |

## Quantity guardrail

The repository contains a known semantic boundary: production-quantity rows
increment operation quantities, while the latest sync updates `job.quantityComplete`
from the last top-level operation; scheduling views use the maximum root-level
operation completion. Therefore `completedQuantity = job.quantityComplete` is
**not frozen by this gate**. A case where job production aggregate = 1,
operation `quantityComplete` = 1, and `job.quantityComplete` = 0 must remain a
regression fixture and cannot be normalized away.
