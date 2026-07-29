-- Daily crew / station assignment (Crew board)
-- Spec: .ai/specs/2026-07-24-daily-crew-station-assignment.md

-- Planned person→station per date (the manning-board row)
CREATE TABLE IF NOT EXISTS "crewAssignment" (
    "id" TEXT NOT NULL DEFAULT id('crew'),
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL REFERENCES "location"("id") ON DELETE CASCADE,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
    "date" DATE NOT NULL,
    -- null = whole day (single-shift shops never set it)
    "shiftId" TEXT REFERENCES "shift"("id") ON DELETE SET NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

-- One magnet per person per day/shift (drag = move)
CREATE UNIQUE INDEX IF NOT EXISTS "crewAssignment_person_day_key"
    ON "crewAssignment" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX IF NOT EXISTS "crewAssignment_board_idx"
    ON "crewAssignment" ("companyId", "locationId", "date");
CREATE INDEX IF NOT EXISTS "crewAssignment_workCenter_idx"
    ON "crewAssignment" ("workCenterId", "date");
CREATE INDEX IF NOT EXISTS "crewAssignment_locationId_idx" ON "crewAssignment" ("locationId");
CREATE INDEX IF NOT EXISTS "crewAssignment_employeeId_idx" ON "crewAssignment" ("employeeId");
CREATE INDEX IF NOT EXISTS "crewAssignment_shiftId_idx" ON "crewAssignment" ("shiftId");
CREATE INDEX IF NOT EXISTS "crewAssignment_createdBy_idx" ON "crewAssignment" ("createdBy");

ALTER TABLE "public"."crewAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."crewAssignment" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."crewAssignment" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."crewAssignment" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."crewAssignment" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

-- Person is out for the date (person-level, not station-bound)
CREATE TABLE IF NOT EXISTS "crewAbsence" (
    "id" TEXT NOT NULL DEFAULT id('crab'),
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
    "date" DATE NOT NULL,
    "shiftId" TEXT REFERENCES "shift"("id") ON DELETE SET NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "crewAbsence_person_day_key"
    ON "crewAbsence" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX IF NOT EXISTS "crewAbsence_companyId_date_idx" ON "crewAbsence" ("companyId", "date");
CREATE INDEX IF NOT EXISTS "crewAbsence_employeeId_idx" ON "crewAbsence" ("employeeId");
CREATE INDEX IF NOT EXISTS "crewAbsence_shiftId_idx" ON "crewAbsence" ("shiftId");
CREATE INDEX IF NOT EXISTS "crewAbsence_createdBy_idx" ON "crewAbsence" ("createdBy");

ALTER TABLE "public"."crewAbsence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."crewAbsence" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."crewAbsence" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."crewAbsence" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."crewAbsence" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);
