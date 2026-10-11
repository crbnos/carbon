-- The daily missing-time check (Government Contracting 5a,
-- 20261011194847_timesheet-missing-time-sweep.sql): which scheduled work days
-- `get_missing_timesheet_days` lists, and when the sweep wakes the job.
-- Run from the repository root against an existing local database that has an
-- active employee in a company with a location:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/timesheet-missing-time.test.sql
-- Everything is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect(label text, actual boolean, expected boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

DO $proof$
DECLARE
  -- 2030-01-07 is a Monday; 2030-01-08 a Tuesday.
  monday CONSTANT date := DATE '2030-01-07';
  tuesday CONSTANT date := DATE '2030-01-08';
  v_company text;
  v_employee text;
  v_location text;
  v_shift text;
  v_project text;
  v_category text;
  v_holiday text;
  v_absence text;
  v_entry text;
  listed boolean;
BEGIN
  SELECT e."companyId", e."id", l."id"
  INTO v_company, v_employee, v_location
  FROM "employee" e
  JOIN "location" l ON l."companyId" = e."companyId"
  WHERE e."active"
  ORDER BY e."companyId", e."id", l."id"
  LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'The local database has no active employee in a company with a location';
  END IF;

  -- Only this shift counts for the employee.
  DELETE FROM "employeeShift" WHERE "employeeId" = v_employee AND "companyId" = v_company;
  INSERT INTO "shift" ("name", "startTime", "endTime", "locationId", "monday", "tuesday",
                       "wednesday", "thursday", "friday", "saturday", "sunday", "companyId", "createdBy")
  VALUES ('Missing time test', '08:00', '16:00', v_location, true, false,
          false, false, false, false, false, v_company, 'system')
  RETURNING "id" INTO v_shift;
  INSERT INTO "employeeShift" ("employeeId", "shiftId", "companyId")
  VALUES (v_employee, v_shift, v_company);

  -- 1. A Monday shift and no entry on a Monday: listed. Not on the Tuesday.
  SELECT EXISTS (
    SELECT 1 FROM get_missing_timesheet_days(v_company, monday, tuesday) m
    WHERE m."employeeId" = v_employee AND m."date" = monday
  ) INTO listed;
  PERFORM pg_temp.expect('Monday with no entry is listed', listed, true);
  SELECT EXISTS (
    SELECT 1 FROM get_missing_timesheet_days(v_company, monday, tuesday) m
    WHERE m."employeeId" = v_employee AND m."date" = tuesday
  ) INTO listed;
  PERFORM pg_temp.expect('Tuesday is not a shift day', listed, false);

  -- 2a. A holiday removes the day.
  INSERT INTO "holiday" ("name", "date", "companyId", "createdBy")
  VALUES ('Missing time test', monday, v_company, 'system')
  RETURNING "id" INTO v_holiday;
  SELECT EXISTS (
    SELECT 1 FROM get_missing_timesheet_days(v_company, monday, monday) m
    WHERE m."employeeId" = v_employee
  ) INTO listed;
  PERFORM pg_temp.expect('A holiday removes the day', listed, false);
  DELETE FROM "holiday" WHERE "id" = v_holiday;

  -- 2b. A recorded absence removes the day.
  INSERT INTO "peopleAbsence" ("companyId", "employeeId", "date", "createdBy")
  VALUES (v_company, v_employee, monday, 'system')
  RETURNING "id" INTO v_absence;
  SELECT EXISTS (
    SELECT 1 FROM get_missing_timesheet_days(v_company, monday, monday) m
    WHERE m."employeeId" = v_employee
  ) INTO listed;
  PERFORM pg_temp.expect('An absence removes the day', listed, false);
  DELETE FROM "peopleAbsence" WHERE "id" = v_absence;

  -- 2c. A timesheet entry removes the day.
  INSERT INTO "laborCategory" ("name", "companyId", "createdBy")
  VALUES ('Missing time test', v_company, 'system')
  RETURNING "id" INTO v_category;
  INSERT INTO "project" ("name", "companyId", "createdBy")
  VALUES ('Missing time test', v_company, 'system')
  RETURNING "id" INTO v_project;
  INSERT INTO "timesheetEntry" ("companyId", "employeeId", "entryDate", "projectId",
                                "laborCategoryId", "hours", "createdBy")
  VALUES (v_company, v_employee, monday, v_project, v_category, 8, 'system')
  RETURNING "id" INTO v_entry;
  SELECT EXISTS (
    SELECT 1 FROM get_missing_timesheet_days(v_company, monday, monday) m
    WHERE m."employeeId" = v_employee
  ) INTO listed;
  PERFORM pg_temp.expect('An entry removes the day', listed, false);
  DELETE FROM "timesheetEntry" WHERE "id" = v_entry;

  -- 3. The sweep has work only while a company runs DCAA mode.
  UPDATE "companySettings" SET "timekeepingControls" = 'Standard'
  WHERE "timekeepingControls" = 'DCAA';
  PERFORM pg_temp.expect('No DCAA company: no work',
    util.timesheet_missing_time_has_work(), false);
  INSERT INTO "companySettings" ("id", "timekeepingControls")
  VALUES (v_company, 'DCAA')
  ON CONFLICT ("id") DO UPDATE SET "timekeepingControls" = 'DCAA';
  PERFORM pg_temp.expect('A DCAA company: work',
    util.timesheet_missing_time_has_work(), true);
END;
$proof$;

ROLLBACK;
