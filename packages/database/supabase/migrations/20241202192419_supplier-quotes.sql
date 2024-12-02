CREATE TYPE "supplierQuoteStatus" AS ENUM (
  'Draft',
  'Submitted', 
  'Accepted',
  'Rejected'
);

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('supplierQuote', 'Supplier Quote', 'Purchasing');


ALTER TYPE "externalLinkDocumentType" ADD VALUE 'SupplierQuote';
ALTER TABLE "externalLink" ADD COLUMN "supplierId" TEXT REFERENCES "supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('supplierQuoteLine', 'Supplier Quote Line', 'Purchasing');

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 
  'supplierQuote',
  'Supplier Quote',
  'SQ',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";


CREATE TABLE "supplierQuote" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "supplierQuoteId" TEXT NOT NULL,
  "revisionId" INTEGER NOT NULL DEFAULT 0,
  "dueDate" DATE,
  "expirationDate" DATE,
  "status" "supplierQuoteStatus" NOT NULL DEFAULT 'Draft',
  "internalNotes" JSON DEFAULT '{}'::json,
  "externalNotes" JSON DEFAULT '{}'::json,
  "supplierId" TEXT NOT NULL,
  "supplierLocationId" TEXT,
  "supplierContactId" TEXT,
  "supplierReference" TEXT,
  "assignee" TEXT,
  "externalLinkId" UUID,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC(10,4),
  "exchangeRateUpdatedAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "tags" TEXT[],
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "supplierQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplierQuote_quoteId_key" UNIQUE ("supplierQuoteId", "companyId"),
  CONSTRAINT "supplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierQuote_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "supplierLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuote_supplierContactId_fkey" FOREIGN KEY ("supplierContactId") REFERENCES "supplierContact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuote_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "supplierQuote_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "supplierQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuote_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "supplierQuote_supplierId_idx" ON "supplierQuote" ("supplierId");


CREATE TABLE "supplierQuoteLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "supplierQuoteId" TEXT NOT NULL,
  "supplierQuoteRevisionId" INTEGER NOT NULL DEFAULT 0,
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT,
  "description" TEXT NOT NULL,
  "supplierPartId" TEXT,
  "supplierPartRevision" TEXT,
  "inventoryUnitOfMeasureCode" TEXT,
  "purchaseUnitOfMeasureCode" TEXT,
  "conversionFactor" NUMERIC(10,5) NOT NULL DEFAULT 1,
  "notes" JSON DEFAULT '{}'::json,
  "taxPercent" NUMERIC(10,5) NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,
  "tags" TEXT[],

  CONSTRAINT "supplierQuoteLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplierQuoteLine_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "supplierQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLine_inventoryUnitOfMeasureCode_fkey" FOREIGN KEY ("inventoryUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLine_purchaseUnitOfMeasureCode_fkey" FOREIGN KEY ("purchaseUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "supplierQuoteLine_supplierQuoteId_idx" ON "supplierQuoteLine" ("supplierQuoteId");

CREATE TABLE "supplierQuoteLinePrice" (
  "supplierQuoteId" TEXT NOT NULL,
  "supplierQuoteLineId" TEXT NOT NULL,
  "quantity" NUMERIC(10,5) NOT NULL DEFAULT 1,
  "leadTime" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "discountPercent" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "unitPrice" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "exchangeRate" NUMERIC(10,4) DEFAULT 1,
  "convertedUnitPrice" NUMERIC(10,5) GENERATED ALWAYS AS ("unitPrice" * "exchangeRate") STORED,
  "netUnitPrice" NUMERIC(10,5) GENERATED ALWAYS AS ("unitPrice" * (1 - "discountPercent")) STORED,
  "convertedNetUnitPrice" NUMERIC(10,5) GENERATED ALWAYS AS ("unitPrice" * "exchangeRate" * (1 - "discountPercent")) STORED,
  "netExtendedPrice" NUMERIC(10,5) GENERATED ALWAYS AS ("unitPrice" * (1 - "discountPercent") * "quantity") STORED,
  "convertedNetExtendedPrice" NUMERIC(10,5) GENERATED ALWAYS AS ("unitPrice" * "exchangeRate" * (1 - "discountPercent") * "quantity") STORED,
  "shippingCost" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "convertedShippingCost" NUMERIC(10,5) GENERATED ALWAYS AS ("shippingCost" * "exchangeRate") STORED,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "supplierQuoteLinePrice_pkey" PRIMARY KEY ("supplierQuoteLineId", "quantity"),
  CONSTRAINT "supplierQuoteLinePrice_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "supplierQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLinePrice_supplierQuoteLineId_fkey" FOREIGN KEY ("supplierQuoteLineId") REFERENCES "supplierQuoteLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLinePrice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierQuoteLinePrice_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "supplierQuoteLinePrice_supplierQuoteId_idx" ON "supplierQuoteLinePrice" ("supplierQuoteId");

