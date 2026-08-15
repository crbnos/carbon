# Production Order Quantity Contract

## Metric matrix

| Metric | Source field | System | Meaning | Unit | Aggregation | Authority | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `plannedQuantity` | Work Order `qty` | ERPNext | Quantity planned to manufacture | source UOM | order | planning | CONFIRMED |
| `plannedQuantity` | Job `quantity` | Carbon MES | Carbon copy of planned order quantity | source UOM | order | planning | HIGH_CONFIDENCE |
| `executionQuantity` | Job execution/production field | Carbon MES | Execution quantity explicitly supplied by source | source UOM | order | execution | PARTIAL |
| `operationCompletedQuantity` | JobOperation `quantityComplete` | Carbon MES | Completion recorded for one operation | source UOM | operation | execution | CONFIRMED |
| `scrapQuantity` | Job `quantityScrapped` | Carbon MES | Source-reported scrap quantity | source UOM | order | execution | PARTIAL |
| `jobQuantityComplete` | Job `quantityComplete` | Carbon MES | Job-level completion field | source UOM | order | execution | REQUIRES_DOMAIN_CONFIRMATION |

`releasedQuantity`, `startedQuantity`, `goodQuantity`, `pendingQuantity` and a
canonical `completedQuantity` remain undefined in this MVP. No percentage is
derived unless an approved quantity contract aligns units and aggregation.

## Mandatory regression

The sanitized C fixture records:

```text
production aggregate = 1
operation quantityComplete = 1
job quantityComplete = 0
```

The projections retain all source values, leave canonical completed quantity
undefined, and leave canonical progress undefined. This prevents the erroneous
shortcut `completedQuantity = job.quantityComplete`.
