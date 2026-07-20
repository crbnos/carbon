-- Make to Order sales order lines drive planning demand until a live job
-- covers them. Previously the view excluded MTO lines outright, so a confirmed
-- order for a manufactured item produced no purchasing/production demand at all
-- until someone created the job. Now an MTO line contributes its uncovered
-- quantity: quantityToSend minus the remaining output of live jobs linked to
-- the line. The job-status set ('Planned','Ready','In Progress','Paused')
-- matches openJobMaterialLines, so each unit is counted exactly once — via the
-- SO line while unjobbed, via job materials once a job is released, and via
-- inventory/shipment once produced. Draft and Cancelled jobs do not suppress
-- line demand (their materials drive nothing).
--
-- Also restores WITH (security_invoker=true), which 20250616011758 added and
-- the 20260417000300 recreate accidentally dropped.

DROP VIEW IF EXISTS "openSalesOrderLines";
CREATE VIEW "openSalesOrderLines" WITH (security_invoker=true) AS (
  SELECT
    sol."id",
    sol."salesOrderId",
    sol."itemId",
    sol."promisedDate",
    sol."methodType",
    sol."unitOfMeasureCode",
    CASE
      WHEN sol."methodType" = 'Make to Order' THEN GREATEST(
        sol."quantityToSend" - COALESCE((
          SELECT SUM(GREATEST(j."quantity" - j."quantityReceivedToInventory" - j."quantityShipped", 0))
          FROM "job" j
          WHERE j."salesOrderLineId" = sol."id"
            AND j."companyId" = sol."companyId"
            AND j."status" IN ('Planned', 'Ready', 'In Progress', 'Paused')
        ), 0),
        0
      )
      ELSE sol."quantityToSend"
    END AS "quantityToSend",
    sol."salesOrderLineType",
    sol."companyId",
    COALESCE(sol."locationId", so."locationId") AS "locationId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so ON sol."salesOrderId" = so."id"
  INNER JOIN "item" i ON sol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE sol."salesOrderLineType" != 'Service'
    AND so."status" IN ('To Ship', 'To Ship and Invoice')
);
