ALTER TABLE "salesOrderLine"
  ADD COLUMN IF NOT EXISTS "portalLateReason" TEXT,
  ADD COLUMN IF NOT EXISTS "portalDeliveryUpdate" TEXT;

CREATE TABLE IF NOT EXISTS "customerPortalDocument" (
  "id" TEXT NOT NULL DEFAULT id('cpd'),
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "salesOrderId" TEXT,
  "shipmentId" TEXT,
  "documentType" TEXT NOT NULL,
  "documentPath" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMPTZ,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId") ON DELETE CASCADE,
  FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id") ON DELETE CASCADE,
  FOREIGN KEY ("shipmentId") REFERENCES "shipment"("id") ON DELETE CASCADE,
  CONSTRAINT "customerPortalDocument_documentType_check"
    CHECK ("documentType" IN ('CoC', 'Test Report')),
  CONSTRAINT "customerPortalDocument_source_check"
    CHECK (("salesOrderId" IS NOT NULL) <> ("shipmentId" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "customerPortalDocument_companyId_idx"
  ON "customerPortalDocument" ("companyId");
CREATE INDEX IF NOT EXISTS "customerPortalDocument_customerId_idx"
  ON "customerPortalDocument" ("customerId", "companyId");
CREATE INDEX IF NOT EXISTS "customerPortalDocument_salesOrderId_idx"
  ON "customerPortalDocument" ("salesOrderId", "companyId");
CREATE INDEX IF NOT EXISTS "customerPortalDocument_shipmentId_idx"
  ON "customerPortalDocument" ("shipmentId", "companyId");
CREATE INDEX IF NOT EXISTS "customerPortalDocument_createdBy_idx"
  ON "customerPortalDocument" ("createdBy");
CREATE INDEX IF NOT EXISTS "customerPortalDocument_updatedBy_idx"
  ON "customerPortalDocument" ("updatedBy");
ALTER TABLE "customerPortalDocument" ENABLE ROW LEVEL SECURITY;
