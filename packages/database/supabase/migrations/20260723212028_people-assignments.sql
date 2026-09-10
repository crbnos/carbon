-- Daily people / station assignment (People board)
-- Spec: .ai/specs/2026-07-24-daily-people-station-assignment.md

-- Planned person→station per date (the manning-board row)
CREATE TABLE IF NOT EXISTS "peopleAssignment" (
    "id" TEXT NOT NULL DEFAULT id('pasn'),
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
CREATE UNIQUE INDEX IF NOT EXISTS "peopleAssignment_person_day_key"
    ON "peopleAssignment" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX IF NOT EXISTS "peopleAssignment_board_idx"
    ON "peopleAssignment" ("companyId", "locationId", "date");
CREATE INDEX IF NOT EXISTS "peopleAssignment_workCenter_idx"
    ON "peopleAssignment" ("workCenterId", "date");
CREATE INDEX IF NOT EXISTS "peopleAssignment_locationId_idx" ON "peopleAssignment" ("locationId");
CREATE INDEX IF NOT EXISTS "peopleAssignment_employeeId_idx" ON "peopleAssignment" ("employeeId");
CREATE INDEX IF NOT EXISTS "peopleAssignment_shiftId_idx" ON "peopleAssignment" ("shiftId");
CREATE INDEX IF NOT EXISTS "peopleAssignment_createdBy_idx" ON "peopleAssignment" ("createdBy");

ALTER TABLE "public"."peopleAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."peopleAssignment" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."peopleAssignment" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."peopleAssignment" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."peopleAssignment" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

-- Person is out for the date (person-level, not station-bound)
CREATE TABLE IF NOT EXISTS "peopleAbsence" (
    "id" TEXT NOT NULL DEFAULT id('pabs'),
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

CREATE UNIQUE INDEX IF NOT EXISTS "peopleAbsence_person_day_key"
    ON "peopleAbsence" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX IF NOT EXISTS "peopleAbsence_companyId_date_idx" ON "peopleAbsence" ("companyId", "date");
CREATE INDEX IF NOT EXISTS "peopleAbsence_employeeId_idx" ON "peopleAbsence" ("employeeId");
CREATE INDEX IF NOT EXISTS "peopleAbsence_shiftId_idx" ON "peopleAbsence" ("shiftId");
CREATE INDEX IF NOT EXISTS "peopleAbsence_createdBy_idx" ON "peopleAbsence" ("createdBy");

ALTER TABLE "public"."peopleAbsence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."peopleAbsence" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."peopleAbsence" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."peopleAbsence" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."peopleAbsence" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);
