-- A force delete is claimed before its approval voids the document: the
-- void commits in its own posting, so a cancel or reject that ran meanwhile
-- would leave the document voided under a request nobody approved. While a
-- request is Approving, cancel and reject refuse it, and no second request
-- for the same record can open. `decidedBy` / `decidedAt` name the Admin who
-- claimed it; a claim left by a failed approval goes back to Pending.

ALTER TYPE "purchaseOrderForceDeleteStatus" ADD VALUE IF NOT EXISTS 'Approving' AFTER 'Pending';
COMMIT;

DROP INDEX IF EXISTS "purchaseOrderForceDeleteRequest_pending_key";
CREATE UNIQUE INDEX "purchaseOrderForceDeleteRequest_pending_key"
  ON "purchaseOrderForceDeleteRequest" ("purchaseOrderId")
  WHERE "status" IN ('Pending', 'Approving');

DROP INDEX IF EXISTS "forceDeleteRequest_pending_key";
CREATE UNIQUE INDEX "forceDeleteRequest_pending_key"
  ON "forceDeleteRequest" ("companyId", "documentType", "documentId")
  WHERE "status" IN ('Pending', 'Approving');
