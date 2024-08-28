CREATE TYPE "salesOrderLineStatus" AS ENUM ('Ordered', 'In Progress', 'Completed');

ALTER TABLE "salesOrderLine"
ADD COLUMN "status" "salesOrderLineStatus" NOT NULL DEFAULT 'Ordered',
ADD COLUMN "modelUploadId" TEXT;

DROP VIEW "salesOrderLines";

CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    sol.*,
    so."customerId",
    i.name AS "itemName",
    i.description AS "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."thumbnailPath", imu."thumbnailPath") as "thumbnailPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost"
  FROM "salesOrderLine" sol
    LEFT JOIN "modelUpload" mu ON sol."modelUploadId" = mu."id"
    INNER JOIN "item" i ON i.id = sol."itemId"
    LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
    LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
    INNER JOIN "salesOrder" so 
      ON so.id = sol."salesOrderId"
    
