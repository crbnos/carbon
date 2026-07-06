-- Add an optional upper bound to approval rules. With both bounds set,
-- a rule represents a half-open range [lowerBoundAmount, upperBoundAmount).
-- NULL upperBoundAmount preserves today's "unbounded above" behavior, so
-- existing rules continue working without backfill.

ALTER TABLE "approvalRule"
  ADD COLUMN "upperBoundAmount" NUMERIC,
  ADD CONSTRAINT "approvalRule_upperBoundAmount_check"
    CHECK (
      "upperBoundAmount" IS NULL
      OR "upperBoundAmount" > "lowerBoundAmount"
    );
