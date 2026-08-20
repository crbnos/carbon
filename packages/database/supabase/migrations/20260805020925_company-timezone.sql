-- Pin the database clock: CURRENT_DATE / date_trunc business logic must not
-- depend on a server-local timezone. All prod runtimes already default to UTC;
-- this makes it explicit and covers self-hosted installs.
ALTER DATABASE postgres SET timezone TO 'UTC';

-- Company-level business timezone. Anything ledger-scoped (accounting periods,
-- posting dates, sequence date tokens) derives its calendar day here — one set
-- of books needs one calendar. location.timezone remains the anchor for
-- operational, physically-local work (shifts, scheduling, MES).
ALTER TABLE "company"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- Backfill from each company's first location ("first location = HQ"
-- assumption). location.timezone was free text before the picker existed, so
-- only copy values Postgres can actually resolve — an unresolvable name would
-- make every later `now() AT TIME ZONE "timezone"` (company_today) raise at
-- posting time, and the validity CHECK added later is NOT VALID so it would
-- never reject the backfilled row. Companies with no resolvable location
-- timezone keep the 'UTC' default.
UPDATE "company" c
SET "timezone" = l."timezone"
FROM (
  SELECT DISTINCT ON ("companyId") "companyId", "timezone"
  FROM "location"
  WHERE "timezone" IS NOT NULL
    AND "timezone" <> ''
    AND EXISTS (
      SELECT 1 FROM pg_timezone_names tz WHERE tz.name = "location"."timezone"
    )
  ORDER BY "companyId", "createdAt" ASC
) l
WHERE c."id" = l."companyId";

-- Postgres views freeze their column manifest at CREATE time, so adding
-- columns to "company" does not propagate to the "companies" view unless we
-- recreate it. Drop + recreate to refresh the column list.
DROP VIEW IF EXISTS "companies";
CREATE OR REPLACE VIEW "companies" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    c.*,
    uc.*,
    et.name AS "employeeType",
    cg.name AS "companyGroupName",
    cg."ownerId"
  FROM "userToCompany" uc
  INNER JOIN "company" c
    ON c.id = uc."companyId"
  LEFT JOIN "employee" e
    ON e.id = uc."userId" AND e."companyId" = uc."companyId"
  LEFT JOIN "employeeType" et
    ON et.id = e."employeeTypeId"
  LEFT JOIN "companyGroup" cg
    ON cg.id = c."companyGroupId";
