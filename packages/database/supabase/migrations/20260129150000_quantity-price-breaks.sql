-- Add unit price to supplierPart and create supplierPartPrice child table
-- for quantity-based pricing used in quote material costing

ALTER TABLE "supplierPart"
ADD COLUMN IF NOT EXISTS "unitPrice" NUMERIC(15, 5);

CREATE TYPE "supplierPartPriceSourceType" AS ENUM (
  'Quote',
  'Purchase Order',
  'Manual Entry'
);

CREATE TABLE "supplierPartPrice" (
  "supplierPartId" TEXT NOT NULL,
  "quantity" NUMERIC(20, 2) NOT NULL DEFAULT 1,
  "unitPrice" NUMERIC(15, 5) NOT NULL,
  "sourceType" "supplierPartPriceSourceType" NOT NULL DEFAULT 'Quote',
  "sourceDocumentId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "supplierPartPrice_pkey" PRIMARY KEY ("supplierPartId", "quantity"),
  CONSTRAINT "supplierPartPrice_supplierPartId_companyId_fkey"
    FOREIGN KEY ("supplierPartId", "companyId") REFERENCES "supplierPart"("id", "companyId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierPartPrice_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierPartPrice_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "supplierPartPrice_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

ALTER TABLE "supplierPartPrice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."supplierPartPrice"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('parts_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."supplierPartPrice"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierPartPrice"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierPartPrice"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);
