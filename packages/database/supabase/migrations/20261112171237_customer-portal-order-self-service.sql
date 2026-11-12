ALTER TABLE "salesOrderLine"
  ADD COLUMN IF NOT EXISTS "portalLateReason" TEXT,
  ADD COLUMN IF NOT EXISTS "portalDeliveryUpdate" TEXT;

CREATE TABLE IF NOT EXISTS "customerPortalSubmission" (
  "id" TEXT NOT NULL DEFAULT id('cps'),
  "companyId" TEXT NOT NULL,
  "portalId" UUID NOT NULL,
  "customerId" TEXT NOT NULL,
  "submissionType" TEXT NOT NULL,
  "salesRfqId" TEXT,
  "quoteId" TEXT,
  "salesOrderId" TEXT,
  "poNumber" TEXT,
  "requestedDelivery" DATE,
  "lines" JSONB NOT NULL DEFAULT '[]',
  "documentPaths" JSONB NOT NULL DEFAULT '[]',
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMPTZ,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId"),
  FOREIGN KEY ("salesRfqId") REFERENCES "salesRfq"("id"),
  FOREIGN KEY ("quoteId") REFERENCES "quote"("id"),
  FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id"),
  FOREIGN KEY ("portalId") REFERENCES "externalLink"("id"),
  CONSTRAINT "customerPortalSubmission_submissionType_check"
    CHECK ("submissionType" IN ('RFQ', 'PO')),
  CONSTRAINT "customerPortalSubmission_status_check"
    CHECK ("status" IN ('Pending', 'Accepted', 'Rejected')),
  CONSTRAINT "customerPortalSubmission_requestFingerprint_check"
    CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "customerPortalSubmission_companyId_portalId_idempotencyKey_key"
    UNIQUE ("companyId", "portalId", "idempotencyKey")
);
CREATE INDEX IF NOT EXISTS "customerPortalSubmission_companyId_idx"
  ON "customerPortalSubmission" ("companyId");
CREATE INDEX IF NOT EXISTS "customerPortalSubmission_customerId_idx"
  ON "customerPortalSubmission" ("customerId", "companyId");
CREATE INDEX IF NOT EXISTS "customerPortalSubmission_quoteId_idx"
  ON "customerPortalSubmission" ("quoteId", "companyId");
CREATE INDEX IF NOT EXISTS "customerPortalSubmission_salesRfqId_idx"
  ON "customerPortalSubmission" ("salesRfqId", "companyId");
CREATE INDEX IF NOT EXISTS "customerPortalSubmission_salesOrderId_idx"
  ON "customerPortalSubmission" ("salesOrderId", "companyId");
CREATE INDEX IF NOT EXISTS "customerPortalSubmission_portalId_idx"
  ON "customerPortalSubmission" ("portalId");
CREATE INDEX IF NOT EXISTS "customerPortalSubmission_createdBy_idx"
  ON "customerPortalSubmission" ("createdBy");
CREATE INDEX IF NOT EXISTS "customerPortalSubmission_updatedBy_idx"
  ON "customerPortalSubmission" ("updatedBy");
ALTER TABLE "customerPortalSubmission" ENABLE ROW LEVEL SECURITY;

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
  FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId"),
  FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id"),
  FOREIGN KEY ("shipmentId") REFERENCES "shipment"("id"),
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
