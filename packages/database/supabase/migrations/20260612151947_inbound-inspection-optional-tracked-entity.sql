-- Support inbound inspection for non-serial parts (Batch / Inventory / Non-Inventory).
-- For these tracking types the inspector records pass/fail for each sampled item
-- without scanning a tracked entity, so trackedEntityId becomes optional. Serial
-- parts still scan a discrete entity, and a given entity may only be sampled once
-- (preserved by the partial unique index below).

ALTER TABLE "inboundInspectionSample"
  ALTER COLUMN "trackedEntityId" DROP NOT NULL;

ALTER TABLE "inboundInspectionSample"
  DROP CONSTRAINT IF EXISTS "inboundInspectionSample_trackedEntityId_unique";

CREATE UNIQUE INDEX "inboundInspectionSample_trackedEntityId_key"
  ON "inboundInspectionSample" ("trackedEntityId")
  WHERE "trackedEntityId" IS NOT NULL;
