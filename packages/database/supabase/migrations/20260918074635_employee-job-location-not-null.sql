-- employeeJob.locationId was nullable with no default, so callers that omitted it
-- (notably the auto-generated people_insertEmployeeJob / people_updateEmployeeJob
-- API/MCP tools, where locationId is optional) could write or overwrite NULL.
-- Backfill existing NULLs to the company's first-created location, then enforce
-- NOT NULL so a location can no longer go missing.

UPDATE "employeeJob" AS ej
SET "locationId" = first_location."id"
FROM (
  SELECT DISTINCT ON ("companyId") "companyId", "id"
  FROM "location"
  ORDER BY "companyId", "createdAt" ASC, "id" ASC
) AS first_location
WHERE ej."locationId" IS NULL
  AND ej."companyId" = first_location."companyId";

-- Any row still NULL belongs to a company with no location at all. Every company
-- is created with one, but all of them can be deleted (there is no last-location
-- guard), so there is nothing to backfill from. Fail with an actionable message
-- naming the companies rather than a bare NOT NULL violation — the fix is to give
-- each company a location (or remove the orphaned employeeJob rows) and re-run.
DO $$
DECLARE
  orphan_companies text;
BEGIN
  SELECT string_agg(DISTINCT "companyId", ', ')
  INTO orphan_companies
  FROM "employeeJob"
  WHERE "locationId" IS NULL;

  IF orphan_companies IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot set employeeJob.locationId NOT NULL: companies with employeeJob rows but no location: %', orphan_companies;
  END IF;
END $$;

ALTER TABLE "employeeJob" ALTER COLUMN "locationId" SET NOT NULL;
