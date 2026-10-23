-- Missing time: who must record time, and which days count
-- (.ai/research/missing-time-report.md).
--
-- `employeeJob.timesheetRequired` puts an employee in the missing-time
-- population. It defaults to true, so every employee stays in it until
-- someone turns it off — from the person's Job page or from the Missing Time
-- report. The report, the daily notification and the close check all read
-- `get_missing_timesheet_days`, so the filter lives there.
--
-- The function also stops listing:
--   * a day that has not ended — the last day it lists is yesterday on the
--     company's calendar (`company_today`);
--   * a day before the employee's start date (`employeeJob.startDate`).

ALTER TABLE "employeeJob"
  ADD COLUMN "timesheetRequired" BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION get_missing_timesheet_days(p_company_id TEXT, p_from DATE, p_to DATE)
RETURNS TABLE ("employeeId" TEXT, "date" DATE, "managerId" TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT es."employeeId", d::date, ej."managerId"
  FROM generate_series(
    p_from,
    LEAST(p_to, company_today(p_company_id) - 1),
    interval '1 day'
  ) AS d
  JOIN "employeeShift" es ON es."companyId" = p_company_id
  JOIN "shift" s ON s."id" = es."shiftId" AND s."active"
  JOIN "employee" e ON e."id" = es."employeeId" AND e."companyId" = p_company_id AND e."active"
  LEFT JOIN "employeeJob" ej ON ej."id" = es."employeeId" AND ej."companyId" = p_company_id
  WHERE CASE EXTRACT(ISODOW FROM d)
          WHEN 1 THEN s."monday" WHEN 2 THEN s."tuesday" WHEN 3 THEN s."wednesday"
          WHEN 4 THEN s."thursday" WHEN 5 THEN s."friday" WHEN 6 THEN s."saturday"
          ELSE s."sunday" END
    AND COALESCE(ej."timesheetRequired", true)
    AND (ej."startDate" IS NULL OR d::date >= ej."startDate")
    AND NOT EXISTS (SELECT 1 FROM "holiday" h WHERE h."companyId" = p_company_id AND h."date" = d::date)
    AND NOT EXISTS (SELECT 1 FROM "peopleAbsence" a
                    WHERE a."companyId" = p_company_id AND a."employeeId" = es."employeeId" AND a."date" = d::date)
    AND NOT EXISTS (SELECT 1 FROM "timesheetEntry" t
                    WHERE t."companyId" = p_company_id AND t."employeeId" = es."employeeId" AND t."entryDate" = d::date)
$$;
