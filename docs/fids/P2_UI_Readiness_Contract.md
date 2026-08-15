# P2 UI Readiness Contract

## Readiness rule

Production Order 360 may begin only when its identity and parent/order-to-
operation relationships are source-backed, and quantity/status semantics are
explicit. Unknown secondary material, equipment, freshness or governed-action
fields may be visibly deferred; they must never be fabricated.

## Current readiness matrix

| UI contract field | Status | Permitted treatment |
| --- | --- | --- |
| Production Order identity | `BLOCKED` | Do not render a cross-system identity. |
| ERPNext source link | `BLOCKED` | No link exists to render. |
| Carbon Job source link | `CONFIRMED` | Can be shown only as Carbon source context. |
| MES operation list | `CONFIRMED` internally | Can be described as Carbon execution data, not implemented here. |
| Operation status | `PARTIAL` | Preserve raw Carbon status; crosswalk required. |
| Completion quantity | `BLOCKED` | Do not use `completedQuantity = job.quantityComplete` as a frozen rule. |
| Due date/schedule | `PARTIAL` | Show only with source owner/timezone policy. |
| Materials | `PARTIAL` | Defer shortage/availability semantics. |
| Equipment | `PARTIAL` | Work center reference only; no machine ontology claim. |
| Exceptions/evidence | `PARTIAL` | Source facts may be attached after governance contract; no actions. |

## Gate result

The UI readiness contract is `P2_BLOCKED`. The P1 shell and empty object slot
remain intact. No Production Order 360 route, card, dashboard, action, AI
recommendation, or adapter implementation should be added from this result.
