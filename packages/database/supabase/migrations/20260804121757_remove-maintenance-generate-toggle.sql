-- Preventive maintenance dispatch generation is now standardized for all
-- companies (a fixed advance horizon in the scheduled dispatch job), so the
-- per-company toggle and advance-days settings are no longer used.
ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "maintenanceGenerateInAdvance",
  DROP COLUMN IF EXISTS "maintenanceAdvanceDays";
