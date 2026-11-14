-- A job's snapshot of its make methods' corrections, taken when the job's
-- method is created, so later edits to the item's method don't change an open
-- job. `definition` holds the correction's operations (with steps, tools,
-- parameters) and materials; the trigger-correction posting instantiates it
-- for a unit. Spec: .ai/specs/2026-11-10-conditional-corrections.md

CREATE TABLE "jobCorrection" (
    "id" TEXT NOT NULL DEFAULT id('jcor'),
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jobMakeMethodId" TEXT NOT NULL,
    -- Provenance only: the method correction this was copied from.
    "methodCorrectionId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "returnTo" "correctionReturnTo" NOT NULL,
    "maxAttempts" INTEGER CHECK ("maxAttempts" IS NULL OR "maxAttempts" > 0),
    "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
    FOREIGN KEY ("jobMakeMethodId") REFERENCES "jobMakeMethod"("id") ON DELETE CASCADE,
    FOREIGN KEY ("methodCorrectionId", "companyId")
        REFERENCES "methodCorrection"("id", "companyId")
        ON DELETE SET NULL ("methodCorrectionId")
);

CREATE INDEX "jobCorrection_jobId_idx" ON "jobCorrection" ("jobId");
CREATE INDEX "jobCorrection_jobMakeMethodId_idx" ON "jobCorrection" ("jobMakeMethodId");
CREATE INDEX "jobCorrection_methodCorrectionId_idx" ON "jobCorrection" ("methodCorrectionId");
CREATE INDEX "jobCorrection_companyId_idx" ON "jobCorrection" ("companyId");
CREATE INDEX "jobCorrection_createdBy_idx" ON "jobCorrection" ("createdBy");

-- The job's snapshot of the result mappings, on the job's own steps.
CREATE TABLE "jobCorrectionTrigger" (
    "id" TEXT NOT NULL DEFAULT id('jctr'),
    "companyId" TEXT NOT NULL,
    "jobOperationStepId" TEXT NOT NULL,
    "jobCorrectionId" TEXT NOT NULL,
    "listValue" TEXT,
    "measurementCondition" "correctionMeasurementCondition",

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("jobOperationStepId") REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
    FOREIGN KEY ("jobCorrectionId", "companyId")
        REFERENCES "jobCorrection"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "jobCorrectionTrigger_one_result_check"
        CHECK (("listValue" IS NULL) <> ("measurementCondition" IS NULL))
);

CREATE INDEX "jobCorrectionTrigger_jobCorrectionId_idx" ON "jobCorrectionTrigger" ("jobCorrectionId");
CREATE INDEX "jobCorrectionTrigger_companyId_idx" ON "jobCorrectionTrigger" ("companyId");
CREATE INDEX "jobCorrectionTrigger_createdBy_idx" ON "jobCorrectionTrigger" ("createdBy");
CREATE UNIQUE INDEX "jobCorrectionTrigger_step_listValue_key"
    ON "jobCorrectionTrigger" ("jobOperationStepId", "listValue")
    WHERE "listValue" IS NOT NULL;
CREATE UNIQUE INDEX "jobCorrectionTrigger_step_measurement_key"
    ON "jobCorrectionTrigger" ("jobOperationStepId", "measurementCondition")
    WHERE "measurementCondition" IS NOT NULL;

-- A use of a correction is a rework: its operations carry the rework's id.
-- For a correction the rework's target is the operation that found the
-- problem, and its reason holds the result that suggested it.
ALTER TABLE "rework" ADD COLUMN "jobCorrectionId" TEXT;
ALTER TABLE "rework" ADD CONSTRAINT "rework_jobCorrectionId_fkey"
    FOREIGN KEY ("jobCorrectionId", "companyId")
    REFERENCES "jobCorrection"("id", "companyId")
    ON DELETE SET NULL ("jobCorrectionId");
CREATE INDEX "rework_jobCorrectionId_idx" ON "rework" ("jobCorrectionId");
