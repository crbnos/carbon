CREATE INDEX IF NOT EXISTS "jobOperation_assignee_companyId_idx" ON "jobOperation" ("assignee", "companyId");
CREATE INDEX IF NOT EXISTS "productionEvent_endTime_companyId_idx" ON "productionEvent" ("endTime", "companyId") WHERE "endTime" IS NULL;
