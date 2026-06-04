-- Cosmetic: rename the constraints + indexes left with the legacy `customRule*`
-- prefix after the table rename (Postgres keeps constraint/index names across an
-- ALTER TABLE ... RENAME). Internal identifiers only — no app code references
-- them; this just keeps the schema self-consistent.

----------------------------------------------------------------------
-- storageRule (was customRule)
----------------------------------------------------------------------
ALTER TABLE "storageRule" RENAME CONSTRAINT "customRule_companyId_fkey"     TO "storageRule_companyId_fkey";
ALTER TABLE "storageRule" RENAME CONSTRAINT "customRule_createdBy_fkey"     TO "storageRule_createdBy_fkey";
ALTER TABLE "storageRule" RENAME CONSTRAINT "customRule_updatedBy_fkey"     TO "storageRule_updatedBy_fkey";
ALTER TABLE "storageRule" RENAME CONSTRAINT "customRule_companyId_name_key" TO "storageRule_companyId_name_key";
ALTER TABLE "storageRule" RENAME CONSTRAINT "customRule_surfaces_nonempty"  TO "storageRule_surfaces_nonempty";

ALTER INDEX IF EXISTS "customRule_companyId_idx"                 RENAME TO "storageRule_companyId_idx";
ALTER INDEX IF EXISTS "customRule_companyId_active_partial_idx"  RENAME TO "storageRule_companyId_active_partial_idx";
ALTER INDEX IF EXISTS "customRule_companyId_targetType_active_idx" RENAME TO "storageRule_companyId_targetType_active_idx";

----------------------------------------------------------------------
-- storageRuleItemAssignment (was customRuleItemAssignment)
----------------------------------------------------------------------
ALTER TABLE "storageRuleItemAssignment" RENAME CONSTRAINT "customRuleItemAssignment_pkey"           TO "storageRuleItemAssignment_pkey";
ALTER TABLE "storageRuleItemAssignment" RENAME CONSTRAINT "customRuleItemAssignment_itemId_fkey"    TO "storageRuleItemAssignment_itemId_fkey";
ALTER TABLE "storageRuleItemAssignment" RENAME CONSTRAINT "customRuleItemAssignment_ruleId_fkey"    TO "storageRuleItemAssignment_ruleId_fkey";
ALTER TABLE "storageRuleItemAssignment" RENAME CONSTRAINT "customRuleItemAssignment_companyId_fkey" TO "storageRuleItemAssignment_companyId_fkey";
ALTER TABLE "storageRuleItemAssignment" RENAME CONSTRAINT "customRuleItemAssignment_createdBy_fkey" TO "storageRuleItemAssignment_createdBy_fkey";

ALTER INDEX IF EXISTS "customRuleItemAssignment_itemId_idx"           RENAME TO "storageRuleItemAssignment_itemId_idx";
ALTER INDEX IF EXISTS "customRuleItemAssignment_ruleId_idx"           RENAME TO "storageRuleItemAssignment_ruleId_idx";
ALTER INDEX IF EXISTS "customRuleItemAssignment_companyId_idx"        RENAME TO "storageRuleItemAssignment_companyId_idx";
ALTER INDEX IF EXISTS "customRuleItemAssignment_itemId_companyId_idx" RENAME TO "storageRuleItemAssignment_itemId_companyId_idx";

----------------------------------------------------------------------
-- storageRuleWorkCenterAssignment (was customRuleWorkCenterAssignment)
----------------------------------------------------------------------
ALTER TABLE "storageRuleWorkCenterAssignment" RENAME CONSTRAINT "customRuleWorkCenterAssignment_pkey"            TO "storageRuleWorkCenterAssignment_pkey";
ALTER TABLE "storageRuleWorkCenterAssignment" RENAME CONSTRAINT "customRuleWorkCenterAssignment_workCenterId_fkey" TO "storageRuleWorkCenterAssignment_workCenterId_fkey";
ALTER TABLE "storageRuleWorkCenterAssignment" RENAME CONSTRAINT "customRuleWorkCenterAssignment_ruleId_fkey"     TO "storageRuleWorkCenterAssignment_ruleId_fkey";
ALTER TABLE "storageRuleWorkCenterAssignment" RENAME CONSTRAINT "customRuleWorkCenterAssignment_companyId_fkey"  TO "storageRuleWorkCenterAssignment_companyId_fkey";
ALTER TABLE "storageRuleWorkCenterAssignment" RENAME CONSTRAINT "customRuleWorkCenterAssignment_createdBy_fkey"  TO "storageRuleWorkCenterAssignment_createdBy_fkey";

ALTER INDEX IF EXISTS "customRuleWorkCenterAssignment_workCenterId_idx"           RENAME TO "storageRuleWorkCenterAssignment_workCenterId_idx";
ALTER INDEX IF EXISTS "customRuleWorkCenterAssignment_ruleId_idx"                 RENAME TO "storageRuleWorkCenterAssignment_ruleId_idx";
ALTER INDEX IF EXISTS "customRuleWorkCenterAssignment_companyId_idx"              RENAME TO "storageRuleWorkCenterAssignment_companyId_idx";
ALTER INDEX IF EXISTS "customRuleWorkCenterAssignment_workCenterId_companyId_idx" RENAME TO "storageRuleWorkCenterAssignment_workCenterId_companyId_idx";
