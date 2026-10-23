-- Government contracting Phase 5a: enums.
-- Postgres refuses a new enum value in the transaction that adds it, so these
-- statements get their own migration.
CREATE TYPE "projectCostObjective" AS ENUM ('Direct', 'IR&D', 'B&P', 'Indirect', 'Commercial');
CREATE TYPE "accountAllowability" AS ENUM ('Allowable', 'Expressly Unallowable', 'Mutually Agreed Unallowable', 'Directly Associated Unallowable');
CREATE TYPE "elementOfCost" AS ENUM ('Labor', 'Material', 'Subcontract', 'Other Direct', 'Travel');
CREATE TYPE "timekeepingControls" AS ENUM ('Standard', 'DCAA');
CREATE TYPE "flsaStatus" AS ENUM ('Exempt', 'Non-Exempt');
ALTER TYPE "timesheetEntryStatus" ADD VALUE IF NOT EXISTS 'Pending Employee Review';
