-- Item rules: predicate rules evaluated when items are added to sales
-- documents (quote / sales order lines). Distinct from storageRule (warehouse
-- surfaces) and configurationRule (product configurator).
CREATE TYPE "itemRuleSurface" AS ENUM ('quoteLine', 'salesOrderLine');

CREATE TABLE "itemRule" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message" TEXT NOT NULL,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "conditionAst" JSONB NOT NULL,
  "surfaces" "itemRuleSurface"[] NOT NULL DEFAULT ARRAY['quoteLine', 'salesOrderLine']::"itemRuleSurface"[],
  "filteredItemTypes" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemGroupIds" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemMatchAll" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "itemRule_surfaces_nonempty" CHECK (array_length("surfaces", 1) >= 1)
);

ALTER TABLE "itemRule" ADD CONSTRAINT "itemRule_companyId_name_key" UNIQUE ("companyId", "name");
CREATE INDEX "itemRule_companyId_idx" ON "itemRule" ("companyId");
CREATE INDEX "itemRule_createdBy_idx" ON "itemRule" ("createdBy");
CREATE INDEX "itemRule_companyId_active_partial_idx" ON "itemRule" ("companyId") WHERE "active" = TRUE;

ALTER TABLE "public"."itemRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemRule"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."itemRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."itemRule"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."itemRule"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

CREATE TABLE "itemRuleAssignment" (
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "itemRuleAssignment_pkey" PRIMARY KEY ("itemId", "ruleId"),
  CONSTRAINT "itemRuleAssignment_rule_fkey" FOREIGN KEY ("ruleId", "companyId") REFERENCES "itemRule"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX "itemRuleAssignment_itemId_idx" ON "itemRuleAssignment" ("itemId");
CREATE INDEX "itemRuleAssignment_ruleId_idx" ON "itemRuleAssignment" ("ruleId");
CREATE INDEX "itemRuleAssignment_companyId_idx" ON "itemRuleAssignment" ("companyId");
CREATE INDEX "itemRuleAssignment_createdBy_idx" ON "itemRuleAssignment" ("createdBy");

ALTER TABLE "public"."itemRuleAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemRuleAssignment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."itemRuleAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."itemRuleAssignment"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."itemRuleAssignment"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- Persisted override evidence: one row per deduped violation on a blocked
-- attempt ('blocked') or an acknowledged warn-and-proceed ('acknowledged').
CREATE TABLE "itemRuleAcknowledgment" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "ruleId" TEXT,
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

CREATE INDEX "itemRuleAcknowledgment_companyId_idx" ON "itemRuleAcknowledgment" ("companyId");
CREATE INDEX "itemRuleAcknowledgment_ruleId_idx" ON "itemRuleAcknowledgment" ("ruleId");
CREATE INDEX "itemRuleAcknowledgment_document_idx" ON "itemRuleAcknowledgment" ("documentType", "documentId");
CREATE INDEX "itemRuleAcknowledgment_createdBy_idx" ON "itemRuleAcknowledgment" ("createdBy");

ALTER TABLE "public"."itemRuleAcknowledgment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemRuleAcknowledgment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
-- Append-only: INSERT permitted to anyone who can create sales lines (the
-- acknowledgment is written by the sales action); no UPDATE/DELETE policies.
CREATE POLICY "INSERT" ON "public"."itemRuleAcknowledgment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('itemRule', 'Item Rule', 'Items')
ON CONFLICT DO NOTHING;
