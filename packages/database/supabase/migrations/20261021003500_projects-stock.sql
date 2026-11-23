-- Projects Phase 2a: project stock as valuated striping.
-- A nullable "projectId" on itemLedger and costLedger is the stripe; null is common stock.
-- Spec: .ai/specs/2026-10-03-projects.md (Phase 2: Project stock; decisions 14–17; Q2)

-- 1) Project settings.
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "projectStock" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "chargeAtReceipt" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "governmentFurnished" BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) The stripe on the item and cost ledgers.
ALTER TABLE "itemLedger" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "itemLedger" ADD CONSTRAINT "itemLedger_project_fkey"
  FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId");
CREATE INDEX IF NOT EXISTS "itemLedger_project_idx" ON "itemLedger" ("companyId", "projectId") WHERE "projectId" IS NOT NULL;

ALTER TABLE "costLedger" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "costLedger" ADD CONSTRAINT "costLedger_project_fkey"
  FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId");
CREATE INDEX IF NOT EXISTS "costLedger_project_idx" ON "costLedger" ("companyId", "projectId") WHERE "projectId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "costLedger_open_stripe_idx" ON "costLedger" ("itemId", "projectId", "remainingQuantity") WHERE "remainingQuantity" > 0;

-- 3) Job output into project stock. A consume-to-project job never stocks its output.
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "receiveToProjectStock" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "job" ADD CONSTRAINT "job_receiveToProjectStock_check"
  CHECK (NOT "receiveToProjectStock" OR ("projectId" IS NOT NULL AND NOT "consumeToProject"));

-- 4) The stripe on picking and count lines.
ALTER TABLE "pickingListLine" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "pickingListLine" ADD CONSTRAINT "pickingListLine_project_fkey"
  FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId");
CREATE INDEX IF NOT EXISTS "pickingListLine_project_idx" ON "pickingListLine" ("projectId", "companyId") WHERE "projectId" IS NOT NULL;

ALTER TABLE "inventoryCountLine" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "inventoryCountLine" ADD CONSTRAINT "inventoryCountLine_project_fkey"
  FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId");
CREATE INDEX IF NOT EXISTS "inventoryCountLine_project_idx" ON "inventoryCountLine" ("projectId", "companyId") WHERE "projectId" IS NOT NULL;

ALTER TABLE "itemPlanning" ADD COLUMN IF NOT EXISTS "allowCommonSupplyForProjects" BOOLEAN NOT NULL DEFAULT TRUE;

-- 5) Project stock transfers: Transfer, Borrow and Payback.
CREATE TABLE IF NOT EXISTS "projectStockTransfer" (
  "id" TEXT NOT NULL DEFAULT id('pst'),
  "companyId" TEXT NOT NULL,
  "projectStockTransferId" TEXT NOT NULL,
  "type" "projectStockTransferType" NOT NULL,
  "status" "projectStockTransferStatus" NOT NULL DEFAULT 'Draft',
  "fromProjectId" TEXT,
  "toProjectId" TEXT,
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "reason" TEXT NOT NULL,
  "paybackDueDate" DATE,
  "settlesBorrowId" TEXT,
  "planningActionId" TEXT,
  "approvedBy" TEXT REFERENCES "user"("id"),
  "approvedAt" TIMESTAMP WITH TIME ZONE,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectStockTransfer_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectStockTransfer_readable_key" UNIQUE ("projectStockTransferId", "companyId"),
  CONSTRAINT "projectStockTransfer_from_fkey" FOREIGN KEY ("fromProjectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectStockTransfer_to_fkey" FOREIGN KEY ("toProjectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectStockTransfer_owner_check" CHECK ("fromProjectId" IS DISTINCT FROM "toProjectId"),
  CONSTRAINT "projectStockTransfer_borrow_check" CHECK ("type" <> 'Borrow' OR ("paybackDueDate" IS NOT NULL AND "fromProjectId" IS NOT NULL AND "toProjectId" IS NOT NULL)),
  CONSTRAINT "projectStockTransfer_payback_check" CHECK ("type" <> 'Payback' OR "settlesBorrowId" IS NOT NULL),
  CONSTRAINT "projectStockTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectStockTransfer_companyId_idx" ON "projectStockTransfer" ("companyId");
CREATE INDEX IF NOT EXISTS "projectStockTransfer_fromProjectId_idx" ON "projectStockTransfer" ("fromProjectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectStockTransfer_toProjectId_idx" ON "projectStockTransfer" ("toProjectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectStockTransfer_locationId_idx" ON "projectStockTransfer" ("locationId");
CREATE INDEX IF NOT EXISTS "projectStockTransfer_settlesBorrowId_idx" ON "projectStockTransfer" ("settlesBorrowId", "companyId");
CREATE INDEX IF NOT EXISTS "projectStockTransfer_planningActionId_idx" ON "projectStockTransfer" ("planningActionId");
CREATE INDEX IF NOT EXISTS "projectStockTransfer_approvedBy_idx" ON "projectStockTransfer" ("approvedBy");
CREATE INDEX IF NOT EXISTS "projectStockTransfer_createdBy_idx" ON "projectStockTransfer" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectStockTransfer_updatedBy_idx" ON "projectStockTransfer" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectStockTransferLine" (
  "id" TEXT NOT NULL DEFAULT id('psl'),
  "companyId" TEXT NOT NULL,
  "projectStockTransferId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "storageUnitId" TEXT REFERENCES "storageUnit"("id"),
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id"),
  "unitCost" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectStockTransferLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectStockTransferLine_header_fkey" FOREIGN KEY ("projectStockTransferId", "companyId") REFERENCES "projectStockTransfer"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectStockTransferLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectStockTransferLine_companyId_idx" ON "projectStockTransferLine" ("companyId");
CREATE INDEX IF NOT EXISTS "projectStockTransferLine_projectStockTransferId_idx" ON "projectStockTransferLine" ("projectStockTransferId", "companyId");
CREATE INDEX IF NOT EXISTS "projectStockTransferLine_itemId_idx" ON "projectStockTransferLine" ("itemId");
CREATE INDEX IF NOT EXISTS "projectStockTransferLine_storageUnitId_idx" ON "projectStockTransferLine" ("storageUnitId");
CREATE INDEX IF NOT EXISTS "projectStockTransferLine_trackedEntityId_idx" ON "projectStockTransferLine" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "projectStockTransferLine_createdBy_idx" ON "projectStockTransferLine" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectStockTransferLine_updatedBy_idx" ON "projectStockTransferLine" ("updatedBy");

-- 6) Open borrows between projects, settled by a Payback.
CREATE TABLE IF NOT EXISTS "projectBorrow" (
  "id" TEXT NOT NULL DEFAULT id('pbw'),
  "companyId" TEXT NOT NULL,
  "borrowerProjectId" TEXT NOT NULL,
  "lenderProjectId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "quantityPaidBack" NUMERIC NOT NULL DEFAULT 0,
  "borrowedUnitCost" NUMERIC NOT NULL,
  "paybackDueDate" DATE NOT NULL,
  "status" "projectBorrowStatus" NOT NULL DEFAULT 'Open',
  "projectStockTransferLineId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectBorrow_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectBorrow_borrower_fkey" FOREIGN KEY ("borrowerProjectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectBorrow_lender_fkey" FOREIGN KEY ("lenderProjectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectBorrow_transferLine_fkey" FOREIGN KEY ("projectStockTransferLineId", "companyId") REFERENCES "projectStockTransferLine"("id", "companyId"),
  CONSTRAINT "projectBorrow_paid_check" CHECK ("quantityPaidBack" <= "quantity"),
  CONSTRAINT "projectBorrow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectBorrow_companyId_idx" ON "projectBorrow" ("companyId");
CREATE INDEX IF NOT EXISTS "projectBorrow_borrowerProjectId_idx" ON "projectBorrow" ("borrowerProjectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBorrow_lenderProjectId_idx" ON "projectBorrow" ("lenderProjectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBorrow_itemId_idx" ON "projectBorrow" ("itemId");
CREATE INDEX IF NOT EXISTS "projectBorrow_locationId_idx" ON "projectBorrow" ("locationId");
CREATE INDEX IF NOT EXISTS "projectBorrow_projectStockTransferLineId_idx" ON "projectBorrow" ("projectStockTransferLineId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBorrow_createdBy_idx" ON "projectBorrow" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectBorrow_updatedBy_idx" ON "projectBorrow" ("updatedBy");

ALTER TABLE "projectStockTransfer" ADD CONSTRAINT "projectStockTransfer_settlesBorrow_fkey"
  FOREIGN KEY ("settlesBorrowId", "companyId") REFERENCES "projectBorrow"("id", "companyId");

-- A payback's cost layer points at the borrow it settles.
ALTER TABLE "costLedger" ADD COLUMN IF NOT EXISTS "projectBorrowId" TEXT;
ALTER TABLE "costLedger" ADD CONSTRAINT "costLedger_projectBorrow_fkey"
  FOREIGN KEY ("projectBorrowId", "companyId") REFERENCES "projectBorrow"("id", "companyId");
CREATE INDEX IF NOT EXISTS "costLedger_projectBorrowId_idx" ON "costLedger" ("projectBorrowId", "companyId") WHERE "projectBorrowId" IS NOT NULL;

-- 7) Readable-id sequence for existing companies (new companies: seed-data.ts).
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'projectStockTransfer', 'Project Stock Transfer', 'PST', NULL, 0, 6, 1, c."id"
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "sequence" s WHERE s."companyId" = c."id" AND s."table" = 'projectStockTransfer'
);
