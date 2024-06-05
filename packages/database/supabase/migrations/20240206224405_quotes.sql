

CREATE TYPE "quoteStatus" AS ENUM (
  'Draft', 
  'Open', 
  'Replied', 
  'Ordered',
  'Partial',
  'Lost', 
  'Cancelled',
  'Expired'
);

CREATE TABLE "quote" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quoteId" TEXT NOT NULL,
  "revisionId" INTEGER NOT NULL DEFAULT 0,
  "ownerId" TEXT NOT NULL,
  "name" TEXT,
  "status" "quoteStatus" NOT NULL DEFAULT 'Draft',
  "quoteDate" DATE,
  "expirationDate" DATE,
  "notes" TEXT,
  "customerId" TEXT NOT NULL,
  "customerLocationId" TEXT,
  "customerContactId" TEXT,
  "customerReference" TEXT,
  "locationId" TEXT,
  "assignee" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "quote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_quoteId_key" UNIQUE ("quoteId", "companyId"),
  CONSTRAINT "quote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "customerContact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "quote_quoteId_idx" ON "quote" ("quoteId", "companyId");
CREATE INDEX "quote_ownerId_idx" ON "quote" ("ownerId", "companyId");
CREATE INDEX "quote_customerId_idx" ON "quote" ("customerId", "companyId");
CREATE INDEX "quote_locationId_idx" ON "quote" ("locationId", "companyId");
CREATE INDEX "quote_companyId_idx" ON "quote" ("companyId");

CREATE TYPE "quoteLineStatus" AS ENUM (
  'Draft',
  'In Progress',
  'Complete'
);

CREATE TABLE "quoteLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quoteId" TEXT NOT NULL,
  "quoteRevisionId" INTEGER NOT NULL DEFAULT 0,
  "status" "quoteLineStatus" NOT NULL DEFAULT 'Draft',
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT,
  "description" TEXT NOT NULL,
  "customerPartId" TEXT,
  "customerPartRevision" TEXT,
  "replenishmentSystem" TEXT,
  "unitOfMeasureCode" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "quoteLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteLine_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "quoteLine_quoteId_idx" ON "quoteLine" ("quoteId");

CREATE TABLE "quoteAssembly" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quoteId" TEXT NOT NULL,
  "quoteLineId" TEXT NOT NULL,
  "parentAssemblyId" TEXT,
  "itemId" TEXT NOT NULL,
  "description" TEXT,
  "unitOfMeasureCode" TEXT,
  "quantityPerParent" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "quoteAssembly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteAssembly_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteAssembly_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "quoteLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteAssembly_parentAssemblyId_fkey" FOREIGN KEY ("parentAssemblyId") REFERENCES "quoteAssembly" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteAssembly_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteAssembly_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteAssembly_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteAssembly_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteAssembly_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "quoteAssembly_quoteId_idx" ON "quoteAssembly" ("quoteId");
CREATE INDEX "quoteAssembly_quoteLineId_idx" ON "quoteAssembly" ("quoteLineId");
CREATE INDEX "quoteAssembly_parentAssemblyId_idx" ON "quoteAssembly" ("parentAssemblyId");

CREATE TABLE "quoteOperation" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quoteId" TEXT NOT NULL,
  "quoteLineId" TEXT NOT NULL,
  "quoteAssemblyId" TEXT,
  "workCellTypeId" TEXT NOT NULL,
  "equipmentTypeId" TEXT,
  "description" TEXT,
  "setupHours" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "standardFactor" factor NOT NULL DEFAULT 'Hours/Piece',
  "productionStandard" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "quotingRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "laborRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "overheadRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "quoteOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteOperation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteOperation_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "quoteLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteOperation_quoteAssemblyId_fkey" FOREIGN KEY ("quoteAssemblyId") REFERENCES "quoteAssembly" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteOperation_workCellTypeId_fkey" FOREIGN KEY ("workCellTypeId") REFERENCES "workCellType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteOperation_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "equipmentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "quoteOperation_quoteId_idx" ON "quoteOperation" ("quoteId");
CREATE INDEX "quoteOperation_quoteLineId_idx" ON "quoteOperation" ("quoteLineId");
CREATE INDEX "quoteOperation_quoteAssemblyId_idx" ON "quoteOperation" ("quoteAssemblyId");

CREATE TABLE "quoteMaterial" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quoteId" TEXT NOT NULL,
  "quoteLineId" TEXT NOT NULL,
  "quoteOperationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "unitOfMeasureCode" TEXT,
  "unitCost" NUMERIC(10, 2) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "quoteMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteMaterial_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteMaterial_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "quoteLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteMaterial_quoteOperationId_fkey" FOREIGN KEY ("quoteOperationId") REFERENCES "quoteOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteMaterial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteMaterial_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteMaterial_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quoteMaterial_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "quoteMaterial_quoteId_idx" ON "quoteMaterial" ("quoteId");
CREATE INDEX "quoteMaterial_quoteLineId_idx" ON "quoteMaterial" ("quoteLineId");
CREATE INDEX "quoteMaterial_quoteOperationId_idx" ON "quoteMaterial" ("quoteOperationId");

CREATE TABLE "quoteFavorite" (
  "quoteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "quoteFavorites_pkey" PRIMARY KEY ("quoteId", "userId"),
  CONSTRAINT "quoteFavorites_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE CASCADE,
  CONSTRAINT "quoteFavorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "quoteFavorites_userId_idx" ON "quoteFavorite" ("userId");
CREATE INDEX "quoteFavorites_quoteId_idx" ON "quoteFavorite" ("quoteId");

ALTER TABLE "quoteFavorite" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own quote favorites" ON "quoteFavorite" 
  FOR SELECT USING (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can create their own quote favorites" ON "quoteFavorite" 
  FOR INSERT WITH CHECK (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can delete their own quote favorites" ON "quoteFavorite"
  FOR DELETE USING (
    auth.uid()::text = "userId"
  ); 

CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q."id",
  q."quoteId",
  q."customerId",
  q."customerLocationId",
  q."customerContactId",
  q."name",
  q."status",
  q."notes",
  q."quoteDate",
  q."expirationDate",
  q."customerReference",
  q."locationId",
  q."createdAt",
  q."createdBy",
  q."ownerId",
  q."customFields",
  q."companyId",
  uo."fullName" AS "ownerFullName",
  uo."avatarUrl" AS "ownerAvatar",
  c."name" AS "customerName",
  uc."fullName" AS "createdByFullName",
  uc."avatarUrl" AS "createdByAvatar",
  uu."fullName" AS "updatedByFullName",
  uu."avatarUrl" AS "updatedByAvatar",
  l."name" AS "locationName",
  array_agg(ql."itemId") AS "itemIds",
  EXISTS(SELECT 1 FROM "quoteFavorite" pf WHERE pf."quoteId" = q.id AND pf."userId" = auth.uid()::text) AS favorite
FROM "quote" q
LEFT JOIN "customer" c
  ON c.id = q."customerId"
LEFT JOIN "location" l
  ON l.id = q."locationId"
LEFT JOIN "quoteLine" ql
  ON ql."quoteId" = q.id
LEFT JOIN "user" uo
  ON uo.id = q."ownerId"
LEFT JOIN "user" uc
  ON uc.id = q."createdBy"
LEFT JOIN "user" uu
  ON uu.id = q."updatedBy"
GROUP BY
  q."id",
  q."quoteId",
  q."customerId",
  q."customerLocationId",
  q."customerContactId",
  q."name",
  q."status",
  q."notes",
  q."quoteDate",
  q."expirationDate",
  q."customerReference",
  q."locationId",
  q."createdAt",
  q."createdBy",
  q."customFields",
  c."name",
  uo."fullName",
  uo."avatarUrl",
  uc."fullName",
  uc."avatarUrl",
  uu."fullName",
  uu."avatarUrl",
  l."name";