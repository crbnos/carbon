-- Move the shipped storage rules into "enforcementRule", then drop the old
-- tables and the now-unreferenced "transactionSurface" enum.
--
-- Storage is the only family with data to move: the sales family is built
-- directly on "enforcementRule" and has never had a table of its own.
--
-- Ordering matters: rules before assignments (composite FK), and the enum only
-- after every column that used it is gone.
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


-- 2. Assignments ------------------------------------------------------------

-- Storage item pins move into the shared pin table (sales pins are written
-- directly there by the sales feature; there is nothing to migrate for them).
INSERT INTO "enforcementRuleItemAssignment" ("itemId", "ruleId", "companyId", "createdBy", "createdAt", "updatedBy")
SELECT "itemId", "ruleId", "companyId", "createdBy", "createdAt", "updatedBy"
FROM "storageRuleItemAssignment"
ON CONFLICT DO NOTHING;


INSERT INTO "enforcementRuleWorkCenterAssignment" ("workCenterId", "ruleId", "companyId", "createdBy", "createdAt", "updatedBy")
SELECT "workCenterId", "ruleId", "companyId", "createdBy", "createdAt", "updatedBy"
FROM "storageRuleWorkCenterAssignment"
ON CONFLICT DO NOTHING;


-- 3. Custom fields ----------------------------------------------------------

-- "customField"."table" has an FK to "customFieldTable"."table" with ON UPDATE
-- CASCADE, so renaming the registry row carries every company's storage-rule
-- custom-field definitions (and the values already stored in the rows'
-- "customFields" JSONB) across automatically.
UPDATE "customFieldTable"
SET "table" = 'enforcementRule', "name" = 'Rule'
WHERE "table" = 'storageRule';


-- 4. Drop the old schema ----------------------------------------------------

DROP TABLE "storageRuleItemAssignment";
DROP TABLE "storageRuleWorkCenterAssignment";
DROP TABLE "storageRule";

DROP TYPE "transactionSurface";
