-- Issue types (nonConformanceType) had no uniqueness protection, so the same
-- name could be created repeatedly per company. Merge existing duplicates
-- (keep the oldest row per company + name, repoint references), then enforce
-- uniqueness like the other config lookups (e.g. nonConformanceRequiredAction).

-- Repoint issues that reference a duplicate type to the kept (oldest) row
WITH ranked AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "companyId", "name"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "keepId"
  FROM "nonConformanceType"
),
dupes AS (
  SELECT "id", "keepId" FROM ranked WHERE "id" <> "keepId"
)
UPDATE "nonConformance" nc
SET "nonConformanceTypeId" = d."keepId"
FROM dupes d
WHERE nc."nonConformanceTypeId" = d."id";

-- Delete the duplicate rows
WITH ranked AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "companyId", "name"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "keepId"
  FROM "nonConformanceType"
)
DELETE FROM "nonConformanceType" nct
USING ranked r
WHERE nct."id" = r."id"
  AND r."id" <> r."keepId";

ALTER TABLE "nonConformanceType"
  ADD CONSTRAINT "nonConformanceType_companyId_name_key" UNIQUE ("companyId", "name");
