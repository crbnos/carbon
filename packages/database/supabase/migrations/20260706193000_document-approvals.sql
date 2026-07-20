-- Document Approvals (issue #1032)
-- Extends the existing approval engine to four financial documents — manual
-- journal entries, payments, purchase invoices, and credit/debit memos — with
-- amount-tiered rules, a per-document 'Pending Approval' status, approver
-- identity columns on the journal (readiness JE export), system-wide
-- no-self-approval enforcement, escalation reminder bookkeeping, and a
-- one-enabled-rule-per-(documentType, floor) constraint.
--
-- Idempotent: safe to apply twice (IF NOT EXISTS / CREATE OR REPLACE throughout).

-- New approval document types
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'journalEntry';
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'payment';
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'purchaseInvoice';
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'memo';

-- New document statuses (the parked-for-approval state on each document)
ALTER TYPE "journalEntryStatus" ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE "paymentStatus" ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE "memoStatus" ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE "purchaseInvoiceStatus" ADD VALUE IF NOT EXISTS 'Pending Approval';

-- Close the implicit transaction so the new enum values are usable by the
-- statements below. Postgres forbids using a freshly added enum value in the
-- same transaction that added it; committing first sidesteps the restriction.
-- Precedent: 20260310005407_supplier-approvals.sql.
COMMIT;

-- Approver identity for the JE export (readiness MW-1/MW-2). preparedBy is the
-- posting requester (stamped when the JE parks); approvedBy is the second-eyes
-- approver; approvalRequestId links the posted JE back to its request.
ALTER TABLE "journal"
  ADD COLUMN IF NOT EXISTS "preparedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "approvalRequestId" TEXT;

CREATE INDEX IF NOT EXISTS "journal_preparedBy_idx" ON "journal" ("preparedBy");
CREATE INDEX IF NOT EXISTS "journal_approvedBy_idx" ON "journal" ("approvedBy");

-- Self-approval enforcement. Defaults on: a requester can never approve their
-- own document. Turning it off is a standing exception surfaced in the SoD report.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "enforceNoSelfApproval" BOOLEAN NOT NULL DEFAULT true;

-- Escalation reminder bookkeeping: the last day a pending request was re-notified
-- (stamped by the approval-escalation daily cron to enforce once-per-day).
ALTER TABLE "approvalRequest"
  ADD COLUMN IF NOT EXISTS "lastRemindedAt" TIMESTAMP WITH TIME ZONE;

-- One enabled rule per (documentType, floor). Backs the duplicate-floor guard
-- in upsertApprovalRule; the partial index only constrains enabled rules so a
-- disabled rule can share a floor.
CREATE UNIQUE INDEX IF NOT EXISTS "approvalRule_type_floor_enabled_idx"
  ON "approvalRule" ("companyId", "documentType", "lowerBoundAmount")
  WHERE "enabled" = true;

-- Resolve readable id + description for the four new document types in the
-- approvals view (drives the "assigned to me" approval lists / dashboards).
-- Forked from the newest definition (20260310005407_supplier-approvals.sql).
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
    WHEN ar."documentType" = 'journalEntry' THEN je."journalEntryId"
    WHEN ar."documentType" = 'payment' THEN pay."paymentId"
    WHEN ar."documentType" = 'purchaseInvoice' THEN pinv."invoiceId"
    WHEN ar."documentType" = 'memo' THEN mem."memoId"
    ELSE NULL
  END AS "documentReadableId",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN s."name"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."description"
    WHEN ar."documentType" = 'supplier' THEN NULL
    WHEN ar."documentType" = 'journalEntry' THEN je."description"
    ELSE NULL
  END AS "documentDescription"
FROM "approvalRequest" ar
LEFT JOIN "purchaseOrder" po ON ar."documentType" = 'purchaseOrder' AND ar."documentId" = po."id"
LEFT JOIN "supplier" s ON po."supplierId" = s."id"
LEFT JOIN "qualityDocument" qd ON ar."documentType" = 'qualityDocument' AND ar."documentId" = qd."id"
LEFT JOIN "supplier" sup ON ar."documentType" = 'supplier' AND ar."documentId" = sup."id"
LEFT JOIN "journal" je ON ar."documentType" = 'journalEntry' AND ar."documentId" = je."id"
LEFT JOIN "payment" pay ON ar."documentType" = 'payment' AND ar."documentId" = pay."id"
LEFT JOIN "purchaseInvoice" pinv ON ar."documentType" = 'purchaseInvoice' AND ar."documentId" = pinv."id"
LEFT JOIN "memo" mem ON ar."documentType" = 'memo' AND ar."documentId" = mem."id";
