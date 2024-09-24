-- Add index on job table for salesOrderLineId
CREATE INDEX IF NOT EXISTS idx_job_sales_order_line_id ON "job" ("salesOrderLineId");


ALTER TABLE "itemReplenishment"
DROP CONSTRAINT IF EXISTS "itemReplenishment_pkey";

ALTER TABLE "itemReplenishment"
ADD CONSTRAINT "itemReplenishment_pkey" PRIMARY KEY ("itemId");

UPDATE "itemReplenishment" SET 
"lotSize" = COALESCE("lotSize", 0);

ALTER TABLE "itemReplenishment" 
ALTER COLUMN "lotSize" SET DEFAULT 0;