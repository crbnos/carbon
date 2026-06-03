-- Rename the Custom Rules feature to Storage Rules (now lives in the Inventory
-- module). Table/enum/customField rename only — the column set is unchanged.
--
-- Constraint and index names keep their legacy `customRule*` prefix: they are
-- internal identifiers never referenced by application code, and renaming them
-- adds churn + failure surface for no functional gain.

----------------------------------------------------------------------
-- Core rule table
----------------------------------------------------------------------
ALTER TABLE "customRule" RENAME TO "storageRule";

----------------------------------------------------------------------
-- Assignment tables (storageUnit assignment table was already dropped)
----------------------------------------------------------------------
ALTER TABLE "customRuleItemAssignment"       RENAME TO "storageRuleItemAssignment";
ALTER TABLE "customRuleWorkCenterAssignment" RENAME TO "storageRuleWorkCenterAssignment";

----------------------------------------------------------------------
-- Target-type enum
----------------------------------------------------------------------
ALTER TYPE "customRuleTargetType" RENAME TO "storageRuleTargetType";

----------------------------------------------------------------------
-- Custom field table registration
----------------------------------------------------------------------
UPDATE "customFieldTable"
   SET "table" = 'storageRule',
       "name"  = 'Storage Rule'
 WHERE "table" = 'customRule';
