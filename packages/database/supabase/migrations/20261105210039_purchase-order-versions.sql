-- A released purchase order edited above its approved amount goes back to
-- approval with the version it had just before that edit, and rejecting the
-- request puts that version back. An earlier draft of this change kept the
-- version as a JSONB copy on the request (`approvalRequest.priorVersion`,
-- applied on development databases only). The database cannot see inside
-- JSON, so a row the copy named (a storage unit, a job, a cost center) could
-- be deleted under it and the restore failed; a company restore renumbers
-- lines, so the copy named lines the order no longer had.
--
-- These tables keep the same columns as the live delivery and line rows,
-- under foreign keys to the same rows. A deleted row is nulled here as it is
-- on the live line (every reference is ON DELETE SET NULL: a version is never
-- deleted or blocked by it), and a restore of the company into another one
-- rewrites the line ids.

-- The JSONB draft column, where a development database applied it.
ALTER TABLE "approvalRequest" DROP COLUMN IF EXISTS "priorVersion";

-- Whether the request kept the document's version before the edit it is
-- for: rejecting such a request restores it, and the document stays on the
-- approval before it ("Approved By" keeps showing that one).
ALTER TABLE "approvalRequest"
  ADD COLUMN "hasPriorVersion" BOOLEAN NOT NULL DEFAULT false;

-- The order as it was: its exchange rate and its delivery
-- (PURCHASE_ORDER_DELIVERY_VERSION_COLUMNS, purchasing.models.ts).
CREATE TABLE "purchaseOrderVersion" (
  "id" TEXT NOT NULL DEFAULT id('pov'),
  "companyId" TEXT NOT NULL,
  "approvalRequestId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "exchangeRate" NUMERIC,

  -- purchaseOrderDelivery; false when the order had no delivery row.
  "hasDelivery" BOOLEAN NOT NULL DEFAULT false,
  "locationId" TEXT,
  "shippingMethodId" TEXT,
  "shippingTermId" TEXT,
  "receiptRequestedDate" DATE,
  "notes" TEXT,
  "trackingNumber" TEXT,
  "dropShipment" BOOLEAN,
  "customerId" TEXT,
  "customerLocationId" TEXT,
  "customFields" JSONB,
  "supplierShippingCost" NUMERIC,
  "incoterm" "incoterm",
  "incotermLocation" TEXT,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderVersion_approvalRequestId_fkey"
    FOREIGN KEY ("approvalRequestId", "companyId")
    REFERENCES "approvalRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderVersion_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderVersion_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE SET NULL,
  CONSTRAINT "purchaseOrderVersion_shippingMethodId_fkey"
    FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod"("id") ON DELETE SET NULL,
  CONSTRAINT "purchaseOrderVersion_shippingTermId_fkey"
    FOREIGN KEY ("shippingTermId") REFERENCES "shippingTerm"("id") ON DELETE SET NULL,
  CONSTRAINT "purchaseOrderVersion_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL,
  CONSTRAINT "purchaseOrderVersion_customerLocationId_fkey"
    FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation"("id") ON DELETE SET NULL,
  -- One version per request.
  CONSTRAINT "purchaseOrderVersion_approvalRequestId_key" UNIQUE ("approvalRequestId", "companyId")
);

CREATE INDEX "purchaseOrderVersion_companyId_idx" ON "purchaseOrderVersion" ("companyId");
CREATE INDEX "purchaseOrderVersion_purchaseOrderId_idx" ON "purchaseOrderVersion" ("purchaseOrderId");
CREATE INDEX "purchaseOrderVersion_locationId_idx" ON "purchaseOrderVersion" ("locationId");
CREATE INDEX "purchaseOrderVersion_shippingMethodId_idx" ON "purchaseOrderVersion" ("shippingMethodId");
CREATE INDEX "purchaseOrderVersion_shippingTermId_idx" ON "purchaseOrderVersion" ("shippingTermId");
CREATE INDEX "purchaseOrderVersion_customerId_idx" ON "purchaseOrderVersion" ("customerId");
CREATE INDEX "purchaseOrderVersion_customerLocationId_idx" ON "purchaseOrderVersion" ("customerLocationId");
CREATE INDEX "purchaseOrderVersion_createdBy_idx" ON "purchaseOrderVersion" ("createdBy");
CREATE INDEX "purchaseOrderVersion_updatedBy_idx" ON "purchaseOrderVersion" ("updatedBy");

-- Each line as it was (PURCHASE_ORDER_LINE_VERSION_COLUMNS). A line the
-- version had that the order no longer has keeps its row with
-- "purchaseOrderLineId" null: the version then no longer fits the order and
-- is not restored, rather than being read as a line the edit added.
CREATE TABLE "purchaseOrderLineVersion" (
  "id" TEXT NOT NULL DEFAULT id('polv'),
  "companyId" TEXT NOT NULL,
  "purchaseOrderVersionId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT,

  "purchaseOrderLineType" "purchaseOrderLineType" NOT NULL,
  "itemId" TEXT,
  "description" TEXT,
  "purchaseQuantity" NUMERIC,
  "purchaseUnitOfMeasureCode" TEXT,
  "inventoryUnitOfMeasureCode" TEXT,
  "conversionFactor" NUMERIC,
  "supplierUnitPrice" NUMERIC,
  "supplierShippingCost" NUMERIC NOT NULL DEFAULT 0,
  "supplierTaxAmount" NUMERIC NOT NULL DEFAULT 0,
  "taxPercent" NUMERIC,
  "setupPrice" NUMERIC,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "locationId" TEXT,
  "storageUnitId" TEXT,
  "accountId" TEXT,
  "assetId" TEXT,
  "costCenterId" TEXT,
  "jobId" TEXT,
  "jobOperationId" TEXT,
  "supplierPartId" TEXT,
  "requiredDate" DATE,
  "customFields" JSONB,
  "tags" TEXT[],
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "externalNotes" JSONB,
  "internalNotes" JSONB,
  "modelUploadId" TEXT,
  "ownerId" TEXT,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_purchaseOrderVersionId_fkey"
    FOREIGN KEY ("purchaseOrderVersionId", "companyId")
    REFERENCES "purchaseOrderVersion"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_purchaseOrderLineId_fkey"
    FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine"("id") ON DELETE SET NULL,
  CONSTRAINT "purchaseOrderLineVersion_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_purchaseUnitOfMeasureCode_fkey"
    FOREIGN KEY ("purchaseUnitOfMeasureCode", "companyId")
    REFERENCES "unitOfMeasure"("code", "companyId")
    ON DELETE SET NULL ("purchaseUnitOfMeasureCode") ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_inventoryUnitOfMeasureCode_fkey"
    FOREIGN KEY ("inventoryUnitOfMeasureCode", "companyId")
    REFERENCES "unitOfMeasure"("code", "companyId")
    ON DELETE SET NULL ("inventoryUnitOfMeasureCode") ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE SET NULL,
  CONSTRAINT "purchaseOrderLineVersion_storageUnitId_fkey"
    FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "fixedAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "costCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_jobOperationId_fkey"
    FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "purchaseOrderLineVersion_supplierPartId_fkey"
    FOREIGN KEY ("supplierPartId", "companyId")
    REFERENCES "supplierPart"("id", "companyId") ON DELETE SET NULL ("supplierPartId"),
  CONSTRAINT "purchaseOrderLineVersion_modelUploadId_fkey"
    FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE SET NULL,
  CONSTRAINT "purchaseOrderLineVersion_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "purchaseOrderLineVersion_companyId_idx" ON "purchaseOrderLineVersion" ("companyId");
CREATE INDEX "purchaseOrderLineVersion_purchaseOrderVersionId_idx" ON "purchaseOrderLineVersion" ("purchaseOrderVersionId");
CREATE INDEX "purchaseOrderLineVersion_purchaseOrderLineId_idx" ON "purchaseOrderLineVersion" ("purchaseOrderLineId");
CREATE INDEX "purchaseOrderLineVersion_itemId_idx" ON "purchaseOrderLineVersion" ("itemId");
CREATE INDEX "purchaseOrderLineVersion_purchaseUnitOfMeasureCode_idx" ON "purchaseOrderLineVersion" ("purchaseUnitOfMeasureCode", "companyId");
CREATE INDEX "purchaseOrderLineVersion_inventoryUnitOfMeasureCode_idx" ON "purchaseOrderLineVersion" ("inventoryUnitOfMeasureCode", "companyId");
CREATE INDEX "purchaseOrderLineVersion_locationId_idx" ON "purchaseOrderLineVersion" ("locationId");
CREATE INDEX "purchaseOrderLineVersion_storageUnitId_idx" ON "purchaseOrderLineVersion" ("storageUnitId");
CREATE INDEX "purchaseOrderLineVersion_accountId_idx" ON "purchaseOrderLineVersion" ("accountId");
CREATE INDEX "purchaseOrderLineVersion_assetId_idx" ON "purchaseOrderLineVersion" ("assetId");
CREATE INDEX "purchaseOrderLineVersion_costCenterId_idx" ON "purchaseOrderLineVersion" ("costCenterId");
CREATE INDEX "purchaseOrderLineVersion_jobId_idx" ON "purchaseOrderLineVersion" ("jobId");
CREATE INDEX "purchaseOrderLineVersion_jobOperationId_idx" ON "purchaseOrderLineVersion" ("jobOperationId");
CREATE INDEX "purchaseOrderLineVersion_supplierPartId_idx" ON "purchaseOrderLineVersion" ("supplierPartId", "companyId");
CREATE INDEX "purchaseOrderLineVersion_modelUploadId_idx" ON "purchaseOrderLineVersion" ("modelUploadId");
CREATE INDEX "purchaseOrderLineVersion_ownerId_idx" ON "purchaseOrderLineVersion" ("ownerId");
CREATE INDEX "purchaseOrderLineVersion_createdBy_idx" ON "purchaseOrderLineVersion" ("createdBy");
CREATE INDEX "purchaseOrderLineVersion_updatedBy_idx" ON "purchaseOrderLineVersion" ("updatedBy");
