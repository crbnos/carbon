CREATE TYPE "salesRfqStatus" AS ENUM (
  'Draft',
  'Ready for Quote',
  'Closed'
);

CREATE TABLE "salesRfq" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "rfqId" TEXT NOT NULL,
  "revisionId" INTEGER NOT NULL DEFAULT 0,
  "status" "salesRfqStatus" NOT NULL DEFAULT 'Draft',
  "employeeId" TEXT,
  "customerId" TEXT NOT NULL,
  "customerContactId" TEXT,
  "customerReference" TEXT,
  "rfqDate" DATE NOT NULL,
  "expirationDate" DATE,
  "internalNotes" TEXT,
  "externalNotes" TEXT,
  "locationId" TEXT,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedBy" TEXT,

  CONSTRAINT "salesRfq_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesRfq_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user" ("id") ON DELETE SET NULL,
  CONSTRAINT "salesRfq_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL,
  CONSTRAINT "salesRfq_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "customerContact" ("id") ON DELETE SET NULL,
  CONSTRAINT "salesRfq_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL,
  CONSTRAINT "salesRfq_assigneeId_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesRfq_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesRfq_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesRfq_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesRfq_rfqId_key" UNIQUE ("rfqId")
);

CREATE INDEX "salesRfq_companyId_idx" ON "salesRfq" ("companyId");
CREATE INDEX "salesRfq_rfqId_idx" ON "salesRfq" ("rfqId");
CREATE INDEX "salesRfq_customerId_idx" ON "salesRfq" ("customerId", "companyId");
CREATE INDEX "salesRfq_status_idx" ON "salesRfq" ("status", "companyId");

CREATE TABLE "salesRfqLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "salesRfqId" TEXT NOT NULL,
  "customerPartNumber" TEXT NOT NULL,
  "customerRevisionId" TEXT,
  "itemId" TEXT,
  "description" TEXT,
  "quantity" NUMERIC(20, 2)[] DEFAULT ARRAY[]::NUMERIC(20, 2)[],
  "unitOfMeasureCode" TEXT NOT NULL,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "salesRfqLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesRfqLine_salesRfqId_fkey" FOREIGN KEY ("salesRfqId") REFERENCES "salesRfq" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesRfqLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "salesRfqLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesRfqLine_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "salesRfqLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesRfqLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesRfqLine_quantity_check" CHECK (array_length("quantity", 1) > 0)
);

CREATE INDEX "salesRfqLine_salesRfqId_idx" ON "salesRfqLine" ("salesRfqId");
CREATE INDEX "salesRfqLine_partNumber_idx" ON "salesRfqLine" ("customerPartNumber", "companyId");

ALTER TABLE "modelUpload" ADD COLUMN "salesRfqLineId" TEXT;
ALTER TABLE "modelUpload" ADD CONSTRAINT "modelUpload_salesRfqLineId_fkey" FOREIGN KEY ("salesRfqLineId") REFERENCES "salesRfqLine" ("id") ON DELETE SET NULL;

CREATE TABLE "salesRfqFavorite" (
  "rfqId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "salesRfqFavorites_pkey" PRIMARY KEY ("rfqId", "userId"),
  CONSTRAINT "salesRfqFavorites_salesRfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "salesRfq"("id") ON DELETE CASCADE,
  CONSTRAINT "salesRfqFavorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "salesRfqFavorites_userId_idx" ON "salesRfqFavorite" ("userId");
CREATE INDEX "salesRfqFavorites_salesRfqId_idx" ON "salesRfqFavorite" ("rfqId");

ALTER TABLE "salesRfqFavorite" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own salesRfq favorites" ON "salesRfqFavorite" 
  FOR SELECT USING (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can create their own salesRfq favorites" ON "salesRfqFavorite" 
  FOR INSERT WITH CHECK (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can delete their own salesRfq favorites" ON "salesRfqFavorite"
  FOR DELETE USING (
    auth.uid()::text = "userId"
  ); 

CREATE OR REPLACE VIEW "salesRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  rfq.*,
  l."name" AS "locationName",
  EXISTS(SELECT 1 FROM "salesRfqFavorite" rf WHERE rf."rfqId" = rfq.id AND rf."userId" = auth.uid()::text) AS favorite
  FROM "salesRfq" rfq
  LEFT JOIN "location" l
    ON l.id = rfq."locationId";


ALTER TABLE "sequence" DROP CONSTRAINT "sequence_pkey";
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_pkey" PRIMARY KEY ("table", "companyId");

-- salesRfq sequence for existing companies
INSERT INTO "sequence" (
  "table", 
  "name", 
  "prefix", 
  "suffix", 
  "next", 
  "size", 
  "step", 
  "companyId"
) 
SELECT 
  'salesRfq',
  'RFQ (Sales)',
  'RFQ',
  null,
  0,
  6,
  1,
  id
FROM "company" 
ON CONFLICT DO NOTHING;
