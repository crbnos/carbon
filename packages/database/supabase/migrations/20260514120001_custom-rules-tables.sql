-- Custom Rules refactor — rename existing item-rule tables and add
-- support for storageUnit + workCenter target types.

----------------------------------------------------------------------
-- 1. Rename core rule table + constraints/indexes/policies
----------------------------------------------------------------------

ALTER TABLE "itemRule" RENAME TO "customRule";

ALTER TABLE "customRule" RENAME CONSTRAINT "itemRule_companyId_fkey"     TO "customRule_companyId_fkey";
ALTER TABLE "customRule" RENAME CONSTRAINT "itemRule_createdBy_fkey"     TO "customRule_createdBy_fkey";
ALTER TABLE "customRule" RENAME CONSTRAINT "itemRule_updatedBy_fkey"     TO "customRule_updatedBy_fkey";
ALTER TABLE "customRule" RENAME CONSTRAINT "itemRule_companyId_name_key" TO "customRule_companyId_name_key";
ALTER TABLE "customRule" RENAME CONSTRAINT "itemRule_surfaces_nonempty"  TO "customRule_surfaces_nonempty";

ALTER INDEX IF EXISTS "itemRule_companyId_idx"                RENAME TO "customRule_companyId_idx";
ALTER INDEX IF EXISTS "itemRule_companyId_active_partial_idx" RENAME TO "customRule_companyId_active_partial_idx";

----------------------------------------------------------------------
-- 2. Add new columns to customRule
----------------------------------------------------------------------

ALTER TABLE "customRule"
  ADD COLUMN "targetType"   "customRuleTargetType" NOT NULL DEFAULT 'item',
  ADD COLUMN "appliesToAll" BOOLEAN                NOT NULL DEFAULT FALSE;

-- Common filter: rules for a given company + targetType + active flag.
CREATE INDEX "customRule_companyId_targetType_active_idx"
  ON "customRule" ("companyId", "targetType")
  WHERE "active" = TRUE;

----------------------------------------------------------------------
-- 3. Move customRule RLS off parts_* permissions onto settings_*
----------------------------------------------------------------------

DROP POLICY IF EXISTS "SELECT" ON "public"."customRule";
DROP POLICY IF EXISTS "INSERT" ON "public"."customRule";
DROP POLICY IF EXISTS "UPDATE" ON "public"."customRule";
DROP POLICY IF EXISTS "DELETE" ON "public"."customRule";

CREATE POLICY "SELECT" ON "public"."customRule"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customRule"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customRule"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);

----------------------------------------------------------------------
-- 4. Rename item assignment table
----------------------------------------------------------------------

ALTER TABLE "itemRuleAssignment" RENAME TO "customRuleItemAssignment";

ALTER TABLE "customRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_pkey"            TO "customRuleItemAssignment_pkey";
ALTER TABLE "customRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_itemId_fkey"     TO "customRuleItemAssignment_itemId_fkey";
ALTER TABLE "customRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_ruleId_fkey"     TO "customRuleItemAssignment_ruleId_fkey";
ALTER TABLE "customRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_companyId_fkey"  TO "customRuleItemAssignment_companyId_fkey";
ALTER TABLE "customRuleItemAssignment"
  RENAME CONSTRAINT "itemRuleAssignment_createdBy_fkey"  TO "customRuleItemAssignment_createdBy_fkey";

ALTER INDEX IF EXISTS "itemRuleAssignment_itemId_idx"            RENAME TO "customRuleItemAssignment_itemId_idx";
ALTER INDEX IF EXISTS "itemRuleAssignment_ruleId_idx"            RENAME TO "customRuleItemAssignment_ruleId_idx";
ALTER INDEX IF EXISTS "itemRuleAssignment_companyId_idx"         RENAME TO "customRuleItemAssignment_companyId_idx";
ALTER INDEX IF EXISTS "itemRuleAssignment_itemId_companyId_idx"  RENAME TO "customRuleItemAssignment_itemId_companyId_idx";

----------------------------------------------------------------------
-- 5. Storage unit assignment table
----------------------------------------------------------------------

CREATE TABLE "customRuleStorageUnitAssignment" (
  "storageUnitId" TEXT NOT NULL,
  "ruleId"        TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "createdBy"     TEXT NOT NULL,
  "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "customRuleStorageUnitAssignment_pkey"
    PRIMARY KEY ("storageUnitId", "ruleId"),
  CONSTRAINT "customRuleStorageUnitAssignment_storageUnitId_fkey"
    FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE CASCADE,
  CONSTRAINT "customRuleStorageUnitAssignment_ruleId_fkey"
    FOREIGN KEY ("ruleId")        REFERENCES "customRule"("id") ON DELETE CASCADE,
  CONSTRAINT "customRuleStorageUnitAssignment_companyId_fkey"
    FOREIGN KEY ("companyId")     REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "customRuleStorageUnitAssignment_createdBy_fkey"
    FOREIGN KEY ("createdBy")     REFERENCES "user"("id")
);

CREATE INDEX "customRuleStorageUnitAssignment_storageUnitId_idx"
  ON "customRuleStorageUnitAssignment" ("storageUnitId");
CREATE INDEX "customRuleStorageUnitAssignment_ruleId_idx"
  ON "customRuleStorageUnitAssignment" ("ruleId");
CREATE INDEX "customRuleStorageUnitAssignment_companyId_idx"
  ON "customRuleStorageUnitAssignment" ("companyId");
CREATE INDEX "customRuleStorageUnitAssignment_storageUnitId_companyId_idx"
  ON "customRuleStorageUnitAssignment" ("storageUnitId", "companyId");

ALTER TABLE "customRuleStorageUnitAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."customRuleStorageUnitAssignment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customRuleStorageUnitAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customRuleStorageUnitAssignment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customRuleStorageUnitAssignment"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

----------------------------------------------------------------------
-- 6. Work center assignment table
----------------------------------------------------------------------

CREATE TABLE "customRuleWorkCenterAssignment" (
  "workCenterId" TEXT NOT NULL,
  "ruleId"       TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "createdBy"    TEXT NOT NULL,
  "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "customRuleWorkCenterAssignment_pkey"
    PRIMARY KEY ("workCenterId", "ruleId"),
  CONSTRAINT "customRuleWorkCenterAssignment_workCenterId_fkey"
    FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE CASCADE,
  CONSTRAINT "customRuleWorkCenterAssignment_ruleId_fkey"
    FOREIGN KEY ("ruleId")       REFERENCES "customRule"("id") ON DELETE CASCADE,
  CONSTRAINT "customRuleWorkCenterAssignment_companyId_fkey"
    FOREIGN KEY ("companyId")    REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "customRuleWorkCenterAssignment_createdBy_fkey"
    FOREIGN KEY ("createdBy")    REFERENCES "user"("id")
);

CREATE INDEX "customRuleWorkCenterAssignment_workCenterId_idx"
  ON "customRuleWorkCenterAssignment" ("workCenterId");
CREATE INDEX "customRuleWorkCenterAssignment_ruleId_idx"
  ON "customRuleWorkCenterAssignment" ("ruleId");
CREATE INDEX "customRuleWorkCenterAssignment_companyId_idx"
  ON "customRuleWorkCenterAssignment" ("companyId");
CREATE INDEX "customRuleWorkCenterAssignment_workCenterId_companyId_idx"
  ON "customRuleWorkCenterAssignment" ("workCenterId", "companyId");

ALTER TABLE "customRuleWorkCenterAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."customRuleWorkCenterAssignment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customRuleWorkCenterAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customRuleWorkCenterAssignment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customRuleWorkCenterAssignment"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_delete'))::text[]
  )
);

----------------------------------------------------------------------
-- 7. customFieldTable rename
----------------------------------------------------------------------

UPDATE "customFieldTable"
   SET "table" = 'customRule',
       "name"  = 'Custom Rule'
 WHERE "table" = 'itemRule';
