CREATE TABLE "scrapReason" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,

    CONSTRAINT "scrapReason_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scrapReason_name_unique" UNIQUE ("name", "companyId"),
    CONSTRAINT "scrapReason_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "scrapReason_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "scrapReason_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "scrapReason_companyId_fkey" ON "scrapReason"("companyId");
