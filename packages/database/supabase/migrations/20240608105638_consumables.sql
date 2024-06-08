CREATE TABLE "consumable" (
  "id" TEXT NOT NULL,
  "itemId" TEXT,
  "unitOfMeasureCode" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "approvedBy" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "consumable_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "consumable_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "consumable_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "consumable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "consumable_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "user"("id"),
  CONSTRAINT "consumable_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "consumable_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "consumable_companyId_idx" ON "consumable"("companyId");
CREATE INDEX "consumable_itemId_idx" ON "consumable"("itemId");

CREATE POLICY "Employees can view consumables" ON "consumable"
  FOR SELECT
  USING (
    has_role('employee') 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can insert consumables" ON "consumable"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update consumables" ON "consumable"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete consumables" ON "consumable"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('consumable', 'Consumable', 'Items');

CREATE OR REPLACE VIEW "consumables" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i.active,
    i.blocked,
    i.assignee,
    c.*,
    ig.name AS "itemGroup",
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "consumable" c
  INNER JOIN "item" i ON i.id = c."itemId"
  LEFT JOIN "itemGroup" ig ON ig.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "itemSupplier" s
    GROUP BY "itemId"
  )  s ON s."itemId" = c."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = c."unitOfMeasureCode" AND uom."companyId" = c."companyId";
