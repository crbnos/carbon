-- Per-rule trigger surface scoping. Rules opt in to one or more transaction
-- surfaces; the evaluator skips surfaces a rule didn't subscribe to.
CREATE TYPE "transactionSurface" AS ENUM (
  'receipt',
  'shipment',
  'stockTransfer',
  'warehouseTransfer',
  'inventoryAdjustment'
);

CREATE TABLE "itemRule" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message" TEXT NOT NULL,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "conditionAst" JSONB NOT NULL,
  "surfaces" "transactionSurface"[] NOT NULL DEFAULT ARRAY[
    'receipt',
    'shipment',
    'stockTransfer',
    'warehouseTransfer',
    'inventoryAdjustment'
  ]::"transactionSurface"[],
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "itemRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemRule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemRule_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "itemRule_companyId_name_key" UNIQUE ("companyId", "name"),
  CONSTRAINT "itemRule_surfaces_nonempty" CHECK (array_length("surfaces", 1) >= 1)
);

CREATE INDEX "itemRule_companyId_idx" ON "itemRule" ("companyId");
CREATE INDEX "itemRule_companyId_active_partial_idx"
  ON "itemRule" ("companyId") WHERE "active" = TRUE;

ALTER TABLE "itemRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemRule"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."itemRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."itemRule"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."itemRule"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

CREATE TABLE "itemRuleAssignment" (
  "itemId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "itemRuleAssignment_pkey" PRIMARY KEY ("itemId", "ruleId"),
  CONSTRAINT "itemRuleAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "itemRuleAssignment_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "itemRule"("id") ON DELETE CASCADE,
  CONSTRAINT "itemRuleAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "itemRuleAssignment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id")
);

CREATE INDEX "itemRuleAssignment_itemId_idx" ON "itemRuleAssignment" ("itemId");
CREATE INDEX "itemRuleAssignment_ruleId_idx" ON "itemRuleAssignment" ("ruleId");
CREATE INDEX "itemRuleAssignment_companyId_idx" ON "itemRuleAssignment" ("companyId");
CREATE INDEX "itemRuleAssignment_itemId_companyId_idx"
  ON "itemRuleAssignment" ("itemId", "companyId");

ALTER TABLE "itemRuleAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemRuleAssignment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."itemRuleAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."itemRuleAssignment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."itemRuleAssignment"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('itemRule', 'Item Rule', 'Items');
