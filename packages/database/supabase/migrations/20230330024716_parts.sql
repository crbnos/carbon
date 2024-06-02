CREATE TABLE "partGroup" (
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

  CONSTRAINT "partGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partGroup_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "partGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partGroup_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "partGroup_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "partGroup_companyId_idx" ON "partGroup" ("companyId");

ALTER TABLE "partGroup" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view part groups" ON "partGroup"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );
  

CREATE POLICY "Employees with parts_create can insert part groups" ON "partGroup"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update part groups" ON "partGroup"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete part groups" ON "partGroup"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );


CREATE TYPE "itemType" AS ENUM (
  'part',
  'material',
  'tool',
  'hardware',
  'service',
  'consumable',
  'fixture'
);

CREATE TABLE "item" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "readableId" TEXT NOT NULL,
  "type" "itemType" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "partGroupId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "blocked" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "item_pkey" PRIMARY KEY (id),
  CONSTRAINT "item_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "item_unique" UNIQUE ("readableId", "companyId", "type"),
  CONSTRAINT "item_partGroupId_fkey" FOREIGN KEY ("partGroupId") REFERENCES "partGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "item_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id")
);

CREATE INDEX "item_companyId_idx" ON "item" ("companyId");
CREATE INDEX "item_name_companyId_idx" ON "item" ("name", "companyId");

CREATE TYPE "partType" AS ENUM (
  'Inventory',
  'Non-Inventory'
);

CREATE TYPE "partReplenishmentSystem" AS ENUM (
  'Buy',
  'Make',
  'Buy and Make'
);

CREATE TYPE "partManufacturingPolicy" AS ENUM (
  'Make to Order',
  'Make to Stock'
);


CREATE TYPE "partCostingMethod" AS ENUM (
  'Standard',
  'Average',
  'LIFO',
  'FIFO'
);

CREATE TYPE "partReorderingPolicy" AS ENUM (
  'Manual Reorder',
  'Demand-Based Reorder',
  'Fixed Reorder Quantity',
  'Maximum Quantity'
);

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
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update units of measure" ON "unitOfMeasure"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete units of measure" ON "unitOfMeasure"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );


CREATE TABLE "part" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "replenishmentSystem" "partReplenishmentSystem" NOT NULL,
  "partType" "partType" NOT NULL,
  "unitOfMeasureCode" TEXT NOT NULL,
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
  CONSTRAINT "part_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "part_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "user"("id"),
  CONSTRAINT "part_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "part_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "part_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "part_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "part_itemId_idx" ON "part" ("itemId");
CREATE INDEX "part_companyId_idx" ON "part" ("companyId");
CREATE INDEX "part_partType_idx" ON "part"("partType", "companyId");
CREATE INDEX "part_replenishmentSystem_idx" ON "part"("replenishmentSystem", "companyId");

ALTER publication supabase_realtime ADD TABLE "part";
ALTER TABLE "part" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view parts" ON "part"
  FOR SELECT
  USING (
    has_role('employee') 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can insert parts" ON "part"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update parts" ON "part"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete parts" ON "part"
  FOR DELETE
  USING (
    has_role('employee') AND
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

CREATE FUNCTION public.create_part_related_records()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."partCost"("partId", "costingMethod", "createdBy", "companyId")
  VALUES (new.id, 'FIFO', new."createdBy", new."companyId");

  INSERT INTO public."partReplenishment"("partId", "createdBy", "companyId")
  VALUES (new.id, new."createdBy", new."companyId");

  INSERT INTO public."partUnitSalePrice"("partId", "currencyCode", "createdBy", "companyId")
  -- TODO: get default currency
  VALUES (new.id, 'USD', new."createdBy", new."companyId");
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE TRIGGER create_part_related_records
  AFTER INSERT on public.part
  FOR EACH ROW EXECUTE PROCEDURE public.create_part_related_records();

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

CREATE TABLE "partCost" (
  "partId" TEXT NOT NULL,
  "costingMethod" "partCostingMethod" NOT NULL,
  "standardCost" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "unitCost" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "costIsAdjusted" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,


  CONSTRAINT "partCost_partId_fkey" FOREIGN KEY ("partId", "companyId") REFERENCES "part"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partGroup_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "partGroup_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "partCost_partId_idx" ON "partCost" ("partId");

ALTER TABLE "partCost" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view part costs" ON "partCost"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part costs" ON "partCost"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE TABLE "partUnitSalePrice" (
  "partId" TEXT NOT NULL,
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

  CONSTRAINT "partUnitSalePrice_partId_fkey" FOREIGN KEY ("partId", "companyId") REFERENCES "part"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partUnitSalePrice_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency"("code", "companyId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "partUnitSalePrice_salesUnitOfMeasureId_fkey" FOREIGN KEY ("salesUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE SET NULL,
  CONSTRAINT "partUnitSalePrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partUnitSalePrice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "partUnitSalePrice_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "partUnitSalePrice_partId_idx" ON "partUnitSalePrice"("partId");
CREATE INDEX "partUnitSalePrice_companyId_idx" ON "partUnitSalePrice"("companyId");

ALTER TABLE "partUnitSalePrice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part_view can view part sale prices" ON "partUnitSalePrice"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part sale prices" ON "partUnitSalePrice"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE TABLE "partSupplier" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "partId" TEXT NOT NULL,
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

  CONSTRAINT "partSupplier_id_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "partSupplier_partId_fkey" FOREIGN KEY ("partId", "companyId") REFERENCES "part"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE CASCADE,
  CONSTRAINT "partSupplier_part_supplier_unique" UNIQUE ("partId", "supplierId", "companyId"),
  CONSTRAINT "partSupplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partSupplier_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "partSupplier_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "partSupplier_partId_idx" ON "partSupplier"("partId");
CREATE INDEX "partSupplier_companyId_idx" ON "partSupplier"("companyId");

ALTER TABLE "partSupplier" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part/purchasing_view can view part suppliers" ON "partSupplier"
  FOR SELECT
  USING (
    (
      has_company_permission('parts_view', "companyId") OR
      has_company_permission('purchasing_view', "companyId")
    )
    AND has_role('employee')
  );

CREATE POLICY "Employees with parts_create can create part suppliers" ON "partSupplier"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part suppliers" ON "partSupplier"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete part suppliers" ON "partSupplier"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );

CREATE POLICY "Suppliers with parts_view can view their own part suppliers" ON "partSupplier"
  FOR SELECT
  USING (
    has_role('supplier') AND
    has_company_permission('parts_view', "companyId") AND
    "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
    )
  );

CREATE POLICY "Suppliers with parts_update can update their own part suppliers" ON "partSupplier"
  FOR UPDATE
  USING (
    has_role('supplier') AND
    has_company_permission('parts_update', "companyId") AND
    "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
    )
  );


CREATE TABLE "partReplenishment" (
  "partId" TEXT NOT NULL,
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
  
  CONSTRAINT "partReplenishment_partId_fkey" FOREIGN KEY ("partId", "companyId") REFERENCES "part"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partReplenishment_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "supplier"("id") ON DELETE SET NULL,
  CONSTRAINT "partReplenishment_purchaseUnitOfMeasureCode_fkey" FOREIGN KEY ("purchasingUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "partReplenishment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partReplenishment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "partReplenishment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "partReplenishment_partId_idx" ON "partReplenishment" ("partId");
CREATE INDEX "partReplenishment_companyId_idx" ON "partReplenishment" ("companyId");
CREATE INDEX "partReplenishment_preferredSupplierId_idx" ON "partReplenishment" ("preferredSupplierId");

ALTER TABLE "partReplenishment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part_view can view part costs" ON "partReplenishment"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part costs" ON "partReplenishment"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );


CREATE POLICY "Suppliers with parts can view parts they created or supply" ON "part"
  FOR SELECT
  USING (
    has_role('supplier') AND
    has_company_permission('parts_view', "companyId")
    AND (
      "createdBy" = auth.uid()::text
      OR (
        id IN (
          SELECT "partId" FROM "partSupplier" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
          )
        )              
      ) 
    )
  );

CREATE POLICY "Supliers with parts_create can insert parts" ON "part"
  FOR INSERT
  WITH CHECK (   
    has_role('supplier') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Suppliers with parts_update can update parts that they created or supply" ON "part"
  FOR UPDATE
  USING (
    has_role('supplier') AND
    has_company_permission('parts_create', "companyId")
    AND (
      "createdBy" = auth.uid()::text
      OR (
        id IN (
          SELECT "partId" FROM "partSupplier" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
          )
        )              
      ) 
    )
  );

CREATE POLICY "Suppliers with parts_delete can delete parts that they created or supply" ON "part"
  FOR DELETE
  USING (
    has_role('supplier') AND
    has_company_permission('parts_create', "companyId")
    AND (
      "createdBy" = auth.uid()::text
      OR (
        id IN (
          SELECT "partId" FROM "partSupplier" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
          )
        )              
      ) 
    ) 
  );

CREATE POLICY "Suppliers with parts_view can view part costs they supply" ON "partCost"
  FOR SELECT
  USING (
    has_role('supplier') AND
    has_company_permission('parts_view', "companyId")
    AND (
      "partId" IN (
        SELECT "partId" FROM "partSupplier" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
        )
      )                 
    )
  );

CREATE POLICY "Suppliers with parts_update can update parts costs that they supply" ON "partCost"
  FOR UPDATE
  USING (
    has_role('supplier') AND
    has_company_permission('parts_update', "companyId")
    AND (
      "partId" IN (
        SELECT "partId" FROM "partSupplier" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
        )
      )                 
    )
  );

CREATE POLICY "Suppliers with parts_view can view part replenishments they supply" ON "partReplenishment"
  FOR SELECT
  USING (
    has_role('supplier') AND
    has_company_permission('parts_create', "companyId")
    AND (
      "partId" IN (
        SELECT "partId" FROM "partSupplier" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
        )
      )               
    )
  );

CREATE POLICY "Suppliers with parts_update can update parts replenishments that they supply" ON "partReplenishment"
  FOR UPDATE
  USING (
    has_role('supplier') AND
    has_company_permission('parts_update', "companyId")
    AND (
      "partId" IN (
        SELECT "partId" FROM "partSupplier" WHERE "supplierId" IN (
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
    has_role('employee') 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );
  

CREATE POLICY "Employees with parts_create can insert shelves" ON "shelf"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update shelves" ON "shelf"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete shelves" ON "shelf"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );

CREATE TABLE "partPlanning" (
  "partId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "reorderingPolicy" "partReorderingPolicy" NOT NULL DEFAULT 'Demand-Based Reorder',
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


  CONSTRAINT "partPlanning_partId_locationId_key" UNIQUE ("partId", "locationId"),
  CONSTRAINT "partPlanning_partId_fkey" FOREIGN KEY ("partId", "companyId") REFERENCES "part"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partPlanning_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partPlanning_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partPlanning_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "partPlanning_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "partPlanning_partId_locationId_idx" ON "partPlanning" ("partId", "locationId");
ALTER TABLE "partPlanning" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts can view part planning" ON "partPlanning"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

-- these are records are created lazily when a user attempts to view them
CREATE POLICY "Employees with parts can insert part planning" ON "partPlanning"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part planning" ON "partPlanning"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );


CREATE TABLE "partInventory" (
  "partId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "defaultShelfId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "partInventory_partId_locationId_key" UNIQUE ("partId", "locationId"),
  CONSTRAINT "partInventory_partId_fkey" FOREIGN KEY ("partId", "companyId") REFERENCES "part"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partInventory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partInventory_shelfId_fkey" FOREIGN KEY ("defaultShelfId", "locationId") REFERENCES "shelf"("id", "locationId") ON DELETE SET NULL,
  CONSTRAINT "partInventory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partInventory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "partInventory_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "partInventory_partId_locationId_idx" ON "partInventory" ("partId", "locationId");
CREATE INDEX "partInventory_shelfId_idx" ON "partInventory" ("defaultShelfId");

ALTER TABLE "partInventory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part_view can view part planning" ON "partInventory"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

-- these are records are created lazily when a user attempts to view them
CREATE POLICY "Employees with part_view can insert part planning" ON "partInventory"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_update can update part planning" ON "partInventory"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );




