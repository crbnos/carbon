-- An inspection plan has versions, as procedures and quality documents do.
-- Each version is a row. The versions of one plan share a root: the first
-- version has no root, every later version names it.

CREATE TYPE "inspectionDocumentStatus" AS ENUM ('Draft', 'Active', 'Archived');

ALTER TABLE "inspectionDocument"
  ADD COLUMN "status" "inspectionDocumentStatus" NOT NULL DEFAULT 'Draft',
  ADD COLUMN "rootInspectionDocumentId" TEXT;

-- Plans made before versions are in use by receipts and jobs.
UPDATE "inspectionDocument" SET "status" = 'Active';

ALTER TABLE "inspectionDocument"
  ADD CONSTRAINT "inspectionDocument_rootInspectionDocumentId_fkey"
    FOREIGN KEY ("rootInspectionDocumentId", "companyId")
    REFERENCES "inspectionDocument"("id", "companyId")
    ON DELETE SET NULL ("rootInspectionDocumentId");

CREATE INDEX "inspectionDocument_rootInspectionDocumentId_idx"
  ON "inspectionDocument" ("rootInspectionDocumentId")
  WHERE "rootInspectionDocumentId" IS NOT NULL;

-- A plan's versions all hold its model, so one plan per item and model
-- counts the first version only.
DROP INDEX IF EXISTS "inspectionDocument_part_model_key";
CREATE UNIQUE INDEX "inspectionDocument_part_model_key"
  ON "inspectionDocument" ("companyId", "partId", "modelUploadId")
  WHERE "modelUploadId" IS NOT NULL AND "rootInspectionDocumentId" IS NULL;

-- `d.*` is fixed when a view is created.
DROP VIEW IF EXISTS "inspectionDocuments";
CREATE VIEW "inspectionDocuments" WITH (SECURITY_INVOKER=true) AS
  SELECT
    d.*,
    i."readableIdWithRevision" AS "partReadableId"
  FROM "inspectionDocument" d
  LEFT JOIN "item" i ON i."id" = d."partId";

-- One plan per version group: its latest version, with every version.
DROP VIEW IF EXISTS "inspectionPlanParts";
CREATE VIEW "inspectionPlanParts" WITH (SECURITY_INVOKER=true) AS
  WITH "versions" AS (
    SELECT
      d.*,
      COALESCE(d."rootInspectionDocumentId", d."id") AS "groupId"
    FROM "inspectionDocument" d
  ),
  "latest" AS (
    SELECT DISTINCT ON ("groupId", "companyId")
      v.*,
      (
        SELECT jsonb_agg(
          jsonb_build_object('id', o."id", 'version', o."version", 'status', o."status")
          ORDER BY o."version" DESC
        )
        FROM "versions" o
        WHERE o."groupId" = v."groupId" AND o."companyId" = v."companyId"
      ) AS "versionList"
    FROM "versions" v
    ORDER BY "groupId", "companyId", v."version" DESC, v."createdAt" DESC
  )
  SELECT
    d."partId" AS "id",
    d."companyId",
    i."readableIdWithRevision" AS "partReadableId",
    i."name" AS "partName",
    COUNT(*)::INTEGER AS "planCount",
    -- The search reads the plans' names too.
    string_agg(COALESCE(d."name", d."fileName"), ' ') AS "planNames",
    jsonb_agg(
      jsonb_build_object(
        'id', d."id",
        'name', COALESCE(d."name", d."fileName"),
        'modelUploadId', d."modelUploadId",
        'version', d."version",
        'status', d."status",
        'versions', d."versionList",
        'createdBy', d."createdBy",
        'createdAt', d."createdAt"
      )
      ORDER BY COALESCE(d."name", d."fileName"), d."id"
    ) AS "plans",
    MIN(d."createdAt") AS "createdAt",
    MAX(COALESCE(d."updatedAt", d."createdAt")) AS "updatedAt",
    ic."itemPostingGroupId",
    p."tags"
  FROM "latest" d
  JOIN "item" i ON i."id" = d."partId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i."id"
  LEFT JOIN "part" p ON p."id" = i."readableId" AND p."companyId" = i."companyId"
  GROUP BY
    d."partId",
    d."companyId",
    i."readableIdWithRevision",
    i."name",
    ic."itemPostingGroupId",
    p."tags";
