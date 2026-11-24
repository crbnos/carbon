---
paths: []
triggers: []
promoted: null
---
# `openProductionOrders` is MRP supply, not "the open jobs for an item"

**Context:** The Buildable Quantity card lists an item's open jobs and whether stock covers what each still has to issue.

**Problem:** The jobs were read from `openProductionOrders`. That view leaves out every job made for a sales order (`salesOrderId IS NULL`) and every `consumeToProject` job, and its `quantityToReceive` is `productionQuantity` (quantity + scrap) less received. An item made to order showed no jobs in production, and a job with a scrap allowance showed more units than it will make.

**Rule:** To list an item's open jobs, read `job` with the four open statuses. The good units left are `quantity − quantityReceivedToInventory − quantityShipped`, as `openSalesOrderLines` nets a job. Use `openProductionOrders` only where the question is "what supply does MRP count".

**Applies to:** Any report, card or check that shows jobs in production or work in process for an item.
