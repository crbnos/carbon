-- Add a stable systemType column to employeeType so system-managed types
-- (Admin, Console Operator) are identified by enum value, not display name.
-- Admins can freely rename the display name without breaking lookups.

-- 1. Create enum
CREATE TYPE "employeeTypeSystemType" AS ENUM ('Admin', 'Console Operator');

-- 2. Add nullable column
ALTER TABLE "employeeType"
  ADD COLUMN "systemType" "employeeTypeSystemType";

-- 3. Backfill existing seeded records
UPDATE "employeeType" SET "systemType" = 'Admin'
  WHERE name = 'Admin' AND protected = true;

UPDATE "employeeType" SET "systemType" = 'Console Operator'
  WHERE name = 'Console Operator' AND protected = true;

-- 4. Partial unique index — each company gets at most one of each system type
CREATE UNIQUE INDEX "employeeType_companyId_systemType_unique"
  ON "employeeType" ("companyId", "systemType")
  WHERE "systemType" IS NOT NULL;
