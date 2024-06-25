ALTER TYPE "module" ADD VALUE 'Items';
COMMIT;
UPDATE "customFieldTable" SET "module" = 'Items' WHERE "module" = 'Parts';

CREATE TABLE "tool" (
  "id" TEXT NOT NULL,
  "itemId" TEXT,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "approvedBy" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "tool_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "tool_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tool_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "tool_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "user"("id"),
  CONSTRAINT "tool_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "tool_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "tool_companyId_idx" ON "tool"("companyId");
CREATE INDEX "tool_itemId_idx" ON "tool"("itemId");

ALTER TABLE "tool" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view tools" ON "tool"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can insert tools" ON "tool"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update tools" ON "tool"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete tools" ON "tool"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('tool', 'Tool', 'Items');

CREATE OR REPLACE VIEW "tools" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemTrackingType",
    i.active,
    i.blocked,
    i.assignee,
    i."unitOfMeasureCode",
    t.*,
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "tool" t
  INNER JOIN "item" i ON i.id = t."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = t."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";
