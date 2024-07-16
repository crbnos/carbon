CREATE TABLE "quoteLinePrice" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quoteId" TEXT NOT NULL,
  "quoteLineId" TEXT NOT NULL,
  "quantity" NUMERIC(10,5) NOT NULL DEFAULT 1,
  "unitCost" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "leadTime" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "discountPercent" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "markupPercent" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "extendedPrice" NUMERIC(10,5) NOT NULL DEFAULT 0,  
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "quoteLinePrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteLinePrice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteLinePrice_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "quoteLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteLinePrice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteLinePrice_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "quoteLinePrice_quoteId_idx" ON "quoteLinePrice" ("quoteId");

CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    qlp."quantity" AS "pricingQuantity",
    qlp."unitCost" AS "pricingUnitCost",
    qlp."leadTime" AS "pricingLeadTime",
    qlp."discountPercent" AS "pricingDiscountPercent",
    qlp."markupPercent" AS "pricingMarkupPercent",
    qlp."extendedPrice" AS "pricingExtendedPrice"
  FROM "quoteLine" ql
  LEFT JOIN "quoteLinePrice" qlp ON ql."id" = qlp."quoteLineId"
);

ALTER TABLE "quoteLinePrice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view quote line pricing" ON "quoteLinePrice"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_view', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_create can insert quote line pricing" ON "quoteLinePrice"
  FOR INSERT
  WITH CHECK (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_create', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_update can update quote line pricing" ON "quoteLinePrice"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_update', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_delete can delete quote line pricing" ON "quoteLinePrice"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_delete', get_company_id_from_foreign_key("quoteId", 'quote'))
  );


