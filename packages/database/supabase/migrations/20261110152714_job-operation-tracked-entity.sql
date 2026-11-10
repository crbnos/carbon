-- Which serial units a job operation applies to. An operation with no rows
-- applies to every unit of its make method (every operation before this table).
-- A rework copy applies only to the units sent into it: before this table every
-- open unit of the make method showed as not done at a rework operation.
--
-- Written by the system only (the trigger-rework posting); read by MES and ERP.
CREATE TABLE "jobOperationTrackedEntity" (
    "jobOperationId" TEXT NOT NULL,
    "trackedEntityId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),

    PRIMARY KEY ("jobOperationId", "trackedEntityId"),
    FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
    FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE CASCADE,
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "jobOperationTrackedEntity_trackedEntityId_idx" ON "jobOperationTrackedEntity" ("trackedEntityId");
CREATE INDEX "jobOperationTrackedEntity_companyId_idx" ON "jobOperationTrackedEntity" ("companyId");
CREATE INDEX "jobOperationTrackedEntity_createdBy_idx" ON "jobOperationTrackedEntity" ("createdBy");
