
CREATE TABLE "customerPayment" (
  "customerId" TEXT NOT NULL,
  "invoiceCustomerId" TEXT,
  "invoiceCustomerLocationId" TEXT,
  "invoiceCustomerContactId" TEXT,
  "paymentTermId" TEXT,
  "currencyCode" TEXT,
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  
  CONSTRAINT "customerPayment_pkey" PRIMARY KEY ("customerId"),
  CONSTRAINT "customerPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "customerPayment_invoiceCustomerId_fkey" FOREIGN KEY ("invoiceCustomerId") REFERENCES "customer"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerPayment_invoiceCustomerLocationId_fkey" FOREIGN KEY ("invoiceCustomerLocationId") REFERENCES "customerLocation"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerPayment_invoiceCustomerContactId_fkey" FOREIGN KEY ("invoiceCustomerContactId") REFERENCES "customerContact"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerPayment_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "paymentTerm"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerPayment_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency"("code", "companyId") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "customerPayment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "customerPayment_customerId_idx" ON "customerPayment"("customerId");

ALTER TABLE "customerPayment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view customer payment" ON "customerPayment"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Employees with sales_update can update customer payment" ON "customerPayment"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE TABLE "customerShipping" (
  "customerId" TEXT NOT NULL,
  "shippingCustomerId" TEXT,
  "shippingCustomerLocationId" TEXT,
  "shippingCustomerContactId" TEXT,
  "shippingTermId" TEXT,
  "shippingMethodId" TEXT,
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "customerShipping_pkey" PRIMARY KEY ("customerId"),
  CONSTRAINT "customerShipping_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "customerShipping_shippingCustomerId_fkey" FOREIGN KEY ("shippingCustomerId") REFERENCES "customer"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerShipping_shippingCustomerLocationId_fkey" FOREIGN KEY ("shippingCustomerLocationId") REFERENCES "customerLocation"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerShipping_shippingCustomerContactId_fkey" FOREIGN KEY ("shippingCustomerContactId") REFERENCES "customerContact"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerShipping_shippingTermId_fkey" FOREIGN KEY ("shippingTermId") REFERENCES "shippingTerm" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerShipping_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "customerShipping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "customerShipping_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "customerShipping_customerId_idx" ON "customerShipping"("customerId");

ALTER TABLE "customerShipping" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view customer shipping" ON "customerShipping"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('purchasing_view', "companyId")
  );

CREATE POLICY "Employees with purchasing_update can update customer shipping" ON "customerShipping"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('purchasing_update', "companyId")
  );


CREATE FUNCTION public.create_customer_entries()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."customerPayment"("customerId", "invoiceCustomerId", "companyId")
  VALUES (new.id, new.id, new."companyId");
  INSERT INTO public."customerShipping"("customerId", "shippingCustomerId", "companyId")
  VALUES (new.id, new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_customer_entries
  AFTER INSERT on public.customer
  FOR EACH ROW EXECUTE PROCEDURE public.create_customer_entries();