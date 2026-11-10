-- A tracked entity is sampled once per inspection, not once ever. The index
-- dates from receipt-only inspections, where a serial was received and
-- inspected once. A unit is now inspected again: a manual inspection of stock
-- on hand, or the fresh lot a reworked job operation opens.

DROP INDEX IF EXISTS "inboundInspectionSample_trackedEntityId_key";

CREATE UNIQUE INDEX "inspectionSample_inspectionId_trackedEntityId_key"
  ON "inspectionSample" ("inspectionId", "trackedEntityId")
  WHERE "trackedEntityId" IS NOT NULL;

-- Lookups of a unit's samples across inspections.
CREATE INDEX "inspectionSample_trackedEntityId_idx"
  ON "inspectionSample" ("trackedEntityId");
