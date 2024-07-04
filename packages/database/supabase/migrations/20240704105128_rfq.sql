CREATE TYPE "salesRfqStatus" AS ENUM (
  'Draft',
  'Ready for Quote',
  'Quoted',
  'Closed'
);

CREATE TABLE "salesRfq" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "rfqId" TEXT NOT NULL,
  "revisionId" INTEGER NOT NULL DEFAULT 0,
  "status" "salesRfqStatus" NOT NULL DEFAULT 'Draft',
  "employeeId" TEXT,
  "customerId" TEXT NOT NULL,
  "customerContactId" TEXT,
  "customerReference" TEXT,
  "rfqDate" DATE NOT NULL,
  "expirationDate" DATE,
  "internalNotes" TEXT,
  "externalNotes" TEXT,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedBy" TEXT,

  CONSTRAINT "salesRfq_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesRfq_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user" ("id") ON DELETE SET NULL,
  CONSTRAINT "salesRfq_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL,
  CONSTRAINT "salesRfq_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "customerContact" ("id") ON DELETE SET NULL,
  CONSTRAINT "salesRfq_assigneeId_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesRfq_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesRfq_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesRfq_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesRfq_rfqId_key" UNIQUE ("rfqId")
);

CREATE INDEX "salesRfq_companyId_idx" ON "salesRfq" ("companyId");
CREATE INDEX "salesRfq_rfqId_idx" ON "salesRfq" ("rfqId");
CREATE INDEX "salesRfq_customerId_idx" ON "salesRfq" ("customerId", "companyId");
CREATE INDEX "salesRfq_status_idx" ON "salesRfq" ("status", "companyId");

CREATE TABLE "salesRfqLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "salesRfqId" TEXT NOT NULL,
  "partNumber" TEXT NOT NULL,
  "description" TEXT,
  "quantity" NUMERIC(20, 2) NOT NULL,
  "unitOfMeasureCode" TEXT NOT NULL,
  "drawingPath" TEXT,
  "companyId" TEXT NOT NULL,

  CONSTRAINT "salesRfqLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesRfqLine_salesRfqId_fkey" FOREIGN KEY ("salesRfqId") REFERENCES "salesRfq" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesRfqLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesRfqLine_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "salesRfqLine_salesRfqId_idx" ON "salesRfqLine" ("salesRfqId");
CREATE INDEX "salesRfqLine_partNumber_idx" ON "salesRfqLine" ("partNumber", "companyId");

ALTER TABLE "modelUpload" ADD COLUMN "salesRfqLineId" TEXT;