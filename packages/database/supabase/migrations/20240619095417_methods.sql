ALTER TABLE "itemReplenishment" DROP COLUMN "manufacturingPolicy";
DROP TYPE "partManufacturingPolicy";

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



CREATE TABLE "methodMaterial" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "makeMethodId" TEXT NOT NULL,
  "methodType" "methodType" NOT NULL DEFAULT 'Buy',
  "materialMakeMethodId" TEXT,
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
  CONSTRAINT "methodMaterial_materialMakeMethodId_fkey" FOREIGN KEY ("materialMakeMethodId") REFERENCES "makeMethod" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "methodMaterial_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "methodMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "methodMaterial_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "methodMaterial_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);


