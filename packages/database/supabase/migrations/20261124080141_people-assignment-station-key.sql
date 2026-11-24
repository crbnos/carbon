-- A person's shift can be split across several stations (`hours` per row,
-- 20260731192616_people-split-hours.sql), so the key is one row per person,
-- date, shift and station. Every row the old key allowed fits the new one.
CREATE UNIQUE INDEX IF NOT EXISTS "peopleAssignment_person_day_station_key"
    ON "peopleAssignment" ("companyId", "employeeId", "date", COALESCE("shiftId", ''), "workCenterId");

DROP INDEX IF EXISTS "peopleAssignment_person_day_key";
