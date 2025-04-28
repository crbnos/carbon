CREATE TABLE "task" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL DEFAULT 'system',
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "task_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "task_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "task_companyId_idx" ON "task" ("companyId");