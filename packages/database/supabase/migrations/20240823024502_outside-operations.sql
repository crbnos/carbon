CREATE TYPE "operationType" AS ENUM (
  'Inside',
  'Outside'
);

ALTER TABLE "methodOperation"
  ADD COLUMN "operationType" "operationType" NOT NULL DEFAULT 'Inside',
  ADD COLUMN "operationLeadTime" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "operationCost" NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "operationSupplierId" TEXT,
  ADD CONSTRAINT "methodOperation_operationSupplierId_fkey" FOREIGN KEY ("operationSupplierId") REFERENCES "supplier" ("id") ON DELETE SET NULL;

ALTER TABLE "quoteOperation"
  ADD COLUMN "operationType" "operationType" NOT NULL DEFAULT 'Inside',
  ADD COLUMN "operationLeadTime" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "operationCost" NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "operationSupplierId" TEXT,
  ADD CONSTRAINT "quoteOperation_operationSupplierId_fkey" FOREIGN KEY ("operationSupplierId") REFERENCES "supplier" ("id") ON DELETE SET NULL;

CREATE TABLE "supplierProcess" (
  "supplierId" TEXT NOT NULL,
  "processId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMPTZ,

  CONSTRAINT "supplierProcess_pkey" PRIMARY KEY ("supplierId", "processId"),
  CONSTRAINT "supplierProcess_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id") ON DELETE CASCADE,
  CONSTRAINT "supplierProcess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process" ("id") ON DELETE CASCADE,
  CONSTRAINT "supplierProcess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "supplierProcess_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "supplierProcess_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL
);