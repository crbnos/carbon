-- The Admin force delete for purchase invoices, sales invoices, receipts and
-- payments, as `purchaseOrderForceDeleteRequest` is for purchase orders. One
-- Admin asks, with a reason; another Admin approves, which voids the document
-- if it is posted and then deletes it. The rules live in TypeScript
-- (`requestDocumentForceDelete` / `decideDocumentForceDelete`,
-- invoicing.server.ts).
--
-- One table for the four types: the request names its document by type and
-- id (no foreign key, as the document is deleted) and keeps its readable id
-- and status. Its `approvalRequest` has type 'documentForceDelete', approved
-- by the company's Admins (`adminApprovedDocumentTypes`, @carbon/ee).

ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'documentForceDelete';
COMMIT;

CREATE TYPE "forceDeleteDocumentType" AS ENUM (
  'purchaseInvoice',
  'salesInvoice',
  'receipt',
  'payment'
);

CREATE TABLE "forceDeleteRequest" (
  "id" TEXT NOT NULL DEFAULT id('fdr'),
  "companyId" TEXT NOT NULL,
  "documentType" "forceDeleteDocumentType" NOT NULL,
  -- The document's id; it stays after the document is deleted.
  "documentId" TEXT NOT NULL,
  "documentReadableId" TEXT NOT NULL,
  "documentStatus" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "purchaseOrderForceDeleteStatus" NOT NULL DEFAULT 'Pending',
  "requestedBy" TEXT NOT NULL,
  "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- Who approved (and so deleted the document), rejected or cancelled it.
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP WITH TIME ZONE,
  "decisionNotes" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "forceDeleteRequest_requestedBy_fkey"
    FOREIGN KEY ("requestedBy") REFERENCES "user"("id"),
  CONSTRAINT "forceDeleteRequest_decidedBy_fkey"
    FOREIGN KEY ("decidedBy") REFERENCES "user"("id"),
  CONSTRAINT "forceDeleteRequest_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "forceDeleteRequest_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "forceDeleteRequest_reason_check"
    CHECK (length(btrim("reason")) >= 10)
);

-- One open request per document.
CREATE UNIQUE INDEX "forceDeleteRequest_pending_key"
  ON "forceDeleteRequest" ("companyId", "documentType", "documentId")
  WHERE "status" = 'Pending';
CREATE INDEX "forceDeleteRequest_companyId_idx" ON "forceDeleteRequest" ("companyId");
CREATE INDEX "forceDeleteRequest_document_idx" ON "forceDeleteRequest" ("documentType", "documentId");
CREATE INDEX "forceDeleteRequest_requestedBy_idx" ON "forceDeleteRequest" ("requestedBy");
CREATE INDEX "forceDeleteRequest_decidedBy_idx" ON "forceDeleteRequest" ("decidedBy");
CREATE INDEX "forceDeleteRequest_createdBy_idx" ON "forceDeleteRequest" ("createdBy");
CREATE INDEX "forceDeleteRequest_updatedBy_idx" ON "forceDeleteRequest" ("updatedBy");

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
    WHEN ar."documentType" = 'documentForceDelete' THEN fdr."documentReadableId"
    ELSE NULL
  END AS "documentReadableId",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN s."name"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."description"
    WHEN ar."documentType" = 'supplier' THEN NULL
    WHEN ar."documentType" = 'changeOrder' THEN co."name"
    WHEN ar."documentType" = 'projectChangeRequest' THEN pcr."title"
    WHEN ar."documentType" = 'purchaseOrderForceDelete' THEN pofd."reason"
    WHEN ar."documentType" = 'documentForceDelete' THEN fdr."reason"
    ELSE NULL
  END AS "documentDescription"
FROM "approvalRequest" ar
LEFT JOIN "purchaseOrder" po ON ar."documentType" = 'purchaseOrder' AND ar."documentId" = po."id"
LEFT JOIN "supplier" s ON po."supplierId" = s."id"
LEFT JOIN "qualityDocument" qd ON ar."documentType" = 'qualityDocument' AND ar."documentId" = qd."id"
LEFT JOIN "supplier" sup ON ar."documentType" = 'supplier' AND ar."documentId" = sup."id"
LEFT JOIN "changeOrder" co ON ar."documentType" = 'changeOrder' AND ar."documentId" = co."id" AND ar."companyId" = co."companyId"
LEFT JOIN "projectChangeRequest" pcr ON ar."documentType" = 'projectChangeRequest' AND ar."documentId" = pcr."id" AND ar."companyId" = pcr."companyId"
LEFT JOIN "purchaseOrderForceDeleteRequest" pofd ON ar."documentType" = 'purchaseOrderForceDelete' AND ar."documentId" = pofd."id" AND ar."companyId" = pofd."companyId"
LEFT JOIN "forceDeleteRequest" fdr ON ar."documentType" = 'documentForceDelete' AND ar."documentId" = fdr."id" AND ar."companyId" = fdr."companyId";
