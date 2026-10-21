-- Government contracting Phase 5d: R&D tax tags.

ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "isBusinessComponent" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "rdComponentType" TEXT CHECK ("rdComponentType" IN ('Product', 'Process', 'All Others')),
  ADD COLUMN IF NOT EXISTS "rdSoftwareType" TEXT CHECK ("rdSoftwareType" IN ('Internal Use', 'Dual Function', 'Non-Internal Use', 'Excepted'));
ALTER TABLE "projectElement" DROP CONSTRAINT IF EXISTS "projectElement_rdComponent_check";
ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_rdComponent_check"
  CHECK ("isBusinessComponent" OR ("rdComponentType" IS NULL AND "rdSoftwareType" IS NULL));

-- The work location is a location of the entry's own company: the FK uses
-- location's UNIQUE ("id", "companyId"), and a deleted location clears only
-- the work location.
ALTER TABLE "timesheetEntry"
  ADD COLUMN IF NOT EXISTS "rdActivityRole" "rdActivityRole",
  ADD COLUMN IF NOT EXISTS "workLocationId" TEXT;
ALTER TABLE "timesheetEntry" DROP CONSTRAINT IF EXISTS "timesheetEntry_workLocationId_fkey";
ALTER TABLE "timesheetEntry" ADD CONSTRAINT "timesheetEntry_workLocationId_fkey"
  FOREIGN KEY ("workLocationId", "companyId") REFERENCES "location"("id", "companyId") ON DELETE SET NULL ("workLocationId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_workLocationId_idx" ON "timesheetEntry" ("workLocationId", "companyId");

ALTER TABLE "laborCategory"
  ADD COLUMN IF NOT EXISTS "rdActivityRole" "rdActivityRole";

ALTER TABLE "customerContract"
  ADD COLUMN IF NOT EXISTS "researchFunded" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "paymentContingentOnSuccess" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "contractorRetainsRights" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "employeeJob"
  ADD COLUMN IF NOT EXISTS "isOfficer" BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing entries took place at the employee's job location (the spec default).
UPDATE "timesheetEntry" t
SET "workLocationId" = ej."locationId"
FROM "employeeJob" ej
WHERE ej."id" = t."employeeId" AND ej."companyId" = t."companyId" AND t."workLocationId" IS NULL;
