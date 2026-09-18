-- PR #232 renamed non-conformances to issues by editing already-applied
-- migrations (20250327140050_ncr.sql, 20250502132738_gauge-calibration.sql),
-- so databases built before it still hold the old seeded names. Fresh
-- databases already have the new names and every UPDATE here is a no-op.

UPDATE "customFieldTable" SET "name" = 'Issue'
WHERE "table" = 'nonConformance' AND "name" = 'Non-Conformance';

UPDATE "customFieldTable" SET "name" = 'Issue Type'
WHERE "table" = 'nonConformanceType' AND "name" = 'Non-Conformance Type';

UPDATE "sequence" SET "name" = 'Issue'
WHERE "table" = 'nonConformance' AND "name" = 'Non-Conformance';

-- Guards match the "nonConformanceType_companyId_name_key" unique index on
-- ("companyId", LOWER("name")): skip the rename where the user already
-- created a type with the new name.
UPDATE "nonConformanceType" SET "name" = 'Material Issue'
WHERE "name" = 'Material Non-Conformance' AND "createdBy" = 'system'
  AND NOT EXISTS (
    SELECT 1 FROM "nonConformanceType" t
    WHERE t."companyId" = "nonConformanceType"."companyId"
      AND LOWER(t."name") = 'material issue'
  );

UPDATE "nonConformanceType" SET "name" = 'Supplier Issue'
WHERE "name" = 'Supplier Non-Conformance' AND "createdBy" = 'system'
  AND NOT EXISTS (
    SELECT 1 FROM "nonConformanceType" t
    WHERE t."companyId" = "nonConformanceType"."companyId"
      AND LOWER(t."name") = 'supplier issue'
  );
