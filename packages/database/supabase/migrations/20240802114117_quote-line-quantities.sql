ALTER TABLE "quoteLine" 
  ADD COLUMN "quantity" NUMERIC(20, 2)[] DEFAULT ARRAY[1]::NUMERIC(20, 2)[],
  ADD COLUMN "additionalCharges" JSONB DEFAULT '{}';

DROP VIEW "quoteLines";
CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."thumbnailPath", imu."thumbnailPath") as "thumbnailPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize"
  FROM "quoteLine" ql
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);

COMMIT;

ALTER TABLE "quoteLinePrice" 
  DROP COLUMN "id",
  DROP COLUMN "markupPercent",
  DROP COLUMN "extendedPrice",
  DROP COLUMN "unitCost",
  ADD COLUMN "unitPrice" NUMERIC(10,5) NOT NULL DEFAULT 0,
  ADD CONSTRAINT "quoteLinePrice_pkey" PRIMARY KEY ("quoteLineId", "quantity");
