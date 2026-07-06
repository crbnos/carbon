-- Custom Rules refactor — enum additions only.
-- Split from the table migration so ALTER TYPE ADD VALUE statements
-- run outside the surrounding DDL transaction (Postgres requirement
-- prior to enum value being visible to subsequent statements).

-- Add storageUnit + workCenter surfaces to the existing enum.
ALTER TYPE "transactionSurface" ADD VALUE IF NOT EXISTS 'place';
ALTER TYPE "transactionSurface" ADD VALUE IF NOT EXISTS 'pick';
ALTER TYPE "transactionSurface" ADD VALUE IF NOT EXISTS 'operationStart';
ALTER TYPE "transactionSurface" ADD VALUE IF NOT EXISTS 'operationFinish';
ALTER TYPE "transactionSurface" ADD VALUE IF NOT EXISTS 'materialIssue';
ALTER TYPE "transactionSurface" ADD VALUE IF NOT EXISTS 'materialReceive';

-- New enum identifying which entity a customRule applies to.
CREATE TYPE "customRuleTargetType" AS ENUM ('item', 'storageUnit', 'workCenter');
