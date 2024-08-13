CREATE TABLE "salesRfqToQuote" (
  "salesRfqId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  PRIMARY KEY ("salesRfqId", "quoteId"),
  FOREIGN KEY ("salesRfqId") REFERENCES "salesRfq" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("quoteId") REFERENCES "quote" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE
);

CREATE INDEX "salesRfqToQuote_companyId_idx" ON "salesRfqToQuote" ("companyId");

ALTER TABLE "salesRfqToQuote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view salesRfqToQuote" ON "salesRfqToQuote" FOR SELECT USING (
  has_company_permission('sales_view', "companyId")  AND 
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_create can insert salesRfqToQuote" ON "salesRfqToQuote" FOR INSERT WITH CHECK (
  has_company_permission('sales_view', "companyId") AND
  has_role('employee', "companyId")
);

CREATE TABLE "customerPartToItem" (
  "customerId" TEXT NOT NULL,
  "customerPartId" TEXT NOT NULL,
  "customerPartRevision" TEXT DEFAULT '',
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  CONSTRAINT "customerPartToItem_pkey" PRIMARY KEY ("customerId", "itemId"),
  CONSTRAINT "customerPartToItem_customerId_itemId_key" UNIQUE ("customerId", "itemId"),
  CONSTRAINT "customerPartToItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE,
  CONSTRAINT "customerPartToItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE CASCADE,
  CONSTRAINT "customerPartToItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE
);

CREATE INDEX "customerPartToItem_companyId_idx" ON "customerPartToItem" ("itemId");
CREATE INDEX "customerPartToItem_customerPartId_idx" ON "customerPartToItem" ("customerPartId", "customerPartRevision", "companyId");

ALTER TABLE "customerPartToItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view customer part to item" ON "customerPartToItem" FOR SELECT USING (
  has_company_permission('sales_view', "companyId")  AND 
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_create can insert customer part to item" ON "customerPartToItem" FOR INSERT WITH CHECK (
  has_company_permission('sales_view', "companyId") AND
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_delete can delete customer part to item" ON "customerPartToItem" FOR SELECT USING (
  has_company_permission('sales_delete', "companyId")  AND 
  has_role('employee', "companyId")
);


DROP VIEW "salesRfqs";
DROP VIEW "salesRfqLines";
COMMIT;

ALTER TABLE "salesRfq" 
  ADD COLUMN "customerLocationId" TEXT,
  DROP COLUMN "externalNotes",
  ADD COLUMN "notes" JSON DEFAULT '{}',
  ADD CONSTRAINT "salesRfq_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation" ("id") ON DELETE SET NULL;

ALTER TABLE "salesRfqLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view salesRfqLine" ON "salesRfqLine" FOR SELECT USING (
  has_company_permission('sales_view', "companyId")  AND 
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_create can insert salesRfqLine" ON "salesRfqLine" FOR INSERT WITH CHECK (
  has_company_permission('sales_view', "companyId") AND
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_update can update salesRfqLine" ON "salesRfqLine" FOR UPDATE USING (
  has_company_permission('sales_view', "companyId") AND
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_delete can delete salesRfqLine" ON "salesRfqLine" FOR DELETE USING (
  has_company_permission('sales_view', "companyId") AND
  has_role('employee', "companyId")
);

ALTER TABLE "salesRfqLine"
  DROP COLUMN "customerPartNumber",
  DROP COLUMN "customerPartRevision";

ALTER TABLE "salesRfqLine"
  ADD COLUMN "customerPartId" TEXT NOT NULL,
  ADD COLUMN "customerPartRevision" TEXT;

CREATE OR REPLACE VIEW "salesRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  rfq.*,
  l."name" AS "locationName",
  srtq."quoteId",
  EXISTS(SELECT 1 FROM "salesRfqFavorite" rf WHERE rf."rfqId" = rfq.id AND rf."userId" = auth.uid()::text) AS favorite
  FROM "salesRfq" rfq
  LEFT JOIN "location" l
    ON l.id = rfq."locationId"
  LEFT JOIN "salesRfqToQuote" srtq
    ON srtq."salesRfqId" = rfq.id;


CREATE OR REPLACE VIEW "salesRfqLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    srl.*,
    mu.id as "modelId",
    mu."autodeskUrn",
    mu."modelPath",
    mu."thumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    i."name" as "itemName",
    i."defaultMethodType" AS "methodType",
    i."readableId" AS "itemReadableId",
    i."type" AS "itemType"
  FROM "salesRfqLine" srl
  LEFT JOIN "item" i ON i.id = srl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = srl."modelUploadId";
  
