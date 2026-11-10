-- An Admin override for deleting a purchase order that the normal delete
-- refuses (a released order, or one in approval the caller did not request).
-- One Admin asks, with a reason; the order is deleted when another Admin
-- approves. The rules live in TypeScript (`requestPurchaseOrderForceDelete`
-- and `decidePurchaseOrderForceDelete`, purchasing.server.ts).
--
-- The request is the approval's document: an `approvalRequest` of type
-- 'purchaseOrderForceDelete' names it, so it shows with the other approvals.
-- Its approvers are the company's Admins other than the requester, not an
-- approval rule's groups (`canApproveRequest`, @carbon/ee). The request keeps
-- the order's number and status after the order is gone.

ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'purchaseOrderForceDelete';
COMMIT;

CREATE TYPE "purchaseOrderForceDeleteStatus" AS ENUM (
  'Pending',
  'Executed',
  'Rejected',
  'Cancelled'
);

CREATE TABLE "purchaseOrderForceDeleteRequest" (
  "id" TEXT NOT NULL DEFAULT id('pofd'),
  "companyId" TEXT NOT NULL,
  -- Nulled when the order is deleted; the readable id and status stay.
  "purchaseOrderId" TEXT,
  "purchaseOrderReadableId" TEXT NOT NULL,
  "purchaseOrderStatus" "purchaseOrderStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "purchaseOrderForceDeleteStatus" NOT NULL DEFAULT 'Pending',
  "requestedBy" TEXT NOT NULL,
  "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- Who approved (and so deleted the order), rejected or cancelled it.
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP WITH TIME ZONE,
  "decisionNotes" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderForceDeleteRequest_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder"("id") ON DELETE SET NULL,
  CONSTRAINT "purchaseOrderForceDeleteRequest_requestedBy_fkey"
    FOREIGN KEY ("requestedBy") REFERENCES "user"("id"),
  CONSTRAINT "purchaseOrderForceDeleteRequest_decidedBy_fkey"
    FOREIGN KEY ("decidedBy") REFERENCES "user"("id"),
  CONSTRAINT "purchaseOrderForceDeleteRequest_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "purchaseOrderForceDeleteRequest_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "purchaseOrderForceDeleteRequest_reason_check"
    CHECK (length(btrim("reason")) >= 10)
);

-- One open request per order.
CREATE UNIQUE INDEX "purchaseOrderForceDeleteRequest_pending_key"
  ON "purchaseOrderForceDeleteRequest" ("purchaseOrderId")
  WHERE "status" = 'Pending';
CREATE INDEX "purchaseOrderForceDeleteRequest_companyId_idx" ON "purchaseOrderForceDeleteRequest" ("companyId");
CREATE INDEX "purchaseOrderForceDeleteRequest_purchaseOrderId_idx" ON "purchaseOrderForceDeleteRequest" ("purchaseOrderId");
CREATE INDEX "purchaseOrderForceDeleteRequest_requestedBy_idx" ON "purchaseOrderForceDeleteRequest" ("requestedBy");
CREATE INDEX "purchaseOrderForceDeleteRequest_decidedBy_idx" ON "purchaseOrderForceDeleteRequest" ("decidedBy");
CREATE INDEX "purchaseOrderForceDeleteRequest_createdBy_idx" ON "purchaseOrderForceDeleteRequest" ("createdBy");
CREATE INDEX "purchaseOrderForceDeleteRequest_updatedBy_idx" ON "purchaseOrderForceDeleteRequest" ("updatedBy");

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
    WHEN ar."documentType" = 'projectChangeRequest' THEN pcr."readableId"
    WHEN ar."documentType" = 'purchaseOrderForceDelete' THEN pofd."purchaseOrderReadableId"
    ELSE NULL
  END AS "documentReadableId",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN s."name"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."description"
    WHEN ar."documentType" = 'supplier' THEN NULL
    WHEN ar."documentType" = 'changeOrder' THEN co."name"
    WHEN ar."documentType" = 'projectChangeRequest' THEN pcr."title"
    WHEN ar."documentType" = 'purchaseOrderForceDelete' THEN pofd."reason"
    ELSE NULL
  END AS "documentDescription"
FROM "approvalRequest" ar
LEFT JOIN "purchaseOrder" po ON ar."documentType" = 'purchaseOrder' AND ar."documentId" = po."id"
LEFT JOIN "supplier" s ON po."supplierId" = s."id"
LEFT JOIN "qualityDocument" qd ON ar."documentType" = 'qualityDocument' AND ar."documentId" = qd."id"
LEFT JOIN "supplier" sup ON ar."documentType" = 'supplier' AND ar."documentId" = sup."id"
LEFT JOIN "changeOrder" co ON ar."documentType" = 'changeOrder' AND ar."documentId" = co."id" AND ar."companyId" = co."companyId"
LEFT JOIN "projectChangeRequest" pcr ON ar."documentType" = 'projectChangeRequest' AND ar."documentId" = pcr."id" AND ar."companyId" = pcr."companyId"
LEFT JOIN "purchaseOrderForceDeleteRequest" pofd ON ar."documentType" = 'purchaseOrderForceDelete' AND ar."documentId" = pofd."id" AND ar."companyId" = pofd."companyId";
