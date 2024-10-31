ALTER TABLE "company" ADD COLUMN "digitalQuoteEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "company" SET "digitalQuoteEnabled" = TRUE;

CREATE TYPE "externalLinkDocumentType" AS ENUM ('Quote');

CREATE TABLE "externalLink" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "documentType" "externalLinkDocumentType" NOT NULL,
  "documentId" TEXT NOT NULL,
  "customerId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,
  CONSTRAINT "externalLinks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "externalLinks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id"),
  CONSTRAINT "externalLinks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id")
);

ALTER TABLE "externalLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view sales-related external links" ON "externalLink"
  FOR SELECT
  USING (
    "documentType" = 'Quote' AND
    has_role('employee', "companyId") AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Employees with sales_create can insert sales-related external links" ON "externalLink"
  FOR INSERT
  WITH CHECK (
    "documentType" = 'Quote' AND
    has_role('employee', "companyId") AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Employees with sales_update can update sales-related external links" ON "externalLink"
  FOR UPDATE
  USING (
    "documentType" = 'Quote' AND
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete sales-related external links" ON "externalLink"
  FOR DELETE
  USING (
    "documentType" = 'Quote' AND
    has_role('employee', "companyId") AND
    has_company_permission('sales_delete', "companyId")
  );

CREATE TABLE "externalLinkMessage" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "externalLinkId" uuid NOT NULL,
  "message" TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "companyId" TEXT NOT NULL,
  CONSTRAINT "externalLinkMessages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "externalLinkMessages_externalLinkId_fkey" FOREIGN KEY ("externalLinkId") REFERENCES "externalLink"("id"),
  CONSTRAINT "externalLinkMessages_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "externalLinkMessages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id")
);

ALTER TABLE "externalLinkMessage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view external link messages" ON "externalLinkMessage"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees can insert external link messages" ON "externalLinkMessage"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees can delete external link messages" ON "externalLinkMessage"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
  );

ALTER TABLE "quote" ADD COLUMN "externalLinkId" uuid REFERENCES "externalLink"("id") ON DELETE SET NULL;
DROP VIEW IF EXISTS "quotes";
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