-- Inspection plans made from a STEP model's PMI (spec
-- .ai/specs/2026-10-27-pmi-inspection-plans.md). A model plan holds the model
-- it was made from and no PDF; each of its features names the PMI item
-- (`pmi.json` id, e.g. `d1`, `t3`) it was made from, so the inspection screens
-- can select that item on the model.

ALTER TABLE "inspectionDocument"
  ADD COLUMN IF NOT EXISTS "modelUploadId" TEXT
    REFERENCES "modelUpload"("id") ON DELETE SET NULL;

ALTER TABLE "inspectionFeature"
  ADD COLUMN IF NOT EXISTS "pmiItemId" TEXT;

-- One plan per item and model: the pmi-inspection-plan job inserts with
-- ON CONFLICT DO NOTHING, so a re-optimise or a second event never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "inspectionDocument_part_model_key"
  ON "inspectionDocument" ("companyId", "partId", "modelUploadId")
  WHERE "modelUploadId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "inspectionDocument_modelUploadId_idx"
  ON "inspectionDocument" ("modelUploadId")
  WHERE "modelUploadId" IS NOT NULL;

-- `d.*` was expanded when the view was created, so it must be created again
-- to carry the new column.
DROP VIEW IF EXISTS "inspectionDocuments";
CREATE VIEW "inspectionDocuments" WITH (SECURITY_INVOKER=true) AS
  SELECT
    d.*,
    i."readableIdWithRevision" AS "partReadableId"
  FROM "inspectionDocument" d
  LEFT JOIN "item" i ON i."id" = d."partId";
