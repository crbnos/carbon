# Production Order Mapping Registry

Implementation: `packages/utils/src/production-order-mapping.ts`.

Every entry carries:

```text
source / target / authority / transform / confidence / status
```

## Active mappings

| Source | Target | Authority | Transform | Confidence | Status |
| --- | --- | --- | --- | --- | --- |
| ERPNext WorkOrder `name` | ProductionOrder source refs | planning | source-reference | CONFIRMED | active |
| Carbon Job `id` | ProductionOrder source refs | execution | source-reference | CONFIRMED | active |
| ERPNext WorkOrder `qty` | plannedQuantity | planning | identity | CONFIRMED | active |
| Carbon Job `quantityComplete` | jobQuantityComplete | execution | identity | REQUIRES_DOMAIN_CONFIRMATION | requires-domain-confirmation |
| ERPNext WorkOrder `status` | raw source state | planning | source-state | CONFIRMED | active |
| Carbon Job `status` | raw source state | execution | source-state | CONFIRMED | active |
| Carbon JobOperation `quantityComplete` | operationCompletedQuantity | execution | identity | CONFIRMED | active |

`validateProductionOrderMappings()` verifies active entries, defined authority,
defined transform and known confidence. It reports errors instead of supplying
defaults.
