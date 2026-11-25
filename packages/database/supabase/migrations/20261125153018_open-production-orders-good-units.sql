-- openProductionOrders — an open job is supply in GOOD units. The scrap
-- allowance (productionQuantity − quantity) is expected to be lost, so
-- quantityToReceive is quantity less what was received to inventory, never
-- below zero. MRP, available-to-promise, the buildable check and the item
-- planning chart all read this column, so they count a job the same way.
-- Forked from 20261021005100_planning-group-segments.sql: only
-- quantityToReceive changes.

CREATE OR REPLACE VIEW "openProductionOrders"
WITH (security_invoker = true)
AS (
  SELECT
    j."id",
    j."itemId",
    j."jobId",
    GREATEST(j."quantity" - j."quantityReceivedToInventory", 0) AS "quantityToReceive",
    j."unitOfMeasureCode",
    j."companyId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate",
    j."deadlineType",
    COALESCE(
      j."planningGroupId",
      CASE
        WHEN j."receiveToProjectStock" THEN project_planning_segment(j."projectId")
        ELSE ''
      END
    ) AS "planningSegmentId",
    j."projectId" AS "ownerProjectId",
    j."planningGroupId"
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND j."salesOrderId" IS NULL
  AND NOT j."consumeToProject"
);
