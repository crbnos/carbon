-- Scrap becomes an approval document type: an approval rule can require that
-- scrap logged on the shop floor is signed off by an approver before it posts.
-- The approver signs on the tablet, so a request is written already Approved;
-- `scrapRequest` is the document it names (what was scrapped, and its
-- estimated value). Approval logic lives in TypeScript (@carbon/ee).
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'scrap';
COMMIT;

CREATE TABLE IF NOT EXISTS "scrapRequest" (
  "id" TEXT NOT NULL DEFAULT id('scr'),
  "companyId" TEXT NOT NULL,
  -- A batch can span jobs, so its request names the batch and no job.
  "jobId" TEXT,
  "jobOperationId" TEXT,
  "jobOperationBatchId" TEXT,
  "jobMaterialId" TEXT,
  "trackedEntityId" TEXT,
  "itemId" TEXT,
  "scrapReasonId" TEXT,
  "quantity" NUMERIC NOT NULL,
  -- Material cost at itemCost.unitCost, the basis the scrap journal uses.
  "estimatedValue" NUMERIC NOT NULL DEFAULT 0,
  "notes" TEXT,
  -- Set once the scrap posted. Null means the approval was recorded and the
  -- posting never finished.
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "scrapRequest_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "scrapRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- SET NULL, not CASCADE: the record (and the approval request naming it)
  -- outlives a deleted job.
  CONSTRAINT "scrapRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "scrapRequest_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "scrapRequest_jobOperationBatchId_fkey" FOREIGN KEY ("jobOperationBatchId", "companyId") REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL ("jobOperationBatchId"),
  CONSTRAINT "scrapRequest_jobMaterialId_fkey" FOREIGN KEY ("jobMaterialId") REFERENCES "jobMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "scrapRequest_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "scrapRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "scrapRequest_scrapReasonId_fkey" FOREIGN KEY ("scrapReasonId") REFERENCES "scrapReason"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- No CHECK that one of the source columns is set: deleting a job sets every
  -- source column to NULL, and such a CHECK would refuse the delete.
  CONSTRAINT "scrapRequest_quantity_check" CHECK ("quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "scrapRequest_companyId_idx" ON "scrapRequest" ("companyId");
CREATE INDEX IF NOT EXISTS "scrapRequest_jobId_idx" ON "scrapRequest" ("jobId");
CREATE INDEX IF NOT EXISTS "scrapRequest_jobOperationId_idx" ON "scrapRequest" ("jobOperationId");
CREATE INDEX IF NOT EXISTS "scrapRequest_jobOperationBatchId_idx" ON "scrapRequest" ("jobOperationBatchId");
CREATE INDEX IF NOT EXISTS "scrapRequest_jobMaterialId_idx" ON "scrapRequest" ("jobMaterialId");
CREATE INDEX IF NOT EXISTS "scrapRequest_trackedEntityId_idx" ON "scrapRequest" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "scrapRequest_itemId_idx" ON "scrapRequest" ("itemId");
CREATE INDEX IF NOT EXISTS "scrapRequest_scrapReasonId_idx" ON "scrapRequest" ("scrapReasonId");
CREATE INDEX IF NOT EXISTS "scrapRequest_createdBy_idx" ON "scrapRequest" ("createdBy");
CREATE INDEX IF NOT EXISTS "scrapRequest_updatedBy_idx" ON "scrapRequest" ("updatedBy");

ALTER TABLE "scrapRequest" ENABLE ROW LEVEL SECURITY;

DROP VIEW IF EXISTS "approvalRequests";
CREATE OR REPLACE VIEW "approvalRequests" WITH (SECURITY_INVOKER=true) AS
SELECT
  ar."id",
  ar."documentType",
  ar."documentId",
  ar."status",
  ar."requestedBy",
  ar."requestedAt",
  ar."decisionBy",
  ar."decisionAt",
  ar."decisionNotes",
  ar."companyId",
  ar."createdAt",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN po."purchaseOrderId"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."name"
    WHEN ar."documentType" = 'supplier' THEN sup."name"
    WHEN ar."documentType" = 'changeOrder' THEN co."changeOrderId"
    WHEN ar."documentType" = 'scrap' THEN COALESCE(sj."jobId", sb."readableId")
    ELSE NULL
  END AS "documentReadableId",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN s."name"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."description"
    WHEN ar."documentType" = 'supplier' THEN NULL
    WHEN ar."documentType" = 'changeOrder' THEN co."name"
    WHEN ar."documentType" = 'scrap' THEN si."readableIdWithRevision"
    ELSE NULL
  END AS "documentDescription"
FROM "approvalRequest" ar
LEFT JOIN "purchaseOrder" po ON ar."documentType" = 'purchaseOrder' AND ar."documentId" = po."id"
LEFT JOIN "supplier" s ON po."supplierId" = s."id"
LEFT JOIN "qualityDocument" qd ON ar."documentType" = 'qualityDocument' AND ar."documentId" = qd."id"
LEFT JOIN "supplier" sup ON ar."documentType" = 'supplier' AND ar."documentId" = sup."id"
LEFT JOIN "changeOrder" co ON ar."documentType" = 'changeOrder' AND ar."documentId" = co."id" AND ar."companyId" = co."companyId"
LEFT JOIN "scrapRequest" sr ON ar."documentType" = 'scrap' AND ar."documentId" = sr."id" AND ar."companyId" = sr."companyId"
LEFT JOIN "job" sj ON sr."jobId" = sj."id"
LEFT JOIN "jobOperationBatch" sb ON sr."jobOperationBatchId" = sb."id" AND sr."companyId" = sb."companyId"
LEFT JOIN "item" si ON sr."itemId" = si."id";

-- What Production → Scrap Approvals lists: each scrap request with its job,
-- item, reason and the decision on it. `approvalRequest` has no API-role
-- policy, so a reader that needs the decision reads with the service role.
CREATE OR REPLACE VIEW "scrapRequests" WITH (SECURITY_INVOKER=true) AS
SELECT
  sr."id",
  sr."companyId",
  sr."jobId",
  j."jobId" AS "jobReadableId",
  sr."jobOperationId",
  jo."description" AS "operationDescription",
  sr."jobOperationBatchId",
  b."readableId" AS "batchReadableId",
  sr."jobMaterialId",
  sr."trackedEntityId",
  te."readableId" AS "trackedEntityReadableId",
  sr."itemId",
  i."readableIdWithRevision" AS "itemReadableId",
  i."name" AS "itemName",
  sr."scrapReasonId",
  r."name" AS "scrapReasonName",
  sr."quantity",
  sr."estimatedValue",
  sr."notes",
  sr."postedAt",
  sr."createdBy",
  sr."createdAt",
  ar."id" AS "approvalRequestId",
  ar."status" AS "approvalStatus",
  ar."decisionBy" AS "approvedBy",
  ar."decisionAt" AS "approvedAt"
FROM "scrapRequest" sr
LEFT JOIN "job" j ON sr."jobId" = j."id"
LEFT JOIN "jobOperation" jo ON sr."jobOperationId" = jo."id"
LEFT JOIN "jobOperationBatch" b ON sr."jobOperationBatchId" = b."id" AND sr."companyId" = b."companyId"
LEFT JOIN "trackedEntity" te ON sr."trackedEntityId" = te."id"
LEFT JOIN "item" i ON sr."itemId" = i."id"
LEFT JOIN "scrapReason" r ON sr."scrapReasonId" = r."id"
LEFT JOIN LATERAL (
  SELECT a."id", a."status", a."decisionBy", a."decisionAt"
  FROM "approvalRequest" a
  WHERE a."documentType" = 'scrap'
    AND a."documentId" = sr."id"
    AND a."companyId" = sr."companyId"
  ORDER BY a."requestedAt" DESC
  LIMIT 1
) ar ON TRUE;
