CREATE TABLE "supplierInteraction" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "purchaseOrderId" TEXT,
  "purchaseOrderCompletedDate" TIMESTAMP WITH TIME ZONE,
  "supplierQuoteId" TEXT,
  "supplierQuoteCompletedDate" TIMESTAMP WITH TIME ZONE,
  "quoteDocumentPath" TEXT,
  "salesOrderDocumentPath" TEXT,
  "companyId" TEXT NOT NULL,

  PRIMARY KEY ("id"),
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("supplierQuoteId") REFERENCES "supplierQuote" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE
);