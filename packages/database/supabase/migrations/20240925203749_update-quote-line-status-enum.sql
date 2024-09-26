-- Begin transaction
BEGIN;

-- Drop the view that depends on the quoteLine table
DROP VIEW IF EXISTS "quoteLines";
DROP VIEW IF EXISTS "quotes";

-- Create a new enum type for the updated quote line status
DROP TYPE IF EXISTS "newQuoteLineStatus";
CREATE TYPE  "newQuoteLineStatus" AS ENUM (
  'Not Started',
  'In Progress',
  'Complete',
  'No Quote'
);

-- Alter the quoteLine table to change status column to TEXT
ALTER TABLE "quoteLine" 
  ALTER COLUMN "status" TYPE TEXT,
  ALTER COLUMN "status" SET DEFAULT NULL;

-- Drop the old enum type
DROP TYPE IF EXISTS "quoteLineStatus";

-- Update the status values in the quoteLine table
UPDATE "quoteLine"
SET "status" = CASE 
  WHEN "status" = 'Draft' THEN 'Not Started'
  ELSE "status"
END;

-- Alter the quoteLine table to use the new enum type
ALTER TABLE "quoteLine" 
  ALTER COLUMN "status" TYPE "newQuoteLineStatus" USING "status"::"newQuoteLineStatus";

-- Rename the new enum type to the original name
ALTER TYPE "newQuoteLineStatus" RENAME TO "quoteLineStatus";

-- Set the default value for the status column
ALTER TABLE "quoteLine" 
  ALTER COLUMN "status" SET DEFAULT 'Not Started';

-- Recreate the quoteLines view
CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."thumbnailPath", imu."thumbnailPath") as "thumbnailPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost"
  FROM "quoteLine" ql
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);

-- Recreate the quotes view if it exists 
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  EXISTS(SELECT 1 FROM "quoteFavorite" pf WHERE pf."quoteId" = q.id AND pf."userId" = auth.uid()::text) AS favorite,
  opp."salesRfqId",
  opp."salesOrderId"
  FROM "quote" q
  LEFT JOIN (
    SELECT 
      "quoteId",
      COUNT("id") FILTER (WHERE "status" != 'No Quote') AS "lines",
      COUNT("id") FILTER (WHERE "status" = 'Complete') AS "completedLines"
    FROM "quoteLine"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "location" l
    ON l.id = q."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."quoteId" = q.id;

-- Commit the transaction
COMMIT;