-- Match the portal's customer history and staff review queries, and make
-- repeated submission keys reject a different request body.

DROP INDEX IF EXISTS "customerPortalSubmission_companyId_idx";
DROP INDEX IF EXISTS "customerPortalSubmission_customerId_idx";
CREATE INDEX "customerPortalSubmission_customer_history_idx"
  ON "customerPortalSubmission"
  ("companyId", "customerId", "submissionType", "createdAt" DESC, "id");
CREATE INDEX "customerPortalSubmission_pending_po_idx"
  ON "customerPortalSubmission" ("companyId", "createdAt", "id")
  WHERE "submissionType" = 'PO' AND "status" = 'Pending';

ALTER TABLE "customerPortalDocument"
  ADD CONSTRAINT "customerPortalDocument_release_key"
    UNIQUE ("companyId", "customerId", "documentPath", "documentType");
DROP INDEX IF EXISTS "customerPortalDocument_companyId_idx";
DROP INDEX IF EXISTS "customerPortalDocument_customerId_idx";
CREATE INDEX "customerPortalDocument_customer_history_idx"
  ON "customerPortalDocument" ("companyId", "customerId", "createdAt" DESC);
