CREATE TYPE "fulfillmentType" AS ENUM (
  'Inventory',
  'Job'
);

CREATE TABLE "fulfillment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "salesOrderLineId" TEXT NOT NULL,
  "type" "fulfillmentType" NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "jobId" TEXT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  
  CONSTRAINT "fulfillment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fulfillment_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fulfillment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fulfillment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "fulfillment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fulfillment_job_check" CHECK (
    "type" = 'Job' AND "jobId" IS NOT NULL OR
    "type" = 'Inventory' AND "jobId" IS NULL
  )
);

-- Create indexes for foreign keys to improve query performance
CREATE INDEX "fulfillment_salesOrderLineId_idx" ON "fulfillment" ("salesOrderLineId");
CREATE INDEX "fulfillment_companyId_idx" ON "fulfillment" ("companyId");
CREATE INDEX "fulfillment_createdBy_idx" ON "fulfillment" ("createdBy");
CREATE INDEX "fulfillment_jobId_idx" ON "fulfillment" ("jobId");


CREATE POLICY "SELECT" ON "fulfillment"
FOR SELECT USING (
  "companyId" = ANY (
      SELECT DISTINCT unnest(ARRAY(
        SELECT unnest(get_companies_with_employee_permission('inventory_view'))
        UNION
        SELECT unnest(get_companies_with_employee_permission('sales_view'))
      ))
    )
);

CREATE POLICY "INSERT" ON "fulfillment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('inventory_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "fulfillment"
FOR UPDATE USING (
 "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission ('sales_update')
      )::text[]
    )
);

CREATE POLICY "DELETE" ON "fulfillment"
FOR DELETE USING (
  "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission ('sales_delete')
      )::text[]
    )
);

ALTER TABLE "shipmentLine"
ADD COLUMN "fulfillmentId" TEXT NULL;

ALTER TABLE "shipmentLine"
ADD CONSTRAINT "shipmentLine_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "shipmentLine_fulfillmentId_idx" ON "shipmentLine" ("fulfillmentId");

DROP VIEW IF EXISTS "shipmentLines";
CREATE OR REPLACE VIEW "shipmentLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    sl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "shipmentLine" sl
  INNER JOIN "item" i ON i."id" = sl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";