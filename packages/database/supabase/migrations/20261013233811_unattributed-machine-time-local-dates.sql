-- The Unattributed Time list shows each row's times in its work center's
-- location timezone, but its date filters cut days in the company timezone.
-- When the two differ, a row shown as 9 PM on the 12th matched a filter for
-- the 13th. This view gives each row its start and end date in the location's
-- timezone (else the company's, else UTC: the precedence of
-- getLocationTimeZone), so the list and its review queue filter on the dates
-- the list shows.
CREATE OR REPLACE VIEW "unattributedMachineTimes" WITH (SECURITY_INVOKER = true) AS
SELECT
  u.*,
  (u."startTime" AT TIME ZONE tz.name)::date AS "startDate",
  (u."endTime" AT TIME ZONE tz.name)::date AS "endDate"
FROM "unattributedMachineTime" u
LEFT JOIN "workCenter" w
  ON w."id" = u."workCenterId" AND w."companyId" = u."companyId"
LEFT JOIN "location" l
  ON l."id" = w."locationId" AND l."companyId" = u."companyId"
LEFT JOIN "company" c
  ON c."id" = u."companyId"
CROSS JOIN LATERAL (
  SELECT COALESCE(NULLIF(l."timezone", ''), NULLIF(c."timezone", ''), 'UTC') AS name
) tz;
