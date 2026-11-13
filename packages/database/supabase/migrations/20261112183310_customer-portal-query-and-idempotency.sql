ALTER TABLE "customerPortalDocument"
  ADD CONSTRAINT "customerPortalDocument_release_key"
    UNIQUE ("companyId", "customerId", "documentPath", "documentType");
DROP INDEX IF EXISTS "customerPortalDocument_companyId_idx";
DROP INDEX IF EXISTS "customerPortalDocument_customerId_idx";
CREATE INDEX "customerPortalDocument_customer_history_idx"
  ON "customerPortalDocument" ("companyId", "customerId", "createdAt" DESC);
