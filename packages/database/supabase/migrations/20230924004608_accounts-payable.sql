CREATE TYPE "purchaseInvoiceStatus" AS ENUM (
  'Draft', 
  'Pending',
  'Submitted',
  'Return',
  'Debit Note Issued',
  'Paid', 
  'Partially Paid', 
  'Overdue',
  'Voided'
);

CREATE TABLE "purchaseInvoice" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "invoiceId" TEXT NOT NULL,
  "status" "purchaseInvoiceStatus" NOT NULL DEFAULT 'Draft',
  "supplierId" TEXT,
  "supplierReference" TEXT,
  "invoiceSupplierId" TEXT,
  "invoiceSupplierLocationId" TEXT,
  "invoiceSupplierContactId" TEXT,
  "paymentTermId" TEXT,
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC(10, 4) NOT NULL DEFAULT 1,
  "postingDate" DATE,
  "dateIssued" DATE,
  "dateDue" DATE,
  "datePaid" DATE,
  "subtotal" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "totalDiscount" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "totalAmount" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "totalTax" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "balance" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "purchaseInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id"),
  CONSTRAINT "purchaseInvoice_invoiceSupplierId_fkey" FOREIGN KEY ("invoiceSupplierId") REFERENCES "supplier" ("id"),
  CONSTRAINT "purchaseInvoice_invoiceSupplierLocationId_fkey" FOREIGN KEY ("invoiceSupplierLocationId") REFERENCES "supplierLocation" ("id"),
  CONSTRAINT "purchaseInvoice_invoiceSupplierContactId_fkey" FOREIGN KEY ("invoiceSupplierContactId") REFERENCES "supplierContact" ("id"),
  CONSTRAINT "purchaseInvoice_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "paymentTerm" ("id"),
  CONSTRAINT "purchaseInvoice_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency" ("code", "companyId"),
  CONSTRAINT "purchaseInvoice_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "purchaseInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "purchaseInvoice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id"),
  CONSTRAINT "purchaseInvoice_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id")
);

CREATE INDEX "purchaseInvoice_invoiceId_idx" ON "purchaseInvoice" ("invoiceId", "companyId");
CREATE INDEX "purchaseInvoice_status_idx" ON "purchaseInvoice" ("status", "companyId");
CREATE INDEX "purchaseInvoice_supplierId_idx" ON "purchaseInvoice" ("supplierId", "companyId");
CREATE INDEX "purchaseInvoice_companyId_idx" ON "purchaseInvoice" ("companyId");

ALTER publication supabase_realtime ADD TABLE "purchaseInvoice";

ALTER TABLE "purchaseInvoice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with invoicing_view can view AP invoices" ON "purchaseInvoice"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_view', "companyId")
  );

CREATE POLICY "Employees with invoicing_create can insert AP invoices" ON "purchaseInvoice"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('invoicing_create', "companyId")
);

CREATE POLICY "Employees with invoicing_update can update AP invoices" ON "purchaseInvoice"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_update', "companyId")
  );

CREATE POLICY "Employees with invoicing_delete can delete AP invoices" ON "purchaseInvoice"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_delete', "companyId")
  );



CREATE TABLE "purchaseInvoiceStatusHistory" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "invoiceId" TEXT NOT NULL,
  "status" "purchaseInvoiceStatus" NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  CONSTRAINT "purchaseInvoiceStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchaseInvoiceStatusHistory_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchaseInvoice" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

ALTER TABLE "purchaseInvoiceStatusHistory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with invoicing_view can view AP invoices status history" ON "purchaseInvoiceStatusHistory"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_view', get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice'))
  );


CREATE TYPE "payableLineType" AS ENUM (
  'Comment',
  'G/L Account',
  'Fixed Asset',
  'Part',
  'Material',
  'Tool',
  'Service',
  'Consumable',
  'Fixture'
);

CREATE TABLE "purchaseInvoiceLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "invoiceId" TEXT NOT NULL,
  "invoiceLineType" "payableLineType" NOT NULL,
  "purchaseOrderId" TEXT,
  "purchaseOrderLineId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "serviceId" TEXT,
  "locationId" TEXT,
  "shelfId" TEXT,
  "accountNumber" TEXT,
  "assetId" TEXT,
  "description" TEXT,
  "quantity" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "unitPrice" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "totalAmount" NUMERIC(10, 2) GENERATED ALWAYS AS ("quantity" * "unitPrice") STORED,
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC(10, 4) NOT NULL DEFAULT 1,
  "inventoryUnitOfMeasureCode" TEXT,
  "purchaseUnitOfMeasureCode" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "invoiceLineType_number"
    CHECK (
      (
        "invoiceLineType" = 'Comment' AND
        "itemId" IS NULL AND
        "accountNumber" IS NULL AND
        "assetId" IS NULL AND
        "description" IS NOT NULL
      ) 
      OR (
        "invoiceLineType" = 'G/L Account' AND
        "itemId" IS NULL AND
        "accountNumber" IS NOT NULL AND
        "assetId" IS NULL 
      ) 
      OR (
        (
          "invoiceLineType" = 'Part' OR
          "invoiceLineType" = 'Material' OR 
          "invoiceLineType" = 'Tool' OR 
          "invoiceLineType" = 'Consumable' OR 
          "invoiceLineType" = 'Fixture' OR 
          "invoiceLineType" = 'Service'
        ) AND
        "itemId" IS NOT NULL AND
        "accountNumber" IS NULL AND
        "assetId" IS NULL 
      ) 
      OR (
        "invoiceLineType" = 'Fixed Asset' AND
        "itemId" IS NULL AND
        "accountNumber" IS NULL AND
        "assetId" IS NOT NULL 
      ) 
    ),

  CONSTRAINT "purchaseInvoiceLines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchaseInvoiceLines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchaseInvoice" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "purchaseInvoiceLines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchaseInvoiceLines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchaseInvoiceLines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchaseInvoiceLines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchaseInvoiceLines_shelfId_fkey" FOREIGN KEY ("shelfId", "locationId") REFERENCES "shelf" ("id", "locationId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "purchaseInvoiceLines_accountNumber_fkey" FOREIGN KEY ("accountNumber", "companyId") REFERENCES "account" ("number", "companyId") ON UPDATE CASCADE ON DELETE RESTRICT,
  -- CONSTRAINT "purchaseInvoiceLines_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixedAsset" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchaseInvoiceLines_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency" ("code", "companyId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchaseInvoiceLines_inventoryUnitOfMeasureCode_fkey" FOREIGN KEY ("inventoryUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "purchaseInvoiceLines_purchaseUnitOfMeasureCode_fkey" FOREIGN KEY ("purchaseUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "purchaseInvoiceLines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchaseInvoiceLines_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchaseInvoiceLines_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX "purchaseInvoiceLine_invoiceId_idx" ON "purchaseInvoiceLine" ("invoiceId");

ALTER publication supabase_realtime ADD TABLE "purchaseInvoiceLine";

ALTER TABLE "purchaseInvoiceLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with invoicing_view can view AP invoice lines" ON "purchaseInvoiceLine"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_view', "companyId")
  );

CREATE POLICY "Employees with invoicing_create can insert AP invoice lines" ON "purchaseInvoiceLine"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('invoicing_create', "companyId")
);

CREATE POLICY "Employees with invoicing_update can update AP invoice lines" ON "purchaseInvoiceLine"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_update', "companyId")
  );

CREATE POLICY "Employees with invoicing_delete can delete AP invoice lines" ON "purchaseInvoiceLine"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_delete', "companyId")
  );

CREATE TABLE "purchaseInvoicePriceChange" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "invoiceId" TEXT NOT NULL,
  "invoiceLineId" TEXT NOT NULL,
  "previousPrice" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "newPrice" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "previousQuantity" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "newQuantity" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "updatedBy" TEXT NOT NULL,

  CONSTRAINT "purchaseInvoicePriceChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchaseInvoicePriceChange_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchaseInvoice" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "purchaseInvoicePriceChange_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "purchaseInvoiceLine" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "purchaseInvoicePriceChange_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

ALTER TABLE "purchaseInvoicePriceChange" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with invoicing_view can view AP invoice price changes" ON "purchaseInvoicePriceChange"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_view', get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice'))
  );

CREATE OR REPLACE FUNCTION "purchaseInvoiceLine_update_price_change"()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW."unitPrice" <> OLD."unitPrice" OR NEW."quantity" <> OLD."quantity" THEN
      INSERT INTO "purchaseInvoicePriceChange" (
        "invoiceId",
        "invoiceLineId",
        "previousPrice",
        "newPrice",
        "previousQuantity",
        "newQuantity",
        "updatedBy"
      ) VALUES (
        NEW."invoiceId",
        NEW."id",
        OLD."unitPrice",
        NEW."unitPrice",
        OLD."quantity",
        NEW."quantity",
        NEW."updatedBy"
      );
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER "purchaseInvoiceLine_update_price_change"
  AFTER UPDATE ON "purchaseInvoiceLine"
  FOR EACH ROW
  EXECUTE PROCEDURE "purchaseInvoiceLine_update_price_change"();

CREATE TABLE "purchasePayment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "paymentId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "paymentDate" DATE,
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC(10, 4) NOT NULL DEFAULT 1,
  "totalAmount" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "purchasePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchasePayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchasePayment_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency" ("code", "companyId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchasePayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "purchasePayment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchasePayment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX "purchasePayment_companyId_idx" ON "purchasePayment" ("companyId");

ALTER TABLE "purchasePayment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with invoicing_view can view AP payments" ON "purchasePayment"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_view', "companyId")
  );

CREATE POLICY "Employees with invoicing_create can insert AP payments" ON "purchasePayment"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('invoicing_create', "companyId")
);

CREATE POLICY "Employees with invoicing_update can update AP payments" ON "purchasePayment"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_update', "companyId")
  );

CREATE POLICY "Employees with invoicing_delete can delete AP payments" ON "purchasePayment"
  FOR DELETE
  USING (
    "paymentDate" IS NULL AND
    has_role('employee') AND
    has_company_permission('invoicing_delete', "companyId")
  );

CREATE TABLE "purchaseInvoicePaymentRelation" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,

  CONSTRAINT "purchasePayments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchasePayments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchaseInvoice" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchasePayments_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "purchasePayment" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

ALTER TABLE "purchaseInvoicePaymentRelation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with invoicing_view can view AP invoice/payment relations" ON "purchaseInvoicePaymentRelation"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('invoicing_view', get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice'))
  );


CREATE OR REPLACE VIEW "purchaseInvoices" AS 
  SELECT 
    pi."id",
    pi."invoiceId",
    pi."supplierId",
    pi."supplierReference",
    pi."invoiceSupplierId",
    pi."invoiceSupplierLocationId",
    pi."invoiceSupplierContactId",
    pi."postingDate",
    pi."dateIssued",
    pi."dateDue",
    pi."datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."subtotal",
    pi."totalDiscount",
    pi."totalAmount",
    pi."totalTax",
    pi."balance",
    pi."companyId",
    pi."createdBy",
    pi."createdAt",
    pi."updatedBy",
    pi."updatedAt",
    pi."customFields",
    CASE
      WHEN pi."dateDue" < CURRENT_DATE AND pi."status" = 'Submitted' THEN 'Overdue'
      ELSE pi."status"
    END AS status,
    s."name" AS "supplierName",
    c."fullName" AS "contactName",
    u."avatarUrl" AS "createdByAvatar",
    u."fullName" AS "createdByFullName",
    u2."avatarUrl" AS "updatedByAvatar",
    u2."fullName" AS "updatedByFullName"
  FROM "purchaseInvoice" pi
    LEFT JOIN "supplier" s ON s.id = pi."supplierId"
    LEFT JOIN "supplierContact" sc ON sc.id = pi."invoiceSupplierContactId"
    LEFT JOIN "contact" c ON c.id = sc."contactId"
    LEFT JOIN "user" u ON u."id" = pi."createdBy"
    LEFT JOIN "user" u2 ON u2."id" = pi."updatedBy";



ALTER VIEW "purchaseInvoices" SET (security_invoker = on);