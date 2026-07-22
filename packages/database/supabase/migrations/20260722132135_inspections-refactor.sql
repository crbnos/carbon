-- Inspections refactor: generalize the inbound inspection family to a
-- source-document model and rename the tables to the `inspection` family.
-- Spec: .ai/specs/2026-07-21-inbound-inspection-execution.md (2026-07-22 entry)
--
-- Naming constraints: `inspectionFeature` (document characteristics) and the
-- Pass/Fail enum `inspectionStatus` already exist, so the per-lot plan table
-- becomes `inspectionSamplingPlan` and the status enums take the *StatusType
-- suffix (supplierStatusType precedent). Old constraint/index NAMES keep their
-- `inboundInspection` strings — renaming them is cosmetic churn.

-- 1) Table renames (RLS policies follow the table)
DO $$ BEGIN
  IF to_regclass('public."inboundInspection"') IS NOT NULL THEN
    ALTER TABLE "inboundInspection" RENAME TO "inspection";
  END IF;
  IF to_regclass('public."inboundInspectionSample"') IS NOT NULL THEN
    ALTER TABLE "inboundInspectionSample" RENAME TO "inspectionSample";
  END IF;
  IF to_regclass('public."inboundInspectionFeature"') IS NOT NULL THEN
    ALTER TABLE "inboundInspectionFeature" RENAME TO "inspectionSamplingPlan";
  END IF;
  IF to_regclass('public."inboundInspectionMeasurement"') IS NOT NULL THEN
    ALTER TABLE "inboundInspectionMeasurement" RENAME TO "inspectionMeasurement";
  END IF;
  IF to_regclass('public."inboundInspectionHistory"') IS NOT NULL THEN
    ALTER TABLE "inboundInspectionHistory" RENAME TO "inspectionHistory";
  END IF;
  IF to_regclass('public."nonConformanceInboundInspection"') IS NOT NULL THEN
    ALTER TABLE "nonConformanceInboundInspection" RENAME TO "nonConformanceInspection";
  END IF;
END $$;

-- 2) Enum renames
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inboundInspectionStatus') THEN
    ALTER TYPE "inboundInspectionStatus" RENAME TO "inspectionStatusType";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inboundInspectionSampleStatus') THEN
    ALTER TYPE "inboundInspectionSampleStatus" RENAME TO "inspectionSampleStatusType";
  END IF;
END $$;

-- 3) Column renames. Parent readable id follows the nonConformance precedent
-- (readable `inspectionId` on the parent; child FK columns share the name but
-- reference inspection.id).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inspection'
               AND column_name = 'inboundInspectionId') THEN
    ALTER TABLE "inspection" RENAME COLUMN "inboundInspectionId" TO "inspectionId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inspectionSample'
               AND column_name = 'inboundInspectionId') THEN
    ALTER TABLE "inspectionSample" RENAME COLUMN "inboundInspectionId" TO "inspectionId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inspectionSamplingPlan'
               AND column_name = 'inboundInspectionId') THEN
    ALTER TABLE "inspectionSamplingPlan" RENAME COLUMN "inboundInspectionId" TO "inspectionId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inspectionMeasurement'
               AND column_name = 'inboundInspectionId') THEN
    ALTER TABLE "inspectionMeasurement" RENAME COLUMN "inboundInspectionId" TO "inspectionId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inspectionMeasurement'
               AND column_name = 'inboundInspectionSampleId') THEN
    ALTER TABLE "inspectionMeasurement" RENAME COLUMN "inboundInspectionSampleId" TO "inspectionSampleId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inspectionHistory'
               AND column_name = 'inboundInspectionId') THEN
    ALTER TABLE "inspectionHistory" RENAME COLUMN "inboundInspectionId" TO "inspectionId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'nonConformanceInspection'
               AND column_name = 'inboundInspectionId') THEN
    ALTER TABLE "nonConformanceInspection" RENAME COLUMN "inboundInspectionId" TO "inspectionId";
  END IF;
END $$;

-- 4) Generic source-document model
DO $$ BEGIN
  CREATE TYPE "inspectionSourceDocument" AS ENUM ('Receipt', 'Job Operation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "inspection"
  ADD COLUMN IF NOT EXISTS "sourceDocument" "inspectionSourceDocument",
  ADD COLUMN IF NOT EXISTS "sourceDocumentId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceDocumentLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceDocumentReadableId" TEXT;

-- Backfill from the receipt-specific columns, then drop them. Gated on the old
-- columns still existing so a retry over committed partial state is a no-op.
-- Dropping the columns also drops their FK and unique constraints.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inspection'
               AND column_name = 'receiptLineId') THEN
    UPDATE "inspection" i
    SET
      "sourceDocument" = 'Receipt',
      "sourceDocumentId" = i."receiptId",
      "sourceDocumentLineId" = i."receiptLineId",
      "sourceDocumentReadableId" = r."receiptId"
    FROM "receipt" r
    WHERE r."id" = i."receiptId"
      AND i."sourceDocument" IS NULL;

    -- Safety net for rows whose receipt no longer resolves (should not exist;
    -- the FK was ON DELETE CASCADE).
    UPDATE "inspection"
    SET
      "sourceDocument" = 'Receipt',
      "sourceDocumentId" = "receiptId",
      "sourceDocumentLineId" = "receiptLineId"
    WHERE "sourceDocument" IS NULL;

    ALTER TABLE "inspection" DROP COLUMN "receiptId";
    ALTER TABLE "inspection" DROP COLUMN "receiptLineId";
  END IF;
END $$;

ALTER TABLE "inspection"
  ALTER COLUMN "sourceDocument" SET NOT NULL,
  ALTER COLUMN "sourceDocumentId" SET NOT NULL;

-- One inspection per source line (was: unique receiptLineId). No FKs on the
-- generic ids — same as receipt."sourceDocumentId".
CREATE UNIQUE INDEX IF NOT EXISTS "inspection_sourceDocumentLineId_key"
  ON "inspection" ("sourceDocument", "sourceDocumentLineId")
  WHERE "sourceDocumentLineId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "inspection_sourceDocumentId_idx"
  ON "inspection" ("sourceDocumentId");
CREATE INDEX IF NOT EXISTS "inspection_sourceDocument_idx"
  ON "inspection" ("sourceDocument");

-- 5) Sequence re-key: existing companies keep their prefix (II) and counter;
-- only NEW companies seed the INS prefix (lib/seed.data.ts).
UPDATE "sequence"
SET "table" = 'inspection', "name" = 'Inspection'
WHERE "table" = 'inboundInspection';
