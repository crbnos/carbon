-- An outside-processing PO line carries the job's own item, but receiving it
-- stocks nothing (post-receipt writes no item ledger row for it): the job is
-- the supply. Counting the line too made planning see the job's quantity twice.
-- Recreated from 20261021013000_project-material-mrp-demand.sql with one filter added.
CREATE OR REPLACE VIEW "openPurchaseOrderLines" WITH (security_invoker=true) AS (
  SELECT
    pol."id",
    pol."purchaseOrderId",
    po."purchaseOrderId" as "purchaseOrderReadableId",
    po."supplierId",
    pol."itemId",
    pol."quantityToReceive" * pol."conversionFactor" AS "quantityToReceive",
    i."unitOfMeasureCode",
    pol."purchaseOrderLineType",
    pol."requiredDate" AS "dueDate",
    pol."companyId",
    pol."locationId",
    po."orderDate",
    po."status",
    COALESCE(pol."promisedDate", pod."receiptPromisedDate") AS "promisedDate",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime",
    COALESCE(pol."planningGroupId", project_planning_segment(pol."projectId")) AS "planningSegmentId",
    pol."projectId" AS "ownerProjectId",
    pol."planningGroupId"
  FROM "purchaseOrderLine" pol
  INNER JOIN "purchaseOrder" po ON pol."purchaseOrderId" = po."id"
  INNER JOIN "purchaseOrderDelivery" pod ON pod."id" = po."id"
  INNER JOIN "item" i ON pol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE
    pol."purchaseOrderLineType" != 'Service'
    AND po."purchaseOrderType" <> 'Outside Processing'
    AND po."status" IN ('To Receive', 'To Receive and Invoice', 'Planned')
    AND pol."receivedComplete" = false
    AND NOT purchase_order_line_consumed_by_project(
      pol."companyId", pol."projectId", pol."projectElementId",
      po."purchaseOrderType", i."itemTrackingType"
    )
);
