-- Drop the approval rule upper bound. A tier's ceiling is the next-higher
-- tier's minimum, so the stored column is redundant. Dropping the column also
-- drops its CHECK constraint.

ALTER TABLE "approvalRule" DROP COLUMN "upperBoundAmount";
