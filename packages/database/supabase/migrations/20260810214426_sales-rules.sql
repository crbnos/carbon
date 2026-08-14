-- Sales rules: predicate rules evaluated when items are added to sales
-- documents (quote / sales order lines). Distinct from storageRule (warehouse
-- surfaces) and configurationRule (product configurator).
CREATE TYPE "salesRuleSurface" AS ENUM ('quoteLine', 'salesOrderLine');

CREATE TABLE "salesRule" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message" TEXT NOT NULL,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "conditionAst" JSONB NOT NULL,
  "surfaces" "salesRuleSurface"[] NOT NULL DEFAULT ARRAY['quoteLine', 'salesOrderLine']::"salesRuleSurface"[],
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
  CONSTRAINT "salesRule_surfaces_nonempty" CHECK (array_length("surfaces", 1) >= 1)
);

ALTER TABLE "salesRule" ADD CONSTRAINT "salesRule_companyId_name_key" UNIQUE ("companyId", "name");
CREATE INDEX "salesRule_companyId_idx" ON "salesRule" ("companyId");
CREATE INDEX "salesRule_createdBy_idx" ON "salesRule" ("createdBy");
CREATE INDEX "salesRule_companyId_active_partial_idx" ON "salesRule" ("companyId") WHERE "active" = TRUE;

ALTER TABLE "public"."salesRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."salesRule"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."salesRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."salesRule"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."salesRule"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

CREATE TABLE "salesRuleAssignment" (
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "salesRuleAssignment_pkey" PRIMARY KEY ("itemId", "ruleId"),
  CONSTRAINT "salesRuleAssignment_rule_fkey" FOREIGN KEY ("ruleId", "companyId") REFERENCES "salesRule"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX "salesRuleAssignment_itemId_idx" ON "salesRuleAssignment" ("itemId");
CREATE INDEX "salesRuleAssignment_ruleId_idx" ON "salesRuleAssignment" ("ruleId");
CREATE INDEX "salesRuleAssignment_companyId_idx" ON "salesRuleAssignment" ("companyId");
CREATE INDEX "salesRuleAssignment_createdBy_idx" ON "salesRuleAssignment" ("createdBy");

ALTER TABLE "public"."salesRuleAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."salesRuleAssignment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."salesRuleAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."salesRuleAssignment"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."salesRuleAssignment"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

-- Persisted override evidence: one row per deduped violation on a blocked
-- attempt ('blocked') or an acknowledged warn-and-proceed ('acknowledged').
CREATE TABLE "salesRuleAcknowledgment" (
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

CREATE INDEX "salesRuleAcknowledgment_companyId_idx" ON "salesRuleAcknowledgment" ("companyId");
CREATE INDEX "salesRuleAcknowledgment_ruleId_idx" ON "salesRuleAcknowledgment" ("ruleId");
CREATE INDEX "salesRuleAcknowledgment_document_idx" ON "salesRuleAcknowledgment" ("documentType", "documentId");
CREATE INDEX "salesRuleAcknowledgment_createdBy_idx" ON "salesRuleAcknowledgment" ("createdBy");

ALTER TABLE "public"."salesRuleAcknowledgment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."salesRuleAcknowledgment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
-- Append-only: INSERT permitted to anyone who can create sales lines (the
-- acknowledgment is written by the sales action); no UPDATE/DELETE policies.
CREATE POLICY "INSERT" ON "public"."salesRuleAcknowledgment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('salesRule', 'Sales Rule', 'Sales')
ON CONFLICT DO NOTHING;
