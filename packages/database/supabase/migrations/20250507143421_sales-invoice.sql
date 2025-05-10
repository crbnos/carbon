CREATE TYPE "salesInvoiceStatus" AS ENUM (
  'Draft', 
  'Pending',
  'Submitted',
  'Return',
  'Credit Note Issued',
  'Paid', 
  'Partially Paid', 
  'Overdue',
  'Voided'
);


INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('salesInvoice', 'Sales Invoice', 'Sales');

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('salesInvoiceLine', 'Sales Invoice Line', 'Sales');

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('salesInvoiceShipment', 'Sales Invoice Shipment', 'Sales');



CREATE TABLE "salesInvoice" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "invoiceId" TEXT NOT NULL,
  "status" "salesInvoiceStatus" NOT NULL DEFAULT 'Draft',
  "customerId" TEXT NOT NULL,
  "customerReference" TEXT,
  "invoiceCustomerId" TEXT,
  "invoiceCustomerLocationId" TEXT,
  "invoiceCustomerContactId" TEXT,
  "paymentTermId" TEXT,
  "postingDate" DATE,
  "dateIssued" DATE,
  "dateDue" DATE,
  "datePaid" DATE,
  "locationId" TEXT,
  "currencyCode" TEXT NOT NULL,
  "subtotal" NUMERIC NOT NULL DEFAULT 0,
  "totalDiscount" NUMERIC NOT NULL DEFAULT 0,
  "totalAmount" NUMERIC NOT NULL DEFAULT 0,
  "totalTax" NUMERIC NOT NULL DEFAULT 0,
  "balance" NUMERIC NOT NULL DEFAULT 0,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "exchangeRateUpdatedAt" TIMESTAMP WITH TIME ZONE,
  "opportunityId" TEXT,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB NOT NULL DEFAULT '{}',
  "internalNotes" JSON NOT NULL DEFAULT '{}',
  "externalNotes" JSON NOT NULL DEFAULT '{}',
  "tags" TEXT[],
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "salesInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesInvoice_invoiceId_key" UNIQUE ("invoiceId", "companyId"),
  CONSTRAINT "salesInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_invoiceCustomerId_fkey" FOREIGN KEY ("invoiceCustomerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_invoiceCustomerLocationId_fkey" FOREIGN KEY ("invoiceCustomerLocationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_invoiceCustomerContactId_fkey" FOREIGN KEY ("invoiceCustomerContactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "paymentTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "salesInvoice_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "salesInvoice_companyId_idx" ON "salesInvoice" ("companyId");
CREATE INDEX "salesInvoice_customerId_idx" ON "salesInvoice" ("customerId");

CREATE TYPE "salesInvoiceLineType" AS ENUM (
  'Comment',
  'Part',
  'Material',
  'Tool',
  'Service',
  'Consumable',
  'Fixture',
  'Fixed Asset'
);

CREATE TABLE "salesInvoiceLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "invoiceId" TEXT NOT NULL,
  "invoiceLineType" "salesInvoiceLineType" NOT NULL,
  "description" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "accountNumber" TEXT,
  "assetId" TEXT,
  "quantity" NUMERIC NOT NULL DEFAULT 0,
  "unitOfMeasureCode" TEXT NOT NULL,
  "locationId" TEXT,
  "shelfId" TEXT,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "unitPrice" NUMERIC NOT NULL DEFAULT 0,
  "setupPrice" NUMERIC NOT NULL DEFAULT 0,
  "addOnCost" NUMERIC NOT NULL DEFAULT 0,
  "shippingCost" NUMERIC NOT NULL DEFAULT 0,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  "convertedUnitPrice" NUMERIC GENERATED ALWAYS AS ("unitPrice" * "exchangeRate") STORED,
  "convertedAddOnCost" NUMERIC GENERATED ALWAYS AS ("addOnCost" * "exchangeRate") STORED,
  "convertedShippingCost" NUMERIC GENERATED ALWAYS AS ("shippingCost" * "exchangeRate") STORED,
  "convertedSetupPrice" NUMERIC GENERATED ALWAYS AS ("setupPrice" * "exchangeRate") STORED,
  "externalNotes" JSON NOT NULL DEFAULT '{}',
  "internalNotes" JSON NOT NULL DEFAULT '{}',
  "modelUploadId" TEXT,
  "opportunityId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "customFields" JSONB NOT NULL DEFAULT '{}',
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "salesInvoiceLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "salesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_accountNumber_fkey" FOREIGN KEY ("accountNumber", "companyId") REFERENCES "account"("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_modelUploadId_fkey" FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "salesInvoiceLine_companyId_idx" ON "salesInvoiceLine" ("companyId");
CREATE INDEX "salesInvoiceLine_invoiceId_idx" ON "salesInvoiceLine" ("invoiceId");
CREATE INDEX "salesInvoiceLine_itemId_idx" ON "salesInvoiceLine" ("itemId");
CREATE INDEX "salesInvoiceLine_locationId_idx" ON "salesInvoiceLine" ("locationId");

DROP VIEW IF EXISTS "salesInvoices";
CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  SELECT
    si.*,
    sil."thumbnailPath",
    sil."itemType", 
    sil."invoiceTotal" + COALESCE(sil."shippingCost", 0) AS "invoiceTotal",
    sil."lines"
  FROM "salesInvoice" si
  LEFT JOIN (
    SELECT 
      sil."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        DISTINCT (1+COALESCE(sil."taxPercent", 0))*(COALESCE(sil."quantity", 0)*(COALESCE(sil."unitPrice", 0)) + COALESCE(sil."shippingCost", 0) + COALESCE(sil."addOnCost", 0))
      ) AS "invoiceTotal",
      SUM(COALESCE(sil."shippingCost", 0)) AS "shippingCost",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        json_build_object(
          'id', sil.id,
          'invoiceLineType', sil."invoiceLineType",
          'quantity', sil."quantity",
          'unitPrice', sil."unitPrice",
          'itemId', sil."itemId",
          'itemReadableId', sil."itemReadableId"
        )
      ) AS "lines"
    FROM "salesInvoiceLine" sil
    LEFT JOIN "item" i
      ON i."id" = sil."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY sil."invoiceId"
  ) sil ON sil."invoiceId" = si."id";


CREATE TABLE "salesInvoiceShipment" (
  "id" TEXT NOT NULL,
  "shippingCost" NUMERIC NOT NULL DEFAULT 0,
  "locationId" TEXT,
  "shippingMethodId" TEXT,
  "shippingTermId" TEXT,
  "customFields" JSONB NOT NULL DEFAULT '{}',
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "salesInvoiceShipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesInvoiceShipment_id_fkey" FOREIGN KEY ("id") REFERENCES "salesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceShipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceShipment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "salesInvoiceShipment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "salesInvoiceShipment_companyId_idx" ON "salesInvoiceShipment" ("companyId");


DROP VIEW IF EXISTS "salesInvoiceLines";
CREATE OR REPLACE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    (SELECT cp."customerPartId" 
     FROM "customerPartToItem" cp 
     WHERE cp."customerId" = si."customerId" AND cp."itemId" = i.id 
     LIMIT 1) as "customerPartId"
  FROM "salesInvoiceLine" sl
  INNER JOIN "salesInvoice" si ON si.id = sl."invoiceId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);
