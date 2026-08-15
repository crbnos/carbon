# Quantity Ontology v1

## Supported semantics

| Field | Source | Meaning | Authority | Note |
| --- | --- | --- | --- | --- |
| `plannedQuantity` | ERP Work Order `qty` | plan target for order | planning | non-negative when present |
| `plannedQuantity` (MES copy) | Carbon Job `quantity` | mirrored planned quantity | planning | explicit source retained |
| `executionQuantity` | Carbon Job execution quantity | produced/available execution metric | execution | source-scope |
| `operationCompletedQuantity` | Carbon JobOperation `quantityComplete` | operation-level completion | execution | operation-scope |
| `scrapQuantity` | Carbon Job `quantityScrapped` | scrap volume | execution | source-scope |
| `jobQuantityComplete` | Carbon Job `quantityComplete` | order-level completion fact only | execution | requires domain confirmation |

## Unsupported in v1

- `releasedQuantity`
- `startedQuantity`
- `goodQuantity`
- canonical `completedQuantity`
- canonical `progress` percentage

Canonical completion/progress remain undefined in v1. Any value shown to users must retain original source semantic.

## Regression evidence

Scenario:

- `production aggregate = 1`
- `operationCompletedQuantity = 1`
- `jobQuantityComplete = 0`

Contract behavior:
- all three source facts are preserved independently
- no derived completed ratio is emitted
