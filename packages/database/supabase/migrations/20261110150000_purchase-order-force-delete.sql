-- An Admin override for deleting a purchase order that the normal delete
-- refuses (a released order, or one in approval the caller did not request).
-- One Admin asks, with a reason; the order is deleted only when two OTHER
-- Admins have approved. The rules live in TypeScript
-- (`requestPurchaseOrderForceDelete` and `decidePurchaseOrderForceDelete`,
-- purchasing.server.ts); these tables only keep the request and who approved
-- it, so the record outlives the order it deleted.
--
-- Not the `approvalRequest` workflow: that one takes a single decision from a
-- rule's approver groups, and this needs two distinct Admins.

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
  -- Who rejected or cancelled it; for an executed request, the second approver.
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

-- One row per Admin who approved. The unique key stops one Admin counting twice.
CREATE TABLE "purchaseOrderForceDeleteApproval" (
  "id" TEXT NOT NULL DEFAULT id('pofda'),
  "companyId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL,
  "approvedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "notes" TEXT,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderForceDeleteApproval_requestId_fkey"
    FOREIGN KEY ("requestId", "companyId")
    REFERENCES "purchaseOrderForceDeleteRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderForceDeleteApproval_approvedBy_fkey"
    FOREIGN KEY ("approvedBy") REFERENCES "user"("id"),
  CONSTRAINT "purchaseOrderForceDeleteApproval_approver_key"
    UNIQUE ("requestId", "companyId", "approvedBy")
);

CREATE INDEX "purchaseOrderForceDeleteApproval_companyId_idx" ON "purchaseOrderForceDeleteApproval" ("companyId");
CREATE INDEX "purchaseOrderForceDeleteApproval_approvedBy_idx" ON "purchaseOrderForceDeleteApproval" ("approvedBy");
