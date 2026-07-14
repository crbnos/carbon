-- Document Extraction table for PDF auto-fill feature.
-- Stores the state and results of AI-driven PDF data extraction.

CREATE TYPE "documentExtractionStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TYPE "documentExtractionType" AS ENUM ('purchaseInvoice', 'salesRfq');

CREATE TABLE "documentExtraction" (
    "id" TEXT NOT NULL DEFAULT id('docext'),
    "companyId" TEXT NOT NULL,
    "sourceDocument" TEXT NOT NULL,          -- e.g. 'Purchase Invoice', 'Request for Quote'
    "sourceDocumentId" TEXT,                 -- FK to the parent record (nullable: extraction may run before record exists)
    "storagePath" TEXT NOT NULL,             -- path in Supabase Storage
    "documentType" "documentExtractionType" NOT NULL,
    "status" "documentExtractionStatus" NOT NULL DEFAULT 'pending',
    "extractedData" JSONB,                   -- raw AI output with confidence scores
    "filteredData" JSONB,                    -- values that passed confidence threshold
    "error" TEXT,                            -- error message if failed

    -- Audit columns (required by Carbon conventions)
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "documentExtraction_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "documentExtraction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "documentExtraction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
    CONSTRAINT "documentExtraction_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

-- Required indexes
CREATE INDEX "documentExtraction_companyId_idx" ON "documentExtraction" ("companyId");
CREATE INDEX "documentExtraction_createdBy_idx" ON "documentExtraction" ("createdBy");
CREATE INDEX "documentExtraction_sourceDocumentId_idx" ON "documentExtraction" ("sourceDocumentId");

-- RLS: any employee can interact with extractions (the extraction itself
-- is a staging area; actual record creation goes through the normal
-- permission-gated route actions for invoices/RFQs).
ALTER TABLE "documentExtraction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."documentExtraction"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."documentExtraction"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."documentExtraction"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."documentExtraction"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);
