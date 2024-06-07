CREATE TYPE "requestForQuoteStatus" AS ENUM ('Draft', 'Sent', 'Expired', 'Closed');

CREATE TABLE "requestForQuote" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "requestForQuoteId" TEXT NOT NULL,
  "revisionId" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "status" "requestForQuoteStatus" NOT NULL DEFAULT 'Draft',
  "notes" TEXT,
  "receiptDate" DATE NOT NULL,
  "expirationDate" DATE,
  "locationId" TEXT,
  "assignee" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedBy" TEXT,

  CONSTRAINT "requestForQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "requestForQuote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id"),
  CONSTRAINT "requestForQuote_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id"),
  CONSTRAINT "requestForQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuote_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "requestForQuote_companyId_idx" ON "requestForQuote" ("companyId");
CREATE INDEX "requestForQuote_locationId_idx" ON "requestForQuote" ("locationId", "companyId");

CREATE TABLE "requestForQuoteLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "requestForQuoteId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" NUMERIC(20, 2) NOT NULL,
  "unitPrice" NUMERIC(20, 2) NOT NULL DEFAULT 0,
  "unitOfMeasureCode" TEXT,
  "locationId" TEXT,
  "shelfId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "requestForQuoteLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "requestForQuoteLine_requestForQuoteId_fkey" FOREIGN KEY ("requestForQuoteId") REFERENCES "requestForQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteLine_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "requestForQuoteLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "requestForQuoteLine_shelfId_fkey"  FOREIGN KEY ("shelfId", "locationId") REFERENCES "shelf" ("id", "locationId") ON DELETE CASCADE,
  CONSTRAINT "requestForQuoteLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "requestForQuoteLine_requestForQuoteId_idx" ON "requestForQuoteLine" ("requestForQuoteId");
CREATE INDEX "requestForQuoteLine_itemId_idx" ON "requestForQuoteLine" ("itemId");
CREATE INDEX "requestForQuoteLine_locationId_idx" ON "requestForQuoteLine" ("locationId");

CREATE TABLE "requestForQuoteSupplier" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "requestForQuoteId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierLocationId" TEXT,
  "supplierContactId" TEXT,
  "token" TEXT,
  "password" TEXT,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "requestForQuoteSupplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "requestForQuoteSupplier_requestForQuoteId_fkey" FOREIGN KEY ("requestForQuoteId") REFERENCES "requestForQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteSupplier_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteSupplier_supplierContactId_fkey" FOREIGN KEY ("supplierContactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteSupplier_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteSupplier_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "requestForQuoteSupplier_requestForQuoteId_idx" ON "requestForQuoteSupplier" ("requestForQuoteId");
CREATE INDEX "requestForQuoteSupplier_supplierId_idx" ON "requestForQuoteSupplier" ("supplierId");

CREATE TABLE "requestForQuoteSupplierLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "requestForQuoteSupplierId" TEXT NOT NULL,
  "requestForQuoteLineId" TEXT NOT NULL,
  "unitPrice" NUMERIC(20, 2) NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedBy" TEXT,

  CONSTRAINT "requestForQuoteSupplierLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "requestForQuoteSupplierLine_requestForQuoteSupplierId_fkey" FOREIGN KEY ("requestForQuoteSupplierId") REFERENCES "requestForQuoteSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteSupplierLine_requestForQuoteLineId_fkey" FOREIGN KEY ("requestForQuoteLineId") REFERENCES "requestForQuoteLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteSupplierLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requestForQuoteSupplierLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);


CREATE TABLE "requestForQuoteFavorite" (
  "requestForQuoteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "requestForQuoteFavorites_pkey" PRIMARY KEY ("requestForQuoteId", "userId"),
  CONSTRAINT "requestForQuoteFavorites_requestForQuoteId_fkey" FOREIGN KEY ("requestForQuoteId") REFERENCES "requestForQuote"("id") ON DELETE CASCADE,
  CONSTRAINT "requestForQuoteFavorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "requestForQuoteFavorites_userId_idx" ON "requestForQuoteFavorite" ("userId");
CREATE INDEX "requestForQuoteFavorites_requestForQuoteId_idx" ON "requestForQuoteFavorite" ("requestForQuoteId");

ALTER TABLE "requestForQuoteFavorite" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own rfq favorites" ON "requestForQuoteFavorite" 
  FOR SELECT USING (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can create their own rfq favorites" ON "requestForQuoteFavorite" 
  FOR INSERT WITH CHECK (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can delete their own rfq favorites" ON "requestForQuoteFavorite"
  FOR DELETE USING (
    auth.uid()::text = "userId"
  ); 

CREATE OR REPLACE VIEW "requestForQuotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  r."id",
  r."requestForQuoteId",
  r."name",
  r."status",
  r."notes",
  r."receiptDate",
  r."expirationDate",
  r."locationId",
  r."customFields",
  r."companyId",
  r."createdAt",
  r."createdBy",
  uc."fullName" AS "createdByFullName",
  uc."avatarUrl" AS "createdByAvatar",
  uu."fullName" AS "updatedByFullName",
  uu."avatarUrl" AS "updatedByAvatar",
  l."name" AS "locationName",
  array_agg(rs."supplierId") AS "supplierIds",
  array_agg(rl."itemId") AS "itemIds",
  EXISTS(SELECT 1 FROM "requestForQuoteFavorite" pf WHERE pf."requestForQuoteId" = r.id AND pf."userId" = auth.uid()::text) AS favorite
FROM "requestForQuote" r
LEFT JOIN "location" l
  ON l.id = r."locationId"
LEFT JOIN "requestForQuoteSupplier" rs
  ON rs."requestForQuoteId" = r.id
LEFT JOIN "requestForQuoteLine" rl
  ON rl."requestForQuoteId" = r.id
LEFT JOIN "user" uc
  ON uc.id = r."createdBy"
LEFT JOIN "user" uu
  ON uu.id = r."updatedBy"
GROUP BY
  r."id",
  r."requestForQuoteId",
  r."name",
  r."status",
  r."notes",
  r."receiptDate",
  r."expirationDate",
  r."locationId",
  r."customFields",
  r."createdAt",
  r."createdBy",
  uc."fullName",
  uc."avatarUrl",
  uu."fullName",
  uu."avatarUrl",
  l."name";