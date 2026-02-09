-- Revert leadTime changes from 20260206061346_quote-lead-time.sql

-- Drop the view first since it depends on the leadTime column
DROP VIEW IF EXISTS "quotes";

-- Now drop the column
ALTER TABLE "quoteShipment" DROP COLUMN IF EXISTS "leadTime";

-- Recreate the view without leadTime
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  ql."thumbnailPath",
  ql."itemType",
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  qs."shippingCost"
  FROM "quote" q
  LEFT JOIN (
    SELECT 
      "quoteId",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" != 'No Quote') AS "lines",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" = 'Complete') AS "completedLines", 
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM "quoteLine"
    INNER JOIN "item" i
      ON i."id" = "quoteLine"."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "quoteShipment" qs ON qs."id" = q."id"
  LEFT JOIN "location" l
    ON l.id = q."locationId";
