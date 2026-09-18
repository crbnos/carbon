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

ALTER TABLE "employeeJob" ALTER COLUMN "locationId" SET NOT NULL;
