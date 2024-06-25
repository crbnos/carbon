

CREATE TABLE "supplierPayment" (
  "supplierId" TEXT NOT NULL,
  "invoiceSupplierId" TEXT,
  "invoiceSupplierLocationId" TEXT,
  "invoiceSupplierContactId" TEXT,
  "paymentTermId" TEXT,
  "currencyCode" TEXT,
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,
  
  CONSTRAINT "supplierPayment_pkey" PRIMARY KEY ("supplierId"),
  CONSTRAINT "supplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "supplierPayment_invoiceSupplierId_fkey" FOREIGN KEY ("invoiceSupplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierPayment_invoiceSupplierLocationId_fkey" FOREIGN KEY ("invoiceSupplierLocationId") REFERENCES "supplierLocation"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierPayment_invoiceSupplierContactId_fkey" FOREIGN KEY ("invoiceSupplierContactId") REFERENCES "supplierContact"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "supplierPayment_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency"("code", "companyId") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierPayment_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "paymentTerm" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierPayment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "supplierPayment_supplierId_idx" ON "supplierPayment"("supplierId");

ALTER TABLE "supplierPayment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view supplier payment" ON "supplierPayment"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('purchasing_view', "companyId")
  );

CREATE POLICY "Employees with purchasing_update can update supplier payment" ON "supplierPayment"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('purchasing_update', "companyId")
  );


CREATE TABLE "supplierShipping" (
  "supplierId" TEXT NOT NULL,
  "shippingSupplierId" TEXT,
  "shippingSupplierLocationId" TEXT,
  "shippingSupplierContactId" TEXT,
  "shippingTermId" TEXT,
  "shippingMethodId" TEXT,
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "supplierShipping_pkey" PRIMARY KEY ("supplierId"),
  CONSTRAINT "supplierShipping_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "supplierShipping_shippingSupplierId_fkey" FOREIGN KEY ("shippingSupplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierShipping_shippingSupplierLocationId_fkey" FOREIGN KEY ("shippingSupplierLocationId") REFERENCES "supplierLocation"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierShipping_shippingSupplierContactId_fkey" FOREIGN KEY ("shippingSupplierContactId") REFERENCES "supplierContact"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierShipping_shippingTermId_fkey" FOREIGN KEY ("shippingTermId") REFERENCES "shippingTerm" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierShipping_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "supplierShipping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "supplierShipping_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

ALTER TABLE "supplierShipping" ENABLE ROW LEVEL SECURITY;

CREATE INDEX "supplierShipping_supplierId_idx" ON "supplierShipping"("supplierId");

CREATE POLICY "Employees with purchasing_view can view supplier shipping" ON "supplierShipping"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('purchasing_view', "companyId")
  );

CREATE POLICY "Employees with purchasing_update can update supplier shipping" ON "supplierShipping"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('purchasing_update', "companyId")
  );


CREATE FUNCTION public.create_supplier_entries()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."supplierPayment"("supplierId", "invoiceSupplierId", "companyId")
  VALUES (new.id, new.id, new."companyId");
  INSERT INTO public."supplierShipping"("supplierId", "shippingSupplierId", "companyId")
  VALUES (new.id, new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_supplier_entries
  AFTER INSERT on public.supplier
  FOR EACH ROW EXECUTE PROCEDURE public.create_supplier_entries();