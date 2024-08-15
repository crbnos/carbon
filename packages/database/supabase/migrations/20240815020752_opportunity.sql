DROP VIEW "salesRfqs";
DROP VIEW "quotes";
DROP TABLE "salesRfqToQuote";

COMMIT;

ALTER TABLE "quote" 
  DROP CONSTRAINT "quote_salesRfqId_fkey",
  DROP COLUMN "salesRfqId";

CREATE TABLE "opportunity" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "salesRfqId" TEXT,
  "quoteId" TEXT,
  "salesOrderId" TEXT,
  "companyId" TEXT NOT NULL,

  PRIMARY KEY ("id"),
  FOREIGN KEY ("salesRfqId") REFERENCES "salesRfq" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("quoteId") REFERENCES "quote" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE
);

CREATE INDEX "opportunity_companyId_idx" ON "opportunity" ("companyId");
CREATE INDEX "opportunity_salesRfqId_idx" ON "opportunity" ("salesRfqId");
CREATE INDEX "opportunity_quoteId_idx" ON "opportunity" ("quoteId");

ALTER TABLE "opportunity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view opportunities" ON "opportunity" FOR SELECT USING (
  has_company_permission('sales_view', "companyId")  AND 
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_create can insert opportunities" ON "opportunity" FOR INSERT WITH CHECK (
  has_company_permission('sales_view', "companyId") AND
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_create can update opportunities" ON "opportunity" FOR UPDATE WITH CHECK (
  has_company_permission('sales_view', "companyId") AND
  has_role('employee', "companyId")
);

CREATE OR REPLACE VIEW "salesRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  rfq.*,
  l."name" AS "locationName",
  opp."quoteId",
  opp."salesOrderId",
  EXISTS(SELECT 1 FROM "salesRfqFavorite" rf WHERE rf."rfqId" = rfq.id AND rf."userId" = auth.uid()::text) AS favorite
  FROM "salesRfq" rfq
  LEFT JOIN "location" l
    ON l.id = rfq."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."salesRfqId" = rfq.id;

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
      COUNT("id") AS "lines",
      COUNT("id") FILTER (WHERE "status" = 'Complete') AS "completedLines"
    FROM "quoteLine"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "location" l
    ON l.id = q."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."quoteId" = q.id;

CREATE POLICY "Employees with settings_update can insert company integrations." ON "companyIntegration"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND 
    has_company_permission('settings_update', "companyId")
  );

UPDATE "integration" SET jsonschema = '{"type": "object","properties": {"apiKey": {"type": "string"}, "fromEmail": {"type": "string"}}, "required": ["apiKey"]}'::json WHERE id = 'resend';

ALTER TABLE "integration" ENABLE ROW LEVEL SECURITY;

