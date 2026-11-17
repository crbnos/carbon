-- Carrier transit time and ship-by dates
-- Spec: .ai/specs/2026-11-17-carrier-transit-ship-by-dates.md
--
-- 1. shippingMethod.transitDays: the business days a shipment takes to arrive.
-- 2. customerLocationTransitTime: the transit days for one ship-to address and
--    shipping method pair. It wins over the shipping method.
-- 3. job.shipByDate: a read-only copy of the linked sales order line's
--    promisedDate (the date the line ships). Two triggers are its only writers.
-- 4. shipment.estimatedDeliveryDate / deliveredDate / deliveredSource.

-- 1. Transit days on the shipping method. NULL means "not set": Carbon then
-- calculates no date. 0 means the goods arrive the day they ship.
ALTER TABLE "shippingMethod" ADD COLUMN IF NOT EXISTS "transitDays" INTEGER;

DO $$ BEGIN
  ALTER TABLE "shippingMethod" ADD CONSTRAINT "shippingMethod_transitDays_check"
    CHECK ("transitDays" IS NULL OR "transitDays" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Transit days for one ship-to address and shipping method pair.
CREATE TABLE IF NOT EXISTS "customerLocationTransitTime" (
  "id" TEXT NOT NULL DEFAULT id('ctt'),
  "companyId" TEXT NOT NULL,
  "customerLocationId" TEXT NOT NULL,
  "shippingMethodId" TEXT NOT NULL,
  "transitDays" INTEGER NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "customerLocationTransitTime_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerLocationTransitTime_transitDays_check" CHECK ("transitDays" >= 0),
  CONSTRAINT "customerLocationTransitTime_unique"
    UNIQUE ("customerLocationId", "shippingMethodId", "companyId"),
  CONSTRAINT "customerLocationTransitTime_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerLocationTransitTime_customerLocationId_fkey"
    FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerLocationTransitTime_shippingMethodId_fkey"
    FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "customerLocationTransitTime_companyId_idx"
  ON "customerLocationTransitTime" ("companyId");
CREATE INDEX IF NOT EXISTS "customerLocationTransitTime_customerLocationId_idx"
  ON "customerLocationTransitTime" ("customerLocationId");
CREATE INDEX IF NOT EXISTS "customerLocationTransitTime_shippingMethodId_idx"
  ON "customerLocationTransitTime" ("shippingMethodId");
CREATE INDEX IF NOT EXISTS "customerLocationTransitTime_createdBy_idx"
  ON "customerLocationTransitTime" ("createdBy");
CREATE INDEX IF NOT EXISTS "customerLocationTransitTime_updatedBy_idx"
  ON "customerLocationTransitTime" ("updatedBy");

ALTER TABLE "customerLocationTransitTime" ENABLE ROW LEVEL SECURITY;
-- Policies come from packages/database/src/authz/manifest.ts.

-- 3. The ship-by date on the job.
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "shipByDate" DATE;

CREATE INDEX IF NOT EXISTS "job_companyId_shipByDate_idx"
  ON "job" ("companyId", "shipByDate");

-- These are plain triggers, not event-system interceptors: an interceptor
-- (packages/database/src/event-system/handlers) cannot change NEW, and the
-- job trigger must. Both run as their owner, so a sales user who moves a
-- line's date also moves the job's copy without production permissions, and
-- a production user who links a job reads the line without sales ones.

-- A job copies the promisedDate of the line it links to, on insert and when
-- the link changes. A NULL link clears the copy. The ON DELETE SET NULL of
-- job_salesOrderLineId_fkey updates "salesOrderLineId", so it fires this too.
CREATE OR REPLACE FUNCTION public.job_set_ship_by_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."salesOrderLineId" IS NULL THEN
    NEW."shipByDate" := NULL;
  ELSE
    SELECT sol."promisedDate" INTO NEW."shipByDate"
    FROM "salesOrderLine" sol
    WHERE sol."id" = NEW."salesOrderLineId"
      AND sol."companyId" = NEW."companyId";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "job_set_ship_by_date" ON "job";
CREATE TRIGGER "job_set_ship_by_date"
  BEFORE INSERT OR UPDATE OF "salesOrderLineId", "shipByDate" ON "job"
  FOR EACH ROW EXECUTE FUNCTION public.job_set_ship_by_date();

-- A change to a line's promisedDate moves the copy on every job of the line.
CREATE OR REPLACE FUNCTION public.sales_order_line_sync_job_ship_by_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE "job"
  SET "shipByDate" = NEW."promisedDate"
  WHERE "salesOrderLineId" = NEW."id"
    AND "companyId" = NEW."companyId"
    AND "shipByDate" IS DISTINCT FROM NEW."promisedDate";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "sales_order_line_sync_job_ship_by_date" ON "salesOrderLine";
CREATE TRIGGER "sales_order_line_sync_job_ship_by_date"
  AFTER UPDATE OF "promisedDate" ON "salesOrderLine"
  FOR EACH ROW
  WHEN (OLD."promisedDate" IS DISTINCT FROM NEW."promisedDate")
  EXECUTE FUNCTION public.sales_order_line_sync_job_ship_by_date();

-- Existing jobs take their line's date.
UPDATE "job" j
SET "shipByDate" = sol."promisedDate"
FROM "salesOrderLine" sol
WHERE sol."id" = j."salesOrderLineId"
  AND sol."companyId" = j."companyId"
  AND j."shipByDate" IS DISTINCT FROM sol."promisedDate";

-- 4. Delivery dates on the shipment. Only recordShipmentDelivery
-- (apps/erp/app/modules/inventory/inventory.service.ts) writes the delivered
-- pair: 'Manual' from Mark Delivered, 'Carrier' from a tracking integration.
DO $$ BEGIN
  CREATE TYPE "shipmentDeliveredSource" AS ENUM ('Manual', 'Carrier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "shipment"
  ADD COLUMN IF NOT EXISTS "estimatedDeliveryDate" DATE,
  ADD COLUMN IF NOT EXISTS "deliveredDate" DATE,
  ADD COLUMN IF NOT EXISTS "deliveredSource" "shipmentDeliveredSource";

DO $$ BEGIN
  ALTER TABLE "shipment" ADD CONSTRAINT "shipment_deliveredSource_check"
    CHECK (("deliveredDate" IS NULL) = ("deliveredSource" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "shipment" ADD CONSTRAINT "shipment_deliveredDate_check"
    CHECK ("deliveredDate" IS NULL OR "postingDate" IS NULL OR "deliveredDate" >= "postingDate");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
