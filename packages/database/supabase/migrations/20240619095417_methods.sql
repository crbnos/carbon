ALTER TABLE "itemReplenishment" DROP COLUMN "manufacturingPolicy";
DROP TYPE "partManufacturingPolicy";

ALTER TABLE "item" ADD COLUMN "pullFromInventory" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "makeMethod" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,


  CONSTRAINT "method_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "method_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "method_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "method_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE FUNCTION public.create_make_method_related_records()
RETURNS TRIGGER AS $$
BEGIN
  -- if part.replenishmentSystem is 'Make' or 'Buy and Make' then create a make method record
  IF new."replenishmentSystem" = 'Make' OR new."replenishmentSystem" = 'Buy and Make' THEN
    INSERT INTO public."makeMethod"("itemId", "createdBy", "companyId")
    VALUES (new.id, new."createdBy", new."companyId");
  END IF;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.update_make_method_related_records()
RETURNS TRIGGER AS $$
BEGIN
  -- if part.replenishmentSystem is 'Make' or 'Buy and Make' then create a make method record
  IF old."replenishmentSystem" = 'Buy' AND (new."replenishmentSystem" = 'Make' OR new."replenishmentSystem" = 'Buy and Make') THEN
    INSERT INTO public."makeMethod"("itemId", "createdBy", "companyId")
    VALUES (new.id, new."createdBy", new."companyId");
  END IF;

  -- if old replenishment system is 'Make' or 'Buy and Make' and new replenishment system is 'Buy' then delete make method record
  IF (old."replenishmentSystem" = 'Make' OR old."replenishmentSystem" = 'Buy and Make') AND new."replenishmentSystem" = 'Buy' THEN
    DELETE FROM public."makeMethod" WHERE "itemId" = old.id;
  END IF;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_part_make_method_related_records
  AFTER INSERT on public.part
  FOR EACH ROW EXECUTE PROCEDURE public.create_make_method_related_records();

CREATE TRIGGER update_part_make_method_related_records
  AFTER UPDATE on public.part
  FOR EACH ROW EXECUTE PROCEDURE public.update_make_method_related_records();



CREATE TYPE "methodOperationOrder" AS ENUM (
  'After Previous',
  'With Previous'
);

CREATE TABLE "methodOperation" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "makeMethodId" TEXT NOT NULL,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "operationOrder" "methodOperationOrder" NOT NULL DEFAULT 'After Previous',
  "workCellTypeId" TEXT NOT NULL,
  "equipmentTypeId" TEXT,
  "description" TEXT,
  "setupHours" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "standardFactor" factor NOT NULL DEFAULT 'Hours/Piece',
  "productionStandard" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "methodOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "methodOperation_methodId_fkey" FOREIGN KEY ("makeMethodId") REFERENCES "makeMethod" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "methodOperation_workCellTypeId_fkey" FOREIGN KEY ("workCellTypeId") REFERENCES "workCellType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "methodOperation_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "equipmentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "methodOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "methodOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "methodOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TYPE "methodType" AS ENUM (
  'Buy',
  'Make',
  'Pick'
);

CREATE TABLE "methodMaterial" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "makeMethodId" TEXT NOT NULL,
  "methodType" "methodType" NOT NULL DEFAULT 'Buy',
  "itemType" TEXT NOT NULL DEFAULT 'Material',
  "itemId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "unitOfMeasureCode" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "methodMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "methodMaterial_methodId_fkey" FOREIGN KEY ("makeMethodId") REFERENCES "makeMethod" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "methodMaterial_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "methodMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "methodMaterial_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "methodMaterial_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);


