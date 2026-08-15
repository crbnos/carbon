-- Move storageRule + salesRule data into "enforcementRule", then drop the old
-- tables and their now-unreferenced surface enums.
--
-- Ordering matters: rules before assignments (composite FK), assignments and
-- acknowledgments before their source tables are dropped, and both surface
-- enums only after every column that used them is gone.
--
-- Every INSERT is ON CONFLICT DO NOTHING so a partial re-run is a no-op.

-- 1. Rules ------------------------------------------------------------------

-- storage: "surfaces" round-trips through text[] because the source array is
-- typed "transactionSurface"; every value exists in the new enum by name.
-- The filteredItem* trio is nullable on storageRule (added in a later migration
-- than the table) and NOT NULL on the merged table, hence the COALESCEs.
INSERT INTO "enforcementRule" (
  "id", "companyId", "family", "name", "description", "message", "severity",
  "conditionAst", "surfaces", "targetType", "appliesToAll",
  "filteredItemTypes", "filteredItemGroupIds", "filteredItemMatchAll",
  "active", "createdBy", "createdAt", "updatedBy", "updatedAt", "customFields"
)
SELECT
  "id", "companyId", 'storage'::"enforcementRuleFamily", "name", "description",
  "message", "severity", "conditionAst",
  "surfaces"::text[]::"enforcementRuleSurface"[],
  "targetType", "appliesToAll",
  COALESCE("filteredItemTypes", '{}'), COALESCE("filteredItemGroupIds", '{}'),
  COALESCE("filteredItemMatchAll", FALSE),
  "active", "createdBy", "createdAt", "updatedBy", "updatedAt", "customFields"
FROM "storageRule"
ON CONFLICT DO NOTHING;

-- sales: no targetType/appliesToAll on the source — the merged defaults
-- ('item', FALSE) are exactly what the sales-shape CHECK requires.
INSERT INTO "enforcementRule" (
  "id", "companyId", "family", "name", "description", "message", "severity",
  "conditionAst", "surfaces",
  "filteredItemTypes", "filteredItemGroupIds", "filteredItemMatchAll",
  "active", "createdBy", "createdAt", "updatedBy", "updatedAt", "customFields"
)
SELECT
  "id", "companyId", 'sales'::"enforcementRuleFamily", "name", "description",
  "message", "severity", "conditionAst",
  "surfaces"::text[]::"enforcementRuleSurface"[],
  "filteredItemTypes", "filteredItemGroupIds", "filteredItemMatchAll",
  "active", "createdBy", "createdAt", "updatedBy", "updatedAt", "customFields"
FROM "salesRule"
ON CONFLICT DO NOTHING;

-- 2. Assignments ------------------------------------------------------------

-- Item pins from both families land in one table.
INSERT INTO "enforcementRuleItemAssignment" ("itemId", "ruleId", "companyId", "createdBy", "createdAt", "updatedBy")
SELECT "itemId", "ruleId", "companyId", "createdBy", "createdAt", "updatedBy"
FROM "storageRuleItemAssignment"
ON CONFLICT DO NOTHING;

-- salesRuleAssignment has no "updatedBy" column; the merged table allows NULL.
INSERT INTO "enforcementRuleItemAssignment" ("itemId", "ruleId", "companyId", "createdBy", "createdAt")
SELECT "itemId", "ruleId", "companyId", "createdBy", "createdAt"
FROM "salesRuleAssignment"
ON CONFLICT DO NOTHING;

INSERT INTO "enforcementRuleWorkCenterAssignment" ("workCenterId", "ruleId", "companyId", "createdBy", "createdAt", "updatedBy")
SELECT "workCenterId", "ruleId", "companyId", "createdBy", "createdAt", "updatedBy"
FROM "storageRuleWorkCenterAssignment"
ON CONFLICT DO NOTHING;

-- 3. Acknowledgment evidence ------------------------------------------------

INSERT INTO "enforcementRuleAcknowledgment" (
  "id", "companyId", "ruleId", "ruleName", "documentType", "documentId",
  "documentLineId", "itemId", "severity", "outcome", "message",
  "createdBy", "createdAt", "updatedBy"
)
SELECT
  "id", "companyId", "ruleId", "ruleName", "documentType", "documentId",
  "documentLineId", "itemId", "severity", "outcome", "message",
  "createdBy", "createdAt", "updatedBy"
FROM "salesRuleAcknowledgment"
ON CONFLICT DO NOTHING;

-- 4. Custom fields ----------------------------------------------------------

-- "customField"."table" has an FK to "customFieldTable"."table" with ON UPDATE
-- CASCADE, so renaming the registry row carries every company's storage-rule
-- custom-field definitions (and the values already stored in the rows'
-- "customFields" JSONB) across automatically.
UPDATE "customFieldTable"
SET "table" = 'enforcementRule', "name" = 'Rule'
WHERE "table" = 'storageRule';

-- Sales-rule definitions move to the same registry row. The guard is for the
-- (currently impossible — salesRule has never been deployed) case where a
-- company defined the same field name on both families; the unique key is
-- ("table","name","companyId").
UPDATE "customField" cf
SET "table" = 'enforcementRule'
WHERE cf."table" = 'salesRule'
  AND NOT EXISTS (
    SELECT 1 FROM "customField" existing
    WHERE existing."table" = 'enforcementRule'
      AND existing."name" = cf."name"
      AND existing."companyId" = cf."companyId"
  );

-- Cascades away any leftover (conflicting) salesRule definitions.
DELETE FROM "customFieldTable" WHERE "table" = 'salesRule';

-- 5. Drop the old schema ----------------------------------------------------

DROP TABLE "storageRuleItemAssignment";
DROP TABLE "storageRuleWorkCenterAssignment";
DROP TABLE "salesRuleAssignment";
DROP TABLE "salesRuleAcknowledgment";
DROP TABLE "storageRule";
DROP TABLE "salesRule";

DROP TYPE "transactionSurface";
DROP TYPE "salesRuleSurface";
