-- Merge "storageRule" and "salesRule" into one "enforcementRule" table.
--
-- Both families were already one engine (@carbon/utils rules.ts), one evaluator
-- shape (@carbon/ee/rules) and one violation modal; only the tables were split.
-- The split cost a duplicated schema, duplicated CRUD, and two surface enums.
-- This migration creates the merged schema; the sibling data migration moves the
-- rows and drops the old tables.
--
-- The discriminator is "family". What used to be enforced by the column TYPE
-- (a storage rule could not hold a sales surface because the array was typed
-- "transactionSurface") is now enforced by per-family CHECK constraints — see
-- enforcementRule_storage_surfaces / enforcementRule_sales_surfaces below. That
-- swap is the deliberate cost of the merge.

CREATE TYPE "enforcementRuleFamily" AS ENUM ('storage', 'sales');

-- Union of the two retired enums. "transactionSurface" (11 warehouse/MES values)
-- and "salesRuleSurface" (2 sales-document values) are dropped by the data
-- migration once no column references them.
CREATE TYPE "enforcementRuleSurface" AS ENUM (
  -- storage family
  'receipt',
  'shipment',
  'stockTransfer',
  'warehouseTransfer',
  'inventoryAdjustment',
  'place',
  'pick',
  'operationStart',
  'operationFinish',
  'materialIssue',
  'materialReceive',
  -- sales family
  'quoteLine',
  'salesOrderLine'
);

-- Same two values ('item', 'workCenter'); only the type name generalizes.
ALTER TYPE "storageRuleTargetType" RENAME TO "enforcementRuleTargetType";

CREATE TABLE "enforcementRule" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "family" "enforcementRuleFamily" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message" TEXT NOT NULL,                                  -- violation text, {token} interpolation
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "conditionAst" JSONB NOT NULL,                            -- {kind: all|any|none, conditions:[{field,op,value}]}
  "surfaces" "enforcementRuleSurface"[] NOT NULL,
  -- Storage-family shape. Sales rules are always item-target broadcasts, pinned
  -- by the CHECK below, so these keep their storage semantics unchanged.
  "targetType" "enforcementRuleTargetType" NOT NULL DEFAULT 'item',
  "appliesToAll" BOOLEAN NOT NULL DEFAULT FALSE,            -- workCenter-target broadcast toggle
  -- Item scoping (both families). Empty arrays = every item.
  "filteredItemTypes" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemGroupIds" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemMatchAll" BOOLEAN NOT NULL DEFAULT FALSE,    -- false = OR, true = AND across the two dimensions
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,

  CONSTRAINT "enforcementRule_surfaces_nonempty" CHECK (array_length("surfaces", 1) >= 1),
  -- A rule may only subscribe to surfaces of its own family. Without these a
  -- storage rule could subscribe to 'quoteLine' and silently never fire.
  CONSTRAINT "enforcementRule_storage_surfaces" CHECK (
    "family" <> 'storage' OR "surfaces" <@ ARRAY[
      'receipt', 'shipment', 'stockTransfer', 'warehouseTransfer',
      'inventoryAdjustment', 'place', 'pick', 'operationStart',
      'operationFinish', 'materialIssue', 'materialReceive'
    ]::"enforcementRuleSurface"[]
  ),
  CONSTRAINT "enforcementRule_sales_surfaces" CHECK (
    "family" <> 'sales' OR "surfaces" <@ ARRAY[
      'quoteLine', 'salesOrderLine'
    ]::"enforcementRuleSurface"[]
  ),
  -- Sales rules have no work-center target and no appliesToAll broadcast.
  CONSTRAINT "enforcementRule_sales_shape" CHECK (
    "family" <> 'sales' OR ("targetType" = 'item' AND "appliesToAll" = FALSE)
  )
);

-- Name uniqueness is per family: the two source tables allowed the same name in
-- each, so a global (companyId, name) unique would reject valid existing data.
ALTER TABLE "enforcementRule" ADD CONSTRAINT "enforcementRule_companyId_family_name_key"
  UNIQUE ("companyId", "family", "name");

CREATE INDEX "enforcementRule_companyId_idx" ON "enforcementRule" ("companyId");
CREATE INDEX "enforcementRule_createdBy_idx" ON "enforcementRule" ("createdBy");
CREATE INDEX "enforcementRule_companyId_family_active_idx"
  ON "enforcementRule" ("companyId", "family") WHERE "active" = TRUE;
CREATE INDEX "enforcementRule_companyId_targetType_active_idx"
  ON "enforcementRule" ("companyId", "targetType") WHERE "active" = TRUE;

ALTER TABLE "public"."enforcementRule" ENABLE ROW LEVEL SECURITY;

-- Writes are gated by the OWNING FAMILY's module permission, preserving exactly
-- what each source table required: storage → inventory_*, sales → sales_*.
CREATE POLICY "SELECT" ON "public"."enforcementRule"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."enforcementRule"
FOR INSERT WITH CHECK (
  ("family" = 'storage' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[]))
  OR
  ("family" = 'sales' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]))
);

-- WITH CHECK mirrors USING so a row cannot be edited into a family the caller
-- lacks permission for (USING alone would only guard the pre-update row).
CREATE POLICY "UPDATE" ON "public"."enforcementRule"
FOR UPDATE USING (
  ("family" = 'storage' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[]))
  OR
  ("family" = 'sales' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]))
) WITH CHECK (
  ("family" = 'storage' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[]))
  OR
  ("family" = 'sales' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]))
);

CREATE POLICY "DELETE" ON "public"."enforcementRule"
FOR DELETE USING (
  ("family" = 'storage' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[]))
  OR
  ("family" = 'sales' AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]))
);

-- Item pins for BOTH families (absorbs storageRuleItemAssignment and
-- salesRuleAssignment). Kept as a real table with a real FK to "item" rather
-- than a polymorphic targetId, so ON DELETE CASCADE still cleans up pins when
-- an item is deleted.
CREATE TABLE "enforcementRuleItemAssignment" (
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),

  CONSTRAINT "enforcementRuleItemAssignment_pkey" PRIMARY KEY ("itemId", "ruleId"),
  CONSTRAINT "enforcementRuleItemAssignment_rule_fkey" FOREIGN KEY ("ruleId", "companyId")
    REFERENCES "enforcementRule"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX "enforcementRuleItemAssignment_itemId_idx" ON "enforcementRuleItemAssignment" ("itemId");
CREATE INDEX "enforcementRuleItemAssignment_ruleId_idx" ON "enforcementRuleItemAssignment" ("ruleId");
CREATE INDEX "enforcementRuleItemAssignment_companyId_idx" ON "enforcementRuleItemAssignment" ("companyId");
CREATE INDEX "enforcementRuleItemAssignment_itemId_companyId_idx" ON "enforcementRuleItemAssignment" ("itemId", "companyId");
CREATE INDEX "enforcementRuleItemAssignment_createdBy_idx" ON "enforcementRuleItemAssignment" ("createdBy");

ALTER TABLE "public"."enforcementRuleItemAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."enforcementRuleItemAssignment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- One table now holds pins for two families whose source tables required
-- DIFFERENT permissions (storage item pins: parts_*; sales pins: sales_*).
-- The EXISTS resolves the pinned rule's family and applies that family's
-- permission, so the merge changes no caller's authorization.
--
-- The outer row is qualified by table name on purpose. An unqualified
-- "companyId" inside the subquery binds to the INNER table (r), turning the
-- tenant correlation into r."companyId" = r."companyId" — always true. Note
-- "ruleId" needs no qualification because enforcementRule has no such column,
-- which is exactly what makes the mistake hard to see.
CREATE POLICY "INSERT" ON "public"."enforcementRuleItemAssignment"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "enforcementRule" r
    WHERE r."id" = "ruleId" AND r."companyId" = "enforcementRuleItemAssignment"."companyId"
      AND (
        (r."family" = 'storage' AND r."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[]))
        OR
        (r."family" = 'sales' AND r."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]))
      )
  )
);

CREATE POLICY "UPDATE" ON "public"."enforcementRuleItemAssignment"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "enforcementRule" r
    WHERE r."id" = "ruleId" AND r."companyId" = "enforcementRuleItemAssignment"."companyId"
      AND (
        (r."family" = 'storage' AND r."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[]))
        OR
        (r."family" = 'sales' AND r."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]))
      )
  )
);

CREATE POLICY "DELETE" ON "public"."enforcementRuleItemAssignment"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "enforcementRule" r
    WHERE r."id" = "ruleId" AND r."companyId" = "enforcementRuleItemAssignment"."companyId"
      AND (
        (r."family" = 'storage' AND r."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[]))
        OR
        (r."family" = 'sales' AND r."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]))
      )
  )
);

-- Work-center pins are storage-family only; permissions unchanged (resources_*).
CREATE TABLE "enforcementRuleWorkCenterAssignment" (
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),

  CONSTRAINT "enforcementRuleWorkCenterAssignment_pkey" PRIMARY KEY ("workCenterId", "ruleId"),
  CONSTRAINT "enforcementRuleWorkCenterAssignment_rule_fkey" FOREIGN KEY ("ruleId", "companyId")
    REFERENCES "enforcementRule"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX "enforcementRuleWorkCenterAssignment_workCenterId_idx" ON "enforcementRuleWorkCenterAssignment" ("workCenterId");
CREATE INDEX "enforcementRuleWorkCenterAssignment_ruleId_idx" ON "enforcementRuleWorkCenterAssignment" ("ruleId");
CREATE INDEX "enforcementRuleWorkCenterAssignment_companyId_idx" ON "enforcementRuleWorkCenterAssignment" ("companyId");
CREATE INDEX "enforcementRuleWorkCenterAssignment_workCenterId_companyId_idx" ON "enforcementRuleWorkCenterAssignment" ("workCenterId", "companyId");
CREATE INDEX "enforcementRuleWorkCenterAssignment_createdBy_idx" ON "enforcementRuleWorkCenterAssignment" ("createdBy");

ALTER TABLE "public"."enforcementRuleWorkCenterAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."enforcementRuleWorkCenterAssignment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."enforcementRuleWorkCenterAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."enforcementRuleWorkCenterAssignment"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."enforcementRuleWorkCenterAssignment"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

-- Append-only override/block evidence. Sales-family only today (storage rules
-- persist no evidence); "documentType" widens if that changes.
CREATE TABLE "enforcementRuleAcknowledgment" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "ruleId" TEXT,                                            -- deliberate SOFT reference (no FK)
  "ruleName" TEXT,                                          -- denormalized: evidence survives rename/delete
  "documentType" TEXT NOT NULL CHECK ("documentType" IN ('quote', 'salesOrder')),
  "documentId" TEXT NOT NULL,
  "documentLineId" TEXT,
  "itemId" TEXT,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('blocked', 'acknowledged')),
  "message" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "enforcementRuleAcknowledgment_companyId_idx" ON "enforcementRuleAcknowledgment" ("companyId");
CREATE INDEX "enforcementRuleAcknowledgment_ruleId_idx" ON "enforcementRuleAcknowledgment" ("ruleId");
CREATE INDEX "enforcementRuleAcknowledgment_document_idx" ON "enforcementRuleAcknowledgment" ("documentType", "documentId");
CREATE INDEX "enforcementRuleAcknowledgment_createdBy_idx" ON "enforcementRuleAcknowledgment" ("createdBy");

ALTER TABLE "public"."enforcementRuleAcknowledgment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."enforcementRuleAcknowledgment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- Append-only: INSERT only, no UPDATE/DELETE policies.
CREATE POLICY "INSERT" ON "public"."enforcementRuleAcknowledgment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
