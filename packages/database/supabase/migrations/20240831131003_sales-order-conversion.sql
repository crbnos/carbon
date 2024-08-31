CREATE TABLE "quotePayment" (
  "id" TEXT NOT NULL,
  "invoiceCustomerId" TEXT,
  "invoiceCustomerLocationId" TEXT,
  "invoiceCustomerContactId" TEXT,
  "paymentTermId" TEXT,
  "currencyCode" TEXT NOT NULL DEFAULT 'USD',
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "quotePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotePayment_id_fkey" FOREIGN KEY ("id") REFERENCES "quote" ("id") ON DELETE CASCADE,
  CONSTRAINT "quotePayment_invoiceCustomerId_fkey" FOREIGN KEY ("invoiceCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE,
  CONSTRAINT "quotePayment_invoiceCustomerLocationId_fkey" FOREIGN KEY ("invoiceCustomerLocationId") REFERENCES "customerLocation" ("id") ON DELETE CASCADE,
  CONSTRAINT "quotePayment_invoiceCustomerContactId_fkey" FOREIGN KEY ("invoiceCustomerContactId") REFERENCES "customerContact" ("id") ON DELETE CASCADE,
  CONSTRAINT "quotePayment_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "paymentTerm" ("id") ON DELETE CASCADE,
  CONSTRAINT "quotePayment_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency" ("code", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quotePayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);


-- QuotePayment RLS
ALTER TABLE "quotePayment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view quote payments" ON "quotePayment"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Employees with sales_create can create quote payments" ON "quotePayment"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Employees with sales_update can update quote payments" ON "quotePayment"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete quote payments" ON "quotePayment"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_delete', "companyId")
  );

CREATE TABLE "quoteShipment" (
  "id" TEXT NOT NULL,
  "locationId" TEXT,
  "shippingMethodId" TEXT,
  "shippingTermId" TEXT,
  "receiptRequestedDate" DATE,
  "companyId" TEXT NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "quoteShipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteShipment_id_fkey" FOREIGN KEY ("id") REFERENCES "quote" ("id") ON DELETE CASCADE,
  CONSTRAINT "quoteShipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE CASCADE,
  CONSTRAINT "quoteShipment_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod" ("id") ON DELETE CASCADE,
  CONSTRAINT "quoteShipment_shippingTermId_fkey" FOREIGN KEY ("shippingTermId") REFERENCES "shippingTerm" ("id") ON DELETE CASCADE,
  CONSTRAINT "quoteShipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteShipment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);
-- QuoteShipment RLS
ALTER TABLE "quoteShipment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view quote shipments" ON "quoteShipment"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Employees with sales_create can create quote shipments" ON "quoteShipment"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Employees with sales_update can update quote shipments" ON "quoteShipment"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete quote shipments" ON "quoteShipment"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_delete', "companyId")
  );



-- Add locationId to salesOrder table and remove quoteId
ALTER TABLE "salesOrder"
  ADD COLUMN "addOnCost" NUMERIC(10,4),
  ADD COLUMN "locationId" TEXT;
  
ALTER TABLE "salesOrderLine"
  ADD COLUMN "promisedDate" DATE;

-- Add foreign key constraint for locationId
ALTER TABLE "salesOrder"
  ADD CONSTRAINT "salesOrder_locationId_fkey" 
  FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL;

