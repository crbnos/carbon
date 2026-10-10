-- Projects Phase 3: a peg's demand source uses the `demandSourceType` enum
-- (Sales Order, Job Material, Project Material, Project Borrow), the demand
-- MRP pegs. `demandForecastSourceType` has no Project Borrow value, so a peg
-- for a borrower's payback could not be stored.
ALTER TABLE "projectPeg"
  ALTER COLUMN "demandSourceType" TYPE "demandSourceType"
  USING "demandSourceType"::TEXT::"demandSourceType";
