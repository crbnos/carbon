CREATE TABLE "unitOfMeasure" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "unitOfMeasure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unitOfMeasure_code_unique" UNIQUE ("code", "companyId"),
  CONSTRAINT "unitOfMeasure_name_unique" UNIQUE ("name", "companyId"),
  CONSTRAINT "unitOfMeasure_code_check" CHECK (char_length("code") <= 6),
  CONSTRAINT "unitOfMeasure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "unitOfMeasure_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "unitOfMeasure_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "unitOfMeasure_code_idx" ON "unitOfMeasure"("code");
CREATE INDEX "unitOfMeasure_name_idx" ON "unitOfMeasure"("name");
CREATE INDEX "unitOfMeasure_companyId_idx" ON "unitOfMeasure"("companyId");

ALTER TABLE "unitOfMeasure" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view units of measure" ON "unitOfMeasure"
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
  );
  

CREATE POLICY "Employees with parts_create can insert units of measure" ON "unitOfMeasure"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update units of measure" ON "unitOfMeasure"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete units of measure" ON "unitOfMeasure"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );


CREATE TABLE "itemPostingGroup" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "itemPostingGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "itemPostingGroup_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "itemPostingGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemPostingGroup_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemPostingGroup_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "itemPostingGroup_companyId_idx" ON "itemPostingGroup" ("companyId");

ALTER TABLE "itemPostingGroup" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view item groups" ON "itemPostingGroup"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );
  

CREATE POLICY "Employees with parts_create can insert item groups" ON "itemPostingGroup"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update item groups" ON "itemPostingGroup"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete item groups" ON "itemPostingGroup"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );


CREATE TYPE "itemType" AS ENUM (
  'Part',
  'Material',
  'Tool',
  'Service',
  'Consumable',
  'Fixture'
);

CREATE TYPE "itemTrackingType" AS ENUM (
  'Inventory',
  'Non-Inventory'
);

CREATE TYPE "itemReplenishmentSystem" AS ENUM (
  'Buy',
  'Make',
  'Buy and Make'
);

CREATE TYPE "methodType" AS ENUM (
  'Buy',
  'Make',
  'Pick'
);

CREATE TABLE "item" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "readableId" TEXT NOT NULL,
  "type" "itemType" NOT NULL,
  "replenishmentSystem" "itemReplenishmentSystem" NOT NULL DEFAULT 'Buy',
  "defaultMethodType" "methodType" DEFAULT 'Buy',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "itemTrackingType" "itemTrackingType" NOT NULL,
  "unitOfMeasureCode" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "blocked" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "item_pkey" PRIMARY KEY (id),
  CONSTRAINT "item_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "item_unique" UNIQUE ("readableId", "companyId", "type"),
  CONSTRAINT "item_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "item_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "item_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

ALTER publication supabase_realtime ADD TABLE "item";

CREATE INDEX "item_companyId_idx" ON "item" ("companyId");
CREATE INDEX "item_name_companyId_idx" ON "item" ("name", "companyId");
CREATE INDEX "item_type_companyId_idx" ON "item" ("type", "companyId");
CREATE INDEX "item_replenishmentSystem_idx" ON "item"("replenishmentSystem", "companyId");

ALTER TABLE "item" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view items" ON "item"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can insert items" ON "item"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update items" ON "item"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete items" ON "item"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );


CREATE TYPE "partManufacturingPolicy" AS ENUM (
  'Make to Order',
  'Make to Stock'
);


CREATE TYPE "itemCostingMethod" AS ENUM (
  'Standard',
  'Average',
  'LIFO',
  'FIFO'
);

CREATE TYPE "itemReorderingPolicy" AS ENUM (
  'Manual Reorder',
  'Demand-Based Reorder',
  'Fixed Reorder Quantity',
  'Maximum Quantity'
);


CREATE TABLE "part" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "approvedBy" TEXT,
  "fromDate" DATE,
  "toDate" DATE,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "part_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "part_id_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "part_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "user"("id"),
  CONSTRAINT "part_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "part_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "part_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "part_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "part_itemId_idx" ON "part" ("itemId");
CREATE INDEX "part_companyId_idx" ON "part" ("companyId");


ALTER publication supabase_realtime ADD TABLE "part";
ALTER TABLE "item" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view parts" ON "item"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can insert parts" ON "item"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update parts" ON "item"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete parts" ON "item"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );

CREATE OR REPLACE FUNCTION public.create_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
  VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new."readableId", '/x/part/' || new."id", new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_item_search_result
  AFTER INSERT on public.item
  FOR EACH ROW EXECUTE PROCEDURE public.create_item_search_result();

CREATE FUNCTION public.create_item_related_records()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."itemCost"("itemId", "costingMethod", "createdBy", "companyId")
  VALUES (new.id, 'FIFO', new."createdBy", new."companyId");

  INSERT INTO public."itemReplenishment"("itemId", "createdBy", "companyId")
  VALUES (new.id, new."createdBy", new."companyId");

  INSERT INTO public."itemUnitSalePrice"("itemId", "currencyCode", "createdBy", "companyId")
  -- TODO: get default currency
  VALUES (new.id, 'USD', new."createdBy", new."companyId");
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE TRIGGER create_item_related_records
  AFTER INSERT on public.item
  FOR EACH ROW EXECUTE PROCEDURE public.create_item_related_records();

CREATE OR REPLACE FUNCTION public.update_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old.name <> new.name OR old.description <> new.description) THEN
    UPDATE public.search SET name = new."readableId", description = new.name || ' ' || COALESCE(new.description, '')
    WHERE entity = 'Part' AND uuid = new."readableId" AND "companyId" = new."companyId";
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_item_search_result
  AFTER UPDATE on public.item
  FOR EACH ROW EXECUTE PROCEDURE public.update_item_search_result();


CREATE FUNCTION public.delete_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.search WHERE entity = 'Part' AND uuid = old.id AND "companyId" = old."companyId";
  RETURN old;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER delete_item_search_result
  AFTER DELETE on public.item
  FOR EACH ROW EXECUTE PROCEDURE public.delete_item_search_result();

CREATE TABLE "itemCost" (
  "itemId" TEXT NOT NULL,
  "itemPostingGroupId" TEXT,
  "costingMethod" "itemCostingMethod" NOT NULL,
  "standardCost" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "unitCost" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "costIsAdjusted" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,


  CONSTRAINT "itemCost_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemCost_itemPostingGroupId_fkey" FOREIGN KEY ("itemPostingGroupId") REFERENCES "itemPostingGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "itemCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemPostingGroup_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemPostingGroup_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "itemCost_itemId_idx" ON "itemCost" ("itemId");

ALTER TABLE "itemCost" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view part costs" ON "itemCost"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part costs" ON "itemCost"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE TABLE "itemUnitSalePrice" (
  "itemId" TEXT NOT NULL,
  "unitSalePrice" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "currencyCode" TEXT NOT NULL,
  "salesUnitOfMeasureCode" TEXT,
  "salesBlocked" BOOLEAN NOT NULL DEFAULT false,
  "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
  "allowInvoiceDiscount" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "itemUnitSalePrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemUnitSalePrice_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency"("code", "companyId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "itemUnitSalePrice_salesUnitOfMeasureId_fkey" FOREIGN KEY ("salesUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE SET NULL,
  CONSTRAINT "itemUnitSalePrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemUnitSalePrice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemUnitSalePrice_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "itemUnitSalePrice_itemId_idx" ON "itemUnitSalePrice"("itemId");
CREATE INDEX "itemUnitSalePrice_companyId_idx" ON "itemUnitSalePrice"("companyId");

ALTER TABLE "itemUnitSalePrice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part_view can view part sale prices" ON "itemUnitSalePrice"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part sale prices" ON "itemUnitSalePrice"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE TABLE "buyMethod" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierPartId" TEXT,
  "supplierUnitOfMeasureCode" TEXT,
  "minimumOrderQuantity" INTEGER DEFAULT 1,
  "conversionFactor" NUMERIC(15,5) NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "buyMethod_id_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "buyMethod_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buyMethod_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE CASCADE,
  CONSTRAINT "buyMethod_part_supplier_unique" UNIQUE ("itemId", "supplierId", "companyId"),
  CONSTRAINT "buyMethod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buyMethod_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "buyMethod_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "buyMethod_itemId_idx" ON "buyMethod"("itemId");
CREATE INDEX "buyMethod_companyId_idx" ON "buyMethod"("companyId");

ALTER TABLE "buyMethod" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part/purchasing_view can view part suppliers" ON "buyMethod"
  FOR SELECT
  USING (
    (
      has_company_permission('parts_view', "companyId") OR
      has_company_permission('purchasing_view', "companyId")
    )
    AND has_role('employee', "companyId")
  );

CREATE POLICY "Employees with parts_create can create part suppliers" ON "buyMethod"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part suppliers" ON "buyMethod"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete part suppliers" ON "buyMethod"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );

CREATE POLICY "Suppliers with parts_view can view their own part suppliers" ON "buyMethod"
  FOR SELECT
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_view', "companyId") AND
    "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
    )
  );

CREATE POLICY "Suppliers with parts_update can update their own part suppliers" ON "buyMethod"
  FOR UPDATE
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_update', "companyId") AND
    "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
    )
  );


CREATE TABLE "itemReplenishment" (
  "itemId" TEXT NOT NULL,
  "preferredSupplierId" TEXT,
  "purchasingLeadTime" INTEGER NOT NULL DEFAULT 0,
  "purchasingUnitOfMeasureCode" TEXT,
  "conversionFactor" NUMERIC(15,5) NOT NULL DEFAULT 1,
  "purchasingBlocked" BOOLEAN NOT NULL DEFAULT false,
  "manufacturingPolicy" "partManufacturingPolicy" NOT NULL DEFAULT 'Make to Stock',
  "manufacturingLeadTime" INTEGER NOT NULL DEFAULT 0,
  "manufacturingBlocked" BOOLEAN NOT NULL DEFAULT false,
  "requiresConfiguration" BOOLEAN NOT NULL DEFAULT false,
  "scrapPercentage" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "lotSize" INTEGER,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  
  CONSTRAINT "itemReplenishment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemReplenishment_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "supplier"("id") ON DELETE SET NULL,
  CONSTRAINT "itemReplenishment_purchaseUnitOfMeasureCode_fkey" FOREIGN KEY ("purchasingUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "itemReplenishment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemReplenishment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemReplenishment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "itemReplenishment_itemId_idx" ON "itemReplenishment" ("itemId");
CREATE INDEX "itemReplenishment_companyId_idx" ON "itemReplenishment" ("companyId");
CREATE INDEX "itemReplenishment_preferredSupplierId_idx" ON "itemReplenishment" ("preferredSupplierId");

ALTER TABLE "itemReplenishment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part_view can view part costs" ON "itemReplenishment"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part costs" ON "itemReplenishment"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );


CREATE POLICY "Suppliers with parts can view parts they created or supply" ON "item"
  FOR SELECT
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_view', "companyId")
    AND (
      "createdBy" = auth.uid()::text
      OR (
        id IN (
          SELECT "itemId" FROM "buyMethod" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
          )
        )              
      ) 
    )
  );

CREATE POLICY "Supliers with parts_create can insert parts" ON "item"
  FOR INSERT
  WITH CHECK (   
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Suppliers with parts_update can update parts that they created or supply" ON "item"
  FOR UPDATE
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
    AND (
      "createdBy" = auth.uid()::text
      OR (
        id IN (
          SELECT "itemId" FROM "buyMethod" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
          )
        )              
      ) 
    )
  );

CREATE POLICY "Suppliers with parts_delete can delete parts that they created or supply" ON "item"
  FOR DELETE
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
    AND (
      "createdBy" = auth.uid()::text
      OR (
        id IN (
          SELECT "itemId" FROM "buyMethod" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
          )
        )              
      ) 
    ) 
  );

CREATE POLICY "Suppliers with parts_view can view part costs they supply" ON "itemCost"
  FOR SELECT
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_view', "companyId")
    AND (
      "itemId" IN (
        SELECT "itemId" FROM "buyMethod" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
        )
      )                 
    )
  );

CREATE POLICY "Suppliers with parts_update can update parts costs that they supply" ON "itemCost"
  FOR UPDATE
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_update', "companyId")
    AND (
      "itemId" IN (
        SELECT "itemId" FROM "buyMethod" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
        )
      )                 
    )
  );

CREATE POLICY "Suppliers with parts_view can view part replenishments they supply" ON "itemReplenishment"
  FOR SELECT
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
    AND (
      "itemId" IN (
        SELECT "itemId" FROM "buyMethod" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
        )
      )               
    )
  );

CREATE POLICY "Suppliers with parts_update can update parts replenishments that they supply" ON "itemReplenishment"
  FOR UPDATE
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_update', "companyId")
    AND (
      "itemId" IN (
        SELECT "itemId" FROM "buyMethod" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
        )
      )                
    )
  );

CREATE TABLE "warehouse" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "requiresPick" BOOLEAN NOT NULL DEFAULT false,
  "requiresPutAway" BOOLEAN NOT NULL DEFAULT false,
  "requiresBin" BOOLEAN NOT NULL DEFAULT false,
  "requiresReceive" BOOLEAN NOT NULL DEFAULT false,
  "requiresShipment" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "warehouse_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "warehouse_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id"),
  CONSTRAINT "warehouse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "warehouse_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "warehouse_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "warehouse_companyId_idx" ON "warehouse" ("companyId");

ALTER TABLE "warehouse" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view warehouses" ON "warehouse"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can insert warehouses" ON "warehouse"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update warehouses" ON "warehouse"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete warehouses" ON "warehouse"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );

CREATE TABLE "shelf" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "shelf_pkey" PRIMARY KEY ("id", "locationId"),
  CONSTRAINT "shelf_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "shelf_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE CASCADE,
  CONSTRAINT "shelf_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shelf_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "shelf_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "shelf_id_locationId_idx" ON "shelf" ("id", "locationId");
CREATE INDEX "shelf_warehouseId_idx" ON "shelf" ("warehouseId");
CREATE INDEX "shelf_companyId_idx" ON "shelf" ("companyId");


ALTER TABLE "shelf" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view shelves" ON "shelf"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );
  

CREATE POLICY "Employees with parts_create can insert shelves" ON "shelf"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update shelves" ON "shelf"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete shelves" ON "shelf"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );

CREATE TABLE "itemPlanning" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "reorderingPolicy" "itemReorderingPolicy" NOT NULL DEFAULT 'Demand-Based Reorder',
  "critical" BOOLEAN NOT NULL DEFAULT false,
  "safetyStockQuantity" INTEGER NOT NULL DEFAULT 0,
  "safetyStockLeadTime" INTEGER NOT NULL DEFAULT 0,
  "demandAccumulationPeriod" INTEGER NOT NULL DEFAULT 0,
  "demandReschedulingPeriod" INTEGER NOT NULL DEFAULT 0,
  "demandAccumulationIncludesInventory" BOOLEAN NOT NULL DEFAULT false,
  "reorderPoint" INTEGER NOT NULL DEFAULT 0,
  "reorderQuantity" INTEGER NOT NULL DEFAULT 0,
  "reorderMaximumInventory" INTEGER NOT NULL DEFAULT 0,
  "minimumOrderQuantity" INTEGER NOT NULL DEFAULT 0,
  "maximumOrderQuantity" INTEGER NOT NULL DEFAULT 0,
  "orderMultiple" INTEGER NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,


  CONSTRAINT "itemPlanning_itemId_locationId_key" UNIQUE ("itemId", "locationId"),
  CONSTRAINT "itemPlanning_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemPlanning_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemPlanning_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemPlanning_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemPlanning_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "itemPlanning_itemId_locationId_idx" ON "itemPlanning" ("itemId", "locationId");
ALTER TABLE "itemPlanning" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts can view part planning" ON "itemPlanning"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );

-- these are records are created lazily when a user attempts to view them
CREATE POLICY "Employees with parts can insert part planning" ON "itemPlanning"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part planning" ON "itemPlanning"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );


CREATE TABLE "pickMethod" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "defaultShelfId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "pickMethod_itemId_locationId_key" UNIQUE ("itemId", "locationId"),
  CONSTRAINT "pickMethod_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pickMethod_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pickMethod_shelfId_fkey" FOREIGN KEY ("defaultShelfId", "locationId") REFERENCES "shelf"("id", "locationId") ON DELETE SET NULL,
  CONSTRAINT "pickMethod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pickMethod_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "pickMethod_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "pickMethod_itemId_locationId_idx" ON "pickMethod" ("itemId", "locationId");
CREATE INDEX "pickMethod_shelfId_idx" ON "pickMethod" ("defaultShelfId");

ALTER TABLE "pickMethod" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part_view can view part planning" ON "pickMethod"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );

-- these are records are created lazily when a user attempts to view them
CREATE POLICY "Employees with part_view can insert part planning" ON "pickMethod"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part planning" ON "pickMethod"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );




