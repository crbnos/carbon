-- MRP v2 Phase 2a: planned orders.
--
-- MRP writes one plannedOrder per new supply it suggests in the common
-- segment, sized by the item's reorder policy. A Make planned order is
-- exploded to its components in the same run. A person can firm a planned
-- order (MRP then never changes it); converting it creates the Planned job
-- or Planned PO line and marks the row Converted.
--
-- The time fence holds near-term planned orders still: a location default and
-- an item override, in days. 0 = no fence.

DO $$ BEGIN
  CREATE TYPE "plannedOrderType" AS ENUM ('Make', 'Buy', 'Transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "plannedOrderStatus" AS ENUM ('Planned', 'Firm', 'Converted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "plannedOrder" (
  "id" TEXT NOT NULL DEFAULT id('plo'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "planningSegmentId" TEXT NOT NULL DEFAULT '',
  "orderType" "plannedOrderType" NOT NULL,
  "status" "plannedOrderStatus" NOT NULL DEFAULT 'Planned',
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "scrapQuantity" NUMERIC NOT NULL DEFAULT 0,
  "quantityTrace" JSONB,
  "dueDate" DATE NOT NULL,
  "releaseDate" DATE NOT NULL,
  "periodId" TEXT NOT NULL,
  "splitIndex" INTEGER NOT NULL DEFAULT 0,
  "lowLevelCode" INTEGER NOT NULL DEFAULT 0,
  "supplierId" TEXT,
  "firmedBy" TEXT REFERENCES "user"("id"),
  "firmedAt" TIMESTAMP WITH TIME ZONE,
  "jobId" TEXT,
  "purchaseOrderLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "plannedOrder_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "plannedOrder_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "plannedOrder_itemId_fkey" FOREIGN KEY ("itemId")
    REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "plannedOrder_locationId_fkey" FOREIGN KEY ("locationId")
    REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "plannedOrder_periodId_fkey" FOREIGN KEY ("periodId")
    REFERENCES "period"("id") ON DELETE CASCADE,
  -- A converted row is history of its job or PO line; it goes with them.
  CONSTRAINT "plannedOrder_jobId_fkey" FOREIGN KEY ("jobId")
    REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "plannedOrder_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId")
    REFERENCES "purchaseOrderLine"("id") ON DELETE CASCADE,
  CONSTRAINT "plannedOrder_supplierId_fkey" FOREIGN KEY ("supplierId")
    REFERENCES "supplier"("id") ON DELETE SET NULL,
  CONSTRAINT "plannedOrder_firm_chk" CHECK (("status" = 'Firm') = ("firmedBy" IS NOT NULL)),
  CONSTRAINT "plannedOrder_converted_chk" CHECK (
    ("status" = 'Converted') = ("jobId" IS NOT NULL OR "purchaseOrderLineId" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "plannedOrder_companyId_idx" ON "plannedOrder" ("companyId");
CREATE INDEX IF NOT EXISTS "plannedOrder_item_loc_idx" ON "plannedOrder" ("companyId", "itemId", "locationId");
CREATE INDEX IF NOT EXISTS "plannedOrder_itemId_idx" ON "plannedOrder" ("itemId");
CREATE INDEX IF NOT EXISTS "plannedOrder_locationId_idx" ON "plannedOrder" ("locationId");
CREATE INDEX IF NOT EXISTS "plannedOrder_periodId_idx" ON "plannedOrder" ("periodId");
CREATE INDEX IF NOT EXISTS "plannedOrder_jobId_idx" ON "plannedOrder" ("jobId");
CREATE INDEX IF NOT EXISTS "plannedOrder_purchaseOrderLineId_idx" ON "plannedOrder" ("purchaseOrderLineId");
CREATE INDEX IF NOT EXISTS "plannedOrder_supplierId_idx" ON "plannedOrder" ("supplierId");
CREATE INDEX IF NOT EXISTS "plannedOrder_status_idx" ON "plannedOrder" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "plannedOrder_createdBy_idx" ON "plannedOrder" ("createdBy");
CREATE INDEX IF NOT EXISTS "plannedOrder_updatedBy_idx" ON "plannedOrder" ("updatedBy");
CREATE INDEX IF NOT EXISTS "plannedOrder_firmedBy_idx" ON "plannedOrder" ("firmedBy");
CREATE UNIQUE INDEX IF NOT EXISTS "plannedOrder_natural_key_idx" ON "plannedOrder"
  ("companyId", "itemId", "locationId", "planningSegmentId", "orderType", "periodId", "splitIndex")
  WHERE "status" = 'Planned';

-- The time fence: a location default and an item override (NULL = inherit).
ALTER TABLE "location" ADD COLUMN IF NOT EXISTS "planningTimeFenceDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "location" DROP CONSTRAINT IF EXISTS "location_planningTimeFenceDays_check";
ALTER TABLE "location" ADD CONSTRAINT "location_planningTimeFenceDays_check"
  CHECK ("planningTimeFenceDays" >= 0);

ALTER TABLE "itemPlanning" ADD COLUMN IF NOT EXISTS "planningTimeFenceDays" INTEGER;
ALTER TABLE "itemPlanning" DROP CONSTRAINT IF EXISTS "itemPlanning_planningTimeFenceDays_check";
ALTER TABLE "itemPlanning" ADD CONSTRAINT "itemPlanning_planningTimeFenceDays_check"
  CHECK ("planningTimeFenceDays" IS NULL OR "planningTimeFenceDays" >= 0);

-- A change action (Expedite, Defer, Increase, Decrease, Cancel) may target a
-- Firm or fence-held planned order. Order and Make actions keep no target:
-- they cover every planned order of their week.
ALTER TABLE "planningAction" ADD COLUMN IF NOT EXISTS "plannedOrderId" TEXT;
CREATE INDEX IF NOT EXISTS "planningAction_plannedOrderId_idx" ON "planningAction" ("plannedOrderId", "companyId");
ALTER TABLE "planningAction" DROP CONSTRAINT IF EXISTS "planningAction_plannedOrderId_fkey";
ALTER TABLE "planningAction" ADD CONSTRAINT "planningAction_plannedOrderId_fkey"
  FOREIGN KEY ("plannedOrderId", "companyId") REFERENCES "plannedOrder"("id", "companyId")
  ON DELETE CASCADE;

ALTER TABLE "planningAction" DROP CONSTRAINT IF EXISTS "planningAction_change_target_chk";
ALTER TABLE "planningAction" ADD CONSTRAINT "planningAction_change_target_chk" CHECK (
  ("type" IN ('Order','Make','Transfer','Borrow')
     AND "purchaseOrderLineId" IS NULL AND "jobId" IS NULL AND "plannedOrderId" IS NULL)
  OR ("type" NOT IN ('Order','Make','Transfer','Borrow')
     AND (("purchaseOrderLineId" IS NOT NULL)::int + ("jobId" IS NOT NULL)::int
          + ("plannedOrderId" IS NOT NULL)::int) = 1)
);

DROP INDEX IF EXISTS "planningAction_natural_key_idx";
CREATE UNIQUE INDEX "planningAction_natural_key_idx" ON "planningAction"
  ("companyId", "itemId", "locationId", "planningSegmentId", "type",
   (COALESCE("purchaseOrderLineId", "jobId", "plannedOrderId", "periodId")),
   (COALESCE("fromProjectId", '')), (COALESCE("toProjectId", '')))
  WHERE "status" <> 'Actioned';
