-- Timecard upgrades: explicit breaks, reporting views, and break metadata

CREATE TABLE "timeCardBreak" (
  "id" TEXT NOT NULL DEFAULT id('tcb'),
  "timeCardEntryId" TEXT,
  "employeeId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "breakType" TEXT NOT NULL DEFAULT 'Break',
  "startTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "endTime" TIMESTAMP WITH TIME ZONE,
  "note" TEXT,
  "startedBy" TEXT NOT NULL,
  "endedBy" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "timeCardBreak_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "timeCardBreak_timeCardEntryId_fkey" FOREIGN KEY ("timeCardEntryId") REFERENCES "timeCardEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "timeCardBreak_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timeCardBreak_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timeCardBreak_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "timeCardBreak_endedBy_fkey" FOREIGN KEY ("endedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "timeCardBreak_breakType_check" CHECK ("breakType" IN ('Break', 'Lunch')),
  CONSTRAINT "timeCardBreak_endTime_after_startTime" CHECK ("endTime" IS NULL OR "endTime" >= "startTime")
);

CREATE INDEX "timeCardBreak_employeeId_companyId_idx" ON "timeCardBreak" ("employeeId", "companyId");
CREATE INDEX "timeCardBreak_startTime_idx" ON "timeCardBreak" ("startTime");
CREATE INDEX "timeCardBreak_open_breaks_idx" ON "timeCardBreak" ("companyId", "employeeId") WHERE "endTime" IS NULL;

ALTER TABLE "timeCardBreak" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "timeCardBreak"
FOR SELECT USING (
  (
    "employeeId" = auth.uid()::text
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  )
  OR
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "timeCardBreak"
FOR INSERT WITH CHECK (
  (
    "employeeId" = auth.uid()::text
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  )
  OR
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "timeCardBreak"
FOR UPDATE USING (
  (
    "employeeId" = auth.uid()::text
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  )
  OR
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "timeCardBreak"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_delete'))::text[]
  )
);

CREATE OR REPLACE VIEW "timeCardBreaks" WITH (SECURITY_INVOKER=true) AS
SELECT
  tcb."id",
  tcb."timeCardEntryId",
  tcb."employeeId",
  tcb."companyId",
  tcb."breakType",
  tcb."startTime",
  tcb."endTime",
  tcb."note",
  tcb."startedBy",
  tcb."endedBy",
  tcb."createdAt",
  tcb."updatedAt",
  u."firstName",
  u."lastName",
  u."avatarUrl"
FROM "timeCardBreak" tcb
INNER JOIN "user" u ON tcb."employeeId" = u."id";
