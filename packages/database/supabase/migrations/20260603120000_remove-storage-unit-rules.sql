-- Custom Rules: remove the `storageUnit` target type.
--
-- Bin-level `place`/`pick` guards are now owned by item-target rules (which
-- already expose the `storageUnit.*` context fields), so storage-unit rules are
-- redundant. The feature is new, so existing storage-unit rules are DELETED
-- rather than migrated.

-- 1. Drop existing storage-unit rules. FK cascade clears their assignment rows
--    in customRuleStorageUnitAssignment.
DELETE FROM "customRule" WHERE "targetType" = 'storageUnit';

-- 2. Drop the storage-unit assignment table (its RLS policies drop with it).
DROP TABLE "customRuleStorageUnitAssignment";

-- 3. Recreate the target-type enum without 'storageUnit'. Postgres can't drop a
--    value from an enum in place, so swap the column onto a fresh type.
ALTER TABLE "customRule" ALTER COLUMN "targetType" DROP DEFAULT;
ALTER TYPE "customRuleTargetType" RENAME TO "customRuleTargetType_old";
CREATE TYPE "customRuleTargetType" AS ENUM ('item', 'workCenter');
ALTER TABLE "customRule"
  ALTER COLUMN "targetType" TYPE "customRuleTargetType"
  USING "targetType"::text::"customRuleTargetType";
ALTER TABLE "customRule" ALTER COLUMN "targetType" SET DEFAULT 'item';
DROP TYPE "customRuleTargetType_old";
