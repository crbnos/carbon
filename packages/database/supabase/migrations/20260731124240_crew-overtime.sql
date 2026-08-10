-- Planned overtime per crew assignment: a delta on top of the person's shift
-- hours ("+2h OT"), authorized by the supervisor per station per date.
-- Total hours for the day = shift hours + "overtimeHours".
ALTER TABLE "crewAssignment"
  ADD COLUMN "overtimeHours" NUMERIC(5,2) NOT NULL DEFAULT 0
  CHECK ("overtimeHours" >= 0);
