-- Projects Phase 2b: the MRP netting segment. '' is common; a project id is a
-- project with project stock. Every planningSegmentId is TEXT NOT NULL DEFAULT ''.

-- One segment rule for every view and RPC. Phase 3 redefines it to prefer planningGroupId.
CREATE OR REPLACE FUNCTION project_planning_segment(p_project_id TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN p."projectStock" THEN p."id" ELSE '' END
                   FROM "project" p WHERE p."id" = p_project_id), '');
$$;

ALTER TABLE "demandForecast"       ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "supplyForecast"       ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "demandActual"         ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "supplyActual"         ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "demandForecastSource" ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';

ALTER TABLE "demandForecast" DROP CONSTRAINT "demandForecast_pkey";
ALTER TABLE "demandForecast" ADD CONSTRAINT "demandForecast_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "planningSegmentId");
ALTER TABLE "demandForecast" DROP CONSTRAINT "demandForecast_itemId_locationId_periodId_companyId_key";
ALTER TABLE "demandForecast" ADD CONSTRAINT "demandForecast_itemId_locationId_periodId_companyId_key"
  UNIQUE ("itemId", "locationId", "periodId", "companyId", "planningSegmentId");
ALTER TABLE "supplyForecast" DROP CONSTRAINT "supplyForecast_pkey";
ALTER TABLE "supplyForecast" ADD CONSTRAINT "supplyForecast_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "planningSegmentId");
ALTER TABLE "demandActual" DROP CONSTRAINT "demandActual_pkey";
ALTER TABLE "demandActual" ADD CONSTRAINT "demandActual_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "sourceType", "planningSegmentId");
ALTER TABLE "supplyActual" DROP CONSTRAINT "supplyActual_pkey";
ALTER TABLE "supplyActual" ADD CONSTRAINT "supplyActual_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "sourceType", "planningSegmentId");

ALTER TABLE "planningAction"
  ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "fromProjectId" TEXT,           -- Transfer/Borrow source owner; null = common
  ADD COLUMN IF NOT EXISTS "toProjectId" TEXT,             -- Transfer/Borrow target owner; null = common
  ADD COLUMN IF NOT EXISTS "projectStockTransferId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectBorrowId" TEXT;
ALTER TABLE "planningAction" DROP CONSTRAINT "planningAction_change_target_chk";
ALTER TABLE "planningAction" ADD CONSTRAINT "planningAction_change_target_chk" CHECK (
  ("type" IN ('Order','Make','Transfer','Borrow') AND "purchaseOrderLineId" IS NULL AND "jobId" IS NULL)
  OR ("type" NOT IN ('Order','Make','Transfer','Borrow') AND (("purchaseOrderLineId" IS NOT NULL)::int + ("jobId" IS NOT NULL)::int) = 1)
);
ALTER TABLE "planningAction" ADD CONSTRAINT "planningAction_transfer_owner_chk" CHECK (
  ("type" IN ('Transfer','Borrow') AND "fromProjectId" IS DISTINCT FROM "toProjectId")
  OR ("type" NOT IN ('Transfer','Borrow') AND "fromProjectId" IS NULL AND "toProjectId" IS NULL)
);
DROP INDEX IF EXISTS "planningAction_natural_key_idx";
CREATE UNIQUE INDEX "planningAction_natural_key_idx" ON "planningAction"
  ("companyId", "itemId", "locationId", "planningSegmentId", "type",
   (COALESCE("purchaseOrderLineId", "jobId", "periodId")),
   (COALESCE("fromProjectId", '')), (COALESCE("toProjectId", '')))
  WHERE "status" <> 'Actioned';
CREATE INDEX IF NOT EXISTS "planningAction_segment_idx" ON "planningAction" ("companyId", "planningSegmentId") WHERE "planningSegmentId" <> '';
